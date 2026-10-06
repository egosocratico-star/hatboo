# Change log de Hatboo

Historial de versiones. El número vivo está en `package.json`; `npm run
version:escribir` lo reparte a `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`
y al bloque generado del `README.md`, y la CI corta si están desfasados
(`npm run version:comprobar`). Las fechas son las de la etiqueta `v*`, que es
cuando se compiló el instalador, no cuando se escribió el último commit.

Formato: lo que **añadió** cada versión para quien usa la app, lo que **cambió** de
comportamiento y lo que se **quitó**. El trabajo interno de arquitectura no sale
aquí; para eso está `docs/` y `ARCHITECTURE.md`.

## [Sin publicar] — 0.7 en curso

Lo que hay en `main` desde `v0.6.0` (2026-09-29 → 2026-10-05). Todavía no es
release: no hay binario publicado con estos cambios.

- **El ajuste de movimiento vuelve, y trae las dos cosas.** Ajustes → Apariencia
  tiene *Sistema* (manda `prefers-reduced-motion` de Windows), *Cómodo* y
  *Reducido*. Reducido corta las **iteraciones**, no solo la duración: un spinner,
  los tres puntos del chat y la mascota en «pensando/trabajando» siguen moviéndose
  (a 1,6 s), porque son la única señal de que algo está en marcha; el resto se
  queda en su postura final. El ajuste que se quitó en la 0.6.0 dejaba los bucles
  girando a 0,01 ms, que en un `animate-pulse` es un estroboscopio.
- **Una sola escala de letra, y ahora sí escala.** La interfaz tenía ~273 tamaños
  escritos en píxeles absolutos y el ajuste de *densidad* lo que mueve es el
  `font-size` del documento: al pasar a «compacta» se encogían el espaciado y el
  texto de la escala nombrada, y esos 273 se quedaban clavados. Medido, el 91 %
  eran dos tamaños (11 y 10 px). Hoy la escala son cuatro pasos nuevos en `rem`
  (`text-micro`, `text-etiqueta`, `text-ui`, `text-saludo`) completando la rampa de
  Tailwind, y ningún literal en `px`: `npm run prueba-tipografia` falla si a
  alguien se le escribe uno encima otra vez.
- **Una sola familia de duraciones** (`--mov-rapido` 120 ms, `--mov-normal` 180 ms,
  `--mov-lento` 320 ms, más la barra de descarga determinista), con su guardia
  `npm run prueba-movimiento`.

- **El cerebro externo, detrás de un interruptor.** El chat y el modo trabajo pueden
  pasar por [`hatboo-brain`](https://github.com/egosocratico-star/hatboo-brain):
  decide el nivel de esfuerzo, firma un Plan, recorta contexto y herramientas,
  verifica la salida y se recupera por clase de fallo. Apagado por defecto en
  ejecución; con el interruptor off el chat es byte a byte el de siempre.
- **El modelo que elegiste no se sustituye a espaldas del chat**
  (`respetar_modelo`). Si el Brain quiere otro, lo dice con el motivo y sus números;
  no lo cambia en silencio. Medido antes de decidir esto: 34,7 s y 3 tokens por un
  «Hola.» por culpa de un re routing que nadie pidió.
- **El modo trabajo ve el proyecto real**: historial, skills, memoria y reglas
  llegan al Brain, y la detección de lenguajes es tri-estado («no lo sé» existe).
- **Trust Gate del `HATBOO.md`**: entra al prompt solo el contenido exacto que
  aprobaste, identificado con SHA-256. Cualquier edición —tuya o de fuera— deja de
  inyectarse hasta que vuelves a aprobar. Columna `rules_hash` en el esquema.
- **Ocho plantillas de serie** y una vista de **Adjuntos** que dice quién subió
  cada archivo y de qué sesión sale.
- **Imágenes desde el `+` del chat**, ritmo del hilo y origen real de la visión (se
  deja de suponer que un modelo ve porque se llama igual que otro que sí ve).
- **TAREAS y chip de estado del Brain** en la interfaz, con el porqué de cada
  decisión y el fallback del modo trabajo a la vista.
- **Las plantillas y la memoria dejan de ser lo primero que se cae.** Con el Brain
  encendido, ese bloque viajaba como mensaje de sistema en la cabecera del historial,
  y el presupuesto del Plan corta el historial de atrás hacia adelante: si la ventana
  apretaba, se recortaba la identidad, las plantillas activas y las notas que el
  usuario escribió para que se recordaran. Ahora viaja en su propio campo del pedido
  y entra como una capa del system prompt que **no se recorta nunca**; si aun así no
  cabe todo, el Plan lo dice en su motivo en vez de cortar una plantilla a medias. De
  paso deja de desaparecer por la puerta de Anthropic, que filtra los mensajes de
  sistema del historial.
- **El `HATBOO.md` se aprueba por un solo camino.** Hasta ahora la lectura que
  inyecta reglas estaba escrita dos veces —una en la pantalla de reglas y otra en el
  bucle del agente—, con dos criterios que podían discrepar. Ahora hay una sola, así
  que la pantalla no puede decir «aprobadas» sobre un texto que el modelo no está
  recibiendo. Lo mismo con las plantillas y la memoria del chat: se recogían a mano
  en cuatro sitios; ahora en uno, con la base de datos bloqueada una sola vez.
- **CI**: clippy con `--all-targets` y `-D warnings` (destapa las tres pruebas de
  integración que llevan meses sin compilarse), y la versión comprobada contra su
  única fuente.
- **Apariencia**: la paleta oscura pasa al gris industrial y la caja de entrada al
  rectángulo.

## [0.6.0] - 2026-09-29

- **Capacidades del modelo, no su nombre**: tool calling, visión y razonamiento se
  comprueban contra lo que el proveedor declara.
- **Ajustes partido en categorías** con página *Acerca de*.
- **Diffs inline**, fuentes de lectura y estadísticas del perfil.
- **Variantes de mensaje** y panel de artefactos.
- **Sistema de tokens de geometría**: grano por paleta, dos alturas de superficie,
  popover del modelo en dos filas y foco visible en su capa.
- **Quitado**: el ajuste de movimiento *Reducido* y el recorte que obedecía a
  `prefers-reduced-motion`. Dejaba las transiciones en 0,01 ms sin quitar las
  iteraciones, lo que convertía cualquier `animate-pulse` en un estroboscopio. Si
  vuelve, tiene que traer tokens de movimiento y preferencias, no un `@media`.

## [0.5.0] - 2026-09-28

- **El agente deja de fingir**: la conducta (aprobaciones, plan, herramientas) pasa
  a ser propia de la sesión de trabajo en vez de prestada del chat.
- El razonamiento extendido **sí** llega al modo trabajo, y con Anthropic los
  bloques de pensamiento se reenvían en el historial.
- **Corregido**: frases pegadas a un elemento en línea se quedaban en español con
  la interfaz en inglés.
- **Documentado como descartado a propósito**: la memoria entre conversaciones y el
  selector Chat/Cowork.

## [0.4.0] - 2026-09-24

- **Interfaz traducible** (español, inglés, Sistema) con el español como clave.
- **Comparar la misma pregunta en 2-3 modelos** a la vez.
- **Plantillas**: instalar desde `.md` / `SKILL.md` y exportar de vuelta.
- **Descarga de modelos de Ollama con progreso** desde Ajustes.
- **Contexto desde GitHub sin clonar** y **captura de pantalla**.
- Modo trabajo: **plan editable**, chip de cambios con el diff acumulado y vista
  previa de los HTML del proyecto.
- **Ramificar** una conversación desde cualquier respuesta.
- Fuente del chat seleccionable y avatar sin subir archivo.
- **Corregido**: el scroll durante el streaming vuelve a ser directo y solo es
  suave al llegar un mensaje.

## [0.3.0] - 2026-09-23

- **Indicador de contexto** en la barra del compositor, calculado con el mismo
  historial que se envía.
- **Sandbox de rutas** y cuatro niveles de aprobación por proyecto; las claves se
  tapan (`redact`) antes de salir hacia un proveedor en la nube.
- **Copia de seguridad completa** en un JSON, importar (idempotente) y restablecer
  de fábrica con `BORRAR TODO`.
- Herramienta `web_search` en el modo trabajo; `run_command` sale como bloque con
  su código de salida y su duración.
- Barra lateral y paneles del modo trabajo plegables; **tema claro** con la paleta
  en variables CSS; atajos `Ctrl+F`, `Ctrl+K`, `Ctrl+B`.
- **Rendimiento**: streaming por frame, burbujas memoizadas y envío sin bloqueo.
- **CI en Windows** con release automática al empujar una etiqueta `v*`.
- **Quitado**: la ventana transparente con Mica detrás del webview. Probado: al
  hacer transparente el lienzo, WebView2 recomponía toda la ventana en cada
  repintado (parpadeo en chat, paneles y mascota, y el texto perdía el
  antialiasing).

## Antes de 0.3.0

`0.2.0` (commit `aaa6314`) y `0.1.0` no tienen etiqueta; los instaladores
empezaron a publicarse con `v0.3.0`. Lo que cubren: Fase 1 y 2 (chat por streaming
y modo trabajo agéntico), adjuntar imágenes multimodales, niveles de razonamiento
por proveedor, exportar a Markdown/JSON, categorías de Ajustes y atajos, editar
mensajes enviados con valoración, y `Ctrl+F`.
