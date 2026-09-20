use super::{AgentTool, ToolError};
use async_trait::async_trait;
use serde_json::{json, Value};
use std::path::Path;
use std::time::Duration;

const TIMEOUT_SECS: u64 = 120;
const MAX_OUTPUT: usize = 20_000;

pub struct RunCommandTool;

#[async_trait]
impl AgentTool for RunCommandTool {
    fn name(&self) -> &str {
        "run_command"
    }

    fn description(&self) -> &str {
        "Ejecuta un comando de shell dentro de la carpeta del proyecto. Siempre requiere aprobación explícita del usuario."
    }

    fn requires_approval(&self) -> bool {
        true
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "command": { "type": "string", "description": "Comando completo a ejecutar, p. ej. cargo test" }
            },
            "required": ["command"]
        })
    }

    fn preview(&self, input: &Value, _project_root: &Path) -> String {
        format!("$ {}", input["command"].as_str().unwrap_or("?"))
    }

    async fn execute(&self, input: Value, project_root: &Path) -> Result<Value, ToolError> {
        let command = input["command"]
            .as_str()
            .filter(|c| !c.trim().is_empty())
            .ok_or_else(|| ToolError::Other("Falta el parámetro 'command'".into()))?
            .to_string();
        let cwd = project_root.canonicalize()?;
        let command_display = command.clone();

        let output = tokio::time::timeout(
            Duration::from_secs(TIMEOUT_SECS),
            tokio::task::spawn_blocking(move || {
                #[cfg(windows)]
                let mut cmd = {
                    let mut c = std::process::Command::new("cmd");
                    c.args(["/C", &command]);
                    c
                };
                #[cfg(not(windows))]
                let mut cmd = {
                    let mut c = std::process::Command::new("sh");
                    c.args(["-c", &command]);
                    c
                };
                cmd.current_dir(&cwd).output()
            }),
        )
        .await
        .map_err(|_| ToolError::Other(format!("El comando superó el tiempo máximo de {TIMEOUT_SECS}s")))?
        .map_err(|e| ToolError::Other(format!("No se pudo ejecutar el comando: {e}")))??;

        let trim = |s: String| {
            if s.len() > MAX_OUTPUT {
                format!("{}…[recortado]", &s[..MAX_OUTPUT])
            } else {
                s
            }
        };
        Ok(json!({
            "command": command_display,
            "exit_code": output.status.code(),
            "stdout": trim(String::from_utf8_lossy(&output.stdout).into_owned()),
            "stderr": trim(String::from_utf8_lossy(&output.stderr).into_owned()),
        }))
    }
}
