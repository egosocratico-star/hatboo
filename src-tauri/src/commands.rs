use crate::backup;
use crate::db;
use crate::machine;
use crate::providers::{self, ChatMessage, StreamDelta};
use crate::state::{self, AppState, Settings};
use crate::web;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{Emitter, Manager, State};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChunkPayload {
    conversation_id: String,
    delta: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReasoningPayload {
    conversation_id: String,
    delta: String,
}

/// Fase previa a la respuesta: `searching` mientras se consulta la web.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusPayload {
    conversation_id: String,
    phase: String,
    detail: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DonePayload {
    conversation_id: String,
    message: db::Message,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CancelledPayload {
    conversation_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorPayload {
    conversation_id: String,
    message: String,
}

#[tauri::command]
pub fn list_conversations(app: State<AppState>) -> Result<Vec<db::Conversation>, String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::list_conversations(&conn)
}

#[tauri::command]
pub fn create_conversation(
    app: State<AppState>,
    title: Option<String>,
    project_id: Option<String>,
) -> Result<db::Conversation, String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::create_conversation(
        &conn,
        &title.unwrap_or_else(|| "Nueva conversación".into()),
        project_id.as_deref(),
    )
}

#[tauri::command]
pub fn delete_conversation(app: State<AppState>, conversation_id: String) -> Result<(), String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    let images = db::conversation_image_files(&conn, &conversation_id)?;
    db::delete_conversation(&conn, &conversation_id)?;
    remove_image_files(images);
    Ok(())
}

/// El prompt con el que se manda cada respuesta. No se guarda en ninguna parte:
/// se vuelve a armar con las mismas funciones que lo envían, para que lo que se
/// lee aquí sea literalmente lo que lee el modelo.
#[tauri::command]
pub fn system_prompt_of(app: State<AppState>, conversation_id: String) -> Result<String, String> {
    let aj = state::load_settings(&app);
    let skills = {
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        let texto = db::enabled_skills_prompt(&conn)?;
        let memoria = db::memoria_prompt(&conn)?;
        match db::get_conversation(&conn, &conversation_id)
            .map_err(|_| "Esta conversación ya no existe.".to_string())?
            .project_id
        {
            None => return Ok(chat_system_prompt(&aj, &texto, &memoria)),
            Some(pid) => {
                let proyecto = db::get_project(&conn, &pid)?;
                (texto, memoria, PathBuf::from(proyecto.root_path), proyecto.approval_level)
            }
        }
    };
    Ok(crate::agent::loop_runner::system_prompt(
        &skills.2,
        &skills.3,
        &aj.assistant_name,
        &skills.0,
        aj.code_mode,
        &project_rules_for_prompt(&skills.2),
        &skills.1,
        aj.tz_offset_min,
    ))
}

/// Guarda el texto sin enviar de un hilo. La clave `nueva` es la del chat que
/// todavía no existe como conversación.
#[tauri::command]
pub fn save_draft(app: State<AppState>, conversation_id: String, text: String) -> Result<(), String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::set_draft(&conn, &conversation_id, &text)
}

#[tauri::command]
pub fn get_drafts(app: State<AppState>) -> Result<std::collections::HashMap<String, String>, String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    Ok(db::list_drafts(&conn)?.into_iter().collect())
}

/// Título corto a partir del primer mensaje. Cortar por caracteres dejaba
/// «lee a.txt y luego b.txt y dime…» partido a media palabra.
fn titulo_breve(texto: &str) -> String {
    let limpio: String = texto.split_whitespace().collect::<Vec<_>>().join(" ");
    if limpio.chars().count() <= 34 {
        return limpio;
    }
    let corte = limpio
        .char_indices()
        .take_while(|(i, _)| *i < 34)
        .last()
        .map(|(i, c)| i + c.len_utf8())
        .unwrap_or(34);
    let mut cabeza = &limpio[..corte];
    if let Some((ultimo, _)) = cabeza.match_indices(' ').last() {
        // Solo se queda con la palabra anterior si no deja un título ridículo.
        if ultimo > 12 {
            cabeza = &cabeza[..ultimo];
        }
    }
    format!("{}…", cabeza.trim_end())
}

#[tauri::command]
pub fn rename_conversation(
    app: State<AppState>,
    conversation_id: String,
    title: String,
) -> Result<(), String> {
    let titulo = titulo_breve(&title);
    if titulo.is_empty() {
        return Err("El título no puede quedar vacío.".into());
    }
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::rename_conversation(&conn, &conversation_id, &titulo)
}

/// Fijar y archivar comparten comando porque salen del mismo menú y cada opción
/// cambia una sola de las dos cosas.
#[tauri::command]
pub fn set_conversation_flags(
    app: State<AppState>,
    conversation_id: String,
    pinned: Option<bool>,
    archived: Option<bool>,
) -> Result<(), String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::set_conversation_flags(&conn, &conversation_id, pinned, archived)
}

#[tauri::command]
pub fn search_chats(
    app: State<AppState>,
    query: String,
) -> Result<Vec<db::SearchHit>, String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::search_chats(&conn, &query)
}

#[tauri::command]
pub fn list_messages(app: State<AppState>, conversation_id: String) -> Result<Vec<db::Message>, String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::hilo_activo(&conn, &conversation_id)
}

#[tauri::command]
pub fn get_settings(app: State<AppState>) -> Settings {
    state::load_settings(&app)
}

#[tauri::command]
pub fn update_settings(app: State<AppState>, settings: Settings) -> Result<Settings, String> {
    state::save_settings(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
pub fn set_api_key(provider: String, key: String) -> Result<(), String> {
    providers::set_api_key(&provider, &key)
}

#[tauri::command]
pub fn has_api_key(provider: String) -> bool {
    providers::get_api_key(&provider).is_some()
}

#[tauri::command]
pub fn delete_api_key(provider: String) -> Result<(), String> {
    providers::delete_api_key(&provider)
}

// ---------- Plantillas de comportamiento (Agent Skills) ----------

/// Lo que envía la interfaz para crear o editar una plantilla. Con `id` vacío se
/// crea una nueva; el resto de campos los normaliza `db::save_skill`.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillDraft {
    #[serde(default)]
    pub id: String,
    pub name: String,
    pub prompt: String,
    #[serde(default)]
    pub enabled: bool,
}

#[tauri::command]
pub fn list_skills(app: State<AppState>) -> Result<Vec<db::Skill>, String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::list_skills(&conn)
}

#[tauri::command]
pub fn save_skill(app: State<AppState>, skill: SkillDraft) -> Result<db::Skill, String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    let draft = db::Skill {
        id: skill.id,
        name: skill.name,
        prompt: skill.prompt,
        enabled: skill.enabled,
        created_at: 0,
    };
    db::save_skill(&conn, &draft)
}

#[tauri::command]
pub fn set_skill_enabled(app: State<AppState>, id: String, enabled: bool) -> Result<(), String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::set_skill_enabled(&conn, &id, enabled)
}

#[tauri::command]
pub fn delete_skill(app: State<AppState>, id: String) -> Result<(), String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::delete_skill(&conn, &id)
}

/// Nombre y texto de un archivo de plantilla. Acepta la cabecera que reparten
/// los ecosistemas de agentes (`---` con `name:` y `description:`), una primera
/// línea `# Título`, o ninguna de las dos.
fn parse_skill_markdown(crudo: &str, defecto: &str) -> (String, String) {
    let crudo = crudo.trim_start_matches('\u{feff}');
    let lineas: Vec<&str> = crudo.lines().collect();
    let mut nombre = String::new();
    let mut descripcion = String::new();
    let mut con_cabecera = false;
    let mut cuerpo = crudo.trim().to_string();

    if lineas.first().map(|l| l.trim()) == Some("---") {
        // La cabecera termina en el siguiente `---` a pelo.
        let fin = lineas[1..].iter().position(|l| matches!(l.trim(), "---" | "..."));
        if let Some(i) = fin {
            for linea in &lineas[1..=i] {
                let Some((clave, valor)) = linea.split_once(':') else { continue };
                let clave = clave.trim();
                let valor = valor.trim().trim_matches('"').trim().trim_matches('\'').trim();
                match clave {
                    "name" | "title" if nombre.is_empty() => nombre = valor.to_string(),
                    "description" => descripcion = valor.to_string(),
                    _ => {}
                }
            }
            cuerpo = lineas[i + 2..].join("\n").trim().to_string();
            con_cabecera = true;
        }
    }
    if nombre.is_empty() && !con_cabecera {
        // Sin cabecera, un `# Título` al principio hace de nombre.
        if let Some(titulo) = lineas.iter().map(|l| l.trim()).find(|l| !l.is_empty()) {
            if let Some(t) = titulo.strip_prefix("# ") {
                nombre = t.trim().to_string();
                cuerpo = cuerpo.strip_prefix(titulo).unwrap_or(&cuerpo).trim().to_string();
            }
        }
    }
    if nombre.is_empty() {
        nombre = defecto.to_string();
    }
    // La descripción dice CUÁNDO usar la plantilla; el cuerpo, QUÉ hacer. Los dos
    // van al prompt: separados se perdería el contexto de la instrucción.
    let texto = match (descripcion.is_empty(), cuerpo.is_empty()) {
        (true, true) => String::new(),
        (true, false) => cuerpo,
        (false, true) => descripcion,
        (false, false) => format!("{descripcion}\n\n{cuerpo}"),
    };
    (nombre.trim().to_string(), texto)
}

/// Instala una plantilla desde un archivo `.md` o desde la carpeta que la
/// contiene (`mi-plantilla/SKILL.md`, que es como se comparten). Si ya existe
/// una con el mismo nombre se actualiza: instalar dos veces no duplica.
#[tauri::command]
pub fn install_skill(app: State<AppState>, path: String) -> Result<db::Skill, String> {
    let ruta = PathBuf::from(&path);
    let archivo = if ruta.is_dir() {
        ["SKILL.md", "skill.md", "README.md"]
            .iter()
            .map(|n| ruta.join(n))
            .find(|p| p.is_file())
            .ok_or_else(|| "La carpeta no tiene un SKILL.md ni un README.md.".to_string())?
    } else {
        ruta.clone()
    };
    let crudo = std::fs::read_to_string(&archivo)
        .map_err(|e| format!("No se pudo leer «{}»: {e}", archivo.display()))?;
    if crudo.len() > ATTACHMENT_MAX_BYTES {
        return Err("El archivo es demasiado grande para ser una plantilla.".into());
    }
    let defecto = archivo
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .filter(|s| s != "SKILL" && s != "skill" && s != "README")
        .or_else(|| {
            archivo
                .parent()
                .and_then(|p| p.file_name())
                .map(|n| n.to_string_lossy().into_owned())
        })
        .unwrap_or_else(|| "Plantilla importada".to_string());
    let (nombre, prompt) = parse_skill_markdown(&crudo, &defecto);
    if prompt.trim().is_empty() {
        return Err("El archivo no trae instrucciones que instalar.".into());
    }
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    let existente = db::list_skills(&conn)?
        .into_iter()
        .find(|s| s.name.eq_ignore_ascii_case(nombre.trim()));
    db::save_skill(
        &conn,
        &db::Skill {
            id: existente.map(|s| s.id).unwrap_or_default(),
            name: nombre,
            prompt,
            enabled: true,
            created_at: 0,
        },
    )
}

/// Devuelve una plantilla a un archivo `.md` para poder compartirla o
/// versionarla. Lo que se exporta se vuelve a instalar tal cual.
#[tauri::command]
pub fn export_skill(app: State<AppState>, id: String, path: String) -> Result<(), String> {
    let skill = {
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        db::list_skills(&conn)?
            .into_iter()
            .find(|s| s.id == id)
            .ok_or_else(|| "Esa plantilla ya no existe.".to_string())?
        };
    let mut lineas = String::from("---\n");
    lineas.push_str(&format!("name: {}\n", skill.name.replace('\n', " ")));
    lineas.push_str("---\n\n");
    lineas.push_str(&skill.prompt);
    lineas.push('\n');
    std::fs::write(PathBuf::from(&path), lineas)
        .map_err(|e| format!("No se pudo escribir «{path}»: {e}"))
}

// ---------- Memoria escrita por el usuario ----------

#[tauri::command]
pub fn list_memories(app: State<AppState>) -> Result<Vec<db::Memoria>, String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::list_memories(&conn)
}

#[tauri::command]
pub fn save_memory(
    app: State<AppState>,
    id: String,
    content: String,
) -> Result<db::Memoria, String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::save_memory(&conn, &id, &content)
}

#[tauri::command]
pub fn delete_memory(app: State<AppState>, id: String) -> Result<(), String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::delete_memory(&conn, &id)
}

// ---------- Metadatos de archivos del proyecto ----------

#[derive(serde::Serialize)]
pub struct FileMeta {
    pub size: i64,
    pub mtime: i64,
}

/// Tamaño y fecha de un archivo del proyecto, para la tarjeta que sale bajo la
/// respuesta que lo escribió. La ruta llega RELATIVA y se valida contra la raíz
/// del proyecto como cualquier otra ruta del agente: un «../» que salga fuera
/// se rechaza sin tocar disco.
#[tauri::command]
pub fn file_meta(
    app: State<AppState>,
    project_id: String,
    ruta: String,
) -> Result<FileMeta, String> {
    let root = {
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        PathBuf::from(db::get_project(&conn, &project_id)?.root_path)
    };
    let canon = root.canonicalize().map_err(|e| e.to_string())?;
    let junta = canon.join(ruta.replace('/', std::path::MAIN_SEPARATOR_STR));
    let destino = junta
        .canonicalize()
        .map_err(|_| "Ese archivo ya no existe.".to_string())?;
    if !destino.starts_with(&canon) {
        return Err("La ruta queda fuera del proyecto.".into());
    }
    let md = std::fs::metadata(&destino).map_err(|e| e.to_string())?;
    let mtime = md
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    Ok(FileMeta {
        size: md.len() as i64,
        mtime,
    })
}

/// Lista los modelos instalados en un servidor Ollama para el selector de Ajustes.
#[tauri::command]
pub async fn list_local_models(endpoint: String) -> Result<Vec<providers::OllamaModel>, String> {
    providers::list_ollama_models(&endpoint).await
}

/// Tope de una imagen generada: los motores de nube sueltan PNGs de varios MB,
/// y el límite de las adjuntas a mano (4 MB) se quedaría corto.
const IMAGEN_GENERADA_MAX_BYTES: usize = 12 * 1024 * 1024;

/// Pide una imagen al motor elegido en Ajustes → API y la deja en el hilo como
/// respuesta del asistente.
///
/// Se guarda en `attachments` en vez de viajar como data URI: así vuelve a
/// aparecer al reabrir la conversación, pesa lo justo en el historial y un
/// modelo con visión la puede volver a mirar como cualquier adjunto.
#[tauri::command]
pub async fn generate_image(
    app: State<'_, AppState>,
    conversation_id: String,
    prompt: String,
) -> Result<db::Message, String> {
    let prompt = prompt.trim().to_string();
    if prompt.is_empty() {
        return Err("Escribe primero qué quieres en la imagen.".into());
    }
    // El pedido se guarda como mensaje del usuario ANTES de llamar al motor: sin
    // esa fila la imagen caería en el hilo sin contexto, y en las vueltas
    // siguientes el modelo no sabría qué se le pidió. Si la generación falla, la
    // fila se queda igual que en el chat normal: un mensaje sin respuesta.
    {
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        db::add_message(&conn, &conversation_id, "user", &prompt, None)?;
    }
    imagen_al_hilo(&app, &conversation_id, &prompt).await
}

/// Llama al motor, escribe el archivo en disco y deja la respuesta en el hilo.
/// Es la parte que comparten el pedido nuevo y el reintento; el mensaje del
/// usuario se escribe fuera, porque al repetir ya está puesto.
async fn imagen_al_hilo(
    app: &State<'_, AppState>,
    conversation_id: &str,
    prompt: &str,
) -> Result<db::Message, String> {
    let settings = state::load_settings(app);
    let (motor, modelo, tamano) = (
        settings.image_provider.clone(),
        settings.image_model.clone(),
        settings.image_size.clone(),
    );
    let imagen = providers::imagen::generar(&motor, &modelo, prompt, &tamano).await?;
    if imagen.bytes.len() > IMAGEN_GENERADA_MAX_BYTES {
        return Err(format!(
            "La imagen generada pesa {} MB y pasa del límite de 12 MB.",
            imagen.bytes.len() / 1_048_576
        ));
    }
    let ext = match imagen.media_type.as_str() {
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        _ => "png",
    };
    let dir = app.data_dir.join("attachments");
    std::fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear la carpeta: {e}"))?;
    let dest = dir.join(format!("{}.{}", uuid::Uuid::new_v4(), ext));
    std::fs::write(&dest, &imagen.bytes).map_err(|e| format!("No se pudo guardar: {e}"))?;

    // La descripción se recorta al escribirla en el hilo: el prompt completo ya
    // no hace falta en cada turno siguiente, y sin límite un prompt largo se
    // queda comiendo contexto conversación tras conversación.
    let corto: String = prompt.trim().chars().take(180).collect();
    let texto = format!(
        "Imagen generada con {motor} a partir de: «{corto}»",
        motor = if motor.is_empty() { "el motor" } else { &motor }
    );
    let meta = db::AssistantMeta {
        attachments: vec![db::Attachment {
            // El nombre sale del prompt, pero solo con letras y números: es lo
            // que se usa para nombrar el archivo en el disco.
            name: format!(
                "{}.{}",
                corto
                    .chars()
                    .filter(|c| c.is_alphanumeric())
                    .take(20)
                    .collect::<String>()
                    .to_lowercase(),
                ext
            ),
            text: String::new(),
            image_media_type: Some(imagen.media_type.clone()),
            image_file: Some(dest.display().to_string()),
        }],
        ..Default::default()
    };
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::add_message_detailed(&conn, conversation_id, "assistant", &texto, Some("imagen"), &meta)
}

/// Reintenta un dibujo: quita la última imagen del hilo y la vuelve a pedir con
/// el mismo texto. Sin esto el «Reintentar» de una imagen borraba el dibujo y
/// dejaba al modelo de texto contestando sobre algo que no era suyo.
#[tauri::command]
pub async fn regenerate_image(
    app: State<'_, AppState>,
    conversation_id: String,
) -> Result<db::Message, String> {
    let (prompt, archivos_viejos) = {
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        let msgs = db::hilo_activo(&conn, &conversation_id)?;
        let ultimo = msgs
            .iter()
            .rev()
            .find(|m| m.role == "assistant")
            .ok_or("No hay dibujo que repetir.")?;
        if ultimo.provider.as_deref() != Some("imagen") {
            return Err("La última respuesta no es un dibujo.".into());
        }
        let pedido = msgs
            .iter()
            .rev()
            .find(|m| m.role == "user")
            .map(|m| m.content.clone())
            .ok_or("No encuentro el pedido original.")?;
        let archivos: Vec<String> = ultimo
            .attachments
            .iter()
            .filter_map(|a| a.image_file.clone())
            .collect();
        db::delete_last_assistant_message(&conn, &conversation_id)?;
        (pedido, archivos)
    };
    let nuevo = imagen_al_hilo(&app, &conversation_id, &prompt).await?;
    // Los archivos del dibujo descartado se quitan después de tener el nuevo: si
    // la generación falla, lo que había en disco sigue sirviendo.
    remove_image_files(archivos_viejos);
    Ok(nuevo)
}

/// Tope de un audio sintetizado: unos veinte minutos de MP3. Si el motor
/// devolviera otra cosa, se corta aquí en vez de escribirlo.
const AUDIO_MAX_BYTES: usize = 20 * 1024 * 1024;

/// Devuelve un archivo de audio de `attachments/` como data URI. Mismo candado
/// que las imágenes: la ruta se canonicaliza y tiene que seguir dentro de la
/// carpeta de Hatboo.
fn audio_data_uri(attachments_dir: &Path, file: &str) -> Result<String, String> {
    use base64::{engine::general_purpose, Engine as _};
    let root = attachments_dir
        .canonicalize()
        .map_err(|_| "La carpeta de adjuntos no existe.".to_string())?;
    let path = Path::new(file)
        .canonicalize()
        .map_err(|_| "El audio ya no está disponible.".to_string())?;
    if !path.starts_with(&root) {
        return Err("Ese archivo no está en la carpeta de adjuntos de Hatboo.".into());
    }
    let media_type = match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default()
        .as_str()
    {
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "aac" => "audio/aac",
        "flac" => "audio/flac",
        _ => return Err("Formato de audio no soportado.".into()),
    };
    let bytes = std::fs::read(&path).map_err(|e| format!("No se pudo leer: {e}"))?;
    Ok(format!(
        "data:{media_type};base64,{}",
        general_purpose::STANDARD.encode(&bytes)
    ))
}

/// Lee un mensaje del hilo en voz alta con el motor de Ajustes → API y devuelve
/// un data URI listo para meter en un `<audio>`.
///
/// El archivo se guarda como `attachments/voz-<id del mensaje>.mp3`, así que al
/// segundo clic no se vuelve a llamar al motor: cobrar dos veces por escuchar lo
/// mismo no tiene defensa. Si mañana se pide otro `response_format`, el nombre
/// de aquí abajo tiene que cambiar con él.
#[tauri::command]
pub async fn speak_message(
    app: State<'_, AppState>,
    message_id: String,
) -> Result<String, String> {
    // El id viene del frontend y acaba en un nombre de archivo: los uuid son
    // alfanuméricos con guiones, y cualquier otra cosa se rechaza antes.
    if message_id.is_empty()
        || !message_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err("Ese identificador de mensaje no es válido.".into());
    }
    let settings = state::load_settings(&app);
    let dir = app.data_dir.join("attachments");
    let cached = dir.join(format!("voz-{message_id}.mp3"));
    if cached.is_file() {
        return audio_data_uri(&dir, &cached.display().to_string());
    }
    let (motor, modelo, voz) = (
        settings.audio_provider.clone(),
        settings.audio_model.clone(),
        settings.audio_voice.clone(),
    );
    // Se lee lo que hay en la base de datos, no lo que el frontend mande: si el
    // mensaje se editó entre medias, se escucha la versión guardada.
    let texto = {
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        db::message_text(&conn, &message_id)?
    };
    let audio = providers::audio::sintetizar(&motor, &modelo, &voz, &texto).await?;
    if audio.bytes.len() > AUDIO_MAX_BYTES {
        return Err(format!(
            "El audio pesa {} MB y no se guarda.",
            audio.bytes.len() / 1_048_576
        ));
    }
    std::fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear la carpeta: {e}"))?;
    std::fs::write(&cached, &audio.bytes).map_err(|e| format!("No se pudo guardar el audio: {e}"))?;
    audio_data_uri(&dir, &cached.display().to_string())
}

/// Ids que ofrece el router de Hugging Face, para el buscador del selector.
#[tauri::command]
pub async fn list_hf_models(endpoint: String) -> Result<Vec<String>, String> {
    providers::list_hf_models(&endpoint).await
}

/// Los modelos que deja usar la clave guardada de un proveedor. La lista la da
/// el propio proveedor: Hatboo no sabe ni adivina qué puede cada cuenta.
#[tauri::command]
pub async fn list_provider_models(
    provider: String,
    endpoint: String,
) -> Result<Vec<String>, String> {
    providers::list_provider_models(&provider, &endpoint).await
}

/// Suelta un modelo de la memoria de Ollama. Es lo que hace `ollama stop`:
/// `POST /api/generate` con `keep_alive: 0` y sin prompt, que responde
/// `done_reason: "unload"` sin generar nada.
#[tauri::command]
pub async fn unload_local_model(endpoint: String, model: String) -> Result<(), String> {
    let model = model.trim().to_string();
    if model.is_empty() {
        return Err("Falta el nombre del modelo.".into());
    }
    let url = format!("{}/api/generate", endpoint.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        // Un modelo grande puede tardar en soltarse más de lo que tarda en responder.
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .post(&url)
        .json(&serde_json::json!({ "model": model, "keep_alive": 0 }))
        .send()
        .await
        .map_err(|e| format!("No se pudo conectar con Ollama: {e}"))?;
    let estado = response.status().as_u16();
    if estado >= 400 {
        let cuerpo = response.text().await.unwrap_or_default();
        return Err(format!("Ollama respondió {estado}: {cuerpo}"));
    }
    Ok(())
}

/// Prueba de conexión para un proveedor (sin enviar un mensaje real).
#[tauri::command]
pub async fn test_provider(
    provider: String,
    model: String,
    endpoint: String,
) -> Result<String, String> {
    providers::test_connection(&provider, &model, &endpoint).await
}

/// Carga el historial de la conversación en formato de proveedor.
/// Los adjuntos de TEXTO se anteponen al contenido (la burbuja sigue limpia);
/// las IMÁGENES (M3) se leen desde disco, se codifican a base64 y viajan como
/// `ImagePart` aparte, no dentro de `content`.
fn history(app: &AppState, conversation_id: &str) -> Result<Vec<ChatMessage>, String> {
    use base64::{engine::general_purpose, Engine as _};
    use crate::providers::ImagePart;
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    let messages = db::hilo_activo(&conn, conversation_id)?;
    Ok(messages
        .into_iter()
        .map(|m| {
            let mut text_prefix = String::new();
            let mut images: Vec<ImagePart> = Vec::new();
            for a in &m.attachments {
                if let Some(path) = &a.image_file {
                    match std::fs::read(path) {
                        Ok(bytes) => images.push(ImagePart {
                            media_type: a
                                .image_media_type
                                .clone()
                                .unwrap_or_else(|| "image/png".to_string()),
                            data_base64: general_purpose::STANDARD.encode(&bytes),
                        }),
                        Err(_) => {
                            text_prefix.push_str(&format!(
                                "[Adjunto no disponible: {}]\n\n",
                                a.name
                            ));
                        }
                    }
                } else {
                    text_prefix.push_str(&format!(
                        "[Archivo adjunto: {}]\n{}\n\n",
                        a.name, a.text
                    ));
                }
            }
            let content = if text_prefix.is_empty() {
                m.content
            } else {
                format!("{}{}", text_prefix, m.content)
            };
            ChatMessage {
                role: m.role,
                content,
                images,
            }
        })
        .collect())
}

#[tauri::command]
pub async fn send_message(
    app: tauri::AppHandle,
    conversation_id: String,
    content: String,
    attachments: Option<Vec<db::Attachment>>,
) -> Result<db::Message, String> {
    let attachments = attachments.unwrap_or_default();
    // 1. Guardar el mensaje del usuario.
    let user_message = {
        let state = app.state::<AppState>();
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let msg = db::add_message_with_attachments(
            &conn,
            &conversation_id,
            "user",
            &content,
            None,
            &attachments,
        )?;
        let conv_title: String = conn
            .query_row(
                "SELECT title FROM conversations WHERE id = ?1",
                rusqlite::params![conversation_id],
                |row| row.get(0),
            )
            .unwrap_or_default();
        if conv_title == "Nueva conversación" {
            let _ = db::rename_conversation(&conn, &conversation_id, &titulo_breve(&content));
        }
        msg
    };

    // 2. Streaming en segundo plano con el historial recién guardado.
    spawn_chat_stream(app, conversation_id)?;
    Ok(user_message)
}

/// Regenera la última respuesta del asistente. No la borra: retrocede el hilo al
/// mensaje del usuario y la respuesta nueva nace como hermana de la anterior, así
/// que «‹ 1/2 ›» deja ver las dos.
#[tauri::command]
pub async fn regenerate_response(
    app: tauri::AppHandle,
    conversation_id: String,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        if !db::preparar_regeneracion(&conn, &conversation_id)? {
            return Err("No hay respuesta que regenerar.".into());
        }
    }
    spawn_chat_stream(app, conversation_id)
}

/// Edita un mensaje ya enviado por el usuario: se escribe una versión nueva en el
/// mismo punto y la anterior queda como variante navegable. Lo que había después
/// no se toca ni se borra, solo deja de estar en el camino activo.
#[tauri::command]
pub async fn edit_user_message(
    app: tauri::AppHandle,
    conversation_id: String,
    message_id: String,
    content: String,
) -> Result<(), String> {
    let content = content.trim().to_string();
    if content.is_empty() {
        return Err("El mensaje no puede quedar vacío.".into());
    }
    let state = app.state::<AppState>();
    if state
        .chat_runs
        .lock()
        .map_err(|e| e.to_string())?
        .contains_key(&conversation_id)
    {
        return Err("Espera a que termine la respuesta en curso.".into());
    }
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let (conv_id, role, _) = db::message_position(&conn, &message_id)?;
        if conv_id != conversation_id {
            return Err("Ese mensaje no pertenece a esta conversación.".into());
        }
        if role != "user" {
            return Err("Solo se editan los mensajes que enviaste tú.".into());
        }
        // Sin `remove_image_files`: las imágenes de la versión vieja siguen
        // vivas en esa variante, y borrarlas rompería la versión 1.
        db::crear_variante(&conn, &message_id, &content)?;
    }
    spawn_chat_stream(app, conversation_id)
}

/// Pone otra versión de un mismo punto del hilo como la activa.
#[tauri::command]
pub fn select_message_variant(app: State<AppState>, message_id: String) -> Result<(), String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::activar_variante(&conn, &message_id)
}

/// Guarda una versión nueva de un artifacto del panel. Si ya había otro con el
/// mismo título e idioma en esta conversación, este pasa a ser la versión 2, 3…
/// y los anteriores se conservan.
#[tauri::command]
pub fn save_artifact(
    app: State<AppState>,
    conversation_id: String,
    titulo: String,
    lenguaje: String,
    contenido: String,
) -> Result<db::Artifact, String> {
    let titulo = titulo.trim().to_string();
    if titulo.is_empty() {
        return Err("El artifacto necesita un título.".into());
    }
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::guardar_artifact(
        &conn,
        &conversation_id,
        &titulo,
        &lenguaje,
        &contenido,
    )
}

#[tauri::command]
pub fn list_artifacts(
    app: State<AppState>,
    conversation_id: String,
) -> Result<Vec<db::Artifact>, String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::listar_artifacts(&conn, &conversation_id)
}

#[tauri::command]
pub fn delete_artifact(app: State<AppState>, id: String) -> Result<(), String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::borrar_artifact(&conn, &id)
}

/// Puntúa una respuesta del asistente (`"up"` / `"down"`); `None` la quita.
#[tauri::command]
pub fn set_message_feedback(
    app: State<AppState>,
    message_id: String,
    feedback: Option<String>,
) -> Result<(), String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::set_message_feedback(&conn, &message_id, feedback.as_deref())
}

/// Copia las imágenes que entran en la rama a archivos nuevos. Si la rama
/// apuntara a los mismos ficheros, borrar una de las dos conversaciones se
/// llevaría las imágenes de la otra (`delete_conversation` limpia disco).
#[tauri::command]
pub fn branch_conversation(
    app: State<AppState>,
    conversation_id: String,
    up_to_message_id: String,
) -> Result<db::Conversation, String> {
    let imagenes = {
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        let todos = db::hilo_activo(&conn, &conversation_id)?;
        let hasta = todos
            .iter()
            .position(|m| m.id == up_to_message_id)
            .ok_or("Ese mensaje no es de esta conversación.")?;
        todos[..=hasta]
            .iter()
            .flat_map(|m| m.attachments.iter())
            .filter_map(|a| a.image_file.clone())
            .collect::<Vec<_>>()
    };

    let dir = app.data_dir.join("attachments");
    let mut renombre = std::collections::HashMap::new();
    for viejo in &imagenes {
        if renombre.contains_key(viejo) {
            continue;
        }
        let destino = format!(
            "{}{}",
            uuid::Uuid::new_v4(),
            std::path::Path::new(viejo)
                .extension()
                .map(|e| format!(".{}", e.to_string_lossy()))
                .unwrap_or_default()
        );
        std::fs::copy(dir.join(viejo), dir.join(&destino))
            .map_err(|e| format!("No se pudo copiar una imagen de la rama: {e}"))?;
        renombre.insert(viejo.clone(), destino);
    }

    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::branch_conversation(&conn, &conversation_id, &up_to_message_id, &renombre)
}

/// Borra todos los mensajes de una conversación (More → Limpiar conversación),
/// conservando la conversación misma.
#[tauri::command]
pub fn clear_conversation_messages(
    app: State<AppState>,
    conversation_id: String,
) -> Result<(), String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    let images = db::conversation_image_files(&conn, &conversation_id)?;
    db::clear_messages(&conn, &conversation_id)?;
    remove_image_files(images);
    Ok(())
}

/// Máximo de bytes que se leen de un archivo adjunto de texto (M2).
const ATTACHMENT_MAX_BYTES: usize = 200_000;
const ATTACHMENT_IMAGE_EXTS: [&str; 7] =
    ["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico"];

/// Lee un archivo elegido por el usuario para adjuntarlo a un mensaje. Es la
/// puerta única del «+»: una imagen se guarda y se referencia como payload de
/// visión; lo demás se lee como texto, con truncado para no comerse la ventana de
/// contexto. Antes había dos opciones en el menú y dos comandos para lo mismo.
#[tauri::command]
pub fn read_attachment(
    app: State<'_, AppState>,
    path: String,
) -> Result<db::Attachment, String> {
    let canonical = std::path::Path::new(&path)
        .canonicalize()
        .map_err(|_| "No se encontró el archivo.".to_string())?;
    if !canonical.is_file() {
        return Err("La ruta seleccionada no es un archivo.".into());
    }
    let name = canonical
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "archivo".to_string());
    let ext = canonical
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    if ATTACHMENT_IMAGE_EXTS.contains(&ext.as_str()) {
        return guardar_imagen(app.inner(), &canonical);
    }
    let bytes = std::fs::read(&canonical).map_err(|e| format!("No se pudo leer: {e}"))?;
    if bytes.contains(&0) {
        return Err(format!(
            "«{name}» parece un archivo binario y no se puede adjuntar como texto."
        ));
    }
    let truncated = bytes.len() > ATTACHMENT_MAX_BYTES;
    let slice = &bytes[..bytes.len().min(ATTACHMENT_MAX_BYTES)];
    let mut text = String::from_utf8_lossy(slice).into_owned();
    if truncated {
        text.push_str("\n\n[... el archivo se truncó por tamaño ...]");
    }
    Ok(db::Attachment::text(name, text))
}

/// Lo que se soltó encima de la ventana, repartido: las carpetas son proyectos (el
/// gesto de siempre) y los archivos van al mensaje que se está escribiendo. Sin
/// este reparto, soltar un .png intentaba abrirlo como proyecto y contestaba un
/// error.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Soltadas {
    pub carpetas: Vec<String>,
    pub archivos: Vec<String>,
}

#[tauri::command]
pub fn clasifica_soltadas(paths: Vec<String>) -> Soltadas {
    let mut carpetas = Vec::new();
    let mut archivos = Vec::new();
    for p in paths {
        if std::path::Path::new(&p).is_dir() {
            carpetas.push(p);
        } else {
            archivos.push(p);
        }
    }
    Soltadas { carpetas, archivos }
}

/// Hosts de los que se puede leer. Lista cerrada a propósito: la URL la pega el
/// usuario y sin esto esto sería un `fetch` arbitrario desde la máquina, con
/// `http://localhost:11434` o el endpoint de metadatos de la nube incluidos.
const GITHUB_HOSTS: [&str; 3] = [
    "github.com",
    "raw.githubusercontent.com",
    "gist.githubusercontent.com",
];

/// Divide una URL en (host, resto) sin crate `url`, como en `web.rs`.
fn partir_url(url: &str) -> Option<(&str, &str)> {
    let resto = url.strip_prefix("https://").or_else(|| url.strip_prefix("http://"))?;
    let (host, camino) = resto.split_once('/')?;
    Some((host.split(':').next()?, camino))
}

fn sin_query(s: &str) -> &str {
    s.split('?').next().unwrap_or(s)
}

/// Convierte la URL que pega el usuario en la URL cruda que hay que pedir y el
/// nombre con el que se etiqueta el adjunto. `None` si no es una forma que
/// reconocemos.
fn github_a_cruda(url: &str) -> Option<(String, String)> {
    let (host, camino) = partir_url(url)?;
    if !GITHUB_HOSTS.contains(&host) {
        return None;
    }
    // El query se quita aquí, una vez: si no, `?plain=1` de una URL de GitHub se
    // colaría en la ruta de raw y el archivo no aparecería.
    let camino = sin_query(camino);
    let tramos: Vec<&str> = camino.split('/').collect();
    match host {
        "github.com" => {
            // github.com/<owner>/<repo>/blob/<ref>/<path...>
            if tramos.len() >= 5 && tramos[2] == "blob" {
                let (owner, repo, _ref, ruta) = (tramos[0], tramos[1], tramos[3], &tramos[4..]);
                let ruta = ruta.join("/");
                let nombre = ruta.split('/').next_back()?.to_string();
                Some((
                    format!("https://raw.githubusercontent.com/{owner}/{repo}/{_ref}/{ruta}"),
                    nombre,
                ))
            } else if tramos.len() == 2 {
                // Raíz del repo: se pide su README por la API.
                Some((
                    format!("https://api.github.com/repos/{}/{}/readme", tramos[0], tramos[1]),
                    "README.md".to_string(),
                ))
            } else {
                None
            }
        }
        // raw.githubusercontent.com/<owner>/<repo>/<ref>/<path...>
        // gist.githubusercontent.com/<id>/<raw>/<archivo>
        _ => {
            let ruta = camino.rsplit('/').next().filter(|s| !s.is_empty())?;
            Some((format!("https://{host}/{camino}"), ruta.to_string()))
        }
    }
}

/// Lee un archivo de GitHub como contexto de texto, sin clonar el repo.
/// Es solo lectura y solo hacia github.com; lo que se obtiene entra por la misma
/// ruta que un archivo adjunto del disco.
#[tauri::command]
pub async fn fetch_github(url: String) -> Result<db::Attachment, String> {
    let (destino, nombre) = github_a_cruda(url.trim())
        .ok_or("Esa URL no es de GitHub. Pega la de un archivo (…/blob/main/…) o la raíz de un repo.")?;

    let cliente = reqwest::Client::builder()
        // Sin esto una URL de github.com válida podría redirigir a cualquier
        // host y convertir la lista de arriba en decorado.
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(20))
        .user_agent("hatboo")
        .build()
        .map_err(|e| e.to_string())?;

    let peticion = cliente.get(&destino);
    // La API de README devuelve JSON salvo que se pida el crudo explícitamente.
    let peticion = if destino.starts_with("https://api.github.com/") {
        peticion.header(reqwest::header::ACCEPT, "application/vnd.github.raw")
    } else {
        peticion
    };

    let respuesta = peticion
        .send()
        .await
        .map_err(|e| format!("No se pudo alcanzar GitHub: {e}"))?;
    let estado = respuesta.status();
    if estado == reqwest::StatusCode::NOT_FOUND {
        return Err("Ese archivo no existe en esa rama, o el repo es privado.".into());
    }
    if estado.as_u16() == 403 {
        return Err("GitHub está limitando las peticiones anónimas (403). Inténtalo en un rato o abre el archivo tú mismo y adjúntalo desde el disco.".into());
    }
    if !estado.is_success() {
        return Err(format!("GitHub respondió {estado}."));
    }

    let bytes = respuesta
        .bytes()
        .await
        .map_err(|e| format!("La descarga se cortó: {e}"))?;
    if bytes.contains(&0) {
        return Err(format!("«{nombre}» parece binario y no se puede adjuntar como texto."));
    }
    let corte = bytes.len().min(ATTACHMENT_MAX_BYTES);
    let mut texto = String::from_utf8_lossy(&bytes[..corte]).into_owned();
    if bytes.len() > corte {
        texto.push_str("\n\n[... el archivo se truncó por tamaño ...]");
    }
    Ok(db::Attachment::text(nombre, texto))
}

/// Máximo de bytes de una imagen adjunta (M3), antes de copiarla a disco.
const IMAGE_MAX_BYTES: usize = 4 * 1024 * 1024;
/// Guarda una imagen en `data_dir/attachments` y devuelve la referencia (no el
/// binario) para adjuntarla al mensaje. Es el ramo de imagen de `read_attachment`:
/// tenerlo en una función es lo que permite que un solo «+» acepte cualquier
/// archivo. Solo formatos de visión comunes y tamaño acotado; el base64 se
/// genera al construir el payload.
fn guardar_imagen(
    app: &AppState,
    canonical: &std::path::Path,
) -> Result<db::Attachment, String> {
    let ext = canonical
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    let media_type = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => {
            return Err(
                "Formato de imagen no soportado. Usa PNG, JPG, GIF o WEBP.".into(),
            )
        }
    };
    let bytes = std::fs::read(&canonical).map_err(|e| format!("No se pudo leer: {e}"))?;
    if bytes.len() > IMAGE_MAX_BYTES {
        return Err(format!(
            "La imagen pesa {} MB; el máximo es 4 MB.",
            (bytes.len() as f64 / 1_048_576.0 * 10.0).round() / 10.0
        ));
    }
    let dir = app.data_dir.join("attachments");
    std::fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear la carpeta: {e}"))?;
    let dest = dir.join(format!("{}.{}", uuid::Uuid::new_v4(), ext));
    std::fs::write(&dest, &bytes).map_err(|e| format!("No se pudo guardar la imagen: {e}"))?;
    let name = canonical
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| dest.display().to_string());
    Ok(db::Attachment {
        name,
        text: String::new(),
        image_media_type: Some(media_type.to_string()),
        image_file: Some(dest.display().to_string()),
    })
}

/// Captura la pantalla principal y la guarda como imagen adjunta, para enseñar
/// un error o una maqueta sin tener que guardar el archivo antes. Sale por el
/// mismo camino que una imagen elegida del disco: `data_dir/attachments` y
/// referencia en el mensaje, nunca el binario en SQLite.
#[tauri::command]
pub fn capture_screen(app: State<AppState>, nombre: String) -> Result<db::Attachment, String> {
    #[cfg(target_os = "windows")]
    {
        use image::ImageEncoder;
        let monitor = xcap::Monitor::all()
            .map_err(|e| format!("No se pudieron listar las pantallas: {e}"))?
            .into_iter()
            .find(|m| m.is_primary().unwrap_or(false))
            .or_else(|| xcap::Monitor::all().ok().and_then(|v| v.into_iter().next()))
            .ok_or("No se encontró ninguna pantalla que capturar.")?;
        let imagen = monitor
            .capture_image()
            .map_err(|e| format!("La captura falló: {e}"))?;

        let mut png: Vec<u8> = Vec::new();
        let codificador = image::codecs::png::PngEncoder::new(&mut png);
        codificador
            .write_image(
                imagen.as_raw(),
                imagen.width(),
                imagen.height(),
                image::ExtendedColorType::Rgba8,
            )
            .map_err(|e| format!("No se pudo codificar el PNG: {e}"))?;
        if png.len() > IMAGE_MAX_BYTES {
            return Err(format!(
                "La captura pesa {} MB; el máximo es 4 MB.",
                (png.len() as f64 / 1_048_576.0 * 10.0).round() / 10.0
            ));
        }

        // El nombre lo pone el frente (ahí sí hay hora local), pero llega por el
        // wire: sin separadores y con .png siempre, que es lo que acabamos de codificar.
        let nombre = {
            let limpio = nombre
                .chars()
                .filter(|c| !matches!(c, '/' | '\\' | ':' | '\0'))
                .collect::<String>();
            let base = limpio.trim_end_matches(".png");
            format!("{}.png", if base.is_empty() { "captura" } else { base })
        };
        let dir = app.data_dir.join("attachments");
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("No se pudo crear la carpeta: {e}"))?;
        let destino = dir.join(format!("{}.png", uuid::Uuid::new_v4()));
        std::fs::write(&destino, &png).map_err(|e| format!("No se pudo guardar: {e}"))?;
        Ok(db::Attachment {
            name: nombre,
            text: String::new(),
            image_media_type: Some("image/png".to_string()),
            image_file: Some(destino.display().to_string()),
        })
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, nombre);
        Err("La captura de pantalla está hecha solo para Windows por ahora.".into())
    }
}

/// Devuelve una imagen adjunta como data URI para poder pintarla en la burbuja.
/// La ruta llega desde la BD —y tras una importación ese JSON es ajeno—, así que
/// se canonicaliza y se exige que siga dentro de `attachments/` antes de leer.
#[tauri::command]
pub fn attachment_image(app: State<AppState>, file: String) -> Result<String, String> {
    image_data_uri(&app.data_dir.join("attachments"), &file)
}

fn image_data_uri(attachments_dir: &Path, file: &str) -> Result<String, String> {
    use base64::{engine::general_purpose, Engine as _};
    let root = attachments_dir
        .canonicalize()
        .map_err(|_| "La carpeta de adjuntos no existe.".to_string())?;
    let path = Path::new(file)
        .canonicalize()
        .map_err(|_| "La imagen ya no está disponible.".to_string())?;
    if !path.starts_with(&root) {
        return Err("Ese archivo no está en la carpeta de adjuntos de Hatboo.".into());
    }
    let media_type = match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => return Err("Formato de imagen no soportado.".into()),
    };
    let bytes = std::fs::read(&path).map_err(|e| format!("No se pudo leer: {e}"))?;
    Ok(format!(
        "data:{media_type};base64,{}",
        general_purpose::STANDARD.encode(&bytes)
    ))
}

/// Borra del disco las imágenes referenciadas (ignora errores: pueden faltar).
fn remove_image_files(paths: Vec<String>) {
    for p in paths {
        let _ = std::fs::remove_file(p);
    }
}

/// Exporta una conversación a Markdown o JSON en la ruta elegida por el usuario.
/// El diálogo de guardado lo hace el frontend (plugin de diálogo); aquí solo se
/// serializa y se escribe el archivo.
#[tauri::command]
pub fn export_conversation(
    app: State<AppState>,
    conversation_id: String,
    path: String,
    format: String,
) -> Result<(), String> {
    let (title, messages) = {
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        let conv = db::get_conversation(&conn, &conversation_id)?;
        let msgs = db::hilo_activo(&conn, &conversation_id)?;
        (conv.title, msgs)
    };

    let content = match format.as_str() {
        "json" => render_json(&title, &messages),
        _ => render_markdown(&title, &messages),
    };

    std::fs::write(&path, content).map_err(|e| format!("No se pudo escribir el archivo: {e}"))?;
    Ok(())
}

fn render_json(title: &str, messages: &[db::Message]) -> String {
    let items: Vec<serde_json::Value> = messages
        .iter()
        .map(|m| {
            let atts: Vec<&str> = m.attachments.iter().map(|a| a.name.as_str()).collect();
            let mut obj = serde_json::json!({
                "role": m.role,
                "content": m.content,
                "provider": m.provider,
                "createdAt": m.created_at,
                "attachments": atts,
            });
            if let Some(r) = &m.reasoning {
                obj["reasoning"] = serde_json::json!(r);
                obj["thinkingMs"] = serde_json::json!(m.thinking_ms);
            }
            if !m.web_sources.is_empty() {
                obj["webSources"] = serde_json::json!(m.web_sources);
            }
            obj
        })
        .collect();
    let doc = serde_json::json!({ "title": title, "messages": items });
    serde_json::to_string_pretty(&doc).unwrap_or_else(|_| "{}".into())
}

fn render_markdown(title: &str, messages: &[db::Message]) -> String {
    let mut md = format!("# {title}\n\n");
    for m in messages {
        let label = if m.role == "user" { "Usuario" } else { "Asistente" };
        let mut heading = format!("### {label}");
        if let Some(p) = &m.provider {
            heading.push_str(&format!(" · {p}"));
        }
        md.push_str(&heading);
        md.push('\n');
        if !m.attachments.is_empty() {
            let names: Vec<&str> = m.attachments.iter().map(|a| a.name.as_str()).collect();
            md.push_str(&format!("> Adjuntos: {}\n", names.join(", ")));
        }
        if let Some(r) = m.reasoning.as_ref().filter(|r| !r.trim().is_empty()) {
            // En <details> para que al abrir el .md el razonamiento no tape la
            // respuesta: GitHub y VS Code lo renderizan cerrado.
            let dur = m.thinking_ms.map(human_ms).unwrap_or_default();
            md.push_str(&format!(
                "<details><summary>Razonamiento{}</summary>\n\n{}\n\n</details>\n\n",
                dur,
                r.trim()
            ));
        }
        md.push_str(m.content.trim());
        md.push_str("\n\n");
        if !m.web_sources.is_empty() {
            let links: Vec<String> = m
                .web_sources
                .iter()
                .map(|s| format!("[{}]({})", s.title, s.url))
                .collect();
            md.push_str(&format!("Fuentes: {}\n\n", links.join(" · ")));
        }
    }
    md
}

/// Duración legible para el export; devuelve cadena vacía si no hay dato.
fn human_ms(ms: i64) -> String {
    if ms < 1000 {
        format!(" ({ms} ms)")
    } else {
        format!(" ({:.1} s)", ms as f64 / 1000.0)
    }
}

/// Prompt de sistema del modo código. También lo usa el agente del modo trabajo,
/// para que el chip «Código» signifique lo mismo en las dos vistas.
pub(crate) const CODE_MODE_PROMPT: &str = "Modo código activo: responde como ingeniero senior. Ve directo \
 al código que funciona, sin preámbulos. Entrega bloques completos y ejecutables, indica la ruta \
 del archivo cuando sea relevante y señala las suposiciones que hagas. Si hay un error, explica \
 la causa raíz en una línea antes del arreglo. Prefiere la solución más simple y las dependencias \
 que ya existen en el proyecto antes de proponer nuevas.";

/// Archivo de reglas del proyecto: instrucciones que el usuario escribe una vez
/// y se pegan al system prompt del agente en cada sesión de ese proyecto.
pub(crate) const RULES_FILE: &str = "HATBOO.md";
/// Techo de lo que se inyecta en el prompt; más allá de esto ya es un libro y el
/// modelo empieza a perder el hilo.
const RULES_MAX_CHARS: usize = 6_000;
/// Techo de lo que se deja guardar desde la app.
const RULES_SAVE_MAX: usize = 20_000;

/// Contenido de `HATBOO.md` para el system prompt. Cadena vacía si no existe:
/// la mayoría de proyectos no lo tendrán y eso no debe cambiar el prompt.
pub(crate) fn project_rules_for_prompt(root: &Path) -> String {
    match std::fs::read_to_string(root.join(RULES_FILE)) {
        Ok(texto) => texto.chars().take(RULES_MAX_CHARS).collect(),
        Err(_) => String::new(),
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRules {
    pub exists: bool,
    pub content: String,
    pub path: String,
}

/// Ruta de `HATBOO.md` del proyecto. El nombre del archivo es fijo — lo único
/// que viene de fuera es la raíz, que el usuario eligió al abrir el proyecto.
fn rules_path(app: &State<AppState>, project_id: &str) -> Result<PathBuf, String> {
    let root = {
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        db::get_project(&conn, project_id)?.root_path
    };
    Ok(PathBuf::from(root).join(RULES_FILE))
}

#[tauri::command]
pub fn project_rules(
    app: State<AppState>,
    project_id: String,
) -> Result<ProjectRules, String> {
    let ruta = rules_path(&app, &project_id)?;
    Ok(ProjectRules {
        exists: ruta.is_file(),
        content: std::fs::read_to_string(&ruta).unwrap_or_default(),
        path: ruta.display().to_string(),
    })
}

#[tauri::command]
pub fn save_project_rules(
    app: State<AppState>,
    project_id: String,
    content: String,
) -> Result<ProjectRules, String> {
    let ruta = rules_path(&app, &project_id)?;
    let recortado: String = content.chars().take(RULES_SAVE_MAX).collect();
    std::fs::write(&ruta, recortado.as_bytes())
        .map_err(|e| format!("No se pudo escribir {RULES_FILE}: {e}"))?;
    Ok(ProjectRules {
        exists: true,
        content: recortado,
        path: ruta.display().to_string(),
    })
}

/// Lanza el streaming del proveedor para la conversación y emite chat:*.
///
/// Registrar el canal de cancelación es lo único que ocurre antes de devolver:
/// construir el proveedor y leer el historial (que codifica las imágenes adjuntas
/// en base64) se hace dentro de la tarea. Antes se hacían en el propio comando,
/// y eso era el parón que se veía entre pulsar Enviar y ver el mensaje en pantalla.
/// El *system prompt* del chat normal, sin efectos secundarios: lo arma
/// `spawn_chat_stream` y lo mide `context_usage` para el indicador de contexto.
///
/// Tres bloques con las cabeceras siempre iguales. Antes de esta estructura el
/// prompt podía quedarse vacío, y la única frase que mencionaba un nombre era
/// «el usuario prefiere que lo llames Azrael»: un modelo de 0,8B se presentaba
/// como Azrael porque no había nada que le dijera quién era él. Por eso el
/// nombre del usuario va en su propio bloque, lejos de la identidad.
/// Las plantillas activas van al final: si chocan con el modo código, gana lo
/// que el usuario escribió a mano.
fn chat_system_prompt(settings: &state::Settings, skills: &str, memoria: &str) -> String {
    let nombre = settings.assistant_name.trim();
    let trato = if settings.user_address.trim().eq_ignore_ascii_case("usted") {
        "usted"
    } else {
        "tú"
    };
    let idioma = match settings.answer_language.as_str() {
        "es" => "español",
        "en" => "inglés",
        _ => "el mismo idioma en que te escriba",
    };
    let quien = if nombre.is_empty() {
        "Es el usuario de esta máquina; no tiene nombre guardado.".to_string()
    } else {
        format!("Se llama «{nombre}»: úsalo para dirigirte a él, nunca para presentarte.")
    };
    let notas = if settings.user_notes.trim().is_empty() {
        String::new()
    } else {
        format!("Nota del usuario: {}\n", settings.user_notes.trim())
    };
    // Lo que puede mirar: la búsqueda es un prerrecorrido que se inyecta arriba
    // como mensaje de sistema, no una tool que llama él. Decirlo tal cual evita
    // que prometa «déjame buscar» cuando la búsqueda está apagada.
    let busqueda = if settings.web_search {
        "Búsqueda web: activada. Cuando la pregunta pide un dato actual, Hatboo ya \
         busca antes de responderte y te pasa los resultados en un bloque de sistema \
         con sus direcciones: úsalos y cítalos."
    } else {
        "Búsqueda web: apagada por el usuario. No tienes cómo mirar en internet ahora \
         mismo, así que lo que digas de actualidad sale de memoria y conviene decirlo."
    };
    let hoy = crate::behavior::hoy(settings.tz_offset_min);
    let mut system = format!(
        "## Asistente\n\
         Eres Hatboo, el asistente de escritorio del usuario. Tu nombre es Hatboo y no \
         cambia nunca; el nombre de abajo es el del usuario, no el tuyo. Si te preguntan \
         cómo te llamas, respondes «Soy Hatboo».\n\n\
         {conducta}\n\n\
         {chat}\n\n\
         ## Usuario\n\
         {quien}\n\
         Trátalo de {trato}.\n\
         Responde en {idioma}.\n\
         {notas}{memoria}\
         \n## Esta sesión\n\
         Hoy es {hoy}.\n\
         Tipo: chat (sin proyecto abierto).\n\
         {busqueda}\n",
        conducta = crate::behavior::CONDUCTA,
        chat = crate::behavior::CONDUCTA_CHAT,
    );
    if settings.code_mode {
        system.push_str(CODE_MODE_PROMPT);
    }
    system.push_str(skills);
    system
}

/// Si lo último que escribió el usuario es un saludo. El chat lo usa para
/// quitarse el razonamiento de encima: pensar cuatro minutos un «hola» no lo
/// vuelve más listo, solo más lento.
fn ultimo_mensaje_es_saludo(prompt: &[ChatMessage]) -> bool {
    prompt
        .iter()
        .rev()
        .find(|m| m.role == "user")
        .map(|m| crate::agent::loop_runner::es_saludo(&m.content))
        .unwrap_or(false)
}

fn spawn_chat_stream(app: tauri::AppHandle, conversation_id: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    let (tx, mut rx) = tokio::sync::mpsc::channel::<StreamDelta>(64);
    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel::<()>();
    state
        .chat_runs
        .lock()
        .map_err(|e| e.to_string())?
        .insert(conversation_id.clone(), cancel_tx);

    let conv_id = conversation_id.clone();
    let app_for_task = app.clone();

    tauri::async_runtime::spawn(async move {
        let state = app_for_task.state::<AppState>();

        let (provider, prompt) = match history(&state, &conv_id).and_then(|prompt| {
            let esfuerzo = if ultimo_mensaje_es_saludo(&prompt) {
                "off".to_string()
            } else {
                state::load_settings(&state).reasoning_effort.clone()
            };
            state::build_provider(&state, &esfuerzo).map(|provider| (provider, prompt))
        }) {
            Ok(prepared) => prepared,
            Err(e) => {
                state.chat_runs.lock().ok().and_then(|mut r| r.remove(&conv_id));
                let _ = app_for_task.emit(
                    "chat:error",
                    ErrorPayload {
                        conversation_id: conv_id,
                        message: e,
                    },
                );
                return;
            }
        };
        let settings = state::load_settings(&state);
        let provider_name = provider.name().to_string();
        let mut messages = prompt;

        let skills = state
            .db
            .lock()
            .ok()
            .and_then(|conn| db::enabled_skills_prompt(&conn).ok())
            .unwrap_or_default();
        let memoria = state
            .db
            .lock()
            .ok()
            .and_then(|conn| db::memoria_prompt(&conn).ok())
            .unwrap_or_default();
        let system = chat_system_prompt(&settings, &skills, &memoria);
        let system = system.trim();
        if !system.is_empty() {
            messages.insert(
                0,
                ChatMessage {
                    role: "system".into(),
                    content: system.to_string(),
                    images: Vec::new(),
                },
            );
        }

        // La búsqueda web va antes de generar: un modelo local no tiene datos
        // frescos y sin esto alucina fechas. Si falla, se responde igual.
        let mut web_sources: Vec<db::WebSource> = Vec::new();
        if settings.web_search {
            let query = messages
                .iter()
                .rev()
                .find(|m| m.role == "user")
                .map(|m| m.content.clone())
                .unwrap_or_default();
            if !query.trim().is_empty() {
                let _ = app_for_task.emit(
                    "chat:status",
                    StatusPayload {
                        conversation_id: conv_id.clone(),
                        phase: "searching".into(),
                        detail: None,
                    },
                );
                match web::search_web(&query).await {
                    Ok(results) if !results.is_empty() => {
                        let after_system = messages
                            .iter()
                            .take_while(|m| m.role == "system")
                            .count();
                        messages.insert(
                            after_system,
                            ChatMessage {
                                role: "system".into(),
                                content: web::as_context(&results, &query),
                                images: Vec::new(),
                            },
                        );
                        web_sources = results;
                    }
                    Ok(_) => {
                        let _ = app_for_task.emit(
                            "chat:status",
                            StatusPayload {
                                conversation_id: conv_id.clone(),
                                phase: "search-empty".into(),
                                detail: Some("La búsqueda no devolvió resultados.".into()),
                            },
                        );
                    }
                    Err(e) => {
                        let _ = app_for_task.emit(
                            "chat:status",
                            StatusPayload {
                                conversation_id: conv_id.clone(),
                                phase: "search-failed".into(),
                                detail: Some(e),
                            },
                        );
                    }
                }
            }
        }

        let mut full = String::new();
        let mut reasoning = String::new();
        let mut thinking_ms: Option<i64> = None;
        let started = std::time::Instant::now();
        let mut forward_error: Option<String> = None;
        let mut cancelled = false;

        let stream_task = tauri::async_runtime::spawn(async move {
            provider.stream_response(messages, tx).await
        });

        let mut cancel_rx = cancel_rx;
        loop {
            tokio::select! {
                next = rx.recv() => {
                    match next {
                        Some(StreamDelta::Text(delta)) => {
                            // El tiempo de pensamiento se mide hasta el primer
                            // carácter visible; si no hubo razonamiento, no hay nada.
                            if thinking_ms.is_none() && !reasoning.is_empty() {
                                thinking_ms = Some(started.elapsed().as_millis() as i64);
                            }
                            full.push_str(&delta);
                            let _ = app_for_task.emit(
                                "chat:chunk",
                                ChunkPayload {
                                    conversation_id: conv_id.clone(),
                                    delta,
                                },
                            );
                        }
                        Some(StreamDelta::Reasoning(delta)) => {
                            reasoning.push_str(&delta);
                            let _ = app_for_task.emit(
                                "chat:reasoning",
                                ReasoningPayload {
                                    conversation_id: conv_id.clone(),
                                    delta,
                                },
                            );
                        }
                        None => break,
                    }
                }
                // Solo cuenta una cancelación explícita; si el emisor se cierra
                // sin cancelar, la rama se deshabilita y seguimos leyendo.
                Ok(()) = &mut cancel_rx => {
                    cancelled = true;
                    break;
                }
            }
        }
        // Soltamos el receptor: el lector SSE aborta el stream HTTP al no poder
        // seguir enviando, que es lo que corta la generación en el servidor.
        drop(rx);
        state.chat_runs.lock().ok().and_then(|mut runs| runs.remove(&conv_id));

        if !cancelled {
            match stream_task.await {
                Ok(Ok(())) => {}
                Ok(Err(e)) => forward_error = Some(e.to_string()),
                Err(e) => forward_error = Some(format!("La tarea de streaming falló: {e}")),
            }
        }

        match forward_error {
            None => {
                // Al detener a mitad de respuesta se conserva lo ya generado.
                if cancelled && full.trim().is_empty() {
                    let _ = app_for_task.emit(
                        "chat:cancelled",
                        CancelledPayload {
                            conversation_id: conv_id,
                        },
                    );
                    return;
                }
                let saved = {
                    let conn = state.db.lock().map_err(|e| e.to_string()).ok();
                    let meta = db::AssistantMeta {
                        reasoning: (!reasoning.trim().is_empty()).then_some(reasoning),
                        thinking_ms,
                        web_sources,
                        ..Default::default()
                    };
                    match conn {
                        Some(conn) => db::add_message_detailed(
                            &conn,
                            &conv_id,
                            "assistant",
                            &full,
                            Some(&provider_name),
                            &meta,
                        ),
                        None => Err("Base de datos no disponible".to_string()),
                    }
                };
                match saved {
                    Ok(message) => {
                        let _ = app_for_task.emit(
                            "chat:done",
                            DonePayload {
                                conversation_id: conv_id,
                                message,
                            },
                        );
                    }
                    Err(e) => {
                        let _ = app_for_task.emit(
                            "chat:error",
                            ErrorPayload {
                                conversation_id: conv_id,
                                message: format!("No se pudo guardar la respuesta: {e}"),
                            },
                        );
                    }
                }
            }
            Some(message) => {
                let _ = app_for_task
                    .emit("chat:error", ErrorPayload { conversation_id: conv_id, message });
            }
        }
    });

    Ok(())
}

/// Resumen de una exportación completa, para mostrarlo en Ajustes → Datos.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSummary {
    pub path: String,
    pub bytes: u64,
    pub conversations: usize,
    pub messages: usize,
    pub images: usize,
}

/// Palabra que la interfaz pide escribir para el restablecimiento de fábrica.
/// Se comprueba también aquí: el borrado no depende solo del frontend.
pub const RESET_TOKEN: &str = "BORRAR TODO";

#[tauri::command]
pub fn export_all_data(app: State<AppState>, path: String) -> Result<ExportSummary, String> {
    let snapshot = {
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        backup::build_snapshot(&conn, &app.data_dir.join("attachments"))?
    };
    backup::write_snapshot(Path::new(&path), &snapshot)?;
    Ok(ExportSummary {
        bytes: std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0),
        path,
        conversations: snapshot.conversations.len(),
        messages: snapshot.messages.len(),
        images: snapshot.images.len(),
    })
}

/// Añade lo que falte de una copia (identificado por `id`): importar dos veces
/// el mismo archivo no duplica nada.
#[tauri::command]
pub fn import_all_data(app: State<AppState>, path: String) -> Result<backup::ImportReport, String> {
    let snapshot = backup::read_snapshot(Path::new(&path))?;
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    backup::apply_snapshot(&conn, &snapshot, &app.data_dir.join("attachments"))
}

/// Deja la app como recién instalada: borra conversaciones, mensajes, proyectos,
/// tareas, ajustes, las imágenes en disco y las claves del llavero.
#[tauri::command]
pub fn factory_reset(app: State<AppState>, token: String) -> Result<(), String> {
    if token.trim() != RESET_TOKEN {
        return Err("Escribe el texto de confirmación tal cual para restablecer.".into());
    }
    {
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        db::wipe_all(&conn)?;
    }
    let attachments = app.data_dir.join("attachments");
    if let Ok(entries) = std::fs::read_dir(&attachments) {
        for entry in entries.flatten() {
            let _ = std::fs::remove_file(entry.path());
        }
    }
    // Las claves viven en el llavero del sistema, no en la base de datos: hay
    // que borrarlas aquí para que el restablecimiento sea de verdad completo.
    for provider in ["anthropic", "openai", "openrouter", "gemini", "hf"] {
        let _ = providers::delete_api_key(provider);
    }
    Ok(())
}

/// Detiene el streaming de chat en curso: se guarda lo generado hasta ahora.
#[tauri::command]
pub fn cancel_chat_stream(app: State<AppState>, conversation_id: String) -> Result<(), String> {
    let sender = app
        .chat_runs
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&conversation_id);
    match sender {
        Some(sender) => {
            // Un error aquí significa que la tarea ya terminó; no hay nada que cancelar.
            let _ = sender.send(());
            Ok(())
        }
        None => Err("No hay ninguna respuesta en curso que detener.".into()),
    }
}

// ---------- Fase 2: modo trabajo ----------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    /// Bytes del archivo. En las carpetas vale 0: sumar lo que hay dentro
    /// costaría un recorrido completo por cada nivel que se abre en el árbol.
    pub size: u64,
}

fn register_project(app: &AppState, path: &str) -> Result<db::Project, String> {
    let mut root = std::path::Path::new(path)
        .canonicalize()
        .map_err(|e| format!("No se pudo abrir la carpeta: {e}"))?;
    // Si llegó un archivo en vez de una carpeta, se registra su carpeta padre
    // para que el proyecto se nombre por la carpeta y no por el archivo.
    if root.is_file() {
        root = root
            .parent()
            .ok_or("No se pudo determinar la carpeta del proyecto.")?
            .to_path_buf();
    }
    if !root.is_dir() {
        return Err("La ruta seleccionada no es una carpeta.".into());
    }
    let name = root
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| root.display().to_string());
    // Antes de bloquear la conexión: load_settings usa el mismo mutex.
    let level = state::normalize_approval_level(
        &state::load_settings(app).default_approval_level,
    );
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    let ruta = root.display().to_string();
    // La carpeta ya está registrada: se reutiliza la fila y solo se mueve al
    // frente del orden. Insertar otra dejaría dos entradas iguales en la barra.
    if let Some(existing) = db::find_project_by_root(&conn, &ruta)? {
        db::touch_project(&conn, &existing.id)?;
        return db::get_project(&conn, &existing.id);
    }
    let project = db::create_project(&conn, &name, &ruta, &level)?;
    db::touch_project(&conn, &project.id)?;
    Ok(project)
}

/// Registra en la base de datos una carpeta ya existente como proyecto.
/// La selección de carpeta la hace el frontend con el plugin de diálogo.
#[tauri::command]
pub fn open_project(app: State<AppState>, path: String) -> Result<db::Project, String> {
    register_project(&app, &path)
}

/// Crea una carpeta nueva de proyecto y la registra.
#[tauri::command]
pub fn create_project(
    app: State<AppState>,
    parent_path: String,
    name: String,
) -> Result<db::Project, String> {
    let name = name.trim();
    if name.is_empty() || name.contains(['/', '\\']) {
        return Err("Nombre de proyecto inválido.".into());
    }
    let new_dir = std::path::Path::new(&parent_path).join(name);
    std::fs::create_dir_all(&new_dir)
        .map_err(|e| format!("No se pudo crear la carpeta: {e}"))?;
    register_project(&app, &new_dir.display().to_string())
}

#[tauri::command]
pub fn list_projects(app: State<AppState>) -> Result<Vec<db::Project>, String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::list_projects(&conn)
}

#[tauri::command]
pub fn delete_project(app: State<AppState>, project_id: String) -> Result<(), String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    let images = db::project_image_files(&conn, &project_id)?;
    db::delete_project(&conn, &project_id)?;
    remove_image_files(images);
    Ok(())
}

/// Lista un nivel del árbol de archivos del proyecto (ruta relativa; "" = raíz).
#[tauri::command]
pub fn list_project_dir(
    app: State<AppState>,
    project_id: String,
    relative_path: String,
) -> Result<Vec<FileEntry>, String> {
    let root = {
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        PathBuf::from(db::get_project(&conn, &project_id)?.root_path)
    };
    let resolved = crate::agent::tools::resolve_in_project(&root, &relative_path)
        .map_err(|e| e.to_string())?;
    let entries = std::fs::read_dir(&resolved).map_err(|e| e.to_string())?;
    // La raíz se recorta ya canonicalizada. `resolve_in_project` canónica la del
    // proyecto, y si aquí se recorta contra la cadena tal como está en la base de
    // datos —otra letra, otro separador, uno de esos caminos redirigidos por
    // OneDrive— el recorte no acierta y el supuesto «relativo» sale ABSOLUTO. El
    // frontend lo devuelve al mismo comando, ese lo rechaza con razón por
    // seguridad, y el resultado es un árbol de carpetas que no enseñan nada.
    let raiz = root.canonicalize().unwrap_or_else(|_| root.clone());
    let mut out: Vec<FileEntry> = entries
        .flatten()
        .map(|e| {
            let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
            let rel = e
                .path()
                .strip_prefix(&raiz)
                .unwrap_or(e.path().as_path())
                .to_string_lossy()
                .replace('\\', "/");
            let size = if is_dir {
                0
            } else {
                e.metadata().map(|m| m.len()).unwrap_or(0)
            };
            FileEntry {
                name: e.file_name().to_string_lossy().into_owned(),
                path: rel,
                is_dir,
                size,
            }
        })
        .collect();
    out.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    out.truncate(500);
    Ok(out)
}

/// Cuánto se lee para la vista previa del panel de archivos. No es el tope de un
/// adjunto: aquí solo hay que ver de qué va el archivo, y 64 KB ya son más de mil
/// líneas en pantalla.
const PREVIEW_MAX_BYTES: usize = 64_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VistaPrevia {
    pub texto: String,
    /// Tamaño real del archivo, no lo que se llegó a leer.
    pub bytes: u64,
    pub lineas: usize,
    pub truncado: bool,
}

/// El texto de un archivo del proyecto para verlo en el panel, sin añadirlo al
/// mensaje. Pasa por el mismo candado de rutas que las herramientas del agente.
#[tauri::command]
pub fn preview_project_file(
    app: State<AppState>,
    project_id: String,
    relative_path: String,
) -> Result<VistaPrevia, String> {
    let root = {
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        PathBuf::from(db::get_project(&conn, &project_id)?.root_path)
    };
    let resuelta = crate::agent::tools::resolve_in_project(&root, &relative_path)
        .map_err(|e| e.to_string())?;
    leer_vista_previa(&resuelta)
}

/// Fuera del comando para poder probarla con un archivo temporal: el comando
/// necesita `AppState` y la base de datos abierta.
fn leer_vista_previa(ruta: &Path) -> Result<VistaPrevia, String> {
    let nombre = ruta
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "archivo".to_string());
    let bytes = std::fs::read(ruta).map_err(|e| format!("No se pudo leer: {e}"))?;
    if bytes.contains(&0) {
        return Err(format!(
            "«{nombre}» no es texto: es una imagen o un binario."
        ));
    }
    let truncado = bytes.len() > PREVIEW_MAX_BYTES;
    let texto =
        String::from_utf8_lossy(&bytes[..bytes.len().min(PREVIEW_MAX_BYTES)]).into_owned();
    let lineas = texto.lines().count();
    Ok(VistaPrevia {
        texto,
        bytes: bytes.len() as u64,
        lineas,
        truncado,
    })
}

/// Busca archivos por nombre (sin distinguir mayúsculas) dentro del proyecto.
#[tauri::command]
pub async fn search_project_files(
    app: State<'_, AppState>,
    project_id: String,
    query: String,
) -> Result<Vec<String>, String> {
    let root = {
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        PathBuf::from(db::get_project(&conn, &project_id)?.root_path)
    };
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Ok(Vec::new());
    }
    tauri::async_runtime::spawn_blocking(move || {
        Ok(buscar_por_niveles(
            &root,
            &needle,
            &Presupuesto {
                total: 20_000,
                por_carpeta: 500,
            },
        ))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Cuánto se mira antes de rendirse. Va aparte del recorrido para poder
/// comprobarlo con carpetas de prueba pequeñas.
struct Presupuesto {
    total: usize,
    por_carpeta: usize,
}

/// Nombres que contienen `needle`, recorriendo el proyecto **por niveles** y con
/// tope de entradas por carpeta.
///
/// Antes era en profundidad y con un único tope global: en una carpeta tipo
/// `Documentos` (una bóveda de Obsidian, la sincronización de OneDrive) la
/// primera subcarpeta grande se comía el presupuesto entero y ni se miraban las
/// vecinas, así que el buscador decía «sin coincidencias» de archivos que están
/// a la vista. Por niveles, con un techo de entradas por carpeta, ninguna puede
/// tapar al resto.
fn buscar_por_niveles(raiz: &Path, needle: &str, p: &Presupuesto) -> Vec<String> {
    const SKIP_DIRS: [&str; 5] = ["node_modules", "target", "dist", "build", ".git"];
    const MAX_RESULTADOS: usize = 100;
    let mut out: Vec<String> = Vec::new();
    let mut por_procesar: std::collections::VecDeque<PathBuf> = std::collections::VecDeque::new();
    por_procesar.push_back(raiz.to_path_buf());
    let mut visitadas = 0usize;
    while let Some(dir) = por_procesar.pop_front() {
        if out.len() >= MAX_RESULTADOS || visitadas >= p.total {
            break;
        }
        let Ok(read_dir) = std::fs::read_dir(&dir) else { continue };
        for entry in read_dir.flatten().take(p.por_carpeta) {
            visitadas += 1;
            let nombre = entry.file_name().to_string_lossy().into_owned();
            let es_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            if es_dir {
                if nombre.starts_with('.') || SKIP_DIRS.contains(&nombre.as_str()) {
                    continue;
                }
                por_procesar.push_back(entry.path());
            } else if nombre.to_lowercase().contains(needle) {
                if let Ok(rel) = entry.path().strip_prefix(raiz) {
                    out.push(rel.to_string_lossy().replace('\\', "/"));
                }
                if out.len() >= MAX_RESULTADOS {
                    break;
                }
            }
        }
    }
    out.sort();
    out
}

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
        let title: String = conn
            .query_row(
                "SELECT title FROM conversations WHERE id = ?1",
                rusqlite::params![conversation_id],
                |row| row.get(0),
            )
            .unwrap_or_default();
        if title == "Sesión de trabajo" {
            let _ = db::rename_conversation(&conn, &conversation_id, &titulo_breve(&request));
        }
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CambioSesion {
    pub ruta: String,
    /// El diff de la última vez que se escribió: si el agente reescribió el
    /// archivo tres veces, lo que importa es el estado final.
    pub diff: String,
    pub creado: bool,
    pub escrituras: u32,
}

/// Resumen de lo que el agente cambió en esta sesión de trabajo.
#[tauri::command]
pub fn session_changes(
    app: State<AppState>,
    conversation_id: String,
) -> Result<Vec<CambioSesion>, String> {
    let registros = {
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        db::session_writes(&conn, &conversation_id)?
    };
    // Se agregan por ruta conservando el orden de la primera aparición.
    let mut orden: Vec<String> = Vec::new();
    let mut acumulado: std::collections::HashMap<String, CambioSesion> =
        std::collections::HashMap::new();
    for r in registros {
        let Some(salida) = r.output else { continue };
        let Ok(valor) = serde_json::from_str::<serde_json::Value>(&salida) else {
            continue;
        };
        let Some(ruta) = valor["path"].as_str() else { continue };
        let entrada = acumulado.entry(ruta.to_string()).or_insert_with(|| {
            orden.push(ruta.to_string());
            CambioSesion {
                ruta: ruta.to_string(),
                diff: String::new(),
                creado: false,
                escrituras: 0,
            }
        });
        entrada.diff = valor["diff"].as_str().unwrap_or_default().to_string();
        entrada.creado = valor["created"].as_bool().unwrap_or(false);
        entrada.escrituras += 1;
    }
    Ok(orden
        .into_iter()
        .filter_map(|r| acumulado.remove(&r))
        .collect())
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
/// Se recorre en orden inverso: es la única forma de que dos escrituras del
/// mismo archivo terminen en el original y no en el penúltimo estado. Un
/// deshacer dos veces seguidas no borra nada más, porque los respaldos se van.
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
    let devueltos = revierte(&raiz, &respaldos, &registros)?;
    let _ = std::fs::remove_dir_all(&respaldos);
    Ok(devueltos)
}

/// El cuerpo de `deshace_sesion`, aparte para poder probarlo sin Tauri ni BD.
fn revierte(
    raiz: &Path,
    respaldos: &Path,
    registros: &[db::ToolCall],
) -> Result<Vec<String>, String> {
    let mut devueltos: Vec<String> = Vec::new();
    for r in registros.iter().rev() {
        let Some(salida) = &r.output else { continue };
        let Ok(valor) = serde_json::from_str::<serde_json::Value>(salida) else {
            continue;
        };
        let Some(rel) = valor["path"].as_str() else { continue };
        // La ruta la escribió el modelo, así que se vuelve a validar contra el
        // proyecto antes de pisar o borrar, igual que al ejecutar la tool.
        let Ok(destino) = crate::agent::tools::resolve_in_project(raiz, rel) else {
            continue;
        };
        let novedad = valor["created"].as_bool().unwrap_or(false);
        let hecho = if novedad {
            // Lo que la sesión creó no existía antes: deshacer es borrarlo.
            match std::fs::remove_file(&destino) {
                Ok(_) => true,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => false,
                Err(e) => return Err(format!("No se pudo borrar {rel}: {e}")),
            }
        } else {
            let original = crate::agent::loop_runner::respaldo_de(respaldos, &r.id);
            if original.exists() {
                std::fs::copy(&original, &destino)
                    .map_err(|e| format!("No se pudo devolver {rel}: {e}"))?;
                true
            } else {
                false
            }
        };
        if hecho && !devueltos.iter().any(|d| d == rel) {
            devueltos.push(rel.to_string());
        }
    }
    Ok(devueltos)
}

/// Cambia el nivel de aprobación de un proyecto (config por proyecto).
#[tauri::command]
pub fn set_project_approval_level(
    app: State<AppState>,
    project_id: String,
    level: String,
) -> Result<(), String> {
    const VALID: [&str; 4] = ["ask_always", "approve_for_me", "auto_sandbox", "full_access"];
    if !VALID.contains(&level.as_str()) {
        return Err(format!("Nivel de aprobación desconocido: {level}"));
    }
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::set_project_approval_level(&conn, &project_id, &level)
}

/// Fija o suelta un proyecto en la barra lateral.
#[tauri::command]
pub fn set_project_pinned(app: State<AppState>, project_id: String, pinned: bool) -> Result<(), String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::set_project_pinned(&conn, &project_id, pinned)
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
        herramientas: crate::agent::tools::build_tools(&aj).len(),
        comandos: aj.run_command_enabled,
        web: aj.web_search,
        plantillas,
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitInfo {
    pub is_repo: bool,
    pub branch: Option<String>,
    pub dirty_count: usize,
}

/// Estado git del proyecto para la cabecera de la vista de trabajo.
#[tauri::command]
pub async fn project_git_info(
    app: State<'_, AppState>,
    project_id: String,
) -> Result<GitInfo, String> {
    let root = {
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        PathBuf::from(db::get_project(&conn, &project_id)?.root_path)
    };
    let info = tauri::async_runtime::spawn_blocking(move || {
        use crate::agent::tools::git;
        if !git::is_git_repo(&root) {
            return GitInfo {
                is_repo: false,
                branch: None,
                dirty_count: 0,
            };
        }
        let (branch, dirty_count) = git::repo_summary(&root).unwrap_or_default();
        GitInfo {
            is_repo: true,
            branch: Some(branch),
            dirty_count,
        }
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(info)
}

// ---------- Fase 4: Ajustes → Sistema y Datos (solo lectura) ----------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    pub db_path: String,
    pub db_size_bytes: u64,
    pub attachments_path: String,
    pub attachments_size_bytes: u64,
    pub attachments_count: usize,
    pub counts: db::Counts,
}

/// Suma el peso de un árbol de archivos; se usa solo con la carpeta de adjuntos.
fn dir_size(path: &std::path::Path) -> (u64, usize) {
    let mut bytes = 0u64;
    let mut files = 0usize;
    let Ok(entries) = std::fs::read_dir(path) else {
        return (0, 0);
    };
    for entry in entries.flatten() {
        let child = entry.path();
        if child.is_dir() {
            let (b, f) = dir_size(&child);
            bytes += b;
            files += f;
        } else if let Ok(meta) = child.metadata() {
            bytes += meta.len();
            files += 1;
        }
    }
    (bytes, files)
}

/// Manda un aviso de prueba **sin mirar si la ventana está en primer plano**.
/// Sin esto, comprobar el camino del toast exigía poner el ratón en otra ventana
/// mientras una sesión de trabajo terminaba de verdad.
#[tauri::command]
pub fn test_notification(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title("Hatboo")
        .body("Si ves esto, los avisos de sesión llegan bien.")
        .show()
        .map_err(|e| format!("Windows no pudo mostrar el aviso: {e}"))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextUsage {
    /// Caracteres de texto que saldrían hacia el proveedor en el próximo turno.
    pub chars: usize,
    /// Estimación a ojo: ~4 caracteres por token. No es el contador del proveedor.
    pub est_tokens: usize,
    pub messages: usize,
    /// Las imágenes viajan en base64 y dominan el costo real; se cuentan aparte
    /// para que el número de texto no parezca mentira.
    pub images: usize,
    /// De dónde salen esos caracteres. Separar el traje fijo de la conversación
    /// es lo que permite decir «esto no lo puedes quitar» y «esto sí».
    pub system_chars: usize,
    pub history_chars: usize,
}

/// Lo que ocuparía el prompt del próximo turno de esta conversación. Cuenta el
/// mismo `history()` que usa `spawn_chat_stream`, así que el adjunto ya va
/// antepuesto como `[Archivo adjunto: …]` y el número no se desvía del real.
#[tauri::command]
pub fn context_usage(app: State<AppState>, conversation_id: String) -> Result<ContextUsage, String> {
    let messages = history(&app, &conversation_id)?;
    let settings = state::load_settings(&app);
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    let skills = db::enabled_skills_prompt(&conn)?;
    let memoria = db::memoria_prompt(&conn)?;
    drop(conn);
    let system = chat_system_prompt(&settings, &skills, &memoria);

    let system_chars = system.trim().chars().count();
    let history_chars: usize = messages.iter().map(|m| m.content.chars().count()).sum();
    let images: usize = messages.iter().map(|m| m.images.len()).sum();
    let chars = system_chars + history_chars;
    Ok(ContextUsage {
        chars,
        est_tokens: chars / 4,
        messages: messages.len(),
        images,
        system_chars,
        history_chars,
    })
}

/// Dónde vive lo que Hatboo guarda en este PC y cuánto ocupa.
#[tauri::command]
pub fn get_storage_info(app: State<AppState>) -> Result<StorageInfo, String> {
    let db_path = app.data_dir.join("hatboo.db");
    let db_size_bytes = db_path
        .metadata()
        .map(|m| m.len())
        .unwrap_or(0);
    let attachments_dir = app.data_dir.join("attachments");
    let (attachments_size_bytes, attachments_count) = dir_size(&attachments_dir);
    let counts = {
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        db::table_counts(&conn)?
    };
    Ok(StorageInfo {
        db_path: db_path.display().to_string(),
        db_size_bytes,
        attachments_path: attachments_dir.display().to_string(),
        attachments_size_bytes,
        attachments_count,
        counts,
    })
}

/// Lo que hay en este PC y si Ollama está despierto. El Centro de modelos decide
/// con esto qué se puede bajar: una tienda que no conoce la máquina del usuario
/// solo sabe vender humo.
#[tauri::command]
pub async fn hardware_info(app: tauri::AppHandle) -> machine::HardwareInfo {
    let endpoint = {
        let state = app.state::<AppState>();
        state::load_settings(&state).local_endpoint.clone()
    };
    let locales = providers::list_ollama_models(&endpoint).await;
    machine::HardwareInfo {
        locales: locales.as_ref().map(Vec::len).unwrap_or_default(),
        ollama_ok: locales.is_ok(),
        base: machine::lee_hardware(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

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

    #[test]
    fn el_nombre_del_usuario_no_es_el_del_asistente() {
        let mut aj = state::Settings::default();
        aj.assistant_name = "Azrael".into();
        let p = chat_system_prompt(&aj, "", "");
        assert!(p.contains("Eres Hatboo"));
        assert!(p.contains("Se llama «Azrael»"));
        assert!(p.contains("«Soy Hatboo»"));
        assert!(p.contains("## Esta sesión"));
        // El nombre del usuario no puede aparecer en su propio bloque de identidad.
        let asistente = p.split("## Usuario").next().unwrap();
        assert!(!asistente.contains("Azrael"), "{asistente}");
    }

    #[test]
    fn el_chat_pide_responder_corto_y_sin_relleno() {
        let p = chat_system_prompt(&state::Settings::default(), "", "");
        assert!(p.contains("Cómo hablas:"), "{p}");
        assert!(p.contains("sin preámbulos"));
        assert!(p.contains("Breve por defecto"));
        // El estilo va en el bloque del asistente: si cayera debajo de «## Usuario»,
        // un modelo pequeño lo leería como una preferencia del usuario y lo negocia.
        let asistente = p.split("## Usuario").next().unwrap();
        assert!(asistente.contains("Cómo hablas:"), "{asistente}");
    }

    #[test]
    fn el_chat_sabe_la_fecha_y_lo_que_puede_mirar() {
        let por_defecto = chat_system_prompt(&state::Settings::default(), "", "");
        // Sin fecha no hay forma de contestar a «ayer» ni de buscar con el año
        // bien: es lo que hacía alucinar fechas a los modelos locales.
        assert!(por_defecto.contains("Hoy es "), "{por_defecto}");
        assert!(por_defecto.contains("Búsqueda web: apagada"), "{por_defecto}");
        // Y deja claro que aquí no toca archivos, para que no lo finja.
        assert!(
            por_defecto.contains("no tienes herramientas de disco"),
            "{por_defecto}"
        );

        let mut aj = state::Settings::default();
        aj.web_search = true;
        let con_busqueda = chat_system_prompt(&aj, "", "");
        assert!(con_busqueda.contains("Búsqueda web: activada"));
        assert!(!con_busqueda.contains("Búsqueda web: apagada"));
    }

    #[test]
    fn trato_idioma_y_nota_llegan_al_bloque_de_usuario() {
        let mut aj = state::Settings::default();
        aj.user_address = "usted".into();
        aj.answer_language = "en".into();
        aj.user_notes = "Estudio programación.".into();
        let p = chat_system_prompt(&aj, "", "");
        assert!(p.contains("Trátalo de usted."));
        assert!(p.contains("Responde en inglés."));
        assert!(p.contains("Nota del usuario: Estudio programación."));

        let por_defecto = chat_system_prompt(&state::Settings::default(), "", "");
        assert!(por_defecto.contains("Trátalo de tú."));
        assert!(!por_defecto.contains("Nota del usuario"));
        // Sin nombre guardado tampoco queda un hueco raro.
        assert!(por_defecto.contains("no tiene nombre guardado"));
    }

    #[test]
    fn el_titulo_corta_por_palabra_y_sin_saltos() {
        assert_eq!(titulo_breve("hola\n\t¿qué tal?"), "hola ¿qué tal?");
        assert_eq!(titulo_breve("   espaciado   sucio   "), "espaciado sucio");
        assert_eq!(
            titulo_breve("lee a.txt y luego b.txt y dime cuántas líneas tiene cada uno"),
            "lee a.txt y luego b.txt y dime…"
        );
        // Un texto sin espacios no se puede partir por palabra: se corta igual.
        assert_eq!(titulo_breve(&"x".repeat(80)).chars().count(), 35);
        assert_eq!(titulo_breve(""), "");
    }

    #[test]
    fn una_skill_con_cabecera_se_instala_con_su_nombre_y_su_texto() {
        let crudo = "---\nname: Revisión de código\ndescription: Busca bugs graves primero\n---\n\n\
                     Cita archivo y línea.\nNo propongas cambios de estilo.\n";
        let (nombre, texto) = parse_skill_markdown(crudo, "SKILL");
        assert_eq!(nombre, "Revisión de código");
        assert_eq!(
            texto,
            "Busca bugs graves primero\n\nCita archivo y línea.\nNo propongas cambios de estilo."
        );
    }

    #[test]
    fn sin_cabecera_manda_el_titulo_y_si_no_el_nombre_del_archivo() {
        let (nombre, texto) = parse_skill_markdown("# Explicar paso a paso\n\nDi qué hace cada paso.", "SKILL");
        assert_eq!(nombre, "Explicar paso a paso");
        assert_eq!(texto, "Di qué hace cada paso.");

        let (otro, _) = parse_skill_markdown("solo instrucciones sueltas", "mi-plantilla");
        assert_eq!(otro, "mi-plantilla");
    }

    #[test]
    fn una_cabecera_sin_cerrar_no_se_comera_el_texto() {
        let (nombre, texto) = parse_skill_markdown("---\nname: roto\nsin cerrar", "defecto");
        assert_eq!(nombre, "defecto");
        assert_eq!(texto, "---\nname: roto\nsin cerrar");
    }

    #[test]
    fn exportar_e_instalar_devuelve_lo_mismo() {
        let (nombre, texto) = parse_skill_markdown("---\nname: Prueba\n---\n\nInstrucciones.", "x");
        let exportado = format!("---\nname: {nombre}\n---\n\n{texto}\n");
        let (nombre2, texto2) = parse_skill_markdown(&exportado, "x");
        assert_eq!(nombre2, nombre);
        assert_eq!(texto2, texto);
    }

    #[test]
    fn urls_de_github_que_se_aceptan() {
        let (cruda, nombre) =
            github_a_cruda("https://github.com/egosocratico-star/hatboo/blob/main/README.md")
                .unwrap();
        assert_eq!(
            cruda,
            "https://raw.githubusercontent.com/egosocratico-star/hatboo/main/README.md"
        );
        assert_eq!(nombre, "README.md");

        // Ruta con carpetas dentro y query que hay que quitar.
        let (cruda, _) =
            github_a_cruda("https://github.com/a/b/blob/v1.2/src-tauri/src/main.rs?x=1").unwrap();
        assert_eq!(cruda, "https://raw.githubusercontent.com/a/b/v1.2/src-tauri/src/main.rs");

        // Cruda directa.
        let (cruda, nombre) =
            github_a_cruda("https://raw.githubusercontent.com/a/b/main/Cargo.toml").unwrap();
        assert_eq!(cruda, "https://raw.githubusercontent.com/a/b/main/Cargo.toml");
        assert_eq!(nombre, "Cargo.toml");

        // Raíz del repo → README por la API.
        let (cruda, nombre) = github_a_cruda("https://github.com/a/b").unwrap();
        assert_eq!(cruda, "https://api.github.com/repos/a/b/readme");
        assert_eq!(nombre, "README.md");
    }

    #[test]
    fn cualquier_otro_host_se_rechaza() {
        // El control no es cosmético: sin la lista esto sería un fetch arbitrario
        // desde la máquina del usuario.
        for mala in [
            "http://localhost:11434/api/tags",
            "https://169.254.169.254/latest/meta-data/",
            "https://evil.com/a/b/blob/main/x.rs",
            "https://github.com.evil.com/a/b",
            "file:///c:/windows/win.ini",
            "https://github.com/",
            "no soy una url",
        ] {
            assert!(github_a_cruda(mala).is_none(), "se aceptó {mala}");
        }
    }

    /// Carpeta de adjuntos desechable con un PNG minúsculo dentro.
    fn dir_con_imagen() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hatboo-img-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut f = std::fs::File::create(dir.join("foto.png")).unwrap();
        f.write_all(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]).unwrap();
        dir
    }

    #[test]
    fn sirve_como_data_uri_una_imagen_de_la_carpeta() {
        let dir = dir_con_imagen();
        let file = dir.join("foto.png").display().to_string();
        let uri = image_data_uri(&dir, &file).unwrap();
        assert!(uri.starts_with("data:image/png;base64,"));
        assert!(uri.contains("iVBORw0KGgo"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn rechaza_rutas_de_fuera_de_la_carpeta_de_adjuntos() {
        let dir = dir_con_imagen();
        let fuera = std::env::temp_dir().join("hatboo-fuera.png");
        std::fs::write(&fuera, b"x").unwrap();
        // Escapando con .. y también con una ruta absoluta directa.
        assert!(image_data_uri(&dir, "../../hatboo-fuera.png").is_err());
        assert!(image_data_uri(&dir, &fuera.display().to_string()).is_err());
        // Y lo que no existe o no es imagen.
        assert!(image_data_uri(&dir, "no-existe.png").is_err());
        std::fs::write(dir.join("nota.txt"), b"x").unwrap();
        assert!(image_data_uri(&dir, &dir.join("nota.txt").display().to_string()).is_err());
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_file(&fuera).ok();
    }

    #[test]
    fn lo_soltado_reparte_carpetas_y_archivos() {
        // Soltar una carpeta abre un proyecto; soltar un archivo va al mensaje.
        // Si las dos cosas siguen el mismo camino, la segunda contesta un error
        // que no significa nada.
        let raiz = std::env::temp_dir().join(format!("hatboo-soltar-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&raiz).unwrap();
        let archivo = raiz.join("nota.md");
        std::fs::write(&archivo, b"hola").unwrap();

        let repartidas = clasifica_soltadas(vec![
            raiz.display().to_string(),
            archivo.display().to_string(),
        ]);
        assert_eq!(repartidas.carpetas, vec![raiz.display().to_string()]);
        assert_eq!(repartidas.archivos, vec![archivo.display().to_string()]);

        // Una ruta que ya no existe cuenta como archivo, no como carpeta: el
        // lector dirá lo que pasa en vez de abrir un proyecto a medias.
        let ido = clasifica_soltadas(vec![raiz.join("borrado.md").display().to_string()]);
        assert!(ido.carpetas.is_empty() && ido.archivos.len() == 1);

        let _ = std::fs::remove_dir_all(&raiz);
    }

    #[test]
    fn una_carpeta_enorme_no_le_roba_el_presupuesto_a_sus_vecinas() {
        // El fallo real en `Documentos`: 200 notas en la primera subcarpeta
        // bastaban para que el recorrido no llegara a mirar la del lado.
        let raiz = std::env::temp_dir().join(format!("hatboo-busca-{}", uuid::Uuid::new_v4()));
        let vault = raiz.join("aaa-vault");
        let facturas = raiz.join("b-facturas");
        std::fs::create_dir_all(&vault).unwrap();
        std::fs::create_dir_all(&facturas).unwrap();
        for i in 0..200 {
            std::fs::write(vault.join(format!("nota-{i}.md")), b"x").unwrap();
        }
        std::fs::write(facturas.join("factura-2026.pdf"), b"x").unwrap();

        let hits = buscar_por_niveles(
            &raiz,
            "factura",
            &Presupuesto {
                total: 40,
                por_carpeta: 5,
            },
        );
        assert_eq!(hits, vec!["b-facturas/factura-2026.pdf".to_string()]);

        // Y lo que se salta a propósito no vuelve: el presupuesto se nota.
        assert!(buscar_por_niveles(
            &raiz,
            "nota-199",
            &Presupuesto {
                total: 40,
                por_carpeta: 5,
            }
        )
        .is_empty());
        std::fs::remove_dir_all(&raiz).ok();
    }

    #[test]
    fn el_markdown_del_export_trae_razonamiento_y_fuentes() {
        let mut m = db::Message {
            id: "m1".into(),
            conversation_id: "c1".into(),
            role: "assistant".into(),
            content: "La respuesta.".into(),
            provider: Some("local".into()),
            created_at: 0,
            attachments: vec![],
            reasoning: Some("  Primero miro esto.  ".into()),
            thinking_ms: Some(2400),
            web_sources: vec![db::WebSource {
                title: "Docs".into(),
                url: "https://ejemplo.com/docs".into(),
                snippet: String::new(),
            }],
            feedback: None,
            parent_id: None,
            variantas: None,
        };
        let md = render_markdown("Título", &[m.clone()]);
        assert!(md.starts_with("# Título\n\n"));
        assert!(md.contains("### Asistente · local"));
        assert!(md.contains("<summary>Razonamiento (2.4 s)</summary>"));
        assert!(md.contains("Primero miro esto."));
        assert!(md.contains("[Docs](https://ejemplo.com/docs)"));

        // Sin razonamiento ni fuentes no se mete basura en el archivo.
        m.reasoning = None;
        m.thinking_ms = None;
        m.web_sources.clear();
        let limpio = render_markdown("Título", &[m]);
        assert!(!limpio.contains("<details>"));
        assert!(!limpio.contains("Fuentes:"));
    }

    #[test]
    fn la_vista_previa_corta_y_no_muerde_binarios() {
        let dir = std::env::temp_dir().join(format!(
            "hatboo-previa-{}-{}",
            std::process::id(),
            std::time::UNIX_EPOCH
                .elapsed()
                .map(|d| d.subsec_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(&dir).unwrap();

        let grande = dir.join("grande.txt");
        let mut f = std::fs::File::create(&grande).unwrap();
        f.write_all(&vec![b'x'; PREVIEW_MAX_BYTES + 10]).unwrap();
        drop(f);
        let v = leer_vista_previa(&grande).unwrap();
        assert!(v.truncado, "un archivo mayor que el tope debe decirlo");
        assert_eq!(v.texto.len(), PREVIEW_MAX_BYTES);
        assert_eq!(v.bytes as usize, PREVIEW_MAX_BYTES + 10);
        assert_eq!(v.lineas, 1);

        let corto = dir.join("corto.txt");
        std::fs::write(&corto, "uno\ndos\n").unwrap();
        let c = leer_vista_previa(&corto).unwrap();
        assert!(!c.truncado);
        assert_eq!(c.lineas, 2);
        assert_eq!(c.bytes, 8);

        let binario = dir.join("foto.bin");
        std::fs::write(&binario, [0xFF_u8, 0x00, 0x10]).unwrap();
        assert!(leer_vista_previa(&binario).is_err());

        std::fs::remove_dir_all(&dir).ok();
    }
}
