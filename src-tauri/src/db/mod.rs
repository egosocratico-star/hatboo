use rusqlite::{params, Connection};
use serde::Serialize;

const SCHEMA: &str = include_str!("schema.sql");

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub project_id: Option<String>,
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
    let msg = Message {
        id: new_id(),
        conversation_id: conversation_id.to_string(),
        role: role.to_string(),
        content: content.to_string(),
        provider: provider.map(|s| s.to_string()),
        created_at: now_ms(),
    };
    conn.execute(
        "INSERT INTO messages (id, conversation_id, role, content, provider, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![msg.id, msg.conversation_id, msg.role, msg.content, msg.provider, msg.created_at],
    )
    .map_err(|e| e.to_string())?;
    touch_conversation(conn, conversation_id)?;
    Ok(msg)
}

pub fn list_messages(conn: &Connection, conversation_id: &str) -> Result<Vec<Message>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, conversation_id, role, content, provider, created_at
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
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
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

// ---------- Fase 2: proyectos, tareas y tool calls ----------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub created_at: i64,
    pub last_opened_at: i64,
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

pub fn create_project(conn: &Connection, name: &str, root_path: &str) -> Result<Project, String> {
    let project = Project {
        id: new_id(),
        name: name.to_string(),
        root_path: root_path.to_string(),
        created_at: now_ms(),
        last_opened_at: now_ms(),
    };
    conn.execute(
        "INSERT INTO projects (id, name, root_path, created_at, last_opened_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![project.id, project.name, project.root_path, project.created_at, project.last_opened_at],
    )
    .map_err(|e| e.to_string())?;
    Ok(project)
}

pub fn list_projects(conn: &Connection) -> Result<Vec<Project>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, root_path, created_at, last_opened_at
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
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn get_project(conn: &Connection, id: &str) -> Result<Project, String> {
    conn.query_row(
        "SELECT id, name, root_path, created_at, last_opened_at FROM projects WHERE id = ?1",
        params![id],
        |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                root_path: row.get(2)?,
                created_at: row.get(3)?,
                last_opened_at: row.get(4)?,
            })
        },
    )
    .map_err(|e| e.to_string())
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
