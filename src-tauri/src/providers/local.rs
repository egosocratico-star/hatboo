use super::{AiProvider, ChatMessage, OpenAiProvider, ProviderError, StreamDelta};
use async_trait::async_trait;
use tokio::sync::mpsc::Sender;

/// Proveedor para servidores locales compatibles con la API de OpenAI
/// (Ollama en `http://localhost:11434` o llama.cpp server).
pub struct LocalProvider {
    inner: OpenAiProvider,
}

impl LocalProvider {
    pub fn new(endpoint: &str, model: &str) -> Self {
        let base = endpoint.trim_end_matches('/');
        Self {
            inner: OpenAiProvider::with_base_url(
                "local".to_string(),
                model.to_string(),
                format!("{base}/v1/chat/completions"),
            ),
        }
    }

    pub(crate) fn openai_inner(&self) -> &super::openai::OpenAiProvider {
        &self.inner
    }

    /// Ollama expone el mismo campo `reasoning_effort` en su endpoint
    /// compatible con OpenAI; `"off"` deja la petición como siempre.
    pub fn with_reasoning(mut self, effort: &str) -> Self {
        self.inner = self.inner.with_reasoning(effort);
        self
    }
}

#[async_trait]
impl AiProvider for LocalProvider {
    fn name(&self) -> &str {
        "local"
    }

    async fn send_message(&self, messages: Vec<ChatMessage>) -> Result<String, ProviderError> {
        self.inner.send_message(messages).await
    }

    async fn stream_response(
        &self,
        messages: Vec<ChatMessage>,
        on_chunk: Sender<StreamDelta>,
    ) -> Result<(), ProviderError> {
        self.inner.stream_response(messages, on_chunk).await
    }
}
