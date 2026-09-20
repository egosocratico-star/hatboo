use super::{resolve_in_project, AgentTool, ToolError};
use async_trait::async_trait;
use serde_json::{json, Value};
use std::path::Path;

pub struct ListDirTool;

#[async_trait]
impl AgentTool for ListDirTool {
    fn name(&self) -> &str {
        "list_dir"
    }

    fn description(&self) -> &str {
        "Lista el contenido de una carpeta del proyecto (nombre, si es archivo o directorio y tamaño). Ruta vacía = raíz del proyecto."
    }

    fn requires_approval(&self) -> bool {
        false
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "Ruta relativa al directorio; '' para la raíz" }
            },
            "required": ["path"]
        })
    }

    async fn execute(&self, input: Value, project_root: &Path) -> Result<Value, ToolError> {
        let rel = input["path"].as_str().unwrap_or("");
        let path = resolve_in_project(project_root, rel)?;
        let mut entries = Vec::new();
        let mut read_dir = tokio::fs::read_dir(&path)
            .await
            .map_err(|_| ToolError::Other(format!("No existe el directorio: {rel}")))?;
        while let Some(entry) = read_dir.next_entry().await? {
            let file_type = entry.file_type().await.ok();
            let size = entry.metadata().await.ok().map(|m| m.len()).unwrap_or(0);
            entries.push(json!({
                "name": entry.file_name().to_string_lossy(),
                "is_dir": file_type.map(|t| t.is_dir()).unwrap_or(false),
                "size": size,
            }));
            if entries.len() >= 500 {
                break;
            }
        }
        entries.sort_by(|a, b| {
            b["is_dir"]
                .as_bool()
                .unwrap_or(false)
                .cmp(&a["is_dir"].as_bool().unwrap_or(false))
                .then(a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or("")))
        });
        Ok(json!({ "path": rel, "entries": entries }))
    }
}
