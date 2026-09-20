use super::{
    check_response, map_send_error, read_sse_to_channel, AiProvider, ChatMessage, ProviderError,
};
use async_trait::async_trait;
use serde_json::json;
use tokio::sync::mpsc::Sender;

const ANTHROPIC_URL: &str = "https://api.anthropic.com/v1/messages";

pub struct AnthropicProvider {
    api_key: String,
    model: String,
}

impl AnthropicProvider {
    pub fn new(api_key: String, model: String) -> Self {
        Self { api_key, model }
    }

    fn body(&self, messages: &[ChatMessage], stream: bool) -> serde_json::Value {
        let system = messages
            .iter()
            .filter(|m| m.role == "system")
            .map(|m| m.content.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        let chat: Vec<_> = messages
            .iter()
            .filter(|m| m.role != "system")
            .map(|m| json!({ "role": m.role, "content": m.content }))
            .collect();
        let mut body = json!({
            "model": self.model,
            "messages": chat,
            "max_tokens": 4096,
        });
        if !system.is_empty() {
            body["system"] = json!(system);
        }
        if stream {
            body["stream"] = json!(true);
        }
        body
    }

    pub(crate) fn model(&self) -> &str {
        &self.model
    }

    pub(crate) async fn post(&self, body: serde_json::Value) -> Result<reqwest::Response, ProviderError> {
        let response = reqwest::Client::new()
            .post(ANTHROPIC_URL)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&body)
            .send()
            .await
            .map_err(|e| map_send_error(e, "la API de Anthropic"))?;
        check_response(response, "Anthropic").await
    }
}

#[async_trait]
impl AiProvider for AnthropicProvider {
    fn name(&self) -> &str {
        "anthropic"
    }

    async fn send_message(&self, messages: Vec<ChatMessage>) -> Result<String, ProviderError> {
        let response = self.post(self.body(&messages, false)).await?;
        let value: serde_json::Value = response
            .json()
            .await
            .map_err(|e| ProviderError::Malformed(e.to_string()))?;
        let text = value
            .get("content")
            .and_then(|c| c.as_array())
            .map(|blocks| {
                blocks
                    .iter()
                    .filter(|b| b["type"].as_str() == Some("text"))
                    .filter_map(|b| b["text"].as_str())
                    .collect::<String>()
            })
            .unwrap_or_default();
        Ok(text)
    }

    async fn stream_response(
        &self,
        messages: Vec<ChatMessage>,
        on_chunk: Sender<String>,
    ) -> Result<(), ProviderError> {
        let response = self.post(self.body(&messages, true)).await?;
        read_sse_to_channel(
            response,
            &on_chunk,
            |value| {
                if value["type"].as_str() == Some("content_block_delta") {
                    let delta = value["delta"]["text"].as_str().unwrap_or("").to_string();
                    Ok(Some(delta))
                } else {
                    Ok(None)
                }
            },
            |payload| payload.contains("\"message_stop\""),
        )
        .await
    }
}
