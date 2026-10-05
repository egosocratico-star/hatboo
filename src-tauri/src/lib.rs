pub mod agent;
pub mod behavior;
pub mod backup;
pub mod chat;
pub mod cerebro;
pub mod commands;
pub mod db;
pub mod machine;
pub mod providers;
pub mod redact;
pub mod rules;
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
            // Las ocho plantillas de serie. Solo entran si la tabla está vacía
            // —primer arranque, no restablecimiento—, así que reabrir la app no
            // pisa ni resucita nada de lo que el usuario tocó.
            let _ = db::seed_skills(&conn);
            app.manage(AppState::new(conn, data_dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::chat::list_conversations,
            commands::chat::create_conversation,
            commands::chat::delete_conversation,
            commands::chat::save_draft,
            commands::chat::get_drafts,
            commands::chat::system_prompt_of,
            commands::chat::set_conversation_flags,
            commands::chat::rename_conversation,
            commands::chat::search_chats,
            commands::chat::list_messages,
            commands::chat::send_message,
            commands::chat::regenerate_response,
            commands::chat::edit_user_message,
            commands::chat::select_message_variant,
            commands::chat::save_artifact,
            commands::chat::list_artifacts,
            commands::chat::list_attachments,
            commands::chat::delete_artifact,
            commands::chat::perfil_estadisticas,
            commands::projects::list_sources,
            commands::projects::add_source,
            commands::projects::remove_source,
            commands::chat::set_message_feedback,
            commands::chat::cancel_chat_stream,
            commands::chat::clear_conversation_messages,
            commands::data::export_conversation,
            commands::data::export_all_data,
            commands::data::import_all_data,
            commands::data::factory_reset,
            commands::files::read_attachment,
            commands::files::clasifica_soltadas,
            commands::files::attachment_image,
            commands::models::list_local_models,
            commands::models::list_provider_models,
            commands::models::generate_image,
            commands::models::regenerate_image,
            commands::models::speak_message,
            commands::models::unload_local_model,
            commands::models::test_provider,
            commands::settings::get_settings,
            commands::settings::update_settings,
            commands::settings::set_api_key,
            commands::settings::has_api_key,
            commands::settings::delete_api_key,
            commands::plantillas::list_skills,
            commands::plantillas::save_skill,
            commands::plantillas::set_skill_enabled,
            commands::plantillas::delete_skill,
            commands::plantillas::install_skill,
            commands::plantillas::export_skill,
            commands::memoria::list_memories,
            commands::memoria::save_memory,
            commands::memoria::delete_memory,
            commands::files::file_meta,
            commands::projects::open_project,
            commands::projects::create_project,
            commands::projects::list_projects,
            commands::projects::delete_project,
            commands::files::list_project_dir,
            commands::files::preview_project_file,
            commands::files::search_project_files,
            commands::agent::get_tasks,
            commands::agent::start_work_task,
            commands::projects::set_project_approval_level,
            commands::projects::set_project_pinned,
            commands::system::test_notification,
            commands::chat::context_usage,
            commands::chat::branch_conversation,
            commands::files::fetch_github,
            commands::files::capture_screen,
            commands::projects::project_rules,
            commands::projects::save_project_rules,
            commands::projects::approve_project_rules,
            commands::projects::revoke_project_rules,
            commands::agent::cancel_work_task,
            commands::agent::respond_to_approval,
            commands::agent::respond_plan_review,
            commands::agent::session_changes,
            commands::agent::deshace_sesion,
            commands::agent::session_trace,
            commands::agent::agent_layers,
            commands::agent::check_tool_support,
            commands::git::project_git_info,
            commands::system::get_storage_info,
            commands::system::hardware_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Hatboo");
}
