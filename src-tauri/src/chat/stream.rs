//! El stream del chat: los eventos que ve la interfaz y la tarea que los emite.
//!
//! Estaba todo en `commands.rs`, que a estas alturas ya no era un módulo de
//! comandos sino un cajón. Aquí vive lo que no es un `#[tauri::command]`: los
//! `*Payload` que salen por IPC, el `ProviderError` traducido a una clase que la
//! interfaz puede usar, el historial con los adjuntos montados, y la tarea que
//! rellena el canal del proveedor hasta guardarlo en SQLite.
//!
//! `commands.rs` sigue llamando a `history` y a `spawn_chat_stream` por su nombre
//! de siempre (`pub(crate) use` arriba del módulo) para que la mudanza no tocara
//! ni una de sus llamadas. El *system prompt* se queda allí: lo comparten el visor
//! de prompt y el medidor de contexto.

use crate::db;
use crate::providers::{self, ChatMessage, StreamDelta};
use crate::state::{self, AppState};
use crate::web;
use serde::Serialize;
use tauri::{Emitter, Manager};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChunkPayload {
    conversation_id: String,
    delta: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReasoningPayload {
    conversation_id: String,
    delta: String,
}

/// Fase previa a la respuesta: `searching` mientras se consulta la web.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StatusPayload {
    conversation_id: String,
    phase: String,
    detail: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DonePayload {
    conversation_id: String,
    message: db::Message,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoppedPayload {
    conversation_id: String,
    /// Lo que llegó a escribirse antes de parar, ya guardado. `None` cuando no
    /// quedó ni una palabra que conservar.
    message: Option<db::Message>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ErrorPayload {
    conversation_id: String,
    message: String,
    clase: ErrorClase,
}

/// De qué tipo es el fallo del chat. La interfaz no lo puede adivinar leyendo el
/// texto —«falta la clave» y «el proveedor respondió mal» se parecen mucho—, y sin
/// tipo no puede ofrecer la salida que corresponde: Ajustes, reintentar o apagar el
/// razonamiento.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ErrorClase {
    /// Falta la API key o el proveedor la rechaza (401).
    Clave,
    /// Nadie escucha en el endpoint: Ollama apagado, cable fuera, DNS.
    Red,
    /// Contesta con un HTTP de error (429, 500…).
    Proveedor,
    /// Contesta, pero con algo que no es el formato esperado.
    Respuesta,
    /// Ni siquiera se llegó a llamar: proveedor desconocido, ajustes sin rellenar.
    Ajustes,
    /// El resto.
    Otro,
}

impl ErrorClase {
    fn de(e: &providers::ProviderError) -> Self {
        use providers::ProviderError as P;
        match e {
            P::MissingKey(_) | P::InvalidKey(_) => Self::Clave,
            P::Connection(_, _) => Self::Red,
            P::Api(_, _) => Self::Proveedor,
            P::Malformed(_) => Self::Respuesta,
        }
    }
}

/// Los adjuntos de TEXTO se anteponen al contenido (la burbuja sigue limpia);
/// las IMÁGENES (M3) se leen desde disco, se codifican a base64 y viajan como
/// `ImagePart` aparte, no dentro de `content`.
pub(crate) fn history(app: &AppState, conversation_id: &str) -> Result<Vec<ChatMessage>, String> {
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

/// Lanza el streaming del proveedor para la conversación y emite chat:*.
///
/// Registrar el canal de cancelación es lo único que ocurre antes de devolver:
/// construir el proveedor y leer el historial (que codifica las imágenes adjuntas
/// en base64) se hace dentro de la tarea. Antes se hacían en el propio comando,
/// y eso era el parón que se veía entre pulsar Enviar y ver el mensaje en pantalla.
pub(crate) fn spawn_chat_stream(
    app: tauri::AppHandle,
    conversation_id: String,
) -> Result<(), String> {
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

        // Dos pasos separados. Mezclados en una sola cadena los dos daban el mismo
        // `chat:error` plano: no es lo mismo que falte la clave de Anthropic que
        // no poder leer el historial, y la salida que ofrece la interfaz cambia.
        let prompt = match history(&state, &conv_id) {
            Ok(prompt) => prompt,
            Err(e) => {
                state.chat_runs.lock().ok().and_then(|mut r| r.remove(&conv_id));
                let _ = app_for_task.emit(
                    "chat:error",
                    ErrorPayload {
                        conversation_id: conv_id,
                        message: e,
                        clase: ErrorClase::Otro,
                    },
                );
                return;
            }
        };
        let esfuerzo = if ultimo_mensaje_es_saludo(&prompt) {
            "off".to_string()
        } else {
            state::load_settings(&state).reasoning_effort.clone()
        };
        let provider = match state::build_provider(&state, &esfuerzo) {
            Ok(provider) => provider,
            Err(e) => {
                state.chat_runs.lock().ok().and_then(|mut r| r.remove(&conv_id));
                let _ = app_for_task.emit(
                    "chat:error",
                    ErrorPayload {
                        conversation_id: conv_id,
                        message: e,
                        clase: ErrorClase::Ajustes,
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
        // El prompt se arma donde siempre: `commands.rs` lo comparte con
        // `system_prompt_of` (ver el prompt) y con `context_usage` (el medidor).
        let system = crate::commands::chat_system_prompt(&settings, &skills, &memoria);
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
        let mut forward_error: Option<(ErrorClase, String)> = None;
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
                Ok(Err(e)) => forward_error = Some((ErrorClase::de(&e), e.to_string())),
                Err(e) => forward_error = Some((
                    ErrorClase::Otro,
                    format!("La tarea de streaming falló: {e}"),
                )),
            }
        }

        match forward_error {
            None => {
                // `chat:stopped` en los dos casos de parar: con texto a medias y
                // sin nada. Antes solo saltaba `chat:cancelled` cuando no había
                // texto, así que una respuesta cortada llegaba como `chat:done` y
                // la interfaz no podía decir si terminó el modelo o lo paraste tú.
                if cancelled && full.trim().is_empty() {
                    let _ = app_for_task.emit(
                        "chat:stopped",
                        StoppedPayload {
                            conversation_id: conv_id,
                            message: None,
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
                        // Con texto a medias lo guardado se envía, pero como
                        // `stopped`: lo que llegó a escribirse se queda en el hilo
                        // y la burbuja dice que la paraste.
                        if cancelled {
                            let _ = app_for_task.emit(
                                "chat:stopped",
                                StoppedPayload {
                                    conversation_id: conv_id,
                                    message: Some(message),
                                },
                            );
                        } else {
                            let _ = app_for_task.emit(
                                "chat:done",
                                DonePayload {
                                    conversation_id: conv_id,
                                    message,
                                },
                            );
                        }
                    }
                    Err(e) => {
                        let _ = app_for_task.emit(
                            "chat:error",
                            ErrorPayload {
                                conversation_id: conv_id,
                                message: format!("No se pudo guardar la respuesta: {e}"),
                                clase: ErrorClase::Otro,
                            },
                        );
                    }
                }
            }
            Some((clase, message)) => {
                let _ = app_for_task.emit(
                    "chat:error",
                    ErrorPayload {
                        conversation_id: conv_id,
                        message,
                        clase,
                    },
                );
            }
        }
    });

    Ok(())
}
