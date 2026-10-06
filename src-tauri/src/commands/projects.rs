//! Proyectos: registro, fuentes y el Trust Gate de `HATBOO.md`.
//!
//! `project_rules_for_prompt`, `rules_status`, `approve_rules` y `revoke_rules` no son
//! comandos pero siguen siendo `pub`: `project_rules_for_prompt` es la puerta que
//! abre `servicios::contexto` al recoger el material del prompt —el bucle del
//! agente y el visor de prompt la llamaban cada uno por su cuenta—, y la batería
//! `tests/db.rs` las prueba por la ruta de siempre que reexporta `commands/mod.rs`.
//!
//! El disco está en [`crate::servicios::proyecto`]: crear la carpeta nueva con su
//! `HATBOO.md` de ejemplo y guardar las reglas que el usuario edita. Aquí quedan la
//! selección de la ruta (que sale de la base de datos o del diálogo del frontend),
//! el candado de las fuentes y el gate, que es de [`crate::rules`].

use crate::db;
use crate::servicios::adjuntos::remove_image_files;
use crate::servicios::proyecto;
use crate::state::{self, AppState};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::State;

/// Las fuentes vinculadas a un proyecto, con la ruta tal como se guardó.
#[tauri::command]
pub fn list_sources(app: State<AppState>, project_id: String) -> Result<Vec<db::Fuente>, String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::list_sources(&conn, &project_id)
}

/// Vincula una carpeta o un archivo como contexto de lectura. La validación que
/// importa es esta: una fuente que contenga la raíz del proyecto convertiría el
/// «solo lectura» en «el agente puede leer tu casa entera», así que se rechaza
/// cualquier ruta que sea la propia carpeta, un padre suyo o un hijo suyo (un
/// hijo ya está dentro del sandbox y no necesita puerta aparte).
#[tauri::command]
pub fn add_source(
    app: State<AppState>,
    project_id: String,
    ruta: String,
    tipo: String,
) -> Result<db::Fuente, String> {
    let canon = std::path::Path::new(&ruta)
        .canonicalize()
        .map_err(|_| format!("Esa ruta no existe: {ruta}"))?;
    let raiz = {
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        db::get_project(&conn, &project_id)?.root_path
    };
    let raiz_canon = std::path::Path::new(&raiz)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if canon == raiz_canon {
        return Err("Esa ya es la carpeta del proyecto: no hace falta vincularla.".into());
    }
    if canon.starts_with(&raiz_canon) {
        return Err("Esa ruta está dentro del proyecto; el agente ya la ve con read_file.".into());
    }
    if raiz_canon.starts_with(&canon) {
        return Err(
            "No se puede vincular una carpeta que contenga el propio proyecto: dejaría de ser \
             lectura acotada."
                .into(),
        );
    }
    let guardada = canon.to_string_lossy().into_owned();
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::add_source(&conn, &project_id, &guardada, &tipo)
}

/// Quita una fuente. No borra nada de disco: solo cierra la puerta de lectura.
#[tauri::command]
pub fn remove_source(app: State<AppState>, id: String) -> Result<(), String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::remove_source(&conn, &id)
}

/// Nombre del archivo de reglas, dicho por su módulo dueño (`crate::rules`). El
/// bucle del agente lo cita en el prompt, y la pantalla lo usa para decir qué
/// archivo se está aprobando.
pub(crate) const RULES_FILE: &str = crate::rules::ARCHIVO;
/// Techo de lo que se deja guardar desde la app. Para el de inyección está
/// `crate::rules::MAX_CHARS`, que es el que aplica el gate.
const RULES_SAVE_MAX: usize = 20_000;

/// Ver [`crate::rules::para_prompt`]. Sigue expuesto por esta ruta porque así lo
/// llamaban `agent/loop_runner.rs`, `commands/mod.rs` y `tests/db.rs`, y partir el
/// archivo no podía romper ese camino. El gate, en cambio, ya no vive aquí: la
/// única lectura que inyecta está en `rules.rs`, y `ContextService` llama allí, no
/// a la capa IPC.
pub fn project_rules_for_prompt(
    conn: &rusqlite::Connection,
    project_id: Option<&str>,
    raiz: &Path,
) -> String {
    crate::rules::para_prompt(conn, project_id, raiz)
}

/// Ruta del `HATBOO.md` del proyecto.
fn rules_ruta(p: &db::Project) -> PathBuf {
    crate::rules::ruta_de_reglas(p)
}

/// Estado del Trust Gate tal como lo ve la pantalla: lo que hay en el disco y si
/// ese contenido es el aprobado. `applied` es la única respuesta válida a «¿las
/// está leyendo el agente?»; enseñar el texto sin decir que no se inyecta sería
/// prometer algo que no está pasando.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRules {
    pub exists: bool,
    pub content: String,
    pub path: String,
    pub applied: bool,
    pub approved_hash: Option<String>,
    pub current_hash: Option<String>,
}

pub fn rules_status(p: &db::Project) -> ProjectRules {
    let ruta = rules_ruta(p);
    let archivo = crate::rules::read_file(&ruta);
    let aprobado = p.rules_hash.as_deref();
    ProjectRules {
        exists: archivo.is_some(),
        content: archivo.as_ref().map(|a| a.texto.clone()).unwrap_or_default(),
        path: ruta.display().to_string(),
        applied: archivo.as_ref().is_some_and(|a| crate::rules::applies(aprobado, a)),
        approved_hash: p.rules_hash.clone(),
        current_hash: archivo.map(|a| a.hash),
    }
}

#[tauri::command]
pub fn project_rules(app: State<AppState>, project_id: String) -> Result<ProjectRules, String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    Ok(rules_status(&db::get_project(&conn, &project_id)?))
}

/// Escribe `HATBOO.md`. Guardar NO aprueba: si el archivo ya estaba aprobado, el
/// gate se cierra solo por no cuadrar el hash, y eso es lo que devuelve aquí.
///
/// El tope que se aplica es el de **guardar** desde la app, no el de inyección
/// ([`crate::rules::MAX_CHARS`], que mide el gate): por eso se recorta aquí y el
/// servicio solo escribe bytes.
#[tauri::command]
pub fn save_project_rules(
    app: State<AppState>,
    project_id: String,
    content: String,
) -> Result<ProjectRules, String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    let proyecto = db::get_project(&conn, &project_id)?;
    let recortado: String = content.chars().take(RULES_SAVE_MAX).collect();
    proyecto::guarda_reglas(&proyecto, &recortado)?;
    Ok(rules_status(&proyecto))
}

/// Aprueba el contenido que hay ahora mismo en el `HATBOO.md` del proyecto: desde
/// aquí ese texto exacto entra en el prompt, y deja de entrar en cuanto el archivo
/// sea otro. Se hashea lo recién leído del disco y no un borrador de la interfaz,
/// que es la única forma de que lo aprobado y lo inyectado no puedan discrepar.
pub fn approve_rules(
    conn: &rusqlite::Connection,
    project_id: &str,
) -> Result<ProjectRules, String> {
    let proyecto = db::get_project(conn, project_id)?;
    let archivo = crate::rules::read_file(&rules_ruta(&proyecto)).ok_or_else(|| {
        format!("No hay {RULES_FILE} que aprobar en {}.", proyecto.root_path)
    })?;
    if archivo.texto.trim().is_empty() {
        return Err(format!("{RULES_FILE} está vacío: no hay nada que aprobar."));
    }
    db::set_project_rules_hash(conn, project_id, &archivo.hash)?;
    Ok(rules_status(&db::get_project(conn, project_id)?))
}

/// Cierra el gate sin borrar lo escrito: `rules_hash` vuelve a NULL y las reglas
/// dejan de entrar al prompt. Es lo que hace falta cuando alguien quiere dejar
/// de usarlas un rato sin perder el archivo.
pub fn revoke_rules(
    conn: &rusqlite::Connection,
    project_id: &str,
) -> Result<ProjectRules, String> {
    db::clear_project_rules_hash(conn, project_id)?;
    Ok(rules_status(&db::get_project(conn, project_id)?))
}

#[tauri::command]
pub fn approve_project_rules(
    app: State<AppState>,
    project_id: String,
) -> Result<ProjectRules, String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    approve_rules(&conn, &project_id)
}

#[tauri::command]
pub fn revoke_project_rules(
    app: State<AppState>,
    project_id: String,
) -> Result<ProjectRules, String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    revoke_rules(&conn, &project_id)
}

fn register_project(app: &AppState, path: &str) -> Result<db::Project, String> {
    let mut root = std::path::Path::new(path)
        .canonicalize()
        .map_err(|e| format!("No se pudo abrir la carpeta: {e}"))?;
    // Si llegó un archivo en vez de una carpeta, se registra su carpeta padre
    // para que el proyecto se nombre por la carpeta y no por el archivo.
    if root.is_file() {
        root = root
            .parent()
            .ok_or("No se pudo determinar la carpeta del proyecto.")?
            .to_path_buf();
    }
    if !root.is_dir() {
        return Err("La ruta seleccionada no es una carpeta.".into());
    }
    let name = root
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| root.display().to_string());
    // Antes de bloquear la conexión: load_settings usa el mismo mutex.
    let level = state::normalize_approval_level(
        &state::load_settings(app).default_approval_level,
    );
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    let ruta = root.display().to_string();
    // La carpeta ya está registrada: se reutiliza la fila y solo se mueve al
    // frente del orden. Insertar otra dejaría dos entradas iguales en la barra.
    if let Some(existing) = db::find_project_by_root(&conn, &ruta)? {
        db::touch_project(&conn, &existing.id)?;
        return db::get_project(&conn, &existing.id);
    }
    let project = db::create_project(&conn, &name, &ruta, &level)?;
    db::touch_project(&conn, &project.id)?;
    Ok(project)
}

/// Registra en la base de datos una carpeta ya existente como proyecto.
/// La selección de carpeta la hace el frontend con el plugin de diálogo.
#[tauri::command]
pub fn open_project(app: State<AppState>, path: String) -> Result<db::Project, String> {
    register_project(&app, &path)
}

/// Crea una carpeta nueva de proyecto y la registra.
///
/// La carpeta y su `HATBOO.md` de ejemplo los escribe
/// [`proyecto::crea_carpeta`]; aquí queda la validación del nombre —un nombre con
/// separadores saldría de la carpeta elegida— y el registro, que es de la base de
/// datos.
#[tauri::command]
pub fn create_project(
    app: State<AppState>,
    parent_path: String,
    name: String,
) -> Result<db::Project, String> {
    let name = name.trim();
    if name.is_empty() || name.contains(['/', '\\']) {
        return Err("Nombre de proyecto inválido.".into());
    }
    let new_dir = proyecto::crea_carpeta(Path::new(&parent_path), name)?;
    register_project(&app, &new_dir.display().to_string())
}

#[tauri::command]
pub fn list_projects(app: State<AppState>) -> Result<Vec<db::Project>, String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::list_projects(&conn)
}

#[tauri::command]
pub fn delete_project(app: State<AppState>, project_id: String) -> Result<(), String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    let images = db::project_image_files(&conn, &project_id)?;
    db::delete_project(&conn, &project_id)?;
    remove_image_files(images);
    Ok(())
}

/// Cambia el nivel de aprobación de un proyecto (config por proyecto).
#[tauri::command]
pub fn set_project_approval_level(
    app: State<AppState>,
    project_id: String,
    level: String,
) -> Result<(), String> {
    const VALID: [&str; 4] = ["ask_always", "approve_for_me", "auto_sandbox", "full_access"];
    if !VALID.contains(&level.as_str()) {
        return Err(format!("Nivel de aprobación desconocido: {level}"));
    }
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::set_project_approval_level(&conn, &project_id, &level)
}

/// Fija o suelta un proyecto en la barra lateral.
#[tauri::command]
pub fn set_project_pinned(app: State<AppState>, project_id: String, pinned: bool) -> Result<(), String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::set_project_pinned(&conn, &project_id, pinned)
}
