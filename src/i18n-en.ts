/**
 * Traducción al inglés de la interfaz. La clave es el texto español tal cual,
 * así que una cadena que se quede sin traducir se sigue viendo en español en vez
 * de convertirse en un código ininteligible. `scripts/i18n-claves.mjs` lista las
 * claves que usa el código; las que falten aquí se comprueban en la auditoría.
 *
 * Las variables van entre llaves ({n}, {e}…) y las sustituye `t()`.
 */
export const en: Record<string, string> = {
  "1 resultado": "1 result",
  "¡Necesita tu aprobación!": "Needs your approval!",
  "¿Cómo se aprueban las acciones de Hatboo?": "How are Hatboo's actions approved?",
  "¿Qué quieres hacer en este proyecto?": "What do you want to do in this project?",
  "{m} quedó fuera de la memoria.": "{m} was unloaded from memory.",
  "{n} archivo escrito en esta sesión": "{n} file written in this session",
  "{n} archivos escritos en esta sesión": "{n} files written in this session",
  "{n} cambios": "{n} changes",
  "{n} caracteres": "{n} characters",
  "{n} de {total} pasos hechos": "{n} of {total} steps done",
  "{n} resultados": "{n} results",
  "{n} sesión(es)": "{n} session(s)",
  "Abrir Ajustes": "Open Settings",
  "Abrir carpeta": "Open folder",
  "Desplegar la barra lateral": "Expand the sidebar",
  "Abrir una carpeta existente como proyecto": "Open an existing folder as a project",
  "Acceso total activo:": "Full access is on:",
  "Acerca de": "About",
  "Activar Acceso total": "Turn on Full access",
  "Activar búsqueda web (DuckDuckGo, sin cuenta). Afecta al chat y al modo trabajo.":
    "Turn on web search (DuckDuckGo, no account). Affects chat and work mode.",
  "Activar modo código": "Turn on code mode",
  "Adjuntar archivos": "Attach files",
  ahora: "now",
  "Algo salió mal": "Something went wrong",
  "Buscando carpetas": "Looking for folders",
  "Ejecutando": "Running",
  "Sin nada por aquí": "Nothing here yet",
  "Trabajando en el proyecto": "Working on the project",
  "Antes de ejecutar cada paso explica en una línea qué hace y por qué. Al final resume qué has hecho y qué queda pendiente.":
    "Before running each step, explain in one line what it does and why. At the end, summarise what you did and what is left.",
  Añadir: "Add",
  "Añadir como contexto": "Add as context",
  "API y modelos": "API and models",
  "Archivadas ({n})": "Archived ({n})",
  // ---- Cajones de calendario de la barra lateral («Hoy» ya estaba arriba). ----
  Ayer: "Yesterday",
  "Últimos 7 días": "Last 7 days",
  "Últimos 30 días": "Last 30 days",
  "Más antiguos": "Older",
  "Ctrl+K busca en chats, sesiones y carpetas":
    "Ctrl+K searches chats, sessions and folders",
  // ---- Variantes de mensaje (‹ 2/3 ›). ----
  "Versión anterior de este mensaje": "Previous version of this message",
  "Versión siguiente de este mensaje": "Next version of this message",
  // ---- Panel de artifactos (Fase 4). ----
  "el panel de artifactos": "the artifacts panel",
  "Sin título": "Untitled",
  "El portapapeles no está disponible.": "The clipboard isn't available.",
  "Versión anterior": "Previous version",
  "Versión siguiente": "Next version",
  "Copiar el artifacto": "Copy the artifact",
  "Descargar como archivo": "Download as a file",
  "Cerrar el panel": "Close the panel",
  "{n} líneas · v{v} · {cuando}": "{n} lines · v{v} · {cuando}",
  "Abrir en el panel de la derecha": "Open in the right-hand panel",
  Abrir: "Open",
  // ---- Diffs inline (Fase 5). ----
  "{n} de {total} líneas": "{n} of {total} lines",
  "Ver las {n} líneas": "Show all {n} lines",
  "Solo lo esencial": "Just the essentials",
  "No hay líneas añadidas ni quitadas en este diff.":
    "This diff adds and removes no lines.",
  "Verlo entero": "See it whole",
  "Ver el diff": "See the diff",
  "Ver el archivo completo": "See the whole file",
  "Ver solo los cambios": "See only the changes",
  "Se aplica dentro de la carpeta del proyecto y nada más.":
    "It gets applied inside the project folder and nowhere else.",
  // ---- Patrones de la app de referencia (28-09). ----
  Artefactos: "Artifacts",
  "Tus estadísticas": "Your statistics",
  "Todo lo que sale aquí se calcula sobre tu propio historial en este PC. No se envía nada a nadie.":
    "Everything here is computed from your own history on this PC. Nothing is sent anywhere.",
  "Contando…": "Counting…",
  "Todavía no hay chats ni mensajes guardados en este PC.":
    "There are no chats or messages saved on this PC yet.",
  Chats: "Chats",
  "Tokens, estimado": "Tokens, estimated",
  "Estimación: caracteres de lo escrito entre cuatro.":
    "Estimate: characters of what was written, divided by four.",
  "Día más activo": "Busiest day",
  "{n} mensajes ese día": "{n} messages that day",
  "Chat más largo": "Longest chat",
  "Racha actual": "Current streak",
  "La más larga: {d}": "Longest: {d}",
  "{n} días": "{n} days",
  "Los tokens van estimados: el proveedor no devuelve cuántos gastó cada respuesta, así que se cuentan los caracteres del historial y se divide entre cuatro. Los días seguidos cuentan desde hoy hacia atrás, y un día sin mensajes la corta.":
    "Tokens are estimated: the provider doesn't return what each response spent, so the history's characters are counted and divided by four. Streaks count back from today, and a day without messages breaks it.",
  "Aún no has vinculado fuentes a este proyecto":
    "You haven't linked any sources to this project yet",
  "{n} fuentes de lectura en este proyecto": "{n} reading sources in this project",
  "Fuentes de este proyecto": "This project's sources",
  "El agente las lee con read_source y list_source, y nunca escribe ahí: la carpeta donde trabaja sigue siendo la del proyecto.":
    "The agent reads them with read_source and list_source and never writes there: the folder it works in is still the project's.",
  "Dale contexto a este proyecto": "Give this project context",
  "Vincula una carpeta de apuntes o un archivo de texto: todos los chats de esta carpeta podrán consultarlo.":
    "Link a notes folder or a text file: every chat in this folder can consult it.",
  carpeta: "folder",
  archivo: "file",
  "Quitar la fuente (no borra nada del disco)": "Remove the source (deletes nothing from disk)",
  "Vincular carpeta": "Link folder",
  "Añadir archivos de texto": "Add text files",
  "solo texto": "text only",
  "Arrastra para cambiar el ancho · doble clic para dejar el de fábrica":
    "Drag to resize · double-click to reset",
  "Atajos de teclado disponibles en esta versión.": "Keyboard shortcuts available in this version.",
  "Aún despiertos": "Still up",
  "Aún no has escrito archivos en esta sesión": "You haven't written any files in this session yet",
  "Aún no hay conversaciones.": "No conversations yet.",
  "Aún no hay proyectos.": "No projects yet.",
  "Avisar cuando una sesión de trabajo pida algo": "Notify when a work session asks for something",
  "Aviso enviado. Mira la esquina de Windows.": "Notification sent. Check the corner of Windows.",
  "Avisos mientras trabajas en otra ventana, y qué sale de la máquina.":
    "Notifications while you work in another window, and what leaves the machine.",
  ayer: "yesterday",
  "Ayúdame con código": "Help me with code",
  "Base de datos": "Database",
  "Borrar key": "Delete key",
  "Borrar todo": "Delete everything",
  "Buena respuesta": "Good answer",
  "Buenas noches": "Good evening",
  "Buenas tardes": "Good afternoon",
  "Buenos días": "Good morning",
  "Buscando…": "Searching…",
  "Buscar en Ajustes": "Search in Settings",
  "Buscar en el chat": "Search in this chat",
  "Buscar en la conversación": "Search the conversation",
  "Buscar en todos los chats (Ctrl+K)": "Search all chats (Ctrl+K)",
  "Buscar chats, sesiones, proyectos o modelos…": "Search chats, sessions, projects or models…",
  "Buscar chats, sesiones, proyectos o modelos": "Search chats, sessions, projects or models",
  "buscando…": "searching…",
  "Abrir la lista de proyectos": "Open the project list",
  "Usar este modelo de Ollama": "Use this Ollama model",
  proyecto: "project",
  "Buscar modelos…": "Search models…",
  "Buscar proyectos…": "Search projects…",
  "Búsqueda web activada: el chat consulta DuckDuckGo antes de responder y el modo trabajo puede pedir usar la herramienta web_search.":
    "Web search on: chat queries DuckDuckGo before answering and work mode may use the web_search tool.",
  "Cambios de esta sesión": "Changes in this session",
  Copiar: "Copy",
  "Copiar código": "Copy code",
  Copiado: "Copied",
  Cancelar: "Cancel",
  "Cancelar la tarea": "Cancel the task",
  "Carpeta vacía.": "Empty folder.",
  Cerrar: "Close",
  "Cerrar búsqueda (Esc)": "Close search (Esc)",
  "Cerrar imagen": "Close image",
  "Cerrar pestaña": "Close tab",
  "Cómo se ve Hatboo. Se aplica al elegirlo, sin guardar.":
    "How Hatboo looks. Applied as you pick it, no save needed.",
  "Cómo te trata Hatboo.": "How Hatboo treats you.",
  "Consultando Ollama…": "Asking Ollama…",
  "Consultando…": "Asking…",
  "Ver los de mi clave": "Show what my key allows",
  "{n} disponibles": "{n} available",
  "No devuelve ninguno.": "It returns none.",
  "filtrar…": "filter…",
  "Filtrar modelos": "Filter models",

  // ---- Pantalla de arranque y de cierre (etiquetas de paso: viajan por
  //      `t(variable)`, que el barrido de `npm run i18n` no ve). ----
  "Tus ajustes": "Your settings",
  "Tus conversaciones": "Your conversations",
  "Tus proyectos": "Your projects",
  "Tus plantillas": "Your templates",
  "Lo que dejaste a medias": "What you left half-written",
  "Terminar lo que estaba en marcha": "Finishing what was running",
  "Guardar lo escrito sin enviar": "Saving what was typed but not sent",
  "Leyendo lo que hay en este equipo.": "Reading what's on this machine.",
  "Cerrando Hatboo": "Closing Hatboo",
  "Terminando de guardar antes de apagar.": "Finishing up before shutting down.",
  "Copia de Hatboo": "Hatboo backup",
  "Copiar el comando y su salida": "Copy the command and its output",
  "Copiar respuesta": "Copy answer",
  "Crea la primera o añade una de los ejemplos de abajo.": "Create one, or add one of the examples below.",
  Crear: "Create",
  "Crear proyecto nuevo": "Create a new project",
  "Crear una rama desde aquí": "Create a branch from here",
  "Dejar de fijar": "Unpin",
  "Descargando…": "Downloading…",
  "Desde carpeta": "From folder",
  "Desde GitHub": "From GitHub",
  "Desplegar la barra lateral (Ctrl+B)": "Expand the sidebar (Ctrl+B)",
  "Detener la tarea en curso": "Stop the running task",
  "Detener respuesta": "Stop answer",
  "Editar mensaje": "Edit message",
  "Editar plantilla": "Edit template",
  "Ejemplo: así se vería una respuesta de Hatboo.": "Example: this is what a Hatboo answer would look like.",
  "Ejemplos para añadir": "Examples to add",
  "El agente está leyendo las reglas de este proyecto (HATBOO.md)":
    "The agent is reading this project's rules (HATBOO.md)",
  "El agente propone este plan": "The agent proposes this plan",
  "El agente todavía no escribió ningún archivo aquí.": "The agent hasn't written any files here yet.",
  "El comando no devolvió código de salida (cancelado o sin permisos)":
    "The command returned no exit code (cancelled or not permitted)",
  "«{n}» es una imagen y el modelo actual no ve imágenes.":
    "“{n}” is an image and the current model can’t see images.",
  "«{n}» es una imagen: el agente no mira fotos.":
    "“{n}” is an image: the agent doesn’t look at pictures.",
  "el chat": "the chat",
  "el modo trabajo": "work mode",
  "el plan": "the plan",

  "El proceso terminó con código {c}": "The process ended with code {c}",
  "Elige el archivo de la plantilla": "Choose the template file",
  "Elige la carpeta de la plantilla": "Choose the template folder",
  Eliminar: "Delete",
  "Eliminar sesión": "Delete session",
  "Empezar con una plantilla": "Start with a template",
  Enviar: "Send",
  "Enviar mensaje": "Send message",
  "Es la sesión abierta": "This is the open session",
  "Esta pantalla se ha roto por dentro.": "This screen broke from the inside.",
  "Tus chats y tus proyectos están a salvo en el disco: solo falló el dibujo de {zona}.":
    "Your chats and projects are safe on disk: only the drawing of {zona} failed.",
  "Reintentar la vista": "Retry this view",
  "Recargar Hatboo": "Reload Hatboo",
  "la barra lateral": "the sidebar",
  "la página de proyectos": "the projects page",
  "los ajustes": "settings",
  "Esc para cerrar": "Esc to close",
  "Escríbeme un email": "Write me an email",
  "Esta categoría está en desarrollo.": "This section is still in development.",
  "Esta semana": "This week",
  "Este mes": "This month",
  Hoy: "Today",
  Antes: "Earlier",
  "Este no comprueba si la ventana está delante: lo lanza igual.":
    "This one doesn't check whether the window is in front: it fires anyway.",
  "Explícame un error": "Explain an error to me",
  "Explicar paso a paso": "Explain step by step",
  "Exportar conversación": "Export conversation",
  "Expulsar de la memoria": "Unload from memory",
  "Ve imágenes": "Sees images",
  "Puede llamar a herramientas": "Can call tools",
  "Fijar arriba": "Pin to top",
  "Guardando…": "Saving…",
  Guardar: "Save",
  Guardada: "Saved",
  "Guardado ✓": "Saved ✓",
  "sin guardar": "unsaved",
  "No hay nada que guardar": "Nothing to save",
  "Guardar ajustes": "Save settings",
  "Guardar como archivo .md": "Save as a .md file",
  "Guardar la plantilla como archivo": "Save the template as a file",
  "hace {n} días": "{n} days ago",
  "hace {n} h": "{n} h ago",
  "hace {n} min": "{n} min ago",
  "hace {n} sem": "{n} wk ago",
  "Hace falta un modelo con visión para que Hatboo lea una captura.":
    "Hatboo needs a vision model to read a screenshot.",
  "Hatboo ejecutará TODAS las acciones sin pedir aprobación, incluida escritura de archivos y comandos. El sandbox de rutas dentro de la carpeta del proyecto se mantiene.":
    "Hatboo will run EVERY action without asking, including writing files and commands. The path sandbox inside the project folder stays.",
  "Hatboo restablecida: sin conversaciones, sin proyectos, sin claves guardadas.":
    "Hatboo reset: no conversations, no projects, no stored keys.",
  "Imágenes adjuntas": "Attached images",
  "Importar copia": "Import backup",
  "Información de la aplicación.": "Application information.",
  Idioma: "Language",
  "«Sistema» sigue el idioma de Windows. No cambia lo que escribe el modelo: eso se le pide en cada charla.":
    "“System” follows the Windows language. It doesn't change what the model writes: you ask for that in each chat.",
  "Local-first: nada sale de tu equipo salvo lo que mandes al proveedor que elijas.": "Local-first: nothing leaves your machine except what you send to the provider you pick.",
  "Mostrar la sección": "Expand the section",
  "Nuevo proyecto": "New project",
  "Ocultar la sección": "Collapse the section",
  "Quitar de arriba": "Unpin",
  "Recargar lista": "Reload the list",
  "siempre": "always",
  "Sistema": "System",
  // Las etiquetas del selector de tema. Viven en `src/temas.ts` y se traducen al
  // pintar con `t(variable)`, así que el barrido de `npm run i18n` NO las ve:
  // si se toca una allí, hay que tocarla aquí.
  Claro: "Light",
  Oscuro: "Dark",
  "Sin razonamiento": "No reasoning",
  "Paletas y tipografía": "Palettes and type",
  "Extra alto": "Extra high",
  "«Sin razonamiento» se lo pide expresamente a lo de este equipo (Ollama, llama.cpp). En la nube no hay campo que mandar: los que razonan por defecto siguen haciéndolo, y lo que pasó de verdad lo dice el «Pensó N s» de la respuesta. Aplica al chat y al modo trabajo.":
    "“No reasoning” asks for it explicitly from what runs on this machine (Ollama, llama.cpp). In the cloud there is no field to send: models that reason by default keep doing it, and what actually happened is what the “Thought for N s” on the answer says. Applies to chat and work mode.",
  "Nada en el disco todavía. Se bajan con Ollama —«ollama pull qwen3:1.7b», por ejemplo— y luego «Recargar lista».":
    "Nothing on disk yet. Models come down with Ollama —“ollama pull qwen3:1.7b”, for instance— and then “Reload the list”.",
  "El claro/oscuro de Windows": "Windows light/dark",
  "Gris papel, morado bajo": "Paper grey, low purple",
  "El de siempre, negro azulado": "The usual, blue-black",
  "Azul noche con acento cian": "Night blue with a cyan accent",
  "Índigo japonés, lavanda": "Japanese indigo, lavender",
  "Ártico, azul hielo": "Arctic, ice blue",
  "Moka, malva y lavanda": "Mocha, mauve and lavender",
  "Morado clásico sobre grafito": "Classic purple on graphite",
  "Pino rosado, apagado": "Rosy pine, muted",
  "Negro puro: píxel apagado": "Pure black: pixel off",
  "Instalar desde archivo": "Install from file",
  "La imagen ya no está en disco": "The image is no longer on disk",
  "Las archivadas no se borran: solo salen de la lista":
    "Archived ones aren't deleted: they just leave the list",
  "Leyendo…": "Reading…",
  "Limpiar conversación": "Clear conversation",
  "Limpiar esta sesión": "Clear this session",
  "Llamadas a herramientas": "Tool calls",
  "Mala respuesta": "Bad answer",
  "Menú rápido": "Quick menu",
  "Modelo local": "Local model",
  "Modo código activado: respuestas directas, con código completo":
    "Code mode on: direct answers, with complete code",
  "Modo foco en el modo trabajo (solo el chat)": "Focus mode in work view (chat only)",
  "Modo foco: solo el chat, sin barra lateral ni paneles (Ctrl+.)":
    "Focus mode: chat only, no sidebar or panels (Ctrl+.)",
  "Mostrar en el explorador de archivos": "Show in file explorer",
  "Mostrar la salida": "Show output",
  "Mostrar las tareas": "Show tasks",
  "Mostrar los archivos": "Show files",
  "Nivel de aprobación: {l} — {h}": "Approval level: {l} — {h}",
  "no ejecuta nada todavía": "doesn't run anything yet",
  "No hay proyecto abierto: se guarda como nivel por defecto de los proyectos nuevos.":
    "No project open: saved as the default level for new projects.",
  "No se pudieron leer los ajustes": "Settings could not be read",
  "No se pudo leer el estado de almacenamiento.": "Storage status could not be read.",
  "No se pudo listar los modelos de Ollama.": "Ollama models could not be listed.",
  "No se pudo listar modelos: {e}": "Models could not be listed: {e}",
  "nombre del modelo": "model name",
  "Nombre del proyecto": "Project name",
  "Nueva conversación": "New conversation",
  "Nueva conversación (Ctrl+N)": "New conversation (Ctrl+N)",
  "Nueva plantilla": "New template",
  "Nueva sesión": "New session",
  "Ocultar archivadas": "Hide archived",
  "Ocultar el razonamiento": "Hide reasoning",
  "Ocultar la salida": "Hide output",
  "Ocultar las fuentes": "Hide sources",
  "Ocultar las tareas": "Hide tasks",
  "Ocultar los archivos": "Hide files",
  "Ocultar sesiones": "Hide sessions",
  "Ollama responde pero no tiene modelos descargados.": "Ollama answers but has no models downloaded.",
  "Pensamiento extendido": "Extended thinking",
  Pensando: "Thinking",
  "Pensando…": "Thinking…",
  "En espera…": "Waiting…",
  "Preparando el código…": "Getting the code ready…",
  "Viendo la imagen…": "Looking at the image…",
  "Viendo las imágenes…": "Looking at the images…",
  "Leyendo el archivo…": "Reading the file…",
  Pensó: "Thought",
  "Plantillas de comportamiento escritas por ti.": "Behaviour templates written by you.",
  "Plegar la barra lateral (Ctrl+B)": "Collapse the sidebar (Ctrl+B)",
  "Plegar o desplegar la barra lateral": "Collapse or expand the sidebar",
  "Pregúntame lo que necesites…": "Ask me whatever you need…",
  "Preguntar antes de asumir": "Ask before assuming",
  "Preguntar siempre": "Always ask",
  "Probando…": "Testing…",
  "Probar aviso": "Test notification",
  "Probar conexión": "Test connection",
  "Probar conexión con este proveedor": "Test the connection with this provider",
  "Proveedor activo": "Active provider",
  "Proveedor de IA, credenciales y modelos.": "AI provider, credentials and models.",
  "Proyecto fijado": "Pinned project",
  "Qué debe hacer Hatboo cuando esta plantilla esté activa…":
    "What Hatboo should do when this template is on…",
  "Qué puede hacer el agente en la vista de Trabajo.": "What the agent can do in the Work view.",
  "Quitar adjunto": "Remove attachment",
  "Quitar este paso": "Remove this step",
  "Quitar proyecto": "Remove project",
  "Rama {r} · {n} archivo(s) con cambios": "Branch {r} · {n} file(s) changed",
  "Recargar modelos desde Ollama": "Reload models from Ollama",
  "Regenerar respuesta": "Regenerate answer",
  "Reglas de este proyecto": "This project's rules",
  "Reglas de este proyecto (HATBOO.md): aún no hay ninguna":
    "This project's rules (HATBOO.md): none yet",
  Reintentar: "Retry",
  "Remapear atajos llegará en una versión futura.": "Remapping shortcuts will come in a future version.",
  "Responde primero con tres viñetas de conclusión y solo después el detalle. Si falta información para concluir, dilo antes de improvisar.":
    "Answer with three conclusion bullets first and the detail after. If information is missing, say so before making it up.",
  "Restablecer de fábrica": "Factory reset",
  "Restablecer Hatboo": "Reset Hatboo",
  "Resúmeme un archivo": "Summarise a file for me",
  "Resumen de lo que hay en tu base de datos local.": "A summary of what's in your local database.",
  "Resumen ejecutivo": "Executive summary",
  "Revisa el código buscando bugs, casos sin cubrir y problemas de seguridad. Prioriza por gravedad, cita archivo y línea, y no propongas cambios de estilo.":
    "Review the code for bugs, uncovered cases and security issues. Prioritise by severity, cite file and line, and don't propose style changes.",
  "Revisar el plan antes de ejecutarlo": "Review the plan before running it",
  "Revisión de código": "Code review",
  "Rust · SQLite · keyring": "Rust · SQLite · keyring",
  "Salir de Acceso total": "Leave Full access",
  "Salir del modo foco (Ctrl+.)": "Leave focus mode (Ctrl+.)",
  "Salto de línea en el campo": "Newline in the field",
  "Se aplica a cada respuesta": "Applies to every answer",
  "Se guarda en el proyecto «{n}».": "Saved in the project “{n}”.",
  "Servidor local": "Local server",
  "Si la petición admite dos interpretaciones, pregunta cuál quiere en vez de elegir tú una. Máximo una pregunta por turno.":
    "If the request has two readings, ask which one they want instead of picking. One question per turn at most.",
  "sin clonar": "no cloning",
  "sin código": "no code",
  "Sin coincidencias.": "No matches.",
  "sin modelo": "no model",
  "Sin plan: acciones de esta tarea": "No plan: actions in this task",
  "Sin salida.": "No output.",
  "sin visión": "no vision",
  local: "local",
  "Solo se puede insertar a mano": "Can only be inserted by hand",
  "Tamaño del texto del chat": "Chat text size",
  "Tapar claves antes de enviarlas a un proveedor en la nube":
    "Mask keys before they go to a cloud provider",
  "Tarda más de lo normal; puedes cerrar y volver a abrir.":
    "Taking longer than usual; you can close and reopen.",
  "Todavía no tienes plantillas.": "You don't have any templates yet.",
  "Tomar captura": "Take a screenshot",
  "Trabajando…": "Working…",
  "Tu equipo ahora mismo y dónde guarda Hatboo sus archivos.":
    "Your machine right now, and where Hatboo keeps its files.",
  "Un proyecto es una carpeta: Hatboo lee sus archivos, propone cambios y ejecuta dentro de ella, sin salirse.": "A project is a folder: Hatboo reads its files, proposes changes and runs inside it, never stepping outside.",
  "Una carpeta que traiga su SKILL.md o README.md": "A folder containing its SKILL.md or README.md",
  "Vas a cambiar fuera de Acceso total: las tools de alto riesgo volverán a pedir aprobación.":
    "You're moving away from Full access: high-risk tools will ask for approval again.",
  "Ver el razonamiento": "Show reasoning",
  "Ver las fuentes de la web": "See the web sources",
  "Ver sesiones": "Show sessions",
  "Ver todos los proyectos": "See all projects",
  "Vista previa": "Preview",
  "Volver a calcular": "Recalculate",
  "Volver al chat desde Ajustes / cerrar un menú": "Back to chat from Settings / close a menu",

  // ---- Etiquetas de constantes en `types.ts` y las categorías de Ajustes. ----
  // Se pintan con `t(opción.label)`, así que el comprobador de cobertura no las
  // ve: son variables, no literales. Se comprueban a mano en la auditoría.
  Pequeña: "Small",
  Normal: "Normal",
  Grande: "Large",
  Mascota: "Mascot",
  Inicial: "Initial",
  Sans: "Sans",
  Serif: "Serif",
  Monoespaciada: "Monospace",
  Reducido: "Reduced",
  Bajo: "Low",
  Medio: "Medium",
  Preguntar: "Ask",
  "Aprobar por mí": "Approve for me",
  "Aprobar por mí (recomendado)": "Approve for me (recommended)",
  Automático: "Automatic",
  "Automático en sandbox": "Automatic in sandbox",
  "Acceso total": "Full access",
  Violeta: "Violet",
  Cielo: "Sky",
  Esmeralda: "Emerald",
  Ámbar: "Amber",
  Rosa: "Pink",
  Pizarra: "Slate",
  Agente: "Agent",
  Apariencia: "Appearance",
  Atajos: "Shortcuts",
  Datos: "Data",
  General: "General",
  Perfil: "Profile",
  "Anthropic (Claude)": "Anthropic (Claude)",
  "Local (Ollama / llama.cpp)": "Local (Ollama / llama.cpp)",
  // Marcas y nombres propios que se escriben igual en los dos idiomas. Los
  // idiomas de la lista se escriben siempre en su propio idioma: es la única
  // forma de que la lista sirva a quien no lee el resto de la interfaz.
  OpenAI: "OpenAI",
  Skills: "Skills",
  Emoji: "Emoji",
  Off: "Off",
  Español: "Español",
  English: "English",
  // Palabras sueltas que se ven en etiquetas cortas e iconos con texto.
  Imágenes: "Images",
  Sesión: "Session",
  Contexto: "Context",
  Código: "Code",
  código: "code",
  Versión: "Version",
  "¡Listo!": "Done!",
  // Cierre del barrido: etiquetas cortas con paréntesis o puntos suspensivos.
  "Siguiente (Enter)": "Next (Enter)",
  "Anterior (Shift+Enter)": "Previous (Shift+Enter)",
  "Buscando en la web…": "Searching the web…",
  "Cerrar (Esc)": "Close (Esc)",
  "Cerrar Hatboo": "Close Hatboo",
  "Minimizar": "Minimize",
  "Maximizar": "Maximize",
  "Restaurar": "Restore",
  "Cargando ajustes…": "Loading settings…",
  "Agente (modo trabajo)": "Agent (work mode)",
  "¿Cómo debería llamarte Hatboo?": "What should Hatboo call you?",
  "p. ej. Azrael (vacío = sin nombre)": "e.g. Azrael (blank = no name)",
  "Nombre, p. ej. Explicar paso a paso": "Name, e.g. Explain step by step",
  "Un archivo .md con cabecera «name:» y «description:», o el cuerpo a pelo":
    "A .md file with a “name:” and “description:” header, or plain body text",
  "Buscar archivos…": "Search files…",
  "Escribe aquí las convenciones del proyecto…": "Write the project's conventions here…",
  "Trabajando en la tarea…": "Working on the task…",
  "(sin diff)": "(no diff)",
  "Plegar la barra lateral": "Collapse the sidebar",
  // Etiquetas de una palabra y la frase que iba partida por un <span>.
  Imagen: "Image",
  Proyectos: "Projects",
  Razonamiento: "Reasoning",
  Modelos: "Models",
  Tema: "Theme",
  Movimiento: "Motion",
  Fuente: "Font",
  Avatar: "Avatar",
  Interfaz: "Frontend",
  Backend: "Backend",
  Proveedores: "Providers",
  activo: "active",
  "Modo Trabajo": "Work mode",
  "Cada plantilla es un trozo de instrucciones escrito por ti. Si está activada, Hatboo la aplica en todas las respuestas del chat y del modo trabajo; si no, siempre puedes insertarla en un mensaje concreto desde el botón «+» de la barra de chat.":
    "Each template is a piece of instructions you wrote. While it's on, Hatboo applies it to every chat and work-mode answer; if it's off you can still drop it into a single message from the “+” button on the chat bar.",

  // ---- Párrafos largos de Ajustes y de las vistas vacías. ----
  "Pide al modelo que razone antes de responder, en el chat y también en el modo trabajo. Solo funciona con modelos que lo soportan. En el agente cuesta más caro: piensa en cada uno de sus vueltas, no una sola vez.":
    "Asks the model to reason before answering, in chat and in work mode too. Only works with models that support it. In the agent it's pricier: it thinks on every turn, not just once.",
  "Notificación del sistema al terminar la tarea, al fallar o cuando hace falta aprobar una acción. Solo se manda si la ventana de Hatboo no está en primer plano: si la tienes delante, ya lo estás viendo.":
    "A system notification when a task finishes, fails, or needs an approval. Only sent when Hatboo's window isn't in the foreground: if it's in front of you, you already see it.",
  "Permite que el agente ejecute comandos de shell dentro del proyecto. Desactivado por defecto. Si está habilitado, si cada comando pide aprobación lo decide el nivel de aprobación del proyecto (vista Trabajo).":
    "Lets the agent run shell commands inside the project. Off by default. When enabled, whether each command asks for approval is decided by the project's approval level (Work view).",
  "Cuando el agente propone los pasos se para y te los enseña: puedes reescribirlos, quitar alguno o añadir pasos, y con lo que salga de ahí se queda el plan. Sin esto ejecuta tal cual.":
    "When the agent proposes its steps it stops and shows them to you: you can rewrite them, drop some or add more, and whatever comes out becomes the plan. Without this it runs as-is.",
  "El nivel de aprobación se ajusta por proyecto en la vista de Trabajo.":
    "The approval level is set per project in the Work view.",
  "«Sistema» sigue el claro/oscuro de Windows mientras la app esté abierta. Las paletas de debajo son fijas y se aplican al pulsarlas.":
    "“System” follows Windows light/dark while the app is open. The palettes below are fixed and apply as soon as you tap one.",
  "Afecta a las respuestas y a tus mensajes; el código va dos puntos por debajo.":
    "Affects answers and your messages; code sits two points below that.",
  "Se añade al prompt del chat y del agente para que te trate por ese nombre. Solo local.":
    "Added to the chat and agent prompt so it addresses you by that name. Local only.",
  "Hatboo te llamará «{n}». Él sigue llamándose Hatboo.":
    "Hatboo will call you “{n}”. It is still called Hatboo.",
  "como quieras": "whatever you like",
  "¿De qué forma te habla?": "What form of address does it use?",
  "De tú": "Informal (tú)",
  "De usted": "Formal (usted)",
  "Idioma de las respuestas": "Reply language",
  "El mismo en que le escribas": "Same language you write in",
  "Siempre español": "Always Spanish",
  "Siempre inglés": "Always English",
  "Una línea sobre ti (opcional)": "One line about you (optional)",
  "p. ej. Estudio programación; prefiero ejemplos cortos":
    "e.g. I'm learning to program; I prefer short examples",
  "200 caracteres como mucho. Va solo al chat: un modelo pequeño mezcla una biografía larga con las reglas del agente.":
    "200 characters at most. Chat only: a small model mixes a long biography with the agent's rules.",
  "La VRAM no se lee: el presupuesto de Hatboo es la RAM.":
    "VRAM isn't read: Hatboo budgets against RAM.",
  "Leyendo el equipo…": "Reading the machine…",
  "Disco": "Disk",
  "{libre} libres": "{libre} free",
  "{libre} libres ahora": "{libre} free right now",
  "Se relee solo mientras esta pestaña está abierta.":
    "It refreshes on its own only while this tab is open.",
  "sin GPU": "no GPU",
  "Texto": "Text",
  "Chat": "Chat",
  "Sin subir un archivo: color de una paleta fija y qué se pinta encima. Se ve en la tarjeta de perfil del lateral.":
    "No upload needed: a colour from a fixed palette and what's drawn on top. It shows on the profile card in the sidebar.",
  "No se pudo leer la base de datos ahora mismo; más abajo puedes exportar, importar o restablecer igualmente.":
    "The database couldn't be read right now; below you can still export, import or reset.",
  "Chat de IA de escritorio, local-first: sin cuentas, sin telemetría y sin alojar inferencia. Tus conversaciones viven en una base de datos SQLite local y tus claves solo en el llavero del sistema.":
    "A local-first desktop AI chat: no accounts, no telemetry, no hosted inference. Your conversations live in a local SQLite database and your keys only in the system keychain.",
  "Aplicarla siempre (si la desactivas, sigue disponible en el menú «+» del chat)":
    "Always apply it (if you turn it off it stays available in the chat's “+” menu)",
  "Hatboo lee, escribe y ejecuta dentro de una carpeta. Elige una que ya exista o crea un proyecto nuevo.":
    "Hatboo reads, writes and runs inside a folder. Pick one that already exists, or create a new project.",
  "Pide una tarea sobre este proyecto. Hatboo hará un plan, leerá archivos y pedirá aprobación antes de escribir o ejecutar.":
    "Ask for a task on this project. Hatboo will make a plan, read files, and ask for approval before writing or running anything.",
  "Cuando el agente lee un archivo del proyecto, las formas habituales de secreto (API keys, tokens de GitHub/Slack/Stripe/AWS, JWT, contraseñas en `clave = valor`, bloques de clave privada) se sustituyen por":
    "When the agent reads a project file, the usual forms of secret (API keys, GitHub/Slack/Stripe/AWS tokens, JWTs, passwords as `key = value`, private key blocks) are replaced with",
  "antes de salir hacia un proveedor en la nube, y también antes de guardarse en el historial. Con un modelo local no se toca nada. Es un filtro de patrones, no un detector perfecto.":
    "before leaving for a cloud provider, and also before being stored in the history. Local models are left alone. It's a pattern filter, not a perfect detector.",
  "Modelo de {p}": "{p} model",
  "Endpoint (compatible con Ollama / llama.cpp)": "Endpoint (Ollama / llama.cpp compatible)",
  "«Reducido» quita animaciones y transiciones solo dentro de Hatboo, sin tocar el ajuste de Windows.":
    "“Reduced” removes animations and transitions inside Hatboo only, leaving the Windows setting alone.",
  "{n} archivo(s) · {tamaño}": "{n} file(s) · {tamaño}",
  "Todo esto se calcula leyendo tu propio histórico en este PC; no se envía a ningún servicio. Las claves de API no aparecen aquí porque solo viven en el llavero del sistema. Puedes exportar una conversación concreta desde el botón «+» del chat.":
    "All of this is computed by reading your own history on this PC; nothing goes to any service. API keys don't show up here because they only live in the system keychain. You can export a specific conversation from the chat's “+” button.",
  Ajustes: "Settings",
  Mostrar: "Show",
  // Encabezados y botones de una sola palabra.
  Plantillas: "Templates",
  Confirmar: "Confirm",
  Proveedor: "Provider",
  Credenciales: "Credentials",
  Conversaciones: "Conversations",
  Archivos: "Files",
  Tareas: "Tasks",
  Argumentos: "Arguments",
  Rechazar: "Reject",
  Aprobar: "Approve",
  // Frases que van pegadas a un elemento en línea o a una expresión `{...}` y
  // que el primer barrido por líneas dejó fuera.
  Soy: "I'm",
  "Modelo ({p})": "Model ({p})",
  "Ajustes (claves, endpoints, pruebas)": "Settings (keys, endpoints, tests)",
  "Nada coincide con «{q}».": "Nothing matches “{q}”.",
  Habilitar: "Enable",
  "Se borran de este PC todas las conversaciones, los proyectos, las tareas, las imágenes adjuntas y los ajustes, y también las claves de API del llavero. No se puede deshacer: exporta una copia antes si quieres conservar algo. Escribe":
    "Every conversation, project, task, attached image and setting is deleted from this PC, along with the API keys in the keychain. This can't be undone: export a copy first if you want to keep anything. Type",
  "para confirmar.": "to confirm.",
  "Aquí irá el control de {c} de Hatboo. Todavía no está construido; volveremos en una próxima tanda.":
    "Hatboo's {c} controls will live here. It isn't built yet; we'll come back to it in a later round.",
  "{n} fuente de la web": "{n} web source",
  "{n} fuentes de la web": "{n} web sources",
  "Añadir un paso": "Add a step",
  "Se añade al prompt del agente al empezar cada sesión de trabajo de esta carpeta. No amplía el sandbox ni quita aprobaciones.":
    "It's added to the agent's prompt at the start of every work session in this folder. It doesn't widen the sandbox or remove approvals.",
  "Crear HATBOO.md": "Create HATBOO.md",
  "Cuando lo haga verás la ruta, si es nuevo o modificado y el diff, con el botón para deshacer la sesión.":
    "Once it does you'll see the path, whether it's new or modified and the diff, with a button to undo the session.",
  "el agente ejecuta todas las acciones sin pedir aprobación, incluida escritura de archivos y comandos. Las rutas siguen limitadas a la carpeta del proyecto.":
    "the agent runs every action without asking, including writing files and commands. Paths stay limited to the project folder.",
  "Este modelo no soporta tool calling — cambia de proveedor o modelo en Ajustes para usar el modo trabajo.":
    "This model doesn't support tool calling — change provider or model in Settings to use work mode.",
  "El agente quiere ejecutar": "The agent wants to run",
  "API key de {p}": "{p} API key",
  "guardada en el llavero": "stored in the keychain",
  "Copia creada con {c} conversación(es), {m} mensaje(s) y {i} imagen(es) · {kb} KB":
    "Backup created with {c} conversation(s), {m} message(s) and {i} image(s) · {kb} KB",
  "Importación terminada: {c} conversación(es) y {m} mensaje(s) nuevos":
    "Import finished: {c} conversation(s) and {m} message(s) added",
  ", {n} plantilla(s)": ", {n} template(s)",
  ", {n} elemento(s) ya estaban": ", {n} item(s) were already there",
  ", {n} imagen(es) restaurada(s)": ", {n} image(s) restored",
  ", {n} imagen(es) no estaban en la copia": ", {n} image(s) weren't in the backup",
  "Sin coincidencias para «{q}».": "Nothing matches “{q}”.",
  "Las keys se guardan en el llavero del sistema operativo, nunca en la base de datos.":
    "Keys are stored in the operating system's keychain, never in the database.",
  "Elige dónde crear el proyecto": "Choose where to create the project",
  "Se crea la carpeta, no solo se registra.": "The folder is created, not just registered.",
  "Ese nombre no vale como carpeta.": "That name can't be used for a folder.",
  "Dentro de la carpeta": "Inside the folder",
  "Elegir otra carpeta": "Choose another folder",
  "Examinar": "Browse",
  "Se creará en": "It will be created in",
  "Creando…": "Creating…",
  "Descartar": "Dismiss",
  "Leyó {b}": "Read {b}",
  "Leyó un archivo": "Read a file",
  "Leyó {n} archivos": "Read {n} files",
  "Listó {b}": "Listed {b}",
  "Listó una carpeta": "Listed a folder",
  "Listó {n} carpetas": "Listed {n} folders",
  "Buscó {b}": "Searched {b}",
  "Buscó en los archivos": "Searched the files",
  "Ejecutó {n} búsquedas": "Ran {n} searches",
  "Buscó en la web {b}": "Searched the web for {b}",
  "Buscó en la web": "Searched the web",
  "{n} búsquedas web": "{n} web searches",
  "Escribió {b}": "Wrote {b}",
  "Escribió un archivo": "Wrote a file",
  "Escribió {n} archivos": "Wrote {n} files",
  "Ejecutó {b}": "Ran {b}",
  "Ejecutó un comando": "Ran a command",
  "Ejecutó {n} comandos": "Ran {n} commands",
  "Usó una herramienta": "Used a tool",
  "{n} llamadas de herramienta": "{n} tool calls",
  // Resumen de la traza: sustituye a «Leyó 2 · Escribió 1», que no decía sobre qué.
  "{n} archivo creado": "{n} file created",
  "{n} archivos creados": "{n} files created",
  "{n} archivo modificado": "{n} file changed",
  "{n} archivos modificados": "{n} files changed",
  "Creó {b}": "Created {b}",
  "Creó un archivo": "Created a file",
  "Creó {n} archivos": "Created {n} files",
  "Salió bien": "Went fine",
  "Falló": "Failed",
  "{n} lectura": "{n} read",
  "{n} lecturas": "{n} reads",
  "{n} comando": "{n} command",
  "{n} comandos": "{n} commands",
  "{n} consulta de git": "{n} git query",
  "{n} consultas de git": "{n} git queries",
  "Sin herramientas": "No tools used",
  "Trabajando · {r}": "Working · {r}",
  "{n} fallaron": "{n} failed",
  "chat": "chat",
  "agente": "agent",
  "Da para charla rápida. Para que toque archivos de un proyecto se queda corto.": "Fine for quick chat. Too small to touch project files.",
  "Da para explicar y escribir código. Para un agente que lea, escriba y ejecute, mejor 7B o más.": "Fine for explaining and writing code. For an agent that reads, writes and runs, use 7B or more.",
  "Con este tamaño el agente ya mueve archivos y herramientas dentro del proyecto.": "At this size the agent can move files and tools inside the project.",
  "Suelta aquí lo que quieras añadir": "Drop what you want to add",
  "Una carpeta se abre como proyecto; un archivo va al mensaje.":
    "A folder opens as a project; a file goes into the message.",
  "También puedes soltar una carpeta en cualquier parte de la ventana.": "You can also drop a folder anywhere on the window.",
  "el proveedor elegido": "the provider you chose",
  "Esta respuesta sale de tu equipo": "This answer leaves your machine",
  "Se genera en tu equipo": "Generated on your machine",
  "En este PC": "On this PC",
  "Vía Ollama Cloud": "Via Ollama Cloud",
  "El historial se queda aquí. Esta respuesta la genera {m} fuera de tu equipo.": "The history stays here. This answer is produced by {m}, outside your machine.",
  "Instalar desde un .md": "Install from a .md",
  "Crear plantilla": "Create template",
  "Ajustes → Skills": "Settings → Skills",
  "Elige la plantilla": "Choose the template",
  "Plantilla instalada.": "Template installed.",
  "Nivel por defecto para lo que abras · {l}": "Default level for what you open · {l}",
  "Niveles de aprobación": "Approval levels",
  "Cada proyecto guarda su propio nivel; sin proyecto abierto, esto es el valor por defecto. Con «Acceso total» Hatboo no pide aprobación, pero las tools siguen encerradas en la carpeta del proyecto: el sandbox de rutas no se relaja nunca.": "Each project keeps its own level; with no project open this is the default. With Full access Hatboo asks for nothing, but the tools stay inside the project folder: the path sandbox is never relaxed.",
  "Cada tool, también leer.": "Every tool, reading included.",
  "Lee sola; pregunta al escribir, ejecutar o commitear.": "Reads on its own; asks before writing, running or committing.",
  "Lee y escribe solo dentro del proyecto.": "Reads and writes only inside the project.",
  "Sin preguntar. Sigue encerrado en la carpeta del proyecto.": "No questions asked. Still locked inside the project folder.",
  "Este proyecto · {l}": "This project · {l}",
  "Ollama sin modelos": "Ollama has no models",
  "{n} modelos en este PC": "{n} models on this PC",
  "Clave en el llavero": "Key in the keychain",
  "Falta la clave en el llavero": "The keychain has no key for it",
  "Ollama no responde": "Ollama is not answering",
  // Pastillas de estado de cada proveedor, en Ajustes → API
  "Activo": "Active",
  "Vacío": "Empty",
  "Configurado": "Configured",
  "Sin configurar": "Not set up",
  "Fuera de línea": "Offline",
  "Sin comprobar": "Not checked",
  "Plan: {b}": "Plan: {b}",
  "Actualizó el plan": "Updated the plan",
  "Actualizó el plan {n} veces": "Updated the plan {n} times",
  "en OneDrive": "in OneDrive",
  "OneDrive sube y baja archivos por su cuenta: puede tener bloqueado justo el que escriba el agente, o pisar un cambio al sincronizar. Si se repite, mueve el proyecto fuera de OneDrive.":
    "OneDrive moves files on its own: it can hold locked the very file the agent writes, or overwrite a change when it syncs. If it keeps happening, move the project out of OneDrive.",
  "Quitar de Hatboo": "Remove from Hatboo",
  "Borrar": "Delete",
  "Quitar": "Remove",
  "¿Borrar esta sesión de {p}?": "Delete this session from {p}?",
  "¿Borrar esta conversación?": "Delete this conversation?",
  "Se elimina el hilo. Los archivos de la carpeta no se tocan.": "The thread gets deleted. The folder's files are not touched.",
  "Se elimina el hilo con todos sus mensajes.": "The thread and all of its messages get deleted.",
  "¿Quitar {p} de Hatboo?": "Remove {p} from Hatboo?",
  "Se borran sus sesiones y su historial. La carpeta y sus archivos no se tocan.": "Its sessions and history get deleted. The folder and its files are not touched.",
  "Se borran sus sesiones. La carpeta no se toca.": "Its sessions get deleted. The folder is left alone.",
  "Chat suelto, sin carpeta de proyecto": "Loose chat, with no project folder",
  "Más opciones del proyecto": "More project options",
  "Hilo nuevo dentro de esta carpeta, con sus mismas reglas": "A new thread inside this folder, with the same rules",
  "clic derecho para más opciones; doble clic para renombrar": "right-click for more; double-click to rename",
  "Abrir Ajustes → API y modelos": "Open Settings → API and models",
  "{m} sirve para charlar; para crear o editar archivos hace falta uno de 7B o más.": "{m} is fine for chat; creating or editing files needs 7B or more.",
  "Cambiar modelo": "Change model",
  "Consultando Hugging Face…": "Asking Hugging Face…",
  "No se pudo listar los modelos de Hugging Face.": "Could not list Hugging Face models.",
  "Hugging Face responde pero no lista modelos: revisa el token y su permiso de Inference Providers.": "Hugging Face answers but lists no models: check the token and its Inference Providers permission.",
  "Vía Hugging Face": "Via Hugging Face",
  "El catálogo con buscador está en el chip del modelo, junto al compositor.": "The searchable catalog is in the model chip, next to the composer.",
  "Endpoint compatible con OpenAI": "OpenAI-compatible endpoint",
  "Por defecto el router de Hugging Face; vale también para cualquier servidor propio que hable /v1/chat/completions.": "Defaults to the Hugging Face router; any own server speaking /v1/chat/completions works too.",
  "Hugging Face (nube)": "Hugging Face (cloud)",
  // Deshacer sesión
  "· y 1 archivo más": "· and 1 more file",
  "· y {n} archivos más": "· and {n} more files",
  "¿Deshacer lo que hizo esta sesión?": "Undo what this session did?",
  "Cada archivo vuelve a como estaba antes de que Hatboo lo tocara:":
    "Each file goes back to how it was before Hatboo touched it:",
  "Los que la sesión creó se borran. No se toca ningún otro archivo.":
    "Files the session created get deleted. Nothing else is touched.",
  Deshacer: "Undo",
  "Deshacer sesión": "Undo session",
  "Devuelve cada archivo a como estaba antes de esta sesión":
    "Returns each file to how it was before this session",
  "Solo devuelve lo que la sesión pudo respaldar al escribir; no toca ningún otro archivo.":
    "It only returns what the session managed to back up while writing; nothing else is touched.",
  "No había respaldos de esta sesión: no se tocó nada.":
    "There were no backups from this session: nothing was touched.",
  "Devolvió 1 archivo: {lista}": "Returned 1 file: {lista}",
  "Devolvió {n} archivos: {lista}": "Returned {n} files: {lista}",
  " y {n} más": " and {n} more",
  nuevo: "new",
  modificado: "modified",
  " · {n} escrituras": " · {n} writes",
  // Capas del agente en la cabecera + badge de tipo de carpeta
  "ejecutar comandos (apagado en Ajustes → Agente)":
    "run commands (off in Settings → Agent)",
  "buscar en la web (apagado con el 🌐 del compositor)":
    "search the web (off with the composer's 🌐)",
  "Leer, listar, buscar archivos, escribir y git. Todo dentro de esta carpeta.":
    "Read, list, search files, write and git. All inside this folder.",
  "Ahora mismo no puede: {q}": "Right now it can't: {q}",
  tools: "tools",
  "Puede salir a internet con la búsqueda web.":
    "It can reach the internet through web search.",
  "Sin salida a internet: se activa con el 🌐 bajo el compositor.":
    "No internet: turn it on with the 🌐 under the composer.",
  web: "web",
  "sin web": "no web",
  "Ninguna plantilla activa: el prompt no lleva extras.":
    "No active template: the prompt carries nothing extra.",
  "{n} plantilla(s) activas: se añaden al prompt de cada sesión.":
    "{n} active template(s): added to every session's prompt.",
  plantillas: "templates",
  "Carpeta de código: hay repo de git o un manifiesto de proyecto arriba.":
    "Code folder: a git repo or a project manifest sits at the top.",
  "Carpeta de documentos: sin marcas de repo. El agente lee y escribe aquí igual.":
    "Documents folder: no repo markers. The agent reads and writes here the same way.",
  Docs: "Docs",
  // Prompt del sistema
  "Ver el prompt del sistema": "View the system prompt",
  "Prompt del sistema": "System prompt",
  "Copiar el prompt": "Copy the prompt",
  "Se reconstruye ahora con tus ajustes actuales; una respuesta vieja pudo mandarse con otro.":
    "It's rebuilt now with your current settings; an older answer may have gone out with another one.",
  // Estilo de la burbuja del usuario
  "Tus mensajes": "Your messages",
  "Cada tarjeta enseña cómo queda; se aplica al momento.":
    "Each card shows how it looks; it applies right away.",
  "Hola, Hatboo": "Hi, Hatboo",
  "Sólida": "Solid",
  "Morado hondo con texto blanco: el de más contraste.":
    "Deep purple with white text: the most contrast.",
  "Translúcida": "Translucent",
  "Tarjeta con el acento al 15% y esquinas de 12 px: más discreta.":
    "Card with the accent at 15% and 12px corners: more subdued.",

  // ---- Contador de contexto: ahora se abre y cuenta qué viaja. ----
  "Cuánto ocupa el próximo turno": "How much room the next turn takes",
  "Ventana de contexto": "Context window",
  "Lo fijo: identidad, reglas y plantillas": "The fixed kit: identity, rules and templates",
  "La conversación": "The conversation",
  "Lo que estás escribiendo": "What you're typing",
  "Con lo escrito hasta aquí no cabe entero: se cortará por el principio de la conversación.":
    "With what's written so far it won't fit: it would be cut from the start of the conversation.",
  Libre: "Free",
  "{usado} de {total} tokens": "{usado} of {total} tokens",
  "El techo lo pone el «num_ctx» con el que Ollama arranca este modelo.":
    "The ceiling is the `num_ctx` Ollama starts this model with.",
  "Ventana nativa del modelo: si Ollama lo arranca con menos contexto, el corte llegará antes.":
    "The model's native window: if Ollama starts it with less context, the cut comes sooner.",
  "Ventana que declara el proveedor.": "The window the provider declares.",
  "≈ {n} tokens. Este modelo no declara su ventana, así que no se saca un porcentaje de un número inventado.":
    "≈ {n} tokens. This model doesn't declare its window, so no percentage comes out of an invented number.",
  "Si desborda, el proveedor recorta por el principio y la conversación pierde su arranque: exporta y abre una nueva antes de que pase.":
    "If it overflows, the provider trims from the start and the conversation loses its opening: export it and open a new one before that happens.",
  Caracteres: "Characters",
  Mensajes: "Messages",
  "Los tokens son una estimación a ~4 caracteres por token, no el contador del proveedor.":
    "Tokens are estimated at ~4 characters per token, not the provider's own count.",
  "Las {n} imágenes van en base64 y no entran en esa estimación: suelen ser lo que más abulta.":
    "The {n} images go out as base64 and aren't in that estimate: they're usually the bulkiest part.",

  // ---- Ctrl+K: vacío ya no es un muro de texto, es un cambiador de hilos. ----
  Recientes: "Recent",
  "Escribe dos letras y buscará también dentro de los mensajes, en los proyectos y en los modelos de Ollama.":
    "Type two letters and it will also search inside messages, your projects and Ollama models.",
  navegar: "navigate",
  abrir: "open",
  cerrar: "close",

  // ---- Detalles de la segunda línea en los selects temáticos. ----
  "Cercano: «puedes pedirme…»": "Informal: it says «you can ask me…»",
  "Formal: «puede pedirme…»": "Formal: it says «you (sir/madam) can ask me…»",
  "Se decide mensaje a mensaje": "Decided message by message",
  "Aunque le escribas en otro idioma": "Even if you write to it in another language",

  // ---- Pistas de las vistas vacías del panel. ----
  "Una carpeta: el agente lee y escribe dentro de ella.":
    "A folder: the agent reads and writes inside it.",
  "En cuanto escribas en el chat, aparecerá aquí.":
    "As soon as you write in the chat, it shows up here.",

  // ---- Avisos de las carpetas que no se están mirando. ----
  "Necesita tu atención": "Needs your attention",
  "Entrar en esa sesión": "Go to that session",
  "pide aprobación": "wants approval",
  "revisa el plan": "plan to review",
  "acabó en error": "ended in error",
  "cola parada": "queue paused",

  // ---- Cabecera del modo trabajo: proyecto y sesión, cada uno con su menú. ----
  "Proyecto": "Project",
  "Está trabajando": "It's working",
  "Abrir otra carpeta": "Open another folder",
  "Sesiones de esta carpeta": "Sessions in this folder",
  "otras sesiones de esta carpeta, abajo": "other sessions in this folder, below",
  "Sin sesión abierta": "No session open",
  "Aún no hay sesiones en esta carpeta.": "This folder has no sessions yet.",

  // ---- Paneles: vista previa de archivos y reintento de lo que falló. ----
  "Ver el contenido": "View contents",
  "Ver {n} · doble clic lo añade al mensaje": "View {n} · double-click adds it to the message",
  "Cerrar la vista previa": "Close the preview",
  "{n} líneas": "{n} lines",
  "Se enseña el principio: el archivo es más grande que la vista previa.":
    "Showing the beginning: the file is larger than the preview.",
  "Vuelve a pedirle los pasos fallidos, con la orden de mirar la causa antes de repetir":
    "Ask again for the steps that failed, telling it to find the cause before repeating",
  "Estos pasos del plan fallaron y no se volvieron a intentar:":
    "These steps of the plan failed and were not retried:",
  "Antes de repetir nada, mira por qué falló cada uno y dímelo. Después inténtalo de otra manera: si una llamada ya falló dos veces, no la vuelvas a hacer igual.":
    "Before repeating anything, look into why each one failed and tell me. Then try it another way: if a call already failed twice, don't make it the same way again.",
  "Suma de lo que tardaron las acciones medidas. Lo que pensó el modelo no cuenta.":
    "Sum of the measured actions. What the model spent thinking is not counted.",

  // ---- Tanda M: sellos de hora, lectura en voz alta, menú «…», bajar al final. ----
  "Leer en voz alta": "Read aloud",
  "Detener la lectura": "Stop reading aloud",
  "Más acciones": "More actions",
  "Ir al final": "Jump to the bottom",

  // ---- Tarjetas de los archivos que escribió la tarea. ----
  PDF: "PDF",
  Archivo: "File",
  "El archivo ya no existe en disco": "The file no longer exists on disk",
  "Mostrar en la carpeta": "Show in folder",
  "Copiar ruta": "Copy path",
  "Ruta copiada": "Path copied",

  // ---- Ajustes → Memoria: notas que viajan en el prompt. ----
  Memoria: "Memory",
  "Notas tuyas que viajan en cada prompt. Hatboo no deduce nada solo: lo que no escribas aquí, no lo recuerda.":
    "Your own notes, sent with every prompt. Hatboo works nothing out on its own: if you don't write it here, it won't remember it.",
  "Sin notas todavía.": "No notes yet.",
  "Editar nota": "Edit note",
  "Borrar nota": "Delete note",
  "¿Borrar esta nota?": "Delete this note?",
  "Hatboo dejará de verla en los próximos mensajes. Las conversaciones ya escritas no cambian.":
    "Hatboo will stop seeing it in the next messages. Conversations already written don't change.",
  "Escribe algo que Hatboo deba recordar siempre…":
    "Write something Hatboo should always remember…",
  "{n} nota(s) en el prompt": "{n} note(s) in the prompt",
  "Añadir nota": "Add note",

  // ---- Tanda N: Memoria con buscador, ejemplos y el texto que recibe el modelo. ----
  "Se pega en el chat y en el modo trabajo por igual.": "Pasted into both the chat and work mode.",
  "Tus notas": "Your notes",
  "La más reciente arriba, que es como se pegan en el prompt.":
    "Newest first, which is how they go into the prompt.",
  "Buscar en las notas…": "Search the notes…",
  "Quitar el filtro": "Clear the filter",
  "Puedes empezar por una de estas:": "You can start with one of these:",
  "Dejarla escrita en el compositor": "Put it in the composer",
  "Ninguna nota contiene «{q}».": "No note contains “{q}”.",
  "Añadir una nota": "Add a note",
  "Enter para guardar; Mayús+Enter para un salto de línea.":
    "Enter to save; Shift+Enter for a line break.",
  "Sumaría ~{k} tokens a cada mensaje.": "It would add ~{k} tokens to every message.",
  "Se guarda en este equipo y no sale de aquí salvo en el prompt.":
    "Kept on this machine; it only leaves inside the prompt.",
  "Lo que ve Hatboo": "What Hatboo sees",
  "El texto exacto que se pega en el system prompt, con estas notas.":
    "The exact text pasted into the system prompt, with these notes.",
  "Con la memoria vacía no se pega nada.": "With an empty memory nothing gets pasted.",
  "Con la memoria vacía no se pega nada: el prompt no crece.":
    "With an empty memory nothing gets pasted: the prompt doesn't grow.",
  "Ver u ocultar el texto": "Show or hide the text",
  "Ver el texto": "Show the text",
  Ocultar: "Hide",
  "Ocupa ~{k} tokens en cada mensaje ({c} caracteres, {n} líneas).":
    "Takes ~{k} tokens in every message ({c} characters, {n} lines).",
  // Los ejemplos del vacío se pintan con `t(e)`, que la auditoría no ve.
  "Prefiero respuestas cortas y con ejemplos de código.":
    "I prefer short answers with code examples.",
  "Trabajo en Windows: dame las rutas en formato Windows.":
    "I work on Windows: give me paths in Windows format.",
  "Ya sé TypeScript; no me expliques lo básico.":
    "I already know TypeScript; don't explain the basics.",

  // ---- Tanda N: tarjetas de proveedor, diagnóstico y modelos de los demás. ----
  "De dónde salen las respuestas y con qué modelo.":
    "Where the answers come from, and with which model.",
  "Prueba todos los proveedores a la vez": "Test every provider at once",
  "Comprobar todos": "Check all",
  "Copia el proveedor, los modelos y si hay clave guardada. La clave no viaja.":
    "Copies the provider, the models and whether a key is saved. The key itself doesn't travel.",
  "Copiar diagnóstico": "Copy diagnostics",
  "Modelo que se usará con este proveedor": "Model that will be used with this provider",
  "Las respuestas las genera un servidor externo.": "An external server generates the answers.",
  "Sale del equipo": "Leaves this machine",
  "El que responde ahora y los que quedan apuntados en los demás proveedores.":
    "The one answering now, plus the ones kept for the other providers.",
  "Modelos de los otros proveedores": "Models for the other providers",
  "Dónde escucha Ollama o llama.cpp en este equipo.":
    "Where Ollama or llama.cpp listens on this machine.",
  // Resúmenes de PROVEEDORES: se pintan con `t(p.resumen)`.
  "Claude, de pago por uso. Fuerte en código largo.": "Claude, pay as you go. Strong on long code.",
  "GPT, de pago por uso. Herramientas fiables.": "GPT, pay as you go. Reliable tool calling.",
  "Una sola clave para cientos de modelos, también gratuitos.":
    "One key for hundreds of models, free ones included.",
  "Gemini, de Google: contexto enorme y capa gratuita.":
    "Gemini, from Google: huge context and a free tier.",
  "Modelos abiertos tras el router de Hugging Face.":
    "Open models behind the Hugging Face router.",
  "En este PC: nada sale de tu equipo.": "On this PC: nothing leaves your machine.",

  // ---- Tanda N: Perfil con vista previa del saludo y bloques. ----
  "Un ejemplo de cómo suena con estos ajustes. La frase exacta la compone el modelo.":
    "An example of how it sounds with these settings. The model writes the actual wording.",
  "Con «el mismo en que le escribas», aquí se ve en el idioma de la interfaz.":
    "With “the same one you write in”, this shows the interface language.",
  "Cómo te llama": "What it calls you",
  "Cómo te habla": "How it talks to you",
  "Trato e idioma de las respuestas.": "Form of address, and the language of the answers.",
  "Sobre ti": "About you",
  "Estilo del avatar": "Avatar style",
  "Color del avatar": "Avatar color",

  // Motor de imágenes (Ajustes → API y el menú «+» del chat)
  "Motor de imágenes": "Image engine",
  "Lo que usa el botón «Generar imagen» del chat. No tiene nada que ver con el proveedor del texto: la clave se pide a la que ya tengas guardada arriba, y lo que cobra cada uno va aparte.":
    "What the chat's “Generate image” button uses. Nothing to do with the text provider: the key is the one you already saved above, and each engine bills separately.",
  Motor: "Engine",
  Apagado: "Off",
  "El botón del chat avisa y no gasta nada": "The chat button just warns, and nothing is spent",
  Modelo: "Model",
  "Modelo de imagen": "Image model",
  Tamaño: "Size",
  "Tamaño de la imagen": "Image size",
  cuadrada: "square",
  apaisada: "landscape",
  vertical: "portrait",
  "Generar imagen": "Generate image",
  "Dibujando…": "Drawing…",
  "Pedir a {m}": "Ask {m}",
  "Describe la imagen: «un gato astronauta, acuarela»":
    "Describe the image: “an astronaut cat, watercolour”",
  "Se la pide a {m}, con la clave que ya tengas guardada. Cuesta dinero aparte del chat: el precio está en Ajustes → API.":
    "It asks {m} using the key you already saved. It costs money on top of the chat: the price is in Settings → API.",
  "El motor de imágenes se elige en Ajustes → API.": "The image engine is chosen in Settings → API.",
  "Ajustes → API": "Settings → API",

  // Trazas del agente: el paso de generar imagen
  "Dibujó {b}": "Drew {b}",
  "Generó una imagen": "Generated an image",
  "Generó {n} imágenes": "Generated {n} images",

  // Motor de voz (Ajustes → API y el botón del altavoz)
  "Motor de voz": "Voice engine",
  "El botón del altavoz de cada respuesta. Apagado usa las voces que trae Windows: gratis y sin internet. Encenderlo pide la voz a la nube, y ahí se cobra por caracteres leídos.":
    "The speaker button on each answer. Off uses the voices Windows ships: free, no network. Turning it on asks the cloud for the voice, and that is billed per character read.",
  "Apagado (voz del sistema)": "Off (system voice)",
  "Gratis, sin red": "Free, offline",
  "Modelo de voz": "Voice model",
  Voz: "Voice",
  "Voz del lector": "Reader voice",
  "Una respuesta de 1.500 caracteres sale por unos 0,02 $. Lo que ya se escuchó queda guardado en el disco y no vuelve a cobrarse.":
    "A 1,500-character answer comes out at about $0.02. What you already listened to stays on disk and is not billed again.",
  "Poniéndole voz…": "Adding voice…",
  "Leer en voz alta con la voz de nube": "Read aloud with the cloud voice",
  "El audio no se pudo reproducir.": "The audio could not be played.",
  "El navegador bloqueó la reproducción del audio.": "The browser blocked audio playback.",

  // Paneles del modo trabajo: riel, tirador y árbol de archivos
  "Mostrar {e}": "Show {e}",
  "Ancho del panel": "Panel width",
  "Añadir {n} al mensaje": "Add {n} to the message",
  "Buscar archivos": "Search files",
  Limpiar: "Clear",

  // Árbol de archivos: menú, filtros y acciones de la barra
  "Añadir al mensaje": "Add to the message",
  "Mostrar en el Explorador": "Show in Explorer",
  "Copiar la ruta": "Copy the path",
  "Volver a leer la carpeta": "Read the folder again",
  "Colapsar las carpetas abiertas": "Collapse the open folders",
  "Ocultar los nombres con punto": "Hide dot-names",
  "Mostrar los nombres con punto": "Show dot-names",
  "Todo empieza por punto.": "Everything in here starts with a dot.",
  "Mostrar la carpeta del proyecto en el Explorador": "Show the project folder in Explorer",

  // Panel de Tareas: filtro, copia y vaciado con explicación
  "Ver todos los pasos": "Show every step",
  "Ver solo lo que queda": "Show only what is left",
  "Copiar el plan": "Copy the plan",
  "Aquí se ve lo que el agente se propone y por dónde va.":
    "This is where the agent's plan and its progress show up.",
  "Cada paso del plan, con su estado": "Every step of the plan, with its state",
  "Si el modelo no hace plan, las acciones que hizo":
    "If the model skips planning, the actions it took",
  "Cuánto tardó cada una": "How long each one took",
  "Pide una tarea abajo y esto se llena solo.": "Ask for a task below and this fills itself in.",
  "No queda ningún paso por hacer.": "There are no steps left to do.",
  "En curso: {p}": "In progress: {p}",
  "{n} pasos fallaron": "{n} steps failed",
  "Tardó {d}": "Took {d}",

  // Cola de tareas del modo trabajo
  "En cola: {n} · se lanzan al terminar esta":
    "Queued: {n} · they start when this one finishes",
  "Escribe otra si quieres: queda en cola hasta que termine esta.":
    "Write another if you want: it waits in the queue until this one ends.",
  "Añadir a la cola de tareas…": "Add to the task queue…",
  "Añadir a la cola de tareas": "Add to the task queue",
  "En cola para después": "Queued for later",
  "Quitar de la cola": "Remove from the queue",
  "La cola está en pausa: la tarea anterior no terminó bien.":
    "The queue is paused: the previous task did not finish well.",
  "Seguir con la cola": "Resume the queue",
};
