use crate::agent::tools::{self, ToolDefinition};
use crate::db;
use crate::providers::tool_calling::{AgentMessage, AgentResponse, ToolCallRequest};
use crate::state::{self, AppState};
use serde::Serialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tauri::{Emitter, Manager};

const MAX_ITERATIONS: usize = 25;
const MAX_TOOL_OUTPUT: usize = 12_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlanPayload {
    conversation_id: String,
    tasks: Vec<db::Task>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StepResultPayload {
    conversation_id: String,
    tasks: Vec<db::Task>,
    tool_name: String,
    ok: bool,
    brief: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApprovalNeededPayload {
    conversation_id: String,
    tool_call_id: String,
    tool_name: String,
    input: Value,
    preview: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DonePayload {
    conversation_id: String,
    summary: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorPayload {
    conversation_id: String,
    message: String,
}

fn meta_tool_definitions() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            name: "submit_plan".into(),
            description: "Registra el plan de pasos para la tarea actual. DEBE llamarse una sola vez antes de cualquier otra acción.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "steps": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Descripción breve de cada paso, en orden"
                    }
                },
                "required": ["steps"]
            }),
        },
        ToolDefinition {
            name: "update_step".into(),
            description: "Actualiza el estado de un paso del plan. Marca in_progress antes de trabajar en un paso y done al terminarlo.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "step_order": { "type": "integer", "description": "Número de paso (1-based)" },
                    "status": { "type": "string", "enum": ["in_progress", "done", "failed"] }
                },
                "required": ["step_order", "status"]
            }),
        },
    ]
}

fn system_prompt(project_root: &Path) -> String {
    let listing = list_dir_brief(project_root);
    format!(
        "Eres Hatboo, un agente de trabajo que opera DENTRO del proyecto del usuario.\n\
         Raíz del proyecto: {}\n\n\
         Estructura inicial:\n{}\n\n\
         Reglas obligatorias:\n\
         1. Primero llama a submit_plan con los pasos necesarios (máximo 6, concretos).\n\
         2. Antes de trabajar en un paso márcalo con update_step a in_progress; al acabarlo, a done.\n\
         3. Usa read_file / list_dir / search_files sin problema; write_file y run_command pidenán aprobación al usuario.\n\
         4. Todas las rutas son relativas a la raíz del proyecto; nunca intentes salir de ella.\n\
         5. Cuando hayas terminado todos los pasos, responde SOLO con un resumen final en español, sin tool calls.\n\
         6. Responde siempre en español al usuario.",
        project_root.display(),
        listing
    )
}

fn list_dir_brief(root: &Path) -> String {
    let mut out = String::new();
    if let Ok(entries) = std::fs::read_dir(root) {
        let mut names: Vec<String> = entries
            .flatten()
            .map(|e| {
                let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
                let name = e.file_name().to_string_lossy().into_owned();
                if is_dir {
                    format!("{name}/")
                } else {
                    name
                }
            })
            .collect();
        names.sort();
        names.truncate(60);
        out = names.join("\n");
    }
    if out.is_empty() {
        out = "(vacío)".to_string();
    }
    out
}

fn truncate_for_model(s: String) -> String {
    if s.len() > MAX_TOOL_OUTPUT {
        let mut end = MAX_TOOL_OUTPUT;
        while !s.is_char_boundary(end) {
            end -= 1;
        }
        format!("{}…[recortado]", &s[..end])
    } else {
        s
    }
}

/// Bucle principal: plan → ejecuta → reporta.
pub async fn run_work_task(
    app: tauri::AppHandle,
    conversation_id: String,
    project_root: PathBuf,
    user_request: String,
) {
    let result = run_loop(&app, &conversation_id, &project_root, &user_request).await;
    if let Err(message) = result {
        let state = app.state::<AppState>();
        if let Ok(conn) = state.db.lock() {
            let _ = db::finish_all_tasks(&conn, &conversation_id, "failed");
        }
        let _ = app.emit(
            "agent:error",
            ErrorPayload {
                conversation_id,
                message,
            },
        );
    }
}

async fn run_loop(
    app: &tauri::AppHandle,
    conversation_id: &str,
    project_root: &Path,
    user_request: &str,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    let settings = state::load_settings(&state);
    let provider = state::build_tool_provider(&state)?;
    let agent_tools = tools::build_tools(settings.run_command_enabled);
    let mut definitions = meta_tool_definitions();
    definitions.extend(agent_tools.iter().map(|t| t.definition()));

    let mut messages = vec![
        AgentMessage {
            role: "system".into(),
            content: system_prompt(project_root),
            tool_calls: Vec::new(),
            tool_call_id: None,
        },
        AgentMessage {
            role: "user".into(),
            content: user_request.to_string(),
            tool_calls: Vec::new(),
            tool_call_id: None,
        },
    ];

    for iteration in 0..MAX_ITERATIONS {
        let response = provider
            .send_with_tools(messages.clone(), definitions.clone())
            .await
            .map_err(|e| e.to_string())?;

        match response {
            AgentResponse::Text(text) => {
                if text.trim().is_empty() {
                    return Err("El modelo devolvió una respuesta vacía.".into());
                }
                finish_done(app, conversation_id, &text).await?;
                return Ok(());
            }
            AgentResponse::ToolCalls { text, calls } => {
                if iteration == MAX_ITERATIONS - 1 {
                    return Err("El agente alcanzó el máximo de iteraciones sin terminar.".into());
                }
                messages.push(AgentMessage {
                    role: "assistant".into(),
                    content: text.unwrap_or_default(),
                    tool_calls: calls.clone(),
                    tool_call_id: None,
                });

                for call in calls {
                    let (output_json, ok) = if call.name == "submit_plan" {
                        handle_submit_plan(app, conversation_id, &call).await?
                    } else if call.name == "update_step" {
                        handle_update_step(app, conversation_id, &call).await?
                    } else {
                        handle_agent_tool(app, conversation_id, project_root, &agent_tools, &call).await?
                    };
                    messages.push(AgentMessage {
                        role: "tool".into(),
                        content: truncate_for_model(output_json),
                        tool_calls: Vec::new(),
                        tool_call_id: Some(call.id.clone()),
                    });
                    let _ = ok;
                }
            }
        }
    }
    Err("El agente alcanzó el máximo de iteraciones sin terminar.".into())
}

async fn handle_submit_plan(
    app: &tauri::AppHandle,
    conversation_id: &str,
    call: &ToolCallRequest,
) -> Result<(String, bool), String> {
    let state = app.state::<AppState>();
    let steps: Vec<String> = call.input["steps"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|s| s.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();
    if steps.is_empty() {
        return Ok((json!({ "error": "steps vacío o inválido" }).to_string(), false));
    }
    let tasks = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::replace_tasks(&conn, conversation_id, &steps)?
    };
    let _ = app.emit(
        "agent:plan",
        PlanPayload {
            conversation_id: conversation_id.to_string(),
            tasks: tasks.clone(),
        },
    );
    Ok((
        json!({ "ok": true, "message": "Plan registrado", "steps": steps }).to_string(),
        true,
    ))
}

async fn handle_update_step(
    app: &tauri::AppHandle,
    conversation_id: &str,
    call: &ToolCallRequest,
) -> Result<(String, bool), String> {
    let state = app.state::<AppState>();
    let step_order = call.input["step_order"].as_i64().unwrap_or(0);
    let status = call.input["status"].as_str().unwrap_or("in_progress");
    let status = match status {
        "done" | "failed" | "in_progress" => status,
        _ => "in_progress",
    };
    let tasks = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let all = db::list_tasks(&conn, conversation_id)?;
        if let Some(task) = all.iter().find(|t| t.step_order == step_order) {
            db::set_task_status(&conn, &task.id, status)?;
        }
        db::list_tasks(&conn, conversation_id)?
    };
    let _ = app.emit(
        "agent:step_result",
        StepResultPayload {
            conversation_id: conversation_id.to_string(),
            tasks,
            tool_name: "update_step".into(),
            ok: true,
            brief: format!("Paso {step_order} → {status}"),
        },
    );
    Ok((json!({ "ok": true }).to_string(), true))
}

async fn handle_agent_tool(
    app: &tauri::AppHandle,
    conversation_id: &str,
    project_root: &Path,
    agent_tools: &[Box<dyn tools::AgentTool>],
    call: &ToolCallRequest,
) -> Result<(String, bool), String> {
    let state = app.state::<AppState>();
    let tool = match agent_tools.iter().find(|t| t.name() == call.name) {
        Some(t) => t,
        None => {
            return Ok((
                json!({ "error": format!("Herramienta desconocida: {}", call.name) }).to_string(),
                false,
            ));
        }
    };

    let input_str = call.input.to_string();
    let tool_call_id = uuid::Uuid::new_v4().to_string();
    let mut has_approval_row = false;

    if tool.requires_approval() {
        has_approval_row = true;
        let preview = tool.preview(&call.input, project_root);
        {
            let conn = state.db.lock().map_err(|e| e.to_string())?;
            db::insert_tool_call(
                &conn,
                &tool_call_id,
                conversation_id,
                &call.name,
                &input_str,
                None,
                "pending_approval",
            )?;
        }
        let (tx, rx) = tokio::sync::oneshot::channel::<bool>();
        state
            .approvals
            .lock()
            .map_err(|e| e.to_string())?
            .insert(tool_call_id.clone(), tx);
        let _ = app.emit(
            "agent:approval_needed",
            ApprovalNeededPayload {
                conversation_id: conversation_id.to_string(),
                tool_call_id: tool_call_id.clone(),
                tool_name: call.name.clone(),
                input: call.input.clone(),
                preview,
            },
        );

        let approved = rx.await.map_err(|_| "La sesión de trabajo terminó".to_string())?;
        {
            let conn = state.db.lock().map_err(|e| e.to_string())?;
            if !approved {
                db::update_tool_call(&conn, &tool_call_id, "rejected", None)?;
            } else {
                db::update_tool_call(&conn, &tool_call_id, "approved", None)?;
            }
        }
        if !approved {
            emit_step_result(app, conversation_id, &call.name, false, "Rechazada por el usuario").await;
            return Ok(
                (
                    json!({ "error": "El usuario RECHAZÓ esta acción. No la repitas sin instrucciones nuevas." })
                        .to_string(),
                    false,
                ),
            );
        }
    }

    let result = tool.execute(call.input.clone(), project_root).await;
    let (output_json, ok, brief) = match result {
        Ok(value) => {
            let brief = summarize_output(&value);
            (value.to_string(), true, brief)
        }
        Err(e) => (
            json!({ "error": e.to_string() }).to_string(),
            false,
            e.to_string(),
        ),
    };
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let status = if ok { "completed" } else { "failed" };
        if has_approval_row {
            db::update_tool_call(&conn, &tool_call_id, status, Some(&output_json))?;
        } else {
            // Registro de auditoría para tools que no requieren aprobación.
            db::insert_tool_call(
                &conn,
                &tool_call_id,
                conversation_id,
                &call.name,
                &input_str,
                Some(&output_json),
                status,
            )?;
        }
    }
    emit_step_result(app, conversation_id, &call.name, ok, &brief).await;
    Ok((output_json, ok))
}

async fn emit_step_result(
    app: &tauri::AppHandle,
    conversation_id: &str,
    tool_name: &str,
    ok: bool,
    brief: &str,
) {
    let state = app.state::<AppState>();
    let tasks = state
        .db
        .lock()
        .ok()
        .and_then(|conn| db::list_tasks(&conn, conversation_id).ok())
        .unwrap_or_default();
    let _ = app.emit(
        "agent:step_result",
        StepResultPayload {
            conversation_id: conversation_id.to_string(),
            tasks,
            tool_name: tool_name.to_string(),
            ok,
            brief: brief.to_string(),
        },
    );
}

fn summarize_output(value: &Value) -> String {
    if let Some(s) = value.get("path").and_then(|p| p.as_str()) {
        return s.to_string();
    }
    if let Some(n) = value.get("matches").and_then(|m| m.as_array()) {
        return format!("{} coincidencias", n.len());
    }
    if let Some(e) = value.get("entries").and_then(|m| m.as_array()) {
        return format!("{} entradas", e.len());
    }
    if let Some(c) = value.get("exit_code") {
        return format!("exit {c}");
    }
    String::new()
}

async fn finish_done(
    app: &tauri::AppHandle,
    conversation_id: &str,
    summary: &str,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::finish_all_tasks(&conn, conversation_id, "done")?;
        db::add_message(&conn, conversation_id, "assistant", summary, Some("agent"))?;
    }
    let _ = app.emit(
        "agent:done",
        DonePayload {
            conversation_id: conversation_id.to_string(),
            summary: summary.to_string(),
        },
    );
    Ok(())
}
