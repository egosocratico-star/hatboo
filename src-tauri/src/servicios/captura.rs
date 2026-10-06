//! La captura de pantalla: `xcap`, el codificador PNG y el `fs::write` que antes
//! estaban dentro del comando `capture_screen`.
//!
//! El comando se queda con lo que es suyo —el `db::Attachment` que recibe el
//! frontend— y aquí está lo que es del mundo: listar monitores, codificar y
//! escribir. La función recibe la carpeta de destino y devuelve la ruta escrita.
//!
//! Los dos errores que ya decía el comando se conservan tal cual, porque la
//! interfaz los muestra sin traducir nada: «No se pudieron listar las pantallas»
//! y «No se encontró ninguna pantalla que capturar.».

use std::path::{Path, PathBuf};

/// Tope de bytes de una imagen adjunta, sea elegida del disco o salida de una
/// captura. Máximo de bytes ANTES de copiar a `data_dir/attachments`.
///
/// Vive aquí porque lo consumen las dos mitades de la puerta del «+»: esta
/// captura y `commands::files::guardar_imagen`. Cuatro megas es lo que el
/// proveedor de visión aguanta en un turno; pasar de ahí es pagar por píxeles
/// que nadie mira.
pub const IMAGE_MAX_BYTES: usize = 4 * 1024 * 1024;

/// Captura la pantalla principal —o la primera que haya, que es el criterio de
/// siempre— y escribe un PNG en `dir_destino`, creando la carpeta si falta.
/// Devuelve la ruta escrita.
///
/// El nombre del archivo lo pone un uuid, no lo que escribió el usuario: sobre la
/// misma carpeta caen las adjuntas del «+», y dos capturas a la misma hora no
/// pueden pisarse. Para eso está [`nombre_de_archivo`], que es solo la etiqueta
/// que se ve en el hilo.
pub fn capturar_pantalla(dir_destino: &Path) -> Result<PathBuf, String> {
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

        std::fs::create_dir_all(dir_destino)
            .map_err(|e| format!("No se pudo crear la carpeta: {e}"))?;
        let destino = dir_destino.join(format!("{}.png", uuid::Uuid::new_v4()));
        std::fs::write(&destino, &png).map_err(|e| format!("No se pudo guardar: {e}"))?;
        Ok(destino)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = dir_destino;
        Err("La captura de pantalla está hecha solo para Windows por ahora.".into())
    }
}

/// La etiqueta que ve el usuario en el hilo. El nombre lo pone el frente (ahí sí
/// hay hora local), pero llega por el wire: sin separadores y con `.png` siempre,
/// que es lo que acabamos de codificar.
pub fn nombre_de_archivo(nombre: &str) -> String {
    let limpio = nombre
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | ':' | '\0'))
        .collect::<String>();
    let base = limpio.trim_end_matches(".png");
    format!("{}.png", if base.is_empty() { "captura" } else { base })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Sin pantalla: lo que se puede probar es la parte que no depende del
    /// monitor. La captura real necesita un escritorio y por eso no está aquí.
    #[test]
    fn el_nombre_lleva_siempre_png_y_ningun_separador() {
        // Una hora local en el nombre: los dos puntos no caben en un archivo.
        assert_eq!(nombre_de_archivo("captura 14:32:10"), "captura 143210.png");
        // Ruta de otra carpeta, con el `.png` ya puesto: no se duplica.
        assert_eq!(
            nombre_de_archivo(r"C:\pantallas\foto.png"),
            "Cpantallasfoto.png"
        );
        // Lo que llega vacío o solo con separadores se nombra solo.
        assert_eq!(nombre_de_archivo(""), "captura.png");
        assert_eq!(nombre_de_archivo("///\\\\:"), "captura.png");
        // Y el cero binario tampoco se cuela.
        assert_eq!(nombre_de_archivo("no\0ta"), "nota.png");
    }

    #[test]
    fn la_captura_no_pesa_mas_que_una_imagen_adjunta() {
        // El techo es el mismo que rige en la puerta del «+»: si se separan, una
        // captura podría entrar donde un archivo elegido a mano se rechaza.
        assert_eq!(IMAGE_MAX_BYTES, 4 * 1024 * 1024);
    }

    /// La otra mitad del módulo —listar monitores, codificar el PNG y escribirlo—
    /// no tiene prueba: necesita un escritorio, y una prueba que llama a
    /// `xcap::Monitor::all()` no es una prueba unitaria. Lo que sí se puede afirmar
    /// sin pantalla es que en las plataformas sin captura la función **no toca
    /// disco**: devuelve el error de siempre.
    #[cfg(not(target_os = "windows"))]
    #[test]
    fn sin_windows_no_se_escribe_nada() {
        let dir = std::env::temp_dir().join(format!("hatboo-sin-captura-{}", uuid::Uuid::new_v4()));
        let e = capturar_pantalla(&dir).unwrap_err();
        assert_eq!(
            e,
            "La captura de pantalla está hecha solo para Windows por ahora."
        );
        assert!(!dir.exists(), "dijo no y además creó la carpeta");
    }
}
