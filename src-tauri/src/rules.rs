//! Trust Gate del `HATBOO.md`: aquí vive el único hash que decide si las reglas
//! de un proyecto entran al *system prompt*.
//!
//! La lectura que inyecta y el comando que aprueba llaman a lo mismo a propósito:
//! si cada una calculera su hash por su cuenta, la pantalla podría declarar
//! «aprobadas» sobre un texto que el modelo no está recibiendo.

use sha2::{Digest, Sha256};
use std::path::Path;

/// SHA-256 en minúsculas y sin separadores: el único formato que cabe en
/// `projects.rules_hash`. Criptográfico porque lo que decide es qué contenido
/// llega al prompt; un hash de resumen rápido se puede colisionar a propósito.
pub fn fingerprint(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Lo que hay en un archivo: su texto y el hash de exactamente esos bytes.
pub struct Archivo {
    pub texto: String,
    pub hash: String,
}

/// Lee la ruta dada. `None` si no existe o no se puede leer: sin bytes no hay
/// nada que aprobar ni que inyectar, y «no hay archivo» no es lo mismo que «hay
/// archivo sin aprobar».
///
/// El hash va sobre los bytes crudos y el texto se decodifica tolerante, así que
/// un `HATBOO.md` con bytes sueltos no tapa la pantalla de reglas pero tampoco se
/// aprueba como si fuera UTF-8 limpio.
pub fn read_file(ruta: &Path) -> Option<Archivo> {
    let bytes = std::fs::read(ruta).ok()?;
    Some(Archivo {
        texto: String::from_utf8_lossy(&bytes).into_owned(),
        hash: fingerprint(&bytes),
    })
}

/// El gate entero, y la única forma de abrirlo: tiene que existir un hash
/// aprobado, tiene que ser exactamente el del archivo de ahora, y el archivo
/// tiene que traer algo. Un `HATBOO.md` vacío aprobado no aporta texto al prompt,
/// y decir «aprobadas» ahí sería prometer algo que no llega.
pub fn applies(aprobado: Option<&str>, archivo: &Archivo) -> bool {
    aprobado == Some(archivo.hash.as_str()) && !archivo.texto.trim().is_empty()
}

/// Lo que recibe el system prompt: `None` con el gate cerrado. Se recorta
/// DESPUÉS de comparar el hash, que es lo que permite aprobar un archivo más
/// largo que el techo del prompt sin que quede para siempre sin aprobar.
pub fn text_for_prompt(
    aprobado: Option<&str>,
    archivo: &Archivo,
    max_chars: usize,
) -> Option<String> {
    applies(aprobado, archivo).then(|| archivo.texto.chars().take(max_chars).collect())
}

/// Nombre del archivo de reglas. Fijo: lo único que viene de fuera es la raíz del
/// proyecto, que la eligió el usuario al abrirla.
pub const ARCHIVO: &str = "HATBOO.md";
/// Techo de lo que se inyecta en el prompt; más allá de esto ya es un libro y el
/// modelo empieza a perder el hilo.
pub const MAX_CHARS: usize = 6_000;

/// Ruta del `HATBOO.md` de un proyecto registrado.
pub fn ruta_de_reglas(p: &crate::db::Project) -> std::path::PathBuf {
    std::path::PathBuf::from(&p.root_path).join(ARCHIVO)
}

/// La fila del proyecto dueño de las reglas: el id que trae la pantalla o la
/// conversación y, si no lo hay, la carpeta registrada que coincida con esta raíz.
pub fn proyecto_dueno(
    conn: &rusqlite::Connection,
    project_id: Option<&str>,
    raiz: &Path,
) -> Option<crate::db::Project> {
    match project_id {
        Some(id) => crate::db::get_project(conn, id).ok(),
        None => crate::db::find_project_by_root(conn, &raiz.to_string_lossy())
            .ok()
            .flatten(),
    }
}

/// Contenido de `HATBOO.md` para el system prompt, **con el gate puesto**. Cadena
/// vacía si no hay proyecto registrado, si no existe el archivo, si nunca se aprobó
/// o si cambió desde la aprobación.
///
/// Esta es la única lectura que inyecta. `ContextService` llama aquí y la pantalla
/// de reglas llama al mismo sitio para enseñar el estado: si cada una calculara su
/// hash por su cuenta, la interfaz podría declarar «aprobadas» sobre un texto que
/// el modelo no está recibiendo — que era exactamente el fallo que vivía en
/// `commands/projects.rs`, con el gate implementado dos veces.
///
/// Con `project_id` `None` el proyecto se busca por la raíz. El archivo que se
/// compara es siempre el de la raíz del proyecto, no el de la subcarpeta donde se
/// esté trabajando.
pub fn para_prompt(
    conn: &rusqlite::Connection,
    project_id: Option<&str>,
    raiz: &Path,
) -> String {
    let Some(proyecto) = proyecto_dueno(conn, project_id, raiz) else {
        return String::new();
    };
    let Some(archivo) = read_file(&ruta_de_reglas(&proyecto)) else {
        return String::new();
    };
    text_for_prompt(proyecto.rules_hash.as_deref(), &archivo, MAX_CHARS).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Vectores públicos de SHA-256. Si alguien cambia el algoritmo aquí, el
    /// Trust Gate deja de cuadrar con lo aprobado que ya está en la base de
    /// datos, y esto tiene que romperse antes de que pase en silencio.
    #[test]
    fn el_hash_es_sha256_de_verdad() {
        assert_eq!(
            fingerprint(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            fingerprint(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn sin_aprobacion_no_aplica_nada() {
        let archivo = Archivo {
            texto: "Usa pnpm.".into(),
            hash: fingerprint("Usa pnpm.".as_bytes()),
        };
        assert!(!applies(None, &archivo));
        // El hash de otro contenido, aunque tenga la misma forma.
        assert!(!applies(Some(&fingerprint(b"otra cosa")), &archivo));
        assert!(applies(Some(&archivo.hash), &archivo));
        assert_eq!(
            text_for_prompt(Some(&archivo.hash), &archivo, 100).as_deref(),
            Some("Usa pnpm.")
        );
    }

    /// Un archivo en blanco aprobado llega vacío al prompt, y la pantalla tiene
    /// que poder decirlo con el mismo criterio: el gate no está abierto.
    #[test]
    fn el_vacio_no_abre_el_gate() {
        let archivo = Archivo {
            texto: "   \n".into(),
            hash: fingerprint(b"   \n"),
        };
        assert!(!applies(Some(&archivo.hash), &archivo));
        assert_eq!(text_for_prompt(Some(&archivo.hash), &archivo, 100), None);
    }

    #[test]
    fn se_recorta_despues_de_comparar() {
        let texto = "a".repeat(5_000);
        let archivo = Archivo {
            hash: fingerprint(texto.as_bytes()),
            texto,
        };
        assert_eq!(
            text_for_prompt(Some(&archivo.hash), &archivo, 6_000)
                .unwrap()
                .chars()
                .count(),
            5_000
        );
        assert_eq!(
            text_for_prompt(Some(&archivo.hash), &archivo, 10)
                .unwrap()
                .chars()
                .count(),
            10,
            "el techo lo pone el prompt, no el gate"
        );
    }
}
