//! El brazo del modo trabajo: el Brain administra el turno (decide, firma el
//! Plan, recorta contexto y tools, verifica y se recupera) y **Hatboo** ejecuta
//! con las mismas manos de siempre —incluido el modal de aprobación—.
//!
//! La división de la decisión es exactamente la de §V del Canon:
//!
//! - qué se llama, con qué presupuesto y cuántas veces → el crate (su bucle de
//!   tools interno, sus `max_tool_calls` y su puerta).
//! - cómo se ejecuta, dónde, y si hace falta que el usuario apruebe → `handle_agent_tool`,
//!   la MISMA función que usa el bucle de hoy. `requiere_aprobacion` se deja en
//!   `false` a propósito: si el puente aprobara por su cuenta, el Brain aprobaría
//!   otra cosa que la app. Con `ApprovalLevel::FullAccess` el crate tampoco deja
//!   llamadas pendientes — el único criterio de aprobación vive en Hatboo.
//!
//! Lo que NO hace (y se dice, no se esconde): no rellena el panel de TAREAS con
//! pasos editables. El Brain firma un Plan con `reason` y tools, no una lista de
//! pasos para que el usuario los reescriba; ese flujo (`submit_plan`/`update_step`)
//! era de Hatboo y se queda en el bucle normal mientras el modo trabajo lo use.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;
use tauri::{Emitter, Manager};

use hatboo_brain::api::request::{
    BrainRequest, Message, ProjectContext, ToolInfo, TrustState, VerifyCommands,
};
use hatboo_brain::api::vocab::{ApprovalLevel, ExecutionPolicy, Mode, ThinkingLevel, ToolId};
use hatboo_brain::brain::{Brain, EjecutarTool, Montaje, OpcionesDeCorrida};
use hatboo_brain::config::schema::{BrainConfig, Flags};
use hatboo_brain::decision::rules::Reglas;
use hatboo_brain::observability::events::{BrainEvent, CancelToken, Emitidor};
use hatboo_brain::prompt::{Estimador, Identidad};
use hatboo_brain::providers::{ModelProvider, OllamaProvider};
use hatboo_brain::resources::{GovernorConfig, ResourceProbe};
use hatboo_brain::tools::Herramientas;

use crate::agent::tools::{AgentTool, RiskLevel};
use crate::db;
use crate::providers::tool_calling::ToolCallRequest;
use crate::state::Settings;

use super::almacen::AlmacenDecisiones;
use super::herramientas::EjecutorDeComandos;
use super::real::{function_registry, Sonda};

/// El ejecutor que devuelve cada llamada al modal de siempre. Nada de aprobar por
/// cuenta propia: `handle_agent_tool` es la que mira el nivel y pregunta.
struct EjecutorConAprobacion {
    app: tauri::AppHandle,
    conv: String,
    raiz: PathBuf,
    nivel: String,
    tools: Vec<Box<dyn AgentTool>>,
    redactar: bool,
}

#[async_trait]
impl EjecutarTool for EjecutorConAprobacion {
    async fn ejecutar(&self, tool: &ToolId, args: &Value) -> Result<String, String> {
        let call = ToolCallRequest {
            id: uuid::Uuid::new_v4().to_string(),
            name: tool.clone(),
            input: args.clone(),
        };
        let (output_json, ok) = crate::agent::loop_runner::handle_agent_tool(
            &self.app,
            &self.conv,
            &self.raiz,
            &self.nivel,
            &self.tools[..],
            &call,
            self.redactar,
        )
        .await?;
        // Un rechazo o un fallo de la tool no es un éxito: si volviera como `Ok`,
        // el crate contaría la llamada como ejecutada y el veredicto saldría bueno
        // con un `{"error": …}` dentro del resultado.
        if ok {
            Ok(output_json)
        } else {
            Err(output_json)
        }
    }
}

/// El emisor: el razonamiento va al hilo (como hace el bucle), el resto se
/// consume en el resultado final. Las tools no emiten por aquí: `handle_agent_tool`
/// ya manda `agent:step_result` y `agent:approval_needed` por su cuenta.
struct ReenviadorTrabajo {
    app: tauri::AppHandle,
    conv: String,
}

impl Emitidor for ReenviadorTrabajo {
    fn emitir(&self, evento: BrainEvent) {
        match evento {
            BrainEvent::Reasoning(t) => {
                crate::agent::loop_runner::emit_reasoning(&self.app, &self.conv, &[Value::String(t)]);
            }
            // El Plan del Brain entra en el panel de TAREAS como pasos de solo
            // lectura: lo que va a llamar. No son editables —el Brain firma un
            // `reason` + tools, no una lista de pasos para reescribir—, pero el
            // panel deja de estar vacío y se ve qué se decidió antes de ejecutar.
            // `finish_done` los marca todos `done` al terminar el turno.
            BrainEvent::PlanCreated(plan) => {
                let state = self.app.state::<crate::state::AppState>();
                let pasos: Vec<String> = plan.tools.to_vec();
                let tasks = state
                    .db
                    .lock()
                    .ok()
                    .and_then(|conn| crate::db::replace_tasks(&conn, &self.conv, &pasos).ok());
                if let Some(tasks) = tasks {
                    let _ = self.app.emit(
                        "agent:plan",
                        crate::agent::loop_runner::PlanPayload {
                            conversation_id: self.conv.clone(),
                            tasks,
                        },
                    );
                }
            }
            _ => {}
        }
    }
}

/// Todo lo que el brazo necesita para montar el turno. Un struct y no once
/// argumentos sueltos: a partir de siete ya no se lee la llamada.
///
/// `skills`, `memoria` y `reglas_proyecto` los calcula `run_loop` para el bucle
/// normal y aquí llegan ya calculados; `historial` se lee solo para esta ruta. El
/// brazo no vuelve a armar por su cuenta lo que el bucle ya tiene en la mano.
pub struct TurnoDeTrabajo {
    pub app: tauri::AppHandle,
    pub conv: String,
    pub raiz: PathBuf,
    pub nivel: String,
    pub assistant_name: String,
    pub user_request: String,
    pub settings: Settings,
    pub agent_tools: Vec<Box<dyn AgentTool>>,
    pub redactar: bool,
    pub data_dir: PathBuf,
    /// Los turnos anteriores de esta misma sesión, en orden y sin el pedido de
    /// ahora. El bucle normal empieza de cero en cada encargo; el crate sí tiene
    /// canal para el historial y ese canal es `req.history`.
    pub historial: Vec<db::Message>,
    /// El bloque de plantillas activas y el de notas de memoria, tal cual los
    /// arma `db` para el prompt del bucle normal.
    pub skills: String,
    pub memoria: String,
    /// Las reglas del proyecto **después** del Trust Gate
    /// (`commands::project_rules_for_prompt`): vacío = la puerta está cerrada y no
    /// hay nada que inyectar. Se dice `reglas_proyecto` porque `Reglas` a secas es
    /// el archivo de decisiones del crate.
    pub reglas_proyecto: String,
}

/// Por qué no hubo turno del Brain. La distinción importa para el llamador:
/// antes de ejecutar nada se puede responder por el bucle de siempre sin repetir
/// trabajo; después ya se tocó el disco y repetir sería trabajo doble.
#[derive(Debug)]
pub enum FalloTrabajo {
    AntesDeEjecutar(String),
    DespuesDeEjecutar(String),
}

/// Una corrida completa del modo trabajo administrada por el Brain. Devuelve el
/// resumen final, el que el bucle le daba a `finish_done`.
pub async fn correr(p: TurnoDeTrabajo) -> Result<String, FalloTrabajo> {
    let TurnoDeTrabajo {
        app,
        conv,
        raiz,
        nivel,
        assistant_name,
        user_request,
        settings,
        agent_tools,
        redactar,
        data_dir,
        historial,
        skills,
        memoria,
        reglas_proyecto,
    } = p;

    let tools_info: Vec<ToolInfo> = agent_tools
        .iter()
        .map(|t| ToolInfo {
            id: t.name().to_string(),
            escribe: t.risk_level() == RiskLevel::High,
            descripcion: t.description().to_string(),
        })
        .collect();

    let ollama = Arc::new(OllamaProvider::con_base(settings.local_endpoint.clone()));
    let registry = function_registry(&ollama)
        .await
        .map_err(|e| FalloTrabajo::AntesDeEjecutar(format!("Ollama no describió sus modelos: {e}")))?;
    let reglas =
        Reglas::empotradas().map_err(|e| FalloTrabajo::AntesDeEjecutar(format!("las reglas no parsean: {e}")))?;
    let herramientas =
        Herramientas::empotradas().map_err(|e| FalloTrabajo::AntesDeEjecutar(format!("las tools no parsean: {e}")))?;

    let identidad = Identidad {
        nombre: if assistant_name.trim().is_empty() {
            Identidad::default().nombre
        } else {
            assistant_name
        },
        ..Identidad::default()
    };

    let config = BrainConfig {
        flags: Flags {
            record_decisiones: settings.brain_dataset,
            ..Flags::default()
        },
        governor: GovernorConfig {
            margen_mb: settings.brain_margen_mb.max(1),
            ..GovernorConfig::default()
        },
        thinking_ceiling: match settings.reasoning_effort.as_str() {
            "low" => Some(ThinkingLevel::Low),
            "medium" => Some(ThinkingLevel::Medium),
            "high" => Some(ThinkingLevel::High),
            _ => None,
        },
        // Igual que en el chat: el modelo lo eligió Hatboo y es el que tiene que
        // correr. En el modo trabajo la sustitución era además cara —un turno de
        // tools con el modelo equivocado carga el contexto y las recargas enteras—.
        respetar_modelo: true,
        ..BrainConfig::default()
    };

    let mut req = BrainRequest::nuevo(PRODUCTO, Mode::WORK, user_request)
        .con_modelo(settings.local_model.clone())
        .con_tools(tools_info)
        // La aprobación es de Hatboo (dentro de `handle_agent_tool`): el crate no
        // tiene que dejar nada pendiente. `FullAccess` es honesto aquí, no un
        // permiso real — el permiso real se pide en el modal de siempre.
        .con_aprobacion(ApprovalLevel::FullAccess)
        .con_policy(ExecutionPolicy::LocalOnly);
    req.history = historial_de_trabajo(historial, &skills, &memoria);
    let hechos = hechos_del_proyecto(&raiz);
    // El Trust Gate ya está pasado por `commands::project_rules_for_prompt`: texto
    // vacío = sin aprobar (o cambiado, o vacío), y entonces no hay `hatboo_md` que
    // el crate quiera ver. Con texto, `Aprobado` es la única marca que lo hace
    // entrar en la capa `proyecto` del system (`brain/runtime.rs`).
    let con_reglas = !reglas_proyecto.trim().is_empty();
    req.project = Some(ProjectContext {
        root: raiz.to_string_lossy().into_owned(),
        // `ProjectContext` solo admite `bool` y el crate traduce el `false` por
        // «no»: «no lo sé» no es expresable ahí. Lo que no se pudo ver se declara
        // por las dos vías que el crate sí entiende —`language: None` («sin dato»)
        // y `verify` vacío, que hace que el propio crate afirme «no se puede
        // afirmar que algo compile o pase sin correrlo»—.
        has_tests: hechos.tests.unwrap_or(false),
        has_lint: hechos.lint.unwrap_or(false),
        has_build: hechos.build.unwrap_or(false),
        language: hechos.lenguaje,
        hatboo_md: con_reglas.then_some(reglas_proyecto),
        trust_state: if con_reglas {
            TrustState::Aprobado
        } else {
            TrustState::SinRevisar
        },
        verify: hechos.verificar,
    });

    let ejecutor = Arc::new(EjecutorConAprobacion {
        app: app.clone(),
        conv: conv.clone(),
        raiz: raiz.clone(),
        nivel,
        tools: agent_tools,
        redactar,
    });

    let sonda = Arc::new(Sonda::nueva());
    sonda.refrescar(&ollama).await;

    let montaje = Montaje {
        config,
        proveedores: vec![ollama as Arc<dyn ModelProvider>],
        registry,
        reglas,
        herramientas,
        sonda: sonda as Arc<dyn ResourceProbe>,
        contador: Arc::new(Estimador),
        identidad,
        ejecutor_tools: Some(ejecutor),
        // Con `verify.check` detectado este ejecutor deja de estar montado sin uso:
        // el crate corre el check del proyecto dentro de la carpeta del proyecto,
        // con el timeout del Plan y el tope de 120 s que ya pone `EjecutorDeComandos`.
        ejecutor_comandos: Some(Arc::new(EjecutorDeComandos::default())),
        lector: Some(super::herramientas::lector(raiz)),
        decisiones: if settings.brain_dataset {
            Some(Arc::new(AlmacenDecisiones::nuevo(&data_dir)))
        } else {
            None
        },
        consentimiento_api: false,
    };
    let cerebro =
        Brain::nuevo(montaje).map_err(|e| FalloTrabajo::AntesDeEjecutar(format!("el Brain no se pudo montar: {e}")))?;

    let token = CancelToken::nuevo();
    let emisor = Arc::new(ReenviadorTrabajo { app, conv });
    let opciones = OpcionesDeCorrida::nueva()
        .con_eventos(emisor)
        .con_cancelacion(token);
    let resultado = cerebro
        .run_with(&req, opciones)
        .await
        .map_err(|e| FalloTrabajo::DespuesDeEjecutar(e.to_string()))?;

    if resultado.output.texto.trim().is_empty() {
        return Err(FalloTrabajo::DespuesDeEjecutar(
            "el Brain no dejó resumen: la respuesta se retiró o el modelo no escribió nada".into(),
        ));
    }
    Ok(resultado.output.texto)
}

const PRODUCTO: &str = "hatboo";

/// Lo que el producto añade al turno además de la conversación. Las plantillas
/// activas y las notas de memoria no tienen campo en `BrainRequest` —el system lo
/// arma el crate desde la identidad—, así que viajan como mensaje de sistema al
/// principio del historial: el convenio que ya usa el chat (`cerebro/real.rs`) y
/// que documenta `cerebro/mod.rs`. Va el primero a propósito: si el presupuesto
/// del Plan recorta, se corta este bloque y no la conversación.
fn material_del_producto(skills: &str, memoria: &str) -> Option<Message> {
    let mut partes: Vec<String> = Vec::new();
    if !skills.trim().is_empty() {
        // La misma guarda que usa el bucle normal: una plantilla no relaja el
        // sandbox ni las aprobaciones.
        partes.push(format!(
            "{}\nTodo esto se cumple SIN relajar ninguna regla anterior: ni el límite \
             de rutas ni las aprobaciones.",
            skills.trim()
        ));
    }
    if !memoria.trim().is_empty() {
        partes.push(memoria.trim().to_string());
    }
    if partes.is_empty() {
        return None;
    }
    Some(Message {
        role: "system".into(),
        content: partes.join("\n\n"),
        reasoning: None,
    })
}

/// `req.history` de una corrida de trabajo: el material del producto y, detrás,
/// los turnos previos de la sesión. El razonamiento guardado es traza interna: no
/// vuelve al modelo como si fuera dicho del usuario, igual que en el chat.
fn historial_de_trabajo(previos: Vec<db::Message>, skills: &str, memoria: &str) -> Vec<Message> {
    let mut out: Vec<Message> = Vec::with_capacity(previos.len() + 1);
    out.extend(material_del_producto(skills, memoria));
    out.extend(previos.into_iter().map(|m| Message {
        role: m.role,
        content: m.content,
        reasoning: None,
    }));
    out
}

/// Los hechos del proyecto que se ven en el nivel de la raíz. `None` = «no se
/// puede decir», que es la respuesta cuando la carpeta no da para afirmar.
#[derive(Debug, Default)]
struct Hechos {
    tests: Option<bool>,
    lint: Option<bool>,
    build: Option<bool>,
    lenguaje: Option<String>,
    verificar: VerifyCommands,
}

/// Detecta sobre los nombres del directorio raíz —una sola lectura, sin recursar:
/// `node_modules` y el árbol entero quedan fuera, que es lo que hace que esto
/// quepa en el camino del prompt— y, si hay `package.json`, sobre sus scripts
/// declarados. Los comandos son los mismos que declara §15.7 del plan del crate,
/// y se corren con el `EjecutorDeComandos` de siempre en la carpeta del proyecto.
fn hechos_del_proyecto(raiz: &Path) -> Hechos {
    let mut archivos: Vec<String> = Vec::new();
    let mut carpetas: Vec<String> = Vec::new();
    if let Ok(entradas) = std::fs::read_dir(raiz) {
        for e in entradas.flatten() {
            let nombre = e.file_name().to_string_lossy().to_lowercase();
            if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                carpetas.push(nombre);
            } else {
                archivos.push(nombre);
            }
        }
    }
    let hay = |n: &str| archivos.iter().any(|a| a == n);
    let carpeta = |n: &str| carpetas.iter().any(|c| c == n);
    let empieza_con = |p: &str| archivos.iter().any(|a| a.starts_with(p));

    if hay("cargo.toml") {
        return Hechos {
            // `cargo` compila cualquier crate y `clippy` viene con la herramienta:
            // eso sí se afirma. Los tests pueden estar dentro de `src` y desde
            // fuera no se ven, así que sin `tests/` se dice que no se sabe.
            tests: if carpeta("tests") { Some(true) } else { None },
            lint: Some(true),
            build: Some(true),
            lenguaje: Some("rust".into()),
            verificar: VerifyCommands {
                check: Some("cargo check --all-targets".into()),
                lint: Some("cargo clippy --all-targets -- -D warnings".into()),
                test: Some("cargo test --no-fail-fast".into()),
            },
        };
    }

    if hay("package.json") {
        let ts = hay("tsconfig.json");
        let lenguaje = Some(if ts { "typescript".into() } else { "javascript".into() });
        let check = ts.then_some("npx tsc --noEmit".to_string());
        let leido = std::fs::read_to_string(raiz.join("package.json"))
            .ok()
            .and_then(|t| serde_json::from_str::<Value>(&t).ok());
        let Some(paquete) = leido else {
            // `package.json` ilegible: de sus scripts no se sabe nada, y adivinar
            // `false` sería el mismo error del que se quiere salir.
            return Hechos {
                lenguaje,
                verificar: VerifyCommands {
                    check,
                    ..VerifyCommands::default()
                },
                ..Hechos::default()
            };
        };
        // Un `package.json` legible SIN `scripts` sí es afirmativo: `npm test` y
        // `npm run <x>` no existen porque no están declarados.
        let scripts = paquete.get("scripts").and_then(Value::as_object);
        let declara = |n: &str| {
            scripts
                .and_then(|s| s.get(n))
                .and_then(Value::as_str)
                .is_some_and(|s| !s.trim().is_empty())
        };
        let tests_a_la_vista = carpeta("tests")
            || carpeta("test")
            || carpeta("__tests__")
            || empieza_con("jest.config")
            || empieza_con("vitest.config");
        return Hechos {
            tests: Some(declara("test") || tests_a_la_vista),
            lint: Some(declara("lint") || empieza_con("eslint.config") || empieza_con(".eslintrc")),
            // `npm run build` solo existe si está declarado: aquí el `false` sí es
            // una afirmación, no una adivinanza.
            build: Some(declara("build")),
            lenguaje,
            verificar: VerifyCommands {
                check,
                lint: declara("lint").then_some("npm run lint".to_string()),
                test: declara("test").then_some("npm test".to_string()),
            },
        };
    }

    if hay("pyproject.toml") || hay("requirements.txt") {
        let tests = carpeta("tests") || hay("pytest.ini") || hay("conftest.py") || hay("tox.ini");
        return Hechos {
            tests: Some(tests),
            // En Python el lint lo declara el `pyproject` (ruff, flake8, nada) y
            // leerlo no está en esta tanda: mejor no afirmar.
            lint: None,
            build: None,
            lenguaje: Some("python".into()),
            verificar: VerifyCommands {
                check: None,
                lint: None,
                test: tests.then_some("pytest".to_string()),
            },
        };
    }

    // Sin marcador conocido —una carpeta de notas, o un proyecto en un
    // ecosistema que Hatboo no sabe inspeccionar— no se afirma nada.
    Hechos::default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// Cada test con su carpeta: se escriben marcadores de verdad en el disco y
    /// dos pruebas sobre la misma ruta se pisarían.
    fn carpeta_de_prueba(marcas: &[&str], scripts: Option<&str>) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hatboo-hechos-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).expect("carpeta de prueba");
        for marca in marcas {
            let ruta = dir.join(marca);
            if marca.ends_with('/') {
                fs::create_dir_all(&ruta).expect("carpeta de marcador");
            } else {
                let contenido = if *marca == "package.json" {
                    scripts.unwrap_or("{}")
                } else {
                    ""
                };
                fs::write(&ruta, contenido).expect("marcador");
            }
        }
        dir
    }

    #[test]
    fn un_proyecto_rust_ve_los_tests_el_build_y_su_comando_de_check() {
        let dir = carpeta_de_prueba(&["Cargo.toml", "tests/", "src/"], None);
        let h = hechos_del_proyecto(&dir);
        assert_eq!(h.tests, Some(true), "{h:?}");
        assert_eq!(h.build, Some(true));
        assert_eq!(h.lint, Some(true), "clippy viene con la herramienta");
        assert_eq!(h.lenguaje.as_deref(), Some("rust"));
        assert_eq!(h.verificar.check.as_deref(), Some("cargo check --all-targets"));
        assert_eq!(h.verificar.test.as_deref(), Some("cargo test --no-fail-fast"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn un_rust_sin_tests_declarados_no_inventa_un_si() {
        // Los `#[cfg(test)]` de `src` no se ven desde el nivel raíz: aquí la
        // respuesta honesta es «no lo sé», no `false` ni `true`.
        let dir = carpeta_de_prueba(&["Cargo.toml", "src/"], None);
        let h = hechos_del_proyecto(&dir);
        assert_eq!(h.tests, None, "{h:?}");
        assert_eq!(h.verificar.check.as_deref(), Some("cargo check --all-targets"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn una_carpeta_sin_marcas_no_afirma_nada() {
        let dir = carpeta_de_prueba(&["notas.md"], None);
        let h = hechos_del_proyecto(&dir);
        assert_eq!((h.tests, h.lint, h.build), (None, None, None), "{h:?}");
        assert_eq!(h.lenguaje, None);
        assert!(
            !h.verificar.alguno(),
            "sin comando detectado: el crate tiene que poder decir «no se puede afirmar»"
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn package_json_con_script_test_da_el_comando_de_npm() {
        let dir = carpeta_de_prueba(
            &["package.json"],
            Some(r#"{"scripts":{"test":"vitest run","build":"vite build"}}"#),
        );
        let h = hechos_del_proyecto(&dir);
        assert_eq!(h.verificar.test.as_deref(), Some("npm test"));
        assert_eq!(h.tests, Some(true));
        assert_eq!(h.build, Some(true), "hay script de build declarado");
        assert_eq!(h.lint, Some(false), "sin script y sin config de eslint no hay lint");
        assert_eq!(h.verificar.lint, None, "no se propone `npm run lint` de un script que no está");
        assert_eq!(h.verificar.check, None, "sin tsconfig no hay chequeo de tipos");
        assert_eq!(h.lenguaje.as_deref(), Some("javascript"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn un_typescript_sin_scripts_declarados_si_tiene_check_de_tipos() {
        let dir = carpeta_de_prueba(&["tsconfig.json", "package.json"], Some(r#"{"name":"x"}"#));
        let h = hechos_del_proyecto(&dir);
        assert_eq!(h.verificar.check.as_deref(), Some("npx tsc --noEmit"));
        assert_eq!(h.verificar.test, None);
        assert_eq!(h.lenguaje.as_deref(), Some("typescript"));
        let _ = fs::remove_dir_all(dir);
    }

    /// Un `package.json` que no parsea no es un proyecto sin scripts: ahí lo
    /// honesto es «no lo sé», no un `false` en cada casilla.
    #[test]
    fn un_package_json_roto_no_inventa_los_scripts() {
        let dir = carpeta_de_prueba(&["package.json"], Some("{ scripts: roto"));
        let h = hechos_del_proyecto(&dir);
        assert_eq!((h.tests, h.lint, h.build), (None, None, None), "{h:?}");
        assert_eq!(h.verificar.test, None);
        assert_eq!(h.verificar.check, None, "sin tsconfig no hay chequeo que proponer");
        let _ = fs::remove_dir_all(dir);
    }

    /// La guarda del sandbox viaja con el bloque, y el bloque va delante: si el
    /// presupuesto del Plan recorta, se corta el material y no la conversación.
    #[test]
    fn las_plantillas_y_la_memoria_entran_como_sistema_y_los_turnos_detras() {
        let dir = std::env::temp_dir().join(format!("hatboo-historial-{}", uuid::Uuid::new_v4()));
        let conn = db::connect(&dir.join("test.db")).expect("connect+migrate");
        let conv = db::create_conversation(&conn, "Sesión de trabajo", None).unwrap();
        db::add_message(&conn, &conv.id, "user", "crea a.txt", Some("agent")).unwrap();
        db::add_message(&conn, &conv.id, "assistant", "Listo: creé a.txt", Some("agent")).unwrap();

        let h = historial_de_trabajo(
            db::list_messages(&conn, &conv.id).unwrap(),
            "· resume en una línea",
            "· Vivo en Madrid",
        );
        assert_eq!(h.len(), 3, "{h:?}");
        assert_eq!(h[0].role, "system");
        assert!(h[0].content.contains("resume en una línea"));
        assert!(h[0].content.contains("Vivo en Madrid"));
        assert!(
            h[0].content.contains("SIN relajar ninguna regla anterior"),
            "{}",
            h[0].content
        );
        assert_eq!((h[1].role.as_str(), h[1].content.as_str()), ("user", "crea a.txt"));
        assert_eq!(
            (h[2].role.as_str(), h[2].content.as_str()),
            ("assistant", "Listo: creé a.txt")
        );
        // Sin plantillas ni notas activas no hay bloque que mandar: cero ruido.
        assert!(historial_de_trabajo(Vec::new(), "", "   ").is_empty());
        let _ = fs::remove_dir_all(dir);
    }
}
