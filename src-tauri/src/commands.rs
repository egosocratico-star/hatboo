use crate::db;
use crate::providers::{self, ChatMessage, StreamDelta};
use crate::state::{self, AppState, Settings};
use crate::web;
use serde::Serialize;
use std::path::PathBuf;
use tauri::{Emitter, Manager, State};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChunkPayload {
    conversation_id: String,
    delta: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReasoningPayload {
    conversation_id: String,
    delta: String,
}

/// Fase previa a la respuesta: `searching` mientras se consulta la web.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusPayload {
    conversation_id: String,
    phase: String,
    detail: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DonePayload {
    conversation_id: String,
    message: db::Message,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CancelledPayload {
    conversation_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorPayload {
    conversation_id: String,
    message: String,
}

#[tauri::command]
pub fn list_conversations(app: State<AppState>) -> Result<Vec<db::Conversation>, String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::list_conversations(&conn)
}

#[tauri::command]
pub fn create_conversation(
    app: State<AppState>,
    title: Option<String>,
    project_id: Option<String>,
) -> Result<db::Conversation, String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::create_conversation(
        &conn,
        &title.unwrap_or_else(|| "Nueva conversación".into()),
        project_id.as_deref(),
    )
}

#[tauri::command]
pub fn delete_conversation(app: State<AppState>, conversation_id: String) -> Result<(), String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    let images = db::conversation_image_files(&conn, &conversation_id)?;
    db::delete_conversation(&conn, &conversation_id)?;
    remove_image_files(images);
    Ok(())
}

#[tauri::command]
pub fn list_messages(app: State<AppState>, conversation_id: String) -> Result<Vec<db::Message>, String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::list_messages(&conn, &conversation_id)
}

#[tauri::command]
pub fn get_settings(app: State<AppState>) -> Settings {
    state::load_settings(&app)
}

#[tauri::command]
pub fn update_settings(app: State<AppState>, settings: Settings) -> Result<Settings, String> {
    state::save_settings(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
pub fn set_api_key(provider: String, key: String) -> Result<(), String> {
    providers::set_api_key(&provider, &key)
}

#[tauri::command]
pub fn has_api_key(provider: String) -> bool {
    providers::get_api_key(&provider).is_some()
}

#[tauri::command]
pub fn delete_api_key(provider: String) -> Result<(), String> {
    providers::delete_api_key(&provider)
}

/// Lista los modelos instalados en un servidor Ollama para el selector de Ajustes.
#[tauri::command]
pub async fn list_local_models(endpoint: String) -> Result<Vec<String>, String> {
    providers::list_ollama_models(&endpoint).await
}

/// Prueba de conexión para un proveedor (sin enviar un mensaje real).
#[tauri::command]
pub async fn test_provider(
    provider: String,
    model: String,
    endpoint: String,
) -> Result<String, String> {
    providers::test_connection(&provider, &model, &endpoint).await
}

/// Carga el historial de la conversación en formato de proveedor.
/// Los adjuntos de TEXTO se anteponen al contenido (la burbuja sigue limpia);
/// las IMÁGENES (M3) se leen desde disco, se codifican a base64 y viajan como
/// `ImagePart` aparte, no dentro de `content`.
fn history(app: &AppState, conversation_id: &str) -> Result<Vec<ChatMessage>, String> {
    use base64::{engine::general_purpose, Engine as _};
    use crate::providers::ImagePart;
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    let messages = db::list_messages(&conn, conversation_id)?;
    Ok(messages
        .into_iter()
        .map(|m| {
            let mut text_prefix = String::new();
            let mut images: Vec<ImagePart> = Vec::new();
            for a in &m.attachments {
                if let Some(path) = &a.image_file {
                    match std::fs::read(path) {
                        Ok(bytes) => images.push(ImagePart {
                            media_type: a
                                .image_media_type
                                .clone()
                                .unwrap_or_else(|| "image/png".to_string()),
                            data_base64: general_purpose::STANDARD.encode(&bytes),
                        }),
                        Err(_) => {
                            text_prefix.push_str(&format!(
                                "[Adjunto no disponible: {}]\n\n",
                                a.name
                            ));
                        }
                    }
                } else {
                    text_prefix.push_str(&format!(
                        "[Archivo adjunto: {}]\n{}\n\n",
                        a.name, a.text
                    ));
                }
            }
            let content = if text_prefix.is_empty() {
                m.content
            } else {
                format!("{}{}", text_prefix, m.content)
            };
            ChatMessage {
                role: m.role,
                content,
                images,
            }
        })
        .collect())
}

#[tauri::command]
pub async fn send_message(
    app: tauri::AppHandle,
    conversation_id: String,
    content: String,
    attachments: Option<Vec<db::Attachment>>,
) -> Result<db::Message, String> {
    let attachments = attachments.unwrap_or_default();
    // 1. Guardar el mensaje del usuario.
    let user_message = {
        let state = app.state::<AppState>();
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let msg = db::add_message_with_attachments(
            &conn,
            &conversation_id,
            "user",
            &content,
            None,
            &attachments,
        )?;
        let conv_title: String = conn
            .query_row(
                "SELECT title FROM conversations WHERE id = ?1",
                rusqlite::params![conversation_id],
                |row| row.get(0),
            )
            .unwrap_or_default();
        if conv_title == "Nueva conversación" {
            let short: String = content.chars().take(48).collect();
            let _ = db::rename_conversation(&conn, &conversation_id, short.trim());
        }
        msg
    };

    // 2. Streaming en segundo plano con el historial recién guardado.
    spawn_chat_stream(app, conversation_id)?;
    Ok(user_message)
}

/// Regenera la última respuesta del asistente: la borra y vuelve a streaming
/// con el historial restante (sin añadir un mensaje nuevo del usuario).
#[tauri::command]
pub async fn regenerate_response(
    app: tauri::AppHandle,
    conversation_id: String,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::delete_last_assistant_message(&conn, &conversation_id)?;
    }
    spawn_chat_stream(app, conversation_id)
}

/// Borra todos los mensajes de una conversación (More → Limpiar conversación),
/// conservando la conversación misma.
#[tauri::command]
pub fn clear_conversation_messages(
    app: State<AppState>,
    conversation_id: String,
) -> Result<(), String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    let images = db::conversation_image_files(&conn, &conversation_id)?;
    db::clear_messages(&conn, &conversation_id)?;
    remove_image_files(images);
    Ok(())
}

/// Máximo de bytes que se leen de un archivo adjunto de texto (M2).
const ATTACHMENT_MAX_BYTES: usize = 200_000;
const ATTACHMENT_IMAGE_EXTS: [&str; 7] =
    ["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico"];

/// Lee un archivo elegido por el usuario como texto para adjuntarlo a un mensaje.
/// Solo texto: las imágenes (payload multimodal) y los binarios se rechazan con
/// un aviso explícito. El contenido se trunca para no comerse la ventana de contexto.
#[tauri::command]
pub fn read_attachment(path: String) -> Result<db::Attachment, String> {
    let canonical = std::path::Path::new(&path)
        .canonicalize()
        .map_err(|_| "No se encontró el archivo.".to_string())?;
    if !canonical.is_file() {
        return Err("La ruta seleccionada no es un archivo.".into());
    }
    let name = canonical
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "archivo".to_string());
    let ext = canonical
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    if ATTACHMENT_IMAGE_EXTS.contains(&ext.as_str()) {
        return Err(format!(
            "«{name}» es una imagen. Adjuntar imágenes llegará en una próxima \
             versión; por ahora puedes adjuntar solo archivos de texto."
        ));
    }
    let bytes = std::fs::read(&canonical).map_err(|e| format!("No se pudo leer: {e}"))?;
    if bytes.contains(&0) {
        return Err(format!(
            "«{name}» parece un archivo binario y no se puede adjuntar como texto."
        ));
    }
    let truncated = bytes.len() > ATTACHMENT_MAX_BYTES;
    let slice = &bytes[..bytes.len().min(ATTACHMENT_MAX_BYTES)];
    let mut text = String::from_utf8_lossy(slice).into_owned();
    if truncated {
        text.push_str("\n\n[... el archivo se truncó por tamaño ...]");
    }
    Ok(db::Attachment::text(name, text))
}

/// Máximo de bytes de una imagen adjunta (M3), antes de copiarla a disco.
const IMAGE_MAX_BYTES: usize = 4 * 1024 * 1024;

/// Guarda una imagen elegida por el usuario en `data_dir/attachments` y devuelve
/// la referencia (no el binario) para adjuntarla al mensaje. Solo formatos de
/// visión comunes y tamaño acotado; el base64 se genera al construir el payload.
#[tauri::command]
pub fn save_image_attachment(
    app: State<AppState>,
    path: String,
) -> Result<db::Attachment, String> {
    let canonical = std::path::Path::new(&path)
        .canonicalize()
        .map_err(|_| "No se encontró el archivo.".to_string())?;
    if !canonical.is_file() {
        return Err("La ruta seleccionada no es un archivo.".into());
    }
    let ext = canonical
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    let media_type = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => {
            return Err(
                "Formato de imagen no soportado. Usa PNG, JPG, GIF o WEBP.".into(),
            )
        }
    };
    let bytes = std::fs::read(&canonical).map_err(|e| format!("No se pudo leer: {e}"))?;
    if bytes.len() > IMAGE_MAX_BYTES {
        return Err(format!(
            "La imagen pesa {} MB; el máximo es 4 MB.",
            (bytes.len() as f64 / 1_048_576.0 * 10.0).round() / 10.0
        ));
    }
    let dir = app.data_dir.join("attachments");
    std::fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear la carpeta: {e}"))?;
    let dest = dir.join(format!("{}.{}", uuid::Uuid::new_v4(), ext));
    std::fs::write(&dest, &bytes).map_err(|e| format!("No se pudo guardar la imagen: {e}"))?;
    let name = canonical
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| dest.display().to_string());
    Ok(db::Attachment {
        name,
        text: String::new(),
        image_media_type: Some(media_type.to_string()),
        image_file: Some(dest.display().to_string()),
    })
}

/// Borra del disco las imágenes referenciadas (ignora errores: pueden faltar).
fn remove_image_files(paths: Vec<String>) {
    for p in paths {
        let _ = std::fs::remove_file(p);
    }
}

/// Exporta una conversación a Markdown o JSON en la ruta elegida por el usuario.
/// El diálogo de guardado lo hace el frontend (plugin de diálogo); aquí solo se
/// serializa y se escribe el archivo.
#[tauri::command]
pub fn export_conversation(
    app: State<AppState>,
    conversation_id: String,
    path: String,
    format: String,
) -> Result<(), String> {
    let (title, messages) = {
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        let conv = db::get_conversation(&conn, &conversation_id)?;
        let msgs = db::list_messages(&conn, &conversation_id)?;
        (conv.title, msgs)
    };

    let content = match format.as_str() {
        "json" => {
            let items: Vec<serde_json::Value> = messages
                .iter()
                .map(|m| {
                    let atts: Vec<&str> = m.attachments.iter().map(|a| a.name.as_str()).collect();
                    serde_json::json!({
                        "role": m.role,
                        "content": m.content,
                        "provider": m.provider,
                        "createdAt": m.created_at,
                        "attachments": atts,
                    })
                })
                .collect();
            let doc = serde_json::json!({ "title": title, "messages": items });
            serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?
        }
        _ => {
            let mut md = String::new();
            md.push_str(&format!("# {}\n\n", title));
            for m in &messages {
                let label = if m.role == "user" { "Usuario" } else { "Asistente" };
                let mut heading = format!("### {label}");
                if let Some(p) = &m.provider {
                    heading.push_str(&format!(" · {p}"));
                }
                md.push_str(&heading);
                md.push('\n');
                if !m.attachments.is_empty() {
                    let names: Vec<&str> = m.attachments.iter().map(|a| a.name.as_str()).collect();
                    md.push_str(&format!("> Adjuntos: {}\n", names.join(", ")));
                }
                md.push_str(m.content.trim());
                md.push_str("\n\n");
            }
            md
        }
    };

    std::fs::write(&path, content).map_err(|e| format!("No se pudo escribir el archivo: {e}"))?;
    Ok(())
}

/// Prompt de sistema del modo código.
const CODE_MODE_PROMPT: &str = "Modo código activo: responde como ingeniero senior. Ve directo \
 al código que funciona, sin preámbulos. Entrega bloques completos y ejecutables, indica la ruta \
 del archivo cuando sea relevante y señala las suposiciones que hagas. Si hay un error, explica \
 la causa raíz en una línea antes del arreglo. Prefiere la solución más simple y las dependencias \
 que ya existen en el proyecto antes de proponer nuevas.";

/// Lanza el streaming del proveedor para la conversación y emite chat:*.
fn spawn_chat_stream(app: tauri::AppHandle, conversation_id: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    let provider = state::build_provider(&state)?;
    let prompt = history(&state, &conversation_id)?;
    let settings = state::load_settings(&state);
    let provider_name = provider.name().to_string();

    let (tx, mut rx) = tokio::sync::mpsc::channel::<StreamDelta>(64);
    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel::<()>();
    state
        .chat_runs
        .lock()
        .map_err(|e| e.to_string())?
        .insert(conversation_id.clone(), cancel_tx);

    let conv_id = conversation_id.clone();
    let app_for_task = app.clone();

    tauri::async_runtime::spawn(async move {
        let state = app_for_task.state::<AppState>();
        let mut messages = prompt;

        let mut system = String::new();
        let name = settings.assistant_name.trim();
        if !name.is_empty() {
            system.push_str(&format!("El usuario prefiere que lo llames «{name}».\n"));
        }
        if settings.code_mode {
            system.push_str(CODE_MODE_PROMPT);
        }
        let system = system.trim();
        if !system.is_empty() {
            messages.insert(
                0,
                ChatMessage {
                    role: "system".into(),
                    content: system.to_string(),
                    images: Vec::new(),
                },
            );
        }

        // La búsqueda web va antes de generar: un modelo local no tiene datos
        // frescos y sin esto alucina fechas. Si falla, se responde igual.
        let mut web_sources: Vec<db::WebSource> = Vec::new();
        if settings.web_search {
            let query = messages
                .iter()
                .rev()
                .find(|m| m.role == "user")
                .map(|m| m.content.clone())
                .unwrap_or_default();
            if !query.trim().is_empty() {
                let _ = app_for_task.emit(
                    "chat:status",
                    StatusPayload {
                        conversation_id: conv_id.clone(),
                        phase: "searching".into(),
                        detail: None,
                    },
                );
                match web::search_web(&query).await {
                    Ok(results) if !results.is_empty() => {
                        let after_system = messages
                            .iter()
                            .take_while(|m| m.role == "system")
                            .count();
                        messages.insert(
                            after_system,
                            ChatMessage {
                                role: "system".into(),
                                content: web::as_context(&results, &query),
                                images: Vec::new(),
                            },
                        );
                        web_sources = results;
                    }
                    Ok(_) => {
                        let _ = app_for_task.emit(
                            "chat:status",
                            StatusPayload {
                                conversation_id: conv_id.clone(),
                                phase: "search-empty".into(),
                                detail: Some("La búsqueda no devolvió resultados.".into()),
                            },
                        );
                    }
                    Err(e) => {
                        let _ = app_for_task.emit(
                            "chat:status",
                            StatusPayload {
                                conversation_id: conv_id.clone(),
                                phase: "search-failed".into(),
                                detail: Some(e),
                            },
                        );
                    }
                }
            }
        }

        let mut full = String::new();
        let mut reasoning = String::new();
        let mut thinking_ms: Option<i64> = None;
        let started = std::time::Instant::now();
        let mut forward_error: Option<String> = None;
        let mut cancelled = false;

        let stream_task = tauri::async_runtime::spawn(async move {
            provider.stream_response(messages, tx).await
        });

        let mut cancel_rx = cancel_rx;
        loop {
            tokio::select! {
                next = rx.recv() => {
                    match next {
                        Some(StreamDelta::Text(delta)) => {
                            // El tiempo de pensamiento se mide hasta el primer
                            // carácter visible; si no hubo razonamiento, no hay nada.
                            if thinking_ms.is_none() && !reasoning.is_empty() {
                                thinking_ms = Some(started.elapsed().as_millis() as i64);
                            }
                            full.push_str(&delta);
                            let _ = app_for_task.emit(
                                "chat:chunk",
                                ChunkPayload {
                                    conversation_id: conv_id.clone(),
                                    delta,
                                },
                            );
                        }
                        Some(StreamDelta::Reasoning(delta)) => {
                            reasoning.push_str(&delta);
                            let _ = app_for_task.emit(
                                "chat:reasoning",
                                ReasoningPayload {
                                    conversation_id: conv_id.clone(),
                                    delta,
                                },
                            );
                        }
                        None => break,
                    }
                }
                // Solo cuenta una cancelación explícita; si el emisor se cierra
                // sin cancelar, la rama se deshabilita y seguimos leyendo.
                Ok(()) = &mut cancel_rx => {
                    cancelled = true;
                    break;
                }
            }
        }
        // Soltamos el receptor: el lector SSE aborta el stream HTTP al no poder
        // seguir enviando, que es lo que corta la generación en el servidor.
        drop(rx);
        state.chat_runs.lock().ok().and_then(|mut runs| runs.remove(&conv_id));

        if !cancelled {
            match stream_task.await {
                Ok(Ok(())) => {}
                Ok(Err(e)) => forward_error = Some(e.to_string()),
                Err(e) => forward_error = Some(format!("La tarea de streaming falló: {e}")),
            }
        }

        match forward_error {
            None => {
                // Al detener a mitad de respuesta se conserva lo ya generado.
                if cancelled && full.trim().is_empty() {
                    let _ = app_for_task.emit(
                        "chat:cancelled",
                        CancelledPayload {
                            conversation_id: conv_id,
                        },
                    );
                    return;
                }
                let saved = {
                    let conn = state.db.lock().map_err(|e| e.to_string()).ok();
                    let meta = db::AssistantMeta {
                        reasoning: (!reasoning.trim().is_empty()).then_some(reasoning),
                        thinking_ms,
                        web_sources,
                        ..Default::default()
                    };
                    match conn {
                        Some(conn) => db::add_message_detailed(
                            &conn,
                            &conv_id,
                            "assistant",
                            &full,
                            Some(&provider_name),
                            &meta,
                        ),
                        None => Err("Base de datos no disponible".to_string()),
                    }
                };
                match saved {
                    Ok(message) => {
                        let _ = app_for_task.emit(
                            "chat:done",
                            DonePayload {
                                conversation_id: conv_id,
                                message,
                            },
                        );
                    }
                    Err(e) => {
                        let _ = app_for_task.emit(
                            "chat:error",
                            ErrorPayload {
                                conversation_id: conv_id,
                                message: format!("No se pudo guardar la respuesta: {e}"),
                            },
                        );
                    }
                }
            }
            Some(message) => {
                let _ = app_for_task
                    .emit("chat:error", ErrorPayload { conversation_id: conv_id, message });
            }
        }
    });

    Ok(())
}

/// Detiene el streaming de chat en curso: se guarda lo generado hasta ahora.
#[tauri::command]
pub fn cancel_chat_stream(app: State<AppState>, conversation_id: String) -> Result<(), String> {
    let sender = app
        .chat_runs
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&conversation_id);
    match sender {
        Some(sender) => {
            // Un error aquí significa que la tarea ya terminó; no hay nada que cancelar.
            let _ = sender.send(());
            Ok(())
        }
        None => Err("No hay ninguna respuesta en curso que detener.".into()),
    }
}

// ---------- Fase 2: modo trabajo ----------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

fn register_project(app: &AppState, path: &str) -> Result<db::Project, String> {
    let mut root = std::path::Path::new(path)
        .canonicalize()
        .map_err(|e| format!("No se pudo abrir la carpeta: {e}"))?;
    // Si llegó un archivo en vez de una carpeta, se registra su carpeta padre
    // para que el proyecto se nombre por la carpeta y no por el archivo.
    if root.is_file() {
        root = root
            .parent()
            .ok_or("No se pudo determinar la carpeta del proyecto.")?
            .to_path_buf();
    }
    if !root.is_dir() {
        return Err("La ruta seleccionada no es una carpeta.".into());
    }
    let name = root
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| root.display().to_string());
    // Antes de bloquear la conexión: load_settings usa el mismo mutex.
    let level = state::normalize_approval_level(
        &state::load_settings(app).default_approval_level,
    );
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    let project =
        db::create_project(&conn, &name, &root.display().to_string(), &level)?;
    db::touch_project(&conn, &project.id)?;
    Ok(project)
}

/// Registra en la base de datos una carpeta ya existente como proyecto.
/// La selección de carpeta la hace el frontend con el plugin de diálogo.
#[tauri::command]
pub fn open_project(app: State<AppState>, path: String) -> Result<db::Project, String> {
    register_project(&app, &path)
}

/// Crea una carpeta nueva de proyecto y la registra.
#[tauri::command]
pub fn create_project(
    app: State<AppState>,
    parent_path: String,
    name: String,
) -> Result<db::Project, String> {
    let name = name.trim();
    if name.is_empty() || name.contains(['/', '\\']) {
        return Err("Nombre de proyecto inválido.".into());
    }
    let new_dir = std::path::Path::new(&parent_path).join(name);
    std::fs::create_dir_all(&new_dir)
        .map_err(|e| format!("No se pudo crear la carpeta: {e}"))?;
    register_project(&app, &new_dir.display().to_string())
}

#[tauri::command]
pub fn list_projects(app: State<AppState>) -> Result<Vec<db::Project>, String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::list_projects(&conn)
}

#[tauri::command]
pub fn delete_project(app: State<AppState>, project_id: String) -> Result<(), String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::delete_project(&conn, &project_id)
}

/// Lista un nivel del árbol de archivos del proyecto (ruta relativa; "" = raíz).
#[tauri::command]
pub fn list_project_dir(
    app: State<AppState>,
    project_id: String,
    relative_path: String,
) -> Result<Vec<FileEntry>, String> {
    let root = {
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        PathBuf::from(db::get_project(&conn, &project_id)?.root_path)
    };
    let resolved = crate::agent::tools::resolve_in_project(&root, &relative_path)
        .map_err(|e| e.to_string())?;
    let entries = std::fs::read_dir(&resolved).map_err(|e| e.to_string())?;
    let root_str = root.display().to_string();
    let mut out: Vec<FileEntry> = entries
        .flatten()
        .map(|e| {
            let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
            let full = e.path().display().to_string();
            let rel = full.strip_prefix(&root_str).unwrap_or(&full).trim_start_matches(['\\', '/']).to_string();
            FileEntry {
                name: e.file_name().to_string_lossy().into_owned(),
                path: rel,
                is_dir,
            }
        })
        .collect();
    out.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    out.truncate(500);
    Ok(out)
}

/// Busca archivos por nombre (sin distinguir mayúsculas) dentro del proyecto.
#[tauri::command]
pub async fn search_project_files(
    app: State<'_, AppState>,
    project_id: String,
    query: String,
) -> Result<Vec<String>, String> {
    let root = {
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        PathBuf::from(db::get_project(&conn, &project_id)?.root_path)
    };
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Ok(Vec::new());
    }
    tauri::async_runtime::spawn_blocking(move || {
        const SKIP_DIRS: [&str; 5] = ["node_modules", "target", "dist", "build", ".git"];
        let mut out: Vec<String> = Vec::new();
        let mut stack = vec![root.clone()];
        let mut visited = 0usize;
        while let Some(dir) = stack.pop() {
            if out.len() >= 100 || visited >= 20_000 {
                break;
            }
            let Ok(read_dir) = std::fs::read_dir(&dir) else { continue };
            for entry in read_dir.flatten() {
                visited += 1;
                let name = entry.file_name().to_string_lossy().into_owned();
                let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
                if is_dir {
                    if name.starts_with('.') || SKIP_DIRS.contains(&name.as_str()) {
                        continue;
                    }
                    stack.push(entry.path());
                } else if name.to_lowercase().contains(&needle) {
                    if let Ok(rel) = entry.path().strip_prefix(&root) {
                        out.push(rel.to_string_lossy().replace('\\', "/"));
                    }
                    if out.len() >= 100 {
                        break;
                    }
                }
            }
        }
        out.sort();
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn get_tasks(app: State<AppState>, conversation_id: String) -> Result<Vec<db::Task>, String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::list_tasks(&conn, &conversation_id)
}

/// Lanza el loop del agente para una sesión de trabajo.
#[tauri::command]
pub async fn start_work_task(
    app: tauri::AppHandle,
    conversation_id: String,
    project_id: String,
    request: String,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    let (root, approval_level) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let project = db::get_project(&conn, &project_id)?;
        db::add_message(&conn, &conversation_id, "user", &request, Some("agent"))?;
        let title: String = conn
            .query_row(
                "SELECT title FROM conversations WHERE id = ?1",
                rusqlite::params![conversation_id],
                |row| row.get(0),
            )
            .unwrap_or_default();
        if title == "Sesión de trabajo" {
            let short: String = request.chars().take(48).collect();
            let _ = db::rename_conversation(&conn, &conversation_id, short.trim());
        }
        db::touch_project(&conn, &project_id)?;
        (PathBuf::from(project.root_path), project.approval_level)
    };
    let assistant_name = state::load_settings(&state).assistant_name;

    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel::<()>();
    state
        .work_runs
        .lock()
        .map_err(|e| e.to_string())?
        .insert(conversation_id.clone(), cancel_tx);

    let app_for_task = app.clone();
    tauri::async_runtime::spawn(async move {
        crate::agent::loop_runner::run_work_task(
            app_for_task,
            conversation_id,
            root,
            approval_level,
            assistant_name,
            request,
            cancel_rx,
        )
        .await;
    });
    Ok(())
}

/// Cambia el nivel de aprobación de un proyecto (config por proyecto).
#[tauri::command]
pub fn set_project_approval_level(
    app: State<AppState>,
    project_id: String,
    level: String,
) -> Result<(), String> {
    const VALID: [&str; 4] = ["ask_always", "approve_for_me", "auto_sandbox", "full_access"];
    if !VALID.contains(&level.as_str()) {
        return Err(format!("Nivel de aprobación desconocido: {level}"));
    }
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::set_project_approval_level(&conn, &project_id, &level)
}

/// Pide cancelar una tarea del agente en curso.
#[tauri::command]
pub fn cancel_work_task(app: State<AppState>, conversation_id: String) -> Result<(), String> {
    let sender = app
        .work_runs
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&conversation_id);
    match sender {
        Some(tx) => {
            let _ = tx.send(());
            Ok(())
        }
        None => Err("No hay ninguna tarea en curso para esa sesión.".into()),
    }
}

/// Aprobar o rechazar una tool call pendiente.
#[tauri::command]
pub fn respond_to_approval(
    app: State<AppState>,
    tool_call_id: String,
    approved: bool,
) -> Result<(), String> {
    let sender = app
        .approvals
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&tool_call_id)
        .ok_or("No hay una aprobación pendiente con ese id (pudo expirar).")?;
    let _ = sender.send(approved);
    Ok(())
}

/// Indica si el proveedor/modelo activo soporta tool calling (modo trabajo).
#[tauri::command]
pub async fn check_tool_support(app: State<'_, AppState>) -> Result<bool, String> {
    let settings = state::load_settings(&app);
    match settings.active_provider.as_str() {
        "anthropic" | "openai" => Ok(true),
        "local" => Ok(crate::providers::tool_calling::local_supports_tools(
            &settings.local_endpoint,
            &settings.local_model,
        )
        .await),
        other => Err(format!("Proveedor desconocido: {other}")),
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitInfo {
    pub is_repo: bool,
    pub branch: Option<String>,
    pub dirty_count: usize,
}

/// Estado git del proyecto para la cabecera de la vista de trabajo.
#[tauri::command]
pub async fn project_git_info(
    app: State<'_, AppState>,
    project_id: String,
) -> Result<GitInfo, String> {
    let root = {
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        PathBuf::from(db::get_project(&conn, &project_id)?.root_path)
    };
    let info = tauri::async_runtime::spawn_blocking(move || {
        use crate::agent::tools::git;
        if !git::is_git_repo(&root) {
            return GitInfo {
                is_repo: false,
                branch: None,
                dirty_count: 0,
            };
        }
        let (branch, dirty_count) = git::repo_summary(&root).unwrap_or_default();
        GitInfo {
            is_repo: true,
            branch: Some(branch),
            dirty_count,
        }
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(info)
}

// ---------- Fase 4: Ajustes → Sistema y Datos (solo lectura) ----------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    pub db_path: String,
    pub db_size_bytes: u64,
    pub attachments_path: String,
    pub attachments_size_bytes: u64,
    pub attachments_count: usize,
    pub counts: db::Counts,
}

/// Suma el peso de un árbol de archivos; se usa solo con la carpeta de adjuntos.
fn dir_size(path: &std::path::Path) -> (u64, usize) {
    let mut bytes = 0u64;
    let mut files = 0usize;
    let Ok(entries) = std::fs::read_dir(path) else {
        return (0, 0);
    };
    for entry in entries.flatten() {
        let child = entry.path();
        if child.is_dir() {
            let (b, f) = dir_size(&child);
            bytes += b;
            files += f;
        } else if let Ok(meta) = child.metadata() {
            bytes += meta.len();
            files += 1;
        }
    }
    (bytes, files)
}

/// Dónde vive lo que Hatboo guarda en este PC y cuánto ocupa.
#[tauri::command]
pub fn get_storage_info(app: State<AppState>) -> Result<StorageInfo, String> {
    let db_path = app.data_dir.join("hatboo.db");
    let db_size_bytes = db_path
        .metadata()
        .map(|m| m.len())
        .unwrap_or(0);
    let attachments_dir = app.data_dir.join("attachments");
    let (attachments_size_bytes, attachments_count) = dir_size(&attachments_dir);
    let counts = {
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        db::table_counts(&conn)?
    };
    Ok(StorageInfo {
        db_path: db_path.display().to_string(),
        db_size_bytes,
        attachments_path: attachments_dir.display().to_string(),
        attachments_size_bytes,
        attachments_count,
        counts,
    })
}
