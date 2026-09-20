use super::{resolve_in_project, AgentTool, RiskLevel, ToolError};
use async_trait::async_trait;
use serde_json::{json, Value};
use std::path::Path;
use std::process::{Command, Output};

const MAX_GIT_OUTPUT: usize = 60_000;

/// Ejecuta `git` dentro de la raíz del proyecto (nunca fuera de ella).
pub fn git_output(root: &Path, args: &[&str]) -> Result<Output, ToolError> {
    Command::new("git")
        .arg("--no-pager")
        .args(args)
        .current_dir(root)
        .output()
        .map_err(|_| ToolError::Other("Git no está instalado o no está en el PATH.".into()))
}

fn git_text(root: &Path, args: &[&str]) -> Result<String, ToolError> {
    let out = git_output(root, args)?;
    if !out.status.success() {
        return Err(ToolError::Other(format!(
            "git {} falló: {}",
            args.first().copied().unwrap_or(""),
            String::from_utf8_lossy(&out.stderr).trim()
        )));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// True solo si `root` ES la raíz del repositorio (no un subdirectorio de un
/// repo padre, p. ej. la carpeta home en Windows).
pub fn is_git_repo(root: &Path) -> bool {
    let Ok(out) = git_output(root, &["rev-parse", "--show-toplevel"]) else {
        return false;
    };
    if !out.status.success() {
        return false;
    }
    let top = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let Ok(top) = std::fs::canonicalize(&top) else {
        return false;
    };
    let Ok(rootc) = std::fs::canonicalize(root) else {
        return false;
    };
    top == rootc
}

fn ensure_repo(root: &Path) -> Result<(), ToolError> {
    if is_git_repo(root) {
        Ok(())
    } else {
        Err(ToolError::Other(
            "Este proyecto no es un repositorio git.".into(),
        ))
    }
}

/// Resumen ligero para la cabecera de la UI: (rama, archivos modificados).
pub fn repo_summary(root: &Path) -> Option<(String, usize)> {
    let raw = git_text(root, &["status", "--porcelain=v1", "--branch"]).ok()?;
    let mut branch = String::new();
    let mut dirty = 0usize;
    for line in raw.lines() {
        if let Some(b) = line.strip_prefix("## ") {
            branch = b.split("...").next().unwrap_or(b).to_string();
        } else if !line.trim().is_empty() {
            dirty += 1;
        }
    }
    Some((branch, dirty))
}

fn trim_output(s: String) -> String {
    if s.len() > MAX_GIT_OUTPUT {
        let mut end = MAX_GIT_OUTPUT;
        while !s.is_char_boundary(end) {
            end -= 1;
        }
        format!("{}\n…[salida recortada]", &s[..end])
    } else {
        s
    }
}

async fn run_blocking<T, F>(f: F) -> Result<T, ToolError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, ToolError> + Send + 'static,
{
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|_| ToolError::Other("La operación git no pudo ejecutarse".into()))?
}

/// git_status: branch + archivos modificados.
pub struct GitStatusTool;

#[async_trait]
impl AgentTool for GitStatusTool {
    fn name(&self) -> &str {
        "git_status"
    }
    fn description(&self) -> &str {
        "Muestra la rama actual y el estado del working tree (archivos modificados, añadidos o borrados)."
    }
    fn risk_level(&self) -> RiskLevel {
        RiskLevel::Low
    }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "properties": {} })
    }
    async fn execute(&self, _input: Value, root: &Path) -> Result<Value, ToolError> {
        let root = root.to_path_buf();
        let raw = tokio::task::spawn_blocking(move || -> Result<String, ToolError> {
            ensure_repo(&root)?;
            git_text(&root, &["status", "--porcelain=v1", "--branch"])
        })
        .await
        .map_err(|_| ToolError::Other("La operación git no pudo ejecutarse".into()))??;

        let mut branch = String::new();
        let mut changes = Vec::new();
        for line in raw.lines() {
            if let Some(b) = line.strip_prefix("## ") {
                branch = b.split("...").next().unwrap_or(b).to_string();
            } else if line.len() > 3 {
                changes.push(json!({
                    "status": line[..2].trim_end(),
                    "path": line[3..],
                }));
            }
        }
        Ok(json!({ "branch": branch, "clean": changes.is_empty(), "changes": changes }))
    }
}

/// git_diff: diff contra HEAD (o del índice), opcionalmente por archivo.
pub struct GitDiffTool;

#[async_trait]
impl AgentTool for GitDiffTool {
    fn name(&self) -> &str {
        "git_diff"
    }
    fn description(&self) -> &str {
        "Muestra el diff sin commitear (contra HEAD). Opcionalmente limitado a una ruta relativa del proyecto."
    }
    fn risk_level(&self) -> RiskLevel {
        RiskLevel::Low
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "Ruta relativa opcional para limitar el diff" },
                "staged": { "type": "boolean", "description": "true para ver el índice (git add) en vez del working tree" }
            }
        })
    }
    async fn execute(&self, input: Value, root: &Path) -> Result<Value, ToolError> {
        let rel = input["path"].as_str().unwrap_or("");
        let staged = input["staged"].as_bool().unwrap_or(false);
        // Validar la ruta ANTES de tocar git.
        if !rel.is_empty() {
            resolve_in_project(root, rel)?;
        }
        let root = root.to_path_buf();
        let rel_owned = rel.to_string();
        let diff = tokio::task::spawn_blocking(move || -> Result<String, ToolError> {
            ensure_repo(&root)?;
            let mut args = vec!["diff"];
            if staged {
                args.push("--cached");
            }
            if !rel_owned.is_empty() {
                args.push("--");
                args.push(&rel_owned);
            }
            git_text(&root, &args)
        })
        .await
        .map_err(|_| ToolError::Other("La operación git no pudo ejecutarse".into()))??;

        let empty = diff.trim().is_empty();
        Ok(json!({ "diff": trim_output(diff), "empty": empty }))
    }
}

/// git_log: últimos commits.
pub struct GitLogTool;

#[async_trait]
impl AgentTool for GitLogTool {
    fn name(&self) -> &str {
        "git_log"
    }
    fn description(&self) -> &str {
        "Lista los commits más recientes del repositorio (hash, autor, fecha y mensaje)."
    }
    fn risk_level(&self) -> RiskLevel {
        RiskLevel::Low
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "limit": { "type": "integer", "description": "Cuántos commits traer (por defecto 20, máximo 100)" }
            }
        })
    }
    async fn execute(&self, input: Value, root: &Path) -> Result<Value, ToolError> {
        let limit = input["limit"].as_i64().unwrap_or(20).clamp(1, 100).to_string();
        let root = root.to_path_buf();
        let raw = tokio::task::spawn_blocking(move || -> Result<String, ToolError> {
            ensure_repo(&root)?;
            git_text(
                &root,
                &[
                    "log",
                    &format!("-n{limit}"),
                    "--pretty=format:%h|%an|%ad|%s",
                    "--date=short",
                ],
            )
        })
        .await
        .map_err(|_| ToolError::Other("La operación git no pudo ejecutarse".into()))??;

        let commits: Vec<Value> = raw
            .lines()
            .filter_map(|line| {
                let mut parts = line.splitn(4, '|');
                Some(json!({
                    "hash": parts.next()?,
                    "author": parts.next()?,
                    "date": parts.next()?,
                    "message": parts.next().unwrap_or(""),
                }))
            })
            .collect();
        Ok(json!({ "commits": commits }))
    }
}

/// git_commit: stagea rutas elegidas y hace commit. Siempre con aprobación.
pub struct GitCommitTool;

#[async_trait]
impl AgentTool for GitCommitTool {
    fn name(&self) -> &str {
        "git_commit"
    }
    fn description(&self) -> &str {
        "Stagea los archivos indicados (o todos si `paths` va vacío) y crea un commit con el mensaje dado. Requiere aprobación del usuario."
    }
    fn risk_level(&self) -> RiskLevel {
        RiskLevel::High
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "message": { "type": "string", "description": "Mensaje del commit" },
                "paths": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Rutas relativas a stagear; vacío = todos los cambios"
                }
            },
            "required": ["message"]
        })
    }
    fn preview(&self, input: &Value, root: &Path) -> String {
        let message = input["message"].as_str().unwrap_or("");
        let paths: Vec<&str> = input["paths"]
            .as_array()
            .map(|a| a.iter().filter_map(|p| p.as_str()).collect())
            .unwrap_or_default();
        let status = if is_git_repo(root) {
            let st = git_output(root, &["status", "--short"])
                .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
                .unwrap_or_default();
            let scope = if paths.is_empty() {
                "TODOS los cambios".to_string()
            } else {
                paths.join(", ")
            };
            format!("Se hará commit de: {scope}\n\nMensaje: {message}\n\nEstado actual:\n{st}")
        } else {
            "El proyecto no es un repositorio git.".to_string()
        };
        trim_output(status)
    }
    async fn execute(&self, input: Value, root: &Path) -> Result<Value, ToolError> {
        let message = input["message"].as_str().unwrap_or("").trim().to_string();
        if message.is_empty() {
            return Err(ToolError::Other("El mensaje del commit está vacío.".into()));
        }
        let paths: Vec<String> = input["paths"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|p| p.as_str())
                    .map(|s| s.to_string())
                    .collect()
            })
            .unwrap_or_default();
        // Validar todas las rutas contra el sandbox antes de tocar git.
        for p in &paths {
            resolve_in_project(root, p)?;
        }
        let root = root.to_path_buf();
        Ok(run_blocking(move || {
            ensure_repo(&root)?;
            if paths.is_empty() {
                git_text(&root, &["add", "-A"])?;
            } else {
                let mut args = vec!["add", "--"];
                args.extend(paths.iter().map(|p| p.as_str()));
                git_text(&root, &args)?;
            }
            // --quiet sale con 0 si no hay nada staged; con 1 si hay cambios.
            if git_text(&root, &["diff", "--cached", "--quiet"]).is_ok() {
                return Err(ToolError::Other("No hay cambios que commitear.".into()));
            }
            git_text(&root, &["commit", "-m", &message])?;
            let hash = git_text(&root, &["rev-parse", "--short", "HEAD"])?.trim().to_string();
            let summary =
                git_text(&root, &["show", "--stat", "--oneline", "--no-patch", &hash])?;
            Ok(json!({ "committed": hash, "summary": summary }))
        })
        .await?)
    }
}
