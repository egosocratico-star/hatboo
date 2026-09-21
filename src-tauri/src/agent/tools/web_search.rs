use super::{AgentTool, RiskLevel, ToolError};
use crate::web;
use async_trait::async_trait;
use serde_json::{json, Value};
use std::path::Path;

pub struct WebSearchTool;

#[async_trait]
impl AgentTool for WebSearchTool {
    fn name(&self) -> &str {
        "web_search"
    }

    fn description(&self) -> &str {
        "Busca en internet (DuckDuckGo) y devuelve título, enlace y fragmento de cada resultado. \
         Útil para datos recientes que el modelo no conoce: versiones, precios, noticias, \
         documentación. Cita el enlace de la fuente en la respuesta."
    }

    /// Alto a propósito: esta tool saca datos de la máquina (la consulta viaja a
    /// DuckDuckGo), así que con el nivel por defecto pide aprobación y se ve
    /// exactamente qué se va a buscar.
    fn risk_level(&self) -> RiskLevel {
        RiskLevel::High
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "query": { "type": "string", "description": "Lo que se busca en internet" }
            },
            "required": ["query"]
        })
    }

    fn preview(&self, input: &Value, _project_root: &Path) -> String {
        format!("Buscar en la web: «{}»", input["query"].as_str().unwrap_or("?"))
    }

    async fn execute(&self, input: Value, _project_root: &Path) -> Result<Value, ToolError> {
        let query = input["query"]
            .as_str()
            .filter(|q| !q.trim().is_empty())
            .ok_or_else(|| ToolError::Other("Falta el parámetro 'query'".into()))?;
        let results = web::search_web(query)
            .await
            .map_err(ToolError::Other)?;
        Ok(json!({
            "query": query,
            "results": results,
            "empty": results.is_empty(),
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::tools::AgentTool;

    #[test]
    fn es_de_riesgo_alto_y_el_preview_ensenala_consulta() {
        let tool = WebSearchTool;
        assert_eq!(tool.risk_level(), RiskLevel::High);
        let preview = tool.preview(&json!({ "query": "versión de tauri" }), Path::new("/tmp"));
        assert_eq!(preview, "Buscar en la web: «versión de tauri»");
        assert_eq!(tool.input_schema()["required"][0], json!("query"));
    }
}
