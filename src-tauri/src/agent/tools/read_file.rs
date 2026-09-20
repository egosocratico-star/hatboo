use super::{resolve_in_project, AgentTool, ToolError};
use async_trait::async_trait;
use serde_json::{json, Value};
use std::path::Path;

const MAX_BYTES: u64 = 200_000;

pub struct ReadFileTool;

#[async_trait]
impl AgentTool for ReadFileTool {
    fn name(&self) -> &str {
        "read_file"
    }

    fn description(&self) -> &str {
        "Lee el contenido de texto de un archivo dentro del proyecto. Recibe una ruta relativa a la raíz del proyecto."
    }

    fn requires_approval(&self) -> bool {
        false
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "Ruta relativa al proyecto, p. ej. src/main.rs" }
            },
            "required": ["path"]
        })
    }

    async fn execute(&self, input: Value, project_root: &Path) -> Result<Value, ToolError> {
        let rel = input["path"]
            .as_str()
            .ok_or_else(|| ToolError::Other("Falta el parámetro 'path'".into()))?;
        let path = resolve_in_project(project_root, rel)?;
        let meta = tokio::fs::metadata(&path)
            .await
            .map_err(|_| ToolError::Other(format!("No existe el archivo: {rel}")))?;
        if !meta.is_file() {
            return Err(ToolError::Other(format!("No es un archivo: {rel}")));
        }
        if meta.len() > MAX_BYTES {
            return Err(ToolError::Other(format!(
                "Archivo demasiado grande para leer ({}` bytes, límite {MAX_BYTES})",
                meta.len()
            )));
        }
        let content = tokio::fs::read_to_string(&path)
            .await
            .map_err(|_| ToolError::Other(format!("No se pudo leer como UTF-8: {rel}")))?;
        Ok(json!({ "path": rel, "content": content }))
    }
}
