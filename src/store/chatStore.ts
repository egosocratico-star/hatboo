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
  streamingReasoning: string;
  /** Momento del último envío; sirve para cronometrar el pensamiento en vivo. */
  startedAt: number;
  /** Se está consultando la web antes de generar. */
  searching: boolean;
  /** Milisegundos que duró el pensamiento de la respuesta en curso. */
  thinkingMs: number | null;
  /** Aviso de la búsqueda web (sin resultados / fallo). */
  searchNote: string | null;
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
  editMessage: (messageId: string, content: string) => Promise<void>;
  setFeedback: (messageId: string, feedback: "up" | "down" | null) => Promise<void>;
  stopStreaming: () => Promise<void>;
  clearMessages: () => Promise<void>;
  loadSettings: () => Promise<void>;
  saveSettings: (settings: Settings) => Promise<void>;
  clearError: () => void;

  // Actualizaciones desde useStreaming
  appendChunk: (delta: string) => void;
  appendReasoning: (delta: string) => void;
  setSearchStatus: (searching: boolean, note: string | null) => void;
  finishStreaming: (message: Message) => void;
  cancelStreaming: () => void;
  failStreaming: (message: string) => void;
}

/** Estado transitorio de una respuesta en curso. */
const BLANK_STREAM = {
  streamingText: "",
  streamingReasoning: "",
  searching: false,
  thinkingMs: null as number | null,
  searchNote: null as string | null,
  startedAt: 0,
};

export const useChatStore = create<ChatStore>((set, get) => ({
  view: "chat",
  conversations: [],
  activeId: null,
  messages: [],
  ...BLANK_STREAM,
  status: "idle",
  error: null,
  settings: null,

  setView: (view) => set({ view }),

  loadConversations: async () => {
    // Solo refresca la lista: al arrancar NO se auto-selecciona ninguna
    // conversación, la app abre siempre en el estado inicial en blanco.
    const conversations = await invoke<Conversation[]>("list_conversations");
    set({ conversations });
  },

  newConversation: async () => {
    // Borrador local: no se crea la fila en SQLite hasta que llega el primer
    // mensaje (lo hace `sendMessage`), así que pulsar "Nueva conversación"
    // varias veces con el chat ya vacío no acumula conversaciones vacías.
    set({
      view: "chat",
      activeId: null,
      messages: [],
      ...BLANK_STREAM,
      status: "idle",
      error: null,
    });
  },

  selectConversation: async (id) => {
    const messages = await invoke<Message[]>("list_messages", {
      conversationId: id,
    });
    set({
      activeId: id,
      messages,
      ...BLANK_STREAM,
      status: "idle",
      error: null,
    });
  },

  removeConversation: async (id) => {
    await invoke("delete_conversation", { conversationId: id });
    if (get().activeId === id) {
      set({ activeId: null, messages: [], ...BLANK_STREAM, error: null, status: "idle" });
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

    // Marca la respuesta en curso ANTES del invoke: los primeros fragmentos
    // pueden llegar mientras la promesa sigue pendiente y, si el estado todavía
    // es `idle`, appendChunk/appendReasoning los descartarían.
    set({
      activeId: convId,
      ...BLANK_STREAM,
      startedAt: Date.now(),
      status: "streaming",
      error: null,
    });
    try {
      const userMessage = await invoke<Message>("send_message", {
        conversationId: convId,
        content,
        attachments: attachments ?? [],
      });
      set((s) => ({ messages: [...s.messages, userMessage] }));
    } catch (e) {
      set({ ...BLANK_STREAM, status: "error", error: String(e) });
    }
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
    set({
      messages: msgs,
      ...BLANK_STREAM,
      startedAt: Date.now(),
      status: "streaming",
      error: null,
    });
    try {
      await invoke("regenerate_response", { conversationId: activeId });
    } catch (e) {
      set({ ...BLANK_STREAM, status: "error", error: String(e) });
    }
  },

  /** Edita un mensaje propio: el backend tira lo de después y vuelve a responder. */
  editMessage: async (messageId, content) => {
    const { activeId, status, messages } = get();
    const index = messages.findIndex((m) => m.id === messageId);
    if (!activeId || index < 0 || status === "streaming") return;
    const text = content.trim();
    if (!text || messages[index].content === text) return;

    set({
      messages: messages
        .slice(0, index + 1)
        .map((m) => (m.id === messageId ? { ...m, content: text } : m)),
      ...BLANK_STREAM,
      startedAt: Date.now(),
      status: "streaming",
      error: null,
    });
    try {
      await invoke("edit_user_message", {
        conversationId: activeId,
        messageId,
        content: text,
      });
    } catch (e) {
      // Se recarga desde la base de datos y luego se muestra el fallo, para que
      // la vista refleje lo que hay de verdad y no una edición optimista.
      const message = String(e);
      await get().selectConversation(activeId);
      set({ status: "error", error: message });
    }
  },

  setFeedback: async (messageId, feedback) => {
    const current = get().messages.find((m) => m.id === messageId)?.feedback;
    const next = current === feedback ? null : feedback;
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId ? { ...m, feedback: next } : m,
      ),
    }));
    await invoke("set_message_feedback", {
      messageId,
      feedback: next,
    }).catch(() => {});
  },

  stopStreaming: async () => {
    const { activeId } = get();
    if (!activeId || get().status !== "streaming") return;
    // El único error posible del comando es "no hay nada en curso", que justo
    // es el estado que queremos: la respuesta ya terminó sola.
    await invoke("cancel_chat_stream", { conversationId: activeId }).catch(() => {});
  },

  clearMessages: async () => {
    const { activeId } = get();
    if (!activeId) return;
    await invoke("clear_conversation_messages", { conversationId: activeId });
    set({ messages: [], ...BLANK_STREAM, error: null });
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

  appendChunk: (delta) => {
    buffer.text += delta;
    scheduleFlush();
  },

  appendReasoning: (delta) => {
    buffer.reasoning += delta;
    scheduleFlush();
  },

  setSearchStatus: (searching, note) => set({ searching, searchNote: note }),

  finishStreaming: (message) => {
    clearBuffer();
    set((s) => ({
      // Un mismo chat:done puede llegar dos veces si un listener sobrevivió a
      // su desmontaje; el id del mensaje guardado lo hace idempotente.
      messages: s.messages.some((m) => m.id === message.id)
        ? s.messages
        : [...s.messages, message],
      ...BLANK_STREAM,
      status: "idle",
    }));
  },

  cancelStreaming: () => {
    clearBuffer();
    set({ ...BLANK_STREAM, status: "idle" });
  },

  failStreaming: (message) => {
    clearBuffer();
    set({ ...BLANK_STREAM, status: "error", error: message });
  },
}));

/**
 * Los fragmentos llegan a ráfagas por IPC. Volcarlos uno por frame —en vez de
 * provocar un render por token— es lo que quita los tirones mientras responde el
 * modelo: cada render re-parsea el markdown de toda la respuesta.
 */
const buffer = { text: "", reasoning: "" };
let frame: number | null = null;

function clearBuffer() {
  buffer.text = "";
  buffer.reasoning = "";
  if (frame !== null) {
    cancelAnimationFrame(frame);
    frame = null;
  }
}

function scheduleFlush() {
  if (frame !== null) return;
  frame = requestAnimationFrame(() => {
    frame = null;
    const { text, reasoning } = buffer;
    buffer.text = "";
    buffer.reasoning = "";
    if (!text && !reasoning) return;
    useChatStore.setState((s) => {
      if (s.status !== "streaming") return s;
      // El cronómetro arranca con el primer razonamiento (la espera de la
      // búsqueda web no cuenta) y se congela con el primer carácter visible.
      const firstThink = s.streamingReasoning === "" && reasoning !== "";
      const thinkingMs =
        s.thinkingMs ?? (text && s.streamingReasoning ? Date.now() - s.startedAt : null);
      return {
        streamingText: s.streamingText + text,
        streamingReasoning: s.streamingReasoning + reasoning,
        searching: false,
        thinkingMs,
        startedAt: firstThink ? Date.now() : s.startedAt,
      };
    });
  });
}
