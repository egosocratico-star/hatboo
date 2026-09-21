import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useChatStore } from "../store/chatStore";
import type { Message } from "../types";

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
}

interface CancelledEvent {
  conversationId: string;
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
      listen<CancelledEvent>("chat:cancelled", ({ payload }) => {
        const store = useChatStore.getState();
        if (payload.conversationId === store.activeId) store.cancelStreaming();
      }),
      listen<ErrorEvent>("chat:error", ({ payload }) => {
        const store = useChatStore.getState();
        if (payload.conversationId === store.activeId) store.failStreaming(payload.message);
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
