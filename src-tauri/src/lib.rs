pub mod agent;
pub mod backup;
pub mod commands;
pub mod db;
pub mod providers;
pub mod redact;
pub mod state;
pub mod web;

use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let conn = db::connect(&data_dir.join("hatboo.db"))?;
            // Quitar conversaciones de chat vacías de arranques anteriores.
            // Si falla no se impide abrir la app: solo es limpieza.
            let _ = db::prune_empty_chat_conversations(&conn);
            app.manage(AppState::new(conn, data_dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_conversations,
            commands::create_conversation,
            commands::delete_conversation,
            commands::set_conversation_flags,
            commands::search_chats,
            commands::list_messages,
            commands::send_message,
            commands::regenerate_response,
            commands::edit_user_message,
            commands::set_message_feedback,
            commands::cancel_chat_stream,
            commands::clear_conversation_messages,
            commands::export_conversation,
            commands::export_all_data,
            commands::import_all_data,
            commands::factory_reset,
            commands::read_attachment,
            commands::save_image_attachment,
            commands::attachment_image,
            commands::list_local_models,
            commands::test_provider,
            commands::get_settings,
            commands::update_settings,
            commands::set_api_key,
            commands::has_api_key,
            commands::delete_api_key,
            commands::list_skills,
            commands::save_skill,
            commands::set_skill_enabled,
            commands::delete_skill,
            commands::open_project,
            commands::create_project,
            commands::list_projects,
            commands::delete_project,
            commands::list_project_dir,
            commands::search_project_files,
            commands::get_tasks,
            commands::start_work_task,
            commands::set_project_approval_level,
            commands::set_project_pinned,
            commands::set_window_transparency,
            commands::test_notification,
            commands::context_usage,
            commands::branch_conversation,
            commands::fetch_github,
            commands::capture_screen,
            commands::project_rules,
            commands::save_project_rules,
            commands::cancel_work_task,
            commands::respond_to_approval,
            commands::check_tool_support,
            commands::project_git_info,
            commands::get_storage_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running Hatboo");
}
