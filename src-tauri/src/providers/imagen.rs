//! Motor de generación de imagen por API en la nube.
//!
//! Hatboo NO mete un motor de difusión en el equipo: eso exigiría descargar
//! binarios de terceros y varios gigas de pesos, y este equipo no tiene GPU. Lo
//! que hace es pedir la imagen a un proveedor al que ya tengas clave y guardarlo
//! en disco como cualquier otro adjunto, para que el resultado sobreviva al
//! reinicio y cualquier modelo con visión pueda volver a mirarlo.

use super::get_api_key;
use base64::Engine as _;

/// Lo que devuelve cualquier motor: los bytes de la imagen y su tipo.
pub struct ImagenGenerada {
    pub media_type: String,
    pub bytes: Vec<u8>,
}

/// Modelo por defecto de cada motor: el que sirve con una clave normal hoy.
/// Tiene que coincidir con `MOTORES_IMAGEN` en `src/proveedores.ts`, que es
/// donde el desplegable de Ajustes muestra los mismos nombres.
pub fn modelo_por_defecto(motor: &str) -> &'static str {
    match motor {
        "gemini" => "gemini-2.5-flash-image-preview",
        _ => "gpt-image-1-mini",
    }
}

/// Tamaños que acepta cada motor, y dentro de OpenAI cada familia: `dall-e-3`
/// maneja 1792×1024 y `gpt-image-1` no, y al revés con 1536×1024. Pedir el que
/// el modelo no tiene es un 400 plantado en la burbuja.
pub fn tamanos_de(motor: &str, modelo: &str) -> &'static [&'static str] {
    match motor {
        "gemini" => &["1024x1024", "1280x720", "720x1280"],
        "openai" => {
            if modelo.starts_with("gpt-image") {
                &["1024x1024", "1536x1024", "1024x1536"]
            } else {
                &["1024x1024", "1792x1024", "1024x1792"]
            }
        }
        _ => &["1024x1024"],
    }
}

/// Cliente compartido con el resto de motores de medios (`audio`): generar
/// imagen o voz tarda segundos largos y los 10 s de las sondas no valen.
pub(crate) fn cliente() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())
}

/// Pide una imagen al motor que se le diga.
pub async fn generar(
    motor: &str,
    modelo: &str,
    prompt: &str,
    tamano: &str,
) -> Result<ImagenGenerada, String> {
    let prompt = prompt.trim();
    if prompt.is_empty() {
        return Err("Escribe primero qué quieres que dibuje.".into());
    }
    if prompt.chars().count() > 1200 {
        return Err("La descripción es demasiado larga (1200 caracteres como mucho).".into());
    }
    let modelo = if modelo.trim().is_empty() {
        modelo_por_defecto(motor)
    } else {
        modelo.trim()
    };
    // El tamaño se guarda en Ajustes, y cambiar de motor o de modelo deja
    // apuntado uno que el nuevo no acepta (1792×1024 con `gpt-image-1`). Antes
    // que un 400 ininteligible en la burbuja, se echa el cuadrado: lo admiten
    // todos.
    let tamanos = tamanos_de(motor, modelo);
    let tamano = if tamanos.contains(&tamano) { tamano } else { tamanos[0] };
    match motor {
        "openai" => generar_openai(modelo, prompt, tamano).await,
        "gemini" => generar_gemini(modelo, prompt, tamano).await,
        "off" | "" => Err("El motor de imágenes está apagado: se elige en Ajustes → API.".into()),
        other => Err(format!("No conozco ese motor de imágenes: {other}")),
    }
}

/// POST con JSON y la respuesta ya parseada, con el fallo traducido a una frase.
/// La petición llega ya construida con su autenticación.
async fn post_json(
    cuerpo: &serde_json::Value,
    autorizar: reqwest::RequestBuilder,
    label: &str,
) -> Result<serde_json::Value, String> {
    let response = autorizar
        .json(cuerpo)
        .send()
        .await
        .map_err(|e| format!("No se pudo conectar con {label}: {e}"))?;
    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err(format!(
            "{label} rechazó tu clave ({0}). Revísala en Ajustes → API.",
            status.as_u16()
        ));
    }
    let value: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Respuesta inesperada de {label}: {e}"))?;
    if !status.is_success() {
        let detalle = value["error"]["message"]
            .as_str()
            .unwrap_or("sin más detalle");
        return Err(format!("{label} devolvió {status}: {detalle}"));
    }
    Ok(value)
}

/// `POST /v1/images/generations`. Se pide siempre `b64_json`: la URL que
/// devuelve por defecto caduca a los pocos minutos y el archivo se perdería.
async fn generar_openai(
    modelo: &str,
    prompt: &str,
    tamano: &str,
) -> Result<ImagenGenerada, String> {
    let key =
        get_api_key("openai").ok_or_else(|| "Falta la API key de OpenAI en el llavero.".to_string())?;
    let mut cuerpo = serde_json::json!({
        "model": modelo,
        "prompt": prompt,
        "n": 1,
        "size": tamano,
    });
    // `gpt-image-1` no admite el campo `response_format`: ya devuelve base64.
    // Mandárselo es lo que producía un 400 opaco.
    if !modelo.starts_with("gpt-image") {
        cuerpo["response_format"] = serde_json::json!("b64_json");
    }
    let cliente = cliente()?;
    let value = post_json(
        &cuerpo,
        cliente
            .post("https://api.openai.com/v1/images/generations")
            .bearer_auth(&key),
        "OpenAI",
    )
    .await?;
    imagen_desde_openai(&value).ok_or_else(|| {
        "OpenAI respondió sin imagen: mira el modelo que tienes puesto en Ajustes → API.".into()
    })
}

/// Saca la imagen de la respuesta de `/images/generations`.
fn imagen_desde_openai(value: &serde_json::Value) -> Option<ImagenGenerada> {
    let b64 = value["data"].as_array()?.first()?["b64_json"].as_str()?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .ok()?;
    Some(ImagenGenerada {
        media_type: "image/png".into(),
        bytes,
    })
}

/// El `ancho×alto` de OpenAI pasado a la forma en que Gemini entiende el
/// encuadre: su API de imagen no tiene campo de tamaño, así que la relación se
/// le escribe dentro de la descripción. El cuadrado es lo que sale sin decirle
/// nada, y añadirlo solo estorba al modelo.
fn relacion_de(tamano: &str) -> Option<&'static str> {
    match tamano {
        "1792x1024" | "1280x720" => Some("16:9"),
        "1024x1792" | "720x1280" => Some("9:16"),
        _ => None,
    }
}

/// Gemini genera imagen con el `generateContent` de siempre: la respuesta trae
/// un `Part` con `inlineData`, no un campo propio.
async fn generar_gemini(
    modelo: &str,
    prompt: &str,
    tamano: &str,
) -> Result<ImagenGenerada, String> {
    let key = get_api_key("gemini").ok_or_else(|| {
        "Falta la API key de Google Gemini en el llavero.".to_string()
    })?;
    let texto = match relacion_de(tamano) {
        Some(relacion) => format!("{prompt} (relación de aspecto {relacion})"),
        None => prompt.to_string(),
    };
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{modelo}:generateContent"
    );
    let cuerpo = serde_json::json!({
        "contents": [{ "parts": [{ "text": texto }] }],
        "generationConfig": { "responseModalities": ["IMAGE"] },
    });
    let cliente = cliente()?;
    // La clave por cabecera, no por URL: en la query se queda en el historial de
    // cualquier proxy de por medio.
    let value = post_json(
        &cuerpo,
        cliente.post(&url).header("x-goog-api-key", &key),
        "Google Gemini",
    )
    .await?;
    imagen_desde_gemini(&value).ok_or_else(|| {
        let detalle = value["error"]["message"]
            .as_str()
            .unwrap_or("el modelo respondió sin imagen");
        format!("Gemini no devolvió la imagen: {detalle}")
    })
}

/// Primer `inlineData` de la respuesta. Si el modelo contestó solo texto (se
/// negó, o el modelo apuntado no es de imagen), no hay imagen que sacar.
fn imagen_desde_gemini(value: &serde_json::Value) -> Option<ImagenGenerada> {
    let partes = value["candidates"][0]["content"]["parts"].as_array()?;
    for parte in partes {
        let Some(datos) = parte.get("inlineData") else {
            continue;
        };
        let Some(b64) = datos["data"].as_str() else {
            continue;
        };
        let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(b64) else {
            continue;
        };
        return Some(ImagenGenerada {
            media_type: datos["mimeType"].as_str().unwrap_or("image/png").to_string(),
            bytes,
        });
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const CODIGO: &str = "imagen-falsa-de-prueba";

    #[test]
    fn la_imagen_de_openai_sale_del_base64() {
        let v = json!({ "data": [{ "b64_json": base64::engine::general_purpose::STANDARD.encode(CODIGO) }] });
        let imagen = imagen_desde_openai(&v).expect("debería salir imagen");
        assert_eq!(imagen.media_type, "image/png");
        assert_eq!(imagen.bytes, CODIGO.as_bytes());
    }

    #[test]
    fn la_imagen_de_gemini_sale_del_parte_inline() {
        let v = json!({
            "candidates": [{ "content": { "parts": [
                { "text": "aquí tienes" },
                { "inlineData": { "mimeType": "image/webp", "data": base64::engine::general_purpose::STANDARD.encode(CODIGO) } }
            ] } }]
        });
        let imagen = imagen_desde_gemini(&v).expect("debería salir imagen");
        assert_eq!(imagen.media_type, "image/webp");
        assert_eq!(imagen.bytes, CODIGO.as_bytes());
    }

    #[test]
    fn un_gemini_que_solo_devuelve_texto_no_es_una_imagen() {
        // El modelo que se niega: hay que decirlo, no guardar un archivo vacío
        // como si fuera un dibujo.
        let v = json!({ "candidates": [{ "content": { "parts": [{ "text": "no puedo" }] } }] });
        assert!(imagen_desde_gemini(&v).is_none());
    }

    #[test]
    fn cada_motor_ofrece_sus_tamanos() {
        assert!(tamanos_de("openai", "dall-e-3").contains(&"1792x1024"));
        assert!(!tamanos_de("gemini", "x").contains(&"1792x1024"));
        assert_eq!(modelo_por_defecto("gemini"), "gemini-2.5-flash-image-preview");
    }

    #[test]
    fn las_gpt_image_tienen_su_propia_escuadra() {
        // `gpt-image-1` no acepta el 1792×1024 del viejo dall-e-3: de esos
        // tamaños desparejados salen los 400 que el usuario no entiende.
        let gpt = tamanos_de("openai", "gpt-image-1-mini");
        assert!(gpt.contains(&"1536x1024"));
        assert!(!gpt.contains(&"1792x1024"));
        assert_eq!(gpt[0], "1024x1024");
    }

    #[test]
    fn la_relacion_de_aspecto_sale_del_tamano() {
        assert_eq!(relacion_de("1280x720"), Some("16:9"));
        assert_eq!(relacion_de("720x1280"), Some("9:16"));
        // El cuadrado es lo que Gemini hace sin que se le diga nada.
        assert_eq!(relacion_de("1024x1024"), None);
    }
}
