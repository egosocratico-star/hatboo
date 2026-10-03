//! El puente de tools del modo trabajo: el Brain decide qué se llama y con qué
//! presupuesto, y **Hatboo** lo ejecuta (§V del Canon, «quién decide qué»). Este
//! fichero no decide nada: traduce.
//!
//! Tres piezas, porque tres son las manos que pide el `Montaje`:
//!
//! - [`EjecutorDeTools`] — `EjecutarTool` sobre el registro de `AgentTool` del
//!   proyecto. `requiere_aprobacion` delega en `needs_approval`, que es la misma
//!   función que usa el bucle de hoy: no hay dos criterios de aprobación.
//! - [`EjecutorDeComandos`] — el `Ejecutor` de verificación del crate: corre
//!   `cargo check` / `npm test` **dentro de la carpeta del proyecto**, con su
//!   tiempo de espera, y devuelve código + stdout + stderr.
//! - [`lector`] — lectura de un archivo con la ruta ya acotada, para que el
//!   contexto del Brain pueda traer hechos del proyecto sin un `Lector` imaginario.
//!
//! Lo que **no** está aquí: el `submit_plan` / `update_step` del panel de TAREAS
//! y el `agent:approval_needed` con su modal. Esas siguen en `loop_runner`, y
//! mientras el modo trabajo no las enrute por aquí, el Brain administra las tools
//! normales y el plan lo sigue contando Hatboo.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use serde_json::Value;

use hatboo_brain::api::vocab::ToolId;
use hatboo_brain::brain::EjecutarTool;
use hatboo_brain::verification::execution::{Ejecutor, Salida};
use hatboo_brain::verification::Lector;

use crate::agent::loop_runner::needs_approval;
use crate::agent::tools::AgentTool;

/// Las tools que ofrece el proyecto, con el nivel de aprobación activo de ese
/// proyecto. El Brain solo puede llamar a las que estén aquí: una fuera del Plan
/// la rechaza la puerta del crate antes de llegar.
pub struct EjecutorDeTools {
    herramientas: Vec<Arc<dyn AgentTool>>,
    raiz: PathBuf,
    nivel: String,
}

impl EjecutorDeTools {
    pub fn nuevo(herramientas: Vec<Arc<dyn AgentTool>>, raiz: PathBuf, nivel: String) -> Self {
        EjecutorDeTools {
            herramientas,
            raiz,
            nivel,
        }
    }

    fn buscar(&self, id: &str) -> Option<&Arc<dyn AgentTool>> {
        self.herramientas.iter().find(|t| t.name() == id)
    }

    /// Lo que ve el modelo en la vuelta siguiente. Las tools de Hatboo devuelven
    /// JSON; se entrega tal cual, sin resumir: un diff recortado sería una
    /// observación inventada.
    fn a_texto(v: Value) -> String {
        serde_json::to_string(&v).unwrap_or_else(|_| String::new())
    }
}

#[async_trait]
impl EjecutarTool for EjecutorDeTools {
    async fn ejecutar(&self, tool: &ToolId, args: &Value) -> Result<String, String> {
        let Some(t) = self.buscar(tool) else {
            // `Err` = clase `tool` en el escalador, que es lo que corresponde: el
            // modelo pidió algo que este proyecto no ofrece.
            return Err(format!(
                "la tool «{tool}» no la ofrece este proyecto; las disponibles son {}",
                self.nombres()
            ));
        };
        t.execute(args.clone(), &self.raiz)
            .await
            .map(Self::a_texto)
            .map_err(|e| format!("{tool}: {e}"))
    }

    fn requiere_aprobacion(&self, tool: &ToolId, _args: &Value) -> bool {
        match self.buscar(tool) {
            // Desconocida: se aprueba lo que no existe, mejor pedir que ejecutar.
            None => true,
            Some(t) => needs_approval(&self.nivel, t.risk_level()),
        }
    }
}

impl EjecutorDeTools {
    fn nombres(&self) -> String {
        if self.herramientas.is_empty() {
            return "ninguna".into();
        }
        self.herramientas
            .iter()
            .map(|t| t.name())
            .collect::<Vec<_>>()
            .join(", ")
    }
}

/// El ejecutor de comandos de verificación. Síncrono porque el trait del crate lo
/// es: se llama desde la comprobación del Plan, no desde el stream.
pub struct EjecutorDeComandos {
    /// Tope duro por comando. Un `cargo check` colgado no puede tener a un turno
    /// entero esperando sin fecha de vencimiento.
    pub tope: Duration,
}

impl Default for EjecutorDeComandos {
    fn default() -> Self {
        EjecutorDeComandos {
            tope: Duration::from_secs(120),
        }
    }
}

impl Ejecutor for EjecutorDeComandos {
    fn correr(&self, comando: &str, root: &str, timeout_s: u32) -> Result<Salida, String> {
        if root.trim().is_empty() || !Path::new(root).is_dir() {
            return Err(format!("la carpeta del proyecto no existe: {root}"));
        }
        let tope = if timeout_s > 0 {
            Duration::from_secs(timeout_s as u64)
        } else {
            self.tope
        };
        let (program, flag) = if cfg!(windows) {
            ("cmd", "/C")
        } else {
            ("sh", "-c")
        };
        let mut c = Command::new(program);
        c.arg(flag)
            .arg(comando)
            .current_dir(root)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            c.creation_flags(CREATE_NO_WINDOW);
        }

        let inicio = Instant::now();
        let hijo = c
            .spawn()
            .map_err(|e| format!("no se pudo arrancar «{comando}»: {e}"))?;
        // `wait_timeout` no está en `std`, y meter `wait-timeout` por un if es
        // una dependencia nueva: se espera por canal con un hilo que se queda con
        // el proceso. Si vence, el hilo sigue hasta que el proceso muera solo.
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = tx.send(hijo.wait_with_output());
        });
        match rx.recv_timeout(tope) {
            Ok(Ok(salida)) => Ok(Salida {
                codigo: salida.status.code().unwrap_or(-1),
                stdout: String::from_utf8_lossy(&salida.stdout).to_string(),
                stderr: String::from_utf8_lossy(&salida.stderr).to_string(),
                dur_ms: inicio.elapsed().as_millis() as u64,
            }),
            Ok(Err(e)) => Err(format!("«{comando}» no terminó: {e}")),
            Err(_) => Err(format!(
                "«{comando}» superó los {} s de espera",
                tope.as_secs()
            )),
        }
    }
}

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Lee un archivo del proyecto para el contexto del Brain. `None` = no está o no
/// se puede leer, que el crate lo toma como «no entra», no como archivo vacío.
pub fn lector(raiz: PathBuf) -> Arc<Lector> {
    Arc::new(move |ruta: &str| {
        let candidato = Path::new(ruta);
        // Sin rutas absolutas ni salidas de la carpeta: el `Lector` del crate no
        // sabe de sandbox, así que el límite lo pone esta closure.
        if candidato.is_absolute() || ruta.contains("..") {
            return None;
        }
        let completo = raiz.join(candidato);
        fs::read_to_string(&completo).ok()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::tools::{ToolError, RiskLevel};
    use async_trait::async_trait as at;
    use serde_json::json;

    struct Falsa {
        nombre: &'static str,
        riesgo: RiskLevel,
    }

    #[at]
    impl AgentTool for Falsa {
        fn name(&self) -> &str {
            self.nombre
        }
        fn description(&self) -> &str {
            "prueba"
        }
        fn risk_level(&self) -> RiskLevel {
            self.riesgo
        }
        fn input_schema(&self) -> Value {
            json!({"type": "object"})
        }
        async fn execute(&self, input: Value, _raiz: &Path) -> Result<Value, ToolError> {
            Ok(json!({ "eco": input, "tool": self.nombre }))
        }
    }

    fn puente(nivel: &str) -> EjecutorDeTools {
        EjecutorDeTools::nuevo(
            vec![
                Arc::new(Falsa {
                    nombre: "read_file",
                    riesgo: RiskLevel::Low,
                }),
                Arc::new(Falsa {
                    nombre: "write_file",
                    riesgo: RiskLevel::High,
                }),
            ],
            std::env::temp_dir(),
            nivel.into(),
        )
    }

    /// `ToolId` es `String`, y el trait lo pide por referencia: sin esto los
    /// llamadas de test parecen `&str` y no compilan.
    fn id(s: &str) -> String {
        s.to_string()
    }

    #[tokio::test]
    async fn ejecuta_lo_que_el_proyecto_ofrece_y_dice_claramente_lo_que_no() {
        let p = puente("approve_for_me");
        let r = p.ejecutar(&id("read_file"), &json!({"path": "a.rs"})).await;
        let texto = r.expect("read_file sí existe");
        assert!(texto.contains("a.rs"), "{texto}");
        assert!(texto.contains("read_file"), "{texto}");

        let e = p.ejecutar(&id("borrar_todo"), &json!({})).await.unwrap_err();
        assert!(e.contains("no la ofrece este proyecto"), "{e}");
        // La lista de disponibles va en el motivo: es lo que lee el modelo para
        // no volver a pedir lo mismo.
        assert!(e.contains("read_file") && e.contains("write_file"), "{e}");
    }

    #[test]
    fn la_aprobacion_es_la_misma_funcion_que_usa_el_bucle() {
        // Cuatro niveles × dos riesgos, contra `needs_approval`: si el puente
        // tuviera su propio criterio, el Brain aprobaría otra cosa que el bucle.
        for (nivel, escribe_pide) in [
            ("ask_always", true),
            ("approve_for_me", true),
            ("auto_sandbox", false),
            ("full_access", false),
        ] {
            let p = puente(nivel);
            assert_eq!(
                p.requiere_aprobacion(&id("write_file"), &json!({})),
                escribe_pide,
                "nivel {nivel}"
            );
            assert_eq!(
                p.requiere_aprobacion(&id("read_file"), &json!({})),
                nivel == "ask_always",
                "una lectura en {nivel}"
            );
        }
        // Desconocida: pide, siempre.
        assert!(puente("full_access").requiere_aprobacion(&id("no_existe"), &json!({})));
    }

    #[test]
    fn correr_devuelve_codigo_y_salida_o_dice_por_que_no() {
        let e = EjecutorDeComandos::default();
        let raiz = std::env::temp_dir();
        let raiz = raiz.to_str().unwrap().to_string();
        let comando = "echo hola";
        let s = e.correr(comando, &raiz, 30).expect("el eco funciona");
        assert_eq!(s.codigo, 0, "stderr: {}", s.stderr);
        assert!(s.stdout.contains("hola"), "{:?}", s.stdout);
        assert!(s.dur_ms < 30_000);

        // Carpeta inexistente: se dice, no se corre en otro sitio.
        assert!(e.correr(comando, "Z:/no/existe/naqui", 5).is_err());
        // Código distinto de cero llega como `Salida`, no como error: un
        // `cargo check` que falla es información para el modelo.
        let malo = if cfg!(windows) { "exit /b 3" } else { "exit 3" };
        let s = e.correr(malo, &raiz, 30).expect("corrió y falló");
        assert_eq!(s.codigo, 3);
    }

    #[test]
    fn el_lector_no_sale_de_la_carpeta_del_proyecto() {
        let dir = std::env::temp_dir().join("hatboo-lector-prueba");
        let _ = fs::create_dir_all(&dir);
        fs::write(dir.join("dentro.txt"), b"contenido de dentro").unwrap();
        let l = lector(dir.clone());

        assert_eq!(l("dentro.txt").as_deref(), Some("contenido de dentro"));
        assert_eq!(l("no-esta.txt"), None, "ausente = no entra, no vacío");
        assert_eq!(l("../../etc/passwd"), None, "subir con .. está cortado");
        assert_eq!(l("C:/Windows/win.ini"), None, "ruta absoluta cortada");
        let _ = fs::remove_dir_all(&dir);
    }
}
