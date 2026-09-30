//! Lo que hace el chat cuando no es un comando: el armando del prompt está en
//! `commands.rs` (lo comparten el visor de prompt y el medidor de contexto) y el
//! stream, con sus eventos, aquí.

pub(crate) mod stream;
