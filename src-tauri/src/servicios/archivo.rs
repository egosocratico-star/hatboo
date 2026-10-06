//! El disco que miran la puerta del «+», el árbol del proyecto y su buscador.
//!
//! Era `commands/files.rs` entero: nueve llamadas a `std::fs` dentro de la capa
//! IPC. Ahora el comando se queda con lo que es suyo —recibir el `invoke`, sacar
//! la raíz del proyecto de la base de datos con **un solo** lock y devolver la
//! forma que pide el frente— y aquí está lo que es del mundo: canonicalizar,
//! validar contra la raíz, recorrer, leer y escribir.
//!
//! [`crate::servicios::captura`] es el precedente de forma: la función recibe la
//! carpeta de destino y devuelve la ruta escrita, con sus mensajes de error
//! exactos. Dos de esos mensajes los comprueba la interfaz y ninguno cambia de
//! texto al mudarse:
//!
//! - «La ruta queda fuera del proyecto.» y «Ese archivo ya no existe.», que son el
//!   candado de rutas del agente también aquí;
//! - «Ese archivo no está en la carpeta de adjuntos de Hatboo.», que es lo que
//!   impide que un `image_file` ajeno —los que trae una copia importada— saque
//!   bytes de fuera de `attachments/`.
//!
//! El sandbox no se afloja: `list_project_dir`, `preview_project_file` y
//! `search_project_files` siguen validando contra la raíz del proyecto con
//! [`crate::agent::tools::resolve_in_project`], la misma función que usan las
//! tools del agente, y `image_data_uri` sigue exigiendo que la ruta canonicalizada
//! empiece por la carpeta de adjuntos antes de leerla.

use crate::commands::_comunes::ATTACHMENT_MAX_BYTES;
use crate::db;
use crate::servicios::{adjuntos, captura::IMAGE_MAX_BYTES};
use serde::Serialize;
use std::path::{Path, PathBuf};

/// Las extensiones que el «+» trata como imagen y manda al payload de visión.
/// `bmp` e `ico` se leen pero no se guardan: lo que no está en la lista de
/// `guardar_imagen` se rechaza con su mensaje de siempre.
const ATTACHMENT_IMAGE_EXTS: [&str; 7] =
    ["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico"];

/// Cuánto se lee para la vista previa del panel de archivos. No es el tope de un
/// adjunto: aquí solo hay que ver de qué va el archivo, y 64 KB ya son más de mil
/// líneas en pantalla.
pub const PREVIEW_MAX_BYTES: usize = 64_000;

/// Tamaño y fecha de un archivo del proyecto, para la tarjeta que sale bajo la
/// respuesta que lo escribió. La ruta llega RELATIVA y se valida contra la raíz
/// del proyecto como cualquier otra ruta del agente: un «../» que salga fuera
/// se rechaza sin tocar disco.
#[derive(Debug, serde::Serialize)]
pub struct FileMeta {
    pub size: i64,
    pub mtime: i64,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VistaPrevia {
    pub texto: String,
    /// Tamaño real del archivo, no lo que se llegó a leer.
    pub bytes: u64,
    pub lineas: usize,
    pub truncado: bool,
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

/// Tamaño y mtime (en milisegundos desde el epoch, 0 si el sistema no los da) de un
/// archivo dentro del proyecto. Ver [`FileMeta`].
pub fn file_meta(raiz: &Path, ruta: &str) -> Result<FileMeta, String> {
    let canon = raiz.canonicalize().map_err(|e| e.to_string())?;
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

/// Lee un archivo elegido por el usuario para adjuntarlo a un mensaje. Es la
/// puerta única del «+»: una imagen se guarda y se referencia como payload de
/// visión; lo demás se lee como texto, con truncado para no comerse la ventana de
/// contexto. Antes había dos opciones en el menú y dos comandos para lo mismo.
pub fn read_attachment(
    attachments: &Path,
    path: &str,
) -> Result<db::Attachment, String> {
    let canonical = Path::new(path)
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
        return guardar_imagen(attachments, &canonical);
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

/// Guarda una imagen en `data_dir/attachments` y devuelve la referencia (no el
/// binario) para adjuntarla al mensaje. Es el ramo de imagen de `read_attachment`:
/// tenerlo en una función es lo que permite que un solo «+» acepte cualquier
/// archivo. Solo formatos de visión comunes y tamaño acotado; el base64 se
/// genera al construir el payload.
pub fn guardar_imagen(
    attachments: &Path,
    canonical: &Path,
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
    adjuntos::prepara_carpeta(attachments)?;
    let dest = adjuntos::escribe(attachments, &format!("{}.{}", uuid::Uuid::new_v4(), ext), &bytes)
        .map_err(|e| format!("No se pudo guardar la imagen: {e}"))?;
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

/// El nombre que el frente usa para distinguir carpetas de archivos al soltar.
pub fn clasifica_soltadas(paths: Vec<String>) -> Soltadas {
    let mut carpetas = Vec::new();
    let mut archivos = Vec::new();
    for p in paths {
        if Path::new(&p).is_dir() {
            carpetas.push(p);
        } else {
            archivos.push(p);
        }
    }
    Soltadas { carpetas, archivos }
}

/// Devuelve una imagen adjunta como data URI para poder pintarla en la burbuja.
/// La ruta llega desde la BD —y tras una importación ese JSON es ajeno—, así que
/// se canonicaliza y se exige que siga dentro de `attachments/` antes de leer.
pub fn image_data_uri(attachments_dir: &Path, file: &str) -> Result<String, String> {
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

/// Lista un nivel del árbol de archivos del proyecto (ruta relativa; "" = raíz).
///
/// Se saltan las carpetas de `ignoradas`, la MISMA lista que usan `list_dir` y
/// `search_files` del agente: si el panel las enseña, el agente las ve, y si no,
/// tampoco las busca. Con `Documentos` como raíz era lo que más se notaba.
pub fn list_project_dir(
    raiz: &Path,
    relative_path: &str,
    ignoradas: &[String],
) -> Result<Vec<FileEntry>, String> {
    let resolved = crate::agent::tools::resolve_in_project(raiz, relative_path)
        .map_err(|e| e.to_string())?;
    let entries = std::fs::read_dir(&resolved).map_err(|e| e.to_string())?;
    // La raíz se recorta ya canonicalizada. `resolve_in_project` canónica la del
    // proyecto, y si aquí se recorta contra la cadena tal como está en la base de
    // datos —otra letra, otro separador, uno de esos caminos redirigidos por
    // OneDrive— el recorte no acierta y el supuesto «relativo» sale ABSOLUTO. El
    // frontend lo devuelve al mismo comando, ese lo rechaza con razón por
    // seguridad, y el resultado es un árbol de carpetas que no enseñan nada.
    let raiz = raiz.canonicalize().unwrap_or_else(|_| raiz.to_path_buf());
    let mut out: Vec<FileEntry> = entries
        .flatten()
        .filter(|e| {
            let es_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
            !es_dir || !crate::agent::ignore::ignora(&e.file_name().to_string_lossy(), ignoradas)
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

/// El texto de un archivo del proyecto para verlo en el panel, sin añadirlo al
/// mensaje. Pasa por el mismo candado de rutas que las herramientas del agente.
pub fn preview_project_file(raiz: &Path, relative_path: &str) -> Result<VistaPrevia, String> {
    let resuelta = crate::agent::tools::resolve_in_project(raiz, relative_path)
        .map_err(|e| e.to_string())?;
    leer_vista_previa(&resuelta)
}

/// La lectura cruda de la vista previa, sin candado: quien llama ya resolvió la
/// ruta contra la raíz del proyecto.
///
/// Vive aparte del comando, y ahora también aparte de `preview_project_file`, por
/// la misma razón de siempre: se puede probar con un archivo temporal.
pub fn leer_vista_previa(ruta: &Path) -> Result<VistaPrevia, String> {
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
///
/// Es sincrónica porque el comando la mete en un hilo de bloqueo: el recorrido
/// puede tocar decenas de miles de entradas y el runtime de Tauri no puede
/// pararse ahí.
pub fn search_project_files(
    raiz: &Path,
    query: &str,
    dentro: Option<&str>,
    ignoradas: &[String],
) -> Result<Vec<String>, String> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Ok(Vec::new());
    }
    let proyecto = raiz.canonicalize().unwrap_or_else(|_| raiz.to_path_buf());
    let donde = match dentro.map(str::trim).filter(|d| !d.is_empty()) {
        Some(d) => crate::agent::tools::resolve_in_project(&proyecto, d)
            .map_err(|e| e.to_string())?,
        None => proyecto.clone(),
    };
    if !donde.is_dir() {
        return Err("Esa carpeta ya no existe.".into());
    }
    Ok(buscar_por_niveles(
        &proyecto,
        &donde,
        &needle,
        &Presupuesto {
            total: 20_000,
            por_carpeta: 500,
        },
        ignoradas,
    ))
}

/// Cuánto se mira antes de rendirse. Va aparte del recorrido para poder
/// comprobarlo con carpetas de prueba pequeñas.
pub struct Presupuesto {
    pub total: usize,
    pub por_carpeta: usize,
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
pub fn buscar_por_niveles(
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

    fn dir_de_prueba(etiqueta: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "hatboo-archivo-{etiqueta}-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(dir.join("papel")).unwrap();
        dir
    }

    /// El candado de `file_meta`, que es el del agente: la ruta la escribió el
    /// modelo y un `../` que salga fuera se rechaza **sin devolver datos del
    /// archivo de fuera**. Está aquí y no solo en el comando porque el comando
    /// necesita `AppState` y la raíz; la comprobación es de esta función.
    #[test]
    fn file_meta_no_saca_bytes_de_fuera_del_proyecto() {
        let base = dir_de_prueba("meta");
        let proyecto = base.join("proyecto");
        std::fs::create_dir_all(&proyecto).unwrap();
        std::fs::write(proyecto.join("dentro.txt"), "12345").unwrap();
        // Un hermano del proyecto, o sea: fuera de la raíz.
        std::fs::write(base.join("fuera.txt"), "secreto").unwrap();

        let md = file_meta(&proyecto, "dentro.txt").unwrap();
        assert_eq!(md.size, 5);

        let e = file_meta(&proyecto, "../fuera.txt").unwrap_err();
        assert_eq!(e, "La ruta queda fuera del proyecto.");
        // Lo que ya no está dice lo de siempre, y no un error de canonicalizar.
        assert_eq!(file_meta(&proyecto, "ido.txt").unwrap_err(), "Ese archivo ya no existe.");

        std::fs::remove_dir_all(&base).ok();
    }

    /// La otra mitad del candado del árbol: lo que sale es RELATIVO a la raíz
    /// canonicalizada, porque el frontend se lo devuelve al mismo comando y ese lo
    /// rechaza si viene absoluto.
    #[test]
    fn el_arbol_devuelve_rutas_relativas_y_salta_lo_ignorado() {
        let proyecto = dir_de_prueba("arbol");
        std::fs::write(proyecto.join("b-notas.md"), "hola").unwrap();
        std::fs::write(proyecto.join("a-leeme.txt"), "hola").unwrap();
        std::fs::create_dir_all(proyecto.join("node_modules")).unwrap();
        std::fs::write(proyecto.join("papel/factura.pdf"), "hola").unwrap();

        let niveles = list_project_dir(&proyecto, "", &crate::agent::ignore::por_defecto()).unwrap();
        // Las carpetas primero y, dentro, por nombre sin mayúsculas.
        let nombres: Vec<&str> = niveles.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(nombres, vec!["papel", "a-leeme.txt", "b-notas.md"]);
        assert!(niveles.iter().all(|e| !e.path.contains(':')));
        assert_eq!(niveles.iter().find(|e| e.name == "papel").unwrap().path, "papel");
        // Una carpeta de la lista no se enseña, y su peso es 0.
        assert_eq!(niveles.iter().find(|e| e.name == "a-leeme.txt").unwrap().size, 4);
        assert!(!nombres.contains(&"node_modules"));

        // Un nivel por dentro sigue saliendo relativo a la RAÍZ, no a la carpeta.
        let dentro = list_project_dir(&proyecto, "papel", &[]).unwrap();
        assert_eq!(dentro[0].path, "papel/factura.pdf");
        std::fs::remove_dir_all(&proyecto).ok();
    }

    /// El tope de 4 MB y el formato soportado, que son las dos validaciones de la
    /// puerta del «+» y no estaban atadas a ninguna prueba. Se aflojarlas sería
    /// invisible desde el resto de la batería: el proveedor de visión cobra por los
    /// píxeles que no caben, y un `bmp` aceptado aquí llegaría al hilo como `png`.
    /// El tope de 4 MB y el formato soportado: las dos validaciones de la puerta del
    /// «+», que hasta aquí no estaban atadas a ninguna prueba. Aflojarlas sería
    /// invisible desde el resto de la batería —el proveedor de visión cobra por los
    /// píxeles que no caben, y un `bmp` aceptado se colaría en el hilo como `png`—,
    /// así que viajan mudadas y con su prueba encima.
    #[test]
    fn guardar_imagen_mide_el_peso_y_el_formato_antes_de_escribir() {
        // La carpeta de destino y la de los archivos elegidos van aparte: lo que
        // hay que contar es cuántos archivos **escribió Hatboo**, y `dir_de_prueba`
        // ya trae una subcarpeta dentro.
        let destino = dir_de_prueba("imagen");
        let elegidos = std::env::temp_dir().join(format!("hatboo-elegida-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&elegidos).unwrap();
        let write = |nombre: &str, bytes: &[u8]| {
            let p = elegidos.join(nombre);
            std::fs::write(&p, bytes).unwrap();
            p
        };

        // Un PNG de 5 MB: rechazado con el mensaje que ve el usuario, y **no se
        // escribe** — si se escribiera antes de medir, el rechazo dejaría basura.
        let pesado = write("gorda.png", &vec![b'p'; IMAGE_MAX_BYTES + 1]);
        let e = guardar_imagen(&destino, &pesado).unwrap_err();
        assert!(e.ends_with("MB; el máximo es 4 MB."), "{e}");
        assert_eq!(std::fs::read_dir(&destino).unwrap().count(), 1, "el rechazo no deja archivo");

        // Un `bmp` sí está en la lista de extensiones que el «+» trata como imagen,
        // pero no en la de formatos de visión: lo dice con el literal de siempre.
        let bmp = write("viejo.bmp", b"xx");
        assert_eq!(
            guardar_imagen(&destino, &bmp).unwrap_err(),
            "Formato de imagen no soportado. Usa PNG, JPG, GIF o WEBP."
        );
        assert_eq!(std::fs::read_dir(&destino).unwrap().count(), 1, "ni ese deja archivo");

        // Lo que sí cabe y sí es de visión se guarda con su `media_type`.
        let ok = write("fina.jpg", b"jpeg-bytes");
        let adj = guardar_imagen(&destino, &ok).unwrap();
        assert_eq!(adj.image_media_type.as_deref(), Some("image/jpeg"));
        assert_eq!(adj.name, "fina.jpg");
        // El nombre del archivo en disco es uuid, no `fina.jpg`: dos adjuntos con el
        // mismo nombre no pueden pisarse.
        assert_ne!(
            Path::new(adj.image_file.as_ref().unwrap()).file_name().unwrap(),
            "fina.jpg"
        );
        assert_eq!(std::fs::read_dir(&destino).unwrap().count(), 2);

        std::fs::remove_dir_all(&destino).ok();
        std::fs::remove_dir_all(&elegidos).ok();
    }

    /// La otra mitad del «+»: lo que no es imagen se lee como texto, con el truncado
    /// de siempre y sin colarse un binario disfrazado.
    #[test]
    fn un_texto_largo_se_trunca_y_un_binario_se_rechaza() {
        let dir = dir_de_prueba("texto");
        let corte = "\n\n[... el archivo se truncó por tamaño ...]";
        let largo = dir.join("largo.txt");
        std::fs::write(&largo, vec![b'a'; ATTACHMENT_MAX_BYTES + 10]).unwrap();
        let adj = read_attachment(&dir, &largo.display().to_string()).unwrap();
        assert!(adj.text.ends_with(corte));
        assert_eq!(adj.text.len(), ATTACHMENT_MAX_BYTES + corte.len());

        let bin = dir.join("disfraz.txt");
        std::fs::write(&bin, [b'o', 0x00, b'k']).unwrap();
        let e = read_attachment(&dir, &bin.display().to_string()).unwrap_err();
        assert_eq!(e, "«disfraz.txt» parece un archivo binario y no se puede adjuntar como texto.");

        // La puerta del «+» tampoco deja una ruta que no es archivo.
        assert_eq!(
            read_attachment(&dir, &dir.display().to_string()).unwrap_err(),
            "La ruta seleccionada no es un archivo."
        );
        assert_eq!(
            read_attachment(&dir, &dir.join("ido.txt").display().to_string()).unwrap_err(),
            "No se encontró el archivo."
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    /// El candado de las dos entradas del panel de archivos, probado **en las
    /// entradas** y no solo en `resolve_in_project` (que es `tests/tools.rs`). El
    /// sandbox está atado a la firma que llama el frontend: si alguien afloja una de
    /// las dos llamadas, el árbol o la vista previa enseñan la carpeta del lado, y
    /// eso no lo va a descubrir ninguna otra prueba.
    #[test]
    fn el_arbol_y_la_vista_previa_no_salen_del_proyecto() {
        let base = dir_de_prueba("sandbox");
        let proyecto = base.join("proyecto");
        std::fs::create_dir_all(&proyecto).unwrap();
        std::fs::write(base.join("vecina.txt"), "de fuera").unwrap();
        std::fs::create_dir_all(base.join("fuera")).unwrap();

        // El árbol: `../` no le devuelve ni una entrada de la carpeta del lado.
        let e = list_project_dir(&proyecto, "../", &[]).unwrap_err();
        assert!(e.contains("fuera del proyecto"), "{e}");
        // Y la vista previa, con el mismo candado y el mismo resultado. El literal lo
        // dice `ToolError::PathEscape`, que es el candado del agente: aquí no se
        // traduce, se pasa tal cual.
        let p = preview_project_file(&proyecto, "../vecina.txt").unwrap_err();
        assert!(p.contains("fuera del proyecto"), "{p}");
        // Lo que sí es del proyecto se abre.
        std::fs::write(proyecto.join("dentro.txt"), "mío").unwrap();
        assert_eq!(preview_project_file(&proyecto, "dentro.txt").unwrap().texto, "mío");

        // El buscador con `dentro` escapado: la validación viaja dentro del
        // recorrido, no delante, así que también la rechaza.
        let b = search_project_files(&proyecto, "vecina", Some("../fuera"), &[]).unwrap_err();
        assert!(b.contains("fuera del proyecto"), "{b}");
        // Y no se lleva por delante el caso normal: buscar en una subcarpeta propia
        // sí recorre y sí devuelve relativo a la raíz.
        std::fs::create_dir_all(proyecto.join("src")).unwrap();
        std::fs::write(proyecto.join("src/vecina.rs"), b"x").unwrap();
        assert_eq!(
            search_project_files(&proyecto, "vecina", Some("src"), &[]).unwrap(),
            vec!["src/vecina.rs".to_string()]
        );
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn buscar_dentro_de_una_carpeta_que_no_esta_lo_dice() {
        let proyecto = dir_de_prueba("buscar");
        // Con la búsqueda ya fuera del comando se puede probar el criterio entero.
        assert_eq!(
            search_project_files(&proyecto, "nota", Some("ido"), &[]).unwrap_err(),
            "Esa carpeta ya no existe."
        );
        // Y una consulta en blanco no recorre nada: devuelve vacío, sin error.
        assert!(search_project_files(&proyecto, "  ", None, &[]).unwrap().is_empty());
        // Lo que sí existe, en relativo a la raíz.
        std::fs::write(proyecto.join("papel/nota.md"), b"x").unwrap();
        assert_eq!(
            search_project_files(&proyecto, "nota", Some("papel"), &[]).unwrap(),
            vec!["papel/nota.md".to_string()]
        );
        std::fs::remove_dir_all(&proyecto).ok();
    }
}
