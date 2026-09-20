use crate::db;
use crate::providers::{self, ChatMessage};
use crate::state::{self, AppState, Settings};
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
struct DonePayload {
    conversation_id: String,
    message: db::Message,
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
    db::delete_conversation(&conn, &conversation_id)
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

/// Carga el historial de la conversación en formato de proveedor.
fn history(app: &AppState, conversation_id: &str) -> Result<Vec<ChatMessage>, String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    let messages = db::list_messages(&conn, conversation_id)?;
    Ok(messages
        .into_iter()
        .map(|m| ChatMessage {
            role: m.role,
            content: m.content,
        })
        .collect())
}

#[tauri::command]
pub async fn send_message(
    app: tauri::AppHandle,
    conversation_id: String,
    content: String,
) -> Result<db::Message, String> {
    let state = app.state::<AppState>();

    // 1. Guardar el mensaje del usuario.
    let user_message = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let msg = db::add_message(&conn, &conversation_id, "user", &content, None)?;
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

    // 2. Resolver proveedor activo antes de hacer spawn.
    let provider = state::build_provider(&state)?;
    let messages = history(&state, &conversation_id)?;
    let provider_name = provider.name().to_string();

    // 3. Streaming en segundo plano: canal -> eventos Tauri.
    let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(64);
    let conv_id = conversation_id.clone();
    let app_for_task = app.clone();

    tauri::async_runtime::spawn(async move {
        let state = app_for_task.state::<AppState>();
        let mut full = String::new();
        let mut forward_error: Option<String> = None;

        let stream_task = tauri::async_runtime::spawn(async move {
            provider.stream_response(messages, tx).await
        });

        while let Some(delta) = rx.recv().await {
            full.push_str(&delta);
            let _ = app_for_task.emit(
                "chat:chunk",
                ChunkPayload {
                    conversation_id: conv_id.clone(),
                    delta,
                },
            );
        }

        match stream_task.await {
            Ok(Ok(())) => {}
            Ok(Err(e)) => forward_error = Some(e.to_string()),
            Err(e) => forward_error = Some(format!("La tarea de streaming falló: {e}")),
        }

        match forward_error {
            None => {
                let saved = {
                    let conn = state.db.lock().map_err(|e| e.to_string()).ok();
                    match conn {
                        Some(conn) => db::add_message(
                            &conn,
                            &conv_id,
                            "assistant",
                            &full,
                            Some(&provider_name),
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

    Ok(user_message)
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
    let root = std::path::Path::new(path)
        .canonicalize()
        .map_err(|e| format!("No se pudo abrir la carpeta: {e}"))?;
    if !root.is_dir() {
        return Err("La ruta seleccionada no es una carpeta.".into());
    }
    let name = root
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| root.display().to_string());
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    let project = db::create_project(&conn, &name, &root.display().to_string())?;
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
    let root = {
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
        PathBuf::from(project.root_path)
    };

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
            request,
            cancel_rx,
        )
        .await;
    });
    Ok(())
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
