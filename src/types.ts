export interface Conversation {
  id: string;
  title: string;
  projectId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Message {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  provider: string | null;
  createdAt: number;
}

export interface Settings {
  activeProvider: "anthropic" | "openai" | "local";
  localEndpoint: string;
  anthropicModel: string;
  openaiModel: string;
  localModel: string;
  theme: string;
  runCommandEnabled: boolean;
}

export type MascotState =
  | "idle"
  | "thinking"
  | "confused"
  | "happy"
  | "surprised";

export interface Project {
  id: string;
  name: string;
  rootPath: string;
  createdAt: number;
  lastOpenedAt: number;
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
