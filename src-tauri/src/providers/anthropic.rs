use super::{
    check_response, delta_string, map_send_error, read_sse_to_channel, AiProvider, ChatMessage,
    ProviderError, StreamDelta,
};
use async_trait::async_trait;
use serde_json::json;
use tokio::sync::mpsc::Sender;

const ANTHROPIC_URL: &str = "https://api.anthropic.com/v1/messages";

/// Traduce un evento SSE de Anthropic a delta de texto o de pensamiento.
pub(crate) fn anthropic_delta(value: &serde_json::Value) -> Option<StreamDelta> {
    if value["type"].as_str() != Some("content_block_delta") {
        return None;
    }
    let delta = &value["delta"];
    match delta["type"].as_str() {
        Some("thinking_delta") => delta_string(&delta["thinking"]).map(StreamDelta::Reasoning),
        // `signature_delta` firma el bloque de pensamiento; no es contenido.
        Some("signature_delta") => None,
        // `text_delta` y servidores que no etiquetan el delta.
        _ => delta_string(&delta["text"]).map(StreamDelta::Text),
    }
}

pub struct AnthropicProvider {
    api_key: String,
    model: String,
    /// Tokens reservados al pensamiento extendido; `None` = sin `thinking`.
    thinking_budget: Option<u32>,
}

impl AnthropicProvider {
    pub fn new(api_key: String, model: String) -> Self {
        Self {
            api_key,
            model,
            thinking_budget: None,
        }
    }

    /// Anthropic solo acepta `thinking` con presupuesto, sin niveles; aquí se
    /// traducen. `"off"` no añade nada al cuerpo (comportamiento de siempre).
    pub fn with_reasoning(mut self, effort: &str) -> Self {
        self.thinking_budget = match effort {
            "low" => Some(2048),
            "medium" => Some(6000),
            "high" => Some(12000),
            _ => None,
        };
        self
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
            .map(|m| {
                if m.images.is_empty() {
                    json!({ "role": m.role, "content": m.content })
                } else {
                    let mut blocks: Vec<serde_json::Value> = Vec::new();
                    if !m.content.is_empty() {
                        blocks.push(json!({ "type": "text", "text": m.content }));
                    }
                    for img in &m.images {
                        blocks.push(json!({
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": img.media_type,
                                "data": img.data_base64,
                            }
                        }));
                    }
                    json!({ "role": m.role, "content": blocks })
                }
            })
            .collect();
        let mut body = json!({
            "model": self.model,
            "messages": chat,
            "max_tokens": 4096,
        });
        if let Some(budget) = self.thinking_budget {
            body["thinking"] = json!({ "type": "enabled", "budget_tokens": budget });
            // La API exige max_tokens por encima del presupuesto de pensamiento.
            body["max_tokens"] = json!(budget + 4096);
        }
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

    pub(crate) fn thinking_budget(&self) -> Option<u32> {
        self.thinking_budget
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
        on_chunk: Sender<StreamDelta>,
    ) -> Result<(), ProviderError> {
        let response = self.post(self.body(&messages, true)).await?;
        read_sse_to_channel(
            response,
            &on_chunk,
            |value| Ok(anthropic_delta(value)),
            |payload| payload.contains("\"message_stop\""),
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::ImagePart;

    fn provider() -> AnthropicProvider {
        AnthropicProvider::new("k".into(), "claude-test".into())
    }

    #[test]
    fn text_only_message_sends_string_content() {
        let msgs = vec![ChatMessage {
            role: "user".into(),
            content: "hola".into(),
            images: Vec::new(),
        }];
        let body = provider().body(&msgs, false);
        assert_eq!(body["messages"][0]["content"], json!("hola"));
    }

    #[test]
    fn image_message_sends_content_blocks() {
        let msgs = vec![ChatMessage {
            role: "user".into(),
            content: "mira".into(),
            images: vec![ImagePart {
                media_type: "image/png".into(),
                data_base64: "AAAA".into(),
            }],
        }];
        let body = provider().body(&msgs, false);
        let content = &body["messages"][0]["content"];
        assert!(content.is_array(), "content debe ser array con imagen");
        assert_eq!(content[0]["type"], json!("text"));
        assert_eq!(content[1]["type"], json!("image"));
        assert_eq!(content[1]["source"]["type"], json!("base64"));
        assert_eq!(content[1]["source"]["media_type"], json!("image/png"));
        assert_eq!(content[1]["source"]["data"], json!("AAAA"));
    }

    fn one_message() -> Vec<ChatMessage> {
        vec![ChatMessage {
            role: "user".into(),
            content: "hola".into(),
            images: Vec::new(),
        }]
    }

    #[test]
    fn reasoning_off_leaves_body_unchanged() {
        let body = provider().with_reasoning("off").body(&one_message(), false);
        assert!(body.get("thinking").is_none());
        assert_eq!(body["max_tokens"], json!(4096));
    }

    #[test]
    fn reasoning_high_enables_thinking_within_max_tokens() {
        let body = provider().with_reasoning("high").body(&one_message(), false);
        assert_eq!(body["thinking"]["type"], json!("enabled"));
        assert_eq!(body["thinking"]["budget_tokens"], json!(12000));
        assert!(body["max_tokens"].as_u64().unwrap() > 12000);
    }

    #[test]
    fn thinking_deltas_are_reasoning() {
        let value = json!({
            "type": "content_block_delta",
            "delta": { "type": "thinking_delta", "thinking": "primero" }
        });
        assert_eq!(anthropic_delta(&value), Some(StreamDelta::Reasoning("primero".into())));
    }

    #[test]
    fn text_deltas_and_unlabeled_deltas_are_text() {
        let labeled = json!({
            "type": "content_block_delta",
            "delta": { "type": "text_delta", "text": "hola" }
        });
        assert_eq!(anthropic_delta(&labeled), Some(StreamDelta::Text("hola".into())));
        let unlabeled = json!({
            "type": "content_block_delta",
            "delta": { "text": "hola" }
        });
        assert_eq!(anthropic_delta(&unlabeled), Some(StreamDelta::Text("hola".into())));
    }

    #[test]
    fn signature_and_opening_events_emit_nothing() {
        let signature = json!({
            "type": "content_block_delta",
            "delta": { "type": "signature_delta", "signature": "abc" }
        });
        assert_eq!(anthropic_delta(&signature), None);
        let start = json!({ "type": "message_start", "message": { "id": "1" } });
        assert_eq!(anthropic_delta(&start), None);
    }
}
