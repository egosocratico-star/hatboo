use hatboo_lib::agent::tools::{resolve_in_project, AgentTool, WriteFileTool};
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
