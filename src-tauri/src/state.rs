use crate::providers::tool_calling::ToolCallingProvider;
use crate::providers::{AiProvider, AnthropicProvider, LocalProvider, OpenAiProvider};
use rusqlite::Connection;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tokio::sync::oneshot;

pub struct AppState {
    pub db: Mutex<Connection>,
    /// Aprobaciones pendientes: tool_call_id -> canal que resuelve el loop del agente.
    pub approvals: Mutex<HashMap<String, oneshot::Sender<bool>>>,
    /// Tareas de trabajo en curso: conversation_id -> canal de cancelación.
    pub work_runs: Mutex<HashMap<String, oneshot::Sender<()>>>,
    /// Streamings de chat en curso: conversation_id -> canal de cancelación.
    pub chat_runs: Mutex<HashMap<String, oneshot::Sender<()>>>,
    /// Directorio de datos de la app; las imágenes adjuntas (M3) se guardan en
    /// `data_dir/attachments`.
    pub data_dir: PathBuf,
}

impl AppState {
    pub fn new(db: Connection, data_dir: PathBuf) -> Self {
        Self {
            db: Mutex::new(db),
            approvals: Mutex::new(HashMap::new()),
            work_runs: Mutex::new(HashMap::new()),
            chat_runs: Mutex::new(HashMap::new()),
            data_dir,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub active_provider: String,
    pub local_endpoint: String,
    pub anthropic_model: String,
    pub openai_model: String,
    pub local_model: String,
    pub theme: String,
    #[serde(default)]
    pub run_command_enabled: bool,
    #[serde(default)]
    pub assistant_name: String,
    /// `off` | `low` | `medium` | `high` — razonamiento extendido en el chat.
    #[serde(default = "default_reasoning")]
    pub reasoning_effort: String,
    /// Nivel de aprobación que reciben los proyectos nuevos.
    #[serde(default = "default_approval_level")]
    pub default_approval_level: String,
    /// Modo código: prompt de sistema orientado a programar.
    #[serde(default)]
    pub code_mode: bool,
    /// Búsqueda web: antes de responder se consulta DuckDuckGo y se le pasa el
    /// resultado al modelo. Sin API key; requiere salida a internet.
    #[serde(default)]
    pub web_search: bool,
}

fn default_reasoning() -> String {
    "off".to_string()
}

fn default_approval_level() -> String {
    "approve_for_me".to_string()
}

/// Los cuatro niveles conocidos; cualquier otro valor (edición manual del JSON,
/// versión futura) cae al más conservador por defecto.
pub fn normalize_approval_level(level: &str) -> String {
    match level {
        "ask_always" | "approve_for_me" | "auto_sandbox" | "full_access" => level.to_string(),
        _ => default_approval_level(),
    }
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            active_provider: "local".to_string(),
            local_endpoint: "http://localhost:11434".to_string(),
            anthropic_model: "claude-sonnet-4-5-20250928".to_string(),
            openai_model: "gpt-4o-mini".to_string(),
            local_model: "llama3.2".to_string(),
            theme: "dark".to_string(),
            run_command_enabled: false,
            assistant_name: String::new(),
            reasoning_effort: "off".to_string(),
            default_approval_level: default_approval_level(),
            code_mode: false,
            web_search: false,
        }
    }
}

pub fn load_settings(state: &AppState) -> Settings {
    let conn = state.db.lock().unwrap();
    let stored = crate::db::get_setting(&conn, "settings").unwrap_or(None);
    stored
        .and_then(|raw| serde_json::from_str::<Settings>(&raw).ok())
        .unwrap_or_default()
}

pub fn save_settings(state: &AppState, settings: &Settings) -> Result<(), String> {
    let conn = state.db.lock().unwrap();
    crate::db::set_setting(&conn, "settings", &serde_json::to_string(settings).unwrap())
}

/// Construye el proveedor activo según settings + keychain.
/// Aquí sí se aplica el razonamiento extendido del chat; en el loop del agente
/// no, porque Anthropic exige reenviar los bloques de `thinking` al usar tools.
pub fn build_provider(state: &AppState) -> Result<Box<dyn AiProvider>, String> {
    let settings = load_settings(state);
    let effort = settings.reasoning_effort.as_str();
    match settings.active_provider.as_str() {
        "anthropic" => {
            let key = crate::providers::get_api_key("anthropic")
                .ok_or_else(|| crate::providers::ProviderError::MissingKey("Anthropic".into()).to_string())?;
            Ok(Box::new(
                AnthropicProvider::new(key, settings.anthropic_model).with_reasoning(effort),
            ))
        }
        "openai" => {
            let key = crate::providers::get_api_key("openai")
                .ok_or_else(|| crate::providers::ProviderError::MissingKey("OpenAI".into()).to_string())?;
            Ok(Box::new(
                OpenAiProvider::new(key, settings.openai_model).with_reasoning(effort),
            ))
        }
        "local" => Ok(Box::new(
            LocalProvider::new(&settings.local_endpoint, &settings.local_model)
                .with_reasoning(effort),
        )),
        other => Err(format!("Proveedor desconocido: {other}")),
    }
}

/// Igual que `build_provider` pero devolviendo la capacidad de tool calling.
pub fn build_tool_provider(state: &AppState) -> Result<Box<dyn ToolCallingProvider>, String> {
    let settings = load_settings(state);
    match settings.active_provider.as_str() {
        "anthropic" => {
            let key = crate::providers::get_api_key("anthropic")
                .ok_or_else(|| crate::providers::ProviderError::MissingKey("Anthropic".into()).to_string())?;
            Ok(Box::new(AnthropicProvider::new(key, settings.anthropic_model)))
        }
        "openai" => {
            let key = crate::providers::get_api_key("openai")
                .ok_or_else(|| crate::providers::ProviderError::MissingKey("OpenAI".into()).to_string())?;
            Ok(Box::new(OpenAiProvider::new(key, settings.openai_model)))
        }
        "local" => Ok(Box::new(LocalProvider::new(
            &settings.local_endpoint,
            &settings.local_model,
        ))),
        other => Err(format!("Proveedor desconocido: {other}")),
    }
}
