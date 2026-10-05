//! La implementación del adaptador. Este módulo **solo se compila** con la feature
//! Cargo `cerebro` (ver `cerebro/mod.rs`): sin ella el chat no ve al crate.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use sysinfo::System;
use tauri::Emitter;
use tokio::sync::mpsc::{unbounded_channel, Sender, UnboundedSender};

use crate::providers::{AiProvider, ChatMessage, ProviderError, StreamDelta};
use crate::state::Settings;

use hatboo_brain::api::error::BrainError;
use hatboo_brain::api::request::{BrainRequest, Message};
use hatboo_brain::api::response::OutputStatus;
use hatboo_brain::api::vocab::{ApprovalLevel, ExecutionPolicy, Mode, ThinkingLevel};
use hatboo_brain::brain::{Brain, Montaje, OpcionesDeCorrida};
use hatboo_brain::config::schema::{BrainConfig, Flags};
use hatboo_brain::decision::rules::Reglas;
use hatboo_brain::models::{ModeloCargado, Registry};
use hatboo_brain::observability::events::{BrainEvent, CancelToken, Emitidor};
use hatboo_brain::prompt::{Estimador, Identidad};
use hatboo_brain::providers::ModelProvider;
use hatboo_brain::providers::OllamaProvider;
use hatboo_brain::resources::{GovernorConfig, ResourceProbe};
use hatboo_brain::tools::Herramientas;

use super::almacen::AlmacenDecisiones;
use super::medidas;

/// El `product` que firma cada pedido, para poder separar en el dataset de
/// decisiones lo que salió de Hatboo y lo que salió de otro consumidor.
const PRODUCTO: &str = "hatboo";

/// `true` solo con el interruptor puesto, el proveedor activo local y el turno
/// sin imágenes.
pub fn aplicable(settings: &Settings, messages: &[ChatMessage]) -> bool {
    settings.brain_enabled
        && settings.active_provider == "local"
        && !messages.iter().any(|m| !m.images.is_empty())
}

/// Lo que el Brain decidió en este turno, en la forma que pinta la interfaz.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Traza {
    pub nivel: String,
    pub intent: String,
    pub riesgo: String,
    pub contrato: String,
    pub modelo: String,
    pub porque: String,
    pub num_ctx: u32,
    pub salida_max: u32,
    pub verificacion: String,
    pub estado_salida: String,
    pub reintentos: u8,
    pub duracion_ms: u64,
}

/// Payload del evento `chat:brain`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrazaEvento {
    pub conversation_id: String,
    pub traza: Traza,
}

/// Lo que se guarda con la respuesta del Brain para el chip honesto: el estado de
/// verificación y las métricas reales del turno (milisegundos y tokens de salida,
/// ambos del crate). Va en JSON en la columna `brain_datos`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DatosCerebro {
    estado: String,
    ms: u64,
    toks: Option<u64>,
    nivel: String,
    modelo: String,
    porque: String,
}

/// Lo que el Brain empuja hacia el hilo del chat: un delta, o la orden de retirar
/// lo mostrado. Van por el mismo canal para no perder nunca el orden relativo.
enum Pieza {
    Delta(StreamDelta),
    Retractada,
}

/// El `Emitidor` del crate reenviado al canal que ya consume
/// `spawn_chat_stream`, y que anota la traza sobre la marcha.
struct Reenviador {
    salida: UnboundedSender<Pieza>,
    traza: Arc<Mutex<Traza>>,
    /// Deltas de texto emitidos: si es cero, un fallo del Brain todavía se puede
    /// convertir en el camino de siempre sin duplicar ni una letra.
    texto_emitido: Arc<AtomicUsize>,
    retractada: Arc<Mutex<Option<String>>>,
    /// Para avisar de la decisión *en cuanto se firma*, a mitad de respuesta: la
    /// nota vive en el estado del turno en curso, y `chat:done` lo limpia.
    /// Avisar solo al final sería no avisar nunca.
    app: tauri::AppHandle,
    conv_id: String,
}

impl Reenviador {
    fn new(
        salida: UnboundedSender<Pieza>,
        traza: Arc<Mutex<Traza>>,
        texto_emitido: Arc<AtomicUsize>,
        retractada: Arc<Mutex<Option<String>>>,
        app: tauri::AppHandle,
        conv_id: String,
    ) -> Self {
        Reenviador {
            salida,
            traza,
            texto_emitido,
            retractada,
            app,
            conv_id,
        }
    }

    /// Después de una retracción lo que llegue es el reintento: pintarlo encima
    /// del texto retirado sería una burbuja con la respuesta duplicada.
    fn retractada(&self) -> bool {
        self.retractada.lock().map(|r| r.is_some()).unwrap_or(false)
    }

    fn traza(&self) -> Option<std::sync::MutexGuard<'_, Traza>> {
        self.traza.lock().ok()
    }

    /// La traza tal cual está ahora, fuera del lock: se emite con el lock suelto.
    fn copia(&self) -> Traza {
        self.traza.lock().map(|t| t.clone()).unwrap_or_default()
    }

    fn avisa(&self, traza: Traza) {
        let _ = self.app.emit(
            "chat:brain",
            TrazaEvento {
                conversation_id: self.conv_id.clone(),
                traza,
            },
        );
    }
}

impl Emitidor for Reenviador {
    fn emitir(&self, evento: BrainEvent) {
        match evento {
            BrainEvent::Token(t) => {
                if self.retractada() {
                    return;
                }
                self.texto_emitido.fetch_add(1, Ordering::SeqCst);
                let _ = self.salida.send(Pieza::Delta(StreamDelta::Text(t)));
            }
            BrainEvent::Reasoning(t) => {
                if self.retractada() {
                    return;
                }
                let _ = self
                    .salida
                    .send(Pieza::Delta(StreamDelta::Reasoning(t)));
            }
            BrainEvent::PlanCreated(p) => {
                if let Some(mut t) = self.traza() {
                    t.nivel = format!("{:?}", p.level);
                    t.intent = format!("{:?}", p.intent);
                    t.riesgo = format!("{:?}", p.risk);
                    t.contrato = format!("{:?}", p.output_contract);
                    t.verificacion = format!("{:?}", p.verification);
                    t.modelo = p.model.clone();
                    t.num_ctx = p.num_ctx;
                    t.salida_max = p.max_output_tokens;
                    if !p.reason.is_empty() {
                        t.porque = p.reason.clone();
                    }
                }
                // El Plan ya está firmado: es el momento en que el usuario puede
                // saber qué se decidió, mientras el modelo aún está escribiendo.
                self.avisa(self.copia());
            }
            BrainEvent::ModeloElegido {
                modelo,
                porque,
                desvio,
            } => {
                if let Some(mut t) = self.traza() {
                    t.modelo = modelo;
                    t.porque = if desvio {
                        format!("{porque} (desvío del modelo pedido)")
                    } else {
                        porque
                    };
                }
            }
            BrainEvent::Reintento { clase, intento } => {
                if let Some(mut t) = self.traza() {
                    t.porque = format!("{} · reintento {intento} por {clase:?}", t.porque);
                }
            }
            BrainEvent::StreamRetracted { motivo } => {
                if let Ok(mut r) = self.retractada.lock() {
                    if r.is_none() {
                        // El motivo se queda en el slot compartido: por el canal
                        // solo tiene que viajar el «retira lo mostrado», en su
                        // sitio del orden de los deltas.
                        *r = Some(motivo);
                        let _ = self.salida.send(Pieza::Retractada);
                    }
                }
            }
            // En el chat no hay tools que ejecutar, y `Completado` / `Cancelado` /
            // `Escalada` / `Verificacion` llegan al resultado final o ya están
            // anotados en la traza: no hay nada más que reenviar al hilo.
            _ => {}
        }
    }
}

/// La sonda que exige el crate: lee la RAM **del sistema**, no la que declara
/// Ollama. Medido en Fase 0: los pesos salen del page cache y se recuperan, así
/// que el `size` del servidor no es lo que le falta a la máquina.
///
/// Las dos lecturas comparten una muestra cacheada dos segundos porque el
/// Governor llama a `libre_mb` y `total_mb` seguidas, una vez por modelo
/// candidateado. `cpu()` se queda sin implementar a propósito: el porcentaje de
/// sysinfo necesita dos muestras separadas por un sueño, y esto se llama desde
/// código async. Sin medida no se afirma presión, que es lo que dice §11.
pub struct Sonda {
    cache: Mutex<Option<(Instant, u64, u64)>>,
    vida: Duration,
    /// Lo que el servidor tiene cargado, según `/api/ps`. El trait es síncrono y
    /// la lectura es HTTP, así que se rellena desde fuera (`refrescar`) al empezar
    /// cada turno: entre turnos puede estar vieja, y eso es mejor que fingir que
    /// nunca hay nada residente —con la lista vacía el Governor propone cargar lo
    /// que ya está cargado y cobra una recarga de 3,7 s que no existe.
    cargados: Mutex<Vec<ModeloCargado>>,
}

impl Sonda {
    pub fn nueva() -> Self {
        Sonda {
            cache: Mutex::new(None),
            vida: Duration::from_secs(2),
            cargados: Mutex::new(Vec::new()),
        }
    }

    /// Pregunta a Ollama qué tiene residente. Si el servidor no contesta se deja
    /// la lista como estaba: «no lo sé» no se escribe como «no hay nada».
    pub async fn refrescar(&self, ollama: &OllamaProvider) {
        if let Ok(lista) = ollama.cargados().await {
            if let Ok(mut c) = self.cargados.lock() {
                *c = lista;
            }
        }
    }

    fn lectura(&self) -> (u64, u64) {
        if let Ok(c) = self.cache.lock() {
            if let Some((cuando, libre, total)) = *c {
                if cuando.elapsed() < self.vida {
                    return (libre, total);
                }
            }
        }
        let mut sys = System::new();
        sys.refresh_memory();
        let libre = sys.available_memory() / 1_048_576;
        let total = sys.total_memory() / 1_048_576;
        if let Ok(mut c) = self.cache.lock() {
            *c = Some((Instant::now(), libre, total));
        }
        (libre, total)
    }
}

impl ResourceProbe for Sonda {
    fn libre_mb(&self) -> Option<u64> {
        Some(self.lectura().0)
    }

    fn total_mb(&self) -> Option<u64> {
        Some(self.lectura().1)
    }

    fn cargados(&self) -> Vec<ModeloCargado> {
        self.cargados.lock().map(|c| c.clone()).unwrap_or_default()
    }
}

/// Lo que Ollama declara por `/api/show` (contexto máximo, capacidades, perfil)
/// con encima la RAM residente medida en esta máquina. Las dos mitades hacen
/// falta: sin `ram_mb_by_ctx` el Governor descarta todo local (§X del Canon: lo
/// que no está medido no se afirma), y sin el resto el Selector no sabe qué puede
/// pedirle al modelo.
pub(crate) async fn function_registry(desde: &OllamaProvider) -> Result<Registry, String> {
    let mut modelos = desde
        .list_models()
        .await
        .map_err(|e| format!("Ollama no describió sus modelos: {e}"))?;
    for m in &mut modelos {
        let escalones = [2048u32, 4096, 8192];
        let tabla: std::collections::BTreeMap<u32, u64> = escalones
            .iter()
            .filter_map(|c| medidas::residente(&m.id, *c).map(|mb| (*c, mb)))
            .collect();
        if !tabla.is_empty() {
            m.ram_mb_by_ctx = tabla;
        }
    }
    Ok(Registry::nuevo(modelos))
}

/// El Brain listo para este pedido, con su `BrainRequest`. `Err` dice por qué no
/// lo hay: el llamador lo cuenta en la traza y se va al camino de siempre.
/// Divide el prompt que arma Hatboo en dos montones: lo que es **material del
/// producto** (todo lo que manda con rol `system`: identidad, plantillas activas,
/// memoria, modo código y el bloque de la búsqueda web) y lo que es conversación.
///
/// El primero se va en `BrainRequest::contexto_producto` —capa `producto` del
/// system del crate, dentro de `Presupuesto.fijo`, donde **no se recorta
/// nunca**—; el segundo en `req.history`, que es lo que el presupuesto del Plan
/// recorta de atrás hacia adelante. Antes los dos viajaban mezclados en el
/// historial, así que lo primero que se caía al apretar la ventana era justo la
/// identidad y las notas del usuario; y `providers/anthropic.rs` filtra los
/// mensajes `system` del historial, con lo que por esa puerta desaparecían sin
/// decir nada. Puro a propósito: se prueba sin pantalla ni Ollama.
fn separar_productos(messages: &[ChatMessage], ultimo_usuario: usize) -> (Vec<Message>, Vec<Message>) {
    let (producto, historial): (Vec<Message>, Vec<Message>) = messages
        .iter()
        .enumerate()
        .filter(|(i, _)| *i != ultimo_usuario)
        .map(|(_, m)| Message {
            role: m.role.clone(),
            content: m.content.clone(),
            reasoning: None,
        })
        .partition(|m| m.role == "system");
    (producto, historial)
}

async fn preparar(
    settings: &Settings,
    messages: &[ChatMessage],
    ollama: &Arc<OllamaProvider>,
    sonda: &Arc<Sonda>,
    data_dir: &std::path::Path,
) -> Result<(Brain, BrainRequest), String> {
    let ultimo_usuario = messages
        .iter()
        .rposition(|m| m.role == "user")
        .ok_or_else(|| "no hay mensaje de usuario que decidir".to_string())?;
    let mensaje = messages[ultimo_usuario].content.clone();
    let (producto, historial) = separar_productos(messages, ultimo_usuario);

    let registry = function_registry(ollama).await?;
    let reglas = Reglas::empotradas().map_err(|e| format!("las reglas embebidas no parsean: {e}"))?;
    let herramientas =
        Herramientas::empotradas().map_err(|e| format!("el catálogo de tools no parsea: {e}"))?;

    let identidad = Identidad {
        nombre: if settings.assistant_name.trim().is_empty() {
            Identidad::default().nombre
        } else {
            settings.assistant_name.clone()
        },
        ..Identidad::default()
    };

    let config = BrainConfig {
        // El dataset de decisiones es opt-in del usuario (§15.9): el crate ya
        // redacta, pero guardar su texto es decisión de la app y está apagado.
        flags: Flags {
            record_decisiones: settings.brain_dataset,
            ..Flags::default()
        },
        // §11 del plan fija el margen en 1500 MB. Es el default, y el número
        // editable de Ajustes existe para que se pueda bajar en esta máquina de
        // 8,45 GB sin tocar el código.
        governor: GovernorConfig {
            margen_mb: settings.brain_margen_mb.max(1),
            ..GovernorConfig::default()
        },
        // El razonamiento lo manda el usuario: `off` es `None`, y el Brain nunca
        // sube de ahí por su cuenta.
        thinking_ceiling: match settings.reasoning_effort.as_str() {
            "low" => Some(ThinkingLevel::Low),
            "medium" => Some(ThinkingLevel::Medium),
            "high" => Some(ThinkingLevel::High),
            _ => None,
        },
        // El modelo lo elige Hatboo, y el que elige el producto es el que corre: si
        // no cabe, no se carga otro (README del crate: «el producto elige el modelo
        // y ejecuta»). Sustituirlo costaba una recarga que nadie pidió —medido el
        // 04-10: 34,7 s y 3 tokens en un «Hola.»—.
        respetar_modelo: true,
        ..BrainConfig::default()
    };

    let mut req = BrainRequest::nuevo(PRODUCTO, Mode::CHAT, mensaje)
        .con_modelo(settings.local_model.clone())
        .con_aprobacion(ApprovalLevel::AskAlways)
        .con_policy(ExecutionPolicy::LocalOnly);
    req.history = historial;
    req.contexto_producto = producto;

    let montaje = Montaje {
        config,
        proveedores: vec![ollama.clone() as Arc<dyn ModelProvider>],
        registry,
        reglas,
        herramientas,
        sonda: sonda.clone() as Arc<dyn ResourceProbe>,
        contador: Arc::new(Estimador),
        identidad,
        // El chat no ejecuta tools ni comandos, y no lee archivos por su cuenta.
        ejecutor_tools: None,
        ejecutor_comandos: None,
        lector: None,
        // Con la bandera apagada no hay almacén ni escritura: `None` es el
        // default del crate y se respeta tal cual.
        decisiones: if settings.brain_dataset {
            Some(Arc::new(AlmacenDecisiones::nuevo(data_dir)))
        } else {
            None
        },
        // Con `LocalOnly` ninguna salida es a una API; se deja explícito igualmente.
        consentimiento_api: false,
    };
    let cerebro = Brain::nuevo(montaje).map_err(|e| format!("el Brain no se pudo montar: {e}"))?;
    Ok((cerebro, req))
}

/// El turno: decide el Brain, habla con Ollama por su propio camino y va soltando
/// el stream por el canal de siempre. Si el Brain se va al suelo **antes** del
/// primer carácter, se responde por el camino actual: el interruptor no puede
/// costar una respuesta. La única excepción es la negativa a sustituir el modelo
/// (`BrainError::ModeloPedidoNoCorre`): por el camino actual respondería **el mismo
/// modelo** que el Governor dijo que no cabe, así que ahí no se corre nada y se
/// enseñan las cifras.
pub async fn turno(
    app: tauri::AppHandle,
    conv_id: String,
    settings: Settings,
    proveedor: Arc<dyn AiProvider>,
    messages: Vec<ChatMessage>,
    data_dir: std::path::PathBuf,
    tx: Sender<StreamDelta>,
) -> Result<Option<String>, ProviderError> {
    let ollama = Arc::new(OllamaProvider::con_base(settings.local_endpoint.clone()));
    let sonda = Arc::new(Sonda::nueva());
    let (cerebro, req) = match preparar(&settings, &messages, &ollama, &sonda, &data_dir).await {
        Ok(preparado) => preparado,
        Err(motivo) => {
            avisa(&app, &conv_id, &format!("{motivo} · se respondió por el camino normal"));
            return proveedor.stream_response(messages, tx).await.map(|_| None);
        }
    };
    // Qué tiene cargado el servidor, antes de decidir: con la lista vacía el
    // Governor propone cargar lo que ya está residente y se apunta una recarga de
    // 3,7 s que no existió. Si Ollama no contesta se sigue con lo que se sepa.
    sonda.refrescar(&ollama).await;

    let traza = Arc::new(Mutex::new(Traza::default()));
    let texto_emitido = Arc::new(AtomicUsize::new(0));
    let retractada = Arc::new(Mutex::new(None));
    let (tx_local, mut rx_local) = unbounded_channel::<Pieza>();
    let emisor = Arc::new(Reenviador::new(
        tx_local,
        Arc::clone(&traza),
        Arc::clone(&texto_emitido),
        Arc::clone(&retractada),
        app.clone(),
        conv_id.clone(),
    ));
    let token = CancelToken::nuevo();
    let opciones = OpcionesDeCorrida::nueva()
        .con_eventos(emisor)
        .con_cancelacion(token.clone());

    // El emisor vive dentro de `opciones`, que se move a la corrida: su sender no
    // se cierra hasta que `run_with` devuelve, así que lo encolado se saca a mano
    // al terminar.
    let mut corrida = Box::pin(cerebro.run_with(&req, opciones));
    let resultado = loop {
        tokio::select! {
            pieza = rx_local.recv() => match pieza {
                Some(Pieza::Delta(d)) => {
                    if tx.send(d).await.is_err() {
                        // El hilo del chat cerró su receptor: eso es una
                        // cancelación del usuario, no un fallo del Brain.
                        token.cancelar();
                    }
                }
                Some(Pieza::Retractada) => {}
                // Sin emisores: la corrida ya terminó, la rama de al lado está
                // lista y se va por ahí.
                None => continue,
            },
            r = corrida.as_mut() => break r,
        }
    };
    while let Ok(Pieza::Delta(d)) = rx_local.try_recv() {
        if tx.send(d).await.is_err() {
            break;
        }
    }

    let motivo_retraccion = retractada.lock().ok().and_then(|r| r.clone());
    let (estado_salida, reintentos, duracion_ms) = match &resultado {
        Ok(r) => (format!("{:?}", r.output.status), r.metrics.reintentos, r.metrics.duracion_ms),
        Err(_) => (String::new(), 0, 0),
    };
    if let Ok(mut t) = traza.lock() {
        t.estado_salida = estado_salida.clone();
        t.reintentos = reintentos;
        t.duracion_ms = duracion_ms;
    }
    let traza_final = traza.lock().map(|t| t.clone()).unwrap_or_default();
    // Lo que va al «por qué» de la respuesta terminada. Se leen aquí, antes de que
    // `traza_final` se mueva al evento.
    let nivel_cerebro = traza_final.nivel.clone();
    let modelo_cerebro = traza_final.modelo.clone();
    let porque_cerebro = traza_final.porque.clone();
    // Primero la traza de la decisión, antes de saber si el texto se quedó: el
    // usuario tiene que poder ver qué se decidió aunque la salida se haya
    // retirado.
    let _ = app.emit(
        "chat:brain",
        TrazaEvento {
            conversation_id: conv_id.clone(),
            traza: traza_final,
        },
    );

    match resultado {
        Ok(r) => {
            // `Rechazado` es salida retirada por fallar su contrato: no se guarda
            // ni se deja como respuesta.
            if motivo_retraccion.is_some() || r.output.status == OutputStatus::Rechazado {
                let porque = motivo_retraccion
                    .unwrap_or_else(|| "la verificación retiró la respuesta".into());
                return Err(ProviderError::Malformed(porque));
            }
            // «Terminó bien» sin soltar ni una letra: sin esto se guardaría una
            // burbuja de asistente vacía. Se responde por el camino de siempre,
            // igual que el caso de error de abajo.
            if texto_emitido.load(Ordering::SeqCst) == 0 {
                avisa(
                    &app,
                    &conv_id,
                    "el Brain no escribió nada · se respondió por el camino normal",
                );
                return proveedor.stream_response(messages, tx).await.map(|_| None);
            }
            Ok(
                serde_json::to_string(&DatosCerebro {
                    estado: estado_salida,
                    ms: r.metrics.duracion_ms,
                    toks: r.metrics.tokens_salida,
                    nivel: nivel_cerebro,
                    modelo: modelo_cerebro,
                    porque: porque_cerebro,
                })
                .ok(),
            )
        }
        Err(e) => {
            let cancelado = matches!(e, BrainError::Cancelled);
            if cancelado {
                // Lo paró el usuario y el hilo ya cerró el canal: no hay error que
                // enseñar.
                return Ok(None);
            }
            // La negativa del crate a sustituir su modelo **no** se responde por el
            // camino normal: allí Ollama cargaría justo el modelo que dijo que no
            // cabe, que es el coste que `respetar_modelo` viene a quitar. Lo que
            // sube es el motivo con las cifras del Governor, tal cual las dio.
            if es_negativa_de_modelo(&e) {
                return Err(ProviderError::ModeloNoCorre(e.to_string()));
            }
            let nada_emitido = texto_emitido.load(Ordering::SeqCst) == 0;
            let sin_retraccion = retractada.lock().map(|r| r.is_none()).unwrap_or(true);
            if nada_emitido && sin_retraccion {
                avisa(&app, &conv_id, &format!("{e} · se respondió por el camino normal"));
                return proveedor.stream_response(messages, tx).await.map(|_| None);
            }
            Err(ProviderError::Malformed(e.to_string()))
        }
    }
}

/// `true` si el fallo es la negativa del crate a sustituir el modelo del producto.
/// Es el único fallo que **no** se responde por el camino de siempre: por el camino
/// de siempre Ollama cargaría el mismo modelo que el Governor dijo que no cabe, y la
/// respuesta llegaría después de una recarga que nadie pidió.
fn es_negativa_de_modelo(e: &BrainError) -> bool {
    matches!(e, BrainError::ModeloPedidoNoCorre { .. })
}

/// Una nota en la traza para los casos en que el Brain no llegó a decidir (Ollama
/// no respondió, el modelo pedido no cupo, las reglas no parsean): sin esto el
/// interruptor parecería mudo y nadie sabría por qué se respondió por el otro
/// camino.
fn avisa(app: &tauri::AppHandle, conv_id: &str, porque: &str) {
    let _ = app.emit(
        "chat:brain",
        TrazaEvento {
            conversation_id: conv_id.to_string(),
            traza: Traza {
                porque: porque.to_string(),
                ..Traza::default()
            },
        },
    );
}

#[cfg(test)]
mod tests {
    use super::{aplicable, es_negativa_de_modelo};
    use crate::providers::{ChatMessage, ImagePart, ProviderError};
    use crate::state::Settings;
    use hatboo_brain::api::error::BrainError;
    use hatboo_brain::resources::ResourceProbe;

    fn turno(texto: &str, imagenes: usize) -> Vec<ChatMessage> {
        vec![ChatMessage {
            role: "user".into(),
            content: texto.into(),
            images: (0..imagenes)
                .map(|_| ImagePart {
                    media_type: "image/png".into(),
                    data_base64: "zz".into(),
                })
                .collect(),
        }]
    }

    /// A.2.4 por el lado del chat. Lo que Hatboo manda con rol `system` —identidad,
    /// plantillas activas, memoria, modo código y el bloque de la búsqueda web— ya
    /// no viaja en `req.history`, donde era lo primero que recortaba el Plan y lo
    /// que `providers/anthropic.rs` filtraba sin decir nada.
    #[test]
    fn el_system_de_hatboo_no_cabalg_en_el_historial_del_chat() {
        use super::separar_productos;
        let uno = |role: &str, texto: &str| ChatMessage {
            role: role.into(),
            content: texto.into(),
            images: Vec::new(),
        };
        let mensajes = vec![
            uno("system", "Eres Hatboo. Plantillas activas: · resume en una línea"),
            uno("user", "hola"),
            uno("assistant", "¿qué necesitas?"),
            uno("user", "y ahora"),
        ];
        let (producto, historial) = separar_productos(&mensajes, 3);
        assert_eq!(producto.len(), 1, "{producto:?}");
        assert!(producto[0].content.contains("resume en una línea"));
        assert_eq!(
            historial.iter().map(|m| m.role.as_str()).collect::<Vec<_>>(),
            vec!["user", "assistant"],
            "los turnos de antes, sin el system y sin el pedido de ahora"
        );
        assert!(
            !historial.iter().any(|m| m.role == "system"),
            "el system no vuelve disfrazado de historial"
        );

        // Y con un chat normal, sin nada de producto, el system del crate es
        // exactamente el de siempre: cero capas nuevas que medir.
        let (p2, h2) = separar_productos(&turno("hola", 0), 0);
        assert!(p2.is_empty() && h2.is_empty());
    }

    #[test]
    fn el_interruptor_manda_y_ningun_desvio_lo_rodea() {
        let mut s = Settings::default();
        assert!(!aplicable(&s, &turno("hola", 0)), "apagado es el default");

        s.brain_enabled = true;
        s.active_provider = "local".into();
        assert!(aplicable(&s, &turno("hola", 0)));

        s.active_provider = "groq".into();
        assert!(
            !aplicable(&s, &turno("hola", 0)),
            "sin consentimiento explícito nada sale del equipo"
        );

        s.active_provider = "local".into();
        assert!(
            !aplicable(&s, &turno("mira", 1)),
            "el Brain no ve imágenes: hay que responder por el otro camino"
        );
    }

    #[test]
    fn la_negativa_de_modelo_no_se_responde_por_el_camino_normal() {
        // El caso del 04-10: pidió `qwen3.5:0.8b`, a 2048 necesita 1063 MB y con el
        // margen de 250 MB de Ajustes quedan 1302 libres —no caben los 1313 que hace
        // falta—. Las tres cifras tienen que llegar al aviso: sin ellas el fallo no
        // se puede ni comprobar ni actuar.
        let negativa = BrainError::ModeloPedidoNoCorre {
            modelo: "qwen3.5:0.8b".into(),
            motivo: "no cabe: «qwen3.5:0.8b» necesita 1063 MB a 2048 y quedan 1302 libres (margen 250)".into(),
            needed_mb: 1313,
            margen_mb: 250,
            free_mb: 1302,
        };
        assert!(es_negativa_de_modelo(&negativa));
        let texto = ProviderError::ModeloNoCorre(negativa.mensaje()).to_string();
        assert!(
            texto.contains("qwen3.5:0.8b")
                && texto.contains("1063")
                && texto.contains("250")
                && texto.contains("1302"),
            "{texto}"
        );
        assert!(
            !texto.contains("gemma3"),
            "el aviso no propone un modelo que él no eligió: {texto}"
        );

        // Lo demás sigue cayendo al camino de siempre, que usa **el mismo modelo**
        // que eligió (ver `state::build_provider`: con el proveedor local manda
        // `settings.local_model`). Ahí el interruptor no cuesta una respuesta.
        assert!(!es_negativa_de_modelo(&BrainError::ResourceExhausted {
            needed_mb: 2400,
            free_mb: 300
        }));
        assert!(!es_negativa_de_modelo(&BrainError::Cancelled));
    }

    #[test]
    fn la_sonda_dice_lo_que_mide_y_no_inventa() {
        // En la máquina de él hay 8,45 GB: si la lectura sale cero o absurda, el
        // Governor rechazaría todo sin motivo.
        let s = super::Sonda::nueva();
        let libre = s.libre_mb().expect("libre");
        let total = s.total_mb().expect("total");
        assert!(total > 1024 && total < 1_048_576, "total absurdo: {total}");
        assert!(libre <= total, "más libre que total: {libre} de {total}");
        // Sin medida de CPU no se afirma presión: el perfil ligero por CPU no se
        // activa, que es lo que §11 quiere decir con «no adivines».
        assert!(s.cpu().is_none());
        assert!(s.cargados().is_empty());
    }

    /// Medición con el Ollama y la RAM de esta máquina, por el config que arma
    /// Hatboo. Temporal: se corre a mano y se borra.
    #[tokio::test]
    async fn temp_mide_la_negativa_con_el_config_de_hatboo() {
        use super::{preparar, OllamaProvider};
        for modelo in ["qwen3:1.7b", "gemma3:1b"] {
            let s = Settings {
                brain_enabled: true,
                active_provider: "local".into(),
                local_model: modelo.into(),
                ..Default::default()
            };
            let ollama = std::sync::Arc::new(OllamaProvider::con_base(s.local_endpoint.clone()));
            let sonda = std::sync::Arc::new(super::Sonda::nueva());
            let (cerebro, req) = preparar(
                &s,
                &turno("hola", 0),
                &ollama,
                &sonda,
                &std::path::PathBuf::from("."),
            )
            .await
            .expect("el Brain se monta contra el Ollama de esta máquina");
            println!(
                "RAM libre {} MB de {} MB",
                sonda.libre_mb().unwrap_or(0),
                sonda.total_mb().unwrap_or(0)
            );
            // `plan` pasa por el mismo `planificar` que `run` y no llama al modelo.
            match cerebro.plan(&req).await {
                Ok(p) => println!("  {modelo} → PLAN: {} a {}", p.model, p.num_ctx),
                Err(e) => println!("  {modelo} → NEGATIVA: {e}"),
            }
        }
    }
}
