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
