use crate::agent::tools::{self, RiskLevel, ToolDefinition};
use crate::db;
use crate::providers::tool_calling::{AgentMessage, AgentResponse, ToolCallRequest};
use crate::state::{self, AppState};
use serde::Serialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tauri::{Emitter, Manager};

const MAX_ITERATIONS: usize = 25;
const MAX_TOOL_OUTPUT: usize = 12_000;
/// Marca interna que viaja como error para indicar una cancelación del usuario.
const CANCEL_MARK: &str = "__hatboo_cancelado__";

/// Aviso de escritorio con el estado de una sesión de trabajo. No se manda si
/// la ventana está en primer plano: eso ya lo está viendo, y con varias pestañas
/// abiertas sería solo ruido.
fn notify(app: &tauri::AppHandle, title: &str, body: &str) {
    use tauri_plugin_notification::NotificationExt;
    let state = app.state::<AppState>();
    if !state::load_settings(&state).notify_on_finish {
        return;
    }
    let en_frente = app
        .get_webview_window("main")
        .and_then(|w| w.is_focused().ok())
        .unwrap_or(true);
    if en_frente {
        return;
    }
    // Un aviso que no sale no debe pasar desapercibido: en `tauri dev` el
    // complemento no pone el AppUserModelID (lo salta cuando el ejecutable vive
    // en target/), así que Windows atribuye el toast a PowerShell o lo descarta.
    if let Err(e) = app.notification().builder().title(title).body(body).show() {
        eprintln!("no se pudo mostrar el aviso: {e}");
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlanPayload {
    conversation_id: String,
    tasks: Vec<db::Task>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlanReviewPayload {
    conversation_id: String,
    plan_id: String,
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
    duration_ms: i64,
    /// Salida estructurada, solo para las herramientas que se muestran como
    /// bloque propio (`run_command`). Va ya redactada: es el mismo texto que se
    /// guardó y que recibió el modelo.
    data: Option<Value>,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReasoningPayload {
    conversation_id: String,
    text: String,
}

/// El razonamiento del turno, para la línea de actividad.
fn reasoning_resumen(blocks: &[Value]) -> String {
    let texto = crate::providers::tool_calling::thinking_text(blocks);
    // El bloque completo, con `budget_tokens` altos, son miles de líneas; en la
    // vista solo hace falta ver por dónde ha ido el modelo.
    texto.trim().chars().take(600).collect()
}

fn emit_reasoning(app: &tauri::AppHandle, conversation_id: &str, blocks: &[Value]) {
    let text = reasoning_resumen(blocks);
    if text.is_empty() {
        return;
    }
    let _ = app.emit(
        "agent:reasoning",
        ReasoningPayload {
            conversation_id: conversation_id.to_string(),
            text,
        },
    );
}

#[cfg(test)]
mod pruebas_razonamiento {
    use super::reasoning_resumen;
    use serde_json::json;

    #[test]
    fn sin_texto_util_no_sale_nada() {
        assert_eq!(reasoning_resumen(&[]), "");
        assert_eq!(
            reasoning_resumen(&[json!({ "type": "thinking", "thinking": "   " })]),
            ""
        );
        // Un bloque redactado no trae texto legible que enseñar.
        assert_eq!(
            reasoning_resumen(&[json!({ "type": "redacted_thinking", "data": "xyz" })]),
            ""
        );
    }

    #[test]
    fn se_recorta_a_seiscientos_caracteres() {
        let largo = "a".repeat(900);
        let resumen = reasoning_resumen(&[json!({ "type": "thinking", "thinking": largo })]);
        assert_eq!(resumen.chars().count(), 600);
    }
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

/// Cruce entre el nivel de aprobación elegido por el usuario y el riesgo de la tool.
/// `auto_sandbox` y `full_access` nunca piden aprobación: hoy todas las tools ya
/// operan dentro del sandbox del proyecto (Acceso total no lo relaja).
fn needs_approval(approval_level: &str, risk: RiskLevel) -> bool {
    match approval_level {
        "ask_always" => true,
        "auto_sandbox" | "full_access" => false,
        // 'approve_for_me' y cualquier valor desconocido: el default conservador.
        _ => matches!(risk, RiskLevel::High),
    }
}

#[cfg(test)]
mod tests {
    use super::{needs_approval, system_prompt, RiskLevel};

    #[test]
    fn approval_levels_cross_with_risk() {
        let low = RiskLevel::Low;
        let high = RiskLevel::High;
        assert!(needs_approval("ask_always", low));
        assert!(needs_approval("ask_always", high));
        assert!(!needs_approval("approve_for_me", low));
        assert!(needs_approval("approve_for_me", high));
        assert!(!needs_approval("auto_sandbox", low));
        assert!(!needs_approval("auto_sandbox", high));
        assert!(!needs_approval("full_access", low));
        assert!(!needs_approval("full_access", high));
        // Un valor desconocido se comporta como el default conservador.
        assert!(!needs_approval("", low));
        assert!(needs_approval("", high));
    }

    #[test]
    fn las_plantillas_se_pegan_sin_tocar_las_reglas() {
        let root = std::path::Path::new(".");
        let raiz = root.canonicalize().unwrap();
        let con = system_prompt(
            &raiz,
            "approve_for_me",
            "Bicho",
            "· Explica qué hace cada paso antes de hacerlo.\n",
            false,
            "",
        );
        assert!(con.contains("Explica qué hace cada paso"));
        assert!(con.contains("SIN relajar ninguna regla anterior"));
        assert!(con.contains("que lo llames «Bicho»"));
        // La regla 4 del sandbox sigue ahí igualmente.
        assert!(con.contains("nunca intentes salir de ella"));

        let sin = system_prompt(&raiz, "approve_for_me", "", "", false, "");
        assert!(!sin.contains("SIN relajar"));
        assert!(!sin.contains("que lo llames"));
        // El chip de código también llega al agente.
        assert!(!sin.contains("Modo código activo"));
        let con_codigo = system_prompt(&raiz, "approve_for_me", "", "", true, "");
        assert!(con_codigo.contains("Modo código activo"));
        assert!(con_codigo.contains("nunca intentes salir de ella"));
    }

    #[test]
    fn las_reglas_del_proyecto_tampoco_relajan_el_sandbox() {
        let raiz = std::path::Path::new(".").canonicalize().unwrap();
        let sin = system_prompt(&raiz, "approve_for_me", "", "", false, "");
        let con = system_prompt(
            &raiz,
            "approve_for_me",
            "",
            "",
            false,
            "Usa pnpm y no toques el lockfile.",
        );
        assert!(con.contains("Reglas de este proyecto"));
        assert!(con.contains("Usa pnpm y no toques el lockfile"));
        assert!(con.contains("sin relajar ninguna regla anterior"));
        assert!(con.contains("nunca intentes salir de ella"));
        // Sin archivo (o con espacios) el prompt tiene que quedar igual byte a byte.
        assert_eq!(system_prompt(&raiz, "approve_for_me", "", "", false, "   "), sin);
    }
}

fn system_prompt(
    project_root: &Path,
    approval_level: &str,
    assistant_name: &str,
    skills: &str,
    code_mode: bool,
    rules: &str,
) -> String {
    let listing = list_dir_brief(project_root);
    let approval_rule = match approval_level {
        "ask_always" => "El usuario aprueba TODAS tus acciones (incluidas lecturas); no te sorprendas si cada tool call pide confirmación.".to_string(),
        "auto_sandbox" => "Ejecutas todas las herramientas sin pedir aprobación (dentro del proyecto).".to_string(),
        "full_access" => "Ejecutas todas las herramientas sin pedir aprobación (dentro del proyecto).".to_string(),
        _ => "write_file, run_command y git_commit pedirán aprobación al usuario; las demás corren solas.".to_string(),
    };
    let name_rule = if assistant_name.trim().is_empty() {
        String::new()
    } else {
        format!(
            "8. El usuario prefiere que lo llames «{}».\n",
            assistant_name.trim()
        )
    };
    // Una plantilla nunca relaja el sandbox ni las aprobaciones: se lo dice
    // explícitamente porque si no, un "envía lo que haga falta" se lo toma al pie.
    let skills_rule = if skills.trim().is_empty() {
        String::new()
    } else {
        format!(
            "\n{} Todo esto se cumple SIN relajar ninguna regla anterior.\n",
            skills.trim()
        )
    };
    let code_rule = if code_mode {
        format!("{} \n", crate::commands::CODE_MODE_PROMPT)
    } else {
        String::new()
    };
    // Las reglas del proyecto son contexto sobre EL proyecto: tampoco amplían el
    // sandbox ni quitan aprobaciones, que es lo que un "sube todo a producción"
    // escrito a mano intentaría colar.
    let rules_rule = if rules.trim().is_empty() {
        String::new()
    } else {
        format!(
            "\nReglas de este proyecto (archivo {}, escritas por el usuario):\n\
             {}\n\
             Se cumplen sin relajar ninguna regla anterior: ni el límite de rutas \
             ni las aprobaciones.\n",
            crate::commands::RULES_FILE,
            rules.trim()
        )
    };
    format!(
        "Eres Hatboo, un agente de trabajo que opera DENTRO del proyecto del usuario.\n\
         Raíz del proyecto: {}\n\n\
         Estructura inicial:\n{}\n\n\
         Reglas obligatorias:\n\
         1. Primero llama a submit_plan con los pasos necesarios (máximo 6, concretos).\n\
         2. Antes de trabajar en un paso márcalo con update_step a in_progress; al acabarlo, a done.\n\
         3. {}\n\
         4. Todas las rutas son relativas a la raíz del proyecto; nunca intentes salir de ella.\n\
         5. Si el proyecto es un repositorio git, revisa git_status antes de proponer un commit, y nunca propongas git_commit sin que el usuario lo pida explícitamente.\n\
         6. Cuando hayas terminado todos los pasos, responde SOLO con un resumen final en español, sin tool calls.\n\
         7. Responde siempre en español al usuario.\n\
         {}{}{}{}",
        project_root.display(),
        listing,
        approval_rule,
        name_rule,
        rules_rule,
        code_rule,
        skills_rule
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
    approval_level: String,
    assistant_name: String,
    user_request: String,
    mut cancel_rx: tokio::sync::oneshot::Receiver<()>,
) {
    let result = {
        let inner = run_loop(
            &app,
            &conversation_id,
            &project_root,
            &approval_level,
            &assistant_name,
            &user_request,
        );
        tokio::select! {
            res = inner => res,
            _ = &mut cancel_rx => Err(CANCEL_MARK.to_string()),
        }
    };
    let state = app.state::<AppState>();
    if let Ok(mut runs) = state.work_runs.lock() {
        runs.remove(&conversation_id);
    }
    match result {
        Ok(()) => {}
        Err(message) if message == CANCEL_MARK => {
            let pending = {
                match state.db.lock() {
                    Ok(conn) => {
                        let _ = db::finish_all_tasks(&conn, &conversation_id, "failed");
                        let ids = db::pending_tool_call_ids(&conn, &conversation_id)
                            .unwrap_or_default();
                        for id in &ids {
                            let _ = db::update_tool_call(&conn, id, "rejected", None);
                        }
                        ids
                    }
                    Err(_) => Vec::new(),
                }
            };
            if let Ok(mut approvals) = state.approvals.lock() {
                for id in &pending {
                    approvals.remove(id);
                }
            }
            let _ = app.emit(
                "agent:cancelled",
                ErrorPayload {
                    conversation_id,
                    message: "Tarea cancelada por el usuario.".into(),
                },
            );
        }
        Err(message) => {
            if let Ok(conn) = state.db.lock() {
                let _ = db::finish_all_tasks(&conn, &conversation_id, "failed");
            }
            notify(&app, "Hatboo no pudo terminar", &message);
            let _ = app.emit(
                "agent:error",
                ErrorPayload {
                    conversation_id,
                    message,
                },
            );
        }
    }
}

async fn run_loop(
    app: &tauri::AppHandle,
    conversation_id: &str,
    project_root: &Path,
    approval_level: &str,
    assistant_name: &str,
    user_request: &str,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    let settings = state::load_settings(&state);
    let provider = state::build_tool_provider(&state)?;
    let agent_tools =
        tools::build_tools(settings.run_command_enabled, settings.web_search);
    let skills_prompt = state
        .db
        .lock()
        .ok()
        .and_then(|conn| db::enabled_skills_prompt(&conn).ok())
        .unwrap_or_default();
    // Tapar solo tiene sentido cuando lo leído va a salir de la máquina: con el
    // proveedor local el contenido viaja a tu propio Ollama.
    let redactar = settings.redact_secrets
        && matches!(settings.active_provider.as_str(), "anthropic" | "openai");
    let mut definitions = meta_tool_definitions();
    definitions.extend(agent_tools.iter().map(|t| t.definition()));

    let mut messages = vec![
        AgentMessage {
            role: "system".into(),
            content: system_prompt(
                project_root,
                approval_level,
                assistant_name,
                &skills_prompt,
                settings.code_mode,
                &crate::commands::project_rules_for_prompt(project_root),
            ),
            ..Default::default()
        },
        AgentMessage {
            role: "user".into(),
            content: user_request.to_string(),
            ..Default::default()
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
            AgentResponse::ToolCalls {
                text,
                calls,
                thinking,
            } => {
                if iteration == MAX_ITERATIONS - 1 {
                    return Err("El agente alcanzó el máximo de iteraciones sin terminar.".into());
                }
                if !thinking.is_empty() {
                    emit_reasoning(app, conversation_id, &thinking);
                }
                messages.push(AgentMessage {
                    role: "assistant".into(),
                    content: text.unwrap_or_default(),
                    tool_calls: calls.clone(),
                    // Con razonamiento activado hay que devolverlos: Anthropic
                    // rechaza el turno siguiente si faltan.
                    thinking,
                    tool_call_id: None,
                });

                for call in calls {
                    let (output_json, ok) = if call.name == "submit_plan" {
                        handle_submit_plan(app, conversation_id, &call).await?
                    } else if call.name == "update_step" {
                        handle_update_step(app, conversation_id, &call).await?
                    } else {
                        handle_agent_tool(
                            app,
                            conversation_id,
                            project_root,
                            approval_level,
                            &agent_tools,
                            &call,
                            redactar,
                        )
                        .await?
                    };
                    messages.push(AgentMessage {
                        role: "tool".into(),
                        content: truncate_for_model(output_json),
                        tool_call_id: Some(call.id.clone()),
                        ..Default::default()
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

    // Revisión opcional: el agente se queda parado hasta que el usuario confirme
    // o edite los pasos. Lo que devuelva es lo que se guarda y lo que él lee, así
    // que no hay dos versiones del plan.
    if state::load_settings(&state).review_plan {
        let plan_id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = tokio::sync::oneshot::channel::<Vec<String>>();
        state
            .plan_reviews
            .lock()
            .map_err(|e| e.to_string())?
            .insert(plan_id.clone(), tx);
        let _ = app.emit(
            "agent:plan_review",
            PlanReviewPayload {
                conversation_id: conversation_id.to_string(),
                plan_id: plan_id.clone(),
                tasks: tasks.clone(),
            },
        );
        let pasos = rx
            .await
            .map_err(|_| "La revisión del plan se canceló".to_string())?;
        let pasos = if pasos.is_empty() { steps.clone() } else { pasos };
        let revisados = {
            let conn = state.db.lock().map_err(|e| e.to_string())?;
            db::replace_tasks(&conn, conversation_id, &pasos)?
        };
        let _ = app.emit(
            "agent:plan",
            PlanPayload {
                conversation_id: conversation_id.to_string(),
                tasks: revisados,
            },
        );
        return Ok((
            json!({ "ok": true, "message": "Plan confirmado por el usuario", "steps": pasos })
                .to_string(),
            true,
        ));
    }
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
            duration_ms: 0,
            data: None,
        },
    );
    Ok((json!({ "ok": true }).to_string(), true))
}

async fn handle_agent_tool(
    app: &tauri::AppHandle,
    conversation_id: &str,
    project_root: &Path,
    approval_level: &str,
    agent_tools: &[Box<dyn tools::AgentTool>],
    call: &ToolCallRequest,
    redactar: bool,
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

    if needs_approval(approval_level, tool.risk_level()) {
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
        let aviso: String = preview.chars().take(140).collect();
        notify(
            app,
            "Hatboo espera tu aprobación",
            &format!("{} — {}", call.name, aviso),
        );
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
            emit_step_result(
                app,
                conversation_id,
                &call.name,
                false,
                "Rechazada por el usuario",
                0,
                None,
            )
            .await;
            return Ok(
                (
                    json!({ "error": "El usuario RECHAZÓ esta acción. No la repitas sin instrucciones nuevas." })
                        .to_string(),
                    false,
                ),
            );
        }
    }

    let inicio = std::time::Instant::now();
    let result = tool.execute(call.input.clone(), project_root).await;
    let duracion_ms = inicio.elapsed().as_millis() as i64;
    let (output_json, ok, mut brief) = match result {
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
    // Lo que sale hacia el proveedor en la nube —y lo que se guarda en SQLite,
    // que viaja en las copias— sale sin claves. Con un modelo local no se toca
    // nada: no hay nada que tapar si nada abandona la máquina.
    let output_json = if redactar {
        let (rojo, tapadas) = crate::redact::redactar(&output_json);
        if tapadas > 0 {
            brief = format!("{brief} · {} clave(s) tapada(s)", tapadas);
        }
        rojo
    } else {
        output_json
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
    // El bloque del comando se pinta con lo que realmente se guardó y se envió
    // (ya redactado), no con el valor previo a tapar.
    let datos = if call.name == "run_command" {
        serde_json::from_str::<Value>(&output_json).ok()
    } else {
        None
    };
    emit_step_result(app, conversation_id, &call.name, ok, &brief, duracion_ms, datos).await;
    Ok((output_json, ok))
}

async fn emit_step_result(
    app: &tauri::AppHandle,
    conversation_id: &str,
    tool_name: &str,
    ok: bool,
    brief: &str,
    duration_ms: i64,
    data: Option<Value>,
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
            duration_ms,
            data,
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
    let aviso: String = summary.trim().chars().take(160).collect();
    notify(app, "Hatboo terminó la tarea", &aviso);
    Ok(())
}
