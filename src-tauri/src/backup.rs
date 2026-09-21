use crate::db::{self, Attachment};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

/// Copia de seguridad completa en un único JSON: conversaciones, mensajes,
/// proyectos, ajustes e imágenes. Es el formato que `import_all_data` lee, así
/// que cualquier cambio aquí hay que mantenerlo compatible (se comprueba por
/// `app` + `version`).
pub const APP_TAG: &str = "hatboo-backup";
pub const FORMAT_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentRow {
    pub name: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub image_media_type: Option<String>,
    /// Solo el nombre de archivo. Las rutas absolutas nunca viajan en la copia:
    /// en la importación se escribe un archivo nuevo dentro de `attachments/`.
    #[serde(default)]
    pub image_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageRow {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub provider: Option<String>,
    pub created_at: i64,
    #[serde(default)]
    pub attachments: Vec<AttachmentRow>,
    #[serde(default)]
    pub reasoning: Option<String>,
    #[serde(default)]
    pub thinking_ms: Option<i64>,
    #[serde(default)]
    pub web_sources: Option<String>,
    #[serde(default)]
    pub feedback: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationRow {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub project_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRow {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub created_at: i64,
    pub last_opened_at: i64,
    pub approval_level: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snapshot {
    pub app: String,
    pub version: u32,
    #[serde(rename = "exportedAt")]
    pub exported_at: i64,
    #[serde(default)]
    pub settings: Option<serde_json::Value>,
    #[serde(default)]
    pub projects: Vec<ProjectRow>,
    #[serde(default)]
    pub conversations: Vec<ConversationRow>,
    #[serde(default)]
    pub messages: Vec<MessageRow>,
    /// nombre de archivo -> bytes en base64
    #[serde(default)]
    pub images: BTreeMap<String, String>,
}

#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub projects_added: usize,
    pub conversations_added: usize,
    pub messages_added: usize,
    pub skipped_existing: usize,
    pub images_restored: usize,
    pub images_missing: usize,
}

fn basename(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn to_row(attachment: &Attachment) -> AttachmentRow {
    AttachmentRow {
        name: attachment.name.clone(),
        text: attachment.text.clone(),
        image_media_type: attachment.image_media_type.clone(),
        image_name: attachment
            .image_file
            .as_deref()
            .map(basename)
            .filter(|n| !n.is_empty()),
    }
}

/// Lee todo el contenido de la base de datos y las imágenes en disco.
pub fn build_snapshot(conn: &Connection, attachments_dir: &Path) -> Result<Snapshot, String> {
    let projects: Vec<ProjectRow> = db::list_projects(conn)?
        .into_iter()
        .map(|p| ProjectRow {
            id: p.id,
            name: p.name,
            root_path: p.root_path,
            created_at: p.created_at,
            last_opened_at: p.last_opened_at,
            approval_level: p.approval_level,
        })
        .collect();

    let conversations: Vec<ConversationRow> = db::list_conversations(conn)?
        .into_iter()
        .map(|c| ConversationRow {
            id: c.id,
            title: c.title,
            created_at: c.created_at,
            updated_at: c.updated_at,
            project_id: c.project_id,
        })
        .collect();

    let mut messages = Vec::new();
    let mut images: BTreeMap<String, String> = BTreeMap::new();

    for conversation in &conversations {
        for message in db::list_messages(conn, &conversation.id)? {
            for attachment in &message.attachments {
                if let Some(name) = attachment
                    .image_file
                    .as_deref()
                    .map(basename)
                    .filter(|n| !n.is_empty())
                {
                    if images.contains_key(&name) {
                        continue;
                    }
                    // La ruta la escribió la propia app; si el archivo ya no
                    // está, la copia se queda sin esa imagen pero no falla.
                    let full = attachments_dir.join(&name);
                    if let Ok(bytes) = std::fs::read(&full) {
                        images.insert(name, STANDARD.encode(bytes));
                    }
                }
            }
            messages.push(MessageRow {
                id: message.id,
                conversation_id: message.conversation_id,
                role: message.role,
                content: message.content,
                provider: message.provider,
                created_at: message.created_at,
                attachments: message.attachments.iter().map(to_row).collect(),
                reasoning: message.reasoning,
                thinking_ms: message.thinking_ms,
                web_sources: if message.web_sources.is_empty() {
                    None
                } else {
                    serde_json::to_string(&message.web_sources).ok()
                },
                feedback: message.feedback,
            });
        }
    }

    let settings = db::get_setting(conn, "settings")?
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok());

    Ok(Snapshot {
        app: APP_TAG.to_string(),
        version: FORMAT_VERSION,
        exported_at: chrono_now_ms(),
        settings,
        projects,
        conversations,
        messages,
        images,
    })
}

fn chrono_now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn write_snapshot(path: &Path, snapshot: &Snapshot) -> Result<(), String> {
    let json = serde_json::to_string_pretty(snapshot).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| format!("No se pudo escribir el archivo: {e}"))
}

pub fn read_snapshot(path: &Path) -> Result<Snapshot, String> {
    let text =
        std::fs::read_to_string(path).map_err(|e| format!("No se pudo leer el archivo: {e}"))?;
    let snapshot: Snapshot =
        serde_json::from_str(&text).map_err(|e| format!("El archivo no es una copia de Hatboo válida: {e}"))?;
    if snapshot.app != APP_TAG {
        return Err("El archivo no es una copia de seguridad de Hatboo.".into());
    }
    if snapshot.version != FORMAT_VERSION {
        return Err(format!(
            "Esta copia usa la versión {} del formato y esta app entiende la {}.",
            snapshot.version, FORMAT_VERSION
        ));
    }
    Ok(snapshot)
}

/// Inserta lo que falte, identificando por `id`: importar dos veces la misma
/// copia no duplica nada.
pub fn apply_snapshot(
    conn: &Connection,
    snapshot: &Snapshot,
    attachments_dir: &Path,
) -> Result<ImportReport, String> {
    let mut report = ImportReport::default();

    for project in &snapshot.projects {
        let added = conn
            .execute(
                "INSERT OR IGNORE INTO projects (id, name, root_path, created_at, last_opened_at, approval_level)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    project.id,
                    project.name,
                    project.root_path,
                    project.created_at,
                    project.last_opened_at,
                    project.approval_level
                ],
            )
            .map_err(|e| e.to_string())?;
        if added == 0 {
            report.skipped_existing += 1;
        } else {
            report.projects_added += 1;
        }
    }

    for conversation in &snapshot.conversations {
        let added = conn
            .execute(
                "INSERT OR IGNORE INTO conversations (id, title, created_at, updated_at, project_id)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    conversation.id,
                    conversation.title,
                    conversation.created_at,
                    conversation.updated_at,
                    conversation.project_id
                ],
            )
            .map_err(|e| e.to_string())?;
        if added == 0 {
            report.skipped_existing += 1;
        } else {
            report.conversations_added += 1;
        }
    }

    std::fs::create_dir_all(attachments_dir)
        .map_err(|e| format!("No se pudo crear la carpeta de adjuntos: {e}"))?;

    for message in &snapshot.messages {
        let mut restored = Vec::new();
        for attachment in &message.attachments {
            let Some(name) = &attachment.image_name else {
                restored.push(Attachment::text(attachment.name.clone(), attachment.text.clone()));
                continue;
            };
            match snapshot.images.get(name) {
                Some(encoded) => {
                    let bytes = STANDARD.decode(encoded).map_err(|e| e.to_string())?;
                    // Nombre nuevo generado aquí: la copia nunca trae rutas.
                    let file =
                        attachments_dir.join(format!("{}.{}", uuid::Uuid::new_v4(), extension_of(name)));
                    std::fs::write(&file, bytes)
                        .map_err(|e| format!("No se pudo restaurar la imagen: {e}"))?;
                    report.images_restored += 1;
                    restored.push(Attachment {
                        name: attachment.name.clone(),
                        text: attachment.text.clone(),
                        image_media_type: attachment.image_media_type.clone(),
                        image_file: Some(file.display().to_string()),
                    });
                }
                None => {
                    report.images_missing += 1;
                    restored.push(Attachment {
                        name: attachment.name.clone(),
                        text: attachment.text.clone(),
                        image_media_type: attachment.image_media_type.clone(),
                        image_file: None,
                    });
                }
            }
        }

        let attachments_json = if restored.is_empty() {
            None
        } else {
            Some(serde_json::to_string(&restored).map_err(|e| e.to_string())?)
        };
        let added = conn
            .execute(
                "INSERT OR IGNORE INTO messages (id, conversation_id, role, content, provider, created_at, attachments, reasoning, thinking_ms, web_sources, feedback)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    message.id,
                    message.conversation_id,
                    message.role,
                    message.content,
                    message.provider,
                    message.created_at,
                    attachments_json,
                    message.reasoning,
                    message.thinking_ms,
                    message.web_sources,
                    message.feedback
                ],
            )
            .map_err(|e| e.to_string())?;
        if added == 0 {
            report.skipped_existing += 1;
        } else {
            report.messages_added += 1;
        }
    }

    if let Some(settings) = &snapshot.settings {
        let already_set = db::get_setting(conn, "settings")?;
        if already_set.is_none() {
            db::set_setting(conn, "settings", &settings.to_string())?;
        }
    }

    Ok(report)
}

fn extension_of(name: &str) -> String {
    let raw = Path::new(name)
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    if raw.chars().all(|c| c.is_ascii_alphanumeric()) && raw.len() <= 5 && !raw.is_empty() {
        raw
    } else {
        "bin".to_string()
    }
}
