use crate::backup;
use crate::db;
use crate::providers::{self, ChatMessage, StreamDelta};
use crate::state::{self, AppState, Settings};
use crate::web;
use serde::Serialize;
use std::path::{Path, PathBuf};
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

/// Fijar y archivar comparten comando porque salen del mismo menú y cada opción
/// cambia una sola de las dos cosas.
#[tauri::command]
pub fn set_conversation_flags(
    app: State<AppState>,
    conversation_id: String,
    pinned: Option<bool>,
    archived: Option<bool>,
) -> Result<(), String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::set_conversation_flags(&conn, &conversation_id, pinned, archived)
}

#[tauri::command]
pub fn search_chats(
    app: State<AppState>,
    query: String,
) -> Result<Vec<db::SearchHit>, String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::search_chats(&conn, &query)
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

// ---------- Plantillas de comportamiento (Agent Skills) ----------

/// Lo que envía la interfaz para crear o editar una plantilla. Con `id` vacío se
/// crea una nueva; el resto de campos los normaliza `db::save_skill`.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillDraft {
    #[serde(default)]
    pub id: String,
    pub name: String,
    pub prompt: String,
    #[serde(default)]
    pub enabled: bool,
}

#[tauri::command]
pub fn list_skills(app: State<AppState>) -> Result<Vec<db::Skill>, String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::list_skills(&conn)
}

#[tauri::command]
pub fn save_skill(app: State<AppState>, skill: SkillDraft) -> Result<db::Skill, String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    let draft = db::Skill {
        id: skill.id,
        name: skill.name,
        prompt: skill.prompt,
        enabled: skill.enabled,
        created_at: 0,
    };
    db::save_skill(&conn, &draft)
}

#[tauri::command]
pub fn set_skill_enabled(app: State<AppState>, id: String, enabled: bool) -> Result<(), String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::set_skill_enabled(&conn, &id, enabled)
}

#[tauri::command]
pub fn delete_skill(app: State<AppState>, id: String) -> Result<(), String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::delete_skill(&conn, &id)
}

/// Lista los modelos instalados en un servidor Ollama para el selector de Ajustes.
#[tauri::command]
pub async fn list_local_models(endpoint: String) -> Result<Vec<String>, String> {
    providers::list_ollama_models(&endpoint).await
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PullProgress {
    model: String,
    estado: String,
    /// 0..100; Ollama manda `total` y `completed` en bytes.
    porcentaje: u8,
    terminado: bool,
    error: Option<String>,
}

/// Descarga un modelo de Ollama y va contando el progreso por evento.
/// `/api/pull` responde NDJSON y cierra al terminar, así que no hace falta
/// sondear: lo que llega aquí es literalmente lo que Ollama va diciendo.
#[tauri::command]
pub async fn pull_model(
    app: tauri::AppHandle,
    endpoint: String,
    name: String,
) -> Result<(), String> {
    use futures_util::StreamExt;
    use tauri::Emitter;

    let nombre = name.trim().to_string();
    if nombre.is_empty() || nombre.len() > 120 {
        return Err("Ese nombre de modelo no vale.".into());
    }
    let url = format!("{}/api/pull", endpoint.trim_end_matches('/'));
    let cliente = reqwest::Client::builder()
        // Sin timeout global: una descarga de varios GB puede tardar lo que tarde.
        .connect_timeout(std::time::Duration::from_secs(6))
        .build()
        .map_err(|e| e.to_string())?;

    let respuesta = cliente
        .post(&url)
        .json(&serde_json::json!({ "name": nombre }))
        .send()
        .await
        .map_err(|e| format!("No se pudo conectar con Ollama: {e}"))?;
    let estado = respuesta.status();
    if !estado.is_success() {
        return Err(format!("Ollama respondió {estado}."));
    }

    let emitir = |modelo: &str, estado: &str, porcentaje: u8, terminado: bool, error: Option<String>| {
        let _ = app.emit(
            "ollama:pull",
            PullProgress {
                model: modelo.to_string(),
                estado: estado.to_string(),
                porcentaje,
                terminado,
                error,
            },
        );
    };

    let mut resto = Vec::new();
    let mut flujo = respuesta.bytes_stream();
    while let Some(trozo) = flujo.next().await {
        let trozo = match trozo {
            Ok(b) => b,
            Err(e) => {
                emitir(&nombre, "error", 0, true, Some(format!("La descarga se cortó: {e}")));
                return Err(format!("La descarga se cortó: {e}"));
            }
        };
        resto.extend_from_slice(&trozo);
        while let Some(pos) = resto.iter().position(|b| *b == b'\n') {
            let linea: Vec<u8> = resto.drain(..=pos).collect();
            let Ok(valor) = serde_json::from_slice::<serde_json::Value>(&linea) else {
                continue;
            };
            if let Some(err) = valor["error"].as_str() {
                emitir(&nombre, "error", 0, true, Some(err.to_string()));
                return Err(err.to_string());
            }
            let estado = valor["status"].as_str().unwrap_or("").to_string();
            let total = valor["total"].as_i64().unwrap_or(0);
            let hecho = valor["completed"].as_i64().unwrap_or(0);
            let porcentaje = if total > 0 {
                ((hecho as f64 / total as f64) * 100.0).round().clamp(0.0, 100.0) as u8
            } else {
                0
            };
            let fin = estado.eq_ignore_ascii_case("success");
            emitir(&nombre, &estado, porcentaje, fin, None);
        }
    }
    emitir(&nombre, "success", 100, true, None);
    Ok(())
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

/// Edita un mensaje ya enviado por el usuario: se corta todo lo posterior y se
/// vuelve a generar la respuesta desde ahí (como en ChatGPT).
#[tauri::command]
pub async fn edit_user_message(
    app: tauri::AppHandle,
    conversation_id: String,
    message_id: String,
    content: String,
) -> Result<(), String> {
    let content = content.trim().to_string();
    if content.is_empty() {
        return Err("El mensaje no puede quedar vacío.".into());
    }
    let state = app.state::<AppState>();
    if state
        .chat_runs
        .lock()
        .map_err(|e| e.to_string())?
        .contains_key(&conversation_id)
    {
        return Err("Espera a que termine la respuesta en curso.".into());
    }
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let (conv_id, role, created_at) = db::message_position(&conn, &message_id)?;
        if conv_id != conversation_id {
            return Err("Ese mensaje no pertenece a esta conversación.".into());
        }
        if role != "user" {
            return Err("Solo se editan los mensajes que enviaste tú.".into());
        }
        db::update_message_content(&conn, &message_id, &content)?;
        remove_image_files(db::truncate_messages_after(&conn, &conversation_id, created_at)?);
    }
    spawn_chat_stream(app, conversation_id)
}

/// Puntúa una respuesta del asistente (`"up"` / `"down"`); `None` la quita.
#[tauri::command]
pub fn set_message_feedback(
    app: State<AppState>,
    message_id: String,
    feedback: Option<String>,
) -> Result<(), String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::set_message_feedback(&conn, &message_id, feedback.as_deref())
}

/// Copia las imágenes que entran en la rama a archivos nuevos. Si la rama
/// apuntara a los mismos ficheros, borrar una de las dos conversaciones se
/// llevaría las imágenes de la otra (`delete_conversation` limpia disco).
#[tauri::command]
pub fn branch_conversation(
    app: State<AppState>,
    conversation_id: String,
    up_to_message_id: String,
) -> Result<db::Conversation, String> {
    let imagenes = {
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        let todos = db::list_messages(&conn, &conversation_id)?;
        let hasta = todos
            .iter()
            .position(|m| m.id == up_to_message_id)
            .ok_or("Ese mensaje no es de esta conversación.")?;
        todos[..=hasta]
            .iter()
            .flat_map(|m| m.attachments.iter())
            .filter_map(|a| a.image_file.clone())
            .collect::<Vec<_>>()
    };

    let dir = app.data_dir.join("attachments");
    let mut renombre = std::collections::HashMap::new();
    for viejo in &imagenes {
        if renombre.contains_key(viejo) {
            continue;
        }
        let destino = format!(
            "{}{}",
            uuid::Uuid::new_v4(),
            std::path::Path::new(viejo)
                .extension()
                .map(|e| format!(".{}", e.to_string_lossy()))
                .unwrap_or_default()
        );
        std::fs::copy(dir.join(viejo), dir.join(&destino))
            .map_err(|e| format!("No se pudo copiar una imagen de la rama: {e}"))?;
        renombre.insert(viejo.clone(), destino);
    }

    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::branch_conversation(&conn, &conversation_id, &up_to_message_id, &renombre)
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
            "«{name}» es una imagen y esta ruta solo lee texto. Para adjuntar una \
             imagen usa la opción «Imagen» del menú, que va por otro camino."
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

/// Hosts de los que se puede leer. Lista cerrada a propósito: la URL la pega el
/// usuario y sin esto esto sería un `fetch` arbitrario desde la máquina, con
/// `http://localhost:11434` o el endpoint de metadatos de la nube incluidos.
const GITHUB_HOSTS: [&str; 3] = [
    "github.com",
    "raw.githubusercontent.com",
    "gist.githubusercontent.com",
];

/// Divide una URL en (host, resto) sin crate `url`, como en `web.rs`.
fn partir_url(url: &str) -> Option<(&str, &str)> {
    let resto = url.strip_prefix("https://").or_else(|| url.strip_prefix("http://"))?;
    let (host, camino) = resto.split_once('/')?;
    Some((host.split(':').next()?, camino))
}

fn sin_query(s: &str) -> &str {
    s.split('?').next().unwrap_or(s)
}

/// Convierte la URL que pega el usuario en la URL cruda que hay que pedir y el
/// nombre con el que se etiqueta el adjunto. `None` si no es una forma que
/// reconocemos.
fn github_a_cruda(url: &str) -> Option<(String, String)> {
    let (host, camino) = partir_url(url)?;
    if !GITHUB_HOSTS.contains(&host) {
        return None;
    }
    // El query se quita aquí, una vez: si no, `?plain=1` de una URL de GitHub se
    // colaría en la ruta de raw y el archivo no aparecería.
    let camino = sin_query(camino);
    let tramos: Vec<&str> = camino.split('/').collect();
    match host {
        "github.com" => {
            // github.com/<owner>/<repo>/blob/<ref>/<path...>
            if tramos.len() >= 5 && tramos[2] == "blob" {
                let (owner, repo, _ref, ruta) = (tramos[0], tramos[1], tramos[3], &tramos[4..]);
                let ruta = ruta.join("/");
                let nombre = ruta.split('/').next_back()?.to_string();
                Some((
                    format!("https://raw.githubusercontent.com/{owner}/{repo}/{_ref}/{ruta}"),
                    nombre,
                ))
            } else if tramos.len() == 2 {
                // Raíz del repo: se pide su README por la API.
                Some((
                    format!("https://api.github.com/repos/{}/{}/readme", tramos[0], tramos[1]),
                    "README.md".to_string(),
                ))
            } else {
                None
            }
        }
        // raw.githubusercontent.com/<owner>/<repo>/<ref>/<path...>
        // gist.githubusercontent.com/<id>/<raw>/<archivo>
        _ => {
            let ruta = camino.rsplit('/').next().filter(|s| !s.is_empty())?;
            Some((format!("https://{host}/{camino}"), ruta.to_string()))
        }
    }
}

/// Lee un archivo de GitHub como contexto de texto, sin clonar el repo.
/// Es solo lectura y solo hacia github.com; lo que se obtiene entra por la misma
/// ruta que un archivo adjunto del disco.
#[tauri::command]
pub async fn fetch_github(url: String) -> Result<db::Attachment, String> {
    let (destino, nombre) = github_a_cruda(url.trim())
        .ok_or("Esa URL no es de GitHub. Pega la de un archivo (…/blob/main/…) o la raíz de un repo.")?;

    let cliente = reqwest::Client::builder()
        // Sin esto una URL de github.com válida podría redirigir a cualquier
        // host y convertir la lista de arriba en decorado.
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(20))
        .user_agent("hatboo")
        .build()
        .map_err(|e| e.to_string())?;

    let peticion = cliente.get(&destino);
    // La API de README devuelve JSON salvo que se pida el crudo explícitamente.
    let peticion = if destino.starts_with("https://api.github.com/") {
        peticion.header(reqwest::header::ACCEPT, "application/vnd.github.raw")
    } else {
        peticion
    };

    let respuesta = peticion
        .send()
        .await
        .map_err(|e| format!("No se pudo alcanzar GitHub: {e}"))?;
    let estado = respuesta.status();
    if estado == reqwest::StatusCode::NOT_FOUND {
        return Err("Ese archivo no existe en esa rama, o el repo es privado.".into());
    }
    if estado.as_u16() == 403 {
        return Err("GitHub está limitando las peticiones anónimas (403). Inténtalo en un rato o abre el archivo tú mismo y adjúntalo desde el disco.".into());
    }
    if !estado.is_success() {
        return Err(format!("GitHub respondió {estado}."));
    }

    let bytes = respuesta
        .bytes()
        .await
        .map_err(|e| format!("La descarga se cortó: {e}"))?;
    if bytes.contains(&0) {
        return Err(format!("«{nombre}» parece binario y no se puede adjuntar como texto."));
    }
    let corte = bytes.len().min(ATTACHMENT_MAX_BYTES);
    let mut texto = String::from_utf8_lossy(&bytes[..corte]).into_owned();
    if bytes.len() > corte {
        texto.push_str("\n\n[... el archivo se truncó por tamaño ...]");
    }
    Ok(db::Attachment::text(nombre, texto))
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

/// Captura la pantalla principal y la guarda como imagen adjunta, para enseñar
/// un error o una maqueta sin tener que guardar el archivo antes. Sale por el
/// mismo camino que una imagen elegida del disco: `data_dir/attachments` y
/// referencia en el mensaje, nunca el binario en SQLite.
#[tauri::command]
pub fn capture_screen(app: State<AppState>, nombre: String) -> Result<db::Attachment, String> {
    #[cfg(target_os = "windows")]
    {
        use image::ImageEncoder;
        let monitor = xcap::Monitor::all()
            .map_err(|e| format!("No se pudieron listar las pantallas: {e}"))?
            .into_iter()
            .find(|m| m.is_primary().unwrap_or(false))
            .or_else(|| xcap::Monitor::all().ok().and_then(|v| v.into_iter().next()))
            .ok_or("No se encontró ninguna pantalla que capturar.")?;
        let imagen = monitor
            .capture_image()
            .map_err(|e| format!("La captura falló: {e}"))?;

        let mut png: Vec<u8> = Vec::new();
        let codificador = image::codecs::png::PngEncoder::new(&mut png);
        codificador
            .write_image(
                imagen.as_raw(),
                imagen.width(),
                imagen.height(),
                image::ExtendedColorType::Rgba8,
            )
            .map_err(|e| format!("No se pudo codificar el PNG: {e}"))?;
        if png.len() > IMAGE_MAX_BYTES {
            return Err(format!(
                "La captura pesa {} MB; el máximo es 4 MB.",
                (png.len() as f64 / 1_048_576.0 * 10.0).round() / 10.0
            ));
        }

        // El nombre lo pone el frente (ahí sí hay hora local), pero llega por el
        // wire: sin separadores y con .png siempre, que es lo que acabamos de codificar.
        let nombre = {
            let limpio = nombre
                .chars()
                .filter(|c| !matches!(c, '/' | '\\' | ':' | '\0'))
                .collect::<String>();
            let base = limpio.trim_end_matches(".png");
            format!("{}.png", if base.is_empty() { "captura" } else { base })
        };
        let dir = app.data_dir.join("attachments");
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("No se pudo crear la carpeta: {e}"))?;
        let destino = dir.join(format!("{}.png", uuid::Uuid::new_v4()));
        std::fs::write(&destino, &png).map_err(|e| format!("No se pudo guardar: {e}"))?;
        Ok(db::Attachment {
            name: nombre,
            text: String::new(),
            image_media_type: Some("image/png".to_string()),
            image_file: Some(destino.display().to_string()),
        })
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, nombre);
        Err("La captura de pantalla está hecha solo para Windows por ahora.".into())
    }
}

/// Devuelve una imagen adjunta como data URI para poder pintarla en la burbuja.
/// La ruta llega desde la BD —y tras una importación ese JSON es ajeno—, así que
/// se canonicaliza y se exige que siga dentro de `attachments/` antes de leer.
#[tauri::command]
pub fn attachment_image(app: State<AppState>, file: String) -> Result<String, String> {
    image_data_uri(&app.data_dir.join("attachments"), &file)
}

fn image_data_uri(attachments_dir: &Path, file: &str) -> Result<String, String> {
    use base64::{engine::general_purpose, Engine as _};
    let root = attachments_dir
        .canonicalize()
        .map_err(|_| "La carpeta de adjuntos no existe.".to_string())?;
    let path = Path::new(file)
        .canonicalize()
        .map_err(|_| "La imagen ya no está disponible.".to_string())?;
    if !path.starts_with(&root) {
        return Err("Ese archivo no está en la carpeta de adjuntos de Hatboo.".into());
    }
    let media_type = match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => return Err("Formato de imagen no soportado.".into()),
    };
    let bytes = std::fs::read(&path).map_err(|e| format!("No se pudo leer: {e}"))?;
    Ok(format!(
        "data:{media_type};base64,{}",
        general_purpose::STANDARD.encode(&bytes)
    ))
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
        "json" => render_json(&title, &messages),
        _ => render_markdown(&title, &messages),
    };

    std::fs::write(&path, content).map_err(|e| format!("No se pudo escribir el archivo: {e}"))?;
    Ok(())
}

fn render_json(title: &str, messages: &[db::Message]) -> String {
    let items: Vec<serde_json::Value> = messages
        .iter()
        .map(|m| {
            let atts: Vec<&str> = m.attachments.iter().map(|a| a.name.as_str()).collect();
            let mut obj = serde_json::json!({
                "role": m.role,
                "content": m.content,
                "provider": m.provider,
                "createdAt": m.created_at,
                "attachments": atts,
            });
            if let Some(r) = &m.reasoning {
                obj["reasoning"] = serde_json::json!(r);
                obj["thinkingMs"] = serde_json::json!(m.thinking_ms);
            }
            if !m.web_sources.is_empty() {
                obj["webSources"] = serde_json::json!(m.web_sources);
            }
            obj
        })
        .collect();
    let doc = serde_json::json!({ "title": title, "messages": items });
    serde_json::to_string_pretty(&doc).unwrap_or_else(|_| "{}".into())
}

fn render_markdown(title: &str, messages: &[db::Message]) -> String {
    let mut md = format!("# {title}\n\n");
    for m in messages {
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
        if let Some(r) = m.reasoning.as_ref().filter(|r| !r.trim().is_empty()) {
            // En <details> para que al abrir el .md el razonamiento no tape la
            // respuesta: GitHub y VS Code lo renderizan cerrado.
            let dur = m.thinking_ms.map(human_ms).unwrap_or_default();
            md.push_str(&format!(
                "<details><summary>Razonamiento{}</summary>\n\n{}\n\n</details>\n\n",
                dur,
                r.trim()
            ));
        }
        md.push_str(m.content.trim());
        md.push_str("\n\n");
        if !m.web_sources.is_empty() {
            let links: Vec<String> = m
                .web_sources
                .iter()
                .map(|s| format!("[{}]({})", s.title, s.url))
                .collect();
            md.push_str(&format!("Fuentes: {}\n\n", links.join(" · ")));
        }
    }
    md
}

/// Duración legible para el export; devuelve cadena vacía si no hay dato.
fn human_ms(ms: i64) -> String {
    if ms < 1000 {
        format!(" ({ms} ms)")
    } else {
        format!(" ({:.1} s)", ms as f64 / 1000.0)
    }
}

/// Prompt de sistema del modo código. También lo usa el agente del modo trabajo,
/// para que el chip «Código» signifique lo mismo en las dos vistas.
pub(crate) const CODE_MODE_PROMPT: &str = "Modo código activo: responde como ingeniero senior. Ve directo \
 al código que funciona, sin preámbulos. Entrega bloques completos y ejecutables, indica la ruta \
 del archivo cuando sea relevante y señala las suposiciones que hagas. Si hay un error, explica \
 la causa raíz en una línea antes del arreglo. Prefiere la solución más simple y las dependencias \
 que ya existen en el proyecto antes de proponer nuevas.";

/// Archivo de reglas del proyecto: instrucciones que el usuario escribe una vez
/// y se pegan al system prompt del agente en cada sesión de ese proyecto.
pub(crate) const RULES_FILE: &str = "HATBOO.md";
/// Techo de lo que se inyecta en el prompt; más allá de esto ya es un libro y el
/// modelo empieza a perder el hilo.
const RULES_MAX_CHARS: usize = 6_000;
/// Techo de lo que se deja guardar desde la app.
const RULES_SAVE_MAX: usize = 20_000;

/// Contenido de `HATBOO.md` para el system prompt. Cadena vacía si no existe:
/// la mayoría de proyectos no lo tendrán y eso no debe cambiar el prompt.
pub(crate) fn project_rules_for_prompt(root: &Path) -> String {
    match std::fs::read_to_string(root.join(RULES_FILE)) {
        Ok(texto) => texto.chars().take(RULES_MAX_CHARS).collect(),
        Err(_) => String::new(),
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRules {
    pub exists: bool,
    pub content: String,
    pub path: String,
}

/// Ruta de `HATBOO.md` del proyecto. El nombre del archivo es fijo — lo único
/// que viene de fuera es la raíz, que el usuario eligió al abrir el proyecto.
fn rules_path(app: &State<AppState>, project_id: &str) -> Result<PathBuf, String> {
    let root = {
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        db::get_project(&conn, project_id)?.root_path
    };
    Ok(PathBuf::from(root).join(RULES_FILE))
}

#[tauri::command]
pub fn project_rules(
    app: State<AppState>,
    project_id: String,
) -> Result<ProjectRules, String> {
    let ruta = rules_path(&app, &project_id)?;
    Ok(ProjectRules {
        exists: ruta.is_file(),
        content: std::fs::read_to_string(&ruta).unwrap_or_default(),
        path: ruta.display().to_string(),
    })
}

#[tauri::command]
pub fn save_project_rules(
    app: State<AppState>,
    project_id: String,
    content: String,
) -> Result<ProjectRules, String> {
    let ruta = rules_path(&app, &project_id)?;
    let recortado: String = content.chars().take(RULES_SAVE_MAX).collect();
    std::fs::write(&ruta, recortado.as_bytes())
        .map_err(|e| format!("No se pudo escribir {RULES_FILE}: {e}"))?;
    Ok(ProjectRules {
        exists: true,
        content: recortado,
        path: ruta.display().to_string(),
    })
}

/// Lanza el streaming del proveedor para la conversación y emite chat:*.
///
/// Registrar el canal de cancelación es lo único que ocurre antes de devolver:
/// construir el proveedor y leer el historial (que codifica las imágenes adjuntas
/// en base64) se hace dentro de la tarea. Antes se hacían en el propio comando,
/// y eso era el parón que se veía entre pulsar Enviar y ver el mensaje en pantalla.
/// El *system prompt* del chat normal, sin efectos secundarios: lo arma
/// `spawn_chat_stream` y lo mide `context_usage` para el indicador de contexto.
/// Los bloques van en este orden fijo y las plantillas activas al final, de modo
/// que si chocan con el modo código gane lo que el usuario escribió a mano.
fn chat_system_prompt(settings: &state::Settings, skills: &str) -> String {
    let mut system = String::new();
    let name = settings.assistant_name.trim();
    if !name.is_empty() {
        system.push_str(&format!("El usuario prefiere que lo llames «{name}».\n"));
    }
    if settings.code_mode {
        system.push_str(CODE_MODE_PROMPT);
    }
    system.push_str(skills);
    system
}

fn spawn_chat_stream(app: tauri::AppHandle, conversation_id: String) -> Result<(), String> {    let state = app.state::<AppState>();
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

        let (provider, prompt) = match state::build_provider(&state)
            .and_then(|provider| history(&state, &conv_id).map(|prompt| (provider, prompt)))
        {
            Ok(prepared) => prepared,
            Err(e) => {
                state.chat_runs.lock().ok().and_then(|mut r| r.remove(&conv_id));
                let _ = app_for_task.emit(
                    "chat:error",
                    ErrorPayload {
                        conversation_id: conv_id,
                        message: e,
                    },
                );
                return;
            }
        };
        let settings = state::load_settings(&state);
        let provider_name = provider.name().to_string();
        let mut messages = prompt;

        let skills = state
            .db
            .lock()
            .ok()
            .and_then(|conn| db::enabled_skills_prompt(&conn).ok())
            .unwrap_or_default();
        let system = chat_system_prompt(&settings, &skills);
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

/// Resumen de una exportación completa, para mostrarlo en Ajustes → Datos.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSummary {
    pub path: String,
    pub bytes: u64,
    pub conversations: usize,
    pub messages: usize,
    pub images: usize,
}

/// Palabra que la interfaz pide escribir para el restablecimiento de fábrica.
/// Se comprueba también aquí: el borrado no depende solo del frontend.
pub const RESET_TOKEN: &str = "BORRAR TODO";

#[tauri::command]
pub fn export_all_data(app: State<AppState>, path: String) -> Result<ExportSummary, String> {
    let snapshot = {
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        backup::build_snapshot(&conn, &app.data_dir.join("attachments"))?
    };
    backup::write_snapshot(Path::new(&path), &snapshot)?;
    Ok(ExportSummary {
        bytes: std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0),
        path,
        conversations: snapshot.conversations.len(),
        messages: snapshot.messages.len(),
        images: snapshot.images.len(),
    })
}

/// Añade lo que falte de una copia (identificado por `id`): importar dos veces
/// el mismo archivo no duplica nada.
#[tauri::command]
pub fn import_all_data(app: State<AppState>, path: String) -> Result<backup::ImportReport, String> {
    let snapshot = backup::read_snapshot(Path::new(&path))?;
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    backup::apply_snapshot(&conn, &snapshot, &app.data_dir.join("attachments"))
}

/// Deja la app como recién instalada: borra conversaciones, mensajes, proyectos,
/// tareas, ajustes, las imágenes en disco y las claves del llavero.
#[tauri::command]
pub fn factory_reset(app: State<AppState>, token: String) -> Result<(), String> {
    if token.trim() != RESET_TOKEN {
        return Err("Escribe el texto de confirmación tal cual para restablecer.".into());
    }
    {
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        db::wipe_all(&conn)?;
    }
    let attachments = app.data_dir.join("attachments");
    if let Ok(entries) = std::fs::read_dir(&attachments) {
        for entry in entries.flatten() {
            let _ = std::fs::remove_file(entry.path());
        }
    }
    // Las claves viven en el llavero del sistema, no en la base de datos: hay
    // que borrarlas aquí para que el restablecimiento sea de verdad completo.
    for provider in ["anthropic", "openai"] {
        let _ = providers::delete_api_key(provider);
    }
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
    let ruta = root.display().to_string();
    // La carpeta ya está registrada: se reutiliza la fila y solo se mueve al
    // frente del orden. Insertar otra dejaría dos entradas iguales en la barra.
    if let Some(existing) = db::find_project_by_root(&conn, &ruta)? {
        db::touch_project(&conn, &existing.id)?;
        return db::get_project(&conn, &existing.id);
    }
    let project = db::create_project(&conn, &name, &ruta, &level)?;
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CambioSesion {
    pub ruta: String,
    /// El diff de la última vez que se escribió: si el agente reescribió el
    /// archivo tres veces, lo que importa es el estado final.
    pub diff: String,
    pub creado: bool,
    pub escrituras: u32,
}

/// Resumen de lo que el agente cambió en esta sesión de trabajo.
#[tauri::command]
pub fn session_changes(
    app: State<AppState>,
    conversation_id: String,
) -> Result<Vec<CambioSesion>, String> {
    let registros = {
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        db::session_writes(&conn, &conversation_id)?
    };
    // Se agregan por ruta conservando el orden de la primera aparición.
    let mut orden: Vec<String> = Vec::new();
    let mut acumulado: std::collections::HashMap<String, CambioSesion> =
        std::collections::HashMap::new();
    for r in registros {
        let Some(salida) = r.output else { continue };
        let Ok(valor) = serde_json::from_str::<serde_json::Value>(&salida) else {
            continue;
        };
        let Some(ruta) = valor["path"].as_str() else { continue };
        let entrada = acumulado.entry(ruta.to_string()).or_insert_with(|| {
            orden.push(ruta.to_string());
            CambioSesion {
                ruta: ruta.to_string(),
                diff: String::new(),
                creado: false,
                escrituras: 0,
            }
        });
        entrada.diff = valor["diff"].as_str().unwrap_or_default().to_string();
        entrada.creado = valor["created"].as_bool().unwrap_or(false);
        entrada.escrituras += 1;
    }
    Ok(orden
        .into_iter()
        .filter_map(|r| acumulado.remove(&r))
        .collect())
}

/// Lee un archivo del proyecto como texto, para el preview de HTML. Pasa por el
/// mismo `resolve_in_project` que las herramientas del agente, así que una ruta
/// que intente salirse de la carpeta se rechaza igual.
#[tauri::command]
pub fn read_project_file(
    app: State<AppState>,
    project_id: String,
    path: String,
) -> Result<String, String> {
    use crate::agent::tools::resolve_in_project;
    let root = {
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        PathBuf::from(db::get_project(&conn, &project_id)?.root_path)
    };
    let dentro = resolve_in_project(&root, &path).map_err(|e| e.to_string())?;
    let bytes = std::fs::read(&dentro).map_err(|e| format!("No se pudo leer: {e}"))?;
    if bytes.len() > ATTACHMENT_MAX_BYTES {
        return Err("El archivo es demasiado grande para previsualizarlo.".into());
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
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

/// Fija o suelta un proyecto en la barra lateral.
#[tauri::command]
pub fn set_project_pinned(app: State<AppState>, project_id: String, pinned: bool) -> Result<(), String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::set_project_pinned(&conn, &project_id, pinned)
}

/// Fondo translúcido compuesto por el sistema, no por el webview: Mica en la
/// ventana principal, que es lo que Microsoft recomienda para superficies de
/// larga duración (el blur/Acrylic se deja para menús y modales).
///
/// Apagado por defecto y a propósito: la propia documentación de
/// `window-vibrancy` avisa de que va mal al redimensionar o arrastrar la ventana
/// en Windows 11 build 22621+, así que lo decide el usuario viéndolo.
#[tauri::command]
pub fn set_window_transparency(
    window: tauri::Window,
    enabled: bool,
    dark: Option<bool>,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        if enabled {
            // `dark` es el tinte de Mica. Se pasa desde la app porque Hatboo puede
            // estar en claro con Windows en oscuro, y al revés.
            window_vibrancy::apply_mica(&window, dark)
        } else {
            window_vibrancy::clear_mica(&window)
        }
        .map_err(|e| format!("Windows no pudo aplicar el fondo translúcido: {e}"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (window, enabled, dark);
        Err("El fondo translúcido solo está hecho para Windows por ahora.".into())
    }
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

/// Devuelve los pasos (posiblemente editados) al agente que esperaba con el plan.
/// Una lista vacía se interpreta como «tal cual», para que el botón de aceptar no
/// tenga que reenviar lo mismo.
#[tauri::command]
pub fn respond_plan_review(
    app: State<AppState>,
    plan_id: String,
    steps: Vec<String>,
) -> Result<(), String> {
    let sender = app
        .plan_reviews
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&plan_id)
        .ok_or("No hay un plan esperando revisión con ese id.")?;
    let _ = sender.send(steps);
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

/// Manda un aviso de prueba **sin mirar si la ventana está en primer plano**.
/// Sin esto, comprobar el camino del toast exigía poner el ratón en otra ventana
/// mientras una sesión de trabajo terminaba de verdad.
#[tauri::command]
pub fn test_notification(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title("Hatboo")
        .body("Si ves esto, los avisos de sesión llegan bien.")
        .show()
        .map_err(|e| format!("Windows no pudo mostrar el aviso: {e}"))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextUsage {
    /// Caracteres de texto que saldrían hacia el proveedor en el próximo turno.
    pub chars: usize,
    /// Estimación a ojo: ~4 caracteres por token. No es el contador del proveedor.
    pub est_tokens: usize,
    pub messages: usize,
    /// Las imágenes viajan en base64 y dominan el costo real; se cuentan aparte
    /// para que el número de texto no parezca mentira.
    pub images: usize,
}

/// Lo que ocuparía el prompt del próximo turno de esta conversación. Cuenta el
/// mismo `history()` que usa `spawn_chat_stream`, así que el adjunto ya va
/// antepuesto como `[Archivo adjunto: …]` y el número no se desvía del real.
#[tauri::command]
pub fn context_usage(app: State<AppState>, conversation_id: String) -> Result<ContextUsage, String> {
    let messages = history(&app, &conversation_id)?;
    let settings = state::load_settings(&app);
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    let skills = db::enabled_skills_prompt(&conn)?;
    drop(conn);
    let system = chat_system_prompt(&settings, &skills);

    let mut chars = system.trim().chars().count();
    let mut images = 0usize;
    for m in &messages {
        chars += m.content.chars().count();
        images += m.images.len();
    }
    Ok(ContextUsage {
        chars,
        est_tokens: chars / 4,
        messages: messages.len(),
        images,
    })
}

/// Dónde vive lo que Hatboo guarda en este PC y cuánto ocupa.
#[tauri::command]
pub fn get_storage_info(app: State<AppState>) -> Result<StorageInfo, String> {    let db_path = app.data_dir.join("hatboo.db");
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn urls_de_github_que_se_aceptan() {
        let (cruda, nombre) =
            github_a_cruda("https://github.com/egosocratico-star/hatboo/blob/main/README.md")
                .unwrap();
        assert_eq!(
            cruda,
            "https://raw.githubusercontent.com/egosocratico-star/hatboo/main/README.md"
        );
        assert_eq!(nombre, "README.md");

        // Ruta con carpetas dentro y query que hay que quitar.
        let (cruda, _) =
            github_a_cruda("https://github.com/a/b/blob/v1.2/src-tauri/src/main.rs?x=1").unwrap();
        assert_eq!(cruda, "https://raw.githubusercontent.com/a/b/v1.2/src-tauri/src/main.rs");

        // Cruda directa.
        let (cruda, nombre) =
            github_a_cruda("https://raw.githubusercontent.com/a/b/main/Cargo.toml").unwrap();
        assert_eq!(cruda, "https://raw.githubusercontent.com/a/b/main/Cargo.toml");
        assert_eq!(nombre, "Cargo.toml");

        // Raíz del repo → README por la API.
        let (cruda, nombre) = github_a_cruda("https://github.com/a/b").unwrap();
        assert_eq!(cruda, "https://api.github.com/repos/a/b/readme");
        assert_eq!(nombre, "README.md");
    }

    #[test]
    fn cualquier_otro_host_se_rechaza() {
        // El control no es cosmético: sin la lista esto sería un fetch arbitrario
        // desde la máquina del usuario.
        for mala in [
            "http://localhost:11434/api/tags",
            "https://169.254.169.254/latest/meta-data/",
            "https://evil.com/a/b/blob/main/x.rs",
            "https://github.com.evil.com/a/b",
            "file:///c:/windows/win.ini",
            "https://github.com/",
            "no soy una url",
        ] {
            assert!(github_a_cruda(mala).is_none(), "se aceptó {mala}");
        }
    }

    /// Carpeta de adjuntos desechable con un PNG minúsculo dentro.
    fn dir_con_imagen() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hatboo-img-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut f = std::fs::File::create(dir.join("foto.png")).unwrap();
        f.write_all(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]).unwrap();
        dir
    }

    #[test]
    fn sirve_como_data_uri_una_imagen_de_la_carpeta() {
        let dir = dir_con_imagen();
        let file = dir.join("foto.png").display().to_string();
        let uri = image_data_uri(&dir, &file).unwrap();
        assert!(uri.starts_with("data:image/png;base64,"));
        assert!(uri.contains("iVBORw0KGgo"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn rechaza_rutas_de_fuera_de_la_carpeta_de_adjuntos() {
        let dir = dir_con_imagen();
        let fuera = std::env::temp_dir().join("hatboo-fuera.png");
        std::fs::write(&fuera, b"x").unwrap();
        // Escapando con .. y también con una ruta absoluta directa.
        assert!(image_data_uri(&dir, "../../hatboo-fuera.png").is_err());
        assert!(image_data_uri(&dir, &fuera.display().to_string()).is_err());
        // Y lo que no existe o no es imagen.
        assert!(image_data_uri(&dir, "no-existe.png").is_err());
        std::fs::write(dir.join("nota.txt"), b"x").unwrap();
        assert!(image_data_uri(&dir, &dir.join("nota.txt").display().to_string()).is_err());
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_file(&fuera).ok();
    }

    #[test]
    fn el_markdown_del_export_trae_razonamiento_y_fuentes() {
        let mut m = db::Message {
            id: "m1".into(),
            conversation_id: "c1".into(),
            role: "assistant".into(),
            content: "La respuesta.".into(),
            provider: Some("local".into()),
            created_at: 0,
            attachments: vec![],
            reasoning: Some("  Primero miro esto.  ".into()),
            thinking_ms: Some(2400),
            web_sources: vec![db::WebSource {
                title: "Docs".into(),
                url: "https://ejemplo.com/docs".into(),
                snippet: String::new(),
            }],
            feedback: None,
        };
        let md = render_markdown("Título", &[m.clone()]);
        assert!(md.starts_with("# Título\n\n"));
        assert!(md.contains("### Asistente · local"));
        assert!(md.contains("<summary>Razonamiento (2.4 s)</summary>"));
        assert!(md.contains("Primero miro esto."));
        assert!(md.contains("[Docs](https://ejemplo.com/docs)"));

        // Sin razonamiento ni fuentes no se mete basura en el archivo.
        m.reasoning = None;
        m.thinking_ms = None;
        m.web_sources.clear();
        let limpio = render_markdown("Título", &[m]);
        assert!(!limpio.contains("<details>"));
        assert!(!limpio.contains("Fuentes:"));
    }
}
