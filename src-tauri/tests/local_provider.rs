use hatboo_lib::providers::{AiProvider, ChatMessage, LocalProvider, StreamDelta};
use tokio::sync::mpsc;

fn prompt() -> Vec<ChatMessage> {
    vec![ChatMessage {
        role: "user".into(),
        content: "Responde exactamente con la palabra: hola".into(),
        images: Vec::new(),
    }]
}

#[tokio::test]
async fn local_send_message_returns_text() {
    let provider = LocalProvider::new("http://localhost:11434", "qwen3:1.7b");
    let text = provider
        .send_message(prompt())
        .await
        .expect("Ollama should answer");
    assert!(!text.trim().is_empty());
}

#[tokio::test]
async fn local_stream_response_emits_chunks() {
    let provider = LocalProvider::new("http://localhost:11434", "qwen3:1.7b");
    let (tx, mut rx) = mpsc::channel::<StreamDelta>(64);

    let stream_task = tokio::spawn(async move { provider.stream_response(prompt(), tx).await });

    let mut full = String::new();
    let mut chunk_count = 0;
    while let Some(delta) = rx.recv().await {
        // Solo cuenta el texto visible: el razonamiento llega por otra rama.
        if let StreamDelta::Text(chunk) = delta {
            full.push_str(&chunk);
        }
        chunk_count += 1;
    }
    stream_task.await.unwrap().expect("streaming ok");

    assert!(chunk_count > 1, "expected multiple chunks, got {chunk_count}");
    assert!(!full.trim().is_empty());
    println!("streamed {chunk_count} chunks, {full:?}");
}

#[tokio::test]
async fn local_connection_error_is_readable() {
    let provider = LocalProvider::new("http://localhost:9", "no-model");
    let err = provider.send_message(prompt()).await.unwrap_err();
    let msg = err.to_string();
    assert!(msg.contains("No se pudo conectar"), "unexpected error: {msg}");
}
