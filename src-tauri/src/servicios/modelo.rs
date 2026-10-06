//! `ModelService`: la ruta proveedor + modelo + base url, y el HTTP que ya no
//! puede montar nadie suelto.
//!
//! Dos comandos traían su propio `reqwest::Client`, y por eso este módulo existe:
//!
//! - `unload_local_model` posteaba `/api/generate` a mano, saltándose
//!   [`crate::providers::local`], que es justo el sitio que sabe de Ollama. Ahora
//!   el comando llama aquí y esto llama a `providers::local::descargar_modelo`.
//! - `fetch_github` bajaba el crudo de un repo con su propio cliente. Lo que hace
//!   falta para que eso no sea un `fetch` arbitrario desde la máquina de él es la
//!   lista de hosts, el no-seguir-redirecciones y la cabecera `raw`: se han
//!   movido **enteros**, con su comentario, y tienen prueba.
//!
//! Lo demás del HTTP de proveedores ya vivía en `crate::providers`; este módulo es
//! la puerta que usan los comandos, no un cliente más.

use crate::commands::_comunes::ATTACHMENT_MAX_BYTES;
use crate::db;
use crate::providers::local;

/// Hosts de los que se puede leer. Lista cerrada a propósito: la URL la pega el
/// usuario y sin esto esto sería un `fetch` arbitrario desde la máquina, con
/// `http://localhost:11434` o el endpoint de metadatos de la nube incluidos.
const GITHUB_HOSTS: [&str; 3] = [
    "github.com",
    "raw.githubusercontent.com",
    "gist.githubusercontent.com",
];

pub struct ModelService;

impl ModelService {
    /// Suelta un modelo de la memoria de Ollama, que es lo que hace `ollama stop`.
    /// El nombre se recorta aquí y no más abajo: un modelo con espacios alrededor
    /// no existe en Ollama y el error que saldría sería «model not found», que no
    /// dice lo que le pasa al usuario.
    pub async fn descarga_modelo(endpoint: &str, model: &str) -> Result<(), String> {
        let model = model.trim();
        if model.is_empty() {
            return Err("Falta el nombre del modelo.".into());
        }
        local::descargar_modelo(endpoint, model).await
    }

    /// Lee un archivo de GitHub como contexto de texto, sin clonar el repo.
    /// Es solo lectura y solo hacia github.com; lo que se obtiene entra por la misma
    /// ruta que un archivo adjunto del disco.
    pub async fn adjunto_de_github(url: &str) -> Result<db::Attachment, String> {
        let (destino, nombre) = github_a_cruda(url.trim()).ok_or(
            "Esa URL no es de GitHub. Pega la de un archivo (…/blob/main/…) o la raíz de un repo.",
        )?;

        let respuesta = pedir(&destino).await?;
        let estado = respuesta.status();
        if estado == reqwest::StatusCode::NOT_FOUND {
            return Err("Ese archivo no existe en esa rama, o el repo es privado.".into());
        }
        if estado.as_u16() == 403 {
            return Err("GitHub está limitando las peticiones anónimas (403). Inténtalo en un rato o abre el archivo tú mismo y adjúntalo desde el disco.".into());
        }
        if !estado.is_success() {
            return Err(format!("GitHub respondió {estado}."));
        }

        let bytes = respuesta
            .bytes()
            .await
            .map_err(|e| format!("La descarga se cortó: {e}"))?;
        texto_de_adjunto(&nombre, &bytes)
    }
}

/// El adjunto de texto a partir de los bytes de la respuesta: binario fuera, y
/// truncado al mismo techo que un archivo elegido del disco.
fn texto_de_adjunto(nombre: &str, bytes: &[u8]) -> Result<db::Attachment, String> {
    if bytes.contains(&0) {
        return Err(format!(
            "«{nombre}» parece binario y no se puede adjuntar como texto."
        ));
    }
    let corte = bytes.len().min(ATTACHMENT_MAX_BYTES);
    let mut texto = String::from_utf8_lossy(&bytes[..corte]).into_owned();
    if bytes.len() > corte {
        texto.push_str("\n\n[... el archivo se truncó por tamaño ...]");
    }
    Ok(db::Attachment::text(nombre.to_string(), texto))
}

/// El GET del servicio. `Policy::none()` es la parte que no se puede aflojar:
/// una URL de github.com válida podría redirigir a cualquier host y convertir la
/// lista de arriba en decorado.
fn cliente_de_github() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        // Sin esto una URL de github.com válida podría redirigir a cualquier
        // host y convertir la lista de arriba en decorado.
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(20))
        .user_agent("hatboo")
        .build()
        .map_err(|e| e.to_string())
}

/// Pide `destino` sin seguir redirecciones y añade la cabecera que la API de
/// README necesita para devolver el crudo en vez de JSON.
async fn pedir(destino: &str) -> Result<reqwest::Response, String> {
    let cliente = cliente_de_github()?;
    let peticion = cliente.get(destino);
    // La API de README devuelve JSON salvo que se pida el crudo explícitamente.
    let peticion = if destino.starts_with("https://api.github.com/") {
        peticion.header(reqwest::header::ACCEPT, "application/vnd.github.raw")
    } else {
        peticion
    };
    peticion
        .send()
        .await
        .map_err(|e| format!("No se pudo alcanzar GitHub: {e}"))
}

/// Divide una URL en (host, resto) sin crate `url`, como en `web.rs`.
fn partir_url(url: &str) -> Option<(&str, &str)> {
    let resto = url.strip_prefix("https://").or_else(|| url.strip_prefix("http://"))?;
    let (host, camino) = resto.split_once('/')?;
    Some((host.split(':').next()?, camino))
}

fn sin_query(s: &str) -> &str {
    s.split('?').next().unwrap_or(s)
}

/// Convierte la URL que pega el usuario en la URL cruda que hay que pedir y el
/// nombre con el que se etiqueta el adjunto. `None` si no es una forma que
/// reconocemos.
fn github_a_cruda(url: &str) -> Option<(String, String)> {
    let (host, camino) = partir_url(url)?;
    if !GITHUB_HOSTS.contains(&host) {
        return None;
    }
    // El query se quita aquí, una vez: si no, `?plain=1` de una URL de GitHub se
    // colaría en la ruta de raw y el archivo no aparecería.
    let camino = sin_query(camino);
    let tramos: Vec<&str> = camino.split('/').collect();
    match host {
        "github.com" => {
            // github.com/<owner>/<repo>/blob/<ref>/<path...>
            if tramos.len() >= 5 && tramos[2] == "blob" {
                let (owner, repo, _ref, ruta) = (tramos[0], tramos[1], tramos[3], &tramos[4..]);
                let ruta = ruta.join("/");
                let nombre = ruta.split('/').next_back()?.to_string();
                Some((
                    format!("https://raw.githubusercontent.com/{owner}/{repo}/{_ref}/{ruta}"),
                    nombre,
                ))
            } else if tramos.len() == 2 {
                // Raíz del repo: se pide su README por la API.
                Some((
                    format!("https://api.github.com/repos/{}/{}/readme", tramos[0], tramos[1]),
                    "README.md".to_string(),
                ))
            } else {
                None
            }
        }
        // raw.githubusercontent.com/<owner>/<repo>/<ref>/<path...>
        // gist.githubusercontent.com/<id>/<raw>/<archivo>
        _ => {
            let ruta = camino.rsplit('/').next().filter(|s| !s.is_empty())?;
            Some((format!("https://{host}/{camino}"), ruta.to_string()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    #[test]
    fn urls_de_github_que_se_aceptan() {
        let (cruda, nombre) =
            github_a_cruda("https://github.com/egosocratico-star/hatboo/blob/main/README.md")
                .unwrap();
        assert_eq!(
            cruda,
            "https://raw.githubusercontent.com/egosocratico-star/hatboo/main/README.md"
        );
        assert_eq!(nombre, "README.md");

        // Ruta con carpetas dentro y query que hay que quitar.
        let (cruda, _) =
            github_a_cruda("https://github.com/a/b/blob/v1.2/src-tauri/src/main.rs?x=1").unwrap();
        assert_eq!(cruda, "https://raw.githubusercontent.com/a/b/v1.2/src-tauri/src/main.rs");

        // Cruda directa.
        let (cruda, nombre) =
            github_a_cruda("https://raw.githubusercontent.com/a/b/main/Cargo.toml").unwrap();
        assert_eq!(cruda, "https://raw.githubusercontent.com/a/b/main/Cargo.toml");
        assert_eq!(nombre, "Cargo.toml");

        // Raíz del repo → README por la API.
        let (cruda, nombre) = github_a_cruda("https://github.com/a/b").unwrap();
        assert_eq!(cruda, "https://api.github.com/repos/a/b/readme");
        assert_eq!(nombre, "README.md");
    }

    #[test]
    fn cualquier_otro_host_se_rechaza() {
        // El control no es cosmético: sin la lista esto sería un fetch arbitrario
        // desde la máquina del usuario.
        for mala in [
            "http://localhost:11434/api/tags",
            "https://169.254.169.254/latest/meta-data/",
            "https://evil.com/a/b/blob/main/x.rs",
            "https://github.com.evil.com/a/b",
            "file:///c:/windows/win.ini",
            "https://github.com/",
            "no soy una url",
        ] {
            assert!(github_a_cruda(mala).is_none(), "se aceptó {mala}");
        }
    }

    /// Lo que se pide **siempre** cae en un host permitido, cómo sea que el usuario
    /// escriba la URL. La lista de arriba mira el host de entrada, y el destino que
    /// se pide se reconstruye desde cero —con `https://` y sin puerto—, así que ni
    /// el truco del puerto (`github.com:443.evil.com`) ni un host que empiece igual
    /// acaban en un servidor ajeno.
    #[test]
    fn el_destino_que_sale_es_siempre_de_un_host_permitido() {
        const PERMITIDOS: [&str; 4] = [
            "github.com",
            "raw.githubusercontent.com",
            "gist.githubusercontent.com",
            "api.github.com",
        ];
        for entrada in [
            "https://github.com:443.evil.com/a/b",
            "https://github.com:8443/a/b/blob/main/x.rs",
            "https://raw.githubusercontent.com.evil.com/a/b/main/x",
            "https://a:b@github.com/x/y/blob/main/z",
            "https://github.com/a/b",
            "https://gist.githubusercontent.com/o/123/raw/nota.md",
            "http://github.com/a/b/blob/main/x",
        ] {
            let Some((destino, _)) = github_a_cruda(entrada) else {
                continue;
            };
            let (host, _) = partir_url(&destino).expect("el destino es una URL con host");
            assert!(
                PERMITIDOS.contains(&host),
                "de {entrada} salió un pedido a {host}"
            );
        }
        // Y el host que se hace pasar por la lista, tal cual: rechazado.
        assert!(github_a_cruda("https://raw.githubusercontent.com.evil.com/a/b/main/x").is_none());
        assert!(github_a_cruda("https://github.com/a/b/blob/main/x").is_some());
    }

    /// La prueba del criterio: un `302` hacia otro host **no se sigue**.
    /// Se monta un servidor en el loopback —sin salir a la red— que redirige a un
    /// segundo servidor que sirve un cuerpo envenenado. Si la política se afloja,
    /// `pedir` devuelve el `200` del segundo y esta prueba lo ve.
    #[tokio::test]
    async fn un_redirect_a_otro_host_no_se_sigue() {
        // El señuelo: contesta 302 apuntando al otro puerto.
        let senyuelo = TcpListener::bind("127.0.0.1:0").unwrap();
        let puerto_senyuelo = senyuelo.local_addr().unwrap().port();
        // El otro host: el que solo se tocaría si la redirección se siguiera.
        let robado = TcpListener::bind("127.0.0.1:0").unwrap();
        let puerto_robado = robado.local_addr().unwrap().port();

        std::thread::spawn(move || {
            for mut stream in robado.incoming().flatten().take(1) {
                let mut buf = [0u8; 512];
                let _ = stream.read(&mut buf);
                let _ = stream.write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 16\r\nConnection: close\r\n\r\nCONTENIDO ROBADO",
                );
            }
        });
        std::thread::spawn(move || {
            for mut stream in senyuelo.incoming().flatten().take(1) {
                let mut buf = [0u8; 512];
                let _ = stream.read(&mut buf);
                let _ = stream.write_all(
                    format!(
                        "HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:{puerto_robado}/robado\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                    )
                    .as_bytes(),
                );
            }
        });

        let respuesta = pedir(&format!("http://127.0.0.1:{puerto_senyuelo}/README.md"))
            .await
            .expect("el señuelo responde");
        assert_eq!(
            respuesta.status().as_u16(),
            302,
            "siguió la redirección: contestó {}",
            respuesta.status()
        );
        let cuerpo = respuesta.bytes().await.unwrap_or_default();
        assert!(
            !cuerpo.as_ref().windows(6).any(|w| w == b"ROBADO"),
            "el cuerpo llegó del otro host: {}",
            String::from_utf8_lossy(&cuerpo)
        );
    }

    /// Lo que se baja solo puede acabar en texto de adjunto del tamaño de un
    /// adjunto: el techo del «+» es el mismo aquí.
    #[test]
    fn un_binario_no_se_adjunta_como_texto_y_un_texto_largo_se_trunca() {
        assert!(texto_de_adjunto("foto.png", b"abc\0def").is_err());
        let largo = vec![b'a'; ATTACHMENT_MAX_BYTES + 10];
        let a = texto_de_adjunto("grande.txt", &largo).unwrap();
        assert!(a.text.ends_with("[... el archivo se truncó por tamaño ...]"));
        assert_eq!(a.name, "grande.txt");
        // Y lo que no llega al techo sale tal cual, sin el aviso.
        assert_eq!(texto_de_adjunto("corto.txt", b"hola").unwrap().text, "hola");
    }

    /// `ModelService::descarga_modelo` rechaza el nombre vacío antes de montar
    /// nada: sin esto la petición se iría a Ollama con `"model": ""`.
    #[tokio::test]
    async fn descargar_sin_nombre_de_modelo_no_llama_a_nadie() {
        for en_blanco in ["", "   "] {
            let e = ModelService::descarga_modelo("http://127.0.0.1:9", en_blanco)
                .await
                .unwrap_err();
            assert_eq!(e, "Falta el nombre del modelo.");
        }
    }
}
