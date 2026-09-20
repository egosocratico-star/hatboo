import { useEffect, useRef, useState } from "react";
import { AlertCircle, Paperclip, Send, X } from "lucide-react";
import { useChatStore } from "../store/chatStore";
import MessageBubble from "./MessageBubble";
import Mascot from "./mascot/Mascot";
import ProviderModelPicker from "./ProviderModelPicker";
import ChatPlusMenu from "./ChatPlusMenu";
import type { Attachment, MascotState } from "../types";

export default function ChatWindow() {
  const messages = useChatStore((s) => s.messages);
  const streamingText = useChatStore((s) => s.streamingText);
  const status = useChatStore((s) => s.status);
  const error = useChatStore((s) => s.error);
  const activeTitle = useChatStore((s) => {
    const conv = s.conversations.find((c) => c.id === s.activeId);
    return conv?.title ?? "Chat";
  });
  const sendMessage = useChatStore((s) => s.sendMessage);
  const regenerate = useChatStore((s) => s.regenerate);
  const clearError = useChatStore((s) => s.clearError);

  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [happy, setHappy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevLen = useRef(messages.length);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streamingText]);

  // "Feliz" breve al completar una respuesta larga.
  useEffect(() => {
    if (
      status === "idle" &&
      messages.length > prevLen.current &&
      messages[messages.length - 1]?.role === "assistant" &&
      (messages[messages.length - 1]?.content.length ?? 0) > 200
    ) {
      setHappy(true);
      const t = setTimeout(() => setHappy(false), 2500);
      return () => clearTimeout(t);
    }
    prevLen.current = messages.length;
  }, [messages.length, status, messages]);

  const mascotState: MascotState =
    status === "error"
      ? "confused"
      : status === "streaming"
        ? "thinking"
        : happy
          ? "happy"
          : "idle";

  const submit = async () => {
    const text = input.trim();
    if ((!text && attachments.length === 0) || status === "streaming") return;
    const sent = attachments;
    setInput("");
    setAttachments([]);
    clearError();
    try {
      await sendMessage(text, sent);
    } catch (e) {
      useChatStore.getState().failStreaming(String(e));
    }
  };

  const empty = messages.length === 0 && !streamingText;

  return (
    <div className="flex-1 flex flex-col h-full min-w-0">
      <header className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-base-border">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{activeTitle}</div>
        </div>
        <ProviderModelPicker />
      </header>
      <div className="flex-1 overflow-y-auto">
        {empty ? (
          <div className="h-full flex flex-col items-center justify-center gap-4 px-6">
            <Mascot state={mascotState} size={140} />
            <h1 className="text-2xl font-semibold tracking-tight">
              Hola, soy <span className="text-accent-soft">Hatboo</span>
            </h1>
            <p className="text-sm text-zinc-500 max-w-md text-center">
              Pregúntame lo que necesites. Cambia de proveedor o modelo desde
              arriba a la derecha.
            </p>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto px-6 py-6 space-y-4">
            {messages.map((m, i) => {
              const isLastAssistant =
                m.role === "assistant" &&
                i === messages.length - 1 &&
                status === "idle";
              return (
                <MessageBubble
                  key={m.id}
                  message={m}
                  onRegenerate={isLastAssistant ? () => void regenerate() : undefined}
                />
              );
            })}
            {streamingText && (
              <div className="flex justify-start">
                <div className="max-w-[78%] rounded-2xl rounded-bl-md px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words bg-base-raised border border-base-border">
                  {streamingText}
                  <span className="inline-block w-2 h-4 ml-0.5 align-text-bottom bg-accent-soft animate-pulse" />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {error && (
        <div className="max-w-3xl mx-auto w-full px-6 pb-2">
          <div className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={clearError} className="p-0.5 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <div className="border-t border-base-border bg-base-raised/60 px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-end gap-3">
          <div className="hidden sm:block">
            <Mascot state={mascotState} size={40} />
          </div>
          <div className="flex-1 flex flex-col gap-2 rounded-xl border border-base-border bg-base px-3 py-2 focus-within:border-accent/70 transition-colors">
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {attachments.map((a, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-md text-[11px] border border-base-border bg-base-raised text-zinc-300"
                    title={`${a.text.length.toLocaleString()} caracteres`}
                  >
                    <Paperclip className="w-3 h-3 shrink-0 text-accent-soft" />
                    <span className="max-w-[200px] truncate">{a.name}</span>
                    <button
                      onClick={() =>
                        setAttachments((prev) => prev.filter((_, j) => j !== i))
                      }
                      className="p-0.5 rounded hover:bg-white/10 text-zinc-500 hover:text-white"
                      title="Quitar adjunto"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <ChatPlusMenu
                onPickFiles={(files) =>
                  setAttachments((prev) => [...prev, ...files])
                }
                disabled={status === "streaming"}
              />
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void submit();
                  }
                }}
                rows={Math.min(6, Math.max(1, input.split("\n").length))}
                placeholder="Escribe un mensaje…"
                className="flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-zinc-600 max-h-48"
              />
              <button
                onClick={() => void submit()}
                disabled={
                  (!input.trim() && attachments.length === 0) ||
                  status === "streaming"
                }
                className="p-2 rounded-lg bg-accent text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent-dim transition-colors"
                title="Enviar"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
