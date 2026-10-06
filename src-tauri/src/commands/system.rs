//! Sistema (solo lectura): avisos, almacenamiento y hardware.
//!
//! Lo que hay en el disco lo mira [`crate::machine`] —el módulo de «qué hay en esta
//! máquina»—, que es también donde se lee la RAM y el estado de Ollama. Aquí queda
//! la forma que pide el frente: las rutas de las que hablar, el recuento de tablas
//! que sale de la base de datos y el aviso de prueba.

use crate::db;
use crate::machine;
use crate::providers;
use crate::state::{self, AppState};
use serde::Serialize;
use tauri::{Manager, State};

// ---------- Fase 4: Ajustes → Sistema y Datos (solo lectura) ----------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    pub db_path: String,
    pub db_size_bytes: u64,
    pub attachments_path: String,
    pub attachments_size_bytes: u64,
    pub attachments_count: usize,
    pub counts: db::Counts,
}

/// Manda un aviso de prueba **sin mirar si la ventana está en primer plano**.
/// Sin esto, comprobar el camino del toast exigía poner el ratón en otra ventana
/// mientras una sesión de trabajo terminaba de verdad.
#[tauri::command]
pub fn test_notification(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title("Hatboo")
        .body("Si ves esto, los avisos de sesión llegan bien.")
        .show()
        .map_err(|e| format!("Windows no pudo mostrar el aviso: {e}"))
}

/// Dónde vive lo que Hatboo guarda en este PC y cuánto ocupa.
///
/// El peso de la base de datos se pide en la propia ruta (`metadata` sobre un
/// `PathBuf` del estado, no un recorrido), y la suma de la carpeta de adjuntos es
/// [`machine::dir_size`]. El recuento de filas sigue detrás de un solo lock, y se
/// toma **después** de mirar el disco: `load_settings` usa el mismo mutex y aquí no
/// se llama a él dentro del bloqueo.
#[tauri::command]
pub fn get_storage_info(app: State<AppState>) -> Result<StorageInfo, String> {
    let db_path = app.data_dir.join("hatboo.db");
    let db_size_bytes = db_path
        .metadata()
        .map(|m| m.len())
        .unwrap_or(0);
    let attachments_dir = app.data_dir.join("attachments");
    let (attachments_size_bytes, attachments_count) = machine::dir_size(&attachments_dir);
    let counts = {
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        db::table_counts(&conn)?
    };
    Ok(StorageInfo {
        db_path: db_path.display().to_string(),
        db_size_bytes,
        attachments_path: attachments_dir.display().to_string(),
        attachments_size_bytes,
        attachments_count,
        counts,
    })
}

/// Lo que hay en este PC y si Ollama está despierto. El Centro de modelos decide
/// con esto qué se puede bajar: una tienda que no conoce la máquina del usuario
/// solo sabe vender humo.
#[tauri::command]
pub async fn hardware_info(app: tauri::AppHandle) -> machine::HardwareInfo {
    let endpoint = {
        let state = app.state::<AppState>();
        state::load_settings(&state).local_endpoint.clone()
    };
    let locales = providers::list_ollama_models(&endpoint).await;
    machine::HardwareInfo {
        locales: locales.as_ref().map(Vec::len).unwrap_or_default(),
        ollama_ok: locales.is_ok(),
        base: machine::lee_hardware(),
    }
}
