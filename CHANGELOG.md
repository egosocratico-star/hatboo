# Change log de Hatboo

Historial de versiones. El número vivo está en `package.json`; `npm run
version:escribir` lo reparte a `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`
y al bloque generado del `README.md`, y la CI corta si están desfasados
(`npm run version:comprobar`). Las fechas son las de la etiqueta `v*`, que es
cuando se compiló el instalador, no cuando se escribió el último commit.

Formato: lo que **añadió** cada versión para quien usa la app, lo que **cambió** de
comportamiento y lo que se **quitó**. El trabajo interno de arquitectura no sale
aquí; para eso está `docs/` y `ARCHITECTURE.md`.

## [0.7.0] - 2026-10-07

Lo que hay desde `v0.6.0` (2026-09-29 → 2026-10-07). Es la primera versión con el
cerebro aparte (`hatboo-brain`) detrás de un interruptor, y la primera que se compila
en el equipo de referencia (8,45 GB, sin GPU) con estos cambios: hasta hoy eran
trabajo en `main` sin binario.

Para quien usa la app, lo que cambia de cara: el chat y el modo trabajo pueden pasar
por un cerebro que decide el esfuerzo, firma un Plan, recorta contexto y verifica la
salida — y **ya no le niega la respuesta** cuando la máquina va justa (aprieta la
ventana o gasta el margen y lo dice); el modelo que él elige es el que corre; la
interfaz tiene una sola escala de letra, una sola familia de duraciones y una sola
curva de frenado; Ajustes se partió en Básico y Avanzado; y el reconocimiento de la
máquina que costaba 4,4 s por mensaje quedó cacheado.

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
- **Y una sola dueña de la curva.** La app tenía diez `ease-*` escritos en los
  componentes que **no hacían nada**: la regla de `src/index.css` sobre el `*` está
  fuera de capa y gana a cualquier utilidad de Tailwind — ese era el segundo dueño,
  con la casualidad de que cinco de ellos pedían además una curva distinta. Fuera los
  diez (sin cambiar un píxel: lo que se veía ya era la global), fuera
  `ease-suave` del `tailwind.config.js` —una clase que no manda—, y
  `npm run prueba-movimiento` vigila ahora la curva con presupuesto 0.
- **El nivel de aprobación por defecto vuelve a poder cambiarse.** `PermissionPicker`
  era el único sitio donde se editaba `defaultApprovalLevel` —el valor con el que
  nace cada proyecto nuevo, que lee `commands/projects.rs`—, así que el resultado de
  dejarlo sin montar era que **seguía habiendo ajuste, pero no había forma de
  tocarlo**. Se quedó sin montar en la v0.5.0
  (`5bc4ee4`), cuando el selector por proyecto de la vista de Trabajo (`ApprovalLevelPicker`)
  le quitó el sitio: el import y la línea del compositor salieron en ese commit y el
  fichero se quedó detrás. El control se fue a su sitio natural,
  Ajustes → Agente, dentro de la tarjeta que ya explicaba los cuatro niveles: cuatro
  chips con el activo marcado y la misma confirmación al entrar o salir de «Acceso
  total» que tiene el selector por proyecto. Borrado el componente huérfano y sus
  cinco cadenas de traducción.
- **El pie de la barra lateral deja de repetir el buscador.** Fuera la línea fija
  «Ctrl+K busca en chats, sesiones y carpetas», que duplicaba el botón de la barra de
  título. Y al mirarla resultó que contaba **menos** de lo que busca la paleta, así
  que el tooltip del buscador dice ahora lo que hace: «Buscar en chats, sesiones,
  proyectos o modelos (Ctrl+K)». La mascota del pie se queda —es el estado del agente
  de la carpeta abierta— y eso es lo que explica su título; antes era un adorno
  `aria-hidden` con una frase de atajo al lado que no le pertenecía.
- **Ajustes tiene dos alturas.** El raíl se partió en **Básico** (General,
  Apariencia, API y modelos, Perfil, Atajos) y **Avanzado** (Agente, Skills, Memoria,
  Adjuntos, Sistema, Datos), y «Acerca de» se quedó fuera de los dos: no es un
  ajuste, es información del programa. La búsqueda del raíl filtra dentro del tramo y
  esconde el rótulo del que queda vacío.
- **El compositor, más corto y más claro.** Los chips de *Código* y *Búsqueda web*
  apagados eran dos pastillas con palabra fijada delante del cursor; ahora el chip
  apagado es un icono y **la palabra solo sale cuando el modo está puesto**, que es
  cuando tiene que ser imposible de pasar por alto (el prompt cambia con él). La nota
  del Brain enseña primero **el motivo** —lo que la frase de Ajustes promete— y las
  cifras del Plan firmado se quedan a un clic.

- **El cerebro externo, detrás de un interruptor.** El chat y el modo trabajo pueden
  pasar por [`hatboo-brain`](https://github.com/egosocratico-star/hatboo-brain):
  decide el nivel de esfuerzo, firma un Plan, recorta contexto y herramientas,
  verifica la salida y se recupera por clase de fallo. Apagado por defecto en
  ejecución; con el interruptor off el chat es byte a byte el de siempre.
- **El modelo que elegiste no se sustituye a espaldas del chat**
  (`respetar_modelo`). Si el Brain quiere otro, lo dice con el motivo y sus números;
  no lo cambia en silencio. Medido antes de decidir esto: 34,7 s y 3 tokens por un
  «Hola.» por culpa de un re routing que nadie pidió.
- **Y el Brain dejó de negar la respuesta por RAM.** Con lo de arriba puesto, un
  «hola» con `qwen2.5-coder:1.5b` se quedó sin contestación: a 2048 de ventana pide
  1109 MB, el margen de Ajustes son 250 y la sonda veía 1245 libres —faltaban 114 MB
  que un saludo no necesita—. Desde el 05-10 la escalera tiene cinco peldaños (512 y
  1024, medidos en esta máquina) y el Governor aprieta la ventana o gasta el margen,
  escribiendo en la nota la cuenta que no cuadró («Se corre a 2048 sin margen»). Lo
  mismo con el modelo residente: si su ventana ya cumple el nivel no se le mueve,
  porque cada cambio de `num_ctx` son 3,7 s medidos y el pase del gate M0 acumuló 24
  recargas. Re-medido tras el cambio, ocho saludos seguidos con el mismo modelo:
  **una** sola carga, 0 rechazos, latencia mediana 1237 ms [776–1704] con 1936 MB
  libres. Se reescribieron las dos frases de Ajustes que prometían que con el margen
  alto «el Brain cortaría todos los pedidos» — ya no corta nada por RAM.
- **El cerebro ya no reconoce la máquina en cada mensaje.** Medido con sus propios
  ajustes y su Ollama: montar el Brain costaba **4,4 s por turno** —1,4 s de
  `/api/tags` más 3,0 s de las once fichas pedidas de una en una—, y eso venía
  *delante* de la respuesta: era el «carga el modelo y después sigue el brain». Las
  fichas se piden ahora en paralelo (306 ms medidos) y el listado se cachea 90 s, así
  que el primer turno paga 1,2 s y los siguientes 0 (la sonda está escrita:
  `cargo test --no-default-features --features cerebro temp_mide -- --nocapture`). Y
  el modelo se queda templado el tiempo que manda el Governor según cómo cupo:
  15 minutos si cabía con margen, 5 si hubo que bajar la ventana, 1 minuto si hubo que
  gastar el margen —antes era el default de Ollama para todos: 5 minutos, también para
  una máquina que iba justa—). El retraso máximo para ver un modelo recién instalado
  es de 90 segundos.
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
- **La X de la barra de título sí cierra Hatboo.** El botón llamaba a `close()`, el
  manejador de cierre paraba el stream y guardaba los borradores, y el último paso es
  `destroy()` —pero a la ventana solo estaba concedido `allow-close`, no
  `allow-destroy`. El permiso denegado se tragaba en el `catch` que devuelve la pantalla
  al estado normal, y el resultado era lo que él describió: «no funciona, solo se
  reinicia la app». Añadido `core:window:allow-destroy` en
  `src-tauri/capabilities/default.json`. Comprobado sobre el binario nuevo: lanzado y
  pedido cierre normal, el proceso termina, dos veces. Y blindado el agujero que había
  detrás: el `catch` solo cubría el `destroy`, así que un fallo en cualquiera de los
  pasos previos dejaba el interruptor de «ya estoy cerrando» levantado y la X **no
  volvía a responder nunca** —ahora el apagado está en un `finally` y el interruptor se
  resetea si el `destroy` falla—.
- **Apariencia**: la paleta oscura pasa al gris industrial y la caja de entrada al
  rectángulo.
- **El texto del chat sale letra a letra.** Se veía aparecer la respuesta entera de
  golpe porque el lector de Ollama del cerebro acumulaba todo el cuerpo antes de dar
  la primera letra; ahora cada token se emite en cuanto llega. La interfaz ya agrupaba
  por cuadro de pantalla, así que el atasco no estaba ahí. Medido contra el Ollama de
  esta máquina después del arreglo: primera letra a los **197 ms**, 26 letras repartidas
  en 2,6 s (antes: una sola entrega al final).
- **Un saludo ya no puede quedarse sin respuesta.** Con el stream letra a letra, el
  tope de 30 s que el cerebro firma para un turno Instantáneo pasó a gobernar la
  generación entera (antes no regía nada: el cuerpo se leía entero por detrás). En un
  arranque en frío —modelo cargado desde cero más los ~1100 tokens de prompt del chat—
  eso corta el turno por mitad y no queda mensaje. El tope ahora es de **silencio**:
  se corta cuando deja de llegar cualquier señal durante 30 s, y el total lo fija lo que
  el propio Plan autorizó generar. Coste dicho: un turno con el razonamiento encendido
  puede correr minutos, que es lo que se pidió al poner «Medio».
- **Con un modelo que piensa, el chat deja de salir vacío.** Dos causas del mismo
  sitio: el cerebro decía «no pienses» *callando* la opción —y Ollama decidía pensar,
  gastando el tope de tokens entero en su razonamiento y devolviendo una respuesta
  vacía y truncada; con `qwen3.5:0.8b` eran 17,5 s para nada, y 3,1 s con la opción
  mandada de verdad—, y el stream no miraba la clave por la que este Ollama manda el
  pensamiento (`thinking`), así que el bloque de razonamiento se quedaba vacío aunque
  el modelo estuviera escribiéndolo. Ahora el razonamiento se ve mientras sale, y el
  interruptor de Ajustes es verdad: *off* significa que no piensa.
- **Las dos notas de debajo de cada respuesta, más claras y menos ruidosas.** La línea
  de verificación ya no pinta un punto ámbar en una respuesta de charla que no tenía
  nada que verificar, y sus etiquetas se dicen en español llano («Sin comprobar»,
  «Rechazado por el formato»). La nota morada del cerebro —`regla «charla-corta» ·
  Instantáneo · ctx 2048 · salida 192`, que era el idioma interno del crate escrito tal
  cual— pasa a `Cerebro · Instantáneo · qwen2.5:1.5b`, y las cifras (ventana, tope de
  salida, verificación) y el motivo completo se quedan a un clic dentro del desplegable,
  en el mismo tamaño micro que el resto de metadatos.
- **El prompt deja de ser el mismo para todo un turno, y deja de dar tema.** Con el
  cerebro encendido, un chat que no tiene herramientas en el Plan ya no recibe las
  cinco líneas de *plan firmado / herramientas listadas / archivos*, ni los hechos del
  proyecto (raíz, tests, lint, build), ni la cuenta de aprobaciones y escrituras
  permitidas; la capa del modo lleva además una etiqueta corta del tipo de trabajo
  («Turno: una pregunta.»). Del lado de la app: el párrafo que explica el bloque de
  resultados de búsqueda solo entra con la búsqueda encendida —apagada, describía algo
  que no aparece nunca—, y se quitó del bloque de chat la frase «no tienes herramientas
  de disco en este modo». **Por qué tan poco**: la primera versión de este arreglo, de
  la tarde del 07-10, acabó recitada por el modelo —a «todo bien» contestó «Soy Hatboo… no
  tengo herramientas que aprobar ni permiso necesario en este turno; mi función es
  responder directamente a tus peticiones en español sin inventar rutas o comandos»—.
  Un modelo de 0,8 B no razona sobre lo que lee: lo repite. La regla pasó a ser que un
  turno de charla no oiga ninguna palabra sobre herramientas, permisos, ejecuciones o
  archivos, y hay una prueba que lo vigila en los dos repos. Medido sobre la copia
  volcada del prompt: el bloque de conducta del chat pasó de 3878 a 3745 caracteres
  (≈1108 a ≈1070 tokens). La guía de sensibilidad (`Personas`) se queda entera: recortar
  la seguridad no era un ahorro, era un riesgo.
- **El nivel de razonamiento hace algo, y dice cuándo no.** El valor elegido llegaba
  guardado y viajaba al cerebro, pero el que firma el Plan leía otro campo —el nivel se
  pone en la configuración y el Plan miraba el pedido—, así que **en ningún nivel** se
  encendía el razonamiento: la pantalla se quedaba en «En espera…» y no había
  razonamiento que ver. Arreglado el cruce, la regla es: Instantáneo no piensa (es el
  nivel de contestar ya; reservar «Medio» son 4096 tokens y 79,7 s medidos hasta la
  primera letra de un saludo), Normal sube como mucho a Bajo, y Enfocado/Profundo honran
  lo que elegiste. Cuando el nivel apaga lo pedido, se lee en el «¿Por qué?» de la
  respuesta en vez de quedarse callado.
- **El selector de modelos lista modelos, no filas de Ollama.** El servidor devuelve
  cada modelo varias veces: dos digests distintos contestan al mismo tag y cada gguf
  importado sale además con su alias `llamacpp:<hash>`. Medido el 08-10 en esta máquina:
  **14 filas para 10 modelos**, con `gemma3:1b` y `qwen3.5:0.8b` repetidos en la lista.
  Fuera los alias duplicados y fuera la segunda fila de un mismo tag, y de paso las
  fichas (`/api/show`) se piden **todas a la vez** en vez de una detrás de otra —los
  3028 ms medidos el 06-10 con once modelos, que se pagaban cada vez que se abría el
  selector—.
- **Regenerar sobre una pregunta que se quedó sin respuesta.** Si el último mensaje es
  del usuario, no había nada que retroceder y el botón contestaba «No hay respuesta que
  regenerar» —el estado exacto que dejaba el turno perdido del 07-10—. Ahora ese caso
  corre el stream sobre la pregunta directamente. Una conversación vacía sigue diciendo
  que no.
- **Lo que NO cambió, para que no se lea como resuelto.** El bloque de conducta del chat
  sigue entrando entero en cada turno: 3745 caracteres ≈ 1070 tokens después del recorte
  de arriba (eran 3878 ≈ 1108 antes), medido sobre la copia volcada del prompt. El crate
  ya no le añade lo suyo, pero la prosa del producto es materia de otra decisión —qué se
  queda, qué se acorta— y se acorta solo si él lo decide.

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
