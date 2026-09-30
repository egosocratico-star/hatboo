use super::{resolve_in_project, AgentTool, RiskLevel, ToolError};
use crate::agent::ignore;
use async_trait::async_trait;
use serde_json::{json, Value};
use std::path::Path;

/// `ignora` es la lista de los ajustes (`ignore_dirs`), la MISMA que usa el árbol
/// de Archivos: si una carpeta no se ve en el panel, tampoco aquí, y al revés.
pub struct ListDirTool {
    ignora: Vec<String>,
}

impl ListDirTool {
    pub fn nuevo(ignora: Vec<String>) -> Self {
        Self { ignora }
    }
}

#[async_trait]
impl AgentTool for ListDirTool {
    fn name(&self) -> &str {
        "list_dir"
    }

    fn description(&self) -> &str {
        "Lista el contenido de una carpeta del proyecto (nombre, si es archivo o directorio y tamaño). Ruta vacía = raíz del proyecto. Las carpetas de la lista de ignoradas (`.git`, `node_modules`, `target`…) no aparecen: no intentes adivinar su contenido, y si necesitas una pídesela al usuario, que la quita en Ajustes → Agente."
    }

    fn risk_level(&self) -> RiskLevel {
        RiskLevel::Low
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
        let mut leidas = 0usize;
        let mut read_dir = tokio::fs::read_dir(&path)
            .await
            .map_err(|_| ToolError::Other(format!("No existe el directorio: {rel}")))?;
        while let Some(entry) = read_dir.next_entry().await? {
            let nombre = entry.file_name().to_string_lossy().into_owned();
            leidas += 1;
            if ignore::ignora(&nombre, &self.ignora) {
                continue;
            }
            let file_type = entry.file_type().await.ok();
            let size = entry.metadata().await.ok().map(|m| m.len()).unwrap_or(0);
            entries.push(json!({
                "name": nombre,
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
        // Se dice cuántas se saltaron y por qué número: sin esto, un `node_modules`
        // invisible es una invitación a que el modelo afirme que la carpeta no existe.
        Ok(json!({
            "path": rel,
            "entries": entries,
            "omitidas_por_ignoradas": leidas - entries.len(),
        }))
    }
}
