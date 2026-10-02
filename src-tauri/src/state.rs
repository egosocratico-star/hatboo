use crate::providers::tool_calling::ToolCallingProvider;
use crate::providers::{
    AiProvider, AnthropicProvider, LocalProvider, OpenAiProvider, GEMINI_BASE, GROQ_BASE,
    OPENROUTER_BASE,
};
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
    /// Base compatible con OpenAI del router de Hugging Face. Es editable para
    /// poder apuntar a cualquier servidor `/v1` propio (y para probarlo en local).
    #[serde(default = "default_hf_endpoint")]
    pub hf_endpoint: String,
    #[serde(default = "default_hf_model")]
    pub hf_model: String,
    /// OpenRouter y Gemini tienen la base fija en el backend (ver
    /// `providers::OPENROUTER_BASE` y `providers::GEMINI_BASE`), así que de ellos
    /// solo se guarda el modelo elegido.
    #[serde(default = "default_openrouter_model")]
    pub openrouter_model: String,
    #[serde(default = "default_gemini_model")]
    pub gemini_model: String,
    /// Groq: base fija también (`providers::GROQ_BASE`), solo se guarda el modelo.
    #[serde(default = "default_groq_model")]
    pub groq_model: String,
    pub local_model: String,
    /// Modelos que él declaró que ven imágenes, con el nombre tal cual lo
    /// escribe el proveedor. La heurística de `soportaVision` acierta las
    /// familias conocidas y se equivoca con el resto; esto es la salida honesta.
    #[serde(default)]
    pub vision_modelos: Vec<String>,
    pub theme: String,
    /// `system` (el idioma del navegador) | `es` | `en`.
    #[serde(default = "default_ui_language")]
    pub ui_language: String,
    #[serde(default)]
    pub run_command_enabled: bool,
    #[serde(default)]
    pub assistant_name: String,
    /// `off` | `low` | `medium` | `high` — razonamiento extendido en el chat.
    #[serde(default = "default_reasoning")]
    pub reasoning_effort: String,
    /// Motor de generación de imagen: `off` | `openai` | `gemini`. Apagado por
    /// defecto: cada imagen gasta dinero de una clave que puede estar abierta.
    #[serde(default)]
    pub image_provider: String,
    /// Modelo dentro del motor; vacío = el que propone Hatboo.
    #[serde(default)]
    pub image_model: String,
    /// Tamaño pedido. Cada motor tiene los suyos; ver `providers::imagen`.
    #[serde(default = "default_image_size")]
    pub image_size: String,
    /// Motor de voz de nube: `off` | `openai`. Apagado por defecto: la lectura
    /// en voz alta ya funciona gratis con las voces del sistema.
    #[serde(default)]
    pub audio_provider: String,
    /// Modelo de voz; vacío = `gpt-4o-mini-tts`.
    #[serde(default)]
    pub audio_model: String,
    /// Voz dentro del modelo (`alloy`, `nova`…). Vacío = la primera.
    #[serde(default)]
    pub audio_voice: String,
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
    /// `comoda` | `compacta`. Es el tamaño de letra base del documento, y de ahí
    /// sale todo el espaciado (Tailwind mide en `rem`), así que compactar toca la
    /// interfaz entera en vez de padding por padding.
    #[serde(default = "default_densidad")]
    pub densidad: String,
    /// Acento fijo por encima de la paleta: `violeta` (el de cada paleta) |
    /// `azul` | `verde` | `rosa`. Colores concretos, no hex libre: los cuatro
    /// están medidos contra el fondo de las paletas (`npm run prueba-contraste`).
    #[serde(default = "default_acento")]
    pub acento: String,
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
    /// Sección de proyectos, plegable desde su encabezado. Mismo criterio que la
    /// de conversaciones: abierta por defecto.
    #[serde(default = "default_true")]
    pub projects_section_open: bool,
    /// Sección de conversaciones, plegable desde su encabezado. Abierta por
    /// defecto: si no, quien no repare en el chevron piensa que ha perdido sus chats.
    #[serde(default = "default_true")]
    pub chats_section_open: bool,
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
    /// Nombres de carpeta que se saltan el agente, el árbol y la búsqueda. Es UNA
    /// lista a propósito (ver `agent::ignore`): lo que no aparece en el panel de
    /// Archivos tampoco debe aparecer en `list_dir`. Se puede editar en Ajustes →
    /// Agente; viene sembrada con `agent::ignore::FIJOS`.
    #[serde(default = "default_ignore_dirs")]
    pub ignore_dirs: Vec<String>,
    /// Cómo le habla al usuario: `tú` | `usted`.
    #[serde(default = "default_trato")]
    pub user_address: String,
    /// Idioma en que el modelo debe responder: `auto` (el del usuario) | `es` | `en`.
    #[serde(default = "default_idioma_respuesta")]
    pub answer_language: String,
    /// Media línea sobre quién es el usuario, para el chat. Corta a propósito:
    /// un modelo pequeño mezcla una biografía larga con las reglas del agente.
    #[serde(default)]
    pub user_notes: String,
    /// Cómo se pinta la burbuja del usuario: `solida` (morado hondo, máximo
    /// contraste) o `translucida` (tarjeta con el acento al 15%). Las dos
    /// direcciones son válidas y hay quien prefiere una u otra.
    #[serde(default = "default_burbuja")]
    pub bubble_style: String,
    /// Minutos al este de UTC, que manda el frontend al arrancar. Rust no tiene
    /// forma barata de saber la zona horaria local sin una crate, y sin esto la
    /// fecha del prompt es UTC: a las once de la noche de aquí diría «ayer».
    #[serde(default)]
    pub tz_offset_min: i32,
}

fn default_burbuja() -> String {
    "solida".to_string()
}

fn default_trato() -> String {
    "tú".to_string()
}

fn default_idioma_respuesta() -> String {
    "auto".to_string()
}

fn default_ui_language() -> String {
    "system".to_string()
}

fn default_hf_endpoint() -> String {
    "https://router.huggingface.co/v1".to_string()
}

fn default_hf_model() -> String {
    "Qwen/Qwen3-8B".to_string()
}

fn default_openrouter_model() -> String {
    "openai/gpt-4o-mini".to_string()
}

fn default_gemini_model() -> String {
    "gemini-2.0-flash".to_string()
}

/// `openai/gpt-oss-120b` es de los pocos de Groq que llevan límite publicado del
/// plan de desarrollador; los `llama-3.3-70b-versatile` y `llama-3.1-8b-instant`
/// salen con «contact with sales», y un 404 «you do not have access» lo
/// confirmó. Aun así el valor de verdad es la lista que devuelve `/models` con
/// su clave, que es lo que enseña ahora el selector.
fn default_groq_model() -> String {
    "openai/gpt-oss-120b".to_string()
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

/// Las carpetas ignoradas de serie: lo que casi nunca es el proyecto.
fn default_ignore_dirs() -> Vec<String> {
    crate::agent::ignore::por_defecto()
}

fn default_chat_font_size() -> String {
    "md".to_string()
}

fn default_chat_font_family() -> String {
    "sans".to_string()
}

fn default_densidad() -> String {
    "comoda".to_string()
}

fn default_acento() -> String {
    "violeta".to_string()
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

/// El cuadrado es el único tamaño que los dos motores entienden igual.
fn default_image_size() -> String {
    "1024x1024".to_string()
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
            hf_endpoint: default_hf_endpoint(),
            hf_model: default_hf_model(),
            openrouter_model: default_openrouter_model(),
            gemini_model: default_gemini_model(),
            groq_model: default_groq_model(),
            local_model: "llama3.2".to_string(),
            vision_modelos: Vec::new(),
            theme: "dark".to_string(),
            ui_language: default_ui_language(),
            run_command_enabled: false,
            assistant_name: String::new(),
            reasoning_effort: "off".to_string(),
            image_provider: String::new(),
            image_model: String::new(),
            image_size: default_image_size(),
            audio_provider: String::new(),
            audio_model: String::new(),
            audio_voice: String::new(),
            default_approval_level: default_approval_level(),
            code_mode: false,
            web_search: false,
            chat_font_size: default_chat_font_size(),
            chat_font_family: default_chat_font_family(),
            densidad: default_densidad(),
            acento: default_acento(),
            avatar_style: default_avatar_style(),
            avatar_color: default_avatar_color(),
            avatar_emoji: default_avatar_emoji(),
            sidebar_compact: false,
            projects_section_open: true,
            chats_section_open: true,
            files_panel_open: true,
            tasks_panel_open: true,
            files_panel_width: default_files_width(),
            tasks_panel_width: default_tasks_width(),
            focus_mode: false,
            notify_on_finish: true,
            review_plan: false,
            redact_secrets: true,
            ignore_dirs: default_ignore_dirs(),
            user_address: default_trato(),
            answer_language: default_idioma_respuesta(),
            user_notes: String::new(),
            bubble_style: default_burbuja(),
            tz_offset_min: 0,
        }
    }
}

pub fn load_settings(state: &AppState) -> Settings {
    // Un mutex envenenado significa que OTRO hilo murió con la conexión cogida;
    // la conexión sigue siendo válida, así que se recupera en vez de tumbar
    // también a este hilo (que es justo lo que dejaría la app sin ajustes).
    let conn = state.db.lock().unwrap_or_else(|e| e.into_inner());
    let stored = crate::db::get_setting(&conn, "settings").unwrap_or(None);
    stored
        .and_then(|raw| serde_json::from_str::<Settings>(&raw).ok())
        .unwrap_or_default()
}

pub fn save_settings(state: &AppState, settings: &Settings) -> Result<(), String> {
    let conn = state.db.lock().unwrap_or_else(|e| e.into_inner());
    crate::db::set_setting(
        &conn,
        "settings",
        &serde_json::to_string(settings).map_err(|e| e.to_string())?,
    )
}

/// El router de Hugging Face, OpenRouter y la capa compatible de Gemini hablan el
/// dialecto de OpenAI, así que se reutiliza su proveedor en vez de escribir uno
/// por casa. Se acepta tanto la base (`…/v1`) como la URL ya completa de
/// `chat/completions`.
fn openai_chat_url(base: &str) -> String {
    let base = base.trim_end_matches('/');
    if base.ends_with("/chat/completions") {
        return base.to_string();
    }
    format!("{base}/chat/completions")
}

/// Los tres proveedores de dialecto OpenAI se construyen igual: solo cambian la
/// base, la etiqueta de los errores y la entrada del llavero de la que sale la
/// clave. `entrada` sirve también de id corto, que es lo que se guarda con cada
/// mensaje para saber quién lo respondió.
fn openai_en_base(
    entrada: &str,
    label: &str,
    base: &str,
    model: &str,
    esfuerzo: &str,
) -> Result<OpenAiProvider, String> {
    let key = crate::providers::get_api_key(entrada).ok_or_else(|| {
        crate::providers::ProviderError::MissingKey(label.to_string()).to_string()
    })?;
    Ok(
        OpenAiProvider::with_base_url(key, model.to_string(), openai_chat_url(base))
            .with_label(label, entrada)
            .with_reasoning(esfuerzo),
    )
}

/// La casilla «Sin razonamiento» de la interfaz: `reasoning_effort: none`. El
/// `off` que dejaron guardado los ajustes anteriores vale exactamente igual, para
/// que no haya dos maneras de pedir lo mismo según cuándo se instaló Hatboo.
///
/// Solo se le pide a Ollama / llama.cpp: ahí está documentado, y si el servidor lo
/// rechaza hay reintento (`providers::local`). En la nube cada router hace una
/// cosa distinta con ese campo —algunos lo ignoran, otros contestan 400—, así que
/// allí se trata como «no pedirlo» y punto: la decisión es del modelo, no una
/// ruleta.
pub fn esfuerzo_efectiva<'a>(proveedor: &'a str, esfuerzo: &'a str) -> &'a str {
    let esfuerzo = if esfuerzo == "off" { "none" } else { esfuerzo };
    if esfuerzo == "none" && proveedor != "local" {
        "off"
    } else {
        esfuerzo
    }
}

/// Proveedor concreto, eligiendo proveedor, modelo y nivel de razonamiento a pelo
/// en vez de tomar los tres de los ajustados. El chat baja el razonamiento él
/// solo cuando lo que llega es un saludo.
pub fn provider_for(
    state: &AppState,
    provider: &str,
    model: &str,
    esfuerzo: &str,
) -> Result<Box<dyn AiProvider>, String> {
    let settings = load_settings(state);
    let esfuerzo = esfuerzo_efectiva(provider, esfuerzo);
    match provider {
        "anthropic" => {
            let key = crate::providers::get_api_key("anthropic").ok_or_else(|| {
                crate::providers::ProviderError::MissingKey("Anthropic".into()).to_string()
            })?;
            Ok(Box::new(
                AnthropicProvider::new(key, model.to_string()).with_reasoning(esfuerzo),
            ))
        }
        "openai" => {
            let key = crate::providers::get_api_key("openai").ok_or_else(|| {
                crate::providers::ProviderError::MissingKey("OpenAI".into()).to_string()
            })?;
            Ok(Box::new(
                OpenAiProvider::new(key, model.to_string()).with_reasoning(esfuerzo),
            ))
        }
        "hf" => Ok(Box::new(openai_en_base(
            "hf",
            "Hugging Face",
            &settings.hf_endpoint,
            model,
            esfuerzo,
        )?)),
        "openrouter" => Ok(Box::new(openai_en_base(
            "openrouter",
            "OpenRouter",
            OPENROUTER_BASE,
            model,
            esfuerzo,
        )?)),
        "gemini" => Ok(Box::new(openai_en_base(
            "gemini",
            "Google Gemini",
            GEMINI_BASE,
            model,
            esfuerzo,
        )?)),
        "groq" => Ok(Box::new(openai_en_base(
            "groq",
            "Groq",
            GROQ_BASE,
            model,
            esfuerzo,
        )?)),
        "local" => Ok(Box::new(
            LocalProvider::new(&settings.local_endpoint, model).with_reasoning(esfuerzo),
        )),
        other => Err(format!("Proveedor desconocido: {other}")),
    }
}

/// Proveedor activo según settings + keychain, con el nivel de razonamiento
/// elegido por quien llama. El chat lo baja solo cuando lo que llega es un
/// saludo: cuatro minutos pensando un «hola» es tiempo robado a la conversación,
/// no inteligencia extra.
pub fn build_provider(state: &AppState, esfuerzo: &str) -> Result<Box<dyn AiProvider>, String> {
    let settings = load_settings(state);
    let modelo = match settings.active_provider.as_str() {
        "anthropic" => settings.anthropic_model.clone(),
        "openai" => settings.openai_model.clone(),
        "hf" => settings.hf_model.clone(),
        "openrouter" => settings.openrouter_model.clone(),
        "gemini" => settings.gemini_model.clone(),
        "groq" => settings.groq_model.clone(),
        _ => settings.local_model.clone(),
    };
    provider_for(state, &settings.active_provider, &modelo, esfuerzo)
}

/// Igual que `build_provider` pero devolviendo la capacidad de tool calling.
/// El razonamiento extendido aplica a los dos modos: en el agente el loop
/// reenvía los bloques de pensamiento que exija el proveedor (ver
/// `providers::tool_calling`).
pub fn build_tool_provider(state: &AppState) -> Result<Box<dyn ToolCallingProvider>, String> {
    let settings = load_settings(state);
    let effort = esfuerzo_efectiva(&settings.active_provider, &settings.reasoning_effort);
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
        "hf" => Ok(Box::new(openai_en_base(
            "hf",
            "Hugging Face",
            &settings.hf_endpoint,
            &settings.hf_model,
            effort,
        )?)),
        "openrouter" => Ok(Box::new(openai_en_base(
            "openrouter",
            "OpenRouter",
            OPENROUTER_BASE,
            &settings.openrouter_model,
            effort,
        )?)),
        "gemini" => Ok(Box::new(openai_en_base(
            "gemini",
            "Google Gemini",
            GEMINI_BASE,
            &settings.gemini_model,
            effort,
        )?)),
        "groq" => Ok(Box::new(openai_en_base(
            "groq",
            "Groq",
            GROQ_BASE,
            &settings.groq_model,
            effort,
        )?)),
        "local" => Ok(Box::new(
            LocalProvider::new(&settings.local_endpoint, &settings.local_model)
                .with_reasoning(effort),
        )),
        other => Err(format!("Proveedor desconocido: {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::esfuerzo_efectiva;

    #[test]
    fn apagar_el_pensamiento_solo_se_le_pide_a_lo_local() {
        // Ollama y llama.cpp documentan `reasoning_effort: none` y tienen
        // reintento si el servidor lo rechaza.
        assert_eq!(esfuerzo_efectiva("local", "none"), "none");
        // En la nube ese campo es una lotería según el router: se trata como «no
        // pedirlo», que es lo que no puede romper nada.
        for nube in ["openai", "anthropic", "gemini", "openrouter", "hf", "groq"] {
            assert_eq!(esfuerzo_efectiva(nube, "none"), "off", "se coló en {nube}");
        }
        // Los demás niveles pasan tal cual por todos lados.
        assert_eq!(esfuerzo_efectiva("hf", "high"), "high");
        assert_eq!(esfuerzo_efectiva("openai", "off"), "off");
        // El `off` guardado por los ajustes viejos es la misma casilla: en lo
        // local se traduce a `none` y se pide; en la nube no hay nada que mandar.
        assert_eq!(esfuerzo_efectiva("local", "off"), "none");
    }
}
