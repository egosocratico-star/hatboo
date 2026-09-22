export interface Conversation {
  id: string;
  title: string;
  projectId: string | null;
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
}

export interface Settings {
  activeProvider: "anthropic" | "openai" | "local";
  localEndpoint: string;
  anthropicModel: string;
  openaiModel: string;
  localModel: string;
  theme: string;
  runCommandEnabled: boolean;
  assistantName: string;
  reasoningEffort: ReasoningEffort;
  defaultApprovalLevel: ApprovalLevel;
  codeMode: boolean;
  webSearch: boolean;
  chatFontSize: ChatFontSize;
}

export type ChatFontSize = "sm" | "md" | "lg";

/** Base del texto de las respuestas; lo demás (código, burbuja del usuario)
 *  se deriva de esto con `calc()`, así todo escala junto. */
export const CHAT_FONT_SIZES: { id: ChatFontSize; label: string; px: number }[] = [
  { id: "sm", label: "Pequeña", px: 13.5 },
  { id: "md", label: "Normal", px: 15 },
  { id: "lg", label: "Grande", px: 16.5 },
];

export type ReasoningEffort = "off" | "low" | "medium" | "high";

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
  { id: "off", label: "Desactivado", short: "Off" },
  { id: "low", label: "Bajo", short: "Bajo" },
  { id: "medium", label: "Medio", short: "Medio" },
  { id: "high", label: "Alto", short: "Alto" },
];

export type MascotState =
  | "idle"
  | "thinking"
  | "confused"
  | "happy"
  | "surprised";

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
    help: "Pide aprobación antes de cualquier tool call, incluidas lecturas.",
  },
  {
    id: "approve_for_me",
    label: "Aprobar por mí (recomendado)",
    short: "Aprobar por mí",
    help: "Corre sola las tools de bajo riesgo (leer, listar, buscar, git status/diff/log); pide aprobación para escribir, ejecutar comandos o commitear.",
  },
  {
    id: "auto_sandbox",
    label: "Automático en sandbox",
    short: "Automático",
    help: "Corre todo sin preguntar, siempre dentro de la carpeta del proyecto.",
  },
  {
    id: "full_access",
    label: "Acceso total",
    short: "Acceso total",
    help: "Sin aprobaciones. IMPORTANTE: por diseño de Hatboo las tools siguen restringidas a la carpeta del proyecto — el sandbox de rutas NO se relaja.",
  },
];

export interface Project {
  id: string;
  name: string;
  rootPath: string;
  createdAt: number;
  lastOpenedAt: number;
  approvalLevel: ApprovalLevel;
}

export interface Task {
  id: string;
  conversationId: string;
  stepOrder: number;
  description: string;
  status: "pending" | "in_progress" | "done" | "failed";
  createdAt: number;
}

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export interface PendingApproval {
  conversationId: string;
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  preview: string;
}
