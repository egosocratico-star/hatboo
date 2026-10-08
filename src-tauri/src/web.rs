use crate::db::WebSource;
use regex::Regex;
use std::sync::OnceLock;

/// Búsqueda web sin API key: se scrapea la versión HTML de DuckDuckGo.
/// Es un camino frágil (depende del markup del buscador), así que cualquier
/// fallo se devuelve como `Err` y el chat continúa sin contexto web.
const ENDPOINT: &str = "https://html.duckduckgo.com/html/?q=";
/// DuckDuckGo responde 403 a agentes que delatan un cliente no-navegador.
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const MAX_RESULTS: usize = 6;

fn links_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r#"(?s)class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)</a>"#)
            .expect("regex de enlaces válida")
    })
}

fn snippets_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r#"(?s)class="result__snippet"[^>]*>(.*?)</a>"#)
            .expect("regex de fragmentos válida")
    })
}

/// Lo que se le pide al buscador, en una línea y con tope. DuckDuckGo no busca
/// mejor con un log de cuatro mil caracteres que con la pregunta: lo que pasaba
/// era que el mensaje entero —a veces un archivo pegado detrás— se escapaba por
/// la URL, y una query larga además se corta por el medio del servidor sin avisar.
pub fn consulta_busqueda(texto: &str) -> String {
    const MAX: usize = 200;
    let plano = texto.split_whitespace().collect::<Vec<_>>().join(" ");
    if plano.chars().count() <= MAX {
        return plano;
    }
    // Se queda con las palabras que caben enteras; cortar por un carácter suelto
    // deja una palabra a medias que busca otra cosa.
    let mut out = String::new();
    for palabra in plano.split(' ') {
        let cuenta = out.chars().count();
        if cuenta == 0 {
            // La primera palabra ya sola pasa del tope: mejor su principio que
            // una búsqueda vacía.
            out = palabra.chars().take(MAX).collect();
            continue;
        }
        if cuenta + 1 + palabra.chars().count() > MAX {
            break;
        }
        out.push(' ');
        out.push_str(palabra);
    }
    out
}

pub async fn search_web(query: &str) -> Result<Vec<WebSource>, String> {
    let query = consulta_busqueda(query);
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let url = format!("{ENDPOINT}{}", percent_encode(query.as_str()));
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        // Sin seguir redirects (T7 del threat-model): el destino del `GET` es un
        // endpoint fijo, pero un `3xx` podía mover la petición a otra máquina —por
        // ejemplo a `127.0.0.1:11434`, que en este equipo es Ollama escuchando—. Si
        // DuckDuckGo empieza a redirigir, esto pasa a ser un error visible y se
        // arregla aquí, no con la superficie abierta.
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("No se pudo consultar DuckDuckGo: {e}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("Respuesta ilegible de DuckDuckGo: {e}"))?;
    if status.is_redirection() {
        return Err("DuckDuckGo redirigió la búsqueda y Hatboo no sigue redirects".to_string());
    }
    if !status.is_success() {
        return Err(format!("DuckDuckGo devolvió {status}"));
    }
    Ok(parse_results(&body))
}

/// Extrae los resultados del HTML. Los fragmentos se emparejan por orden con
/// los enlaces: si el buscador cambia de markup, quedan cadenas vacías.
pub(crate) fn parse_results(html: &str) -> Vec<WebSource> {
    let snippets: Vec<String> = snippets_re()
        .captures_iter(html)
        .map(|c| text_of(&c[1]))
        .collect();
    let mut sources = Vec::new();
    for (index, caps) in links_re().captures_iter(html).enumerate() {
        let url = clean_url(&caps[1]);
        let title = text_of(&caps[2]);
        if title.is_empty() || url.is_empty() || is_internal(&url) {
            continue;
        }
        if !es_destino_aceptable(&url) {
            continue;
        }
        if sources.iter().any(|s: &WebSource| s.url == url) {
            continue;
        }
        sources.push(WebSource {
            title,
            snippet: snippets.get(index).cloned().unwrap_or_default(),
            url,
        });
        if sources.len() == MAX_RESULTS {
            break;
        }
    }
    sources
}

/// Los enlaces de DuckDuckGo son redirecciones (`//duckduckgo.com/l/?uddg=...`)
/// o enlaces de anuncio; aquí se recupera la URL real.
fn clean_url(href: &str) -> String {
    let href = decode_entities(href);
    let href = href.trim();
    let href = if let Some(rest) = href.strip_prefix("//") {
        format!("https:{rest}")
    } else {
        href.to_string()
    };
    if href.contains("duckduckgo.com/ads/") || href.contains("y.js") {
        return String::new();
    }
    match href.find("uddg=") {
        Some(pos) => {
            let target = &href[pos + "uddg=".len()..];
            let target = target.split('&').next().unwrap_or(target);
            percent_decode(target)
        }
        None => href,
    }
}

fn is_internal(url: &str) -> bool {
    url.contains("duckduckgo.com")
}

/// Si la dirección de un resultado es un destino que se puede nombrar. El enlace
/// que devuelve DuckDuckGo es una redirección suya (`uddg=`), así que el destino lo
/// escribe **quien publicó la página**, no el buscador: sin este filtro un resultado
/// podía apuntar a `http://127.0.0.1:11434/…` (Ollama en esta máquina), al endpoint de
/// metadatos de una nube o a un `file://`, y se listaba en la burbuja como una fuente
/// más —T7 del threat-model, y la puerta que hay que cerrar antes de hablar de ningún
/// Browser Runtime (G.4)—.
///
/// Acepta `http` y `https` con host público. Rechaza el resto de esquemas, los hosts
/// vacíos, los nombres de resolución local y las direcciones privadas, de bucle
/// invertido, link-local y multicast.
fn es_destino_aceptable(url: &str) -> bool {
    let Some(rest) = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
    else {
        return false;
    };
    let Some(host) = host_de(rest) else {
        return false;
    };
    !es_host_local_o_privado(host)
}

/// El host de lo que queda detrás de `esquema://`: sin user:pass, sin puerto y sin
/// camino. `None` si no hay un host mínimo creíble.
fn host_de(rest: &str) -> Option<&str> {
    let hasta = rest.split(['/', '?', '#']).next().unwrap_or(rest);
    let sin_credenciales = hasta.rsplit('@').next().unwrap_or(hasta);
    let host = if let Some(cerrada) = sin_credenciales.strip_prefix('[') {
        // IPv6 entre corchetes: `[::1]:8080`.
        cerrada.split(']').next().unwrap_or_default()
    } else {
        sin_credenciales.split(':').next().unwrap_or(sin_credenciales)
    };
    if host.is_empty() {
        return None;
    }
    Some(host)
}

fn es_host_local_o_privado(host: &str) -> bool {
    let h = host.to_ascii_lowercase();
    if h == "localhost"
        || h.ends_with(".localhost")
        || h.ends_with(".local")
        || h.ends_with(".internal")
        || h == "metadata.google.internal"
    {
        return true;
    }
    // IPv4 literal. Un nombre de dominio no pasa por aquí porque tiene letras.
    let partes: Vec<&str> = h.split('.').collect();
    if partes.len() == 4 {
        if let Ok(n) = partes.iter().map(|p| p.parse::<u8>()).collect::<Result<Vec<u8>, _>>() {
            let (a, b) = (n[0], n[1]);
            // 0/8 «esta red», 10/8 privada, 127/8 bucle invertido, 169.254/16
            // link-local (de ahí se lee el metadata de la nube), 172.16-31 y
            // 192.168 privadas, ≥224 multicast y reservadas.
            if a == 0 || a == 10 || a == 127 || a >= 224 {
                return true;
            }
            if a == 169 && b == 254 {
                return true;
            }
            if a == 172 && (16..=31).contains(&b) {
                return true;
            }
            if a == 192 && b == 168 {
                return true;
            }
            return false;
        }
        // Cuatro tramos que no son números: es un dominio con puntos, normal.
        return false;
    }
    // IPv6: bucle invertido, link-local y única-local (fc00::/7).
    if h == "::1" || h.starts_with("fe80:") || h.starts_with("fc") || h.starts_with("fd") {
        return true;
    }
    false
}

/// Quita las etiquetas y deja el texto legible de un resultado.
fn text_of(fragment: &str) -> String {
    collapse_spaces(&decode_entities(&strip_tags(fragment)))
}

fn strip_tags(fragment: &str) -> String {
    let mut out = String::with_capacity(fragment.len());
    let mut inside = false;
    for ch in fragment.chars() {
        match ch {
            '<' => inside = true,
            '>' => inside = false,
            _ if !inside => out.push(ch),
            _ => {}
        }
    }
    out
}

const NAMED_ENTITIES: &[(&str, &str)] = &[
    ("&amp;", "&"),
    ("&lt;", "<"),
    ("&gt;", ">"),
    ("&quot;", "\""),
    ("&apos;", "'"),
    ("&#39;", "'"),
    ("&nbsp;", " "),
    ("&ndash;", "-"),
    ("&mdash;", "-"),
    ("&hellip;", "..."),
    ("&rsquo;", "'"),
    ("&lsquo;", "'"),
    ("&rdquo;", "\""),
    ("&ldquo;", "\""),
];

fn decode_entities(input: &str) -> String {
    static NUMERIC: OnceLock<Regex> = OnceLock::new();
    let re = NUMERIC.get_or_init(|| Regex::new(r"&#(x?)([0-9a-fA-F]+);").expect("regex numérica válida"));

    let mut step = input.to_string();
    for (entity, replacement) in NAMED_ENTITIES {
        if step.contains(entity) {
            step = step.replace(entity, replacement);
        }
    }

    let mut out = String::with_capacity(step.len());
    let mut last = 0;
    for caps in re.captures_iter(&step) {
        let (Some(whole), Some(g_hex), Some(g_digits)) = (caps.get(0), caps.get(1), caps.get(2))
        else {
            continue;
        };
        out.push_str(&step[last..whole.start()]);
        let hex = g_hex.as_str().eq_ignore_ascii_case("x");
        let digits = g_digits.as_str();
        let code = if hex {
            u32::from_str_radix(digits, 16).ok()
        } else {
            digits.parse::<u32>().ok()
        };
        match code.and_then(char::from_u32) {
            Some(ch) => out.push(ch),
            None => out.push_str(whole.as_str()),
        }
        last = whole.end();
    }
    out.push_str(&step[last..]);
    out
}

fn collapse_spaces(input: &str) -> String {
    input.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Codifica una consulta para la URL (solo caracteres no reservados).
fn percent_encode(input: &str) -> String {
    let mut out = String::with_capacity(input.len() * 3);
    for byte in input.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
                match u8::from_str_radix(hex, 16) {
                    Ok(value) => {
                        out.push(value);
                        i += 3;
                    }
                    Err(_) => {
                        out.push(b'%');
                        i += 1;
                    }
                }
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            other => {
                out.push(other);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Contexto para el modelo con los resultados de la búsqueda.
pub fn as_context(sources: &[WebSource], query: &str) -> String {
    let mut out = String::from("Resultados de una búsqueda web reciente sobre «");
    out.push_str(query);
    out.push_str("». Úsalos como fuente y cita el enlace de cada afirmación:\n\n");
    for (index, source) in sources.iter().enumerate() {
        out.push_str(&format!(
            "{}. {} — {}\n{}\n\n",
            index + 1,
            source.title,
            source.url,
            source.snippet
        ));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_query_se_pone_en_una_linea_sin_toque_de_mas() {
        assert_eq!(consulta_busqueda("  qué   tiempo\nhace hoy  "), "qué tiempo hace hoy");
        assert_eq!(consulta_busqueda(""), "");
    }

    #[test]
    fn un_log_largo_no_se_cuela_por_la_url() {
        let log = format!("resume esto {}", "palabra ".repeat(400));
        let query = consulta_busqueda(&log);
        assert!(query.chars().count() <= 200, "se fue a {}", query.chars().count());
        // Se corta en palabra completa: lo que sale no termina en media palabra.
        assert!(query.ends_with("palabra") || query.ends_with("esto"));
        assert!(query.starts_with("resume esto"));
    }

    #[test]
    fn una_sola_palabra_enorme_se_recorta_en_vez_de_desaparecer() {
        let query = consulta_busqueda(&"a".repeat(500));
        assert_eq!(query.chars().count(), 200);
    }

    #[test]
    fn caber_cabe_tal_cual() {
        let pregunta = "qué tiempo hace mañana en Madrid";
        assert_eq!(consulta_busqueda(pregunta), pregunta);
    }

    const HTML: &str = r##"
      <div class="result results_links results_links_deep web-result">
        <h2 class="result__title">
          <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fnota&amp;rut=abc">Título del <b>artículo</b></a>
        </h2>
        <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fnota">Un  fragmento   con &quot;comillas&quot; y &#39;apóstrofes&#39;.</a>
      </div>
      <div class="result results_links">
        <h2 class="result__title">
          <a class="result__a" href="https://duckduckgo.com/y.js?ad_domain=x">Anuncio</a>
        </h2>
        <a class="result__snippet" href="#">spam</a>
      </div>
      <div class="result results_links">
        <h2 class="result__title">
          <a class="result__a" href="https://other.org/pagina">Otra fuente</a>
        </h2>
        <a class="result__snippet" href="#">Segundo fragmento</a>
      </div>"##;

    #[test]
    fn parses_real_urls_and_skips_ads() {
        let results = parse_results(HTML);
        assert_eq!(results.len(), 2, "el anuncio y los enlaces internos se descartan");
        assert_eq!(results[0].url, "https://example.com/nota");
        assert_eq!(results[0].title, "Título del artículo");
        assert_eq!(
            results[0].snippet,
            "Un fragmento con \"comillas\" y 'apóstrofes'."
        );
        assert_eq!(results[1].url, "https://other.org/pagina");
    }

    #[test]
    fn empty_html_has_no_results() {
        assert!(parse_results("<html><body>nada</body></html>").is_empty());
    }

    #[test]
    fn query_is_percent_encoded() {
        assert_eq!(percent_encode("qué hora es"), "qu%C3%A9+hora+es");
        assert_eq!(percent_decode("qu%C3%A9+hora+es"), "qué hora es");
    }

    #[test]
    fn context_lists_every_source_with_its_url() {
        let sources = parse_results(HTML);
        let ctx = as_context(&sources, "prueba");
        assert!(ctx.contains("https://example.com/nota"));
        assert!(ctx.contains("2. Otra fuente"));
    }

    #[test]
    fn un_resultado_no_puede_apuntar_a_la_maquina() {
        // T7: el `uddg=` de DuckDuckGo lo escribe quien publicó la página. Estos son
        // los destinos que no tienen que salir nunca en la lista de fuentes.
        for mala in [
            "http://127.0.0.1:11434/api/tags",
            "http://localhost:3000/",
            "http://169.254.169.254/latest/meta-data/",
            "http://10.0.0.12/",
            "http://192.168.1.1/admin",
            "http://[::1]:8080/",
            "file:///C:/Users/User/.ssh/id_ed25519",
            "http://metadata.google.internal/",
            "gopher://example.com/",
            "https://",
        ] {
            assert!(!es_destino_aceptable(mala), "se coló {mala}");
        }
        for buena in [
            "https://example.com/nota",
            "http://example.org/a?b=1",
            "https://sub.domain.co.uk/x",
            "https://example.com:8443/",
        ] {
            assert!(es_destino_aceptable(buena), "se descartó {buena}");
        }
    }

    #[test]
    fn el_parseo_descarta_los_destinos_que_no_pueden_ser_fuentes() {
        let html = r#"<div class="result__a" href="https://duckduckgo.com/l/?uddg=http%3A%2F%2F127.0.0.1%3A11434%2Fapi%2Ftags">Ollama</a>
            <div class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fsi">Publicable</a>"#;
        let fuentes = parse_results(html);
        let urls: Vec<&str> = fuentes.iter().map(|s| s.url.as_str()).collect();
        assert_eq!(urls, vec!["https://example.com/si"], "{urls:?}");
    }
}
