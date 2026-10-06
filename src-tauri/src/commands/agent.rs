//! Modo trabajo: el bucle del agente, su traza, sus cancelaciones y su deshacer.
//!
//! El disco del deshacer y el agregado de la pantalla de cambios viven en
//! [`crate::servicios::agente`]; aquí queda el `#[tauri::command]` con la misma
//! firma de siempre y el lock de la conexión, que es lo único que un comando tiene
//! que saber hacer.

use crate::db;
use crate::servicios::agente::{self as servicio_agente, CambioSesion};
use crate::state::{self, AppState};
use serde::Serialize;
use std::path::PathBuf;
use tauri::{Manager, State};

#[tauri::command]
pub fn get_tasks(app: State<AppState>, conversation_id: String) -> Result<Vec<db::Task>, String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::list_tasks(&conn, &conversation_id)
}

/// Lanza el loop del agente para una sesión de trabajo.
#[tauri::command]
pub async fn start_work_task(
    app: tauri::AppHandle,
    conversation_id: String,
    project_id: String,
    request: String,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    let (root, approval_level) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let project = db::get_project(&conn, &project_id)?;
        db::add_message(&conn, &conversation_id, "user", &request, Some("agent"))?;
        // El mismo paso que en `send_message`: la consulta vive en `db` y la
        // decisión de renombrar en `AgentService`, no aquí.
        let _ = crate::servicios::agente::AgentService::titular_desde_el_pedido(
            &conn,
            &conversation_id,
            &request,
            "Sesión de trabajo",
        );
        db::touch_project(&conn, &project_id)?;
        (PathBuf::from(project.root_path), project.approval_level)
    };
    let assistant_name = state::load_settings(&state).assistant_name;

    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel::<()>();
    state
        .work_runs
        .lock()
        .map_err(|e| e.to_string())?
        .insert(conversation_id.clone(), cancel_tx);

    let app_for_task = app.clone();
    tauri::async_runtime::spawn(async move {
        crate::agent::loop_runner::run_work_task(
            app_for_task,
            conversation_id,
            root,
            approval_level,
            assistant_name,
            request,
            cancel_rx,
        )
        .await;
    });
    Ok(())
}

/// Resumen de lo que el agente cambió en esta sesión de trabajo.
///
/// El agregado por ruta —y qué se enseña de la salida JSON de `write_file`— está
/// en [`CambioSesion`] y en el servicio; el comando solo abre la conexión, lee las
/// filas y las pasa.
#[tauri::command]
pub fn session_changes(
    app: State<AppState>,
    conversation_id: String,
) -> Result<Vec<CambioSesion>, String> {
    let registros = {
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        db::session_writes(&conn, &conversation_id)?
    };
    Ok(servicio_agente::AgentService::cambios_de_sesion(&registros))
}

/// Una línea de la traza, con la forma que el frontend ya usa en vivo.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Paso {
    pub tool_name: String,
    pub ok: bool,
    pub brief: String,
    pub duration_ms: i64,
    /// Lo que creó `write_file`, no solo lo que tocó: la traza lo distingue.
    pub creado: bool,
    /// La salida de `run_command` para pintar su bloque.
    pub data: Option<serde_json::Value>,
    /// El diff que aplicó `write_file`, para enseñarlo bajo el paso.
    pub diff: Option<String>,
    /// Ruta relativa que escribió o editó `write_file`: con ella la respuesta
    /// puede enseñar la tarjeta del archivo (tamaño, abrir, copiar ruta).
    pub ruta: Option<String>,
    pub reasoning: Option<String>,
}

/// Los pasos de una respuesta del agente, para que el hilo se vea igual al
/// reabrir la sesión que mientras se estaba ejecutando.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrazaMensaje {
    pub message_id: String,
    pub pasos: Vec<Paso>,
}

fn paso_desde(tc: &db::ToolCall) -> Paso {
    let es_pensamiento = tc.tool_name == "razonamiento";
    let texto = tc.brief.clone().unwrap_or_default();
    let salida = tc
        .output
        .as_deref()
        .and_then(|o| serde_json::from_str::<serde_json::Value>(o).ok());
    Paso {
        tool_name: tc.tool_name.clone(),
        ok: tc.status == "completed",
        brief: if es_pensamiento { String::new() } else { texto.clone() },
        duration_ms: tc.duration_ms,
        // `created` lo escribió `write_file` en su salida desde el principio, así
        // que las sesiones viejas también saben si crearon o modificaron.
        creado: salida
            .as_ref()
            .and_then(|v| v.get("created").and_then(serde_json::Value::as_bool))
            .unwrap_or(false),
        data: if tc.tool_name == "run_command" { salida } else { None },
        diff: if tc.tool_name == "write_file" {
            tc.output
                .as_deref()
                .and_then(|o| serde_json::from_str::<serde_json::Value>(o).ok())
                .and_then(|v| v.get("diff").and_then(serde_json::Value::as_str).map(str::to_string))
        } else {
            None
        },
        ruta: if tc.tool_name == "write_file" {
            serde_json::from_str::<serde_json::Value>(&tc.input)
                .ok()
                .and_then(|v| {
                    v.get("path")
                        .and_then(serde_json::Value::as_str)
                        .map(str::to_string)
                })
        } else {
            None
        },
        reasoning: es_pensamiento.then_some(texto),
    }
}

/// Traza de la sesión repartida entre las respuestas del agente.
#[tauri::command]
pub fn session_trace(
    app: State<AppState>,
    conversation_id: String,
) -> Result<Vec<TrazaMensaje>, String> {
    let filas = {
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        db::session_trace(&conn, &conversation_id)?
    };
    // Se conserva el orden de aparición de cada mensaje y de sus pasos.
    let mut orden: Vec<String> = Vec::new();
    let mut por_mensaje: std::collections::HashMap<String, Vec<Paso>> =
        std::collections::HashMap::new();
    for (mensaje, tc) in filas {
        if !por_mensaje.contains_key(&mensaje) {
            orden.push(mensaje.clone());
        }
        por_mensaje.entry(mensaje).or_default().push(paso_desde(&tc));
    }
    Ok(orden
        .into_iter()
        .map(|id| TrazaMensaje {
            message_id: id.clone(),
            pasos: por_mensaje.remove(&id).unwrap_or_default(),
        })
        .collect())
}

/// Devuelve los archivos que esta sesión tocó a como estaban antes de tocarlos.
///
/// El recorrido en orden inverso, el `remove_file` de lo que la sesión creó, el
/// `copy` desde el respaldo y el llevarse la carpeta de respaldos están en
/// [`servicio_agente::deshace`], que es quien toca disco. Aquí queda lo que solo
/// sabe la app: **de qué sesión** se habla —la conversación tiene que ser de un
/// proyecto, y la raíz sale de la base de datos— y en qué carpeta están los
/// respaldos, que la nombra `crate::agent::loop_runner`.
#[tauri::command]
pub fn deshace_sesion(
    app: State<AppState>,
    conversation_id: String,
) -> Result<Vec<String>, String> {
    let (raiz, registros) = {
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        let conv = db::get_conversation(&conn, &conversation_id)
            .map_err(|_| "Esta sesión ya no existe.".to_string())?;
        let Some(proyecto_id) = conv.project_id else {
            return Err("Esta conversación no es de un proyecto".to_string());
        };
        (
            PathBuf::from(db::get_project(&conn, &proyecto_id)?.root_path),
            db::session_writes(&conn, &conversation_id)?,
        )
    };
    let respaldos = crate::agent::loop_runner::respaldos_de(&app.data_dir, &conversation_id);
    servicio_agente::deshace(&raiz, &respaldos, &registros)
}

/// Pide cancelar una tarea del agente en curso.
#[tauri::command]
pub fn cancel_work_task(app: State<AppState>, conversation_id: String) -> Result<(), String> {
    let sender = app
        .work_runs
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&conversation_id);
    match sender {
        Some(tx) => {
            let _ = tx.send(());
            Ok(())
        }
        None => Err("No hay ninguna tarea en curso para esa sesión.".into()),
    }
}

/// Aprobar o rechazar una tool call pendiente.
#[tauri::command]
pub fn respond_to_approval(
    app: State<AppState>,
    tool_call_id: String,
    approved: bool,
) -> Result<(), String> {
    let sender = app
        .approvals
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&tool_call_id)
        .ok_or("No hay una aprobación pendiente con ese id (pudo expirar).")?;
    let _ = sender.send(approved);
    Ok(())
}

/// Devuelve los pasos (posiblemente editados) al agente que esperaba con el plan.
/// Una lista vacía se interpreta como «tal cual», para que el botón de aceptar no
/// tenga que reenviar lo mismo.
#[tauri::command]
pub fn respond_plan_review(
    app: State<AppState>,
    plan_id: String,
    steps: Vec<String>,
) -> Result<(), String> {
    let sender = app
        .plan_reviews
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&plan_id)
        .ok_or("No hay un plan esperando revisión con ese id.")?;
    let _ = sender.send(steps);
    Ok(())
}

/// Indica si el proveedor/modelo activo soporta tool calling (modo trabajo).
#[tauri::command]
pub async fn check_tool_support(app: State<'_, AppState>) -> Result<bool, String> {
    let settings = state::load_settings(&app);
    match settings.active_provider.as_str() {
        "anthropic" | "openai" | "openrouter" => Ok(true),
        // Quién atiende cada id lo decide otro (el router de Hugging Face, la capa
        // compatible de Gemini), así que no se puede saber aquí sin una llamada
        // más: se da por bueno y el loop falla a la vista si el modelo no llama a
        // las tools.
        "hf" | "gemini" => Ok(true),
        // Los modelos principales de Groq (llama-3.x, gpt-oss, qwen3) documentan
        // uso de herramientas, pero su catálogo también trae cosas que no —un
        // prompt guard o un TTS—, así que se da por bueno y el loop lo cuenta en
        // la traza si el modelo elegido no llama a ninguna.
        "groq" => Ok(true),
        "local" => Ok(crate::providers::tool_calling::local_supports_tools(
            &settings.local_endpoint,
            &settings.local_model,
        )
        .await),
        other => Err(format!("Proveedor desconocido: {other}")),
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capas {
    /// Las tools que el bucle le pasa al modelo ahora mismo.
    pub herramientas: usize,
    /// `run_command` vive apagado hasta que se activa en Ajustes → Agente.
    pub comandos: bool,
    pub web: bool,
    /// Plantillas activas, que son las que se inyectan en el prompt.
    pub plantillas: usize,
}

/// Lo que el agente tiene puesto en este momento. Se lee de los mismos sitios
/// que lee el bucle, para que la cabecera no prometa ninguna tool que el loop
/// no vaya a recibir de verdad.
#[tauri::command]
pub fn agent_layers(app: State<AppState>) -> Result<Capas, String> {
    let aj = state::load_settings(&app);
    let plantillas = {
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        db::list_skills(&conn)?
            .iter()
            .filter(|s| s.enabled)
            .count()
    };
    Ok(Capas {
        // Sin proyecto en la mano no hay fuentes: se cuentan las herramientas base.
        herramientas: crate::agent::tools::build_tools(&aj, &[]).len(),
        comandos: aj.run_command_enabled,
        web: aj.web_search,
        plantillas,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    // La prueba es la misma de siempre; lo único que cambió es la ruta: `revierte`
    // ya no vive en este archivo, sino en el servicio de agente.
    use crate::servicios::agente::revierte;

        #[test]
        fn deshacer_devuelve_el_original_y_borra_lo_creado() {
            let base = std::env::temp_dir().join(format!(
                "hatboo-deshacer-{}-{}",
                std::process::id(),
                std::time::UNIX_EPOCH
                    .elapsed()
                    .map(|d| d.subsec_nanos())
                    .unwrap_or(0)
            ));
            let proyecto = base.join("proyecto");
            let respaldos = base.join("respaldos");
            std::fs::create_dir_all(&proyecto).unwrap();
            std::fs::create_dir_all(&respaldos).unwrap();
            std::fs::write(proyecto.join("leido.txt"), "lo de hoy").unwrap();
            std::fs::write(proyecto.join("nuevo.txt"), "creado por el agente").unwrap();
            // El respaldo lo escribe el nombre que usa `write_file` al guardar: si
            // las dos mitades del deshacer discreparan, esta prueba lo vería.
            std::fs::write(
                crate::agent::loop_runner::respaldo_de(&respaldos, "tc1"),
                "el original",
            )
            .unwrap();

            let tc = |id: &str, salida: &str| db::ToolCall {
                id: id.to_string(),
                conversation_id: "c1".to_string(),
                tool_name: "write_file".to_string(),
                input: format!(r#"{{"path":"{}"}}"#, id),
                output: Some(salida.to_string()),
                status: "completed".to_string(),
                created_at: 1,
                duration_ms: 0,
                brief: None,
            };
            let registros = vec![
                tc("tc1", r#"{"path":"leido.txt","created":false}"#),
                tc("tc2", r#"{"path":"nuevo.txt","created":true}"#),
            ];

            let devueltos = revierte(&proyecto, &respaldos, &registros).unwrap();
            assert_eq!(devueltos, vec!["nuevo.txt".to_string(), "leido.txt".to_string()]);
            assert_eq!(
                std::fs::read_to_string(proyecto.join("leido.txt")).unwrap(),
                "el original"
            );
            assert!(!proyecto.join("nuevo.txt").exists());
            // Repetirlo no inventa nada: deshace_sesion se lleva los respaldos al
            // terminar, y sin respaldo ni archivo no hay acción que tomar.
            std::fs::remove_dir_all(&respaldos).unwrap();
            assert!(revierte(&proyecto, &respaldos, &registros).unwrap().is_empty());

            let _ = std::fs::remove_dir_all(&base);
        }
}
