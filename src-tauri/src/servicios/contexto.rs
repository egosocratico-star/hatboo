//! `ContextService`: el único sitio que **recoge** el material del prompt.
//!
//! Está aquí porque la recolección estaba escrita a mano en cuatro sitios, cada
//! uno con su forma de tomar el mutex de la base de datos:
//! `commands::chat::system_prompt_of`, `commands::chat::context_usage`,
//! `chat::stream::spawn_chat_stream` y `agent::loop_runner::run_loop`. Cuatro
//! caminos para leer lo mismo son cuatro oportunidades de discrepar, y la que
//! importa es la gorda: las reglas del `HATBOO.md` solo pueden entrar en el prompt
//! si su SHA-256 sigue siendo el aprobado, y eso lo decide
//! [`crate::rules::para_prompt`]. Un material montado a
//! mano puede saltarse esa puerta; este, no.
//!
//! **No ensambla nada.** El ensamblado ya está centralizado y funciona:
//! [`crate::commands::_comunes::chat_system_prompt`] para el chat y
//! [`crate::agent::loop_runner::system_prompt`] para el agente. Este módulo
//! devuelve de qué llenarlos y se queda tan tranquilo.
//!
//! Y no lee los ajustes dentro del lock de la conexión: `state::load_settings`
//! usa **el mismo mutex** que la conexión, así que llamarlo con el lock cogido es
//! un deadlock silencioso. Se cargan antes, se toma el lock una vez, se saca todo
//! y se suelta.

use crate::db;
use crate::rules::para_prompt;
use crate::state::{self, AppState};
use rusqlite::Connection;
use std::path::{Path, PathBuf};

/// El proyecto dueño del prompt, con lo que necesita quien lo arma: la raíz de
/// donde leer `HATBOO.md` y el nivel de aprobación que se le aplica.
#[derive(Debug, Clone)]
pub struct Proyecto {
    pub id: String,
    pub raiz: PathBuf,
    pub approval_level: String,
}

/// El material de un turno, recogido con **un solo** lock de la base de datos.
///
/// `reglas_aprobadas` solo lo rellena este módulo, y solo por
/// `crate::rules::para_prompt`: cadena vacía si no hay proyecto registrado, si no
/// existe el archivo, si nunca se aprobó o si cambió desde la aprobación. Nadie
/// más debería construir un `Material` con texto ahí.
#[derive(Debug)]
pub struct Material {
    pub settings: state::Settings,
    pub skills: String,
    pub memoria: String,
    pub proyecto: Option<Proyecto>,
    pub reglas_aprobadas: String,
}

impl Material {
    /// El material de un turno al que no se le puede caer la respuesta por no
    /// poder leer una tabla: sin plantillas, sin memoria y —es lo que importa—
    /// **sin reglas**. Abrir el Trust Gate no es una opción que ofrezca esta
    /// función; la única puerta la tiene `ContextService`.
    pub fn sin_bloques(settings: state::Settings) -> Self {
        Self {
            settings,
            skills: String::new(),
            memoria: String::new(),
            proyecto: None,
            reglas_aprobadas: String::new(),
        }
    }
}

/// El servicio. No guarda nada entre llamadas —de ahí que sea un `struct` vacío—:
/// lo único que necesita está en el `AppState` que le presten, y así el sitio
/// común de los cuatro llamadores es una ruta escrita, no un objeto con estado que
/// se pueda quedar viejo.
pub struct ContextService;

impl ContextService {
    /// Lo que necesita el chat normal: ajustes, plantillas activas y notas de
    /// memoria. Sin proyecto: el *system prompt* del chat no habla de ninguno, y
    /// por eso `proyecto` sale `None` y `reglas_aprobadas` vacío.
    pub fn material_de_chat(app: &AppState) -> Result<Material, String> {
        let settings = state::load_settings(app);
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        let (skills, memoria) = plantillas_y_memoria(&conn)?;
        Ok(Material {
            settings,
            skills,
            memoria,
            proyecto: None,
            reglas_aprobadas: String::new(),
        })
    }

    /// El material de una conversación concreta: lo mismo del chat más su
    /// proyecto y las reglas que ese proyecto haya aprobado. Si la conversación
    /// no existe, error —es lo que hacía `system_prompt_of` antes de venir aquí.
    pub fn material_de_conversacion(
        app: &AppState,
        conversation_id: &str,
    ) -> Result<Material, String> {
        let settings = state::load_settings(app);
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        let (skills, memoria) = plantillas_y_memoria(&conn)?;
        let conversacion = db::get_conversation(&conn, conversation_id)
            .map_err(|_| "Esta conversación ya no existe.".to_string())?;
        let (proyecto, reglas_aprobadas) = match conversacion.project_id.as_deref() {
            None => (None, String::new()),
            Some(pid) => {
                let (proyecto, reglas) = proyecto_y_reglas(&conn, pid)?;
                (Some(proyecto), reglas)
            }
        };
        Ok(Material {
            settings,
            skills,
            memoria,
            proyecto,
            reglas_aprobadas,
        })
    }

    /// El material del bucle del agente. La raíz la trae quien llama porque el
    /// agente trabaja sobre la que le dieron al arrancar la tarea, y puede que la
    /// conversación no tenga proyecto registrado: entonces el Trust Gate busca la
    /// carpeta por esa raíz, que es exactamente el criterio de siempre.
    ///
    /// Recibe los ajustes ya leídos: `load_settings` toma el mismo mutex que la
    /// conexión y el bucle ya los tiene en la mano para todo lo demás.
    ///
    /// Una conversación que ya no existe no es un error aquí —era `None` antes de
    /// la mudanza y sigue siéndolo—: sale sin proyecto y sin reglas, con las
    /// plantillas y la memoria de todos modos.
    pub fn material_de_agente(
        app: &AppState,
        ajustes: &state::Settings,
        conversation_id: &str,
        raiz: &Path,
    ) -> Result<Material, String> {
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        let (skills, memoria) = plantillas_y_memoria(&conn)?;
        let project_id = db::get_conversation(&conn, conversation_id)
            .ok()
            .and_then(|c| c.project_id);
        let (proyecto, reglas_aprobadas) = match project_id.as_deref() {
            // Sin proyecto registrado en la conversación, la puerta busca la
            // carpeta por la raíz por la que trabaja el agente.
            None => (None, para_prompt(&conn, None, raiz)),
            Some(pid) => {
                let (p, reglas) = proyecto_y_reglas(&conn, pid)?;
                (Some(p), reglas)
            }
        };
        Ok(Material {
            settings: ajustes.clone(),
            skills,
            memoria,
            proyecto,
            reglas_aprobadas,
        })
    }
}

/// Las dos lecturas que los cuatro sitios escribían a mano por separado.
fn plantillas_y_memoria(conn: &Connection) -> Result<(String, String), String> {
    let activo = db::enabled_skills_prompt(conn)?;
    Ok((activo, db::memoria_prompt(conn)?))
}

/// La fila del proyecto y lo que de ella entra en el prompt **después del gate**.
/// La raíz es la guardada en la base de datos —no la subcarpeta donde se esté
/// trabajando—, que es el mismo archivo que ve y aprueba la pantalla de reglas.
fn proyecto_y_reglas(
    conn: &Connection,
    project_id: &str,
) -> Result<(Proyecto, String), String> {
    let proyecto = db::get_project(conn, project_id)?;
    let raiz = PathBuf::from(&proyecto.root_path);
    let reglas = para_prompt(conn, Some(project_id), &raiz);
    Ok((
        Proyecto {
            id: proyecto.id,
            raiz,
            approval_level: proyecto.approval_level,
        },
        reglas,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Skill;

    /// Base de datos y proyecto desechables, sin Tauri de por medio: `AppState`
    /// se monta con la conexión que abre `db::connect` en un directorio temporal.
    struct Escenario {
        dir: PathBuf,
        raiz_proyecto: PathBuf,
        state: AppState,
    }

    fn escenario(etiqueta: &str) -> Escenario {
        let dir = std::env::temp_dir().join(format!(
            "hatboo-contexto-{etiqueta}-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let raiz_proyecto = dir.join("proyecto");
        std::fs::create_dir_all(&raiz_proyecto).unwrap();
        let conn = db::connect(&dir.join("hatboo.db")).unwrap();
        Escenario {
            dir: dir.clone(),
            raiz_proyecto,
            state: AppState::new(conn, dir),
        }
    }

    impl Escenario {
        /// Proyecto registrado + conversación suya. Devuelve el id de la
        /// conversación, que es lo que piden los tres materiales con proyecto.
        fn con_proyecto(&self, nombre: &str) -> String {
            let conn = self.state.db.lock().unwrap();
            let proyecto = db::create_project(
                &conn,
                nombre,
                &self.raiz_proyecto.display().to_string(),
                "approve_for_me",
            )
            .unwrap();
            let conv = db::create_conversation(&conn, "La de siempre", Some(&proyecto.id)).unwrap();
            conv.id
        }

        fn escribir_reglas(&self, texto: &str) {
            std::fs::write(self.raiz_proyecto.join(crate::rules::ARCHIVO), texto).unwrap();
        }

        /// Lo que hace la pantalla de reglas: guardar el hash del contenido exacto
        /// que hay en el disco. Se escribe directo por `db` para que la prueba de
        /// este módulo no dependa de la capa IPC — un servicio que prueba llamando a
        /// un comando está probando el comando, no el servicio. El hash lo calcula
        /// `crate::rules`, que es el único formato que el gate compara.
        fn aprobar_reglas(&self, conv_id: &str) {
            let conn = self.state.db.lock().unwrap();
            let project_id = db::get_conversation(&conn, conv_id)
                .unwrap()
                .project_id
                .clone()
                .unwrap();
            let archivo =
                crate::rules::read_file(&self.raiz_proyecto.join(crate::rules::ARCHIVO))
                    .expect("sin archivo no hay nada que aprobar");
            db::set_project_rules_hash(&conn, &project_id, &archivo.hash).unwrap();
        }

        fn limpiar(&self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    #[test]
    fn el_material_reune_plantillas_y_memoria_de_una_vez() {
        let e = escenario("reunir");
        {
            let conn = e.state.db.lock().unwrap();
            db::save_skill(
                &conn,
                &Skill {
                    id: String::new(),
                    name: "Revisar".into(),
                    prompt: "Revisa los tipos antes de responder.".into(),
                    enabled: true,
                    created_at: 0,
                },
            )
            .unwrap();
            db::save_memory(&conn, "", "Vivo en Madrid.").unwrap();
        }
        let m = ContextService::material_de_chat(&e.state).unwrap();
        assert!(m.skills.contains("Revisa los tipos"), "{}", m.skills);
        assert!(m.memoria.contains("Vivo en Madrid"), "{}", m.memoria);
        // El chat no tiene proyecto, así que tampoco puede traer reglas.
        assert!(m.proyecto.is_none());
        assert!(m.reglas_aprobadas.is_empty());
        // Y los ajustes salen del mismo sitio que salían antes.
        assert_eq!(m.settings.local_model, state::Settings::default().local_model);
        e.limpiar();
    }

    /// La mitad alegre del gate: si el hash cuadra, el texto entra. Sin esta
    /// prueba la de abajo solo diría «vacío siempre», que no es lo que se afirma.
    #[test]
    fn las_reglas_aprobadas_entran_cuando_el_hash_cuadra() {
        let e = escenario("cuadra");
        let conv = e.con_proyecto("uno");
        e.escribir_reglas("# Reglas\nUsa pnpm.");
        e.aprobar_reglas(&conv);
        let m = ContextService::material_de_conversacion(&e.state, &conv).unwrap();
        assert!(
            m.reglas_aprobadas.contains("Usa pnpm."),
            "{}",
            m.reglas_aprobadas
        );
        let p = m.proyecto.expect("la conversación tiene su proyecto");
        assert_eq!(p.raiz, e.raiz_proyecto);
        assert_eq!(p.approval_level, "approve_for_me");
        // El bucle del agente, con la misma raíz por la que trabaja: mismo criterio.
        let a = ContextService::material_de_agente(
            &e.state,
            &state::Settings::default(),
            &conv,
            &p.raiz,
        )
        .unwrap();
        assert_eq!(a.reglas_aprobadas, m.reglas_aprobadas);
        e.limpiar();
    }

    /// El motivo de existir del servicio: con el hash del proyecto cambiado, el
    /// `Material` trae `reglas_aprobadas` vacío por mucho texto que tenga el
    /// `HATBOO.md`. Antes de esto había cuatro recolecciones a mano y cualquiera
    /// de ellas podía haber aplicado otro criterio —o ninguno— sobre las reglas.
    #[test]
    fn con_el_hash_cambiado_el_material_llega_sin_reglas_aunque_haya_texto() {
        let e = escenario("roto");
        let conv = e.con_proyecto("dos");
        e.escribir_reglas("Usa pnpm.");
        e.aprobar_reglas(&conv);
        // Y ahora cambia el archivo sin volver a aprobar: la puerta se cierra sola.
        e.escribir_reglas("Usa npm, que dice el nuevo.\n");

        let m = ContextService::material_de_conversacion(&e.state, &conv).unwrap();
        assert!(
            m.reglas_aprobadas.is_empty(),
            "el gate se abrió con un hash que no cuadra: {:?}",
            m.reglas_aprobadas
        );
        // El resto del material sigue llegando: el gate corta las reglas, no el turno.
        assert!(m.proyecto.is_some());

        // Lo mismo por la ruta del agente, que es la que más expuesta estaba.
        let raiz = e.raiz_proyecto.clone();
        let a = ContextService::material_de_agente(
            &e.state,
            &state::Settings::default(),
            &conv,
            &raiz,
        )
        .unwrap();
        assert!(a.reglas_aprobadas.is_empty(), "{:?}", a.reglas_aprobadas);
        e.limpiar();
    }
}
