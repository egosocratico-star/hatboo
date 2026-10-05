//! Sistema (solo lectura): avisos, almacenamiento y hardware.

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

/// Suma el peso de un árbol de archivos; se usa solo con la carpeta de adjuntos.
fn dir_size(path: &std::path::Path) -> (u64, usize) {
    let mut bytes = 0u64;
    let mut files = 0usize;
    let Ok(entries) = std::fs::read_dir(path) else {
        return (0, 0);
    };
    for entry in entries.flatten() {
        let child = entry.path();
        if child.is_dir() {
            let (b, f) = dir_size(&child);
            bytes += b;
            files += f;
        } else if let Ok(meta) = child.metadata() {
            bytes += meta.len();
            files += 1;
        }
    }
    (bytes, files)
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
#[tauri::command]
pub fn get_storage_info(app: State<AppState>) -> Result<StorageInfo, String> {
    let db_path = app.data_dir.join("hatboo.db");
    let db_size_bytes = db_path
        .metadata()
        .map(|m| m.len())
        .unwrap_or(0);
    let attachments_dir = app.data_dir.join("attachments");
    let (attachments_size_bytes, attachments_count) = dir_size(&attachments_dir);
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
