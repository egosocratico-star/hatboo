use crate::providers::tool_calling::ToolCallingProvider;
use crate::providers::{AiProvider, AnthropicProvider, LocalProvider, OpenAiProvider};
use rusqlite::Connection;
use std::collections::HashMap;
use std::sync::Mutex;
use tokio::sync::oneshot;

pub struct AppState {
    pub db: Mutex<Connection>,
    /// Aprobaciones pendientes: tool_call_id -> canal que resuelve el loop del agente.
    pub approvals: Mutex<HashMap<String, oneshot::Sender<bool>>>,
}

impl AppState {
    pub fn new(db: Connection) -> Self {
        Self {
            db: Mutex::new(db),
            approvals: Mutex::new(HashMap::new()),
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
pub fn build_provider(state: &AppState) -> Result<Box<dyn AiProvider>, String> {
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
