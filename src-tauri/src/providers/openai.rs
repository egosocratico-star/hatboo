use super::{
    check_response, map_send_error, read_sse_to_channel, AiProvider, ChatMessage, ProviderError,
};
use async_trait::async_trait;
use serde_json::json;
use tokio::sync::mpsc::Sender;

const OPENAI_URL: &str = "https://api.openai.com/v1/chat/completions";

pub struct OpenAiProvider {
    api_key: String,
    model: String,
    base_url: String,
}

impl OpenAiProvider {
    pub fn new(api_key: String, model: String) -> Self {
        Self {
            api_key,
            model,
            base_url: OPENAI_URL.to_string(),
        }
    }

    pub fn with_base_url(api_key: String, model: String, base_url: String) -> Self {
        Self {
            api_key,
            model,
            base_url,
        }
    }

    pub(crate) fn model(&self) -> &str {
        &self.model
    }

    pub(crate) fn client_body(&self, messages: &[ChatMessage], stream: bool) -> serde_json::Value {
        let chat: Vec<_> = messages
            .iter()
            .map(|m| json!({ "role": m.role, "content": m.content }))
            .collect();
        let mut body = json!({ "model": self.model, "messages": chat });
        if stream {
            body["stream"] = json!(true);
        }
        body
    }

    pub(crate) async fn post(
        &self,
        body: serde_json::Value,
        label: &str,
    ) -> Result<reqwest::Response, ProviderError> {
        let response = reqwest::Client::new()
            .post(&self.base_url)
            .bearer_auth(&self.api_key)
            .json(&body)
            .send()
            .await
            .map_err(|e| map_send_error(e, label))?;
        check_response(response, label).await
    }
}

#[async_trait]
impl AiProvider for OpenAiProvider {
    fn name(&self) -> &str {
        "openai"
    }

    async fn send_message(&self, messages: Vec<ChatMessage>) -> Result<String, ProviderError> {
        let response = self
            .post(self.client_body(&messages, false), "OpenAI")
            .await?;
        let value: serde_json::Value = response
            .json()
            .await
            .map_err(|e| ProviderError::Malformed(e.to_string()))?;
        let text = value["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("")
            .to_string();
        Ok(text)
    }

    async fn stream_response(
        &self,
        messages: Vec<ChatMessage>,
        on_chunk: Sender<String>,
    ) -> Result<(), ProviderError> {
        let response = self
            .post(self.client_body(&messages, true), "OpenAI")
            .await?;
        read_sse_to_channel(
            response,
            &on_chunk,
            |value| {
                let delta = value["choices"][0]["delta"]["content"]
                    .as_str()
                    .unwrap_or("")
                    .to_string();
                Ok(Some(delta))
            },
            |payload| payload == "[DONE]",
        )
        .await
    }
}
