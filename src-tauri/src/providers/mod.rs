pub mod anthropic;
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

#[async_trait]
pub trait AiProvider: Send + Sync {
    fn name(&self) -> &str;
    async fn send_message(&self, messages: Vec<ChatMessage>) -> Result<String, ProviderError>;
    async fn stream_response(
        &self,
        messages: Vec<ChatMessage>,
        on_chunk: Sender<String>,
    ) -> Result<(), ProviderError>;
}

/// Consume un stream SSE (líneas `data: ...`) y reenvía cada delta extraído al canal.
pub(crate) async fn read_sse_to_channel(
    response: reqwest::Response,
    on_chunk: &Sender<String>,
    extract: impl Fn(&serde_json::Value) -> Result<Option<String>, ProviderError> + Send,
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
                if !delta.is_empty() {
                    let _ = on_chunk.send(delta).await;
                }
            }
        }
    }
    Ok(())
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
pub async fn list_ollama_models(endpoint: &str) -> Result<Vec<String>, String> {
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
    let models = value["models"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m["name"].as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();
    Ok(models)
}

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
            let response = client
                .get("https://api.openai.com/v1/models")
                .bearer_auth(&key)
                .send()
                .await
                .map_err(|e| format!("No se pudo conectar con OpenAI: {e}"))?;
            let status = response.status();
            if status == reqwest::StatusCode::UNAUTHORIZED {
                return Err("API key inválida para OpenAI (401).".into());
            }
            if !status.is_success() {
                let body = response.text().await.unwrap_or_default();
                return Err(format!("OpenAI devolvió {status}: {body}"));
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
        other => Err(format!("Proveedor desconocido: {other}")),
    }
}
