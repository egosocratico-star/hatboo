use super::{AiProvider, ChatMessage, OpenAiProvider, ProviderError, StreamDelta};
use async_trait::async_trait;
use tokio::sync::mpsc::Sender;

/// Proveedor para servidores locales compatibles con la API de OpenAI
/// (Ollama en `http://localhost:11434` o llama.cpp server).
pub struct LocalProvider {
    inner: OpenAiProvider,
    /// Se guardan el endpoint y el modelo porque el reintento sin razonamiento
    /// tiene que mandar exactamente el mismo turno al mismo sitio.
    endpoint: String,
    model: String,
}

impl LocalProvider {
    pub fn new(endpoint: &str, model: &str) -> Self {
        let base = endpoint.trim_end_matches('/');
        Self {
            inner: Self::nuevo_inner(base, model),
            endpoint: base.to_string(),
            model: model.to_string(),
        }
    }

    fn nuevo_inner(base: &str, model: &str) -> OpenAiProvider {
        OpenAiProvider::with_base_url(
            "local".to_string(),
            model.to_string(),
            format!("{base}/v1/chat/completions"),
        )
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

    /// El mismo turno sin el campo de razonamiento.
    pub(crate) fn sin_razonamiento(&self) -> OpenAiProvider {
        Self::nuevo_inner(&self.endpoint, &self.model)
    }

    /// Ollama contesta 400 a `reasoning_effort` en los modelos que no piensan
    /// («"gemma3:1b" does not support thinking»). Eso no es un fallo de red ni
    /// del equipo: es el modelo diciendo que no sabe hacer lo que se le pidió.
    /// Se rehace el turno sin el campo, que es lo que el usuario quería decir de
    /// todas formas, en vez de plantar el JSON en la cara.
    pub(crate) fn se_reintenta(error: &ProviderError) -> bool {
        matches!(
            error,
            ProviderError::Api(400, cuerpo)
                if cuerpo.to_lowercase().contains("does not support thinking")
        )
    }

    pub(crate) fn explica(error: ProviderError) -> ProviderError {
        match error {
            ProviderError::Api(codigo, cuerpo) => ProviderError::Api(codigo, dice_local(&cuerpo)),
            otro => otro,
        }
    }
}

/// Suelta un modelo de la memoria de Ollama. Es lo que hace `ollama stop`:
/// `POST /api/generate` con `keep_alive: 0` y sin prompt, que responde
/// `done_reason: "unload"` sin generar nada.
///
/// Vive aquí, junto al proveedor local, y no dentro de un comando: es la ruta
/// nativa de Ollama —el chat usa la capa compatible `/v1/chat/completions`—, así
/// que el único sitio que sabe de ella es este módulo. Quien la expone al frontend
/// es `commands::models::unload_local_model`, a través de `ModelService`.
pub async fn descargar_modelo(endpoint: &str, model: &str) -> Result<(), String> {
    let url = url_de_generate(endpoint);
    let client = reqwest::Client::builder()
        // Un modelo grande puede tardar en soltarse más de lo que tarda en responder.
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .post(&url)
        .json(&cuerpo_de_descarga(model))
        .send()
        .await
        .map_err(|e| format!("No se pudo conectar con Ollama: {e}"))?;
    let estado = response.status().as_u16();
    if estado >= 400 {
        let cuerpo = response.text().await.unwrap_or_default();
        return Err(format!("Ollama respondió {estado}: {cuerpo}"));
    }
    Ok(())
}

/// La ruta de generate a partir del endpoint guardado, que el usuario puede escribir
/// con o sin barra final.
fn url_de_generate(endpoint: &str) -> String {
    format!("{}/api/generate", endpoint.trim_end_matches('/'))
}

/// El cuerpo exacto de un `ollama stop`: sin `prompt`, con `keep_alive: 0`.
fn cuerpo_de_descarga(model: &str) -> serde_json::Value {
    serde_json::json!({ "model": model, "keep_alive": 0 })
}

/// El JSON de Ollama tal cual no se le puede dejar a nadie: veinte caracteres de
/// backend por dos frases que dicen qué hacer.
fn dice_local(cuerpo: &str) -> String {
    let b = cuerpo.to_lowercase();
    if b.contains("does not support thinking") {
        return "Este modelo no piensa: pon el razonamiento en «Off» o prueba con uno que sí (qwen3, deepseek-r1).".to_string();
    }
    if b.contains("bad_alloc") || b.contains("failed to initialize the context") {
        return "A Ollama no le queda memoria para abrir este contexto: baja el razonamiento, prueba un modelo más pequeño o deja menos RAM ocupada.".to_string();
    }
    if b.contains("not found") || b.contains("no such model") {
        return "Ese modelo ya no está en Ollama: bájalo otra vez en el Centro de modelos.".to_string();
    }
    cuerpo.to_string()
}

#[async_trait]
impl AiProvider for LocalProvider {
    fn name(&self) -> &str {
        "local"
    }

    async fn send_message(&self, messages: Vec<ChatMessage>) -> Result<String, ProviderError> {
        match self.inner.send_message(messages.clone()).await {
            Ok(texto) => Ok(texto),
            Err(error) if Self::se_reintenta(&error) => self
                .sin_razonamiento()
                .send_message(messages)
                .await
                .map_err(Self::explica),
            Err(error) => Err(Self::explica(error)),
        }
    }

    async fn stream_response(
        &self,
        messages: Vec<ChatMessage>,
        on_chunk: Sender<StreamDelta>,
    ) -> Result<(), ProviderError> {
        match self
            .inner
            .stream_response(messages.clone(), on_chunk.clone())
            .await
        {
            Ok(()) => Ok(()),
            // El 400 de «no piensa» llega antes de que salga ni un delta, así que
            // reintentar no duplica texto en la burbuja.
            Err(error) if Self::se_reintenta(&error) => self
                .sin_razonamiento()
                .stream_response(messages, on_chunk)
                .await
                .map_err(Self::explica),
            Err(error) => Err(Self::explica(error)),
        }
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

    #[test]
    fn el_reintento_sin_pensar_no_lleva_el_campo() {
        let proveedor = LocalProvider::new("http://localhost:11434", "gemma3:1b").with_reasoning("high");
        let body = proveedor.sin_razonamiento().client_body(&one_message(), false);
        assert!(body.get("reasoning_effort").is_none());
    }

    #[test]
    fn solo_el_400_de_no_pensar_pide_reintentar() {
        let no_piensa = ProviderError::Api(
            400,
            "{\"error\":{\"message\":\"\\\"gemma3:1b\\\" does not support thinking\"}}".into(),
        );
        assert!(LocalProvider::se_reintenta(&no_piensa));
        // Un 500 de memoria o un 404 no se arreglan quitando el campo.
        let sin_memoria = ProviderError::Api(500, "std::bad_alloc".into());
        assert!(!LocalProvider::se_reintenta(&sin_memoria));
        let otro_400 = ProviderError::Api(400, "context length exceeded".into());
        assert!(!LocalProvider::se_reintenta(&otro_400));
    }

    #[test]
    fn el_json_de_ollama_se_convierte_en_un_consejo() {
        assert!(dice_local("llama_init_from_model: failed to initialize the context: std::bad_alloc")
            .contains("memoria"));
        assert!(dice_local("\"gemma3:1b\" does not support thinking").contains("razonamiento"));
        // Lo que no se reconoce sale como entró: inventar menos que el mensaje
        // crudo sería peor.
        assert_eq!(dice_local("algo rarísimo"), "algo rarísimo");
    }

    /// Las dos piezas de `descargar_modelo` que se pueden medir sin Ollama: la
    /// ruta y el cuerpo. Lo demás es el `POST`, y ese necesita el servidor despierto.
    #[test]
    fn la_ruta_de_generate_no_duplica_la_barra() {
        assert_eq!(
            url_de_generate("http://localhost:11434"),
            "http://localhost:11434/api/generate"
        );
        assert_eq!(
            url_de_generate("http://localhost:11434/"),
            "http://localhost:11434/api/generate"
        );
    }

    #[test]
    fn soltar_un_modelo_es_keep_alive_cero_sin_prompt() {
        let cuerpo = cuerpo_de_descarga("qwen3:1.7b");
        assert_eq!(cuerpo["model"], json!("qwen3:1.7b"));
        assert_eq!(cuerpo["keep_alive"], json!(0));
        // Con `prompt` Ollama generaría texto —y cobraría tiempo— en vez de soltar.
        assert!(cuerpo.get("prompt").is_none(), "{cuerpo}");
    }
}
