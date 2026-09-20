use hatboo_lib::agent::tools;
use hatboo_lib::providers::tool_calling::{
    local_supports_tools, AgentMessage, AgentResponse, ToolCallingProvider,
};
use hatboo_lib::providers::LocalProvider;
use std::io::Write as _;

const ENDPOINT: &str = "http://localhost:11434";
const MODEL: &str = "qwen3:1.7b";

async fn ollama_running() -> bool {
    reqwest::Client::new()
        .get(format!("{ENDPOINT}/api/tags"))
        .send()
        .await
        .is_ok()
}

#[tokio::test]
async fn local_model_tool_support_detection() {
    if !ollama_running().await {
        eprintln!("Ollama no está corriendo, test omitido");
        return;
    }
    assert!(
        local_supports_tools(ENDPOINT, MODEL).await,
        "qwen3:1.7b debería soportar tools"
    );
    assert!(
        !local_supports_tools(ENDPOINT, "modelo-que-no-existe-xyz").await,
        "un modelo inexistente no debería soportar tools"
    );
}

#[tokio::test]
async fn agent_tool_loop_with_real_model() {
    if !ollama_running().await {
        eprintln!("Ollama no está corriendo, test omitido");
        return;
    }

    // Proyecto temporal con un archivo de prueba.
    let dir = std::env::temp_dir().join(format!("hatboo-agent-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let mut f = std::fs::File::create(dir.join("hola.txt")).unwrap();
    f.write_all(b"linea 1\nlinea 2\n").unwrap();

    let provider = LocalProvider::new(ENDPOINT, MODEL);
    let agent_tools = tools::build_tools(false);
    let definitions: Vec<_> = agent_tools.iter().map(|t| t.definition()).collect();

    let mut messages = vec![
        AgentMessage {
            role: "system".into(),
            content: format!(
                "Eres un agente que trabaja dentro de un proyecto. \
                 Raíz: {}. \
                 Usa la herramienta list_dir (path vacío = raíz) para ver los archivos \
                 del proyecto. Después responde con un resumen corto.",
                dir.display()
            ),
            tool_calls: Vec::new(),
            tool_call_id: None,
        },
        AgentMessage {
            role: "user".into(),
            content: "Lista los archivos de la raíz del proyecto con list_dir.".into(),
            tool_calls: Vec::new(),
            tool_call_id: None,
        },
    ];

    let mut tool_was_called = false;

    for _ in 0..6 {
        let response = provider
            .send_with_tools(messages.clone(), definitions.clone())
            .await
            .expect("el proveedor debería responder");

        match response {
            AgentResponse::Text(text) => {
                assert!(!text.trim().is_empty(), "respuesta final vacía");
                break;
            }
            AgentResponse::ToolCalls { text, calls } => {
                assert!(!calls.is_empty());
                messages.push(AgentMessage {
                    role: "assistant".into(),
                    content: text.unwrap_or_default(),
                    tool_calls: calls.clone(),
                    tool_call_id: None,
                });
                for call in calls {
                    tool_was_called = true;
                    let output = match agent_tools.iter().find(|t| t.name() == call.name) {
                        Some(tool) => match tool.execute(call.input.clone(), &dir).await {
                            Ok(v) => v.to_string(),
                            Err(e) => format!("{{\"error\": \"{e}\"}}"),
                        },
                        None => format!("{{\"error\": \"tool desconocida {}\"}}", call.name),
                    };
                    messages.push(AgentMessage {
                        role: "tool".into(),
                        content: output,
                        tool_calls: Vec::new(),
                        tool_call_id: Some(call.id.clone()),
                    });
                }
            }
        }
    }

    assert!(
        tool_was_called,
        "el modelo debería haber pedido al menos una tool call"
    );

    std::fs::remove_dir_all(&dir).ok();
}
