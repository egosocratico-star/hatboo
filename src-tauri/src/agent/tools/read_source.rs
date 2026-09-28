use super::{resolve_in_project, AgentTool, RiskLevel, ToolError};
use async_trait::async_trait;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

const MAX_BYTES: u64 = 200_000;

/**
 * Lee una de las fuentes que el usuario vinculó al proyecto.
 *
 * Es una puerta aparte a propósito: `read_file` sigue encerrada en la carpeta
 * del proyecto y `write_file` no ve estas rutas, así que vincular una carpeta no
 * abre NINGUNA vía de escritura fuera del sandbox. Cada ruta se valida contra la
 * raíz de ESA fuente con el mismo `resolve_in_project` de siempre, con lo que
 * «..» y las rutas absolutas se rechazan igual que dentro del proyecto.
 */
pub struct ReadSourceTool {
    /// Raíces canónicas en el mismo orden en que se numeran en el prompt.
    raices: Vec<PathBuf>,
    nombres: Vec<String>,
}

impl ReadSourceTool {
    pub fn nuevo(raices: Vec<PathBuf>, nombres: Vec<String>) -> Self {
        Self { raices, nombres }
    }
}

#[async_trait]
impl AgentTool for ReadSourceTool {
    fn name(&self) -> &str {
        "read_source"
    }

    fn description(&self) -> &str {
        "Lee un archivo de texto de una fuente vinculada al proyecto (solo lectura: \
         aquí nunca se escribe). Recibe el número de fuente tal como aparece en \
         «Fuentes de solo lectura» y una ruta relativa a esa fuente."
    }

    fn risk_level(&self) -> RiskLevel {
        RiskLevel::Low
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "fuente": { "type": "integer", "description": "Número de la fuente, desde 1" },
                "path": { "type": "string", "description": "Ruta relativa a la raíz de esa fuente" }
            },
            "required": ["fuente", "path"]
        })
    }

    async fn execute(&self, input: Value, _project_root: &Path) -> Result<Value, ToolError> {
        let numero = input["fuente"]
            .as_i64()
            .ok_or_else(|| ToolError::Other("Falta el parámetro 'fuente'".into()))?;
        let Some(i) = numero.checked_sub(1) else {
            return Err(ToolError::Other(format!(
                "La fuente {numero} no existe. Las vinculadas a este proyecto son: {}",
                self.nombres.join(", ")
            )));
        };
        let Some(raiz) = self.raices.get(i as usize) else {
            return Err(ToolError::Other(format!(
                "La fuente {numero} no existe. Las vinculadas a este proyecto son: {}",
                self.nombres.join(", ")
            )));
        };
        let rel = input["path"]
            .as_str()
            .ok_or_else(|| ToolError::Other("Falta el parámetro 'path'".into()))?;
        let path = resolve_in_project(raiz, rel)?;
        let meta = tokio::fs::metadata(&path)
            .await
            .map_err(|_| ToolError::Other(format!("No existe el archivo: {rel}")))?;
        if !meta.is_file() {
            return Err(ToolError::Other(format!(
                "{rel} no es un archivo. Para ver qué hay dentro de una carpeta usa \
                 list_source con la misma fuente."
            )));
        }
        if meta.len() > MAX_BYTES {
            return Err(ToolError::Other(format!(
                "Archivo demasiado grande para leer ({} bytes, límite {MAX_BYTES})",
                meta.len()
            )));
        }
        let content = tokio::fs::read_to_string(&path)
            .await
            .map_err(|_| ToolError::Other(format!("No se pudo leer como UTF-8: {rel}")))?;
        Ok(json!({ "fuente": numero, "path": rel, "content": content }))
    }
}

/** Lista el contenido de una carpeta vinculada. Sin esto, el agente no tiene
 *  forma de saber qué nombres pedir en `read_source`. */
pub struct ListSourceTool {
    /// Solo las fuentes que son carpeta, en el orden del prompt.
    carpetas: Vec<(usize, PathBuf)>,
    nombres: Vec<String>,
}

impl ListSourceTool {
    pub fn nuevo(carpetas: Vec<(usize, PathBuf)>, nombres: Vec<String>) -> Self {
        Self { carpetas, nombres }
    }
}

#[async_trait]
impl AgentTool for ListSourceTool {
    fn name(&self) -> &str {
        "list_source"
    }

    fn description(&self) -> &str {
        "Lista los archivos y carpetas de una fuente vinculada al proyecto \
         (solo lectura). Recibe el número de fuente y, si se quiere bajar a una \
         subcarpeta, una ruta relativa a esa fuente."
    }

    fn risk_level(&self) -> RiskLevel {
        RiskLevel::Low
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "fuente": { "type": "integer", "description": "Número de la fuente, desde 1" },
                "path": { "type": "string", "description": "Subcarpeta dentro de la fuente; vacío = la raíz" }
            },
            "required": ["fuente"]
        })
    }

    async fn execute(&self, input: Value, _project_root: &Path) -> Result<Value, ToolError> {
        let numero = input["fuente"]
            .as_i64()
            .ok_or_else(|| ToolError::Other("Falta el parámetro 'fuente'".into()))?;
        let Some((_, raiz)) = self.carpetas.iter().find(|(n, _)| *n as i64 == numero - 1) else {
            return Err(ToolError::Other(format!(
                "La fuente {numero} no es una carpeta vinculada. Las que se pueden listar: {}",
                if self.nombres.is_empty() { "ninguna".to_string() } else { self.nombres.join(", ") }
            )));
        };
        let rel = input["path"].as_str().unwrap_or("");
        let dir = if rel.is_empty() {
            raiz.clone()
        } else {
            resolve_in_project(raiz, rel)?
        };
        let mut entradas: Vec<String> = Vec::new();
        let lect = std::fs::read_dir(&dir).map_err(|e| ToolError::Other(e.to_string()))?;
        for e in lect.flatten() {
            let es_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
            let nombre = e.file_name().to_string_lossy().into_owned();
            entradas.push(if es_dir { format!("{nombre}/") } else { nombre });
            if entradas.len() >= 300 {
                entradas.push("… (más de 300 entradas)".to_string());
                break;
            }
        }
        entradas.sort();
        Ok(json!({ "fuente": numero, "entries": entradas }))
    }
}
