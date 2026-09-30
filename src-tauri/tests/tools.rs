use hatboo_lib::agent::tools::{
    resolve_in_project, AgentTool, SearchFilesTool, WriteFileTool,
};
use serde_json::json;

#[test]
fn path_validation_blocks_escapes() {
    let root = std::env::temp_dir();
    let root = root.canonicalize().unwrap();

    // Salidas clásicas: deben rechazarse.
    for bad in [
        "../outside.txt",
        "..\\outside.txt",
        "src/../../outside.txt",
        "/etc/passwd",
        "C:/Windows/system32",
    ] {
        assert!(
            resolve_in_project(&root, bad).is_err(),
            "debía rechazarse: {bad}"
        );
    }

    // Rutas legítimas dentro del proyecto.
    assert!(resolve_in_project(&root, "a/b/c.txt").is_ok());
    assert!(resolve_in_project(&root, "./sub/file.rs").is_ok());
    assert!(resolve_in_project(&root, "").is_ok());
}

#[tokio::test]
async fn write_file_creates_and_diffs() {
    let dir = std::env::temp_dir().join(format!("hatboo-tools-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let root = dir.canonicalize().unwrap();

    let tool = WriteFileTool;
    let res = tool
        .execute(
            json!({ "path": "docs/hola.txt", "content": "línea 1\n" }),
            &root,
        )
        .await
        .unwrap();
    assert_eq!(res["created"], json!(true));
    assert!(std::fs::read_to_string(root.join("docs/hola.txt")).unwrap() == "línea 1\n");

    // Sobrescribir: el diff debe marcar la línea vieja y la nueva.
    let res2 = tool
        .execute(
            json!({ "path": "docs/hola.txt", "content": "línea 2\n" }),
            &root,
        )
        .await
        .unwrap();
    let diff = res2["diff"].as_str().unwrap();
    assert!(diff.contains("-línea 1"), "diff esperado, obtenido: {diff}");
    assert!(diff.contains("+línea 2"));

    // Escape fuera del proyecto: rechazado sin tocar disco.
    let outside = root.join("..").join(format!("hatboo-escape-{}.txt", uuid::Uuid::new_v4()));
    let err = tool
        .execute(
            json!({ "path": format!("../{}", outside.file_name().unwrap().to_str().unwrap()), "content": "x" }),
            &root,
        )
        .await
        .unwrap_err();
    assert!(err.to_string().contains("fuera del proyecto"));
    assert!(!outside.exists());

    let _ = std::fs::remove_dir_all(&root);
}

/// Las dos caras de `search_files`: encontrar una línea y encontrar un archivo.
/// Antes solo existía la primera, y para «¿dónde está el ajuste de red?» el
/// agente tenía que adivinar la carpeta y recorrerla con `list_dir`.
#[tokio::test]
async fn search_files_busca_por_contenido_y_por_nombre() {
    let dir = std::env::temp_dir().join(format!("hatboo-busca-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(dir.join("src")).unwrap();
    std::fs::create_dir_all(dir.join("node_modules/paquete")).unwrap();
    std::fs::write(dir.join("src/ajustes.rs"), "pub const RED: &str = \"off\";\n").unwrap();
    std::fs::write(dir.join("src/otro.rs"), "nada que ver\n").unwrap();
    // Lo que hay dentro de node_modules no debe aparecer en ninguna de las dos.
    std::fs::write(dir.join("node_modules/paquete/ajustes.js"), "RED = off\n").unwrap();
    let root = dir.canonicalize().unwrap();

    let contenido = SearchFilesTool::nuevo(vec!["node_modules".to_string()])
        .execute(json!({ "query": "red" }), &root)
        .await
        .unwrap();
    assert_eq!(contenido["modo"], json!("contenido"));
    let hits = contenido["matches"].as_array().unwrap();
    assert_eq!(hits.len(), 1, "matches: {hits:?}");
    let primera = hits[0].as_str().unwrap();
    assert!(primera.contains("ajustes.rs:1"), "{primera}");
    assert!(primera.contains("off"), "{primera}");

    let nombres = SearchFilesTool::nuevo(vec!["node_modules".to_string()])
        .execute(json!({ "query": "ajustes", "modo": "nombre" }), &root)
        .await
        .unwrap();
    assert_eq!(nombres["modo"], json!("nombre"));
    let rutas = nombres["matches"].as_array().unwrap();
    assert_eq!(rutas.len(), 1, "rutas: {rutas:?}");
    assert!(rutas[0].as_str().unwrap().ends_with("ajustes.rs"), "{rutas:?}");
    assert!(!nombres["truncated"].as_bool().unwrap());

    // La lista es la que manda: sin ella, el buscador entra en node_modules. Es lo
    // que se cambió (antes cada herramienta traía la suya fija), y si alguien la
    // vuelve a ignorar este caso es el que se queja.
    let sin_lista = SearchFilesTool::nuevo(vec![])
        .execute(json!({ "query": "ajustes", "modo": "nombre" }), &root)
        .await
        .unwrap();
    let dos = sin_lista["matches"].as_array().unwrap();
    assert_eq!(dos.len(), 2, "con la lista vacía se ven las dos: {dos:?}");

    let _ = std::fs::remove_dir_all(&dir);
}
