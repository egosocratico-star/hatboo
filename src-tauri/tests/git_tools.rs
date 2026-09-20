use hatboo_lib::agent::tools::{
    AgentTool, GitCommitTool, GitDiffTool, GitLogTool, GitStatusTool,
};
use serde_json::json;
use std::path::Path;
use std::process::Command;

fn run_git(root: &Path, args: &[&str]) {
    let status = Command::new("git")
        .args(args)
        .current_dir(root)
        .status()
        .expect("git debería estar disponible");
    assert!(status.success(), "git {args:?} falló");
}

fn temp_repo(tag: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("hatboo-git-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    run_git(&dir, &["init", "-b", "main", "-q"]);
    run_git(&dir, &["config", "user.email", "test@hatboo.local"]);
    run_git(&dir, &["config", "user.name", "Hatboo Test"]);
    std::fs::write(dir.join("a.txt"), "hola\n").unwrap();
    run_git(&dir, &["add", "-A"]);
    run_git(&dir, &["commit", "-qm", "initial"]);
    dir
}

#[tokio::test]
async fn git_tools_roundtrip() {
    let dir = temp_repo("roundtrip");

    // Working tree limpio.
    let clean: serde_json::Value = GitStatusTool
        .execute(json!({}), &dir)
        .await
        .unwrap()
        .into();
    assert_eq!(clean["branch"], "main");
    assert_eq!(clean["clean"], true);

    // Modificar un archivo → status sucio + diff con contenido.
    std::fs::write(dir.join("a.txt"), "hola\nmundo\n").unwrap();
    let status: serde_json::Value = GitStatusTool
        .execute(json!({}), &dir)
        .await
        .unwrap()
        .into();
    assert_eq!(status["clean"], false);
    assert_eq!(status["changes"].as_array().unwrap().len(), 1);

    let diff: serde_json::Value = GitDiffTool
        .execute(json!({ "path": "a.txt" }), &dir)
        .await
        .unwrap()
        .into();
    assert_eq!(diff["empty"], false);
    let diff_text = diff["diff"].as_str().unwrap();
    assert!(diff_text.contains("+mundo"), "diff inesperado: {diff_text}");

    // Commit con la tool.
    let commit: serde_json::Value = GitCommitTool
        .execute(json!({ "message": "segunda linea", "paths": ["a.txt"] }), &dir)
        .await
        .unwrap()
        .into();
    assert!(commit["committed"].as_str().unwrap().len() >= 4);

    // Log debe tener 2 commits.
    let log: serde_json::Value = GitLogTool
        .execute(json!({}), &dir)
        .await
        .unwrap()
        .into();
    let commits = log["commits"].as_array().unwrap();
    assert_eq!(commits.len(), 2);
    assert_eq!(commits[0]["message"], "segunda linea");

    // Diff sin cambios → vacío.
    let diff2: serde_json::Value = GitDiffTool
        .execute(json!({}), &dir)
        .await
        .unwrap()
        .into();
    assert_eq!(diff2["empty"], true);

    std::fs::remove_dir_all(&dir).ok();
}

#[tokio::test]
async fn git_tools_reject_paths_outside_project() {
    let dir = temp_repo("escape");
    let err = GitDiffTool
        .execute(json!({ "path": "../otro-repo/x.txt" }), &dir)
        .await
        .unwrap_err();
    assert!(err.to_string().contains("fuera del proyecto"));

    let err = GitCommitTool
        .execute(json!({ "message": "malo", "paths": ["../../etc/x"] }), &dir)
        .await
        .unwrap_err();
    assert!(err.to_string().contains("fuera del proyecto"));

    std::fs::remove_dir_all(&dir).ok();
}

#[tokio::test]
async fn git_tools_fail_outside_repo() {
    let dir = std::env::temp_dir().join(format!("hatboo-nogit-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let err = GitStatusTool
        .execute(json!({}), &dir)
        .await
        .unwrap_err();
    assert!(err.to_string().contains("no es un repositorio git"));
    std::fs::remove_dir_all(&dir).ok();
}
