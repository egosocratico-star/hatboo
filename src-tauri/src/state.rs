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
    /// Planes esperando revisión: plan_id -> canal que devuelve los pasos ya
    /// editados. Vacío si el usuario no pidió revisar el plan.
    pub plan_reviews: Mutex<HashMap<String, oneshot::Sender<Vec<String>>>>,
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
            plan_reviews: Mutex::new(HashMap::new()),
            work_runs: Mutex::new(HashMap::new()),
            chat_runs: Mutex::new(HashMap::new()),
            data_dir,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
// `default` a nivel de contenedor: un campo nuevo sin `#[serde(default)]` propio
// se rellena desde `Settings::default()` en vez de hacer fallar el parseo del
// blob guardado. Sin esto, `load_settings` se cae a `.ok().unwrap_or_default()` y
// unos ajustes de versión antigua se reiniciaban enteros en silencio.
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub active_provider: String,
    pub local_endpoint: String,
    pub anthropic_model: String,
    pub openai_model: String,
    pub local_model: String,
    pub theme: String,
    /// `system` (respeta `prefers-reduced-motion` del SO) | `reduced`.
    pub motion: String,
    /// Fondo Mica compuesto por Windows detrás del webview. Apagado por defecto:
    /// la documentación del crate avisa de que va fino al redimensionar.
    pub window_transparency: bool,
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
    /// Tamaño del texto de las respuestas del chat: `sm` | `md` | `lg`.
    #[serde(default = "default_chat_font_size")]
    pub chat_font_size: String,
    /// Familia del texto del chat: `sans` | `serif` | `mono`.
    #[serde(default = "default_chat_font_family")]
    pub chat_font_family: String,
    /// Avatar de la tarjeta de perfil: `mascota` | `inicial` | `emoji`.
    #[serde(default = "default_avatar_style")]
    pub avatar_style: String,
    /// Uno de los colores fijos de `AVATAR_COLORS`; se guarda el identificador,
    /// no un color libre, para que el contraste con el texto esté garantizado.
    #[serde(default = "default_avatar_color")]
    pub avatar_color: String,
    /// Carácter que se pinta cuando `avatar_style` es `emoji`.
    #[serde(default = "default_avatar_emoji")]
    pub avatar_emoji: String,
    /// La barra lateral reducida a iconos.
    #[serde(default)]
    pub sidebar_compact: bool,
    /// Paneles del modo trabajo. Se guardan juntos porque los dos se usan para
    /// ganar ancho de chat y al cambiar de proyecto no se quiere perder el reparto.
    #[serde(default = "default_true")]
    pub files_panel_open: bool,
    #[serde(default = "default_true")]
    pub tasks_panel_open: bool,
    /// Anchos en píxeles, ajustables a arrastre.
    #[serde(default = "default_files_width")]
    pub files_panel_width: i64,
    #[serde(default = "default_tasks_width")]
    pub tasks_panel_width: i64,
    /// Override de la vista de trabajo: oculta barra lateral y paneles sin
    /// pisar los valores de arriba, que vuelven al salir.
    #[serde(default)]
    pub focus_mode: bool,
    /// Aviso de escritorio cuando una sesión de trabajo termina, falla o pide
    /// aprobación. Solo suena si la ventana no está en primer plano.
    #[serde(default = "default_true")]
    pub notify_on_finish: bool,
    /// Con `submit_plan` el agente se para hasta que el usuario revise (y opcional
    /// cambie) los pasos. Apagado por defecto: hoy el plan se ejecuta tal cual.
    pub review_plan: bool,
    /// Tapar claves y tokens que el agente lee del proyecto antes de que la
    /// salida de una herramienta salga hacia un proveedor en la nube.
    #[serde(default = "default_true")]
    pub redact_secrets: bool,
}

fn default_files_width() -> i64 {
    240
}

fn default_tasks_width() -> i64 {
    288
}

fn default_true() -> bool {
    true
}

fn default_chat_font_size() -> String {
    "md".to_string()
}

fn default_chat_font_family() -> String {
    "sans".to_string()
}

fn default_avatar_style() -> String {
    "mascota".to_string()
}

fn default_avatar_color() -> String {
    "violeta".to_string()
}

fn default_avatar_emoji() -> String {
    "🎩".to_string()
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
            motion: "system".to_string(),
            window_transparency: false,
            run_command_enabled: false,
            assistant_name: String::new(),
            reasoning_effort: "off".to_string(),
            default_approval_level: default_approval_level(),
            code_mode: false,
            web_search: false,
            chat_font_size: default_chat_font_size(),
            chat_font_family: default_chat_font_family(),
            avatar_style: default_avatar_style(),
            avatar_color: default_avatar_color(),
            avatar_emoji: default_avatar_emoji(),
            sidebar_compact: false,
            files_panel_open: true,
            tasks_panel_open: true,
            files_panel_width: default_files_width(),
            tasks_panel_width: default_tasks_width(),
            focus_mode: false,
            notify_on_finish: true,
            review_plan: false,
            redact_secrets: true,
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
/// El razonamiento extendido aplica a los dos modos: en el agente el loop
/// reenvía los bloques de pensamiento que exija el proveedor (ver
/// `providers::tool_calling`).
pub fn build_tool_provider(state: &AppState) -> Result<Box<dyn ToolCallingProvider>, String> {
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
