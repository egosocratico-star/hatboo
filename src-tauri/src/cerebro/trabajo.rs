//! El brazo del modo trabajo: el Brain administra el turno (decide, firma el
//! Plan, recorta contexto y tools, verifica y se recupera) y **Hatboo** ejecuta
//! con las mismas manos de siempre —incluido el modal de aprobación—.
//!
//! La división de la decisión es exactamente la de §V del Canon:
//!
//! - qué se llama, con qué presupuesto y cuántas veces → el crate (su bucle de
//!   tools interno, sus `max_tool_calls` y su puerta).
//! - cómo se ejecuta, dónde, y si hace falta que el usuario apruebe → `handle_agent_tool`,
//!   la MISMA función que usa el bucle de hoy. `requiere_aprobacion` se deja en
//!   `false` a propósito: si el puente aprobara por su cuenta, el Brain aprobaría
//!   otra cosa que la app. Con `ApprovalLevel::FullAccess` el crate tampoco deja
//!   llamadas pendientes — el único criterio de aprobación vive en Hatboo.
//!
//! Lo que NO hace (y se dice, no se esconde): no rellena el panel de TAREAS con
//! pasos editables. El Brain firma un Plan con `reason` y tools, no una lista de
//! pasos para que el usuario los reescriba; ese flujo (`submit_plan`/`update_step`)
//! era de Hatboo y se queda en el bucle normal mientras el modo trabajo lo use.

use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;

use hatboo_brain::api::request::{BrainRequest, ProjectContext, ToolInfo, TrustState, VerifyCommands};
use hatboo_brain::api::vocab::{ApprovalLevel, ExecutionPolicy, Mode, ThinkingLevel, ToolId};
use hatboo_brain::brain::{Brain, EjecutarTool, Montaje, OpcionesDeCorrida};
use hatboo_brain::config::schema::{BrainConfig, Flags};
use hatboo_brain::decision::rules::Reglas;
use hatboo_brain::observability::events::{BrainEvent, CancelToken, Emitidor};
use hatboo_brain::prompt::{Estimador, Identidad};
use hatboo_brain::providers::{ModelProvider, OllamaProvider};
use hatboo_brain::resources::{GovernorConfig, ResourceProbe};
use hatboo_brain::tools::Herramientas;

use crate::agent::tools::{AgentTool, RiskLevel};
use crate::providers::tool_calling::ToolCallRequest;
use crate::state::Settings;

use super::almacen::AlmacenDecisiones;
use super::herramientas::EjecutorDeComandos;
use super::real::{function_registry, Sonda};

/// El ejecutor que devuelve cada llamada al modal de siempre. Nada de aprobar por
/// cuenta propia: `handle_agent_tool` es la que mira el nivel y pregunta.
struct EjecutorConAprobacion {
    app: tauri::AppHandle,
    conv: String,
    raiz: PathBuf,
    nivel: String,
    tools: Vec<Box<dyn AgentTool>>,
    redactar: bool,
}

#[async_trait]
impl EjecutarTool for EjecutorConAprobacion {
    async fn ejecutar(&self, tool: &ToolId, args: &Value) -> Result<String, String> {
        let call = ToolCallRequest {
            id: uuid::Uuid::new_v4().to_string(),
            name: tool.clone(),
            input: args.clone(),
        };
        let (output_json, _ok) = crate::agent::loop_runner::handle_agent_tool(
            &self.app,
            &self.conv,
            &self.raiz,
            &self.nivel,
            &self.tools[..],
            &call,
            self.redactar,
        )
        .await?;
        Ok(output_json)
    }
}

/// El emisor: el razonamiento va al hilo (como hace el bucle), el resto se
/// consume en el resultado final. Las tools no emiten por aquí: `handle_agent_tool`
/// ya manda `agent:step_result` y `agent:approval_needed` por su cuenta.
struct ReenviadorTrabajo {
    app: tauri::AppHandle,
    conv: String,
}

impl Emitidor for ReenviadorTrabajo {
    fn emitir(&self, evento: BrainEvent) {
        if let BrainEvent::Reasoning(t) = evento {
            crate::agent::loop_runner::emit_reasoning(&self.app, &self.conv, &[Value::String(t)]);
        }
    }
}

/// Todo lo que el brazo necesita para montar el turno. Un struct y no once
/// argumentos sueltos: a partir de siete ya no se lee la llamada.
pub struct TurnoDeTrabajo {
    pub app: tauri::AppHandle,
    pub conv: String,
    pub raiz: PathBuf,
    pub nivel: String,
    pub assistant_name: String,
    pub user_request: String,
    pub settings: Settings,
    pub agent_tools: Vec<Box<dyn AgentTool>>,
    pub redactar: bool,
    pub data_dir: PathBuf,
}

/// Una corrida completa del modo trabajo administrada por el Brain. Devuelve el
/// resumen final, el que el bucle le daba a `finish_done`.
pub async fn correr(p: TurnoDeTrabajo) -> Result<String, String> {
    let TurnoDeTrabajo {
        app,
        conv,
        raiz,
        nivel,
        assistant_name,
        user_request,
        settings,
        agent_tools,
        redactar,
        data_dir,
    } = p;

    let tools_info: Vec<ToolInfo> = agent_tools
        .iter()
        .map(|t| ToolInfo {
            id: t.name().to_string(),
            escribe: t.risk_level() == RiskLevel::High,
            descripcion: t.description().to_string(),
        })
        .collect();

    let ollama = Arc::new(OllamaProvider::con_base(settings.local_endpoint.clone()));
    let registry = function_registry(&ollama)
        .await
        .map_err(|e| format!("Ollama no describió sus modelos: {e}"))?;
    let reglas = Reglas::empotradas().map_err(|e| format!("las reglas no parsean: {e}"))?;
    let herramientas =
        Herramientas::empotradas().map_err(|e| format!("las tools no parsean: {e}"))?;

    let identidad = Identidad {
        nombre: if assistant_name.trim().is_empty() {
            Identidad::default().nombre
        } else {
            assistant_name
        },
        ..Identidad::default()
    };

    let config = BrainConfig {
        flags: Flags {
            record_decisiones: settings.brain_dataset,
            ..Flags::default()
        },
        governor: GovernorConfig {
            margen_mb: settings.brain_margen_mb.max(1),
            ..GovernorConfig::default()
        },
        thinking_ceiling: match settings.reasoning_effort.as_str() {
            "low" => Some(ThinkingLevel::Low),
            "medium" => Some(ThinkingLevel::Medium),
            "high" => Some(ThinkingLevel::High),
            _ => None,
        },
        ..BrainConfig::default()
    };

    let mut req = BrainRequest::nuevo(PRODUCTO, Mode::WORK, user_request)
        .con_modelo(settings.local_model.clone())
        .con_tools(tools_info)
        // La aprobación es de Hatboo (dentro de `handle_agent_tool`): el crate no
        // tiene que dejar nada pendiente. `FullAccess` es honesto aquí, no un
        // permiso real — el permiso real se pide en el modal de siempre.
        .con_aprobacion(ApprovalLevel::FullAccess)
        .con_policy(ExecutionPolicy::LocalOnly);
    req.project = Some(ProjectContext {
        root: raiz.to_string_lossy().into_owned(),
        has_tests: false,
        has_lint: false,
        has_build: false,
        language: None,
        hatboo_md: None,
        trust_state: TrustState::SinRevisar,
        verify: VerifyCommands::default(),
    });

    let ejecutor = Arc::new(EjecutorConAprobacion {
        app: app.clone(),
        conv: conv.clone(),
        raiz: raiz.clone(),
        nivel,
        tools: agent_tools,
        redactar,
    });

    let sonda = Arc::new(Sonda::nueva());
    sonda.refrescar(&ollama).await;

    let montaje = Montaje {
        config,
        proveedores: vec![ollama as Arc<dyn ModelProvider>],
        registry,
        reglas,
        herramientas,
        sonda: sonda as Arc<dyn ResourceProbe>,
        contador: Arc::new(Estimador),
        identidad,
        ejecutor_tools: Some(ejecutor),
        ejecutor_comandos: Some(Arc::new(EjecutorDeComandos::default())),
        lector: Some(super::herramientas::lector(raiz)),
        decisiones: if settings.brain_dataset {
            Some(Arc::new(AlmacenDecisiones::nuevo(&data_dir)))
        } else {
            None
        },
        consentimiento_api: false,
    };
    let cerebro = Brain::nuevo(montaje).map_err(|e| format!("el Brain no se pudo montar: {e}"))?;

    let token = CancelToken::nuevo();
    let emisor = Arc::new(ReenviadorTrabajo { app, conv });
    let opciones = OpcionesDeCorrida::nueva()
        .con_eventos(emisor)
        .con_cancelacion(token);
    let resultado = cerebro
        .run_with(&req, opciones)
        .await
        .map_err(|e| e.to_string())?;

    if resultado.output.texto.trim().is_empty() {
        return Err("el Brain no dejó resumen: la respuesta se retiró o el modelo no escribió nada".into());
    }
    Ok(resultado.output.texto)
}

const PRODUCTO: &str = "hatboo";
