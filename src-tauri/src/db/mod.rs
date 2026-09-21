use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

const SCHEMA: &str = include_str!("schema.sql");

/// Documento adjuntado a un mensaje del chat normal.
/// - M2 (texto): `text` trae el contenido ya extraído.
/// - M3 (imagen): `image_media_type` + `image_file` (ruta en disco bajo
///   `data_dir/attachments`). El binario NO se guarda en SQLite; se lee desde
///   disco y se codifica a base64 al construir el payload del proveedor.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub name: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub image_media_type: Option<String>,
    #[serde(default)]
    pub image_file: Option<String>,
}

impl Attachment {
    pub fn is_image(&self) -> bool {
        self.image_file.is_some()
    }

    pub fn text(name: String, text: String) -> Self {
        Self {
            name,
            text,
            ..Default::default()
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub project_id: Option<String>,
}

/// Fuente citada por la búsqueda web de una respuesta.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSource {
    pub title: String,
    pub url: String,
    #[serde(default)]
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub provider: Option<String>,
    pub created_at: i64,
    pub attachments: Vec<Attachment>,
    /// Razonamiento interno que devolvió el modelo, si lo hubo.
    pub reasoning: Option<String>,
    /// Milisegundos que el modelo pasó pensando antes del primer carácter visible.
    pub thinking_ms: Option<i64>,
    pub web_sources: Vec<WebSource>,
    /// Valoración del usuario sobre esta respuesta: `"up"`, `"down"` o `None`.
    pub feedback: Option<String>,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub fn connect(db_path: &std::path::Path) -> Result<Connection, String> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| e.to_string())?;
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
    // ALTER no es idempotente: ignorar si la columna ya existe (DB de Fase 1).
    let _ = conn.execute(
        "ALTER TABLE conversations ADD COLUMN project_id TEXT REFERENCES projects(id)",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE projects ADD COLUMN approval_level TEXT NOT NULL DEFAULT 'approve_for_me'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE messages ADD COLUMN attachments TEXT",
        [],
    );
    let _ = conn.execute("ALTER TABLE messages ADD COLUMN reasoning TEXT", []);
    let _ = conn.execute("ALTER TABLE messages ADD COLUMN thinking_ms INTEGER", []);
    let _ = conn.execute("ALTER TABLE messages ADD COLUMN web_sources TEXT", []);
    let _ = conn.execute("ALTER TABLE messages ADD COLUMN feedback TEXT", []);
    Ok(())
}

pub fn create_conversation(
    conn: &Connection,
    title: &str,
    project_id: Option<&str>,
) -> Result<Conversation, String> {
    let conv = Conversation {
        id: new_id(),
        title: title.to_string(),
        created_at: now_ms(),
        updated_at: now_ms(),
        project_id: project_id.map(|s| s.to_string()),
    };
    conn.execute(
        "INSERT INTO conversations (id, title, created_at, updated_at, project_id)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![conv.id, conv.title, conv.created_at, conv.updated_at, conv.project_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(conv)
}

pub fn list_conversations(conn: &Connection) -> Result<Vec<Conversation>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, title, created_at, updated_at, project_id
             FROM conversations ORDER BY updated_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Conversation {
                id: row.get(0)?,
                title: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
                project_id: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn get_conversation(conn: &Connection, id: &str) -> Result<Conversation, String> {
    conn.query_row(
        "SELECT id, title, created_at, updated_at, project_id FROM conversations WHERE id = ?1",
        params![id],
        |row| {
            Ok(Conversation {
                id: row.get(0)?,
                title: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
                project_id: row.get(4)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

pub fn delete_conversation(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM messages WHERE conversation_id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM conversations WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn rename_conversation(conn: &Connection, id: &str, title: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE conversations SET title = ?1 WHERE id = ?2",
        params![title, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn touch_conversation(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
        params![now_ms(), id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn add_message(
    conn: &Connection,
    conversation_id: &str,
    role: &str,
    content: &str,
    provider: Option<&str>,
) -> Result<Message, String> {
    add_message_with_attachments(conn, conversation_id, role, content, provider, &[])
}

pub fn add_message_with_attachments(
    conn: &Connection,
    conversation_id: &str,
    role: &str,
    content: &str,
    provider: Option<&str>,
    attachments: &[Attachment],
) -> Result<Message, String> {
    let meta = AssistantMeta {
        attachments: attachments.to_vec(),
        ..Default::default()
    };
    add_message_detailed(conn, conversation_id, role, content, provider, &meta)
}

/// Campos opcionales que llegan con una respuesta del asistente.
#[derive(Debug, Default, Clone)]
pub struct AssistantMeta {
    pub attachments: Vec<Attachment>,
    pub reasoning: Option<String>,
    pub thinking_ms: Option<i64>,
    pub web_sources: Vec<WebSource>,
}

pub fn add_message_detailed(
    conn: &Connection,
    conversation_id: &str,
    role: &str,
    content: &str,
    provider: Option<&str>,
    meta: &AssistantMeta,
) -> Result<Message, String> {
    let msg = Message {
        id: new_id(),
        conversation_id: conversation_id.to_string(),
        role: role.to_string(),
        content: content.to_string(),
        provider: provider.map(|s| s.to_string()),
        created_at: now_ms(),
        attachments: meta.attachments.clone(),
        reasoning: meta.reasoning.clone(),
        thinking_ms: meta.thinking_ms,
        web_sources: meta.web_sources.clone(),
        // La valoración la escribe el usuario después, con `set_message_feedback`.
        feedback: None,
    };
    let attachments_json = if msg.attachments.is_empty() {
        None
    } else {
        Some(serde_json::to_string(&msg.attachments).map_err(|e| e.to_string())?)
    };
    let sources_json = if msg.web_sources.is_empty() {
        None
    } else {
        Some(serde_json::to_string(&msg.web_sources).map_err(|e| e.to_string())?)
    };
    conn.execute(
        "INSERT INTO messages (id, conversation_id, role, content, provider, created_at, attachments, reasoning, thinking_ms, web_sources)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            msg.id,
            msg.conversation_id,
            msg.role,
            msg.content,
            msg.provider,
            msg.created_at,
            attachments_json,
            msg.reasoning,
            msg.thinking_ms,
            sources_json
        ],
    )
    .map_err(|e| e.to_string())?;
    touch_conversation(conn, conversation_id)?;
    Ok(msg)
}

fn parse_json_column<T: serde::de::DeserializeOwned>(raw: Option<String>) -> Vec<T> {
    raw.and_then(|s| serde_json::from_str::<Vec<T>>(&s).ok())
        .unwrap_or_default()
}

pub fn list_messages(conn: &Connection, conversation_id: &str) -> Result<Vec<Message>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, conversation_id, role, content, provider, created_at, attachments,
                    reasoning, thinking_ms, web_sources, feedback
             FROM messages WHERE conversation_id = ?1 ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![conversation_id], |row| {
            Ok(Message {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                provider: row.get(4)?,
                created_at: row.get(5)?,
                attachments: parse_json_column(row.get(6)?),
                reasoning: row.get(7)?,
                thinking_ms: row.get(8)?,
                web_sources: parse_json_column(row.get(9)?),
                feedback: row.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn delete_last_assistant_message(conn: &Connection, conversation_id: &str) -> Result<(), String> {
    let deleted = conn
        .execute(
            "DELETE FROM messages WHERE id = (
               SELECT id FROM messages
               WHERE conversation_id = ?1 AND role = 'assistant'
               ORDER BY created_at DESC LIMIT 1
             )",
            params![conversation_id],
        )
        .map_err(|e| e.to_string())?;
    if deleted == 0 {
        return Err("No hay respuesta que regenerar.".into());
    }
    Ok(())
}

/// Borra todos los mensajes de una conversación, conservando la conversación.
pub fn clear_messages(conn: &Connection, conversation_id: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM messages WHERE conversation_id = ?1",
        params![conversation_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Borra todo el contenido del histórico: conversaciones, mensajes, proyectos,
/// tareas y llamadas a herramientas, más los ajustes guardados. Lo único que no
/// toca son las imágenes en disco (las borra el comando) y las claves del
/// llavero (las borra `providers::delete_api_key`).
pub fn wipe_all(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "DELETE FROM tool_calls;
         DELETE FROM tasks;
         DELETE FROM messages;
         DELETE FROM conversations;
         DELETE FROM projects;
         DELETE FROM settings;",
    )
    .map_err(|e| e.to_string())
}

/// Rutas en disco de todas las imágenes adjuntas (M3) de una conversación,
/// para poder borrar los archivos al limpiar o eliminar la conversación.
pub fn conversation_image_files(conn: &Connection, conversation_id: &str) -> Result<Vec<String>, String> {
    image_files_in(conn, conversation_id, None)
}

/// Igual que `conversation_image_files` pero solo lo posterior a `after_ms`.
fn image_files_in(
    conn: &Connection,
    conversation_id: &str,
    after_ms: Option<i64>,
) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare("SELECT attachments, created_at FROM messages WHERE conversation_id = ?1")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![conversation_id], |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, i64>(1)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut files = Vec::new();
    for row in rows {
        let (raw, created_at) = row.map_err(|e| e.to_string())?;
        if after_ms.is_some_and(|ms| created_at <= ms) {
            continue;
        }
        let Some(s) = raw else { continue };
        if let Ok(atts) = serde_json::from_str::<Vec<Attachment>>(&s) {
            for a in atts {
                if let Some(f) = a.image_file {
                    files.push(f);
                }
            }
        }
    }
    Ok(files)
}

/// Conversación, rol y marca de tiempo de un mensaje.
pub fn message_position(
    conn: &Connection,
    id: &str,
) -> Result<(String, String, i64), String> {
    conn.query_row(
        "SELECT conversation_id, role, created_at FROM messages WHERE id = ?1",
        params![id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )
    .map_err(|_| "El mensaje ya no existe.".to_string())
}

/// Cambia el texto de un mensaje (se usa al editar lo que envió el usuario).
pub fn update_message_content(
    conn: &Connection,
    id: &str,
    content: &str,
) -> Result<(), String> {
    conn.execute(
        "UPDATE messages SET content = ?2 WHERE id = ?1",
        params![id, content],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Borra todo lo posterior a `after_ms` en la conversación —lo que queda obsoleto
/// al editar un mensaje— y devuelve las imágenes en disco que quedan huérfanas.
pub fn truncate_messages_after(
    conn: &Connection,
    conversation_id: &str,
    after_ms: i64,
) -> Result<Vec<String>, String> {
    let images = image_files_in(conn, conversation_id, Some(after_ms))?;
    conn.execute(
        "DELETE FROM messages WHERE conversation_id = ?1 AND created_at > ?2",
        params![conversation_id, after_ms],
    )
    .map_err(|e| e.to_string())?;
    Ok(images)
}

/// Valoración de una respuesta: `"up"`, `"down"` o `None` para quitarla.
pub fn set_message_feedback(
    conn: &Connection,
    id: &str,
    feedback: Option<&str>,
) -> Result<(), String> {
    let value = match feedback {
        Some(v @ ("up" | "down")) => Some(v),
        _ => None,
    };
    let changed = conn
        .execute(
            "UPDATE messages SET feedback = ?2 WHERE id = ?1 AND role = 'assistant'",
            params![id, value],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("Ese mensaje no admite valoración.".into());
    }
    Ok(())
}

/// Borra conversaciones de chat (sin proyecto) que no tienen ningún mensaje.
/// Desde el borrador local del frontend una fila vacía ya no es nunca útil; se
/// limpia al arrancar para quitar las que dejó la versión anterior.
pub fn prune_empty_chat_conversations(conn: &Connection) -> Result<usize, String> {
    conn.execute(
        "DELETE FROM conversations
         WHERE project_id IS NULL
           AND id NOT IN (SELECT conversation_id FROM messages)",
        [],
    )
    .map_err(|e| e.to_string())
}

pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    let mut stmt = conn
        .prepare("SELECT value FROM settings WHERE key = ?1")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query_map(params![key], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    match rows.next() {
        Some(v) => v.map(Some).map_err(|e| e.to_string()),
        None => Ok(None),
    }
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ---------- Telemetría local (solo lectura) ----------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Counts {
    pub conversations: i64,
    pub messages: i64,
    pub projects: i64,
    pub tasks: i64,
    pub tool_calls: i64,
}

pub fn table_counts(conn: &Connection) -> Result<Counts, String> {
    let count = |sql: &str| -> Result<i64, String> {
        conn.query_row(sql, [], |row| row.get::<_, i64>(0))
            .map_err(|e| e.to_string())
    };
    Ok(Counts {
        conversations: count("SELECT COUNT(*) FROM conversations")?,
        messages: count("SELECT COUNT(*) FROM messages")?,
        projects: count("SELECT COUNT(*) FROM projects")?,
        tasks: count("SELECT COUNT(*) FROM tasks")?,
        tool_calls: count("SELECT COUNT(*) FROM tool_calls")?,
    })
}

// ---------- Fase 2: proyectos, tareas y tool calls ----------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub created_at: i64,
    pub last_opened_at: i64,
    /// 'ask_always' | 'approve_for_me' | 'auto_sandbox' | 'full_access'
    pub approval_level: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub conversation_id: String,
    pub step_order: i64,
    pub description: String,
    pub status: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    pub id: String,
    pub conversation_id: String,
    pub tool_name: String,
    pub input: String,
    pub output: Option<String>,
    pub status: String,
    pub created_at: i64,
}

pub fn create_project(
    conn: &Connection,
    name: &str,
    root_path: &str,
    approval_level: &str,
) -> Result<Project, String> {
    let project = Project {
        id: new_id(),
        name: name.to_string(),
        root_path: root_path.to_string(),
        created_at: now_ms(),
        last_opened_at: now_ms(),
        approval_level: approval_level.to_string(),
    };
    conn.execute(
        "INSERT INTO projects (id, name, root_path, created_at, last_opened_at, approval_level)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![project.id, project.name, project.root_path, project.created_at, project.last_opened_at, project.approval_level],
    )
    .map_err(|e| e.to_string())?;
    Ok(project)
}

pub fn list_projects(conn: &Connection) -> Result<Vec<Project>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, root_path, created_at, last_opened_at, approval_level
             FROM projects ORDER BY last_opened_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                root_path: row.get(2)?,
                created_at: row.get(3)?,
                last_opened_at: row.get(4)?,
                approval_level: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn get_project(conn: &Connection, id: &str) -> Result<Project, String> {
    conn.query_row(
        "SELECT id, name, root_path, created_at, last_opened_at, approval_level FROM projects WHERE id = ?1",
        params![id],
        |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                root_path: row.get(2)?,
                created_at: row.get(3)?,
                last_opened_at: row.get(4)?,
                approval_level: row.get(5)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

pub fn set_project_approval_level(conn: &Connection, id: &str, level: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE projects SET approval_level = ?2 WHERE id = ?1",
        params![id, level],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn touch_project(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE projects SET last_opened_at = ?1 WHERE id = ?2",
        params![now_ms(), id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_project(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE conversations SET project_id = NULL WHERE project_id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM projects WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn replace_tasks(
    conn: &Connection,
    conversation_id: &str,
    steps: &[String],
) -> Result<Vec<Task>, String> {
    conn.execute(
        "DELETE FROM tasks WHERE conversation_id = ?1",
        params![conversation_id],
    )
    .map_err(|e| e.to_string())?;
    let mut tasks = Vec::with_capacity(steps.len());
    for (i, description) in steps.iter().enumerate() {
        let task = Task {
            id: new_id(),
            conversation_id: conversation_id.to_string(),
            step_order: i as i64 + 1,
            description: description.clone(),
            status: "pending".to_string(),
            created_at: now_ms(),
        };
        conn.execute(
            "INSERT INTO tasks (id, conversation_id, step_order, description, status, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![task.id, task.conversation_id, task.step_order, task.description, task.status, task.created_at],
        )
        .map_err(|e| e.to_string())?;
        tasks.push(task);
    }
    Ok(tasks)
}

pub fn list_tasks(conn: &Connection, conversation_id: &str) -> Result<Vec<Task>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, conversation_id, step_order, description, status, created_at
             FROM tasks WHERE conversation_id = ?1 ORDER BY step_order ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![conversation_id], |row| {
            Ok(Task {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                step_order: row.get(2)?,
                description: row.get(3)?,
                status: row.get(4)?,
                created_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn set_task_status(conn: &Connection, task_id: &str, status: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE tasks SET status = ?1 WHERE id = ?2",
        params![status, task_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn finish_all_tasks(conn: &Connection, conversation_id: &str, status: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE tasks SET status = ?1 WHERE conversation_id = ?2 AND status IN ('pending', 'in_progress')",
        params![status, conversation_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn insert_tool_call(
    conn: &Connection,
    id: &str,
    conversation_id: &str,
    tool_name: &str,
    input: &str,
    output: Option<&str>,
    status: &str,
) -> Result<ToolCall, String> {
    let call = ToolCall {
        id: id.to_string(),
        conversation_id: conversation_id.to_string(),
        tool_name: tool_name.to_string(),
        input: input.to_string(),
        output: output.map(|s| s.to_string()),
        status: status.to_string(),
        created_at: now_ms(),
    };
    conn.execute(
        "INSERT INTO tool_calls (id, conversation_id, tool_name, input, output, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![call.id, call.conversation_id, call.tool_name, call.input, call.output, call.status, call.created_at],
    )
    .map_err(|e| e.to_string())?;
    Ok(call)
}

pub fn update_tool_call(
    conn: &Connection,
    id: &str,
    status: &str,
    output: Option<&str>,
) -> Result<(), String> {
    conn.execute(
        "UPDATE tool_calls SET status = ?1, output = COALESCE(?2, output) WHERE id = ?3",
        params![status, output, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn pending_tool_call_ids(conn: &Connection, conversation_id: &str) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare("SELECT id FROM tool_calls WHERE conversation_id = ?1 AND status = 'pending_approval'")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![conversation_id], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn get_tool_call(conn: &Connection, id: &str) -> Result<ToolCall, String> {
    conn.query_row(
        "SELECT id, conversation_id, tool_name, input, output, status, created_at
         FROM tool_calls WHERE id = ?1",
        params![id],
        |row| {
            Ok(ToolCall {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                tool_name: row.get(2)?,
                input: row.get(3)?,
                output: row.get(4)?,
                status: row.get(5)?,
                created_at: row.get(6)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}
