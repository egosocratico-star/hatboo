pub mod git;
pub mod imagen;
pub mod list_dir;
pub mod read_file;
pub mod read_source;
pub mod run_command;
pub mod search_files;
pub mod web_search;
pub mod write_file;

use async_trait::async_trait;
use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};

pub use git::{GitCommitTool, GitDiffTool, GitLogTool, GitStatusTool};
pub use imagen::GenerateImageTool;
pub use list_dir::ListDirTool;
pub use read_file::ReadFileTool;
pub use read_source::{ListSourceTool, ReadSourceTool};
pub use run_command::RunCommandTool;
pub use search_files::SearchFilesTool;
pub use web_search::WebSearchTool;
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RiskLevel {
    Low,
    High,
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
    fn risk_level(&self) -> RiskLevel;
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

/// Registro de herramientas para una sesión de trabajo. `web_search` es el mismo
/// interrupto 🌐 del chat: sin él el agente no puede salir a internet. Y la de
/// imagen solo se ofrece si en Ajustes hay un motor elegido, porque ofrecerla
/// apagada es prometer un dibujo que tiene que fallar.
/// El último tramo de la ruta, para poder nombrar la fuente en el prompt y en el
/// error sin escribir la ruta absoluta entera dos veces.
fn nombre_de_ruta(ruta: &str) -> String {
    Path::new(ruta)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| ruta.to_string())
}

pub fn build_tools(s: &crate::state::Settings, fuentes: &[crate::db::Fuente]) -> Vec<Box<dyn AgentTool>> {
    let mut tools: Vec<Box<dyn AgentTool>> = vec![
        Box::new(ReadFileTool),
        Box::new(ListDirTool),
        Box::new(SearchFilesTool),
        Box::new(WriteFileTool),
        Box::new(GitStatusTool),
        Box::new(GitDiffTool),
        Box::new(GitLogTool),
        Box::new(GitCommitTool),
    ];
    // Las dos puertas de lectura de fuentes solo se ofrecen si hay alguna
    // vinculada: ofrecerlas vacías es una invitación a que el modelo invente rutas.
    if !fuentes.is_empty() {
        let raices: Vec<(usize, PathBuf, String)> = fuentes
            .iter()
            .enumerate()
            .map(|(i, f)| (i, PathBuf::from(&f.ruta), nombre_de_ruta(&f.ruta)))
            .collect();
        tools.push(Box::new(ReadSourceTool::nuevo(
            raices.iter().map(|(_, r, _)| r.clone()).collect(),
            raices.iter().map(|(_, _, n)| n.clone()).collect(),
        )));
        let carpetas: Vec<(usize, PathBuf)> = raices
            .iter()
            .filter(|(_, r, _)| r.is_dir())
            .map(|(i, r, _)| (*i, r.clone()))
            .collect();
        if !carpetas.is_empty() {
            let nombres: Vec<String> = carpetas
                .iter()
                .filter_map(|(i, _)| {
                    raices
                        .iter()
                        .find(|(j, _, _)| j == i)
                        .map(|(_, _, n)| n.clone())
                })
                .collect();
            tools.push(Box::new(ListSourceTool::nuevo(carpetas, nombres)));
        }
    }
    if s.run_command_enabled {
        tools.push(Box::new(RunCommandTool));
    }
    if s.web_search {
        tools.push(Box::new(WebSearchTool));
    }
    if let Some(imagen) = GenerateImageTool::desde_ajustes(s) {
        tools.push(Box::new(imagen));
    }
    tools
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::Settings;

    fn nombres(run_command: bool, web_search: bool, motor: &str) -> Vec<String> {
        let mut s = Settings::default();
        s.run_command_enabled = run_command;
        s.web_search = web_search;
        s.image_provider = motor.to_string();
        build_tools(&s, &[])
            .iter()
            .map(|t| t.name().to_string())
            .collect()
    }

    fn fuente(ruta: &str, tipo: &str) -> crate::db::Fuente {
        crate::db::Fuente {
            id: "f".to_string(),
            project_id: "p".to_string(),
            ruta: ruta.to_string(),
            tipo: tipo.to_string(),
            creado_en: 0,
        }
    }

    #[test]
    fn las_fuentes_solo_abren_su_puerta_si_hay_alguna() {
        // Sin fuentes vinculadas, el agente no ve `read_source`: ofrecerla vacía es
        // invitarle a inventarse una ruta.
        let base = nombres(false, false, "");
        assert!(!base.contains(&"read_source".to_string()));
        assert!(!base.contains(&"list_source".to_string()));

        // Una carpeta que existe de verdad abre las dos; un archivo suelto solo la
        // de lectura, porque no hay nada que listar.
        let dir = std::env::temp_dir().join(format!("hatboo-fuente-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let archivo = dir.join("nota.txt");
        std::fs::write(&archivo, "hola").unwrap();
        con_fuente(&dir.to_string_lossy(), "carpeta", |t| {
            assert!(t.contains(&"read_source".to_string()));
            assert!(t.contains(&"list_source".to_string()));
        });
        con_fuente(&archivo.to_string_lossy(), "archivo", |t| {
            assert!(t.contains(&"read_source".to_string()));
            assert!(!t.contains(&"list_source".to_string()));
        });
        let _ = std::fs::remove_dir_all(dir);
    }

    fn con_fuente(ruta: &str, tipo: &str, prueba: impl Fn(Vec<String>)) {
        let mut s = Settings::default();
        s.run_command_enabled = false;
        s.web_search = false;
        s.image_provider = String::new();
        let nombres: Vec<String> = build_tools(&s, &[fuente(ruta, tipo)])
            .iter()
            .map(|t| t.name().to_string())
            .collect();
        prueba(nombres);
    }

    #[test]
    fn las_tools_de_red_y_comandos_solo_aparecen_si_estan_activadas() {
        let base = nombres(false, false, "");
        assert!(!base.contains(&"run_command".to_string()));
        assert!(!base.contains(&"web_search".to_string()));
        assert!(nombres(false, true, "").contains(&"web_search".to_string()));
        assert!(nombres(true, false, "").contains(&"run_command".to_string()));
    }

    #[test]
    fn dibujar_solo_se_ofrece_con_motor_apuntado() {
        assert!(!nombres(false, false, "").contains(&"generate_image".to_string()));
        assert!(nombres(false, false, "gemini").contains(&"generate_image".to_string()));
    }
}
