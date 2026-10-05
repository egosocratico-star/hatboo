//! Proveedores e inteligencia: modelos disponibles, prueba de conexión, imagen
//! generada y voz.

use super::_comunes::remove_image_files;
use crate::db;
use crate::providers;
use crate::state::{self, AppState};
use std::path::Path;
use tauri::State;

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
