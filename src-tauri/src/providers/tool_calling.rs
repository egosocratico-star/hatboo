use super::anthropic::AnthropicProvider;
use super::local::LocalProvider;
use super::openai::OpenAiProvider;
use super::{AiProvider, ProviderError};
use crate::agent::tools::ToolDefinition;
use async_trait::async_trait;
use serde_json::{json, Value};

/// Mensaje del loop de agente: admite texto, peticiones de tool del asistente
/// y resultados de tools del usuario.
#[derive(Debug, Clone)]
pub struct AgentMessage {
    pub role: String, // "user" | "assistant" | "tool"
    pub content: String,
    pub tool_calls: Vec<ToolCallRequest>,
    pub tool_call_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ToolCallRequest {
    pub id: String,
    pub name: String,
    pub input: Value,
}

#[derive(Debug)]
pub enum AgentResponse {
    Text(String),
    ToolCalls { text: Option<String>, calls: Vec<ToolCallRequest> },
}

impl AgentResponse {
    pub fn text(&self) -> &str {
        match self {
            AgentResponse::Text(t) => t,
            AgentResponse::ToolCalls { text: Some(t), .. } => t,
            AgentResponse::ToolCalls { text: None, .. } => "",
        }
    }
}

#[async_trait]
pub trait ToolCallingProvider: AiProvider {
    async fn send_with_tools(
        &self,
        messages: Vec<AgentMessage>,
        tools: Vec<ToolDefinition>,
    ) -> Result<AgentResponse, ProviderError>;
}

fn parse_openai_response(value: Value) -> Result<AgentResponse, ProviderError> {
    let message = &value["choices"][0]["message"];
    let text = message["content"].as_str().unwrap_or("").to_string();
    let mut calls = Vec::new();
    if let Some(tool_calls) = message["tool_calls"].as_array() {
        for tc in tool_calls {
            let name = tc["function"]["name"].as_str().unwrap_or("").to_string();
            let raw_args = tc["function"]["arguments"].as_str().unwrap_or("{}");
            let input = serde_json::from_str(raw_args).unwrap_or(Value::Null);
            calls.push(ToolCallRequest {
                id: tc["id"].as_str().unwrap_or("").to_string(),
                name,
                input,
            });
        }
    }
    if calls.is_empty() {
        Ok(AgentResponse::Text(text))
    } else {
        Ok(AgentResponse::ToolCalls {
            text: (!text.is_empty()).then_some(text),
            calls,
        })
    }
}

#[async_trait]
impl ToolCallingProvider for OpenAiProvider {
    async fn send_with_tools(
        &self,
        messages: Vec<AgentMessage>,
        tools: Vec<ToolDefinition>,
    ) -> Result<AgentResponse, ProviderError> {
        let chat: Vec<Value> = messages
            .iter()
            .map(|m| {
                if m.role == "tool" {
                    json!({
                        "role": "tool",
                        "tool_call_id": m.tool_call_id,
                        "content": m.content,
                    })
                } else if m.role == "assistant" && !m.tool_calls.is_empty() {
                    json!({
                        "role": "assistant",
                        "content": if m.content.is_empty() { Value::Null } else { json!(m.content) },
                        "tool_calls": m.tool_calls.iter().map(|tc| json!({
                            "id": tc.id,
                            "type": "function",
                            "function": { "name": tc.name, "arguments": tc.input.to_string() },
                        })).collect::<Vec<_>>(),
                    })
                } else {
                    json!({ "role": m.role, "content": m.content })
                }
            })
            .collect();
        let tool_values: Vec<Value> = tools
            .iter()
            .map(|t| {
                json!({
                    "type": "function",
                    "function": {
                        "name": t.name,
                        "description": t.description,
                        "parameters": t.input_schema,
                    },
                })
            })
            .collect();
        let body = json!({
            "model": self.model(),
            "messages": chat,
            "tools": tool_values,
        });
        let response = self.post(body, self.name()).await?;
        let value: Value = response
            .json()
            .await
            .map_err(|e| ProviderError::Malformed(e.to_string()))?;
        parse_openai_response(value)
    }
}

#[async_trait]
impl ToolCallingProvider for LocalProvider {
    async fn send_with_tools(
        &self,
        messages: Vec<AgentMessage>,
        tools: Vec<ToolDefinition>,
    ) -> Result<AgentResponse, ProviderError> {
        self.openai_inner()
            .send_with_tools(messages, tools)
            .await
    }
}

#[async_trait]
impl ToolCallingProvider for AnthropicProvider {
    async fn send_with_tools(
        &self,
        messages: Vec<AgentMessage>,
        tools: Vec<ToolDefinition>,
    ) -> Result<AgentResponse, ProviderError> {
        let mut system = String::new();
        let mut chat: Vec<Value> = Vec::new();

        for m in &messages {
            if m.role == "system" {
                if !system.is_empty() {
                    system.push('\n');
                }
                system.push_str(&m.content);
                continue;
            }
            match m.role.as_str() {
                "assistant" => {
                    let mut blocks: Vec<Value> = Vec::new();
                    if !m.content.is_empty() {
                        blocks.push(json!({ "type": "text", "text": m.content }));
                    }
                    for tc in &m.tool_calls {
                        blocks.push(json!({
                            "type": "tool_use",
                            "id": tc.id,
                            "name": tc.name,
                            "input": tc.input,
                        }));
                    }
                    if blocks.is_empty() {
                        blocks.push(json!({ "type": "text", "text": "" }));
                    }
                    chat.push(json!({ "role": "assistant", "content": blocks }));
                }
                "tool" => {
                    // Anthropic agrupa los tool_result en un mensaje de usuario.
                    let result = json!({
                        "type": "tool_result",
                        "tool_use_id": m.tool_call_id,
                        "content": m.content,
                    });
                    match chat.last_mut() {
                        Some(serde_json::Value::Object(obj))
                            if obj.get("role").and_then(|r| r.as_str()) == Some("user")
                                && obj["content"].is_array()
                                && obj["content"]
                                    .as_array()
                                    .map(|a| a.iter().any(|b| b["type"] == json!("tool_result")))
                                    .unwrap_or(false) =>
                        {
                            obj["content"]
                                .as_array_mut()
                                .unwrap()
                                .push(result);
                        }
                        _ => {
                            chat.push(json!({ "role": "user", "content": [result] }));
                        }
                    }
                }
                _ => {
                    chat.push(json!({ "role": "user", "content": m.content }));
                }
            }
        }

        let tool_values: Vec<Value> = tools
            .iter()
            .map(|t| {
                json!({
                    "name": t.name,
                    "description": t.description,
                    "input_schema": t.input_schema,
                })
            })
            .collect();

        let mut body = json!({
            "model": self.model(),
            "messages": chat,
            "max_tokens": 4096,
        });
        if !system.is_empty() {
            body["system"] = json!(system);
        }
        if !tool_values.is_empty() {
            body["tools"] = json!(tool_values);
        }

        let response = self.post(body).await?;
        let value: Value = response
            .json()
            .await
            .map_err(|e| ProviderError::Malformed(e.to_string()))?;

        let mut text = String::new();
        let mut calls = Vec::new();
        if let Some(blocks) = value["content"].as_array() {
            for block in blocks {
                match block["type"].as_str() {
                    Some("text") => text.push_str(block["text"].as_str().unwrap_or("")),
                    Some("tool_use") => calls.push(ToolCallRequest {
                        id: block["id"].as_str().unwrap_or("").to_string(),
                        name: block["name"].as_str().unwrap_or("").to_string(),
                        input: block["input"].clone(),
                    }),
                    _ => {}
                }
            }
        }
        if calls.is_empty() {
            Ok(AgentResponse::Text(text))
        } else {
            Ok(AgentResponse::ToolCalls {
                text: (!text.is_empty()).then_some(text),
                calls,
            })
        }
    }
}

/// Sondea si un endpoint local (Ollama) declara soporte de tools para el modelo.
pub async fn local_supports_tools(endpoint: &str, model: &str) -> bool {
    let base = endpoint.trim_end_matches('/');
    let client = reqwest::Client::new();

    // Ollama moderno: POST /api/show
    if let Ok(resp) = client
        .post(format!("{base}/api/show"))
        .json(&json!({ "name": model }))
        .send()
        .await
    {
        if let Ok(value) = resp.json::<Value>().await {
            if let Some(caps) = value["capabilities"].as_array() {
                return caps.iter().any(|c| c.as_str() == Some("tools"));
            }
        }
    }
    // Ollama antiguo: GET /api/show?name=
    if let Ok(resp) = client
        .get(format!("{base}/api/show?name={model}"))
        .send()
        .await
    {
        if let Ok(value) = resp.json::<Value>().await {
            if let Some(caps) = value["capabilities"].as_array() {
                return caps.iter().any(|c| c.as_str() == Some("tools"));
            }
            // Modelos antiguos de Ollama: la presencia de request_template
            // con placeholders de tools es una señal razonable.
            if let Some(tmpl) = value["request_template"].as_str() {
                if tmpl.contains(".Tools") {
                    return true;
                }
            }
        }
    }
    false
}
