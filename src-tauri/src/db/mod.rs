use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

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
    /// Se mantiene arriba de la lista aunque llegue mensajería nueva.
    pub pinned: bool,
    /// Fuera de la lista principal, pero sin borrar nada.
    pub archived: bool,
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
        "ALTER TABLE conversations ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE conversations ADD COLUMN archived INTEGER NOT NULL DEFAULT 0",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE projects ADD COLUMN approval_level TEXT NOT NULL DEFAULT 'approve_for_me'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE projects ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0",
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

    // Los proyectos abiertos antes se guardaban con el prefijo verbatim que
    // devuelve canonicalize(); aparecía tal cual en la cabecera del modo trabajo.
    let verbos: Vec<(String, String)> = {
        let mut stmt = conn
            .prepare("SELECT id, root_path FROM projects")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?;
        rows.filter_map(|x| x.ok())
            .filter(|(_, path)| path.starts_with(r"\\?\"))
            .map(|(id, path)| (id, clean_root_path(&path)))
            .collect()
    };
    for (id, path) in &verbos {
        let _ = conn.execute(
            "UPDATE projects SET root_path = ?2 WHERE id = ?1",
            params![id, path],
        );
    }
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
        pinned: false,
        archived: false,
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
            "SELECT id, title, created_at, updated_at, project_id, pinned, archived
             FROM conversations ORDER BY pinned DESC, updated_at DESC",
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
                pinned: row.get(5)?,
                archived: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn get_conversation(conn: &Connection, id: &str) -> Result<Conversation, String> {
    conn.query_row(
        "SELECT id, title, created_at, updated_at, project_id, pinned, archived FROM conversations WHERE id = ?1",
        params![id],
        |row| {
            Ok(Conversation {
                id: row.get(0)?,
                title: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
                project_id: row.get(4)?,
                pinned: row.get(5)?,
                archived: row.get(6)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

/// Fijar es voluntad del usuario, así que no mueve `updated_at`: una conversación
/// fijada debe quedarse arriba aunque lleve días sin mensajes.
pub fn set_conversation_flags(
    conn: &Connection,
    id: &str,
    pinned: Option<bool>,
    archived: Option<bool>,
) -> Result<(), String> {
    if let Some(pinned) = pinned {
        conn.execute(
            "UPDATE conversations SET pinned = ?2 WHERE id = ?1",
            params![id, pinned],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(archived) = archived {
        conn.execute(
            "UPDATE conversations SET archived = ?2 WHERE id = ?1",
            params![id, archived],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Resultado de la búsqueda global: una fila por conversación, con un trozo del
/// primer mensaje donde aparece la palabra.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub conversation_id: String,
    pub title: String,
    pub project_id: Option<String>,
    pub updated_at: i64,
    pub pinned: bool,
    pub snippet: Option<String>,
}

/// Búsqueda por subcadena, sin FTS: `instr` sobre el título y el contenido.
/// `lower()` de SQLite solo dobla ASCII, así que las vocales acentuadas siguen
/// distinguiendo — suficiente para el historial de una app de escritorio.
pub fn search_chats(conn: &Connection, query: &str) -> Result<Vec<SearchHit>, String> {
    let q = query.trim();
    if q.chars().count() < 2 {
        return Ok(Vec::new());
    }
    let mut stmt = conn
        .prepare(
            "SELECT c.id, c.title, c.project_id, c.updated_at, c.pinned,
                    (SELECT substr(m.content, max(1, instr(lower(m.content), lower(?1)) - 40), 160)
                       FROM messages m
                      WHERE m.conversation_id = c.id
                        AND instr(lower(m.content), lower(?1)) > 0
                      ORDER BY m.created_at
                      LIMIT 1)
             FROM conversations c
            WHERE c.archived = 0
              AND (instr(lower(c.title), lower(?1)) > 0
                   OR EXISTS (SELECT 1 FROM messages m
                               WHERE m.conversation_id = c.id
                                 AND instr(lower(m.content), lower(?1)) > 0))
            ORDER BY c.pinned DESC, c.updated_at DESC
            LIMIT 40",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![q], |row| {
            Ok(SearchHit {
                conversation_id: row.get(0)?,
                title: row.get(1)?,
                project_id: row.get(2)?,
                updated_at: row.get(3)?,
                pinned: row.get(4)?,
                snippet: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
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

/// Copia de las conversaciones de chat para bifurcarlas (ver `branch_conversation`).
/// Las imágenes se reescriben con `renombre` porque los archivos se copian aparte:
/// si la rama apuntara al mismo archivo que el original, borrar uno de los dos se
/// llevaría las imágenes del otro.
pub fn branch_conversation(
    conn: &Connection,
    conversation_id: &str,
    up_to_message_id: &str,
    renombre: &HashMap<String, String>,
) -> Result<Conversation, String> {
    let original = get_conversation(conn, conversation_id)?;
    let todos = list_messages(conn, conversation_id)?;
    let hasta = todos
        .iter()
        .position(|m| m.id == up_to_message_id)
        .ok_or("Ese mensaje no es de esta conversación.")?;
    let mensajes = &todos[..=hasta];

    let titulo = format!("{} (rama)", original.title);
    let nuevo = create_conversation(conn, &titulo, original.project_id.as_deref())?;

    for m in mensajes {
        let attachments: Vec<Attachment> = m
            .attachments
            .iter()
            .map(|a| Attachment {
                image_file: a.image_file.as_ref().and_then(|f| renombre.get(f).cloned()),
                ..a.clone()
            })
            .collect();
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, provider, created_at,
                                   attachments, reasoning, thinking_ms, web_sources, feedback)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![
                new_id(),
                nuevo.id,
                m.role,
                m.content,
                m.provider,
                m.created_at,
                serde_json::to_string(&attachments).unwrap_or_else(|_| "[]".into()),
                m.reasoning,
                m.thinking_ms,
                serde_json::to_string(&m.web_sources).unwrap_or_else(|_| "[]".into()),
                m.feedback,
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    // La rama aparece arriba del todo: su cronología interna es la del original,
    // pero a efectos de la barra lateral nació ahora.
    touch_conversation(conn, &nuevo.id)?;
    Ok(nuevo)
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
    // En una sesión de trabajo "limpiar" también deja el plan y el registro de
    // herramientas; si no, el panel de Tareas seguiría enseñando una tarea vieja
    // aunque el chat esté vacío.
    conn.execute(
        "DELETE FROM tasks WHERE conversation_id = ?1",
        params![conversation_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM tool_calls WHERE conversation_id = ?1",
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
         DELETE FROM skills;
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
    pub pinned: bool,
}

/// Las tres consultas de proyectos leen las mismas columnas en el mismo orden.
const PROJECT_COLS: &str =
    "id, name, root_path, created_at, last_opened_at, approval_level, pinned";

fn project_from_row(row: &rusqlite::Row) -> rusqlite::Result<Project> {
    Ok(Project {
        id: row.get(0)?,
        name: row.get(1)?,
        root_path: row.get(2)?,
        created_at: row.get(3)?,
        last_opened_at: row.get(4)?,
        approval_level: row.get(5)?,
        pinned: row.get::<_, i64>(6)? != 0,
    })
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

/// `Path::canonicalize()` en Windows devuelve `\\?\C:\...`. Guardamos la forma
/// legible; las tools vuelven a canonicalizar antes de validar rutas, así que
/// el sandbox no depende del prefijo.
fn clean_root_path(raw: &str) -> String {
    if let Some(unc) = raw.strip_prefix(r"\\?\UNC\") {
        return format!("\\\\{unc}");
    }
    raw.strip_prefix(r"\\?\").unwrap_or(raw).to_string()
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
        root_path: clean_root_path(root_path),
        created_at: now_ms(),
        last_opened_at: now_ms(),
        approval_level: approval_level.to_string(),
        pinned: false,
    };
    conn.execute(
        "INSERT INTO projects (id, name, root_path, created_at, last_opened_at, approval_level, pinned)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)",
        params![project.id, project.name, project.root_path, project.created_at, project.last_opened_at, project.approval_level],
    )
    .map_err(|e| e.to_string())?;
    Ok(project)
}

/// Proyecto ya registrado para esa carpeta, tolerando mayúsculas, el separador
/// final y barras mixtas — en Windows `C:\Proy` y `c:\proy\` son lo mismo.
/// `register_project` lo consulta antes de insertar: reabrir una carpeta tiene
/// que devolver el proyecto que ya está en la barra lateral, no una fila nueva.
pub fn find_project_by_root(conn: &Connection, root_path: &str) -> Result<Option<Project>, String> {
    let limpio = clean_root_path(root_path);
    let sql = format!(
        r"SELECT {PROJECT_COLS}
          FROM projects
          WHERE lower(replace(rtrim(root_path, '\'), '/', '\')) = lower(replace(rtrim(?1, '\'), '/', '\'))
          LIMIT 1"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query_map(params![limpio], project_from_row)
        .map_err(|e| e.to_string())?;
    match rows.next() {
        Some(r) => r.map(Some).map_err(|e| e.to_string()),
        None => Ok(None),
    }
}

/// Los fijados van primero; dentro de cada grupo, por apertura reciente.
pub fn list_projects(conn: &Connection) -> Result<Vec<Project>, String> {
    let sql = format!(
        "SELECT {PROJECT_COLS} FROM projects ORDER BY pinned DESC, last_opened_at DESC"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], project_from_row)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn get_project(conn: &Connection, id: &str) -> Result<Project, String> {
    let sql = format!("SELECT {PROJECT_COLS} FROM projects WHERE id = ?1");
    conn.query_row(&sql, params![id], project_from_row)
        .map_err(|e| e.to_string())
}

/// Fijar NO mueve `last_opened_at`: un proyecto fijado no se pone al principio
/// por el simple hecho de tocarlo, se pone porque el usuario lo pidió.
pub fn set_project_pinned(conn: &Connection, id: &str, pinned: bool) -> Result<(), String> {
    conn.execute(
        "UPDATE projects SET pinned = ?2 WHERE id = ?1",
        params![id, pinned as i64],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
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
    // Las sesiones sin ni un mensaje son basura de haber abierto el proyecto:
    // se van con él. Las que tienen historial se conservan como conversación.
    conn.execute(
        "DELETE FROM conversations
         WHERE project_id = ?1
           AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = conversations.id)",
        params![id],
    )
    .map_err(|e| e.to_string())?;
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

/// Los `write_file` que se aplicaron en esta sesión, con el diff que se guardó
/// al hacerlo. Es el acumulado de la sesión para proyectos que no son repo de
/// git; si lo son, `git diff` da además lo que el usuario tocó por su cuenta.
pub fn session_writes(conn: &Connection, conversation_id: &str) -> Result<Vec<ToolCall>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, conversation_id, tool_name, input, output, status, created_at
             FROM tool_calls
             WHERE conversation_id = ?1 AND tool_name = 'write_file' AND status = 'completed'
             ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![conversation_id], |row| {
            Ok(ToolCall {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                tool_name: row.get(2)?,
                input: row.get(3)?,
                output: row.get(4)?,
                status: row.get(5)?,
                created_at: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn get_tool_call(conn: &Connection, id: &str) -> Result<ToolCall, String> {    conn.query_row(
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

// ---------- Plantillas de comportamiento (Agent Skills) ----------

/// Plantilla de instrucciones que el usuario escribe y Hatboo aplica. Con
/// `enabled` viaja en el system prompt de cada respuesta (chat y agente);
/// además siempre se puede insertar en el mensaje desde el menú «+».
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    pub id: String,
    pub name: String,
    pub prompt: String,
    pub enabled: bool,
    pub created_at: i64,
}

const SKILL_COLUMNS: &str = "SELECT id, name, prompt, enabled, created_at FROM skills";

fn skill_from_row(row: &rusqlite::Row) -> rusqlite::Result<Skill> {
    Ok(Skill {
        id: row.get(0)?,
        name: row.get(1)?,
        prompt: row.get(2)?,
        enabled: row.get::<_, i64>(3)? != 0,
        created_at: row.get(4)?,
    })
}

fn get_skill(conn: &Connection, id: &str) -> Result<Skill, String> {
    conn.query_row(
        &format!("{SKILL_COLUMNS} WHERE id = ?1"),
        params![id],
        skill_from_row,
    )
    .map_err(|e| e.to_string())
}

pub fn list_skills(conn: &Connection) -> Result<Vec<Skill>, String> {
    let mut stmt = conn
        .prepare(&format!("{SKILL_COLUMNS} ORDER BY created_at ASC"))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], skill_from_row)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Crea (con `id` vacío) o actualiza una plantilla, y devuelve el resultado.
pub fn save_skill(conn: &Connection, skill: &Skill) -> Result<Skill, String> {
    let name = skill.name.trim();
    let prompt = skill.prompt.trim();
    if name.is_empty() || prompt.is_empty() {
        return Err("La plantilla necesita un nombre y un texto.".into());
    }
    if skill.id.is_empty() {
        let created = Skill {
            id: new_id(),
            name: name.to_string(),
            prompt: prompt.to_string(),
            enabled: skill.enabled,
            created_at: now_ms(),
        };
        conn.execute(
            "INSERT INTO skills (id, name, prompt, enabled, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![created.id, created.name, created.prompt, created.enabled as i64, created.created_at],
        )
        .map_err(|e| e.to_string())?;
        return Ok(created);
    }
    let changed = conn
        .execute(
            "UPDATE skills SET name = ?1, prompt = ?2, enabled = ?3 WHERE id = ?4",
            params![name, prompt, skill.enabled as i64, skill.id],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("Esa plantilla ya no existe.".into());
    }
    get_skill(conn, &skill.id)
}

pub fn set_skill_enabled(conn: &Connection, id: &str, enabled: bool) -> Result<(), String> {
    conn.execute(
        "UPDATE skills SET enabled = ?1 WHERE id = ?2",
        params![enabled as i64, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_skill(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM skills WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Bloque de system prompt con las plantillas activas; vacío si no hay ninguna,
/// para no añadir texto de más a las peticiones.
pub fn enabled_skills_prompt(conn: &Connection) -> Result<String, String> {
    let active: Vec<Skill> = list_skills(conn)?
        .into_iter()
        .filter(|s| s.enabled)
        .collect();
    if active.is_empty() {
        return Ok(String::new());
    }
    let mut out = String::from("Plantillas que el usuario quiere que sigas siempre:\n");
    for s in &active {
        out.push_str(&format!("· {}: {}\n", s.name, s.prompt.trim()));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::clean_root_path;

    #[test]
    fn la_ruta_canonica_de_windows_se_guarda_legible() {
        assert_eq!(clean_root_path(r"\\?\C:\proyecto"), r"C:\proyecto");
        assert_eq!(clean_root_path(r"\\?\UNC\servidor\share"), r"\\servidor\share");
        assert_eq!(clean_root_path(r"C:\proyecto"), r"C:\proyecto");
        assert_eq!(clean_root_path("/home/ana/proyecto"), "/home/ana/proyecto");
    }
}
