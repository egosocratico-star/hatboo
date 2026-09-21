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

    /// Ollama piensa por defecto con los modelos híbridos (qwen3, deepseek-r1):
    /// si el campo `reasoning_effort` falta, el razonamiento sigue saliendo. Para
    /// "off" hay que pedir explícitamente `"none"`, medido sobre Ollama 0.34.
    pub fn with_reasoning(mut self, effort: &str) -> Self {
        let mapped = if effort == "off" || effort.is_empty() {
            "none"
        } else {
            effort
        };
        self.inner = self.inner.with_reasoning(mapped);
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn one_message() -> Vec<ChatMessage> {
        vec![ChatMessage {
            role: "user".into(),
            content: "hola".into(),
            images: Vec::new(),
        }]
    }

    #[test]
    fn off_pides_none_para_apagar_el_pensamiento_de_ollama() {
        let body = LocalProvider::new("http://localhost:11434", "qwen3:1.7b")
            .with_reasoning("off")
            .openai_inner()
            .client_body(&one_message(), false);
        assert_eq!(body["reasoning_effort"], json!("none"));
    }

    #[test]
    fn los_niveles_se_reenvian_tales_cual() {
        for level in ["low", "medium", "high"] {
            let body = LocalProvider::new("http://localhost:11434", "qwen3:1.7b")
                .with_reasoning(level)
                .openai_inner()
                .client_body(&one_message(), false);
            assert_eq!(body["reasoning_effort"], json!(level));
        }
    }
}
