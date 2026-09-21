use hatboo_lib::db;

#[test]
fn crud_roundtrip() {
    let dir = std::env::temp_dir().join(format!("hatboo-test-{}", uuid::Uuid::new_v4()));
    let conn = db::connect(&dir.join("test.db")).expect("connect+migrate");

    let conv = db::create_conversation(&conn, "Nueva conversación", None).unwrap();
    assert_eq!(db::list_conversations(&conn).unwrap().len(), 1);

    let msg = db::add_message(&conn, &conv.id, "user", "hola", None).unwrap();
    assert_eq!(msg.role, "user");
    db::add_message(&conn, &conv.id, "assistant", "hey", Some("local")).unwrap();

    let messages = db::list_messages(&conn, &conv.id).unwrap();
    assert_eq!(messages.len(), 2);
    assert_eq!(messages[1].provider.as_deref(), Some("local"));

    db::set_setting(&conn, "settings", "{\"a\":1}").unwrap();
    assert_eq!(
        db::get_setting(&conn, "settings").unwrap().as_deref(),
        Some("{\"a\":1}")
    );
    db::set_setting(&conn, "settings", "{\"a\":2}").unwrap();
    assert_eq!(
        db::get_setting(&conn, "settings").unwrap().as_deref(),
        Some("{\"a\":2}")
    );

    db::delete_conversation(&conn, &conv.id).unwrap();
    assert!(db::list_conversations(&conn).unwrap().is_empty());
    assert!(db::list_messages(&conn, &conv.id).unwrap().is_empty());

    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn attachments_roundtrip_and_clear_messages() {
    let dir = std::env::temp_dir().join(format!("hatboo-test-{}", uuid::Uuid::new_v4()));
    let conn = db::connect(&dir.join("test.db")).expect("connect+migrate");

    let conv = db::create_conversation(&conn, "T", None).unwrap();
    let atts = [
        db::Attachment::text("notas.md".into(), "# hola".into()),
        db::Attachment::text("datos.csv".into(), "a,b\n1,2".into()),
    ];
    db::add_message_with_attachments(&conn, &conv.id, "user", "mira esto", None, &atts)
        .unwrap();
    db::add_message(&conn, &conv.id, "assistant", "ok", Some("local")).unwrap();

    let msgs = db::list_messages(&conn, &conv.id).unwrap();
    // El texto del adjunto NO se mezcla con content: la burbuja sigue limpia.
    assert_eq!(msgs[0].content, "mira esto");
    assert_eq!(msgs[0].attachments.len(), 2);
    assert_eq!(msgs[0].attachments[0].name, "notas.md");
    assert_eq!(msgs[0].attachments[1].text, "a,b\n1,2");
    // Mensaje sin adjuntos → lista vacía, no nula.
    assert!(msgs[1].attachments.is_empty());

    // Limpiar conserva la conversación y vacía los mensajes.
    db::clear_messages(&conn, &conv.id).unwrap();
    assert!(db::list_messages(&conn, &conv.id).unwrap().is_empty());
    assert_eq!(db::list_conversations(&conn).unwrap().len(), 1);

    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn assistant_meta_roundtrips() {
    let dir = std::env::temp_dir().join(format!("hatboo-test-{}", uuid::Uuid::new_v4()));
    let conn = db::connect(&dir.join("test.db")).expect("connect+migrate");
    let conv = db::create_conversation(&conn, "T", None).unwrap();

    let meta = db::AssistantMeta {
        reasoning: Some("primero pienso".into()),
        thinking_ms: Some(1750),
        web_sources: vec![db::WebSource {
            title: "Una fuente".into(),
            url: "https://example.com/nota".into(),
            snippet: "fragmento".into(),
        }],
        ..Default::default()
    };
    db::add_message_detailed(&conn, &conv.id, "assistant", "respuesta", Some("local"), &meta)
        .unwrap();
    db::add_message(&conn, &conv.id, "assistant", "normal", Some("local"))
        .unwrap();

    let msgs = db::list_messages(&conn, &conv.id).unwrap();
    assert_eq!(msgs[0].reasoning.as_deref(), Some("primero pienso"));
    assert_eq!(msgs[0].thinking_ms, Some(1750));
    assert_eq!(msgs[0].web_sources[0].url, "https://example.com/nota");
    assert!(msgs[1].reasoning.is_none());
    assert!(msgs[1].thinking_ms.is_none());
    assert!(msgs[1].web_sources.is_empty());

    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn delete_last_assistant_message_removes_only_the_last() {
    let dir = std::env::temp_dir().join(format!("hatboo-test-{}", uuid::Uuid::new_v4()));
    let conn = db::connect(&dir.join("test.db")).expect("connect+migrate");

    let conv = db::create_conversation(&conn, "T", None).unwrap();
    db::add_message(&conn, &conv.id, "user", "pregunta", None).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(5));
    db::add_message(&conn, &conv.id, "assistant", "primera", Some("local")).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(5));
    db::add_message(&conn, &conv.id, "assistant", "segunda", Some("local")).unwrap();

    db::delete_last_assistant_message(&conn, &conv.id).unwrap();
    let remaining: Vec<String> = db::list_messages(&conn, &conv.id)
        .unwrap()
        .into_iter()
        .map(|m| m.content)
        .collect();
    assert_eq!(remaining, ["pregunta", "primera"]);

    // Sin respuestas assistant ya no queda nada que borrar.
    db::delete_last_assistant_message(&conn, &conv.id).unwrap();
    assert!(db::list_messages(&conn, &conv.id)
        .unwrap()
        .iter()
        .all(|m| m.role == "user"));
    assert!(db::delete_last_assistant_message(&conn, &conv.id).is_err());

    let _ = std::fs::remove_dir_all(dir);
}
