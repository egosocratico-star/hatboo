use super::anthropic::AnthropicProvider;
use super::local::LocalProvider;
use super::openai::OpenAiProvider;
use super::{AiProvider, ProviderError};
use crate::agent::tools::ToolDefinition;
use async_trait::async_trait;
use serde_json::{json, Value};

/// Mensaje del loop de agente: admite texto, peticiones de tool del asistente
/// y resultados de tools del usuario.
#[derive(Debug, Clone, Default)]
pub struct AgentMessage {
    pub role: String, // "user" | "assistant" | "tool"
    pub content: String,
    pub tool_calls: Vec<ToolCallRequest>,
    pub tool_call_id: Option<String>,
    /// Bloques de razonamiento que devolvió el modelo en este turno. Anthropic
    /// exige que se reenvíen tal cual en cuanto hay tools de por medio; si se
    /// quitan, responde 400. Ver [`AgentResponse::ToolCalls`].
    pub thinking: Vec<Value>,
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
    ToolCalls {
        text: Option<String>,
        calls: Vec<ToolCallRequest>,
        /// Los bloques de pensamiento en bruto, para reenviarlos en el turno
        /// siguiente. Vacío si el modelo no pensó o el proveedor no los devuelve.
        thinking: Vec<Value>,
    },
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

/// Texto plano de unos bloques de razonamiento, para enseñarlos en la actividad.
pub fn thinking_text(blocks: &[Value]) -> String {
    blocks
        .iter()
        .filter_map(|b| {
            b.get("thinking")
                .or_else(|| b.get("text"))
                .and_then(|t| t.as_str())
        })
        .collect::<Vec<_>>()
        .join("\n")
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
    // Los servidores compatibles llaman al razonamiento de una forma distinta
    // (`reasoning_content` en OpenAI y llama.cpp, `reasoning` en Ollama).
    let thinking: Vec<Value> = ["reasoning_content", "reasoning"]
        .iter()
        .filter_map(|key| message[*key].as_str().filter(|s| !s.is_empty()))
        .map(|t| json!({ "type": "thinking", "thinking": t }))
        .collect();
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
            thinking,
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
        let mut body = json!({
            "model": self.model(),
            "messages": chat,
            "tools": tool_values,
        });
        // El razonamiento aquí solo se pide, no se reenvía: en chat/completions no
        // hay un sitio canónico para el pensamiento de turnos anteriores, y mandarlo
        // donde no va hace que varios servidores locales respondan 400.
        if let Some(effort) = self.reasoning_effort() {
            body["reasoning_effort"] = json!(effort);
        }
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
                "assistant" => chat.push(json!({
                    "role": "assistant",
                    "content": assistant_blocks(m),
                })),
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
        if let Some(budget) = self.thinking_budget() {
            body["thinking"] = json!({ "type": "enabled", "budget_tokens": budget });
            // La API exige `max_tokens` por encima del presupuesto de pensamiento.
            body["max_tokens"] = json!(budget + 4096);
        }
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
        let mut thinking = Vec::new();
        if let Some(blocks) = value["content"].as_array() {
            for block in blocks {
                match block["type"].as_str() {
                    Some("text") => text.push_str(block["text"].as_str().unwrap_or("")),
                    Some("tool_use") => calls.push(ToolCallRequest {
                        id: block["id"].as_str().unwrap_or("").to_string(),
                        name: block["name"].as_str().unwrap_or("").to_string(),
                        input: block["input"].clone(),
                    }),
                    // `thinking` y `redacted_thinking`: se guardan enteros, con la
                    // firma, porque la API la verifica al reenviarlos.
                    Some("thinking") | Some("redacted_thinking") => thinking.push(block.clone()),
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
                thinking,
            })
        }
    }
}

/// Bloques de un turno de asistente, en el orden que exige Anthropic:
/// pensamiento → texto → uso de herramientas.
fn assistant_blocks(m: &AgentMessage) -> Vec<Value> {
    let mut blocks: Vec<Value> = m.thinking.clone();
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
    blocks
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(role: &str, content: &str) -> AgentMessage {
        AgentMessage {
            role: role.into(),
            content: content.into(),
            ..Default::default()
        }
    }

    #[test]
    fn un_turno_de_asistente_va_en_orden_pensamiento_texto_herramienta() {
        let m = AgentMessage {
            role: "assistant".into(),
            content: "voy a leer".into(),
            tool_calls: vec![ToolCallRequest {
                id: "tu_1".into(),
                name: "read_file".into(),
                input: json!({ "path": "a.txt" }),
            }],
            tool_call_id: None,
            thinking: vec![json!({ "type": "thinking", "thinking": "piensa", "signature": "s" })],
        };
        let blocks = assistant_blocks(&m);
        assert_eq!(blocks[0]["type"], json!("thinking"));
        assert_eq!(blocks[0]["signature"], json!("s"));
        assert_eq!(blocks[1]["type"], json!("text"));
        assert_eq!(blocks[2]["type"], json!("tool_use"));
    }

    #[test]
    fn un_turno_sin_nada_no_queda_en_bloques_vacios() {
        let m = msg("assistant", "");
        let blocks = assistant_blocks(&m);
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0]["text"], json!(""));
    }

    #[test]
    fn el_texto_de_razonamiento_se_extrae_de_cualquier_bloque() {
        let blocks = vec![
            json!({ "type": "thinking", "thinking": "primero esto" }),
            json!({ "type": "redacted_thinking", "data": "xyz" }),
            json!({ "type": "reasoning", "text": "y esto" }),
        ];
        assert_eq!(thinking_text(&blocks), "primero esto\ny esto");
        assert_eq!(thinking_text(&[]), "");
    }

    #[test]
    fn openai_capturea_razonamiento_aunque_no_haya_texto_visible() {
        let respuesta = json!({
            "choices": [{
                "message": {
                    "content": null,
                    "reasoning_content": "déjame mirar",
                    "tool_calls": [{
                        "id": "c1",
                        "function": { "name": "list_dir", "arguments": "{}" }
                    }]
                }
            }]
        });
        match parse_openai_response(respuesta).unwrap() {
            AgentResponse::ToolCalls { text, calls, thinking } => {
                assert!(text.is_none());
                assert_eq!(calls.len(), 1);
                assert_eq!(thinking_text(&thinking), "déjame mirar");
            }
            other => panic!("se esperaban tool calls, llegó {other:?}"),
        }
    }

    /// El presupuesto de Anthropic se construye sobre el cuerpo del chat, que es
    /// el mismo código que usa el loop (comparte `thinking_budget`).
    #[test]
    fn provider_sin_razonamiento_no_declara_presupuesto() {
        let p = AnthropicProvider::new("k".into(), "claude-test".into());
        assert_eq!(p.thinking_budget(), None);
        let p = p.with_reasoning("medium");
        assert_eq!(p.thinking_budget(), Some(6000));
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
