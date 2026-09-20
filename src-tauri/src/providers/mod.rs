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
pub struct ChatMessage {
    pub role: String,
    pub content: String,
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
