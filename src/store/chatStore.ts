import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { Attachment, Conversation, Message, Settings } from "../types";

export type View = "chat" | "settings" | "work";
export type Status = "idle" | "streaming" | "error";

interface ChatStore {
  view: View;
  conversations: Conversation[];
  activeId: string | null;
  messages: Message[];
  streamingText: string;
  status: Status;
  error: string | null;
  settings: Settings | null;

  setView: (view: View) => void;
  loadConversations: () => Promise<void>;
  newConversation: () => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  removeConversation: (id: string) => Promise<void>;
  sendMessage: (content: string, attachments?: Attachment[]) => Promise<void>;
  regenerate: () => Promise<void>;
  clearMessages: () => Promise<void>;
  loadSettings: () => Promise<void>;
  saveSettings: (settings: Settings) => Promise<void>;
  clearError: () => void;

  // Actualizaciones desde useStreaming
  appendChunk: (delta: string) => void;
  finishStreaming: (message: Message) => void;
  failStreaming: (message: string) => void;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  view: "chat",
  conversations: [],
  activeId: null,
  messages: [],
  streamingText: "",
  status: "idle",
  error: null,
  settings: null,

  setView: (view) => set({ view }),

  loadConversations: async () => {
    const conversations = await invoke<Conversation[]>("list_conversations");
    set({ conversations });
    if (!get().activeId) {
      // Auto-seleccionar solo chats puros: las sesiones de trabajo (con projectId)
      // no deben abrirse nunca en la vista de chat.
      const firstChat = conversations.find((c) => !c.projectId);
      if (firstChat) {
        await get().selectConversation(firstChat.id);
      }
    }
  },

  newConversation: async () => {
    const conv = await invoke<Conversation>("create_conversation", {
      title: "Nueva conversación",
    });
    set({
      activeId: conv.id,
      messages: [],
      streamingText: "",
      status: "idle",
      error: null,
      view: "chat",
    });
    await get().loadConversations();
  },

  selectConversation: async (id) => {
    const messages = await invoke<Message[]>("list_messages", {
      conversationId: id,
    });
    set({
      activeId: id,
      messages,
      streamingText: "",
      status: "idle",
      error: null,
    });
  },

  removeConversation: async (id) => {
    await invoke("delete_conversation", { conversationId: id });
    if (get().activeId === id) {
      set({ activeId: null, messages: [], streamingText: "", error: null, status: "idle" });
    }
    await get().loadConversations();
  },

  sendMessage: async (content, attachments) => {
    const { activeId } = get();
    const convId =
      activeId ??
      (await invoke<Conversation>("create_conversation", {
        title: "Nueva conversación",
      })).id;

    const userMessage = await invoke<Message>("send_message", {
      conversationId: convId,
      content,
      attachments: attachments ?? [],
    });
    set((s) => ({
      activeId: convId,
      messages: [...s.messages, userMessage],
      streamingText: "",
      status: "streaming",
      error: null,
    }));
    await get().loadConversations();
  },

  regenerate: async () => {
    const { activeId, status } = get();
    if (!activeId || status === "streaming") return;
    // Quitamos localmente la última respuesta; el backend la borra y re-emite.
    const msgs = [...get().messages];
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "assistant") {
        msgs.splice(i, 1);
        break;
      }
    }
    set({ messages: msgs, streamingText: "", status: "streaming", error: null });
    try {
      await invoke("regenerate_response", { conversationId: activeId });
    } catch (e) {
      set({ status: "error", streamingText: "", error: String(e) });
    }
  },

  clearMessages: async () => {
    const { activeId } = get();
    if (!activeId) return;
    await invoke("clear_conversation_messages", { conversationId: activeId });
    set({ messages: [], streamingText: "", error: null });
    await get().loadConversations();
  },

  loadSettings: async () => {
    const settings = await invoke<Settings>("get_settings");
    set({ settings });
  },

  saveSettings: async (settings) => {
    const saved = await invoke<Settings>("update_settings", { settings });
    set({ settings: saved });
  },

  clearError: () => set({ error: null, status: "idle" }),

  appendChunk: (delta) =>
    set((s) => ({ streamingText: s.streamingText + delta })),

  finishStreaming: (message) =>
    set((s) => ({
      messages: [...s.messages, message],
      streamingText: "",
      status: "idle",
    })),

  failStreaming: (message) =>
    set({
      streamingText: "",
      status: "error",
      error: message,
    }),
}));
