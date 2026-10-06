//! `AgentService`: el arranque de una tarea de trabajo, su deshacer, y lo que no
//! es IPC.
//!
//! Aquí vivía el `SELECT title FROM conversations WHERE id = ?1` que los dos
//! arranques —`commands::chat::send_message` y `commands::agent::start_work_task`—
//! escribían a mano dentro del comando para titular la conversación con las
//! primeras palabras del pedido. La consulta se fue a
//! [`crate::db::titulo_de_conversacion`], que es su sitio natural, y lo que queda
//! aquí es la única decisión que había que tomar: **renombrar solo si sigue siendo
//! un borrador**.
//!
//! La segunda mitad es el disco del modo trabajo, que estaba en `commands/agent.rs`
//! con tres `std::fs`: borrar lo que la sesión creó, devolver desde el respaldo lo
//! que modificó, y llevarse la carpeta de respaldos al terminar. Ver [`revierte`] y
//! [`deshace`].

use crate::commands::_comunes::titulo_breve;
use crate::db;
use rusqlite::Connection;
use serde::Serialize;
use std::path::Path;

pub struct AgentService;

/// Un archivo que la sesión de trabajo tocó, agregado por ruta: si el agente
/// escribió el mismo archivo tres veces, lo que importa es el último diff.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CambioSesion {
    pub ruta: String,
    /// El diff de la última vez que se escribió: si el agente reescribió el
    /// archivo tres veces, lo que importa es el estado final.
    pub diff: String,
    pub creado: bool,
    pub escrituras: u32,
}

impl AgentService {
    /// Titula la conversación con las primeras palabras del pedido, y solo si
    /// sigue llevando el rótulo de borrador `borrador`.
    ///
    /// Recibe la conexión **ya bloqueada**: `state::load_settings` usa el mismo
    /// mutex que la conexión y los dos arranques están dentro de su lock cuando
    /// llaman. Pedir aquí el `AppState` sería un deadlock silencioso.
    ///
    /// Fallar el título no puede tumbar el mensaje que ya está guardado, así que
    /// los dos llamadores ignoran el `Err` —como lo ignoraban cuando el SQL estaba
    /// escrito a mano dentro del comando.
    pub fn titular_desde_el_pedido(
        conn: &Connection,
        conversation_id: &str,
        pedido: &str,
        borrador: &str,
    ) -> Result<(), String> {
        if db::titulo_de_conversacion(conn, conversation_id) != borrador {
            return Ok(());
        }
        db::rename_conversation(conn, conversation_id, &titulo_breve(pedido))
    }

    /// Reúne las escrituras de `db::session_writes` por ruta, conservando el orden
    /// de la primera aparición. Es lo que lee la pantalla «Cambios de esta sesión».
    ///
    /// El agregado estaba dentro del comando porque no necesita la base de datos:
    /// la fila ya trae el JSON de salida de `write_file`. Lo que sí decide este
    /// servicio es qué se enseña de esa salida —el último diff, si creó, cuántas
    /// veces se escribió—, que es la parte que puede discrepar de lo que hizo el
    /// deshacer.
    pub fn cambios_de_sesion(registros: &[db::ToolCall]) -> Vec<CambioSesion> {
        let mut orden: Vec<String> = Vec::new();
        let mut acumulado: std::collections::HashMap<String, CambioSesion> =
            std::collections::HashMap::new();
        for r in registros {
            let Some(salida) = r.output.as_deref() else { continue };
            let Ok(valor) = serde_json::from_str::<serde_json::Value>(salida) else {
                continue;
            };
            let Some(ruta) = valor["path"].as_str() else { continue };
            let entrada = acumulado.entry(ruta.to_string()).or_insert_with(|| {
                orden.push(ruta.to_string());
                CambioSesion {
                    ruta: ruta.to_string(),
                    diff: String::new(),
                    creado: false,
                    escrituras: 0,
                }
            });
            entrada.diff = valor["diff"].as_str().unwrap_or_default().to_string();
            entrada.creado = valor["created"].as_bool().unwrap_or(false);
            entrada.escrituras += 1;
        }
        orden
            .into_iter()
            .filter_map(|r| acumulado.remove(&r))
            .collect()
    }
}

/// Devuelve los archivos que esta sesión tocó a como estaban antes de tocarlos.
/// Se recorre en orden inverso: es la única forma de que dos escrituras del mismo
/// archivo terminen en el original y no en el penúltimo estado. Un deshacer dos
/// veces seguidas no borra nada más, porque los respaldos se van.
///
/// Era el cuerpo de `commands::agent::deshace_sesion`, y sigue aparte por la misma
/// razón de siempre: se puede probar sin Tauri ni BD. Lo que **no** hace es
/// llevarse la carpeta de respaldos; eso lo decide [`deshace`], porque si esto
/// falla los respaldos tienen que seguir ahí para poder reintentar.
pub fn revierte(
    raiz: &Path,
    respaldos: &Path,
    registros: &[db::ToolCall],
) -> Result<Vec<String>, String> {
    let mut devueltos: Vec<String> = Vec::new();
    for r in registros.iter().rev() {
        let Some(salida) = r.output.as_deref() else { continue };
        let Ok(valor) = serde_json::from_str::<serde_json::Value>(salida) else {
            continue;
        };
        let Some(rel) = valor["path"].as_str() else { continue };
        // La ruta la escribió el modelo, así que se vuelve a validar contra el
        // proyecto antes de pisar o borrar, igual que al ejecutar la tool.
        let Ok(destino) = crate::agent::tools::resolve_in_project(raiz, rel) else {
            continue;
        };
        let novedad = valor["created"].as_bool().unwrap_or(false);
        let hecho = if novedad {
            // Lo que la sesión creó no existía antes: deshacer es borrarlo.
            match std::fs::remove_file(&destino) {
                Ok(_) => true,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => false,
                Err(e) => return Err(format!("No se pudo borrar {rel}: {e}")),
            }
        } else {
            let original = crate::agent::loop_runner::respaldo_de(respaldos, &r.id);
            if original.exists() {
                std::fs::copy(&original, &destino)
                    .map_err(|e| format!("No se pudo devolver {rel}: {e}"))?;
                true
            } else {
                false
            }
        };
        if hecho && !devueltos.iter().any(|d| d == rel) {
            devueltos.push(rel.to_string());
        }
    }
    Ok(devueltos)
}

/// El deshacer de una sesión de trabajo, entero: [`revierte`] y, **solo si salió
/// bien**, se lleva la carpeta de respaldos (`sesion-<id>/` dentro del
/// `data_dir`, que es como la nombra `crate::agent::loop_runner`).
///
/// El orden importa: si [`revierte`] falla, los respaldos se quedan donde estaban
/// para que el botón pueda volver a apretarse. Eso era un `?` dentro del comando,
/// y sigue siendo un `?` aquí.
pub fn deshace(
    raiz: &Path,
    respaldos: &Path,
    registros: &[db::ToolCall],
) -> Result<Vec<String>, String> {
    let devueltos = revierte(raiz, respaldos, registros)?;
    let _ = std::fs::remove_dir_all(respaldos);
    Ok(devueltos)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// Base de datos desechable en un directorio temporal: sin Tauri, sin pantalla
    /// y sin Ollama, que es como se prueba la lógica pura de este repo.
    fn conn_de_prueba(etiqueta: &str) -> (Connection, PathBuf) {
        let dir = std::env::temp_dir().join(format!(
            "hatboo-agente-{etiqueta}-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        (db::connect(&dir.join("hatboo.db")).unwrap(), dir)
    }

    fn titulo(conn: &Connection, id: &str) -> String {
        db::list_conversations(conn)
            .unwrap()
            .into_iter()
            .find(|c| c.id == id)
            .map(|c| c.title)
            .unwrap_or_default()
    }

    #[test]
    fn el_pedido_titula_la_conversacion_que_sigue_de_borrador() {
        let (conn, dir) = conn_de_prueba("titula");
        let conv = db::create_conversation(&conn, "Nueva conversación", None).unwrap();
        AgentService::titular_desde_el_pedido(
            &conn,
            &conv.id,
            "lee a.txt y luego b.txt y dime cuántas líneas tiene cada uno",
            "Nueva conversación",
        )
        .unwrap();
        // Las mismas primeras palabras que usaba el comando, con el mismo corte.
        assert_eq!(titulo(&conn, &conv.id), "lee a.txt y luego b.txt y dime…");

        // Y una sesión de trabajo con su propio rótulo: mismo criterio, otra palabra.
        let sesion = db::create_conversation(&conn, "Sesión de trabajo", None).unwrap();
        AgentService::titular_desde_el_pedido(&conn, &sesion.id, "arregla el build", "Sesión de trabajo")
            .unwrap();
        assert_eq!(titulo(&conn, &sesion.id), "arregla el build");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn una_conversacion_ya_bautizada_no_se_renombra_ni_se_rompe() {
        let (conn, dir) = conn_de_prueba("bautizada");
        let conv = db::create_conversation(&conn, "El plan del finde", None).unwrap();
        AgentService::titular_desde_el_pedido(&conn, &conv.id, "escribe hola", "Nueva conversación")
            .unwrap();
        assert_eq!(titulo(&conn, &conv.id), "El plan del finde");

        // Una conversación que ya no existe tampoco lanza: el arranque no puede
        // caerse por no poder escribir un título.
        AgentService::titular_desde_el_pedido(&conn, "no-existe", "escribe hola", "Nueva conversación")
            .unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    /// La prueba de que el SQL dejó de estar en el comando: `titulo_de_conversacion`
    /// dice lo mismo que decía el `query_row` escrito a mano, también cuando la fila
    /// no está (cadena vacía, nunca un error que suba al `invoke`).
    #[test]
    fn el_titulo_leido_es_el_que_hay_en_la_fila() {
        let (conn, dir) = conn_de_prueba("lee");
        let conv = db::create_conversation(&conn, "Sesión de trabajo", None).unwrap();
        assert_eq!(db::titulo_de_conversacion(&conn, &conv.id), "Sesión de trabajo");
        assert_eq!(db::titulo_de_conversacion(&conn, "borrada"), "");
        let _ = std::fs::remove_dir_all(dir);
    }

    fn escritura(id: &str, salida: &str) -> db::ToolCall {
        db::ToolCall {
            id: id.to_string(),
            conversation_id: "c1".to_string(),
            tool_name: "write_file".to_string(),
            input: format!(r#"{{"path":"{id}"}}"#),
            output: Some(salida.to_string()),
            status: "completed".to_string(),
            created_at: 1,
            duration_ms: 0,
            brief: None,
        }
    }

    #[test]
    fn los_cambios_se_agregan_por_ruta_con_el_ultimo_diff() {
        let registros = vec![
            escritura("a.txt", r#"{"path":"a.txt","diff":"primero","created":true}"#),
            escritura("b.txt", r#"{"path":"b.txt","diff":"otro","created":false}"#),
            escritura("a.txt", r#"{"path":"a.txt","diff":"final","created":false}"#),
            // Lo que no es JSON o no trae ruta no puede aparecer en la pantalla.
            escritura("c.txt", "no es json"),
        ];
        let cambios = AgentService::cambios_de_sesion(&registros);
        // El orden de la primera aparición se conserva, no el de la última escritura.
        assert_eq!(
            cambios.iter().map(|c| c.ruta.as_str()).collect::<Vec<_>>(),
            vec!["a.txt", "b.txt"]
        );
        assert_eq!(cambios[0].diff, "final");
        assert_eq!(cambios[0].escrituras, 2);
        // `created` es el del último estado: la tarjeta dice «modificado», que es
        // lo que quedó después de las dos escrituras.
        assert!(!cambios[0].creado);
        assert_eq!(cambios[1].escrituras, 1);
    }

    /// El otro lado del agregado: lo que la pantalla enseña y lo que el deshacer
    /// ejecuta tienen que salir del MISMO JSON. Si aquí se aceptara otra forma, la
    /// tarjeta prometería un diff que [`revierte`] no va a aplicar.
    #[test]
    fn una_escritura_sin_salida_no_cuenta_como_cambio() {
        let mut vacio = escritura("d.txt", r#"{"path":"d.txt"}"#);
        vacio.output = None;
        assert!(AgentService::cambios_de_sesion(&[vacio]).is_empty());
        // Sin `path` tampoco: es la misma guarda que usa el deshacer para saltarse
        // la fila.
        assert!(AgentService::cambios_de_sesion(&[escritura("e.txt", "{}")]).is_empty());
    }

    /// El contrato de [`deshace`] con el disco, que es la razón de que esté separado
    /// de [`revierte`]: los respaldos solo se van **después** de que la devolución
    /// salga bien. Sin esta prueba, subir el `remove_dir_all` por encima del `?`
    /// sería un cambio invisible que deja el deshacer sin margen de reintento.
    #[test]
    fn los_respaldos_solo_se_van_si_el_deshacer_sale_bien() {
        let base = std::env::temp_dir().join(format!("hatboo-deshace-{}", uuid::Uuid::new_v4()));
        let raiz = base.join("proyecto");
        let respaldos = base.join("sesion-c1");
        std::fs::create_dir_all(&raiz).unwrap();
        std::fs::create_dir_all(&respaldos).unwrap();
        std::fs::write(raiz.join("leido.txt"), "el original").unwrap();
        std::fs::write(crate::agent::loop_runner::respaldo_de(&respaldos, "tc1"), "lo de antes")
            .unwrap();
        let registros = vec![escritura_con_id("tc1", "leido.txt", r#"{"path":"leido.txt","created":false}"#)];

        // `revierte` devuelve el original y **no toca** la carpeta de respaldos.
        assert_eq!(revierte(&raiz, &respaldos, &registros).unwrap(), vec!["leido.txt".to_string()]);
        assert_eq!(std::fs::read_to_string(raiz.join("leido.txt")).unwrap(), "lo de antes");
        assert!(respaldos.is_dir(), "revierte solo no se lleva los respaldos");

        // `deshace` sí se los lleva, y dice lo mismo.
        assert_eq!(deshace(&raiz, &respaldos, &registros).unwrap(), vec!["leido.txt".to_string()]);
        assert!(!respaldos.exists(), "deshacer hecho: los respaldos ya no están");
        // Repetirlo no inventa nada: sin respaldo y con el archivo ya devuelto, la
        // lista sale vacía y no hay error que suba al `invoke`.
        assert!(deshace(&raiz, &respaldos, &registros).unwrap().is_empty());

        let _ = std::fs::remove_dir_all(&base);
    }

    /// La otra mitad del contrato: un deshacer que falla tiene que dejar los
    /// respaldos donde estaban. El fallo se provoca con una ruta que la tool declaró
    /// `created` pero que en disco es un directorio: `remove_file` no puede con él y
    /// devuelve un error que **no** es `NotFound`, que es el único que se perdona.
    #[test]
    fn si_el_deshacer_falla_los_respaldos_se_quedan() {
        let base =
            std::env::temp_dir().join(format!("hatboo-deshace-fallo-{}", uuid::Uuid::new_v4()));
        let raiz = base.join("proyecto");
        let respaldos = base.join("sesion-c2");
        std::fs::create_dir_all(raiz.join("una-carpeta")).unwrap();
        std::fs::create_dir_all(&respaldos).unwrap();
        std::fs::write(crate::agent::loop_runner::respaldo_de(&respaldos, "tc9"), "x").unwrap();
        let registros = vec![escritura_con_id(
            "tc9",
            "una-carpeta",
            r#"{"path":"una-carpeta","created":true}"#,
        )];

        let e = deshace(&raiz, &respaldos, &registros).unwrap_err();
        assert!(e.starts_with("No se pudo borrar una-carpeta: "), "{e}");
        assert!(
            respaldos.is_dir(),
            "un deshacer que falló no puede dejar al usuario sin respaldo"
        );
        assert!(raiz.join("una-carpeta").exists(), "lo que no se pudo borrar sigue ahí");

        let _ = std::fs::remove_dir_all(&base);
    }

    /// Una escritura con `id` propio: [`revierte`] busca el respaldo por ese id, así
    /// que la prueba necesita controlarlo y el helper de arriba no lo permite.
    fn escritura_con_id(id: &str, ruta: &str, salida: &str) -> db::ToolCall {
        db::ToolCall {
            id: id.to_string(),
            conversation_id: "c1".to_string(),
            tool_name: "write_file".to_string(),
            input: format!(r#"{{"path":"{ruta}"}}"#),
            output: Some(salida.to_string()),
            status: "completed".to_string(),
            created_at: 1,
            duration_ms: 0,
            brief: None,
        }
    }
}
