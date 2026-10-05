//! Las notas que el usuario escribe para que Hatboo las recuerde. Tres comandos.
//!
//! Viajan **literales** en el *system prompt* del chat y del modo trabajo, así que
//! no son ninguna magia que deduce cosas de las conversaciones: lo que no está
//! escrito aquí no se recuerda. Con el Brain encendido entran en la capa `producto`
//! del system (`BrainRequest::contexto_producto`), donde el presupuesto del Plan no
//! las recorta.

use crate::db;
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub fn list_memories(app: State<AppState>) -> Result<Vec<db::Memoria>, String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::list_memories(&conn)
}

#[tauri::command]
pub fn save_memory(
    app: State<AppState>,
    id: String,
    content: String,
) -> Result<db::Memoria, String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::save_memory(&conn, &id, &content)
}

#[tauri::command]
pub fn delete_memory(app: State<AppState>, id: String) -> Result<(), String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::delete_memory(&conn, &id)
}
