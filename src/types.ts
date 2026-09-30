export interface Conversation {
  id: string;
  title: string;
  projectId: string | null;
  pinned: boolean;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Attachment {
  name: string;
  text: string;
  imageMediaType?: string | null;
  imageFile?: string | null;
}

export interface WebSource {
  title: string;
  url: string;
  snippet: string;
}

/** Plantilla de comportamiento (Agent Skill). Con `enabled` viaja en el system
 *  prompt de cada respuesta; además siempre se puede insertar en el mensaje. */
export interface Skill {
  id: string;
  name: string;
  prompt: string;
  enabled: boolean;
  createdAt: number;
}

/** Salida de `run_command`, ya con las claves tapadas si tocaba taparlas. */
export interface CommandData {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/** Una línea de la traza del agente. `toolName: "razonamiento"` no es una tool:
 *  es el pensamiento del turno, que viaja en `reasoning`. */
export interface StepLine {
  toolName: string;
  ok: boolean;
  brief: string;
  durationMs: number;
  data?: CommandData | null;
  /** `write_file` creó el archivo en vez de modificarlo. */
  creado?: boolean;
  /** Ruta relativa que escribió o editó ese paso, para la tarjeta del archivo. */
  ruta?: string | null;
  /** El diff que aplicó esa escritura, para verlo bajo el paso. */
  diff?: string | null;
  /** Razonamiento del turno del agente, cuando el modelo piensa de más. */
  reasoning?: string;
}

/** Una versión de lo que el modelo escribió y el usuario abrió en el panel. */
export interface Artifact {
  id: string;
  conversationId: string;
  titulo: string;
  lenguaje: string;
  contenido: string;
  version: number;
  creadoEn: number;
}

export interface Message {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  provider: string | null;
  createdAt: number;
  attachments: Attachment[];
  reasoning?: string | null;
  thinkingMs?: number | null;
  webSources?: WebSource[];
  feedback?: "up" | "down" | null;
  /** El mensaje al que responde este; `null` solo en el primero del hilo. */
  parentId?: string | null;
  /** Cuántas versiones hay escritas en este punto del hilo, cuál está puesta y
   *  las ids de todas, en el orden en que se escribieron. Falta cuando no hay
   *  más que esta, que es lo normal. */
  variantas?: { total: number; posicion: number; hermanas: string[] } | null;
  /** Los pasos que el agente hizo para cerrar esta respuesta. Vienen de
   *  `tool_calls`, así que la traza sobrevive a cerrar y abrir la sesión. */
  steps?: StepLine[];
}

/** Proveedores que Hatboo sabe hablar. `local` es Ollama / llama.cpp en este
 *  equipo; el resto son nube y sus respuestas salen de la máquina. La tabla con
 *  nombres, iconos y campos vive en `proveedores.ts`. */
export type ProviderId =
  | "anthropic"
  | "openai"
  | "openrouter"
  | "gemini"
  | "hf"
  | "local";

export interface Settings {
  activeProvider: ProviderId;
  localEndpoint: string;
  /** Base compatible con OpenAI del router de Hugging Face (`…/v1`). */
  hfEndpoint: string;
  hfModel: string;
  anthropicModel: string;
  openaiModel: string;
  openrouterModel: string;
  geminiModel: string;
  localModel: string;
  /** Modelos declarados a mano como capaces de ver imágenes. La heurística por
   *  nombre acierta las familias conocidas y falla con el resto; esto es la
   *  salida. Se compara sin distinguir mayúsculas. */
  visionModelos: string[];
  theme: string;
  /** `system` sigue el idioma del navegador (que en Windows es el del sistema). */
  uiLanguage: "system" | "es" | "en";
  runCommandEnabled: boolean;
  assistantName: string;
  /** Cómo le habla al usuario: `tú` | `usted`. */
  userAddress: string;
  /** Idioma en que debe responder el modelo: `auto` | `es` | `en`. */
  answerLanguage: string;
  /** Una línea sobre el usuario, solo para el chat. */
  userNotes: string;
  reasoningEffort: ReasoningEffort;
  /** Motor de generación de imagen: `""` (apagado) | `openai` | `gemini`. */
  imageProvider: string;
  /** Modelo dentro del motor; vacío = el que propone Hatboo. */
  imageModel: string;
  /** Tamaño pedido, según los que admite cada motor. */
  imageSize: string;
  /** Motor de voz de nube: `""` (apagado) | `openai`. Con las voces del sistema
   *  no hace falta nada de esto, y es gratis. */
  audioProvider: string;
  /** Modelo de voz; vacío = `gpt-4o-mini-tts`. */
  audioModel: string;
  /** Voz dentro del modelo (`alloy`, `nova`…). */
  audioVoice: string;
  defaultApprovalLevel: ApprovalLevel;
  codeMode: boolean;
  webSearch: boolean;
  chatFontSize: ChatFontSize;
  /** `solida` | `translucida`: cómo se pinta la burbuja de lo que escribes. */
  bubbleStyle: BubbleStyle;
  chatFontFamily: ChatFontFamily;
  /** Tamaño base del documento: de él sale todo el espaciado (Tailwind mide en rem). */
  densidad: Densidad;
  /** Acento fijo por encima de la paleta. `violeta` = el de cada paleta. */
  acento: Acento;
  avatarStyle: AvatarStyle;
  avatarColor: string;
  avatarEmoji: string;
  sidebarCompact: boolean;
  /** Sección de proyectos, plegable desde su encabezado. */
  projectsSectionOpen: boolean;
  /** Sección de conversaciones, plegable desde su encabezado. */
  chatsSectionOpen: boolean;
  filesPanelOpen: boolean;
  tasksPanelOpen: boolean;
  filesPanelWidth: number;
  tasksPanelWidth: number;
  focusMode: boolean;
  notifyOnFinish: boolean;
  /** El agente espera a que el usuario revise el plan antes de ejecutarlo. */
  reviewPlan: boolean;
  redactSecrets: boolean;
  /** Nombres de carpeta que se saltan el árbol, la búsqueda y el agente. La lista
   *  vive en Rust (`agent/ignore.rs`) y es LA MISMA para los tres. */
  ignoreDirs: string[];
  /** Minutos al este de UTC. Rust no tiene forma barata de saber la zona
   *  horaria local; sin esto la fecha que se le dice al modelo es UTC y a
   *  partir de medianoche diría «ayer». */
  tzOffsetMin: number;
}

/** De qué es un fallo del chat. `ErrorClase` en Rust; se corresponde con las
 *  variantes de `ProviderError`, no con el texto del mensaje. */
export type ClaseError =
  | "clave"
  | "red"
  | "proveedor"
  | "respuesta"
  | "ajustes"
  | "otro";

/** Límites del arrastre de los paneles del modo trabajo. */
export const PANEL_WIDTHS = {
  files: { min: 180, max: 460, def: 240 },
  tasks: { min: 200, max: 520, def: 288 },
} as const;

export type ChatFontSize = "sm" | "md" | "lg";

/** Tamaño de letra base del documento. Todo el espaciado de Tailwind se mide en
 *  `rem`, así que cambiar el `font-size` de `html` compacta o abre la interfaz
 *  entera sin tocar un padding cada vez. */
export type Densidad = "comoda" | "compacta";

export const DENSIDAD_OPCIONES: { id: Densidad; label: string; px: number }[] = [
  { id: "comoda", label: "Cómoda", px: 16 },
  { id: "compacta", label: "Compacta", px: 14.5 },
];

/** Acento por encima de la paleta. `violeta` = no tocar la de cada paleta. Los
 *  otros tres son colores fijos definidos en `index.css`, no hex libres: cada
 *  trío está medido contra el fondo de las paletas oscuras y las claras. */
export type Acento = "violeta" | "azul" | "verde" | "rosa";

export const ACENTO_OPCIONES: { id: Acento; label: string; muestra: string }[] = [
  { id: "violeta", label: "Violeta", muestra: "#8b5cf6" },
  { id: "azul", label: "Azul", muestra: "#60a5fa" },
  { id: "verde", label: "Verde", muestra: "#34d399" },
  { id: "rosa", label: "Rosa", muestra: "#f472b6" },
];

/** Base del texto de las respuestas; lo demás (código, burbuja del usuario)
 *  se deriva de esto con `calc()`, así todo escala junto. */
export const CHAT_FONT_SIZES: { id: ChatFontSize; label: string; px: number }[] = [
  { id: "sm", label: "Pequeña", px: 13.5 },
  { id: "md", label: "Normal", px: 15 },
  { id: "lg", label: "Grande", px: 16.5 },
];

/**
 * `none` pide expresamente que no piense (`reasoning_effort: "none"`), que es lo
 * que hace falta con los que razonan por defecto (DeepSeek, Qwen3). `off` es el
 * valor viejo de esa misma casilla: quedó en los ajustes guardados, y el backend
 * lo trata igual (`esfuerzo_efectiva`).
 */
export type ReasoningEffort = "off" | "none" | "low" | "medium" | "high";

export type ChatFontFamily = "sans" | "serif" | "mono";

export type AvatarStyle = "mascota" | "inicial" | "emoji";

/** Las dos direcciones que se propusieron para la burbuja del usuario. */
export type BubbleStyle = "solida" | "translucida";

export const BUBBLE_STYLES: { id: BubbleStyle; label: string; help: string }[] = [
  {
    id: "solida",
    label: "Sólida",
    help: "Morado hondo con texto blanco: el de más contraste.",
  },
  {
    id: "translucida",
    label: "Translúcida",
    help: "Tarjeta con el acento al 15% y esquinas de 12 px: más discreta.",
  },
];

export const AVATAR_STYLES: { id: AvatarStyle; label: string }[] = [
  { id: "mascota", label: "Mascota" },
  { id: "inicial", label: "Inicial" },
  { id: "emoji", label: "Emoji" },
];

/** Paleta fija en vez de un selector de color libre: así el texto de encima
 *  siempre contrasta, que es el motivo por el que no se deja un `input[type=color]`. */
export const AVATAR_COLORS: { id: string; label: string; bg: string; fg: string }[] = [
  { id: "violeta", label: "Violeta", bg: "#7c5cff", fg: "#ffffff" },
  { id: "cielo", label: "Cielo", bg: "#38bdf8", fg: "#0b1220" },
  { id: "esmeralda", label: "Esmeralda", bg: "#34d399", fg: "#06281d" },
  { id: "ambar", label: "Ámbar", bg: "#fbbf24", fg: "#3b2600" },
  { id: "rosa", label: "Rosa", bg: "#f472b6", fg: "#3d0a24" },
  { id: "pizarra", label: "Pizarra", bg: "#475569", fg: "#f1f5f9" },
];

/** Las tres familias se resuelven contra variables CSS en index.css, así que
 *  cada una sigue usando las fuentes que el tema ya declara. */
export const CHAT_FONTS: { id: ChatFontFamily; label: string }[] = [
  { id: "sans", label: "Sans" },
  { id: "serif", label: "Serif" },
  { id: "mono", label: "Monoespaciada" },
];

/** Pilas literales en vez de tokens: se inyectan como `--chat-font` en la lista
 *  de mensajes y todo lo de dentro hereda. El código de RichText sigue en mono
 *  por su cuenta, así que elegir "serif" no vuelve ilegible un bloque de código. */
export const CHAT_FONT_STACKS: Record<ChatFontFamily, string> = {
  sans: '"Segoe UI", system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: '"Cascadia Code", "Consolas", ui-monospace, monospace',
};

export type LanguageChoice = "system" | "es" | "en";

/** Cada idioma se enseña escrito en su propio idioma: es la única forma de que
 *  la lista sirva a quien no lee el resto de la interfaz. `system` sí se
 *  traduce, porque su texto depende del idioma en curso. */
export const LANGUAGE_OPTIONS: { id: LanguageChoice; label: string }[] = [
  { id: "system", label: "Sistema" },
  { id: "es", label: "Español" },
  { id: "en", label: "English" },
];

export interface StorageInfo {
  dbPath: string;
  dbSizeBytes: number;
  attachmentsPath: string;
  attachmentsSizeBytes: number;
  attachmentsCount: number;
  counts: {
    conversations: number;
    messages: number;
    projects: number;
    tasks: number;
    toolCalls: number;
  };
}

export interface ExportSummary {
  path: string;
  bytes: number;
  conversations: number;
  messages: number;
  images: number;
}

export interface ImportReport {
  projectsAdded: number;
  conversationsAdded: number;
  messagesAdded: number;
  skillsAdded: number;
  skippedExisting: number;
  imagesRestored: number;
  imagesMissing: number;
}

/** Texto que hay que escribir para que el backend acepte el restablecimiento. */
export const RESET_TOKEN = "BORRAR TODO";

export const REASONING_LEVELS: {
  id: ReasoningEffort;
  label: string;
  short: string;
}[] = [
  { id: "none", label: "Sin razonamiento", short: "Off" },
  { id: "low", label: "Bajo", short: "Bajo" },
  { id: "medium", label: "Medio", short: "Medio" },
  { id: "high", label: "Extra alto", short: "Extra alto" },
];

/**
 * `off` es el valor que guardaron los ajustes anteriores a esta lista. En el
 * backend vale lo mismo que `none` —ver `esfuerzo_efectiva` en Rust—, así que
 * aquí también: si no, un ajuste viejo dejaría las cuatro casillas sin marcar.
 */
export function esfuerzoVisible(
  valor: string | null | undefined,
): ReasoningEffort {
  if (!valor || valor === "off") return "none";
  return REASONING_LEVELS.some((l) => l.id === valor)
    ? (valor as ReasoningEffort)
    : "none";
}

/** Ocho posturas, una por cada cosa que puede estar pasando en la app. Cada una
 *  se usa en un solo sitio concreto: si dos pantallas comparten la misma, la
 *  mascota deja de contar nada. */
export type MascotState =
  | "idle"
  | "thinking"
  | "working"
  | "running"
  | "confused"
  | "happy"
  | "surprised"
  | "sleeping"
  | "walking";

export type ApprovalLevel =
  | "ask_always"
  | "approve_for_me"
  | "auto_sandbox"
  | "full_access";

export const APPROVAL_LEVELS: Array<{
  id: ApprovalLevel;
  label: string;
  short: string;
  help: string;
}> = [
  {
    id: "ask_always",
    label: "Preguntar siempre",
    short: "Preguntar",
    help: "Cada tool, también leer.",
  },
  {
    id: "approve_for_me",
    label: "Aprobar por mí (recomendado)",
    short: "Aprobar por mí",
    help: "Lee sola; pregunta al escribir, ejecutar o commitear.",
  },
  {
    id: "auto_sandbox",
    label: "Automático en sandbox",
    short: "Automático",
    help: "Lee y escribe solo dentro del proyecto.",
  },
  {
    id: "full_access",
    label: "Acceso total",
    short: "Acceso total",
    help: "Sin preguntar. Sigue encerrado en la carpeta del proyecto.",
  },
];

export interface Project {
  id: string;
  name: string;
  rootPath: string;
  createdAt: number;
  lastOpenedAt: number;
  approvalLevel: ApprovalLevel;
  pinned: boolean;
  /**
   * Derivado del disco al leer el proyecto: `.git`, `package.json`, `Cargo.toml`
   * y compañía arriba de la carpeta. `false` significa que es una carpeta de
   * documentos, no que esté vacía.
   */
  esCodigo: boolean;
}

/** Lo que `hardware_info` dice de este equipo: es la firma del comando, así que
 *  vive aquí y no en la pantalla que lo pinta. */
export interface Hardware {
  ramTotalBytes: number;
  ramLibreBytes: number;
  gpu: string | null;
  discoLibreBytes: number;
  discoTotalBytes: number;
  cpuUso: number;
  cpuNombre: string;
  ollamaOk: boolean;
  locales: number;
}

/** Modelo que Ollama tiene en disco, tal como lo devuelve `list_local_models`. */
export interface LocalModel {
  name: string;
  /** Ej. «7.6B»; vacío si Ollama no lo declara. */
  parameterSize: string;
  sizeBytes: number;
  /** Lo que Ollama ≥ 0.5 declara («completion», «vision», «tools»…). Vacío en
   *  servidores viejos o no-Ollama: toca adivinar por el nombre. */
  capabilities: string[];
  /** Tokens que admite, según `/api/show`. Cero si no lo declara: sin número
   *  propio el medidor de contexto no inventa un porcentaje. */
  contextTokens: number;
  /** Si `contextTokens` es el `num_ctx` de ejecución (el techo real del turno) o
   *  la ventana nativa del modelo, que suele ser más generosa. */
  contextEsNumCtx: boolean;
}

export interface Task {
  id: string;
  conversationId: string;  stepOrder: number;
  description: string;
  status: "pending" | "in_progress" | "done" | "failed";
  createdAt: number;
}

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  /** Bytes del archivo; 0 en las carpetas (no se suma lo que hay dentro). */
  size: number;
}

export interface PendingApproval {
  conversationId: string;
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  preview: string;
}
