//! Los comandos IPC de Hatboo, repartidos por dominio.
//!
//! Era un solo archivo de 3175 líneas y 85 comandos. Cada módulo de esta carpeta
//! trae los comandos de su terreno y solo los `use` que necesita; ninguno cambió
//! de firma ni de nombre: lo que el frente invoca por IPC es idéntico, y en
//! `lib.rs` lo único que mudou fue la ruta Rust (`commands::chat::send_message`).
//!
//! `_comunes` no es un dominio: son los helpers que usan varios a la vez. Y lo
//! que ya estaba fuera de `commands` —`chat/stream.rs` y `agent/loop_runner.rs`—
//! llama ahora a la ruta exacta del helper, no a un alias del módulo raíz.

pub mod _comunes;
pub mod agent;
pub mod chat;
pub mod data;
pub mod files;
pub mod git;
pub mod memoria;
pub mod models;
pub mod plantillas;
pub mod projects;
pub mod settings;
pub mod system;

// Fuera del crate se llama a estas cuatro funciones por la ruta de siempre —
// `hatboo_lib::commands::…` es la firma pública que prueba el Trust Gate en
// `tests/db.rs`, y `crate::commands::project_rules_for_prompt` la que usa el
// bucle del agente. Partir el archivo no puede romper ese camino: se reexporta.
pub use projects::{approve_rules, project_rules_for_prompt, revoke_rules, rules_status};

// Lo mismo con la palabra del restablecimiento de fábrica: pública y reachable
// por donde estaba.
pub use data::RESET_TOKEN;
