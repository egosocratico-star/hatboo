//! Estado git del proyecto, para la cabecera de la vista de trabajo.

use crate::db;
use crate::state::AppState;
use serde::Serialize;
use std::path::PathBuf;
use tauri::State;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitInfo {
    pub is_repo: bool,
    pub branch: Option<String>,
    pub dirty_count: usize,
}

/// Estado git del proyecto para la cabecera de la vista de trabajo.
#[tauri::command]
pub async fn project_git_info(
    app: State<'_, AppState>,
    project_id: String,
) -> Result<GitInfo, String> {
    let root = {
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        PathBuf::from(db::get_project(&conn, &project_id)?.root_path)
    };
    let info = tauri::async_runtime::spawn_blocking(move || {
        use crate::agent::tools::git;
        if !git::is_git_repo(&root) {
            return GitInfo {
                is_repo: false,
                branch: None,
                dirty_count: 0,
            };
        }
        let (branch, dirty_count) = git::repo_summary(&root).unwrap_or_default();
        GitInfo {
            is_repo: true,
            branch: Some(branch),
            dirty_count,
        }
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(info)
}
