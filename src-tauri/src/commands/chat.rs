//! Chat: conversaciones, mensajes, streaming, artifactos y medidor de contexto.
//!
//! `send_message`, `regenerate_response`, `edit_user_message` y `cancel_chat_stream`
//! van juntos a propósito: los cuatro hablan con `AppState.chat_runs`, el mapa que
//! sujeta el canal de cancelación de la respuesta en curso.

use super::_comunes::{chat_system_prompt, remove_image_files, titulo_breve};
use super::projects::project_rules_for_prompt;
use crate::db;
use crate::state::{self, AppState};
use serde::Serialize;
use std::path::PathBuf;
use tauri::{Manager, State};

// Lo que se fue a `chat/stream.rs` sigue llamándose igual desde aquí: la lectura
// del historial y el arranque del stream, que son los dos nombres que usaban los
// comandos. Mudanza de sitio, no de nombres.
pub(crate) use crate::chat::stream::{history, spawn_chat_stream};

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

/// El prompt con el que se manda cada respuesta. No se guarda en ninguna parte:
/// se vuelve a armar con las mismas funciones que lo envían, para que lo que se
/// lee aquí sea literalmente lo que lee el modelo.
#[tauri::command]
pub fn system_prompt_of(app: State<AppState>, conversation_id: String) -> Result<String, String> {
    let aj = state::load_settings(&app);
    let skills = {
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        let texto = db::enabled_skills_prompt(&conn)?;
        let memoria = db::memoria_prompt(&conn)?;
        match db::get_conversation(&conn, &conversation_id)
            .map_err(|_| "Esta conversación ya no existe.".to_string())?
            .project_id
        {
            None => return Ok(chat_system_prompt(&aj, &texto, &memoria)),
            Some(pid) => {
                let proyecto = db::get_project(&conn, &pid)?;
                let raiz = PathBuf::from(proyecto.root_path);
                // Aquí también pasa por el gate: si el prompt que se muestra llevara
                // reglas sin aprobar, esta pantalla prometería texto que el modelo no ve.
                let reglas = project_rules_for_prompt(&conn, Some(&pid), &raiz);
                (texto, memoria, raiz, proyecto.approval_level, reglas)
            }
        }
    };
    Ok(crate::agent::loop_runner::system_prompt(
        &skills.2,
        &crate::agent::loop_runner::PromptDeSistema {
            approval_level: &skills.3,
            assistant_name: &aj.assistant_name,
            skills: &skills.0,
            code_mode: aj.code_mode,
            rules: &skills.4,
            memoria: &skills.1,
            tz_offset_min: aj.tz_offset_min,
        },
    ))
}

/// Guarda el texto sin enviar de un hilo. La clave `nueva` es la del chat que
/// todavía no existe como conversación.
#[tauri::command]
pub fn save_draft(app: State<AppState>, conversation_id: String, text: String) -> Result<(), String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::set_draft(&conn, &conversation_id, &text)
}

#[tauri::command]
pub fn get_drafts(app: State<AppState>) -> Result<std::collections::HashMap<String, String>, String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    Ok(db::list_drafts(&conn)?.into_iter().collect())
}

#[tauri::command]
pub fn rename_conversation(
    app: State<AppState>,
    conversation_id: String,
    title: String,
) -> Result<(), String> {
    let titulo = titulo_breve(&title);
    if titulo.is_empty() {
        return Err("El título no puede quedar vacío.".into());
    }
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::rename_conversation(&conn, &conversation_id, &titulo)
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
    db::hilo_activo(&conn, &conversation_id)
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
            let _ = db::rename_conversation(&conn, &conversation_id, &titulo_breve(&content));
        }
        msg
    };

    // 2. Streaming en segundo plano con el historial recién guardado.
    spawn_chat_stream(app, conversation_id)?;
    Ok(user_message)
}

/// Regenera la última respuesta del asistente. No la borra: retrocede el hilo al
/// mensaje del usuario y la respuesta nueva nace como hermana de la anterior, así
/// que «‹ 1/2 ›» deja ver las dos.
#[tauri::command]
pub async fn regenerate_response(
    app: tauri::AppHandle,
    conversation_id: String,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        if !db::preparar_regeneracion(&conn, &conversation_id)? {
            return Err("No hay respuesta que regenerar.".into());
        }
    }
    spawn_chat_stream(app, conversation_id)
}

/// Edita un mensaje ya enviado por el usuario: se escribe una versión nueva en el
/// mismo punto y la anterior queda como variante navegable. Lo que había después
/// no se toca ni se borra, solo deja de estar en el camino activo.
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
        let (conv_id, role, _) = db::message_position(&conn, &message_id)?;
        if conv_id != conversation_id {
            return Err("Ese mensaje no pertenece a esta conversación.".into());
        }
        if role != "user" {
            return Err("Solo se editan los mensajes que enviaste tú.".into());
        }
        // Sin `remove_image_files`: las imágenes de la versión vieja siguen
        // vivas en esa variante, y borrarlas rompería la versión 1.
        db::crear_variante(&conn, &message_id, &content)?;
    }
    spawn_chat_stream(app, conversation_id)
}

/// Pone otra versión de un mismo punto del hilo como la activa.
#[tauri::command]
pub fn select_message_variant(app: State<AppState>, message_id: String) -> Result<(), String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::activar_variante(&conn, &message_id)
}

/// Guarda una versión nueva de un artifacto del panel. Si ya había otro con el
/// mismo título e idioma en esta conversación, este pasa a ser la versión 2, 3…
/// y los anteriores se conservan.
#[tauri::command]
pub fn save_artifact(
    app: State<AppState>,
    conversation_id: String,
    titulo: String,
    lenguaje: String,
    contenido: String,
) -> Result<db::Artifact, String> {
    let titulo = titulo.trim().to_string();
    if titulo.is_empty() {
        return Err("El artifacto necesita un título.".into());
    }
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::guardar_artifact(
        &conn,
        &conversation_id,
        &titulo,
        &lenguaje,
        &contenido,
    )
}

#[tauri::command]
pub fn list_artifacts(
    app: State<AppState>,
    conversation_id: String,
) -> Result<Vec<db::Artifact>, String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::listar_artifacts(&conn, &conversation_id)
}

#[tauri::command]
pub fn delete_artifact(app: State<AppState>, id: String) -> Result<(), String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::borrar_artifact(&conn, &id)
}

/// Lo que se subió en cualquier conversación, con su origen: la vista
/// «Adjuntos» de Ajustes. `limite` es por mensajes con adjuntos, no por
/// adjuntos; uno puede traer varios.
#[tauri::command]
pub fn list_attachments(
    app: State<AppState>,
    limite: Option<i64>,
) -> Result<db::PaginaAdjuntos, String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::pagina_de_adjuntos(&conn, limite.unwrap_or(300))
}

/// Lo que pinta la tarjeta «Tus estadísticas» de Ajustes → Perfil. El desfase lo
/// pasa el frontend porque Rust no sabe en qué zona está el usuario: sin eso, un
/// chat de las 23:30 contaría en el día equivocado.
#[tauri::command]
pub fn perfil_estadisticas(
    app: State<AppState>,
    tz_offset_min: i32,
) -> Result<db::Estadisticas, String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::perfil_estadisticas(&conn, tz_offset_min)
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
        let todos = db::hilo_activo(&conn, &conversation_id)?;
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
    /// De dónde salen esos caracteres. Separar el traje fijo de la conversación
    /// es lo que permite decir «esto no lo puedes quitar» y «esto sí».
    pub system_chars: usize,
    pub history_chars: usize,
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
    let memoria = db::memoria_prompt(&conn)?;
    drop(conn);
    let system = chat_system_prompt(&settings, &skills, &memoria);

    let system_chars = system.trim().chars().count();
    let history_chars: usize = messages.iter().map(|m| m.content.chars().count()).sum();
    let images: usize = messages.iter().map(|m| m.images.len()).sum();
    let chars = system_chars + history_chars;
    Ok(ContextUsage {
        chars,
        est_tokens: chars / 4,
        messages: messages.len(),
        images,
        system_chars,
        history_chars,
    })
}
