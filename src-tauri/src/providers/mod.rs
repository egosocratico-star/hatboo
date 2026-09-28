pub mod anthropic;
pub mod audio;
pub mod imagen;
pub mod local;
pub mod openai;
pub mod tool_calling;

use async_trait::async_trait;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc::Sender;

pub use anthropic::AnthropicProvider;
pub use local::LocalProvider;
pub use openai::OpenAiProvider;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImagePart {
    /// Ej. "image/png", "image/jpeg".
    pub media_type: String,
    /// Bytes de la imagen codificados en base64 (sin prefijo data URI).
    pub data_base64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    /// Imágenes adjuntas del mensaje (M3). Vacío → el proveedor manda `content`
    /// como string plano (comportamiento de siempre, sin regresión en texto).
    #[serde(default)]
    pub images: Vec<ImagePart>,
}

#[derive(Debug, thiserror::Error)]
pub enum ProviderError {
    #[error("Falta la API key de {0}. Configúrala en Ajustes.")]
    MissingKey(String),
    #[error("API key inválida para {0} (401). Revísala en Ajustes.")]
    InvalidKey(String),
    #[error("No se pudo conectar con {0}. Verifica que el servicio esté en marcha y el endpoint en Ajustes.")]
    Connection(String, #[source] anyhow::Error),
    #[error("El proveedor devolvió un error HTTP {0}: {1}")]
    Api(u16, String),
    #[error("Respuesta inesperada del proveedor: {0}")]
    Malformed(String),
}

/// Fragmento del stream: texto visible o razonamiento interno del modelo.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StreamDelta {
    Text(String),
    Reasoning(String),
}

#[async_trait]
pub trait AiProvider: Send + Sync {
    fn name(&self) -> &str;
    async fn send_message(&self, messages: Vec<ChatMessage>) -> Result<String, ProviderError>;
    async fn stream_response(
        &self,
        messages: Vec<ChatMessage>,
        on_chunk: Sender<StreamDelta>,
    ) -> Result<(), ProviderError>;
}

/// Consume un stream SSE (líneas `data: ...`) y reenvía cada delta extraído al canal.
pub(crate) async fn read_sse_to_channel(
    response: reqwest::Response,
    on_chunk: &Sender<StreamDelta>,
    extract: impl Fn(&serde_json::Value) -> Result<Option<StreamDelta>, ProviderError> + Send,
    is_done: impl Fn(&str) -> bool + Send,
) -> Result<(), ProviderError> {
    let mut stream = response.bytes_stream();
    let mut buf = String::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| {
            ProviderError::Connection("el stream del proveedor".into(), anyhow::anyhow!(e))
        })?;
        buf.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(pos) = buf.find('\n') {
            let line = buf[..pos].trim_end_matches('\r').trim().to_string();
            buf.drain(..=pos);
            let Some(payload) = line.strip_prefix("data:").map(str::trim) else {
                continue;
            };
            if payload.is_empty() {
                continue;
            }
            if is_done(payload) {
                return Ok(());
            }
            let value: serde_json::Value = serde_json::from_str(payload)
                .map_err(|e| ProviderError::Malformed(e.to_string()))?;
            if let Some(delta) = extract(&value)? {
                let has_content = match &delta {
                    StreamDelta::Text(s) | StreamDelta::Reasoning(s) => !s.is_empty(),
                };
                if has_content && on_chunk.send(delta).await.is_err() {
                    // El consumidor cerró el canal (el usuario detuvo la
                    // respuesta): salir aquí suelta la respuesta HTTP y con
                    // ella la generación del servidor.
                    return Ok(());
                }
            }
        }
    }
    Ok(())
}

/// Lee un campo JSON como texto, descartando `null` y cadenas vacías.
pub(crate) fn delta_string(value: &serde_json::Value) -> Option<String> {
    value
        .as_str()
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

pub(crate) fn map_send_error(
    err: reqwest::Error,
    endpoint_desc: &str,
) -> ProviderError {
    if err.is_connect() || err.is_timeout() {
        ProviderError::Connection(endpoint_desc.to_string(), anyhow::anyhow!(err))
    } else {
        ProviderError::Api(0, err.to_string())
    }
}

pub(crate) async fn check_response(
    response: reqwest::Response,
    provider_label: &str,
) -> Result<reqwest::Response, ProviderError> {
    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(ProviderError::InvalidKey(provider_label.to_string()));
    }
    if !status.is_success() {
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "<sin cuerpo>".to_string());
        return Err(ProviderError::Api(status.as_u16(), body));
    }
    Ok(response)
}

// ---------- API keys: SIEMPRE en el keychain del SO, nunca en SQLite ----------

const KEYRING_SERVICE: &str = "com.hatboo.app";

pub fn set_api_key(provider: &str, key: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, provider)
        .map_err(|e| e.to_string())?;
    entry.set_password(key).map_err(|e| e.to_string())
}

pub fn get_api_key(provider: &str) -> Option<String> {
    keyring::Entry::new(KEYRING_SERVICE, provider)
        .ok()?
        .get_password()
        .ok()
}

pub fn delete_api_key(provider: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, provider)
        .map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// ---------- Sonda de conexión y catálogo de modelos ----------

/// Lista los modelos disponibles en un servidor Ollama (`GET /api/tags`).
/// Un modelo que Ollama tiene en disco. `parameter_size` viene de Ollama y
/// puede venir vacío en instalaciones raras; por eso es `String` y no un número.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaModel {
    pub name: String,
    /// Ej. «7.6B». Vacío si Ollama no lo declara.
    pub parameter_size: String,
    /// Bytes que ocupa en disco.
    pub size_bytes: i64,
    /// Lo que Ollama ≥ 0.5 declara en `/api/show` («completion», «vision»,
    /// «tools»…). Vacío en servidores viejos o no-Ollama: el frontend vuelve
    /// entonces a la pista del nombre.
    pub capabilities: Vec<String>,
    /// Tokens que admite el modelo. Es el `num_ctx` del Modelfile cuando Ollama
    /// lo declara —el techo real de un turno— y si no, la ventana nativa. Cero
    /// cuando no hay ninguno de los dos: sin número propio no se inventa %.
    pub context_tokens: i64,
    /// Si `context_tokens` salió del `num_ctx` (techo de ejecución) o de la
    /// ventana nativa del modelo, que suele ser más generosa que aquel.
    pub context_es_num_ctx: bool,
}

pub async fn list_ollama_models(endpoint: &str) -> Result<Vec<OllamaModel>, String> {
    let base = endpoint.trim_end_matches('/');
    let url = format!("{base}/api/tags");
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(6))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("No se pudo conectar con {url}: {e}"))?;
    let response = match check_response(response, "Ollama").await {
        Ok(r) => r,
        Err(e) => return Err(e.to_string()),
    };
    let value: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Respuesta inesperada de Ollama: {e}"))?;
    let mut models: Vec<OllamaModel> = value["models"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|m| {
                    let name = m["name"].as_str()?;
                    Some(OllamaModel {
                        name: name.to_string(),
                        parameter_size: m["details"]["parameter_size"]
                            .as_str()
                            .unwrap_or("")
                            .to_string(),
                        size_bytes: m["size"].as_i64().unwrap_or(0),
                        capabilities: Vec::new(),
                        context_tokens: 0,
                        context_es_num_ctx: false,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    // Un /api/show por modelo: es la única fuente que declara visión, tools y la
    // ventana de una vez. Es local y rápido; si uno falla, ese modelo se queda
    // sin declarar nada.
    for m in &mut models {
        let name = m.name.clone();
        let (caps, ventana, es_num_ctx) = show_info(&client, &base, &name).await;
        m.capabilities = caps;
        m.context_tokens = ventana;
        m.context_es_num_ctx = es_num_ctx;
    }
    Ok(models)
}

/// Pregunta a `/api/show` por lo que el modelo sabe hacer y cuánto admite. El
/// fallo nunca es error: un endpoint que no sea Ollama (llama.cpp, LM Studio) no
/// tiene esa ruta y el modelo se queda sin declarar nada.
async fn show_info(
    client: &reqwest::Client,
    base: &str,
    model: &str,
) -> (Vec<String>, i64, bool) {
    let resp = match client
        .post(format!("{base}/api/show"))
        .json(&serde_json::json!({ "name": model }))
        .send()
        .await
    {
        Ok(r) => r,
        Err(_) => return (Vec::new(), 0, false),
    };
    match resp.json::<serde_json::Value>().await {
        Ok(value) => datos_del_show(&value),
        Err(_) => (Vec::new(), 0, false),
    }
}

/// Saca de la respuesta de `/api/show` las capacidades y la ventana de tokens.
///
/// La ventana puede venir en dos sitios que no significan lo mismo: el
/// `num_ctx` del Modelfile es el techo con el que Ollama arranca el modelo —el
/// que de verdad corta un turno—, y `model_info.<arquitectura>.context_length`
/// es la ventana nativa, casi siempre más generosa. Se prefiere el primero, y se
/// dice de dónde salió para que el medidor no venda una cosa por la otra.
fn datos_del_show(value: &serde_json::Value) -> (Vec<String>, i64, bool) {
    let caps = value["capabilities"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|c| c.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    let nativa = value["model_info"]
        .as_object()
        .and_then(|info| {
            info.iter().find_map(|(k, v)| {
                if k.ends_with(".context_length") {
                    v.as_i64()
                } else {
                    None
                }
            })
        })
        .unwrap_or(0);
    let num_ctx = value["parameters"]
        .as_str()
        .and_then(num_ctx_del_modelfile)
        .filter(|n| *n > 0);
    match num_ctx {
        Some(n) => (caps, n, true),
        None => (caps, nativa, false),
    }
}

/// `parameters` de `/api/show` es el Modelfile en texto, con líneas del tipo
/// `PARAMETER num_ctx 8192`. Solo se busca esa; lo demás no interesa.
fn num_ctx_del_modelfile(texto: &str) -> Option<i64> {
    texto.lines().find_map(|l| {
        l.trim()
            .strip_prefix("PARAMETER num_ctx")?
            .trim()
            .parse::<i64>()
            .ok()
    })
}

/// Base de OpenRouter. Habla el dialecto de OpenAI y no tiene nada que
/// configurar: una sola clave da acceso a todos los modelos que reparte.
pub const OPENROUTER_BASE: &str = "https://openrouter.ai/api/v1";

/// Gemini expone una capa compatible con OpenAI bajo `/v1beta/openai`, así que
/// se reutiliza `OpenAiProvider` en vez de escribir un cliente propio.
pub const GEMINI_BASE: &str = "https://generativelanguage.googleapis.com/v1beta/openai";

/// Prueba la conexión de un proveedor sin enviar un mensaje real.
/// Devuelve un mensaje legible con el resultado.
pub async fn test_connection(
    provider: &str,
    model: &str,
    endpoint: &str,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    match provider {
        "local" => {
            let models = list_ollama_models(endpoint).await?;
            Ok(format!(
                "Conexión correcta. {} modelo(s) disponible(s).",
                models.len()
            ))
        }
        "anthropic" => {
            let key = get_api_key("anthropic")
                .ok_or_else(|| "Falta la API key de Anthropic.".to_string())?;
            let response = client
                .get("https://api.anthropic.com/v1/models")
                .header("x-api-key", &key)
                .header("anthropic-version", "2023-06-01")
                .send()
                .await
                .map_err(|e| format!("No se pudo conectar con Anthropic: {e}"))?;
            let status = response.status();
            if status == reqwest::StatusCode::UNAUTHORIZED {
                return Err("API key inválida para Anthropic (401).".into());
            }
            if !status.is_success() {
                let body = response.text().await.unwrap_or_default();
                return Err(format!("Anthropic devolvió {status}: {body}"));
            }
            let value: serde_json::Value = response
                .json()
                .await
                .map_err(|e| format!("Respuesta inesperada: {e}"))?;
            let known = value["data"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .any(|m| m["id"].as_str() == Some(model))
                })
                .unwrap_or(false);
            if known {
                Ok(format!("Conexión correcta. Modelo «{model}» disponible."))
            } else {
                Ok(format!(
                    "Conexión correcta, pero «{model}» no aparece en tu lista de modelos."
                ))
            }
        }
        "openai" => {
            let key = get_api_key("openai")
                .ok_or_else(|| "Falta la API key de OpenAI.".to_string())?;
            check_openai_style(&client, "https://api.openai.com/v1/models", &key, model, "OpenAI").await
        }
        // El router de Hugging Face habla el mismo dialecto; `endpoint` trae aquí
        // la base (`https://router.huggingface.co/v1`), que es editable en Ajustes.
        "hf" => {
            let key = get_api_key("hf").ok_or_else(|| "Falta el token de Hugging Face.".to_string())?;
            let base = endpoint.trim_end_matches('/');
            check_openai_style(&client, &format!("{base}/models"), &key, model, "Hugging Face").await
        }
        "openrouter" => {
            let key = get_api_key("openrouter")
                .ok_or_else(|| "Falta la API key de OpenRouter.".to_string())?;
            check_openai_style(
                &client,
                &format!("{OPENROUTER_BASE}/models"),
                &key,
                model,
                "OpenRouter",
            )
            .await
        }
        // La capa compatible con OpenAI de Gemini lista sus modelos en `/models`
        // como los demás; aquí `endpoint` no se usa, la base es fija.
        "gemini" => {
            let key = get_api_key("gemini")
                .ok_or_else(|| "Falta la API key de Google Gemini.".to_string())?;
            check_openai_style(
                &client,
                &format!("{GEMINI_BASE}/models"),
                &key,
                model,
                "Google Gemini",
            )
            .await
        }
        other => Err(format!("Proveedor desconocido: {other}")),
    }
}

/// Comprueba clave y modelo contra un endpoint de modelos estilo OpenAI.
async fn check_openai_style(
    client: &reqwest::Client,
    url: &str,
    key: &str,
    model: &str,
    label: &str,
) -> Result<String, String> {
    let response = client
        .get(url)
        .bearer_auth(key)
        .send()
        .await
        .map_err(|e| format!("No se pudo conectar con {label}: {e}"))?;
    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(format!("API key inválida para {label} (401)."));
    }
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("{label} devolvió {status}: {body}"));
    }
    let value: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Respuesta inesperada: {e}"))?;
    let known = modelos_estilo_openai(&value).iter().any(|id| id == model);
    if known {
        Ok(format!("Conexión correcta. Modelo «{model}» disponible."))
    } else {
        Ok(format!(
            "Conexión correcta, pero «{model}» no aparece en tu lista de modelos."
        ))
    }
}

/// Los modelos que deja usar la clave guardada de cada proveedor.
///
/// `test_connection` ya pedía esta lista, pero solo para comprobar si UN id
/// concreto estaba en ella: aquí se devuelve entera, que es lo que permite
/// elegir modelo sin tener que saberse su nombre de memoria. Anthropic, OpenAI,
/// OpenRouter y Gemini ofrecen `data[].id`, así que los cuatro comparten parser.
pub async fn list_provider_models(provider: &str, endpoint: &str) -> Result<Vec<String>, String> {
    match provider {
        "local" => Ok(list_ollama_models(endpoint)
            .await?
            .into_iter()
            .map(|m| m.name)
            .collect()),
        "hf" => list_hf_models(endpoint).await,
        "anthropic" => {
            let key = get_api_key("anthropic")
                .ok_or_else(|| "Falta la API key de Anthropic.".to_string())?;
            let client = http_client()?;
            let value = get_json(
                client
                    .get("https://api.anthropic.com/v1/models")
                    .header("x-api-key", &key)
                    .header("anthropic-version", "2023-06-01"),
                "Anthropic",
            )
            .await?;
            Ok(modelos_estilo_openai(&value))
        }
        "openai" => {
            let key = get_api_key("openai")
                .ok_or_else(|| "Falta la API key de OpenAI.".to_string())?;
            let client = http_client()?;
            let value =
                get_json(client.get("https://api.openai.com/v1/models").bearer_auth(&key), "OpenAI").await?;
            Ok(modelos_estilo_openai(&value))
        }
        "openrouter" => {
            let key = get_api_key("openrouter")
                .ok_or_else(|| "Falta la API key de OpenRouter.".to_string())?;
            let client = http_client()?;
            let value = get_json(
                client
                    .get(format!("{OPENROUTER_BASE}/models"))
                    .bearer_auth(&key),
                "OpenRouter",
            )
            .await?;
            Ok(modelos_estilo_openai(&value))
        }
        "gemini" => {
            let key = get_api_key("gemini")
                .ok_or_else(|| "Falta la API key de Google Gemini.".to_string())?;
            let client = http_client()?;
            let value = get_json(
                client
                    .get(format!("{GEMINI_BASE}/models"))
                    .bearer_auth(&key),
                "Google Gemini",
            )
            .await?;
            Ok(modelos_estilo_openai(&value))
        }
        other => Err(format!("Proveedor desconocido: {other}")),
    }
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())
}

/// GET ya resuelto en JSON, con el fallo traducido a una frase accionable.
async fn get_json(
    request: reqwest::RequestBuilder,
    label: &str,
) -> Result<serde_json::Value, String> {
    let response = request
        .send()
        .await
        .map_err(|e| format!("No se pudo conectar con {label}: {e}"))?;
    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(format!("API key inválida para {label} (401)."));
    }
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("{label} devolvió {status}: {body}"));
    }
    response
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Respuesta inesperada de {label}: {e}"))
}

/// Ids de los modelos que ofrece un endpoint estilo OpenAI (`data[].id`).
pub fn modelos_estilo_openai(value: &serde_json::Value) -> Vec<String> {
    value["data"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m["id"].as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

/// Lista los ids del router de Hugging Face para el buscador de modelos.
pub async fn list_hf_models(endpoint: &str) -> Result<Vec<String>, String> {
    let key = get_api_key("hf").ok_or_else(|| "Falta el token de Hugging Face.".to_string())?;
    let base = endpoint.trim_end_matches('/');
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(format!("{base}/models"))
        .bearer_auth(&key)
        .send()
        .await
        .map_err(|e| format!("No se pudo conectar con Hugging Face: {e}"))?;
    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(
            "Token inválido o sin permiso de Inference Providers (401). Necesitas un token con ese permiso."
                .into(),
        );
    }
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Hugging Face devolvió {status}: {body}"));
    }
    let value: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Respuesta inesperada de Hugging Face: {e}"))?;
    Ok(modelos_estilo_openai(&value))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn las_capacidades_salen_del_show() {
        let v = serde_json::json!({ "capabilities": ["completion", "vision", "tools"] });
        assert_eq!(
            datos_del_show(&v).0,
            vec!["completion", "vision", "tools"]
        );
    }

    #[test]
    fn la_ventana_nativa_se_busca_por_sufijo() {
        // La clave va prefijada por la arquitectura, y esa cambia de un modelo a
        // otro: buscar «llama.context_length» a pelo dejaría fuera a Qwen.
        let v = serde_json::json!({
            "model_info": {
                "qwen2.attention.head_dim": 128i64,
                "qwen2.context_length": 40960i64,
                "general.architecture": "qwen2"
            }
        });
        let (caps, ventana, es_num_ctx) = datos_del_show(&v);
        assert!(caps.is_empty());
        assert_eq!(ventana, 40960);
        assert!(!es_num_ctx);
    }

    #[test]
    fn el_num_ctx_manda_sobre_la_nativa() {
        // Un modelo de 40k arrancado con num_ctx 4096 solo admite 4096: decirle
        // al usuario que tiene 40k libres sería la mentira del medidor.
        let v = serde_json::json!({
            "parameters": "FROM qwen3\nPARAMETER temperature 0.7\nPARAMETER num_ctx 4096\n",
            "model_info": { "qwen3.context_length": 40960i64 }
        });
        let (_, ventana, es_num_ctx) = datos_del_show(&v);
        assert_eq!(ventana, 4096);
        assert!(es_num_ctx);
    }

    #[test]
    fn un_ollama_viejo_no_declara_nada() {
        let v = serde_json::json!({ "modelfile": "FROM llama3" });
        let (caps, ventana, es_num_ctx) = datos_del_show(&v);
        assert!(caps.is_empty());
        assert_eq!(ventana, 0);
        assert!(!es_num_ctx);
    }
}
