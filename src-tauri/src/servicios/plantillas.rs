//! Lo que una plantilla necesita en disco: leer el `.md` que el usuario eligió
//! para instalar y escribir el `.md` al exportar.
//!
//! Es el dominio de `commands/plantillas.rs`, y el comando lo sigue siendo todo
//! (el `parse_skill_markdown`, el techo de tamaño, el nombre por el que se
//! actualiza en vez de duplicar). Aquí solo está el `std::fs`, para que la capa
//! IPC no toque el disco.
//!
//! El **orden de comprobación no cambia**: primero se decide qué archivo es (si
//! llegó una carpeta, se prueban los tres nombres de siempre en ese orden), luego
//! se lee, y el tope de tamaño y el «no trae instrucciones» los dice el comando
//! con sus literales de siempre. Los tres mensajes propios de este módulo —el de la
//! carpeta sin archivo, el de lectura con el nombre del archivo y el de escritura
//! con la ruta— se conservan palabra por palabra.

use std::path::{Path, PathBuf};

/// Los nombres que se prueban dentro de una carpeta de plantilla, en este orden:
/// `SKILL.md` es el del ecosistema, `skill.md` el de quien lo escribe en minúsculas
/// y `README.md` el de quien comparte la plantilla como readme.
const NOMBRES_DE_INSTALACION: [&str; 3] = ["SKILL.md", "skill.md", "README.md"];

/// El archivo de plantilla que hay detrás de la ruta que eligió el usuario: él
/// mismo si señaló un `.md`, o el primero de los tres nombres de siempre si señaló
/// la carpeta que lo contiene (`mi-plantilla/SKILL.md`, que es como se comparten).
pub fn archivo_de_instalacion(ruta: &Path) -> Result<PathBuf, String> {
    if ruta.is_dir() {
        NOMBRES_DE_INSTALACION
            .iter()
            .map(|n| ruta.join(n))
            .find(|p| p.is_file())
            .ok_or_else(|| "La carpeta no tiene un SKILL.md ni un README.md.".to_string())
    } else {
        Ok(ruta.to_path_buf())
    }
}

/// El crudo del archivo elegido. El tope de tamaño lo decide el comando: no es un
/// asunto del disco, sino de cuánto cabe en una plantilla.
pub fn leer_crudo(archivo: &Path) -> Result<String, String> {
    std::fs::read_to_string(archivo)
        .map_err(|e| format!("No se pudo leer «{}»: {e}", archivo.display()))
}

/// Devuelve una plantilla a un archivo `.md` para poder compartirla o
/// versionarla. El texto ya viene armado por el comando, que es quien sabe qué
/// forma tiene que salir para que se vuelva a instalar tal cual.
pub fn escribir_markdown(path: &str, lineas: &str) -> Result<(), String> {
    std::fs::write(PathBuf::from(path), lineas)
        .map_err(|e| format!("No se pudo escribir «{path}»: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_de_prueba(etiqueta: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "hatboo-plantilla-{etiqueta}-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(dir.join("mi-plantilla")).unwrap();
        dir
    }

    #[test]
    fn una_carpeta_se_resuelve_por_los_tres_nombres_y_en_orden() {
        let base = base_de_prueba("orden");
        let carpeta = base.join("mi-plantilla");
        // Sin ningún archivo, el mensaje es el de siempre.
        assert_eq!(
            archivo_de_instalacion(&carpeta).unwrap_err(),
            "La carpeta no tiene un SKILL.md ni un README.md."
        );
        // `README.md` vale, pero `SKILL.md` manda: así la que se instala es la que
        // el autor escribió para el agente, no la carta de presentación.
        std::fs::write(carpeta.join("README.md"), "readme").unwrap();
        assert_eq!(archivo_de_instalacion(&carpeta).unwrap(), carpeta.join("README.md"));
        std::fs::write(carpeta.join("SKILL.md"), "skill").unwrap();
        assert_eq!(archivo_de_instalacion(&carpeta).unwrap(), carpeta.join("SKILL.md"));
        // Una ruta que no es carpeta se pasa tal cual, exista o no: el error lo
        // dice entonces la lectura, con el nombre del archivo.
        let suelta = base.join("Nota.md");
        assert_eq!(archivo_de_instalacion(&suelta).unwrap(), suelta);
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn leer_y_escribir_conservan_sus_mensajes() {
        let base = base_de_prueba("mensajes");
        // El fallo de lectura cita el archivo, que es lo que hace útil el mensaje.
        let ido = base.join("no-esta.md");
        let e = leer_crudo(&ido).unwrap_err();
        assert!(e.starts_with(&format!("No se pudo leer «{}»: ", ido.display())), "{e}");

        let destino = base.join("salida.md");
        escribir_markdown(&destino.display().to_string(), "---\nname: x\n---\n\n").unwrap();
        assert_eq!(
            leer_crudo(&destino).unwrap(),
            "---\nname: x\n---\n\n"
        );
        std::fs::remove_dir_all(&base).ok();
    }
}
