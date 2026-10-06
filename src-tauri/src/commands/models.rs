//! Proveedores e inteligencia: modelos disponibles, prueba de conexión, imagen
//! generada y voz.
//!
//! El disco de la imagen dibujada y del audio sintetizado está en
//! [`crate::servicios::adjuntos`], que es el dueño de la carpeta `attachments/`:
//! el `create_dir_all`, el `write` y el `read` del data URI, con los mensajes
//! literales de siempre. Aquí queda la ruta de ajuste (motor, modelo, voz, tamaño),
//! los topes de peso y el lock de la conexión.

use crate::db;
use crate::providers;
use crate::servicios::adjuntos::{self, remove_image_files};
use crate::state::{self, AppState};
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
    let dir = app.data_dir.join("attachments");
    // El `create_dir_all` + `write` y la elección de extensión viven en el dueño de
    // la carpeta; los dos mensajes de error son los literales de siempre.
    let (dest, ext) = adjuntos::guarda_imagen_generada(&dir, &imagen.bytes, &imagen.media_type)?;

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

/// Lee un mensaje del hilo en voz alta con el motor de Ajustes → API y devuelve
/// un data URI listo para meter en un `<audio>`.
///
/// El archivo se guarda como `attachments/voz-<id del mensaje>.mp3`, así que al
/// segundo clic no se vuelve a llamar al motor: cobrar dos veces por escuchar lo
/// mismo no tiene defensa. Si mañana se pide otro `response_format`, el nombre de
/// la caché tiene que cambiar con él —y cambia aquí y en
/// [`adjuntos::audio_en_cache`] juntos, que es la razón de que el nombre lo ponga
/// el servicio y no este comando.
///
/// La escritura del archivo y el candado de rutas del data URI —la ruta se
/// canonicaliza y tiene que seguir dentro de la carpeta de Hatboo— están en
/// [`crate::servicios::adjuntos`]. Lo que es de este comando: validar el `id` antes
/// de que acabe en un nombre de archivo, mirar el tope de peso y leer el texto
/// desde la base de datos.
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
    if let Some(cached) = adjuntos::audio_en_cache(&dir, &message_id) {
        return adjuntos::audio_data_uri(&dir, &cached.display().to_string());
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
    let cached = adjuntos::guarda_audio(&dir, &message_id, &audio.bytes)?;
    adjuntos::audio_data_uri(&dir, &cached.display().to_string())
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
///
/// El comando no monta el cliente: llama al servicio, y el servicio a
/// `providers::local`, que es quien conoce la ruta nativa de Ollama. Estar aquí
/// era el único HTTP escrito a mano que quedaba dentro de la capa IPC.
#[tauri::command]
pub async fn unload_local_model(endpoint: String, model: String) -> Result<(), String> {
    crate::servicios::modelo::ModelService::descarga_modelo(&endpoint, &model).await
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
