import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type {
  Artifact,
  Attachment,
  ClaseError,
  Conversation,
  LocalModel,
  Message,
  Settings,
  Skill,
} from "../types";

export type View = "chat" | "settings" | "work" | "projects";
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
  /** Se está generando una imagen ahora mismo: el motor de nube tarda segundos. */
  imageBusy: boolean;
  error: string | null;
  /** De qué es el fallo que hay en `error`, cuando lo sabe el backend. Manda qué
   *  acción se ofrece en el aviso: no es lo mismo que falte la clave que lo que
   *  es un corte de red. `null` = todavía no se ha dicho. */
  errorClase: ClaseError | null;
  settings: Settings | null;
  /** Fallo al leer los ajustes: Ajustes lo muestra con un reintento. */
  settingsError: string | null;
  /** Caché de los modelos de Ollama con sus capacidades declaradas. La piden
   *  el chip del modelo y el gate de visión del menú +; `null` = sin consultar. */
  localModels: LocalModel[] | null;
  /** Endpoint del que salió `localModels`; si cambia en Ajustes, hay que repedir. */
  localModelsEndpoint: string | null;
  loadLocalModels: () => Promise<void>;
  skills: Skill[];
  /** Se incrementa con Ctrl/Cmd+F; el chat lo mira para abrir su buscador. */
  findNonce: number;
  /** Ventana de búsqueda en TODOS los chats y sesiones (Ctrl/Cmd+K). */
  searchOpen: boolean;
  /** Sección abierta en Ajustes. En el store para que se pueda saltar a una. */
  settingsCat: string;
  /** Artifactos de la conversación abierta, con todas sus versiones. */
  artefactos: Artifact[];
  /** El que está en el panel derecho; `null` = panel cerrado. */
  artefactoAbierto: Artifact | null;
  /**
   * Texto sin enviar por hilo. La clave `nueva` es el chat que todavía no es
   * conversación: `newConversation` no crea fila hasta el primer mensaje.
   */
  drafts: Record<string, string>;
  /** Rutas de archivos soltados sobre la ventana. La vista que esté delante los
   *  recoge y los adjunta al mensaje en curso; las carpetas no llegan aquí, esas
   *  siguen abriéndose como proyecto. */
  soltados: string[];
  /** Devuelve lo soltado y lo borra de una: si lo leyeran las dos vistas a la vez,
   *  el archivo se adjuntaría dos veces. */
  recogeSoltados: () => string[];
  loadDrafts: () => Promise<void>;
  setDraft: (key: string, text: string) => void;
  /** Escribe ya los borradores que aún esperaban el retardo de 500 ms. */
  flushDrafts: () => Promise<void>;

  setView: (view: View) => void;
  setSettingsCat: (cat: string) => void;
  loadConversations: () => Promise<void>;
  newConversation: () => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  removeConversation: (id: string) => Promise<void>;
  /** Bifurca: copia los mensajes hasta uno concreto en una conversación nueva. */
  branchConversation: (messageId: string) => Promise<void>;
  /** Fijar y archivar: se aplica al vuelo y luego se recarga, porque fijar
   *  cambia el orden de la lista y eso lo decide el SQL. */
  setConversationFlags: (
    id: string,
    flags: { pinned?: boolean; archived?: boolean },
  ) => Promise<void>;
  /** Cambiar el título de un hilo desde la barra lateral. */
  renameConversation: (id: string, title: string) => Promise<void>;
  sendMessage: (content: string, attachments?: Attachment[]) => Promise<void>;
  regenerate: () => Promise<void>;
  /** Pone otra versión del mismo punto del hilo como la que se ve. */
  cambiarVariante: (messageId: string) => Promise<void>;
  /** Guarda una versión nueva de un artifacto y abre el panel con ella. */
  abrirArtefacto: (titulo: string, lenguaje: string, contenido: string) => Promise<void>;
  verArtefacto: (id: string) => void;
  cerrarArtefacto: () => void;
  borrarArtefacto: (id: string) => Promise<void>;
  /** Pide una imagen al motor de Ajustes → API y la mete en el hilo. */
  generateImage: (prompt: string) => Promise<void>;
  editMessage: (messageId: string, content: string) => Promise<void>;
  setFeedback: (messageId: string, feedback: "up" | "down" | null) => Promise<void>;
  stopStreaming: () => Promise<void>;
  clearMessages: () => Promise<void>;
  loadSettings: () => Promise<void>;
  saveSettings: (settings: Settings) => Promise<void>;
  /** Guarda un trozo de los ajustes sin esperar al formulario de Ajustes: los
   *  toggles del reparto del espacio se aplican al pulsar. Optimista, porque el
   *  ancho tiene que seguir al ratón y no al viaje de ida y vuelta con SQLite. */
  patchSettings: (partial: Partial<Settings>) => void;
  loadSkills: () => Promise<void>;
  /** `id` vacío crea una plantilla nueva; devuelve la guardada. */
  saveSkill: (skill: { id: string; name: string; prompt: string; enabled: boolean }) => Promise<Skill>;
  setSkillEnabled: (id: string, enabled: boolean) => Promise<void>;
  removeSkill: (id: string) => Promise<void>;
  openFinder: () => void;
  setSearchOpen: (open: boolean) => void;
  clearError: () => void;

  // Actualizaciones desde useStreaming
  appendChunk: (delta: string) => void;
  appendReasoning: (delta: string) => void;
  setSearchStatus: (searching: boolean, note: string | null) => void;
  finishStreaming: (message: Message) => void;
  /** El stream se paró. `message` trae lo que llegó a escribirse, si quedó algo
   *  y ya está guardado: sin eso la burbuja se queda en el limbo hasta recargar. */
  cancelStreaming: (message?: Message | null) => void;
  failStreaming: (message: string, clase: ClaseError) => void;
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

/** Un retardo por hilo: teclear no escribe SQLite en cada pulsación. */
const temporizadoresBorrador: Record<string, number> = {};

export const useChatStore = create<ChatStore>((set, get) => ({
  view: "chat",
  conversations: [],
  activeId: null,
  messages: [],
  ...BLANK_STREAM,
  status: "idle",
  imageBusy: false,
  error: null,
  errorClase: null,
  settings: null,
  settingsError: null,
  localModels: null,
  localModelsEndpoint: null,
  skills: [],
  findNonce: 0,
  searchOpen: false,
  settingsCat: "api",
  artefactos: [],
  artefactoAbierto: null,
  drafts: {},
  soltados: [],

  recogeSoltados: () => {
    const pendientes = get().soltados;
    if (pendientes.length > 0) set({ soltados: [] });
    return pendientes;
  },

  setView: (view) => set({ view }),
  setSettingsCat: (cat) => set({ settingsCat: cat }),

  loadDrafts: async () => {
    try {
      set({ drafts: await invoke<Record<string, string>>("get_drafts") });
    } catch {
      // Sin borradores no se pierde nada más que el borrador.
    }
  },

  setDraft: (key, text) => {
    // La memoria va ya, para que cambiar de hilo sea instantáneo; a disco se
    // escribe al dejar de teclear, no en cada pulsación.
    set((s) => ({ drafts: { ...s.drafts, [key]: text } }));
    const pendiente = temporizadoresBorrador[key];
    if (pendiente) window.clearTimeout(pendiente);
    temporizadoresBorrador[key] = window.setTimeout(() => {
      delete temporizadoresBorrador[key];
      void invoke("save_draft", { conversationId: key, text }).catch(() => {});
    }, 500);
  },

  /** Al cerrar es lo que evita perder lo último tecleado: lo que aún esperaba
   *  su retardo se escribe en disco en ese momento. */
  flushDrafts: async () => {
    for (const key of Object.keys(temporizadoresBorrador)) {
      window.clearTimeout(temporizadoresBorrador[key]);
      delete temporizadoresBorrador[key];
      const texto = get().drafts[key] ?? "";
      await invoke("save_draft", { conversationId: key, text: texto }).catch(() => {});
    }
  },

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
      artefactos: [],
      artefactoAbierto: null,
      ...BLANK_STREAM,
      status: "idle",
      error: null,
    });
  },

  selectConversation: async (id) => {
    const messages = await invoke<Message[]>("list_messages", {
      conversationId: id,
    });
    const artefactos = await invoke<Artifact[]>("list_artifacts", { conversationId: id });
    set({
      activeId: id,
      messages,
      artefactos,
      // El panel no se queda mostrando el artifacto de otra conversación.
      artefactoAbierto: null,
      ...BLANK_STREAM,
      status: "idle",
      error: null,
    });
  },

  cambiarVariante: async (messageId) => {
    const { activeId } = get();
    if (!activeId) return;
    await invoke("select_message_variant", { messageId });
    // Se recarga el hilo en vez de tocar el array a mano: cambiar de variante
    // puede quitar y meter mensajes enteros de lo que se ve.
    set({ messages: await invoke<Message[]>("list_messages", { conversationId: activeId }) });
  },

  abrirArtefacto: async (titulo, lenguaje, contenido) => {
    const { activeId } = get();
    if (!activeId) return;
    const nuevo = await invoke<Artifact>("save_artifact", {
      conversationId: activeId,
      titulo,
      lenguaje,
      contenido,
    });
    set({
      artefactoAbierto: nuevo,
      artefactos: await invoke<Artifact[]>("list_artifacts", { conversationId: activeId }),
    });
  },

  verArtefacto: (id) => {
    const a = get().artefactos.find((x) => x.id === id) ?? null;
    set({ artefactoAbierto: a });
  },

  cerrarArtefacto: () => set({ artefactoAbierto: null }),

  borrarArtefacto: async (id) => {
    const { activeId, artefactoAbierto } = get();
    await invoke("delete_artifact", { id });
    if (artefactoAbierto?.id === id) set({ artefactoAbierto: null });
    if (activeId) {
      set({ artefactos: await invoke<Artifact[]>("list_artifacts", { conversationId: activeId }) });
    }
  },

  removeConversation: async (id) => {
    await invoke("delete_conversation", { conversationId: id });
    if (get().activeId === id) {
      set({ activeId: null, messages: [], ...BLANK_STREAM, error: null, status: "idle" });
    }
    await get().loadConversations();
  },

  branchConversation: async (messageId) => {
    const { activeId } = get();
    // Sin conversación guardada no hay nada que bifurcar: el borrador del chat
    // todavía no existe en SQLite.
    if (!activeId) return;
    const rama = await invoke<Conversation>("branch_conversation", {
      conversationId: activeId,
      upToMessageId: messageId,
    });
    await get().loadConversations();
    await get().selectConversation(rama.id);
  },

  setConversationFlags: async (id, flags) => {
    set((s) => ({
      conversations: s.conversations.map((c) => (c.id === id ? { ...c, ...flags } : c)),
    }));
    await invoke("set_conversation_flags", { conversationId: id, ...flags });
    await get().loadConversations();
  },

  renameConversation: async (id, title) => {
    set((s) => ({
      conversations: s.conversations.map((c) => (c.id === id ? { ...c, title } : c)),
    }));
    await invoke("rename_conversation", { conversationId: id, title });
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
      set({ ...BLANK_STREAM, status: "error", error: String(e), errorClase: "otro" });
    }
    await get().loadConversations();
  },

  regenerate: async () => {
    const { activeId, status, imageBusy } = get();
    if (!activeId || status === "streaming" || imageBusy) return;
    // Qué se repite lo decide la última respuesta: si fue un dibujo, reintentar
    // es volver a pedírselo al motor. Dejarlo en manos del modelo de texto
    // borraba la imagen y contestaba sobre algo que no era suyo.
    const ultimo = [...get().messages].reverse().find((m) => m.role === "assistant");
    if (ultimo?.provider === "imagen") {
      set({ imageBusy: true, error: null });
      let fallo: string | null = null;
      try {
        await invoke("regenerate_image", { conversationId: activeId });
      } catch (e) {
        fallo = String(e);
      }
      await get().loadConversations();
      await get().selectConversation(activeId);
      set({ imageBusy: false, ...(fallo ? { status: "error" as const, error: fallo, errorClase: "otro" as const } : {}) });
      return;
    }
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
      set({ ...BLANK_STREAM, status: "error", error: String(e), errorClase: "otro" });
    }
  },

  generateImage: async (prompt) => {
    const { imageBusy, status } = get();
    const text = prompt.trim();
    // Con una respuesta en curso el hilo está ocupado: mezclar una imagen con
    // el stream dejaría dos cosas pendientes en la misma conversación.
    if (!text || imageBusy || status === "streaming") return;
    const convId =
      get().activeId ??
      (await invoke<Conversation>("create_conversation", {
        title: "Nueva conversación",
      })).id;
    set({ activeId: convId, imageBusy: true, error: null });
    let fallo: string | null = null;
    try {
      await invoke("generate_image", { conversationId: convId, prompt: text });
    } catch (e) {
      fallo = String(e);
    }
    // Se recarga desde SQLite en los dos casos: el comando ya escribió el
    // mensaje del usuario y, si hubo suerte, también la imagen. Así el hilo
    // muestra lo que hay de verdad, con los ids reales, y no una copia inventada.
    await get().loadConversations();
    await get().selectConversation(convId);
    // El aviso va DESPUÉS de la recarga: `selectConversation` limpia el error,
    // y si no el fallo del motor desaparecería antes de que se pueda leer.
    set({ imageBusy: false, ...(fallo ? { status: "error" as const, error: fallo, errorClase: "otro" as const } : {}) });
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
      set({ status: "error", error: message, errorClase: "otro" });
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
    try {
      const settings = await invoke<Settings>("get_settings");
      set({ settings, settingsError: null });
      // La zona horaria la sabe el navegador, no Rust. Se guarda solo cuando
      // cambió —viajar o el salto de horario de invierno a verano— para no
      // escribir en la base en cada arranque.
      const minutos = -new Date().getTimezoneOffset();
      if (settings.tzOffsetMin !== minutos) {
        void invoke<Settings>("update_settings", {
          settings: { ...settings, tzOffsetMin: minutos },
        })
          .then((saved) => set({ settings: saved }))
          .catch(() => {});
      }
    } catch (e) {
      // Sin esto el modal se quedaba para siempre en "Cargando ajustes…".
      set({ settingsError: String(e) });
    }
  },

  loadLocalModels: async () => {
    const endpoint = get().settings?.localEndpoint;
    if (!endpoint) return;
    try {
      const localModels = await invoke<LocalModel[]>("list_local_models", { endpoint });
      set({ localModels, localModelsEndpoint: endpoint });
    } catch {
      // Ollama apagado o un endpoint que no es Ollama: «no se sabe», y los
      // gates vuelven a la pista del nombre del modelo.
      set({ localModels: null, localModelsEndpoint: null });
    }
  },

  saveSettings: async (settings) => {
    const saved = await invoke<Settings>("update_settings", { settings });
    set({ settings: saved });
  },

  patchSettings: (partial) => {
    const current = get().settings;
    if (!current) return;
    const next: Settings = { ...current, ...partial };
    set({ settings: next });
    void invoke<Settings>("update_settings", { settings: next })
      .then((saved) => set({ settings: saved }))
      .catch(() => set({ settings: current }));
  },

  loadSkills: async () => {
    const skills = await invoke<Skill[]>("list_skills");
    set({ skills });
  },

  saveSkill: async (skill) => {
    const saved = await invoke<Skill>("save_skill", { skill });
    set((state) => ({
      skills: state.skills.some((s) => s.id === saved.id)
        ? state.skills.map((s) => (s.id === saved.id ? saved : s))
        : [...state.skills, saved],
    }));
    return saved;
  },

  setSkillEnabled: async (id, enabled) => {
    // Optimista: el toggle tiene que responder al toque.
    set((state) => ({
      skills: state.skills.map((s) => (s.id === id ? { ...s, enabled } : s)),
    }));
    try {
      await invoke("set_skill_enabled", { id, enabled });
    } catch (e) {
      set((state) => ({
        skills: state.skills.map((s) => (s.id === id ? { ...s, enabled: !enabled } : s)),
      }));
      throw e;
    }
  },

  removeSkill: async (id) => {
    await invoke("delete_skill", { id });
    set((state) => ({ skills: state.skills.filter((s) => s.id !== id) }));
  },

  openFinder: () => set((state) => ({ findNonce: state.findNonce + 1 })),

  setSearchOpen: (open) => set({ searchOpen: open }),

  clearError: () => set({ error: null, errorClase: null, status: "idle" }),

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

  cancelStreaming: (message) => {
    clearBuffer();
    set((s) => ({
      // Lo que llegó a escribirse antes de parar ya está en SQLite; se añade aquí
      // para que la burbuja no tenga que esperar a recargar el chat.
      messages:
        message && !s.messages.some((m) => m.id === message.id)
          ? [...s.messages, message]
          : s.messages,
      ...BLANK_STREAM,
      status: "idle",
    }));
  },

  failStreaming: (message, clase) => {
    clearBuffer();
    set({ ...BLANK_STREAM, status: "error", error: message, errorClase: clase });
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
