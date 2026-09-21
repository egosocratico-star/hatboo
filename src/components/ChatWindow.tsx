import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowUp,
  Image as ImageIcon,
  Paperclip,
  Square,
  X,
} from "lucide-react";
import { useChatStore } from "../store/chatStore";
import MessageBubble from "./MessageBubble";
import RichText from "./RichText";
import Mascot from "./mascot/Mascot";
import ProviderModelPicker from "./ProviderModelPicker";
import ChatPlusMenu from "./ChatPlusMenu";
import PermissionPicker from "./PermissionPicker";
import ModeToggles from "./ModeToggles";
import ThinkingBlock, { formatDuration } from "./ThinkingBlock";
import type { Attachment, MascotState } from "../types";

const SUGGESTIONS = [
  "Resúmeme un archivo",
  "Explícame un error",
  "Escríbeme un email",
  "Ayúdame con código",
];

export default function ChatWindow() {
  const messages = useChatStore((s) => s.messages);
  const streamingText = useChatStore((s) => s.streamingText);
  const streamingReasoning = useChatStore((s) => s.streamingReasoning);
  const searching = useChatStore((s) => s.searching);
  const searchNote = useChatStore((s) => s.searchNote);
  const startedAt = useChatStore((s) => s.startedAt);
  const thinkingMs = useChatStore((s) => s.thinkingMs);
  const status = useChatStore((s) => s.status);
  const error = useChatStore((s) => s.error);
  const activeTitle = useChatStore((s) => {
    const conv = s.conversations.find((c) => c.id === s.activeId);
    return conv?.title ?? "Chat";
  });
  const sendMessage = useChatStore((s) => s.sendMessage);
  const regenerate = useChatStore((s) => s.regenerate);
  const editMessage = useChatStore((s) => s.editMessage);
  const stopStreaming = useChatStore((s) => s.stopStreaming);
  const clearError = useChatStore((s) => s.clearError);

  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [happy, setHappy] = useState(false);
  const [permOpen, setPermOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const prevLen = useRef(messages.length);
  // Solo se sigue el final si el usuario está cerca de él. Si ha subido a releer,
  // el stream ya no le devuelve abajo a tirones.
  const pinnedRef = useRef(true);

  const onListScroll = () => {
    const el = listRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  useEffect(() => {
    const el = listRef.current;
    if (!el || !pinnedRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, streamingText, streamingReasoning]);

  // Cronómetro en vivo del pensamiento; `startedAt` lo fija el store al llegar
  // el primer fragmento de razonamiento.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    // El cronómetro solo corre mientras se piensa; al empezar la respuesta el
    // store deja la duración congelada en `thinkingMs`.
    if (status !== "streaming" || !startedAt || thinkingMs != null) return;
    setElapsed(Date.now() - startedAt);
    const timer = setInterval(() => setElapsed(Date.now() - startedAt), 250);
    return () => clearInterval(timer);
  }, [status, startedAt, thinkingMs]);
  const thinkMs = thinkingMs ?? elapsed;

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
    pinnedRef.current = true;
    try {
      await sendMessage(text, sent);
    } catch (e) {
      useChatStore.getState().failStreaming(String(e));
    }
  };

  // Identidades estables: sin esto cada fragmento del stream re-renderizaba
  // también todas las burbujas ya cerradas.
  const handleRegenerate = useCallback(() => void regenerate(), [regenerate]);
  const handleEdit = useCallback(
    (messageId: string, content: string) => void editMessage(messageId, content),
    [editMessage],
  );

  const busy = status === "streaming";
  // Con una respuesta en curso ya no es un chat vacío: hay que mostrar el
  // indicador de búsqueda/pensamiento, aunque aún no haya mensajes.
  const empty = messages.length === 0 && !busy;

  const errorBanner = error && (
    <div className="mb-2 flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
      <span className="flex-1">{error}</span>
      <button onClick={clearError} className="p-0.5 hover:text-white">
        <X className="w-4 h-4" />
      </button>
    </div>
  );

  const composer = (
    <div className="rounded-2xl border border-base-border bg-base-raised/70 shadow-xl shadow-black/30 px-3 pt-3 pb-2.5 transition-colors focus-within:border-accent/50">
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pb-2 pl-0.5">
          {attachments.map((a, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-md text-[11px] border border-base-border bg-base text-zinc-300"
              title={
                a.imageFile
                  ? "Imagen adjunta"
                  : `${a.text.length.toLocaleString()} caracteres`
              }
            >
              {a.imageFile ? (
                <ImageIcon className="w-3 h-3 shrink-0 text-accent-soft" />
              ) : (
                <Paperclip className="w-3 h-3 shrink-0 text-accent-soft" />
              )}
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

      <textarea
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
        }}
        rows={Math.min(6, Math.max(1, input.split("\n").length))}
        placeholder="Pregúntame lo que necesites…"
        className="w-full resize-none bg-transparent px-1 pb-2 text-sm leading-relaxed outline-none placeholder:text-zinc-600 max-h-48"
      />

      <div className="flex items-center gap-2">
        <ChatPlusMenu
          onPickFiles={(files) => setAttachments((prev) => [...prev, ...files])}
          disabled={busy}
        />
        <PermissionPicker open={permOpen} onOpenChange={setPermOpen} />
        <ModeToggles />
        <div className="flex-1 min-w-0" />
        <ProviderModelPicker />
        {busy ? (
          <button
            onClick={() => void stopStreaming()}
            className="grid place-items-center w-8 h-8 shrink-0 rounded-full bg-accent text-white hover:bg-accent-dim transition-colors"
            title="Detener respuesta"
          >
            <Square className="w-3 h-3 fill-current" />
          </button>
        ) : (
          <button
            onClick={() => void submit()}
            disabled={!input.trim() && attachments.length === 0}
            className="grid place-items-center w-8 h-8 shrink-0 rounded-full bg-accent text-white disabled:opacity-35 disabled:cursor-not-allowed hover:bg-accent-dim transition-colors"
            title="Enviar"
          >
            <ArrowUp className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );

  if (empty) {
    return (
      <div className="flex-1 flex flex-col h-full min-w-0">
        <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6 pb-20">
          <div className="flex flex-col items-center gap-3">
            <Mascot state={mascotState} size={120} />
            <h1 className="text-2xl font-semibold tracking-tight">
              Hola, soy <span className="text-accent-soft">Hatboo</span>
            </h1>
          </div>
          <div className="w-full max-w-3xl space-y-3">
            {errorBanner}
            {composer}
            <div className="flex flex-wrap gap-2 justify-center pt-1">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setInput(s);
                    inputRef.current?.focus();
                  }}
                  className="rounded-full border border-base-border bg-base-raised/60 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-100 hover:border-accent/50 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full min-w-0">
      <header className="h-11 shrink-0 flex items-center px-5">
        <div className="text-sm font-medium truncate text-zinc-300">
          {activeTitle}
        </div>
      </header>

      <div ref={listRef} onScroll={onListScroll} className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
          {messages.map((m, i) => {
            const isLastAssistant =
              m.role === "assistant" &&
              i === messages.length - 1 &&
              status === "idle";
            return (
              <MessageBubble
                key={m.id}
                message={m}
                busy={busy}
                onRegenerate={isLastAssistant ? handleRegenerate : undefined}
                onEdit={m.role === "user" && !busy ? handleEdit : undefined}
              />
            );
          })}
          {status === "streaming" && (
            <div className="flex justify-start">
              <div className="min-w-0">
                {searching && (
                  <span className="text-sm text-zinc-500 animate-pulse">
                    Buscando en la web…
                  </span>
                )}
                {searchNote && !searching && (
                  <p className="mb-1 text-[12px] text-amber-400/80">{searchNote}</p>
                )}
                {!streamingText && streamingReasoning && (
                  <ThinkingBlock
                    reasoning={streamingReasoning}
                    ms={thinkMs}
                    streaming
                  />
                )}
                {streamingText ? (
                  <div>
                    {streamingReasoning && (
                      <ThinkingBlock reasoning={streamingReasoning} ms={thinkMs} />
                    )}
                    <RichText text={streamingText} />
                    <span className="inline-block w-2 h-4 ml-0.5 align-text-bottom bg-accent-soft animate-caret" />
                  </div>
                ) : (
                  // Con razonamiento en vivo el encabezado del bloque ya cronometra.
                  !searching &&
                  !streamingReasoning && (
                    <span className="text-sm text-zinc-500 animate-pulse">
                      {thinkMs >= 1000
                        ? `Pensando… ${formatDuration(thinkMs)}`
                        : "Pensando…"}
                    </span>
                  )
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="px-6 pb-5 pt-2">
        <div className="max-w-3xl mx-auto flex items-end gap-3">
          {status !== "idle" && (
            <div className="hidden sm:block shrink-0 pb-1">
              <Mascot state={mascotState} size={36} />
            </div>
          )}
          <div className="flex-1 min-w-0">
            {errorBanner}
            {composer}
          </div>
        </div>
      </div>
    </div>
  );
}
