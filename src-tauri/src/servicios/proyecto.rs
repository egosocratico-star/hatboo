//! `ProyectoService`: lo que un proyecto necesita **en disco**, fuera de la capa
//! IPC.
//!
//! Dos cosas, y las dos son del dominio del proyecto, no del comando: crear la
//! carpeta nueva cuando el usuario la crea desde la app —con su `HATBOO.md` de
//! ejemplo, que es el único momento en el que Hatboo escribe un archivo sin que
//! se lo pidan— y guardar las reglas que el usuario edita en la pantalla.
//!
//! El Trust Gate **no vive aquí**: lo decide [`crate::rules`] (`para_prompt`,
//! `ARCHIVO`, `MAX_CHARS`, `ruta_de_reglas`) y la capa IPC lo reexporta con sus
//! nombres de siempre. Lo único que hace este módulo es escribir bytes en la ruta
//! que `crate::rules` dice, con el mensaje literal de siempre, para que el comando
//! no tenga ni un `std::fs` dentro.

use crate::db;
use std::path::{Path, PathBuf};

/// Un `HATBOO.md` de arranque. Sale con una carpeta de proyecto nueva, que es el
/// único momento en el que Hatboo escribe un archivo sin que se lo pidan: la
/// carpeta la acaba de crear él, así que no pisa nada.
const RULES_EJEMPLO: &str = "\
# Reglas de este proyecto

Lo que escribas aquí se pega al prompt del agente en cada sesión de trabajo.
Sirve para CÓMO quieres que trabaje, no para la tarea de hoy.

## Dónde puede tocar
- (las carpetas que son del proyecto)

## Cómo quieres el código
- (comentarios, nombrado, pruebas)

## Fuera de los límites
- (archivos que no se tocan aunque los vea)

Las carpetas de la lista de ignoradas (Ajustes → Agente: `.git`, `node_modules`,
`target`…) no las ve ni el árbol ni `list_dir`.
";

/// Crea la carpeta nueva del proyecto dentro de `parent` y escribe el ejemplo de
/// reglas si no había ninguno. Devuelve la ruta creada, que es la que después se
/// registra con `open_project`/`register_project`.
///
/// `create_dir_all` también pasa si la carpeta ya estaba, así que se comprueba
/// antes de escribir: si alguien tiene sus propias reglas, esas se quedan.
pub fn crea_carpeta(parent: &Path, nombre: &str) -> Result<PathBuf, String> {
    let new_dir = parent.join(nombre);
    std::fs::create_dir_all(&new_dir).map_err(|e| format!("No se pudo crear la carpeta: {e}"))?;
    let reglas = new_dir.join(crate::rules::ARCHIVO);
    if !reglas.exists() {
        let _ = std::fs::write(&reglas, RULES_EJEMPLO);
    }
    Ok(new_dir)
}

/// Escribe el `HATBOO.md` del proyecto. El contenido llega **ya recortado** por el
/// comando: el techo de guardar (`RULES_SAVE_MAX`) no es el techo de inyección
/// ([`crate::rules::MAX_CHARS`]), y esa decisión sigue siendo de la capa IPC.
///
/// Guardar NO aprueba: si el archivo estaba aprobado, el hash deja de cuadrar y el
/// gate se cierra solo —lo cuenta `crate::rules::applies`, no esta función.
pub fn guarda_reglas(proyecto: &db::Project, contenido: &str) -> Result<(), String> {
    std::fs::write(crate::rules::ruta_de_reglas(proyecto), contenido.as_bytes())
        .map_err(|e| format!("No se pudo escribir {}: {e}", crate::rules::ARCHIVO))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_de_prueba(etiqueta: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "hatboo-proyecto-{etiqueta}-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn proyecto_en(base: &std::path::Path) -> (db::Project, rusqlite::Connection, std::path::PathBuf) {
        // La fila sale de `db`, como en la app: así la ruta que escribe el servicio
        // es la que lee el gate, y no una copia del literal de la prueba.
        let dir = std::env::temp_dir().join(format!(
            "hatboo-proyecto-db-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let conn = db::connect(&dir.join("hatboo.db")).unwrap();
        let p = db::create_project(
            &conn,
            &base.file_name().unwrap().to_string_lossy(),
            &base.to_string_lossy(),
            "ask_always",
        )
        .unwrap();
        (p, conn, dir)
    }

    #[test]
    fn crear_la_carpeta_trae_el_hatboom_de_ejemplo() {
        let base = base_de_prueba("crea");
        let nueva = crea_carpeta(&base, "mi-proyecto").unwrap();
        assert!(nueva.is_dir());
        let reglas = nueva.join(crate::rules::ARCHIVO);
        assert!(reglas.is_file(), "un proyecto nuevo nace con sus reglas");
        // El ejemplo habla del gate: si se escribiera otra cosa, la pantalla de
        // reglas enseñaría un archivo que no explica qué hace.
        let texto = std::fs::read_to_string(&reglas).unwrap();
        assert!(texto.contains("# Reglas de este proyecto"));
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn si_ya_habia_reglas_propias_no_se_pisan() {
        let base = base_de_prueba("pisa");
        let nueva = base.join("otro");
        std::fs::create_dir_all(&nueva).unwrap();
        let reglas = nueva.join(crate::rules::ARCHIVO);
        std::fs::write(&reglas, "mis reglas de siempre").unwrap();

        crea_carpeta(&base, "otro").unwrap();
        assert_eq!(std::fs::read_to_string(&reglas).unwrap(), "mis reglas de siempre");
        std::fs::remove_dir_all(&base).ok();
    }

    /// La escritura de las reglas va por la ruta que dicta `crate::rules`, que es la
    /// misma que lee el gate: si aquí se usara otra, se aprobaría un archivo y se
    /// inyectaría otro. Se comprueba con el hash, que es lo único que cuadrará al
    /// aprobar.
    #[test]
    fn guardar_usa_la_ruta_del_gate() {
        let base = base_de_prueba("guarda");
        let (p, _conn, db_dir) = proyecto_en(&base);
        guarda_reglas(&p, "Usa pnpm.").unwrap();
        let archivo = crate::rules::read_file(&crate::rules::ruta_de_reglas(&p)).expect("escrito");
        assert_eq!(archivo.texto, "Usa pnpm.");
        assert_eq!(archivo.hash, crate::rules::fingerprint(b"Usa pnpm."));
        std::fs::remove_dir_all(&base).ok();
        let _ = std::fs::remove_dir_all(db_dir);
    }
}
