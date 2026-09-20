pub mod list_dir;
pub mod read_file;
pub mod run_command;
pub mod search_files;
pub mod write_file;

use async_trait::async_trait;
use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};

pub use list_dir::ListDirTool;
pub use read_file::ReadFileTool;
pub use run_command::RunCommandTool;
pub use search_files::SearchFilesTool;
pub use write_file::WriteFileTool;

#[derive(Debug, thiserror::Error)]
pub enum ToolError {
    #[error("Ruta fuera del proyecto: {0}. El agente solo puede acceder a archivos dentro de la carpeta raíz.")]
    PathEscape(String),
    #[error("Error de E/S: {0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Other(String),
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

#[async_trait]
pub trait AgentTool: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn requires_approval(&self) -> bool;
    fn input_schema(&self) -> Value;

    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: self.name().to_string(),
            description: self.description().to_string(),
            input_schema: self.input_schema(),
        }
    }

    /// Texto legible para el modal de aprobación (diff, comando, etc.).
    fn preview(&self, _input: &Value, _project_root: &Path) -> String {
        String::new()
    }

    async fn execute(&self, input: Value, project_root: &Path) -> Result<Value, ToolError>;
}

/// Canonicaliza `rel` y garantiza que quede dentro de `project_root`.
/// Para rutas inexistentes (creación de archivos) se valida el ancestro
/// existente más profundo, sin seguir symlinks ya resueltos.
pub fn resolve_in_project(project_root: &Path, rel: &str) -> Result<PathBuf, ToolError> {
    let root = project_root.canonicalize()?;
    let bytes = rel.as_bytes();
    let is_absolute = bytes.starts_with(b"/")
        || bytes.starts_with(b"\\")
        || (bytes.len() > 1 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic());
    if is_absolute {
        return Err(ToolError::PathEscape(rel.to_string()));
    }
    let mut candidate = root.clone();
    for part in rel.replace('\\', "/").split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            return Err(ToolError::PathEscape(rel.to_string()));
        }
        candidate.push(part);
    }
    // El resultado ya no contiene ".."; comprobar prefijo sobre la raíz canónica.
    let existing = {
        let mut p = candidate.as_path();
        while !p.exists() {
            match p.parent() {
                Some(parent) => p = parent,
                None => return Err(ToolError::PathEscape(rel.to_string())),
            }
        }
        p.canonicalize().map_err(|_| ToolError::PathEscape(rel.to_string()))?
    };
    if !existing.starts_with(&root) {
        return Err(ToolError::PathEscape(rel.to_string()));
    }
    Ok(candidate)
}

/// Registro de herramientas para una sesión de trabajo.
pub fn build_tools(run_command_enabled: bool) -> Vec<Box<dyn AgentTool>> {
    let mut tools: Vec<Box<dyn AgentTool>> = vec![
        Box::new(ReadFileTool),
        Box::new(ListDirTool),
        Box::new(SearchFilesTool),
        Box::new(WriteFileTool),
    ];
    if run_command_enabled {
        tools.push(Box::new(RunCommandTool));
    }
    tools
}
