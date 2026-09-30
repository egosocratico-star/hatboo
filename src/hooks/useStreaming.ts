import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useChatStore } from "../store/chatStore";
import type { ClaseError, Message } from "../types";

interface ChunkEvent {
  conversationId: string;
  delta: string;
}

interface DoneEvent {
  conversationId: string;
  message: Message;
}

interface ErrorEvent {
  conversationId: string;
  message: string;
  /** De qué es el fallo. Venía como un único string y la interfaz no podía
   *  ofrecer la salida que toca (Ajustes si es la clave, mirar el endpoint si es
   *  la red). */
  clase: ClaseError;
}

interface StoppedEvent {
  conversationId: string;
  /** Lo que llegó a escribirse antes de parar, ya guardado. `null` si no quedó
   *  nada que conservar. */
  message: Message | null;
}

interface ReasoningEvent {
  conversationId: string;
  delta: string;
}

interface StatusEvent {
  conversationId: string;
  phase: "searching" | "search-empty" | "search-failed";
  detail: string | null;
}

export function useStreaming() {
  useEffect(() => {
    // `listen()` es asíncrono: en StrictMode el desmontaje puede ocurrir antes
    // de que los listeners queden registrados. Sin esta bandera se quedaban
    // vivos y cada chat:done se aplicaba varias veces (burbujas duplicadas).
    let disposed = false;
    const unlisten: UnlistenFn[] = [];

    void Promise.all([
      listen<ChunkEvent>("chat:chunk", ({ payload }) => {
        const store = useChatStore.getState();
        if (payload.conversationId === store.activeId) store.appendChunk(payload.delta);
      }),
      listen<ReasoningEvent>("chat:reasoning", ({ payload }) => {
        const store = useChatStore.getState();
        if (payload.conversationId === store.activeId) store.appendReasoning(payload.delta);
      }),
      listen<StatusEvent>("chat:status", ({ payload }) => {
        const store = useChatStore.getState();
        if (payload.conversationId !== store.activeId) return;
        if (payload.phase === "searching") {
          store.setSearchStatus(true, null);
        } else {
          store.setSearchStatus(false, payload.detail ?? "La búsqueda web falló.");
        }
      }),
      listen<DoneEvent>("chat:done", ({ payload }) => {
        const store = useChatStore.getState();
        if (payload.conversationId === store.activeId) store.finishStreaming(payload.message);
        void store.loadConversations();
      }),
      listen<StoppedEvent>("chat:stopped", ({ payload }) => {
        const store = useChatStore.getState();
        // `chat:stopped` sale también con la respuesta cortada a medias y ya
        // guardada: lo que se escribió se añade al hilo en vez de esperar a
        // recargar la conversación.
        if (payload.conversationId === store.activeId) store.cancelStreaming(payload.message);
        void store.loadConversations();
      }),
      listen<ErrorEvent>("chat:error", ({ payload }) => {
        const store = useChatStore.getState();
        if (payload.conversationId === store.activeId)
          store.failStreaming(payload.message, payload.clase);
      }),
    ]).then((fns) => {
      if (disposed) {
        fns.forEach((fn) => fn());
        return;
      }
      unlisten.push(...fns);
    });

    return () => {
      disposed = true;
      unlisten.forEach((fn) => fn());
    };
  }, []);
}
