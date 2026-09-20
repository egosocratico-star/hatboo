use super::{AgentTool, ToolError};
use async_trait::async_trait;
use serde_json::{json, Value};
use std::path::Path;
use walkdir::WalkDir;

const SKIP_DIRS: &[&str] = &[".git", "node_modules", "target", "dist", "__pycache__", ".venv"];
const MAX_FILE_BYTES: u64 = 1_000_000;
const MAX_MATCHES: usize = 200;

pub struct SearchFilesTool;

#[async_trait]
impl AgentTool for SearchFilesTool {
    fn name(&self) -> &str {
        "search_files"
    }

    fn description(&self) -> &str {
        "Busca un texto (sin distinción de mayúsculas) en todos los archivos del proyecto, tipo grep. Devuelve archivo:línea:contenido."
    }

    fn requires_approval(&self) -> bool {
        false
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "query": { "type": "string", "description": "Texto a buscar" },
                "glob": { "type": "string", "description": "Filtro opcional de nombres de archivo, p. ej. .rs o .tsx" }
            },
            "required": ["query"]
        })
    }

    async fn execute(&self, input: Value, project_root: &Path) -> Result<Value, ToolError> {
        let query = input["query"]
            .as_str()
            .filter(|q| !q.is_empty())
            .ok_or_else(|| ToolError::Other("Falta el parámetro 'query'".into()))?
            .to_lowercase();
        let glob = input["glob"].as_str().map(|g| g.to_lowercase());

        let root = project_root.canonicalize()?;
        tokio::task::spawn_blocking(move || {
            let mut matches: Vec<String> = Vec::new();
            let walker = WalkDir::new(&root)
                .max_depth(12)
                .into_iter()
                .filter_entry(|e| {
                    let name = e.file_name().to_string_lossy();
                    !e.file_type().is_dir() || !SKIP_DIRS.contains(&name.as_ref())
                });
            for entry in walker.flatten() {
                if matches.len() >= MAX_MATCHES {
                    break;
                }
                let path = entry.path();
                if !path.is_file() {
                    continue;
                }
                if let Some(g) = &glob {
                    let file_name = entry.file_name().to_string_lossy().to_lowercase();
                    let needle = g.trim_start_matches('*').trim_start_matches('.');
                    let ext = file_name.rsplit('.').next().unwrap_or("");
                    if !file_name.contains(needle) && ext != needle {
                        continue;
                    }
                }
                if path.metadata().map(|m| m.len() > MAX_FILE_BYTES).unwrap_or(true) {
                    continue;
                }
                let Ok(content) = std::fs::read_to_string(path) else {
                    continue;
                };
                let rel = path.strip_prefix(&root).unwrap_or(path).display().to_string();
                for (line_no, line) in content.lines().enumerate() {
                    if line.to_lowercase().contains(&query) {
                        matches.push(format!("{rel}:{}:{}", line_no + 1, line.trim()));
                        if matches.len() >= MAX_MATCHES {
                            break;
                        }
                    }
                }
            }
            Ok(json!({
                "query": query,
                "matches": matches,
                "truncated": matches.len() >= MAX_MATCHES,
            }))
        })
        .await
        .map_err(|e| ToolError::Other(format!("La búsqueda falló: {e}")))?
    }
}
