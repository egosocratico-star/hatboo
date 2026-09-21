use hatboo_lib::backup;
use hatboo_lib::db;
use std::path::Path;

fn temp_dir(tag: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("hatboo-{}-{}", tag, uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn seed(dir: &Path) -> (db::Conversation, std::path::PathBuf, String) {
    let conn = db::connect(&dir.join("hatboo.db")).expect("connect");
    let attachments = dir.join("attachments");
    std::fs::create_dir_all(&attachments).unwrap();

    let project = db::create_project(&conn, "Repo", "/tmp/repo", "auto_sandbox").unwrap();
    let conv = db::create_conversation(&conn, "Charla", Some(&project.id)).unwrap();
    let image = attachments.join("foto-1.png");
    std::fs::write(&image, [0x89u8, b'P', b'N', b'G', 1, 2, 3]).unwrap();
    let atts = [db::Attachment {
        name: "foto-1.png".into(),
        text: String::new(),
        image_media_type: Some("image/png".into()),
        image_file: Some(image.display().to_string()),
    }];
    db::add_message_with_attachments(&conn, &conv.id, "user", "mira", Some("local"), &atts)
        .unwrap();
    let meta = db::AssistantMeta {
        reasoning: Some("pienso".into()),
        thinking_ms: Some(900),
        web_sources: vec![db::WebSource {
            title: "Fuente".into(),
            url: "https://example.com".into(),
            snippet: "frag".into(),
        }],
        ..Default::default()
    };
    let answer = db::add_message_detailed(&conn, &conv.id, "assistant", "hola", Some("local"), &meta)
        .unwrap();
    db::set_message_feedback(&conn, &answer.id, Some("up")).unwrap();
    db::set_setting(&conn, "settings", "{\"activeProvider\":\"local\"}").unwrap();
    (conv, attachments, answer.id)
}

#[test]
fn snapshot_roundtrip_restores_everything_and_is_idempotent() {
    let origin = temp_dir("backup-a");
    let (conv, origin_attachments, _) = seed(&origin);

    let conn = db::connect(&origin.join("hatboo.db")).unwrap();
    let snapshot = backup::build_snapshot(&conn, &origin_attachments).unwrap();
    let file = origin.join("copia.json");
    backup::write_snapshot(&file, &snapshot).unwrap();

    let destino = temp_dir("backup-b");
    let destino_attachments = destino.join("attachments");
    let conn2 = db::connect(&destino.join("hatboo.db")).unwrap();
    let leido = backup::read_snapshot(&file).unwrap();
    let report = backup::apply_snapshot(&conn2, &leido, &destino_attachments).unwrap();

    assert_eq!(report.conversations_added, 1);
    assert_eq!(report.messages_added, 2);
    assert_eq!(report.projects_added, 1);
    assert_eq!(report.images_restored, 1);
    assert_eq!(report.images_missing, 0);

    let restored = db::list_messages(&conn2, &conv.id).unwrap();
    assert_eq!(restored[0].attachments[0].name, "foto-1.png");
    // La ruta restaurada es nueva y está dentro de la carpeta de adjuntos de
    // destino: la copia nunca arrastra rutas absolutas del otro equipo.
    let restored_file = restored[0].attachments[0].image_file.clone().unwrap();
    assert!(Path::new(&restored_file).starts_with(&destino_attachments));
    assert!(Path::new(&restored_file).exists());
    assert_eq!(restored[1].reasoning.as_deref(), Some("pienso"));
    assert_eq!(restored[1].thinking_ms, Some(900));
    assert_eq!(restored[1].web_sources[0].url, "https://example.com");
    assert_eq!(restored[1].feedback.as_deref(), Some("up"));

    // Importar la misma copia otra vez no duplica nada.
    let segundo = backup::apply_snapshot(&conn2, &leido, &destino_attachments).unwrap();
    assert_eq!(segundo.conversations_added, 0);
    assert_eq!(segundo.messages_added, 0);
    assert_eq!(db::list_messages(&conn2, &conv.id).unwrap().len(), 2);

    let _ = std::fs::remove_dir_all(&origin);
    let _ = std::fs::remove_dir_all(&destino);
}

#[test]
fn read_snapshot_rejects_archivos_ajenos() {
    let dir = temp_dir("backup-malo");
    let file = dir.join("otro.json");
    std::fs::write(&file, r#"{"hello":"world"}"#).unwrap();
    let error = backup::read_snapshot(&file).unwrap_err();
    assert!(error.contains("Hatboo"), "mensaje inesperado: {error}");

    std::fs::write(
        &file,
        r#"{"app":"hatboo-backup","version":99,"exportedAt":1}"#,
    )
    .unwrap();
    let error = backup::read_snapshot(&file).unwrap_err();
    assert!(error.contains("versión"), "mensaje inesperado: {error}");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn wipe_all_vacía_toda_la_base() {
    let dir = temp_dir("backup-wipe");
    let (conv, attachments, _) = seed(&dir);
    let conn = db::connect(&dir.join("hatboo.db")).unwrap();
    assert_eq!(db::list_messages(&conn, &conv.id).unwrap().len(), 2);

    db::wipe_all(&conn).unwrap();
    let counts = db::table_counts(&conn).unwrap();
    assert_eq!(counts.conversations, 0);
    assert_eq!(counts.messages, 0);
    assert_eq!(counts.projects, 0);
    assert!(db::get_setting(&conn, "settings").unwrap().is_none());

    let _ = std::fs::remove_dir_all(&dir);
    let _ = attachments;
}
