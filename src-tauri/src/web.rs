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

pub async fn search_web(query: &str) -> Result<Vec<WebSource>, String> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let url = format!("{ENDPOINT}{}", percent_encode(query));
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
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
    let re = NUMERIC.get_or_init(|| Regex::new(r"&#(x?)([0-9a-fA-F]+);").unwrap());

    let mut step = input.to_string();
    for (entity, replacement) in NAMED_ENTITIES {
        if step.contains(entity) {
            step = step.replace(entity, replacement);
        }
    }

    let mut out = String::with_capacity(step.len());
    let mut last = 0;
    for caps in re.captures_iter(&step) {
        let whole = caps.get(0).unwrap();
        out.push_str(&step[last..whole.start()]);
        let hex = caps[1].eq_ignore_ascii_case("x");
        let digits = &caps[2];
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
}
