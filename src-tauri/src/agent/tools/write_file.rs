use super::{resolve_in_project, AgentTool, RiskLevel, ToolError};
use async_trait::async_trait;
use serde_json::{json, Value};
use similar::{ChangeTag, TextDiff};
use std::path::Path;

pub struct WriteFileTool;

fn extract(input: &Value) -> Result<(String, String), ToolError> {
    let rel = input["path"]
        .as_str()
        .ok_or_else(|| ToolError::Other("Falta el parámetro 'path'".into()))?;
    let content = input["content"]
        .as_str()
        .ok_or_else(|| ToolError::Other("Falta el parámetro 'content'".into()))?;
    Ok((rel.to_string(), content.to_string()))
}

fn unified_diff(rel: &str, old: &str, new: &str) -> String {
    if old.is_empty() && !new.is_empty() {
        return format!(
            "--- /dev/null\n+++ b/{rel}\n@@ -0,0 +1,{} @@\n{}",
            new.lines().count(),
            new.lines()
                .map(|l| format!("+{l}"))
                .collect::<Vec<_>>()
                .join("\n")
        );
    }
    let diff = TextDiff::from_lines(old, new);
    let mut out = format!("--- a/{rel}\n+++ b/{rel}\n");
    for group in diff.grouped_ops(3) {
        let changes: Vec<_> = group.iter().flat_map(|op| diff.iter_changes(op)).collect();
        if let Some(first) = changes.first() {
            out.push_str(&format!(
                "@@ -{} +{} @@\n",
                first.old_index().map(|i| i + 1).unwrap_or(0),
                first.new_index().map(|i| i + 1).unwrap_or(0)
            ));
        }
        for change in &changes {
            let marker = match change.tag() {
                ChangeTag::Delete => '-',
                ChangeTag::Insert => '+',
                ChangeTag::Equal => ' ',
            };
            for line in change.value().lines() {
                out.push_str(&format!("{marker}{line}\n"));
            }
        }
    }
    out
}

#[async_trait]
impl AgentTool for WriteFileTool {
    fn name(&self) -> &str {
        "write_file"
    }

    fn description(&self) -> &str {
        "Crea o sobreescribe un archivo de texto dentro del proyecto. Requiere aprobación del usuario; se muestra un diff antes de aplicar."
    }

    fn risk_level(&self) -> RiskLevel {
        RiskLevel::High
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "Ruta relativa al proyecto" },
                "content": { "type": "string", "description": "Contenido completo del archivo" }
            },
            "required": ["path", "content"]
        })
    }

    fn preview(&self, input: &Value, project_root: &Path) -> String {
        let Ok((rel, content)) = extract(input) else {
            return String::new();
        };
        let old = resolve_in_project(project_root, &rel)
            .ok()
            .and_then(|p| std::fs::read_to_string(p).ok())
            .unwrap_or_default();
        unified_diff(&rel, &old, &content)
    }

    async fn execute(&self, input: Value, project_root: &Path) -> Result<Value, ToolError> {
        let (rel, content) = extract(&input)?;
        let path = resolve_in_project(project_root, &rel)?;
        let existed = path.exists();
        let old = if existed {
            tokio::fs::read_to_string(&path).await.unwrap_or_default()
        } else {
            String::new()
        };
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        tokio::fs::write(&path, &content).await?;
        Ok(json!({
            "path": rel,
            "created": !existed,
            "bytes_written": content.len(),
            "diff": unified_diff(&rel, &old, &content),
        }))
    }
}
