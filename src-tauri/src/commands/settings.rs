//! Ajustes y claves del llavero.

use crate::providers;
use crate::state::{self, AppState, Settings};
use tauri::State;

#[tauri::command]
pub fn get_settings(app: State<AppState>) -> Settings {
    state::load_settings(&app)
}

#[tauri::command]
pub fn update_settings(app: State<AppState>, settings: Settings) -> Result<Settings, String> {
    let mut settings = settings;
    // La lista de ignoradas la escribe él a mano en Ajustes. Si pega una ruta se
    // guarda solo el nombre de la carpeta, que es lo que comparan el árbol, el
    // buscador y `list_dir`; una ruta entera no casaría nunca y quedaría ahí
    // muerta de forma silenciosa.
    settings.ignore_dirs = crate::agent::ignore::sanea(&settings.ignore_dirs);
    state::save_settings(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
pub fn set_api_key(provider: String, key: String) -> Result<(), String> {
    providers::set_api_key(&provider, &key)
}

#[tauri::command]
pub fn has_api_key(provider: String) -> bool {
    providers::get_api_key(&provider).is_some()
}

#[tauri::command]
pub fn delete_api_key(provider: String) -> Result<(), String> {
    providers::delete_api_key(&provider)
}
