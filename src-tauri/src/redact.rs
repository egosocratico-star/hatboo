//! Tapado de secretos antes de que la salida de una herramienta salga de la
//! máquina hacia un proveedor en la nube.
//!
//! Es heurístico a propósito: no pretende ser un detector perfecto, sino que un
//! `read_file` sobre un `.env` no mande claves usables. Cada coincidencia se
//! sustituye por un marcador visible para el modelo, que así sabe que ahí había
//! algo tapado en vez de inventárselo.

use regex::{Captures, Regex};
use std::sync::OnceLock;

struct Patron {
    etiqueta: &'static str,
    re: Regex,
}

fn patrones() -> &'static [Patron] {
    static PATRONES: OnceLock<Vec<Patron>> = OnceLock::new();
    PATRONES.get_or_init(|| {
        let cruce = |etiqueta: &'static str, re: &'static str| Patron {
            etiqueta,
            re: Regex::new(re).expect("regex de redacción inválida"),
        };
        vec![
            cruce("private_key", r"(?s)-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----.*?-----END [A-Z0-9 ]*PRIVATE KEY-----"),
            cruce("anthropic_key", r"sk-ant-[A-Za-z0-9_\-]{14,}"),
            cruce("stripe_key", r"\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}\b"),
            cruce("openai_key", r"\bsk-[A-Za-z0-9_\-]{20,}\b"),
            cruce("aws_access_key", r"\bAKIA[0-9A-Z]{16}\b"),
            cruce("google_api_key", r"\bAIza[0-9A-Za-z_\-]{20,}\b"),
            cruce("github_token", r"\bgh[pousr]_[A-Za-z0-9]{20,}\b"),
            cruce("github_token", r"\bgithub_pat_[A-Za-z0-9_]{20,}\b"),
            cruce("slack_token", r"\bxox[baprs]-[A-Za-z0-9_\-]{10,}\b"),
            // `Authorization: Bearer xxx` deja la palabra: el modelo necesita ver
            // que la cabecera existe para poder hablar de ella. Va antes que el
            // JWT para que un token de sesión en una cabecera se reporte como lo
            // que es, una cabecera de autenticación.
            cruce("bearer_token", r"(?i)\b(bearer\s+)[A-Za-z0-9._~+/=\-]{12,}"),
            cruce("jwt", r"\beyJ[A-Za-z0-9_\-]{8,}\.eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\b"),
            // El valor no puede empezar por `[` para no volver a tapar un
            // marcador ya puesto.
            // Sin `\b` al principio: `_` es carácter de palabra y si no,
            // `db_password` o `AWS_SECRET` se colarían sin tapar.
            cruce("credential", r#"(?i)(api[_-]?key|apikey|access[_-]?token|auth[_-]?token|refresh[_-]?token|client[_-]?secret|secret[_-]?key|secret|password|passwd)(\s*[:=]\s*)(["']?)([^\s"'\[]{6,})"#),
        ]
    })
}

fn marcador(etiqueta: &str) -> String {
    format!("[REDACTED:{etiqueta}]")
}

/// Devuelve el texto y cuántas cosas se taparon. Con cero coincidencias
/// devuelve la cadena original intacta.
pub fn redactar(texto: &str) -> (String, usize) {
    let mut total = 0usize;
    let mut salida = texto.to_string();
    for patron in patrones() {
        let hits = patron.re.captures_iter(&salida).count();
        if hits == 0 {
            continue;
        }
        total += hits;
        let etiqueta = patron.etiqueta;
        salida = patron
            .re
            .replace_all(&salida, |c: &Captures| match c.len() {
                // `Bearer xxx` conserva la palabra; el resto se cambia entero.
                2 => format!("{}{}", &c[1], marcador(etiqueta)),
                // La clave genérica: `nombre` + `:` + comilla + valor.
                5 => format!("{}{}{}", &c[1], &c[2], marcador(etiqueta)),
                _ => marcador(etiqueta),
            })
            .into_owned();
    }
    (salida, total)
}

#[cfg(test)]
mod tests {
    use super::redactar;

    /// Relleno para alcanzar los largos que exige cada patrón.
    fn relleno(n: usize) -> String {
        "a".repeat(n)
    }

    #[test]
    fn tapa_las_formas_habituales_de_clave() {
        // Las claves se ensamblan en tiempo de ejecución a propósito: escritas
        // literales en el fuente, el escáner de secretos de GitHub rechaza el
        // push entero («push declined due to repository rule violations»).
        let openai = format!("sk-proj-{}", relleno(24));
        let anthropic = format!("sk-ant-api03-{}", relleno(24));
        let aws = format!("AKIA{}", "B".repeat(16));
        let stripe = format!("sk_live_{}", relleno(20));
        let github = format!("ghp_{}", relleno(30));
        let slack = format!("xoxb-{}-{}", relleno(12), relleno(16));
        let google = format!("AIza{}", relleno(30));
        let jwt = format!(
            "eyJ{}.eyJ{}.{}",
            relleno(20),
            relleno(20),
            relleno(20)
        );
        let privada = format!(
            "-----BEGIN {}PRIVATE KEY-----\n{}\n-----END {}PRIVATE KEY-----",
            "RSA ",
            relleno(32),
            "RSA "
        );
        let archivo = format!(
            "OPENAI_API_KEY={openai}\n\
             ANTHROPIC_KEY: {anthropic}\n\
             AWS_ACCESS_KEY_ID = {aws}\n\
             STRIPE = {stripe}\n\
             GITHUB_TOKEN={github}\n\
             SLACK={slack}\n\
             BUSINESS={google}\n\
             Authorization: Bearer {jwt}\n\
             SESSION={jwt}\n\
             db_password = 'Sup3rs3cr3ta!'\n\
             {privada}\n"
        );

        let (rojo, taps) = redactar(&archivo);
        assert!(taps >= 9, "se esperaba tapar casi todo, se taparon {taps}");
        for secreto in [
            openai.as_str(),
            anthropic.as_str(),
            aws.as_str(),
            stripe.as_str(),
            github.as_str(),
            slack.as_str(),
            google.as_str(),
            jwt.as_str(),
            privada.as_str(),
            "Sup3rs3cr3ta!",
        ] {
            assert!(!rojo.contains(secreto), "se escapó {secreto}");
        }
        assert!(rojo.contains("[REDACTED:openai_key]"));
        assert!(rojo.contains("[REDACTED:private_key]"));
        assert!(rojo.contains("[REDACTED:credential]"));
        assert!(rojo.contains("[REDACTED:jwt]"));
        // La cabecera sigue ahí para que el modelo pueda hablar de ella.
        assert!(rojo.contains("Bearer [REDACTED:bearer_token]"));
    }

    #[test]
    fn el_codigo_normal_y_la_prosa_no_se_tocan() {
        let limpio = "\
use serde::Serialize;

pub fn tokeniza(fuente: &str) -> Vec<&str> {
    fuente.split_whitespace().collect()
}

let contador = 5;
// El token de sesión se renueva cada hora.
const URL: &str = \"https://example.com/api/v1/users?page=2\";
";
        let (rojo, taps) = redactar(limpio);
        assert_eq!(taps, 0, "nada debería cambiar: {rojo}");
        assert_eq!(rojo, limpio);
    }

    #[test]
    fn tapar_dos_veces_no_vuelve_a_tapar() {
        let una = redactar("api_key = sk-proj-abcdefghijklmnopqrstuvwxyz1234").0;
        let (dos, repeticiones) = redactar(&una);
        assert_eq!(repeticiones, 0, "se re-tapó: {dos}");
        assert_eq!(dos, una);
    }
}
