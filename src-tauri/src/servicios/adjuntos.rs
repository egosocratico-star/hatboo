//! El ciclo de vida de la carpeta `attachments/`: lo que se escribe, lo que se
//! copia al ramificar, lo que se vuelve a leer para enseñarlo y lo que se borra.
//!
//! [`crate::servicios::captura`] fue el precedente: la capa IPC dice **dónde**
//! tiene que caer el archivo —su `data_dir`— y aquí dentro está el
//! `create_dir_all` + `write` que cada comando escribía a mano. Tres lo hacían
//! (`read_attachment` con la imagen elegida, `generate_image` con la dibujada y
//! `speak_message` con el audio) y los tres decían «No se pudo crear la carpeta:
//! …»; al escribir, en cambio, cada uno usaba su propio literal, y esos tres
//! literales se conservan uno por uno.
//!
//! Las rutas que llegan del frente no se fían: la de un adjunto y la de un audio
//! se canonicalizan y se exige que sigan dentro de la carpeta antes de leerlas,
//! igual que cuando la comprobación vivía dentro del comando.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Borra del disco las imágenes referenciadas (ignora errores: pueden faltar).
///
/// Estaba en `commands/_comunes.rs` porque lo llaman tres dominios —`chat` al
/// borrar o limpiar una conversación, `models` al reintentar un dibujo y
/// `projects` al borrar un proyecto—, pero el criterio es de esta carpeta: son
/// sus archivos yendo fuera.
pub fn remove_image_files(paths: Vec<String>) {
    for p in paths {
        let _ = std::fs::remove_file(p);
    }
}

/// Asegura la carpeta de adjuntos antes de escribir en ella. Los tres comandos
/// decían exactamente lo mismo, así que esta vez sí queda en una sola cadena.
pub fn prepara_carpeta(dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("No se pudo crear la carpeta: {e}"))
}

/// Escribe `bytes` como `dir/nombre` y devuelve la ruta escrita.
///
/// El error de entrada se devuelve **crudo** a propósito: los tres llamadores lo
/// vestían con literales distintos —`No se pudo guardar la imagen:`,
/// `No se pudo guardar:`, `No se pudo guardar el audio:`— y ninguno de los tres
/// cambia de texto por mudar de archivo.
pub fn escribe(dir: &Path, nombre: &str, bytes: &[u8]) -> Result<PathBuf, std::io::Error> {
    let destino = dir.join(nombre);
    std::fs::write(&destino, bytes)?;
    Ok(destino)
}

/// La extensión con la que se guarda una imagen según el `media_type` que devolvió
/// el motor. Es la de siempre, incluida la caída a `png` para lo no reconocido.
pub fn extension_de_imagen(media_type: &str) -> &'static str {
    match media_type {
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        _ => "png",
    }
}

/// Guarda en `attachments/` la imagen que devolvió el motor de dibujo con un
/// nombre nuevo (uuid), que es lo que impide que dos reintentos se pisen.
///
/// Devuelve la ruta escrita y la extensión: el comando la necesita para nombrar
/// el adjunto que entra en el hilo, y ese nombre se construye con el prompt.
pub fn guarda_imagen_generada(
    dir: &Path,
    bytes: &[u8],
    media_type: &str,
) -> Result<(PathBuf, &'static str), String> {
    let ext = extension_de_imagen(media_type);
    prepara_carpeta(dir)?;
    let ruta = escribe(dir, &format!("{}.{}", uuid::Uuid::new_v4(), ext), bytes)
        .map_err(|e| format!("No se pudo guardar: {e}"))?;
    Ok((ruta, ext))
}

/// Guarda el audio sintetizado como `attachments/voz-<id del mensaje>.mp3`. El
/// nombre es la caché: al segundo clic no se vuelve a llamar al motor, que cobrar
/// dos veces por escuchar lo mismo no tiene defensa.
pub fn guarda_audio(dir: &Path, message_id: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    prepara_carpeta(dir)?;
    escribe(dir, &format!("voz-{message_id}.mp3"), bytes)
        .map_err(|e| format!("No se pudo guardar el audio: {e}"))
}

/// La voz ya sintetizada de ese mensaje, si está en disco.
pub fn audio_en_cache(dir: &Path, message_id: &str) -> Option<PathBuf> {
    let cached = dir.join(format!("voz-{message_id}.mp3"));
    cached.is_file().then_some(cached)
}

/// Devuelve un audio de `attachments/` como data URI. Mismo candado que las
/// imágenes: la ruta se canonicaliza y tiene que seguir dentro de la carpeta de
/// Hatboo antes de leerla.
pub fn audio_data_uri(attachments_dir: &Path, file: &str) -> Result<String, String> {
    use base64::{engine::general_purpose, Engine as _};
    let root = attachments_dir
        .canonicalize()
        .map_err(|_| "La carpeta de adjuntos no existe.".to_string())?;
    let path = Path::new(file)
        .canonicalize()
        .map_err(|_| "El audio ya no está disponible.".to_string())?;
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
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "aac" => "audio/aac",
        "flac" => "audio/flac",
        _ => return Err("Formato de audio no soportado.".into()),
    };
    let bytes = std::fs::read(&path).map_err(|e| format!("No se pudo leer: {e}"))?;
    Ok(format!(
        "data:{media_type};base64,{}",
        general_purpose::STANDARD.encode(&bytes)
    ))
}

/// Copia las imágenes que entran en la rama a archivos nuevos. Si la rama
/// apuntara a los mismos ficheros, borrar una de las dos conversaciones se
/// llevaría las imágenes de la otra (`delete_conversation` limpia disco).
///
/// Devuelve el mapa `viejo -> nuevo` con el que `db::branch_conversation`
/// reescribe el JSON del hilo. Una imagen repetida se copia una sola vez, y el
/// nombre nuevo es uuid con la extensión de la vieja.
pub fn copia_imagenes_de_rama(
    dir: &Path,
    imagenes: &[String],
) -> Result<HashMap<String, String>, String> {
    let mut renombre: HashMap<String, String> = HashMap::new();
    for viejo in imagenes {
        if renombre.contains_key(viejo) {
            continue;
        }
        let destino = format!(
            "{}{}",
            uuid::Uuid::new_v4(),
            std::path::Path::new(viejo)
                .extension()
                .map(|e| format!(".{}", e.to_string_lossy()))
                .unwrap_or_default()
        );
        std::fs::copy(dir.join(viejo), dir.join(&destino))
            .map_err(|e| format!("No se pudo copiar una imagen de la rama: {e}"))?;
        renombre.insert(viejo.clone(), destino);
    }
    Ok(renombre)
}

/// Vacía la carpeta de adjuntos: es lo que hace el restablecimiento de fábrica.
///
/// Se ignoran los errores —el comando los ignoraba igual—: si una imagen la tiene
/// abierta otro programa, el restablecimiento no puede quedarse a medias por eso.
pub fn vaciar_carpeta(dir: &Path) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Carpeta de adjuntos desechable: las rutas del frente se comprueban contra
    /// ella, así que cada prueba necesita una de verdad en disco.
    fn dir_de_prueba(etiqueta: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hatboo-adj-{etiqueta}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn la_imagen_generada_sale_con_su_extension_y_no_se_pisa() {
        let dir = dir_de_prueba("gen");
        let (a, ext) = guarda_imagen_generada(&dir, b"png-bytes", "image/png").unwrap();
        assert_eq!(ext, "png");
        assert_eq!(a.parent().unwrap(), dir.as_path());
        assert_eq!(a.extension().unwrap(), "png");
        let (b, _) = guarda_imagen_generada(&dir, b"jpg-bytes", "image/jpeg").unwrap();
        assert_eq!(b.extension().unwrap(), "jpg");
        // Dos guardados, dos archivos: el reintento de un dibujo no pisa el anterior.
        assert_ne!(a, b);
        assert!(std::fs::read(&a).unwrap().starts_with(b"png-bytes"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn el_audio_se_cachesa_bajo_el_id_del_mensaje() {
        let dir = dir_de_prueba("voz");
        let ruta = guarda_audio(&dir, "m-1", b"mp3-bytes").unwrap();
        assert_eq!(ruta.file_name().unwrap(), "voz-m-1.mp3");
        assert_eq!(audio_en_cache(&dir, "m-1").as_deref(), Some(ruta.as_path()));
        // Otro mensaje todavía no tiene su voz: si esto mintiera, se escucharía
        // el audio de otra respuesta.
        assert_eq!(audio_en_cache(&dir, "m-2"), None);
        std::fs::remove_dir_all(&dir).ok();
    }

    /// El candado del audio, que es el mismo que ya protegía a las imágenes: una
    /// ruta de fuera, aunque exista, no se lee.
    #[test]
    fn el_audio_de_fuera_de_la_carpeta_no_se_lee() {
        let dir = dir_de_prueba("candado");
        std::fs::write(dir.join("voz-m-3.mp3"), b"x").unwrap();
        let fuera = std::env::temp_dir().join(format!("hatboo-fuera-audio-{}.mp3", uuid::Uuid::new_v4()));
        std::fs::write(&fuera, b"x").unwrap();

        assert!(audio_data_uri(&dir, &fuera.display().to_string()).is_err());
        assert!(audio_data_uri(&dir, "../../x.mp3").is_err());
        assert!(audio_data_uri(&dir, "no-existe.mp3").is_err());
        // Lo que sí está dentro se sirve, y con el tipo de audio correcto.
        let uri = audio_data_uri(&dir, &dir.join("voz-m-3.mp3").display().to_string()).unwrap();
        assert!(uri.starts_with("data:audio/mpeg;base64,"));
        // Y un archivo dentro de la carpeta pero que no es audio, rechazado.
        std::fs::write(dir.join("nota.txt"), b"x").unwrap();
        assert!(audio_data_uri(&dir, &dir.join("nota.txt").display().to_string()).is_err());

        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_file(&fuera).ok();
    }

    #[test]
    fn la_rama_copia_y_deja_la_original_en_su_sitio() {
        let dir = dir_de_prueba("rama");
        std::fs::write(dir.join("foto.png"), b"contenido").unwrap();
        let imagenes = vec!["foto.png".to_string(), "foto.png".to_string()];
        let renombre = copia_imagenes_de_rama(&dir, &imagenes).unwrap();
        // Una imagen repetida se copia una vez: el mapa tiene una entrada.
        assert_eq!(renombre.len(), 1);
        let nuevo = renombre["foto.png"].clone();
        assert_ne!(nuevo, "foto.png");
        assert!(nuevo.ends_with(".png"));
        assert_eq!(std::fs::read(dir.join(&nuevo)).unwrap(), b"contenido");
        // La original sigue ahí: la conversación vieja sigue enseñándola.
        assert!(dir.join("foto.png").is_file());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn copiar_una_que_no_existe_dice_lo_de_siempre() {
        let dir = dir_de_prueba("falta");
        let e = copia_imagenes_de_rama(&dir, &["ido.png".to_string()]).unwrap_err();
        assert!(e.starts_with("No se pudo copiar una imagen de la rama: "), "{e}");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn vaciar_deja_la_carpeta_sin_archivos_y_no_ruina_si_no_la_hay() {
        let dir = dir_de_prueba("vacia");
        std::fs::write(dir.join("a.png"), b"x").unwrap();
        std::fs::write(dir.join("b.mp3"), b"x").unwrap();
        vaciar_carpeta(&dir);
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);
        // La carpeta sigue en pie: el restablecimiento no puede dejar la app sin
        // dónde escribir el primer adjunto de después.
        assert!(dir.is_dir());

        // Una carpeta que no existe no es un error: el comando lo ignoraba igual.
        let ido = dir.join("no-hay-nada-aqui");
        vaciar_carpeta(&ido);
        assert!(!ido.exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn borrar_imagenes_que_ya_no_estan_no_lanza() {
        let dir = dir_de_prueba("borra");
        remove_image_files(vec![dir.join("fantasma.png").display().to_string()]);
        std::fs::write(dir.join("real.png"), b"x").unwrap();
        remove_image_files(vec![dir.join("real.png").display().to_string()]);
        assert!(!dir.join("real.png").exists());
        std::fs::remove_dir_all(&dir).ok();
    }
}
