//! Archivos y adjuntos: la puerta del «+», el árbol del proyecto, su buscador y
//! su vista previa.

use super::_comunes::ATTACHMENT_MAX_BYTES;
use crate::db;
use crate::state::{self, AppState};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::State;

// ---------- Metadatos de archivos del proyecto ----------

#[derive(serde::Serialize)]
pub struct FileMeta {
    pub size: i64,
    pub mtime: i64,
}

/// Tamaño y fecha de un archivo del proyecto, para la tarjeta que sale bajo la
/// respuesta que lo escribió. La ruta llega RELATIVA y se valida contra la raíz
/// del proyecto como cualquier otra ruta del agente: un «../» que salga fuera
/// se rechaza sin tocar disco.
#[tauri::command]
pub fn file_meta(
    app: State<AppState>,
    project_id: String,
    ruta: String,
) -> Result<FileMeta, String> {
    let root = {
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        PathBuf::from(db::get_project(&conn, &project_id)?.root_path)
    };
    let canon = root.canonicalize().map_err(|e| e.to_string())?;
    let junta = canon.join(ruta.replace('/', std::path::MAIN_SEPARATOR_STR));
    let destino = junta
        .canonicalize()
        .map_err(|_| "Ese archivo ya no existe.".to_string())?;
    if !destino.starts_with(&canon) {
        return Err("La ruta queda fuera del proyecto.".into());
    }
    let md = std::fs::metadata(&destino).map_err(|e| e.to_string())?;
    let mtime = md
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    Ok(FileMeta {
        size: md.len() as i64,
        mtime,
    })
}

const ATTACHMENT_IMAGE_EXTS: [&str; 7] =
    ["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico"];

/// Lee un archivo elegido por el usuario para adjuntarlo a un mensaje. Es la
/// puerta única del «+»: una imagen se guarda y se referencia como payload de
/// visión; lo demás se lee como texto, con truncado para no comerse la ventana de
/// contexto. Antes había dos opciones en el menú y dos comandos para lo mismo.
#[tauri::command]
pub fn read_attachment(
    app: State<'_, AppState>,
    path: String,
) -> Result<db::Attachment, String> {
    let canonical = std::path::Path::new(&path)
        .canonicalize()
        .map_err(|_| "No se encontró el archivo.".to_string())?;
    if !canonical.is_file() {
        return Err("La ruta seleccionada no es un archivo.".into());
    }
    let name = canonical
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "archivo".to_string());
    let ext = canonical
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    if ATTACHMENT_IMAGE_EXTS.contains(&ext.as_str()) {
        return guardar_imagen(app.inner(), &canonical);
    }
    let bytes = std::fs::read(&canonical).map_err(|e| format!("No se pudo leer: {e}"))?;
    if bytes.contains(&0) {
        return Err(format!(
            "«{name}» parece un archivo binario y no se puede adjuntar como texto."
        ));
    }
    let truncated = bytes.len() > ATTACHMENT_MAX_BYTES;
    let slice = &bytes[..bytes.len().min(ATTACHMENT_MAX_BYTES)];
    let mut text = String::from_utf8_lossy(slice).into_owned();
    if truncated {
        text.push_str("\n\n[... el archivo se truncó por tamaño ...]");
    }
    Ok(db::Attachment::text(name, text))
}

/// Lo que se soltó encima de la ventana, repartido: las carpetas son proyectos (el
/// gesto de siempre) y los archivos van al mensaje que se está escribiendo. Sin
/// este reparto, soltar un .png intentaba abrirlo como proyecto y contestaba un
/// error.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Soltadas {
    pub carpetas: Vec<String>,
    pub archivos: Vec<String>,
}

#[tauri::command]
pub fn clasifica_soltadas(paths: Vec<String>) -> Soltadas {
    let mut carpetas = Vec::new();
    let mut archivos = Vec::new();
    for p in paths {
        if std::path::Path::new(&p).is_dir() {
            carpetas.push(p);
        } else {
            archivos.push(p);
        }
    }
    Soltadas { carpetas, archivos }
}

/// Hosts de los que se puede leer. Lista cerrada a propósito: la URL la pega el
/// usuario y sin esto esto sería un `fetch` arbitrario desde la máquina, con
/// `http://localhost:11434` o el endpoint de metadatos de la nube incluidos.
const GITHUB_HOSTS: [&str; 3] = [
    "github.com",
    "raw.githubusercontent.com",
    "gist.githubusercontent.com",
];

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

/// Lee un archivo de GitHub como contexto de texto, sin clonar el repo.
/// Es solo lectura y solo hacia github.com; lo que se obtiene entra por la misma
/// ruta que un archivo adjunto del disco.
#[tauri::command]
pub async fn fetch_github(url: String) -> Result<db::Attachment, String> {
    let (destino, nombre) = github_a_cruda(url.trim())
        .ok_or("Esa URL no es de GitHub. Pega la de un archivo (…/blob/main/…) o la raíz de un repo.")?;

    let cliente = reqwest::Client::builder()
        // Sin esto una URL de github.com válida podría redirigir a cualquier
        // host y convertir la lista de arriba en decorado.
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(20))
        .user_agent("hatboo")
        .build()
        .map_err(|e| e.to_string())?;

    let peticion = cliente.get(&destino);
    // La API de README devuelve JSON salvo que se pida el crudo explícitamente.
    let peticion = if destino.starts_with("https://api.github.com/") {
        peticion.header(reqwest::header::ACCEPT, "application/vnd.github.raw")
    } else {
        peticion
    };

    let respuesta = peticion
        .send()
        .await
        .map_err(|e| format!("No se pudo alcanzar GitHub: {e}"))?;
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
    if bytes.contains(&0) {
        return Err(format!("«{nombre}» parece binario y no se puede adjuntar como texto."));
    }
    let corte = bytes.len().min(ATTACHMENT_MAX_BYTES);
    let mut texto = String::from_utf8_lossy(&bytes[..corte]).into_owned();
    if bytes.len() > corte {
        texto.push_str("\n\n[... el archivo se truncó por tamaño ...]");
    }
    Ok(db::Attachment::text(nombre, texto))
}

/// Máximo de bytes de una imagen adjunta (M3), antes de copiarla a disco.
const IMAGE_MAX_BYTES: usize = 4 * 1024 * 1024;
/// Guarda una imagen en `data_dir/attachments` y devuelve la referencia (no el
/// binario) para adjuntarla al mensaje. Es el ramo de imagen de `read_attachment`:
/// tenerlo en una función es lo que permite que un solo «+» acepte cualquier
/// archivo. Solo formatos de visión comunes y tamaño acotado; el base64 se
/// genera al construir el payload.
fn guardar_imagen(
    app: &AppState,
    canonical: &std::path::Path,
) -> Result<db::Attachment, String> {
    let ext = canonical
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    let media_type = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => {
            return Err(
                "Formato de imagen no soportado. Usa PNG, JPG, GIF o WEBP.".into(),
            )
        }
    };
    let bytes = std::fs::read(canonical).map_err(|e| format!("No se pudo leer: {e}"))?;
    if bytes.len() > IMAGE_MAX_BYTES {
        return Err(format!(
            "La imagen pesa {} MB; el máximo es 4 MB.",
            (bytes.len() as f64 / 1_048_576.0 * 10.0).round() / 10.0
        ));
    }
    let dir = app.data_dir.join("attachments");
    std::fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear la carpeta: {e}"))?;
    let dest = dir.join(format!("{}.{}", uuid::Uuid::new_v4(), ext));
    std::fs::write(&dest, &bytes).map_err(|e| format!("No se pudo guardar la imagen: {e}"))?;
    let name = canonical
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| dest.display().to_string());
    Ok(db::Attachment {
        name,
        text: String::new(),
        image_media_type: Some(media_type.to_string()),
        image_file: Some(dest.display().to_string()),
    })
}

/// Captura la pantalla principal y la guarda como imagen adjunta, para enseñar
/// un error o una maqueta sin tener que guardar el archivo antes. Sale por el
/// mismo camino que una imagen elegida del disco: `data_dir/attachments` y
/// referencia en el mensaje, nunca el binario en SQLite.
#[tauri::command]
pub fn capture_screen(app: State<AppState>, nombre: String) -> Result<db::Attachment, String> {
    #[cfg(target_os = "windows")]
    {
        use image::ImageEncoder;
        let monitor = xcap::Monitor::all()
            .map_err(|e| format!("No se pudieron listar las pantallas: {e}"))?
            .into_iter()
            .find(|m| m.is_primary().unwrap_or(false))
            .or_else(|| xcap::Monitor::all().ok().and_then(|v| v.into_iter().next()))
            .ok_or("No se encontró ninguna pantalla que capturar.")?;
        let imagen = monitor
            .capture_image()
            .map_err(|e| format!("La captura falló: {e}"))?;

        let mut png: Vec<u8> = Vec::new();
        let codificador = image::codecs::png::PngEncoder::new(&mut png);
        codificador
            .write_image(
                imagen.as_raw(),
                imagen.width(),
                imagen.height(),
                image::ExtendedColorType::Rgba8,
            )
            .map_err(|e| format!("No se pudo codificar el PNG: {e}"))?;
        if png.len() > IMAGE_MAX_BYTES {
            return Err(format!(
                "La captura pesa {} MB; el máximo es 4 MB.",
                (png.len() as f64 / 1_048_576.0 * 10.0).round() / 10.0
            ));
        }

        // El nombre lo pone el frente (ahí sí hay hora local), pero llega por el
        // wire: sin separadores y con .png siempre, que es lo que acabamos de codificar.
        let nombre = {
            let limpio = nombre
                .chars()
                .filter(|c| !matches!(c, '/' | '\\' | ':' | '\0'))
                .collect::<String>();
            let base = limpio.trim_end_matches(".png");
            format!("{}.png", if base.is_empty() { "captura" } else { base })
        };
        let dir = app.data_dir.join("attachments");
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("No se pudo crear la carpeta: {e}"))?;
        let destino = dir.join(format!("{}.png", uuid::Uuid::new_v4()));
        std::fs::write(&destino, &png).map_err(|e| format!("No se pudo guardar: {e}"))?;
        Ok(db::Attachment {
            name: nombre,
            text: String::new(),
            image_media_type: Some("image/png".to_string()),
            image_file: Some(destino.display().to_string()),
        })
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, nombre);
        Err("La captura de pantalla está hecha solo para Windows por ahora.".into())
    }
}

/// Devuelve una imagen adjunta como data URI para poder pintarla en la burbuja.
/// La ruta llega desde la BD —y tras una importación ese JSON es ajeno—, así que
/// se canonicaliza y se exige que siga dentro de `attachments/` antes de leer.
#[tauri::command]
pub fn attachment_image(app: State<AppState>, file: String) -> Result<String, String> {
    image_data_uri(&app.data_dir.join("attachments"), &file)
}

fn image_data_uri(attachments_dir: &Path, file: &str) -> Result<String, String> {
    use base64::{engine::general_purpose, Engine as _};
    let root = attachments_dir
        .canonicalize()
        .map_err(|_| "La carpeta de adjuntos no existe.".to_string())?;
    let path = Path::new(file)
        .canonicalize()
        .map_err(|_| "La imagen ya no está disponible.".to_string())?;
    if !path.starts_with(&root) {
        return Err("Ese archivo no está en la carpeta de adjuntos de Hatboo.".into());
    }
    let media_type = match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => return Err("Formato de imagen no soportado.".into()),
    };
    let bytes = std::fs::read(&path).map_err(|e| format!("No se pudo leer: {e}"))?;
    Ok(format!(
        "data:{media_type};base64,{}",
        general_purpose::STANDARD.encode(&bytes)
    ))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    /// Bytes del archivo. En las carpetas vale 0: sumar lo que hay dentro
    /// costaría un recorrido completo por cada nivel que se abre en el árbol.
    pub size: u64,
}

/// Lista un nivel del árbol de archivos del proyecto (ruta relativa; "" = raíz).
///
/// Se saltan las carpetas de `ignore_dirs`, la MISMA lista que usan `list_dir` y
/// `search_files` del agente: si el panel las enseña, el agente las ve, y si no,
/// tampoco las busca. Con `Documentos` como raíz era lo que más se notaba.
#[tauri::command]
pub fn list_project_dir(
    app: State<AppState>,
    project_id: String,
    relative_path: String,
) -> Result<Vec<FileEntry>, String> {
    // Antes de bloquear la conexión: `load_settings` usa el mismo mutex.
    let ignoradas = state::load_settings(&app).ignore_dirs;
    let root = {
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        PathBuf::from(db::get_project(&conn, &project_id)?.root_path)
    };
    let resolved = crate::agent::tools::resolve_in_project(&root, &relative_path)
        .map_err(|e| e.to_string())?;
    let entries = std::fs::read_dir(&resolved).map_err(|e| e.to_string())?;
    // La raíz se recorta ya canonicalizada. `resolve_in_project` canónica la del
    // proyecto, y si aquí se recorta contra la cadena tal como está en la base de
    // datos —otra letra, otro separador, uno de esos caminos redirigidos por
    // OneDrive— el recorte no acierta y el supuesto «relativo» sale ABSOLUTO. El
    // frontend lo devuelve al mismo comando, ese lo rechaza con razón por
    // seguridad, y el resultado es un árbol de carpetas que no enseñan nada.
    let raiz = root.canonicalize().unwrap_or_else(|_| root.clone());
    let mut out: Vec<FileEntry> = entries
        .flatten()
        .filter(|e| {
            let es_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
            !es_dir || !crate::agent::ignore::ignora(&e.file_name().to_string_lossy(), &ignoradas)
        })
        .map(|e| {
            let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
            let rel = e
                .path()
                .strip_prefix(&raiz)
                .unwrap_or(e.path().as_path())
                .to_string_lossy()
                .replace('\\', "/");
            let size = if is_dir {
                0
            } else {
                e.metadata().map(|m| m.len()).unwrap_or(0)
            };
            FileEntry {
                name: e.file_name().to_string_lossy().into_owned(),
                path: rel,
                is_dir,
                size,
            }
        })
        .collect();
    out.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    out.truncate(500);
    Ok(out)
}

/// Cuánto se lee para la vista previa del panel de archivos. No es el tope de un
/// adjunto: aquí solo hay que ver de qué va el archivo, y 64 KB ya son más de mil
/// líneas en pantalla.
const PREVIEW_MAX_BYTES: usize = 64_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VistaPrevia {
    pub texto: String,
    /// Tamaño real del archivo, no lo que se llegó a leer.
    pub bytes: u64,
    pub lineas: usize,
    pub truncado: bool,
}

/// El texto de un archivo del proyecto para verlo en el panel, sin añadirlo al
/// mensaje. Pasa por el mismo candado de rutas que las herramientas del agente.
#[tauri::command]
pub fn preview_project_file(
    app: State<AppState>,
    project_id: String,
    relative_path: String,
) -> Result<VistaPrevia, String> {
    let root = {
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        PathBuf::from(db::get_project(&conn, &project_id)?.root_path)
    };
    let resuelta = crate::agent::tools::resolve_in_project(&root, &relative_path)
        .map_err(|e| e.to_string())?;
    leer_vista_previa(&resuelta)
}

/// Fuera del comando para poder probarla con un archivo temporal: el comando
/// necesita `AppState` y la base de datos abierta.
fn leer_vista_previa(ruta: &Path) -> Result<VistaPrevia, String> {
    let nombre = ruta
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "archivo".to_string());
    let bytes = std::fs::read(ruta).map_err(|e| format!("No se pudo leer: {e}"))?;
    if bytes.contains(&0) {
        return Err(format!(
            "«{nombre}» no es texto: es una imagen o un binario."
        ));
    }
    let truncado = bytes.len() > PREVIEW_MAX_BYTES;
    let texto =
        String::from_utf8_lossy(&bytes[..bytes.len().min(PREVIEW_MAX_BYTES)]).into_owned();
    let lineas = texto.lines().count();
    Ok(VistaPrevia {
        texto,
        bytes: bytes.len() as u64,
        lineas,
        truncado,
    })
}

/// Busca archivos por nombre (sin distinguir mayúsculas) dentro del proyecto.
/// `dentro`, si viene, es una carpeta del proyecto y el recorrido arranca y se
/// para ahí («buscar aquí» en el árbol). Las rutas que salen siguen siendo
/// relativas a la raíz del proyecto: es lo que entienden la vista previa y el
/// «añadir al mensaje», y lo que el árbol abre sin tener que traducir nada.
#[tauri::command]
pub async fn search_project_files(
    app: State<'_, AppState>,
    project_id: String,
    query: String,
    dentro: Option<String>,
) -> Result<Vec<String>, String> {
    let ignoradas = state::load_settings(&app).ignore_dirs;
    let root = {
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        PathBuf::from(db::get_project(&conn, &project_id)?.root_path)
    };
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Ok(Vec::new());
    }
    let proyecto = root.canonicalize().unwrap_or_else(|_| root.clone());
    let donde = match dentro.as_deref().map(str::trim).filter(|d| !d.is_empty()) {
        Some(d) => crate::agent::tools::resolve_in_project(&proyecto, d)
            .map_err(|e| e.to_string())?,
        None => proyecto.clone(),
    };
    if !donde.is_dir() {
        return Err("Esa carpeta ya no existe.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        Ok(buscar_por_niveles(
            &proyecto,
            &donde,
            &needle,
            &Presupuesto {
                total: 20_000,
                por_carpeta: 500,
            },
            &ignoradas,
        ))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Cuánto se mira antes de rendirse. Va aparte del recorrido para poder
/// comprobarlo con carpetas de prueba pequeñas.
struct Presupuesto {
    total: usize,
    por_carpeta: usize,
}

/// Nombres que contienen `needle`, recorriendo el proyecto **por niveles** y con
/// tope de entradas por carpeta.
///
/// Antes era en profundidad y con un único tope global: en una carpeta tipo
/// `Documentos` (una bóveda de Obsidian, la sincronización de OneDrive) la
/// primera subcarpeta grande se comía el presupuesto entero y ni se miraban las
/// vecinas, así que el buscador decía «sin coincidencias» de archivos que están
/// a la vista. Por niveles, con un techo de entradas por carpeta, ninguna puede
/// tapar al resto.
///
/// Se salta `ignoradas` —la lista de los ajustes, la misma del árbol y de
/// `list_dir`—. Aquí había además un «todo lo que empiece por punto»: el árbol sí
/// enseñaba `.vscode` o `.cargo` y el buscador no los encontraba nunca, que es
/// justo la clase de mentira que este plan quiere quitar. El presupuesto de
/// arriba es la guarda, no el punto.
///
/// `proyecto` es solo para el recorte: lo que se devuelve se lee relativo a la
/// raíz del proyecto aunque el recorrido empiece más abajo (`donde`).
fn buscar_por_niveles(
    proyecto: &Path,
    donde: &Path,
    needle: &str,
    p: &Presupuesto,
    ignoradas: &[String],
) -> Vec<String> {
    const MAX_RESULTADOS: usize = 100;
    let mut out: Vec<String> = Vec::new();
    let mut por_procesar: std::collections::VecDeque<PathBuf> = std::collections::VecDeque::new();
    por_procesar.push_back(donde.to_path_buf());
    let mut visitadas = 0usize;
    while let Some(dir) = por_procesar.pop_front() {
        if out.len() >= MAX_RESULTADOS || visitadas >= p.total {
            break;
        }
        let Ok(read_dir) = std::fs::read_dir(&dir) else { continue };
        for entry in read_dir.flatten().take(p.por_carpeta) {
            visitadas += 1;
            let nombre = entry.file_name().to_string_lossy().into_owned();
            let es_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            if es_dir {
                if crate::agent::ignore::ignora(&nombre, ignoradas) {
                    continue;
                }
                por_procesar.push_back(entry.path());
            } else if nombre.to_lowercase().contains(needle) {
                if let Ok(rel) = entry.path().strip_prefix(proyecto) {
                    out.push(rel.to_string_lossy().replace('\\', "/"));
                }
                if out.len() >= MAX_RESULTADOS {
                    break;
                }
            }
        }
    }
    out.sort();
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

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

        /// Carpeta de adjuntos desechable con un PNG minúsculo dentro.
        fn dir_con_imagen() -> PathBuf {
            let dir = std::env::temp_dir().join(format!("hatboo-img-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).unwrap();
            let mut f = std::fs::File::create(dir.join("foto.png")).unwrap();
            f.write_all(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]).unwrap();
            dir
        }

        #[test]
        fn sirve_como_data_uri_una_imagen_de_la_carpeta() {
            let dir = dir_con_imagen();
            let file = dir.join("foto.png").display().to_string();
            let uri = image_data_uri(&dir, &file).unwrap();
            assert!(uri.starts_with("data:image/png;base64,"));
            assert!(uri.contains("iVBORw0KGgo"));
            std::fs::remove_dir_all(&dir).ok();
        }

        #[test]
        fn rechaza_rutas_de_fuera_de_la_carpeta_de_adjuntos() {
            let dir = dir_con_imagen();
            let fuera = std::env::temp_dir().join("hatboo-fuera.png");
            std::fs::write(&fuera, b"x").unwrap();
            // Escapando con .. y también con una ruta absoluta directa.
            assert!(image_data_uri(&dir, "../../hatboo-fuera.png").is_err());
            assert!(image_data_uri(&dir, &fuera.display().to_string()).is_err());
            // Y lo que no existe o no es imagen.
            assert!(image_data_uri(&dir, "no-existe.png").is_err());
            std::fs::write(dir.join("nota.txt"), b"x").unwrap();
            assert!(image_data_uri(&dir, &dir.join("nota.txt").display().to_string()).is_err());
            std::fs::remove_dir_all(&dir).ok();
            std::fs::remove_file(&fuera).ok();
        }

        #[test]
        fn lo_soltado_reparte_carpetas_y_archivos() {
            // Soltar una carpeta abre un proyecto; soltar un archivo va al mensaje.
            // Si las dos cosas siguen el mismo camino, la segunda contesta un error
            // que no significa nada.
            let raiz = std::env::temp_dir().join(format!("hatboo-soltar-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&raiz).unwrap();
            let archivo = raiz.join("nota.md");
            std::fs::write(&archivo, b"hola").unwrap();

            let repartidas = clasifica_soltadas(vec![
                raiz.display().to_string(),
                archivo.display().to_string(),
            ]);
            assert_eq!(repartidas.carpetas, vec![raiz.display().to_string()]);
            assert_eq!(repartidas.archivos, vec![archivo.display().to_string()]);

            // Una ruta que ya no existe cuenta como archivo, no como carpeta: el
            // lector dirá lo que pasa en vez de abrir un proyecto a medias.
            let ido = clasifica_soltadas(vec![raiz.join("borrado.md").display().to_string()]);
            assert!(ido.carpetas.is_empty() && ido.archivos.len() == 1);

            let _ = std::fs::remove_dir_all(&raiz);
        }

        #[test]
        fn una_carpeta_enorme_no_le_roba_el_presupuesto_a_sus_vecinas() {
            // El fallo real en `Documentos`: 200 notas en la primera subcarpeta
            // bastaban para que el recorrido no llegara a mirar la del lado.
            let raiz = std::env::temp_dir().join(format!("hatboo-busca-{}", uuid::Uuid::new_v4()));
            let vault = raiz.join("aaa-vault");
            let facturas = raiz.join("b-facturas");
            std::fs::create_dir_all(&vault).unwrap();
            std::fs::create_dir_all(&facturas).unwrap();
            for i in 0..200 {
                std::fs::write(vault.join(format!("nota-{i}.md")), b"x").unwrap();
            }
            std::fs::write(facturas.join("factura-2026.pdf"), b"x").unwrap();

            let hits = buscar_por_niveles(
                &raiz,
                &raiz,
                "factura",
                &Presupuesto {
                    total: 40,
                    por_carpeta: 5,
                },
                &crate::agent::ignore::por_defecto(),
            );
            assert_eq!(hits, vec!["b-facturas/factura-2026.pdf".to_string()]);

            // Y lo que se salta a propósito no vuelve: el presupuesto se nota.
            assert!(buscar_por_niveles(
                &raiz,
                &raiz,
                "nota-199",
                &Presupuesto {
                    total: 40,
                    por_carpeta: 5,
                },
                &crate::agent::ignore::por_defecto()
            )
            .is_empty());
            std::fs::remove_dir_all(&raiz).ok();
        }

        #[test]
        fn buscar_aqui_sale_en_relativo_a_la_raiz_del_proyecto() {
            // «Buscar aquí» recorta el recorrido a la subcarpeta, pero lo que devuelve
            // tiene que seguir siendo relativo a la raíz del proyecto: la vista previa
            // y el «añadir al mensaje» reciben eso, y una ruta relativa a la subcarpeta
            // se abriría en el sitio equivocado (o no se abriría).
            let raiz = std::env::temp_dir().join(format!("hatboo-aqui-{}", uuid::Uuid::new_v4()));
            let dentro = raiz.join("papel/2026");
            std::fs::create_dir_all(&dentro).unwrap();
            std::fs::create_dir_all(raiz.join("otro")).unwrap();
            std::fs::write(dentro.join("factura.pdf"), b"x").unwrap();
            std::fs::write(raiz.join("otro/factura-vieja.pdf"), b"x").unwrap();
            let p = Presupuesto {
                total: 500,
                por_carpeta: 100,
            };
            let sin_recorte = buscar_por_niveles(&raiz, &raiz, "factura", &p, &[]);
            assert_eq!(sin_recorte.len(), 2);

            let aqui = buscar_por_niveles(&raiz, &dentro, "factura", &p, &[]);
            assert_eq!(aqui, vec!["papel/2026/factura.pdf".to_string()]);
            std::fs::remove_dir_all(&raiz).ok();
        }

        #[test]
        fn el_buscador_del_arbol_se_salt_lo_que_salta_el_rbol() {
            // La regla del plan: árbol, búsqueda y `list_dir` usan UNA lista. Antes el
            // buscador tenía la suya y el árbol ninguna, así que `node_modules` se veía
            // y no se encontraba (o al revés según la carpeta).
            let raiz = std::env::temp_dir().join(format!("hatboo-ignoradas-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(raiz.join("node_modules")).unwrap();
            std::fs::create_dir_all(raiz.join("papel")).unwrap();
            std::fs::write(raiz.join("node_modules/factura.js"), b"x").unwrap();
            std::fs::write(raiz.join("papel/factura.txt"), b"x").unwrap();
            let p = Presupuesto {
                total: 500,
                por_carpeta: 100,
            };

            let con_lista =
                buscar_por_niveles(&raiz, &raiz, "factura", &p, &crate::agent::ignore::por_defecto());
            assert_eq!(con_lista, vec!["papel/factura.txt".to_string()]);

            // Y una carpeta propia que él añada en Ajustes se salta igual; `dist` no
            // está en la lista vacía, así que aparece.
            let sin_lista = buscar_por_niveles(&raiz, &raiz, "factura", &p, &[]);
            assert_eq!(sin_lista.len(), 2);
            let solo_dist = buscar_por_niveles(&raiz, &raiz, "factura", &p, &["dist".to_string()]);
            assert_eq!(solo_dist.len(), 2);
            std::fs::remove_dir_all(&raiz).ok();
        }

        #[test]
        fn la_vista_previa_corta_y_no_muerde_binarios() {
            let dir = std::env::temp_dir().join(format!(
                "hatboo-previa-{}-{}",
                std::process::id(),
                std::time::UNIX_EPOCH
                    .elapsed()
                    .map(|d| d.subsec_nanos())
                    .unwrap_or(0)
            ));
            std::fs::create_dir_all(&dir).unwrap();

            let grande = dir.join("grande.txt");
            let mut f = std::fs::File::create(&grande).unwrap();
            f.write_all(&vec![b'x'; PREVIEW_MAX_BYTES + 10]).unwrap();
            drop(f);
            let v = leer_vista_previa(&grande).unwrap();
            assert!(v.truncado, "un archivo mayor que el tope debe decirlo");
            assert_eq!(v.texto.len(), PREVIEW_MAX_BYTES);
            assert_eq!(v.bytes as usize, PREVIEW_MAX_BYTES + 10);
            assert_eq!(v.lineas, 1);

            let corto = dir.join("corto.txt");
            std::fs::write(&corto, "uno\ndos\n").unwrap();
            let c = leer_vista_previa(&corto).unwrap();
            assert!(!c.truncado);
            assert_eq!(c.lineas, 2);
            assert_eq!(c.bytes, 8);

            let binario = dir.join("foto.bin");
            std::fs::write(&binario, [0xFF_u8, 0x00, 0x10]).unwrap();
            assert!(leer_vista_previa(&binario).is_err());

            std::fs::remove_dir_all(&dir).ok();
        }
}
