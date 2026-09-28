//! Voz de nube: texto → audio.
//!
//! Es el hermano corto del motor de imagen. La lectura en voz alta ya existía
//! con las voces del sistema (gratis, sin red, con el acento que traiga
//! Windows); esto es para cuando esas voces no convencen y se prefiere una de
//! nube, que cobra por caracteres leídos.

use super::get_api_key;

/// Lo que devuelve cualquier motor de voz: los bytes ya reproducibles y su tipo.
pub struct AudioSintetizado {
    pub media_type: &'static str,
    pub bytes: Vec<u8>,
}

/// OpenAI corta la petición pasada esta cifra, así que se dice antes de llamar.
pub const MAX_TEXTO: usize = 4096;

/// Voces de OpenAI. Son marcas registradas por él: se ofrecen tal cual y no
/// pasan por el diccionario.
pub const VOCES_OPENAI: &[&str] = &[
    "alloy",
    "ash",
    "ballad",
    "coral",
    "echo",
    "fable",
    "marin",
    "nova",
    "onyx",
    "sage",
    "shimmer",
    "verse",
];

pub fn modelo_por_defecto(motor: &str) -> &'static str {
    match motor {
        "openai" => "gpt-4o-mini-tts",
        _ => "tts-1",
    }
}

/// El cuerpo que se manda, con los huecos de Ajustes rellenos. Separado de la
/// petición porque es lo único que se puede comprobar sin gastar una llamada.
pub(crate) fn cuerpo_de(modelo: &str, voz: &str, texto: &str) -> serde_json::Value {
    let modelo = if modelo.trim().is_empty() {
        modelo_por_defecto("openai")
    } else {
        modelo.trim()
    };
    let voz = if voz.trim().is_empty() { "alloy" } else { voz.trim() };
    serde_json::json!({
        "model": modelo,
        "input": texto,
        "voice": voz,
        // MP3: es lo que reproduce un `<audio>` de toda la vida sin decodificar
        // nada raro. Opus suena igual y pesa menos, pero WebView2 no siempre.
        "response_format": "mp3",
    })
}

/// Comprueba lo que se puede decir sin llamar a nadie: texto vacío, largo
/// imposible y motor apagado.
fn valida(motor: &str, texto: &str) -> Result<(), String> {
    if texto.trim().is_empty() {
        return Err("No hay texto que leer.".into());
    }
    let n = texto.chars().count();
    if n > MAX_TEXTO {
        return Err(format!(
            "La voz de nube lee hasta {MAX_TEXTO} caracteres y esta respuesta tiene {n}.\
             Para algo más largo usa la voz del sistema, que es gratis."
        ));
    }
    match motor {
        "openai" => Ok(()),
        "gemini" | "hf" | "openrouter" | "anthropic" => Err(format!(
            "La voz de nube con ese motor ({motor}) todavía no está conectada en Hatboo.\
             Se puede elegir OpenAI en Ajustes → API, o dejar la voz del sistema."
        )),
        "off" | "" => Err("El motor de voz está apagado: se elige en Ajustes → API.".into()),
        other => Err(format!("No conozco ese motor de voz: {other}")),
    }
}

/// Pide la voz al motor que se le diga.
pub async fn sintetizar(
    motor: &str,
    modelo: &str,
    voz: &str,
    texto: &str,
) -> Result<AudioSintetizado, String> {
    valida(motor, texto)?;
    // `valida` solo deja pasar `openai`: cualquier otro motor cae allí con su
    // aviso, así que no hace falta otra rama.
    sintetizar_openai(modelo, voz, texto).await
}

/// `POST /v1/audio/speech`. A diferencia del resto de la API, aquí la respuesta
/// buena son bytes a secas: el JSON solo aparece cuando va mal.
async fn sintetizar_openai(
    modelo: &str,
    voz: &str,
    texto: &str,
) -> Result<AudioSintetizado, String> {
    let key = get_api_key("openai")
        .ok_or_else(|| "Falta la API key de OpenAI en el llavero.".to_string())?;
    let cliente = super::imagen::cliente()?;
    let response = cliente
        .post("https://api.openai.com/v1/audio/speech")
        .bearer_auth(&key)
        .json(&cuerpo_de(modelo, voz, texto))
        .send()
        .await
        .map_err(|e| format!("No se pudo conectar con OpenAI: {e}"))?;
    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err(format!(
            "OpenAI rechazó tu clave ({0}). Revísala en Ajustes → API.",
            status.as_u16()
        ));
    }
    if !status.is_success() {
        let detalle = response
            .text()
            .await
            .unwrap_or_default()
            .lines()
            .next()
            .unwrap_or("sin más detalle")
            .to_string();
        return Err(format!("OpenAI devolvió {status}: {detalle}"));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("El audio llegó cortado: {e}"))?;
    if bytes.is_empty() {
        return Err("OpenAI devolvió audio vacío.".into());
    }
    Ok(AudioSintetizado {
        media_type: "audio/mpeg",
        bytes: bytes.to_vec(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn los_huecos_de_ajustes_se_rellenan_solos() {
        let cuerpo = cuerpo_de("", "", "hola");
        assert_eq!(cuerpo["model"], json!("gpt-4o-mini-tts"));
        assert_eq!(cuerpo["voice"], json!("alloy"));
        assert_eq!(cuerpo["input"], json!("hola"));
        assert_eq!(cuerpo["response_format"], json!("mp3"));
        let puesto = cuerpo_de("tts-1-hd", "nova", "hola");
        assert_eq!(puesto["model"], json!("tts-1-hd"));
        assert_eq!(puesto["voice"], json!("nova"));
    }

    #[test]
    fn el_largo_se_mide_en_caracteres_no_en_bytes() {
        // Con acentos la diferencia entre bytes y caracteres es la que hace que
        // el aviso mienta sobre cuántas letras hay.
        let largo: String = "á".repeat(MAX_TEXTO + 1);
        let error = valida("openai", &largo).unwrap_err();
        assert!(error.contains(&(MAX_TEXTO + 1).to_string()), "{error}");
        assert!(valida("openai", &"á".repeat(MAX_TEXTO)).is_ok());
    }

    #[test]
    fn sin_texto_o_sin_motor_no_se_llama_a_nadie() {
        assert!(valida("openai", "   ").is_err());
        assert!(valida("", "hola").is_err());
        assert!(valida("off", "hola").is_err());
    }

    #[test]
    fn gemini_avisa_de_que_no_esta_conectado_en_lugar_de_fallar_raro() {
        let error = valida("gemini", "hola").unwrap_err();
        assert!(error.contains("todavía no está conectada"), "{error}");
        assert!(error.contains("Ajustes → API"), "{error}");
    }

    #[test]
    fn las_voces_que_se_ofrecen_son_las_de_openai() {
        assert!(VOCES_OPENAI.contains(&"alloy"));
        assert!(VOCES_OPENAI.contains(&"marin"));
        assert_eq!(modelo_por_defecto("openai"), "gpt-4o-mini-tts");
    }
}
