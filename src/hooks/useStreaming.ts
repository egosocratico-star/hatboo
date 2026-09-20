import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
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

export function useStreaming() {
  const appendChunk = useChatStore((s) => s.appendChunk);
  const finishStreaming = useChatStore((s) => s.finishStreaming);
  const failStreaming = useChatStore((s) => s.failStreaming);

  useEffect(() => {
    const unlistenFns: Array<() => void> = [];

    const setup = async () => {
      const offs = await Promise.all([
        listen<ChunkEvent>("chat:chunk", ({ payload }) => {
          if (payload.conversationId === useChatStore.getState().activeId) {
            appendChunk(payload.delta);
          }
        }),
        listen<DoneEvent>("chat:done", ({ payload }) => {
          const store = useChatStore.getState();
          if (payload.conversationId === store.activeId) {
            finishStreaming(payload.message);
          }
          void store.loadConversations();
        }),
        listen<ErrorEvent>("chat:error", ({ payload }) => {
          const store = useChatStore.getState();
          if (payload.conversationId === store.activeId) {
            failStreaming(payload.message);
          }
        }),
      ]);
      unlistenFns.push(...offs);
    };

    void setup();
    return () => unlistenFns.forEach((fn) => fn());
  }, [appendChunk, finishStreaming, failStreaming]);
}
