use hatboo_lib::db;
use std::collections::HashMap;

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
fn editing_a_user_message_truncates_everything_after_it() {
    let dir = std::env::temp_dir().join(format!("hatboo-test-{}", uuid::Uuid::new_v4()));
    let conn = db::connect(&dir.join("test.db")).expect("connect+migrate");
    let conv = db::create_conversation(&conn, "T", None).unwrap();

    let first = db::add_message(&conn, &conv.id, "user", "hola", None).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(5));
    let answer = db::add_message(&conn, &conv.id, "assistant", "respuesta", Some("local"))
        .unwrap();
    std::thread::sleep(std::time::Duration::from_millis(5));
    db::add_message(&conn, &conv.id, "user", "otra cosa", None).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(5));
    db::add_message(&conn, &conv.id, "assistant", "otra respuesta", Some("local"))
        .unwrap();

    // La valoración solo existe en respuestas del asistente.
    db::set_message_feedback(&conn, &answer.id, Some("up")).unwrap();
    assert_eq!(
        db::list_messages(&conn, &conv.id).unwrap()[1]
            .feedback
            .as_deref(),
        Some("up")
    );
    assert!(db::set_message_feedback(&conn, &first.id, Some("up")).is_err());
    db::set_message_feedback(&conn, &answer.id, None).unwrap();
    assert!(db::list_messages(&conn, &conv.id).unwrap()[1].feedback.is_none());

    db::update_message_content(&conn, &first.id, "hola editado").unwrap();
    let orphans = db::truncate_messages_after(&conn, &conv.id, first.created_at).unwrap();
    assert!(orphans.is_empty());

    let msgs = db::list_messages(&conn, &conv.id).unwrap();
    assert_eq!(msgs.len(), 1, "lo posterior al mensaje editado desaparece");
    assert_eq!(msgs[0].content, "hola editado");
    assert_eq!(msgs[0].role, "user");

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

#[test]
fn prune_removes_only_empty_chat_conversations() {
    let dir = std::env::temp_dir().join(format!("hatboo-test-{}", uuid::Uuid::new_v4()));
    let conn = db::connect(&dir.join("test.db")).expect("connect+migrate");

    let empty = db::create_conversation(&conn, "Nueva conversación", None).unwrap();
    let used = db::create_conversation(&conn, "Con historial", None).unwrap();
    db::add_message(&conn, &used.id, "user", "hola", None).unwrap();
    let project = db::create_project(&conn, "Proyecto", "/tmp/proyecto", "approve_for_me").unwrap();
    let work_session =
        db::create_conversation(&conn, "Sesión de trabajo", Some(&project.id)).unwrap();

    assert_eq!(db::prune_empty_chat_conversations(&conn).unwrap(), 1);

    let remaining: Vec<String> = db::list_conversations(&conn)
        .unwrap()
        .into_iter()
        .map(|c| c.id)
        .collect();
    assert!(!remaining.contains(&empty.id), "la vacía se va");
    assert!(remaining.contains(&used.id), "la que tiene mensajes se queda");
    assert!(
        remaining.contains(&work_session.id),
        "una sesión de trabajo sin mensajes no se toca"
    );

    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn skills_crud_y_bloque_del_system_prompt() {
    let dir = std::env::temp_dir().join(format!("hatboo-test-{}", uuid::Uuid::new_v4()));
    let conn = db::connect(&dir.join("test.db")).expect("connect+migrate");

    let creada = db::save_skill(
        &conn,
        &db::Skill {
            id: String::new(),
            name: "  Explicar  ".into(),
            prompt: "\n  Paso a paso, con ejemplos.  ".into(),
            enabled: true,
            created_at: 0,
        },
    )
    .unwrap();
    assert_eq!(creada.name, "Explicar");
    assert_eq!(creada.prompt, "Paso a paso, con ejemplos.");
    assert!(!creada.id.is_empty());
    assert!(creada.created_at > 0);

    let segunda = db::save_skill(
        &conn,
        &db::Skill {
            id: String::new(),
            name: "Bilingüe".into(),
            prompt: "Añade un resumen en inglés.".into(),
            enabled: false,
            created_at: 0,
        },
    )
    .unwrap();

    // Editar conserva el id y el created_at originales.
    let editada = db::save_skill(
        &conn,
        &db::Skill {
            id: creada.id.clone(),
            name: "Explicar".into(),
            prompt: "Paso a paso, sin ejemplos.".into(),
            enabled: creada.enabled,
            created_at: 0,
        },
    )
    .unwrap();
    assert_eq!(editada.id, creada.id);
    assert_eq!(editada.created_at, creada.created_at);
    assert_eq!(db::list_skills(&conn).unwrap().len(), 2);

    // Solo las activas van al prompt, y con el nombre delante.
    let bloque = db::enabled_skills_prompt(&conn).unwrap();
    assert!(bloque.contains("· Explicar: Paso a paso, sin ejemplos."));
    assert!(!bloque.contains("Bilingüe"));

    db::set_skill_enabled(&conn, &segunda.id, true).unwrap();
    assert!(db::enabled_skills_prompt(&conn)
        .unwrap()
        .contains("Añade un resumen en inglés."));

    // Sin activas no se añade nada a la petición.
    db::set_skill_enabled(&conn, &creada.id, false).unwrap();
    db::set_skill_enabled(&conn, &segunda.id, false).unwrap();
    assert_eq!(db::enabled_skills_prompt(&conn).unwrap(), "");

    db::delete_skill(&conn, &creada.id).unwrap();
    assert_eq!(db::list_skills(&conn).unwrap().len(), 1);
    // Nombre o texto vacío no se guardan.
    assert!(db::save_skill(
        &conn,
        &db::Skill { id: String::new(), name: "x".into(), prompt: "   ".into(), enabled: true, created_at: 0 }
    )
    .is_err());
    assert!(db::save_skill(
        &conn,
        &db::Skill { id: "no-existe".into(), name: "x".into(), prompt: "y".into(), enabled: true, created_at: 0 }
    )
    .is_err());

    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn fijar_manda_sobre_la_recencia_y_archivar_solo_esconde() {
    let dir = std::env::temp_dir().join(format!("hatboo-test-{}", uuid::Uuid::new_v4()));
    let conn = db::connect(&dir.join("test.db")).expect("connect+migrate");

    let vieja = db::create_conversation(&conn, "vieja", None).unwrap();
    let nueva = db::create_conversation(&conn, "nueva", None).unwrap();
    assert!(!vieja.pinned && !vieja.archived);

    db::set_conversation_flags(&conn, &vieja.id, Some(true), None).unwrap();
    let listado = db::list_conversations(&conn).unwrap();
    assert_eq!(listado[0].id, vieja.id, "la fijada va primero");
    assert_eq!(listado[0].updated_at, vieja.updated_at, "fijar no mueve la fecha");

    db::set_conversation_flags(&conn, &nueva.id, None, Some(true)).unwrap();
    let visible: Vec<_> = db::list_conversations(&conn)
        .unwrap()
        .into_iter()
        .filter(|c| !c.archived)
        .collect();
    assert_eq!(visible.len(), 1);
    assert_eq!(visible[0].id, vieja.id);
    // Archivar es quitar de la lista, no borrar: sigue localizable con su marca.
    assert!(db::get_conversation(&conn, &nueva.id).unwrap().archived);

    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn la_busqueda_global_casa_titulo_y_contenido_y_respeta_el_archivo() {
    let dir = std::env::temp_dir().join(format!("hatboo-test-{}", uuid::Uuid::new_v4()));
    let conn = db::connect(&dir.join("test.db")).expect("connect+migrate");

    let proyecto = db::create_project(&conn, "p", "/tmp/p", "approve_for_me").unwrap();
    let charla = db::create_conversation(&conn, "recetas de invierno", None).unwrap();
    db::add_message(&conn, &charla.id, "user", "cómo se hace un caldo de pollo", None).unwrap();
    let trabajo = db::create_conversation(&conn, "Sesión de trabajo", Some(&proyecto.id)).unwrap();
    db::add_message(&conn, &trabajo.id, "user", "pollo en salsa", None).unwrap();
    let oculta = db::create_conversation(&conn, "archivada con pollo", None).unwrap();
    db::set_conversation_flags(&conn, &oculta.id, None, Some(true)).unwrap();

    let hits = db::search_chats(&conn, "pollo").unwrap();
    assert_eq!(hits.len(), 2, "una fila por conversación y sin archivadas");
    assert!(hits.iter().all(|h| {
        h.snippet
            .as_deref()
            .map(|s| s.to_lowercase().contains("pollo"))
            .unwrap_or(false)
    }));
    assert!(hits.iter().any(|h| h.project_id == Some(proyecto.id.clone())));

    // Solo casa el título: sigue saliendo, sin fragmento de mensaje.
    let por_titulo = db::search_chats(&conn, "invierno").unwrap();
    assert_eq!(por_titulo.len(), 1);
    assert_eq!(por_titulo[0].conversation_id, charla.id);
    assert!(por_titulo[0].snippet.is_none());

    assert!(db::search_chats(&conn, "p").unwrap().is_empty(), "una letra no es una búsqueda");
    assert!(db::search_chats(&conn, "   ").unwrap().is_empty());
    assert_eq!(
        db::search_chats(&conn, "POLLO").unwrap().len(),
        2,
        "las mayúsculas casan igual"
    );
    assert!(db::search_chats(&conn, "PRIMavera").unwrap().is_empty());

    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn una_carpeta_no_produce_dos_proyectos() {
    let dir = std::env::temp_dir().join(format!("hatboo-test-{}", uuid::Uuid::new_v4()));
    let conn = db::connect(&dir.join("test.db")).expect("connect+migrate");

    let creado = db::create_project(&conn, "Proy", r"C:\tmp\Proy", "approve_for_me").unwrap();
    // Las cinco formas de nombrar la misma carpeta tienen que devolver la misma fila.
    for variante in [
        r"C:\tmp\Proy",
        r"c:\tmp\proy",
        r"C:\tmp\Proy\",
        r"C:/tmp/Proy",
        r"\\?\C:\tmp\Proy",
    ] {
        let encontrado = db::find_project_by_root(&conn, variante)
            .unwrap()
            .unwrap_or_else(|| panic!("no se encontró la variante {variante}"));
        assert_eq!(encontrado.id, creado.id, "variante {variante}");
    }

    assert!(db::find_project_by_root(&conn, r"C:\tmp\Otra").unwrap().is_none());
    assert_eq!(db::list_projects(&conn).unwrap().len(), 1);

    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn un_proyecto_fijado_manda_sobre_la_apertura_reciente() {
    let dir = std::env::temp_dir().join(format!("hatboo-test-{}", uuid::Uuid::new_v4()));
    let conn = db::connect(&dir.join("test.db")).expect("connect+migrate");

    let viejo = db::create_project(&conn, "Viejo", "/tmp/viejo", "approve_for_me").unwrap();
    let nuevo = db::create_project(&conn, "Nuevo", "/tmp/nuevo", "approve_for_me").unwrap();
    assert!(!nuevo.pinned, "un proyecto nace sin fijar");
    assert_eq!(db::list_projects(&conn).unwrap()[0].id, nuevo.id);

    db::set_project_pinned(&conn, &viejo.id, true).unwrap();
    let lista = db::list_projects(&conn).unwrap();
    assert_eq!(lista[0].id, viejo.id, "el fijado pasa delante aunque se abrió antes");
    assert!(lista[0].pinned);

    // Soltarlo devuelve el orden por apertura reciente, y el `pinned` se escribe
    // sin tocar last_opened_at: fijar no es abrir.
    db::set_project_pinned(&conn, &viejo.id, false).unwrap();
    let tras_suelta = db::list_projects(&conn).unwrap();
    assert_eq!(tras_suelta[0].id, nuevo.id);

    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn ramificar_copia_hasta_el_mensaje_elegido_y_no_toca_el_original() {
    let dir = std::env::temp_dir().join(format!("hatboo-test-{}", uuid::Uuid::new_v4()));
    let conn = db::connect(&dir.join("test.db")).expect("connect+migrate");

    let original = db::create_conversation(&conn, "Plan de viaje", None).unwrap();
    let mut ids = Vec::new();
    for (rol, texto) in [
        ("user", "primero"),
        ("assistant", "segundo"),
        ("user", "tercero"),
        ("assistant", "cuarto"),
    ] {
        ids.push(db::add_message(&conn, &original.id, rol, texto, None).unwrap());
    }

    let hasta = ids[1].id.clone();
    let rama = db::branch_conversation(&conn, &original.id, &hasta, &HashMap::new()).unwrap();
    assert_ne!(rama.id, original.id);
    assert_eq!(rama.title, "Plan de viaje (rama)");

    let copiados = db::list_messages(&conn, &rama.id).unwrap();
    assert_eq!(copiados.len(), 2, "la rama para donde se bifurco");
    assert_eq!(
        copiados.iter().map(|m| m.content.as_str()).collect::<Vec<_>>(),
        vec!["primero", "segundo"],
        "se conserva el orden y el rol"
    );
    assert_eq!(copiados[1].role, "assistant");
    assert_ne!(copiados[0].id, ids[0].id, "los mensajes de la rama son copias, no las mismas filas");

    // El original sigue entero, y las dos conversaciones conviven.
    assert_eq!(db::list_messages(&conn, &original.id).unwrap().len(), 4);
    assert_eq!(db::list_conversations(&conn).unwrap().len(), 2);
    assert_eq!(db::list_conversations(&conn).unwrap()[0].id, rama.id, "la rama nace ahora y va arriba");

    // Un mensaje de otra conversacion no vale como punto de corte.
    let ajeno = db::create_conversation(&conn, "Otra", None).unwrap();
    let de_otra = db::add_message(&conn, &ajeno.id, "user", "x", None).unwrap();
    assert!(db::branch_conversation(&conn, &original.id, &de_otra.id, &HashMap::new()).is_err());

    let _ = std::fs::remove_dir_all(dir);
}
