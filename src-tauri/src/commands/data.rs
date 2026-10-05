//! Datos: exportar, importar y el restablecimiento de fábrica.

use crate::backup;
use crate::db;
use crate::providers;
use crate::state::AppState;
use serde::Serialize;
use std::path::Path;
use tauri::State;

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
        let msgs = db::hilo_activo(&conn, &conversation_id)?;
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
    for provider in ["anthropic", "openai", "openrouter", "gemini", "hf", "groq"] {
        let _ = providers::delete_api_key(provider);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;


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
                brain_datos: None,
                parent_id: None,
                variantas: None,
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
