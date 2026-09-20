pub mod agent;
pub mod commands;
pub mod db;
pub mod providers;
pub mod state;

use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let conn = db::connect(&data_dir.join("hatboo.db"))?;
            app.manage(AppState::new(conn));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_conversations,
            commands::create_conversation,
            commands::delete_conversation,
            commands::list_messages,
            commands::send_message,
            commands::regenerate_response,
            commands::clear_conversation_messages,
            commands::read_attachment,
            commands::list_local_models,
            commands::test_provider,
            commands::get_settings,
            commands::update_settings,
            commands::set_api_key,
            commands::has_api_key,
            commands::delete_api_key,
            commands::open_project,
            commands::create_project,
            commands::list_projects,
            commands::delete_project,
            commands::list_project_dir,
            commands::search_project_files,
            commands::get_tasks,
            commands::start_work_task,
            commands::set_project_approval_level,
            commands::cancel_work_task,
            commands::respond_to_approval,
            commands::check_tool_support,
            commands::project_git_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running Hatboo");
}
