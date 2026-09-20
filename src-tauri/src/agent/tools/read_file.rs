use super::{resolve_in_project, AgentTool, RiskLevel, ToolError};
use async_trait::async_trait;
use serde_json::{json, Value};
use std::path::Path;

const MAX_BYTES: u64 = 200_000;

const IMAGE_EXTS: [&str; 7] = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico"];

pub struct ReadFileTool;

#[async_trait]
impl AgentTool for ReadFileTool {
    fn name(&self) -> &str {
        "read_file"
    }

    fn description(&self) -> &str {
        "Lee el contenido de texto de un archivo dentro del proyecto. Recibe una ruta relativa a la raíz del proyecto. Solo funciona con archivos de texto: no lee imágenes ni binarios."
    }

    fn risk_level(&self) -> RiskLevel {
        RiskLevel::Low
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
        let ext = path
            .extension()
            .map(|e| e.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default();
        if IMAGE_EXTS.contains(&ext.as_str()) {
            return Err(ToolError::Other(format!(
                "{rel} es una imagen. El agente solo maneja texto y no puede ver imágenes; \
                 no hay modelo (con o sin visión) que reciba la imagen por esta vía. \
                 Trabaja a partir del HTML/CSS del mockup o pide al usuario que describa el diseño."
            )));
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
