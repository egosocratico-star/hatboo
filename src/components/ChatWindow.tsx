import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  AlertCircle,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Paperclip,
  Scale,
  Search,
  Square,
  X,
} from "lucide-react";
import { useChatStore } from "../store/chatStore";
import MessageBubble from "./MessageBubble";
import RichText from "./RichText";
import AttachmentImage from "./AttachmentThumb";
import Mascot from "./mascot/Mascot";
import ProviderModelPicker from "./ProviderModelPicker";
import ContextMeter from "./ContextMeter";
import ChatPlusMenu from "./ChatPlusMenu";
import PermissionPicker from "./PermissionPicker";
import ModeToggles from "./ModeToggles";
import ComparePanel from "./ComparePanel";
import ThinkingBlock, { formatDuration } from "./ThinkingBlock";
import type { Attachment, MascotState } from "../types";
import { CHAT_FONT_SIZES, CHAT_FONT_STACKS } from "../types";

const SUGGESTIONS = [
  "Resúmeme un archivo",
  "Explícame un error",
  "Escríbeme un email",
  "Ayúdame con código",
];

/** Cuatro franjas; la madrugada tiene la suya porque esta app se usa a deshoras.
 *  Va seguida de "Soy <nombre>", así que es un saludo al usuario, no a la app. */
function saludo(hora: number): string {
  if (hora < 6) return "Aún despiertos";
  if (hora < 13) return "Buenos días";
  if (hora < 20) return "Buenas tardes";
  return "Buenas noches";
}

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
  const activeId = useChatStore((s) => s.activeId);
  const chatFontSize = useChatStore((s) => s.settings?.chatFontSize ?? "md");
  const chatFontFamily = useChatStore((s) => s.settings?.chatFontFamily ?? "sans");
  const assistantName = useChatStore((s) => s.settings?.assistantName?.trim() || "Hatboo");
  const findNonce = useChatStore((s) => s.findNonce);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const regenerate = useChatStore((s) => s.regenerate);
  const editMessage = useChatStore((s) => s.editMessage);
  const branchConversation = useChatStore((s) => s.branchConversation);
  const stopStreaming = useChatStore((s) => s.stopStreaming);
  const clearError = useChatStore((s) => s.clearError);

  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [happy, setHappy] = useState(false);
  const [permOpen, setPermOpen] = useState(false);
  const [comparar, setComparar] = useState(false);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [hitIdx, setHitIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const msgNodes = useRef<Record<string, HTMLDivElement | null>>({});
  const prevLen = useRef(messages.length);
  // Solo se sigue el final si el usuario está cerca de él. Si ha subido a releer,
  // el stream ya no le devuelve abajo a tirones.
  const pinnedRef = useRef(true);

  const onListScroll = () => {
    const el = listRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  // --- Buscar dentro de esta conversación -------------------------------
  const needle = query.trim().toLowerCase();
  const hitIds = useMemo(
    () =>
      needle
        ? messages
            .filter(
              (m) =>
                m.content.toLowerCase().includes(needle) ||
                m.reasoning?.toLowerCase().includes(needle),
            )
            .map((m) => m.id)
        : [],
    [messages, needle],
  );
  // Se lee desde un ref para poder saltar justo después de re-renderizar, sin
  // arrastrar un estado más que mantener sincronizado.
  const hitsRef = useRef<string[]>([]);
  hitsRef.current = hitIds;

  const focusHit = (i: number) => {
    const ids = hitsRef.current;
    if (ids.length === 0) return;
    const idx = ((i % ids.length) + ids.length) % ids.length;
    setHitIdx(idx);
    const el = msgNodes.current[ids[idx]];
    if (!el) return;
    // Al buscar a mano el streaming no debe volver a bajar.
    pinnedRef.current = false;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  const onQueryChange = (value: string) => {
    setQuery(value);
    setHitIdx(0);
    if (value.trim()) requestAnimationFrame(() => focusHit(0));
  };

  const closeSearch = () => {
    setQuery("");
    setHitIdx(0);
    setSearchOpen(false);
  };

  const openSearch = () => {
    setSearchOpen(true);
    requestAnimationFrame(() => searchRef.current?.focus());
  };

  /** Inserta una plantilla en el cursor del textarea, no al final. */
  const insertTemplate = (text: string) => {
    const el = inputRef.current;
    const from = el?.selectionStart ?? input.length;
    const to = el?.selectionEnd ?? input.length;
    const before = input.slice(0, from);
    // Se separa de lo que haya escrito solo si hace falta.
    const glue = before && !/\s$/.test(before) ? " " : "";
    const next = before + glue + text + input.slice(to);
    setInput(next);
    const caret = before.length + glue.length + text.length;
    requestAnimationFrame(() => {
      const node = inputRef.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(caret, caret);
    });
  };

  // Cambiar de conversación deja la búsqueda donde empezó.
  useEffect(() => {
    setQuery("");
    setHitIdx(0);
    setSearchOpen(false);
  }, [activeId]);

  // Ctrl/Cmd+F se pide desde el atajo global de App (veáse chatStore.findNonce).
  useEffect(() => {
    if (!findNonce) return;
    setSearchOpen(true);
    requestAnimationFrame(() => searchRef.current?.focus());
  }, [findNonce]);

  const fontPx = CHAT_FONT_SIZES.find((f) => f.id === chatFontSize)?.px ?? 15;
  // La lista exporta el tamaño base; RichText y la burbuja del usuario derivan
  // el suyo con calc(), así escalar mueve todo el texto a la vez.
  const fontVars = {
    "--chat-fs": `${fontPx}px`,
    "--chat-font": CHAT_FONT_STACKS[chatFontFamily],
  } as CSSProperties;

  // El salto del scroll es suave cuando LLEGA un mensaje y directo mientras se
  // escribe: durante el streaming llegan fragmentos cada pocos milisegundos, y
  // pedir "smooth" en cada uno hace que el navegador persiga un objetivo que ya
  // cambió — que era justo el tirón que se quitó en la tanda 6.
  const largoPrevio = useRef(messages.length);
  useEffect(() => {
    const el = listRef.current;
    if (!el || !pinnedRef.current) return;
    const mensajeNuevo = messages.length !== largoPrevio.current;
    largoPrevio.current = messages.length;
    el.scrollTo({ top: el.scrollHeight, behavior: mensajeNuevo ? "smooth" : "auto" });
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
  const handleBranch = useCallback(
    (messageId: string) => void branchConversation(messageId),
    [branchConversation],
  );

  const busy = status === "streaming";
  // Con una respuesta en curso ya no es un chat vacío: hay que mostrar el
  // indicador de búsqueda/pensamiento, aunque aún no haya mensajes.
  const empty = messages.length === 0 && !busy;

  const errorBanner = error && (
    <div className="mb-2 flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
      <span className="flex-1">{error}</span>
      <button onClick={clearError} className="p-0.5 hover:text-layer">
        <X className="w-4 h-4" />
      </button>
    </div>
  );

  const composer = (
    <>
    <div className="rounded-2xl border border-base-border bg-base-raised/70 shadow-xl shadow-shade/30 px-3 pt-3 pb-2.5 transition-colors focus-within:border-accent/50">
      {attachments.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pb-2 pl-0.5">
          {attachments.map((a, i) => (
            <span key={i} className="relative inline-flex">
              {a.imageFile ? (
                <AttachmentImage file={a.imageFile} name={a.name} />
              ) : (
                <span
                  className="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-md text-[11px] border border-base-border bg-base text-zinc-300"
                  title={`${a.text.length.toLocaleString()} caracteres`}
                >
                  <Paperclip className="w-3 h-3 shrink-0 text-accent-soft" />
                  <span className="max-w-[200px] truncate">{a.name}</span>
                </span>
              )}
              <button
                onClick={() =>
                  setAttachments((prev) => prev.filter((_, j) => j !== i))
                }
                className="absolute -right-1.5 -top-1.5 grid place-items-center w-4 h-4 rounded-full border border-base-border bg-base-raised text-zinc-400 hover:bg-accent hover:text-white transition-colors"
                title="Quitar adjunto"
              >
                <X className="w-2.5 h-2.5" />
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
          onInsertTemplate={insertTemplate}
          disabled={busy}
        />
        <PermissionPicker open={permOpen} onOpenChange={setPermOpen} />
        <ModeToggles />
        <button
          onClick={() => setComparar(true)}
          disabled={busy}
          title="Comparar la misma pregunta en 2-3 modelos a la vez"
          className="flex items-center gap-1.5 rounded-full border border-base-border px-2.5 py-1.5 text-xs text-zinc-400 transition-colors hover:border-accent/50 hover:text-zinc-100 disabled:opacity-40"
        >
          <Scale className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden sm:inline">Comparar</span>
        </button>
        <div className="flex-1 min-w-0" />
        <ContextMeter conversationId={activeId} tick={messages.length} />
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
      {comparar && (
        <ComparePanel conversationId={activeId} onCerrar={() => setComparar(false)} />
      )}
    </>
  );

  if (empty) {
    return (
      <div className="flex-1 flex flex-col h-full min-w-0">
        <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6 pb-20">
          <div className="flex flex-col items-center gap-3">
            <Mascot state={mascotState} size={120} />
            <h1 className="text-2xl font-semibold tracking-tight">
              {saludo(new Date().getHours())}. Soy{" "}
              <span className="text-accent-soft">{assistantName}</span>
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
      <header className="h-11 shrink-0 flex items-center gap-3 px-5">
        <div className="flex-1 min-w-0 text-sm font-medium truncate text-zinc-300">
          {activeTitle}
        </div>
        {searchOpen ? (
          <div className="flex items-center gap-1 rounded-full border border-base-border bg-base-raised py-1 pl-2.5 pr-1">
            <Search className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  focusHit(hitIdx + (e.shiftKey ? -1 : 1));
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  closeSearch();
                }
              }}
              placeholder="Buscar en el chat"
              className="w-40 bg-transparent text-xs outline-none placeholder:text-zinc-600"
            />
            <span className="shrink-0 text-[11px] tabular-nums text-zinc-500">
              {hitIds.length ? `${hitIdx + 1}/${hitIds.length}` : "0/0"}
            </span>
            <button
              onClick={() => focusHit(hitIdx - 1)}
              disabled={hitIds.length === 0}
              title="Anterior (Shift+Enter)"
              className="rounded-full p-1 text-zinc-500 hover:bg-layer/8 hover:text-zinc-100 disabled:opacity-30 transition-colors"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => focusHit(hitIdx + 1)}
              disabled={hitIds.length === 0}
              title="Siguiente (Enter)"
              className="rounded-full p-1 text-zinc-500 hover:bg-layer/8 hover:text-zinc-100 disabled:opacity-30 transition-colors"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={closeSearch}
              title="Cerrar búsqueda (Esc)"
              className="rounded-full p-1 text-zinc-500 hover:bg-layer/8 hover:text-zinc-100 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button
            onClick={openSearch}
            title="Buscar en la conversación"
            className="rounded-md p-1.5 text-zinc-500 hover:bg-layer/5 hover:text-zinc-100 transition-colors"
          >
            <Search className="w-4 h-4" />
          </button>
        )}
      </header>

      <div
        ref={listRef}
        onScroll={onListScroll}
        style={fontVars}
        className="flex-1 overflow-y-auto"
      >
        <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
          {messages.map((m, i) => {
            const isLastAssistant =
              m.role === "assistant" &&
              i === messages.length - 1 &&
              status === "idle";
            const isHit = hitIds.includes(m.id);
            const isCurrent = isHit && hitIds[hitIdx] === m.id;
            return (
              <div
                key={m.id}
                ref={(el) => {
                  msgNodes.current[m.id] = el;
                }}
                className={`-mx-2 rounded-xl px-2 outline-offset-[-8px] transition-opacity duration-200 ${
                  isCurrent ? "outline outline-1 outline-accent/70" : ""
                } ${needle && !isHit ? "opacity-35" : ""}`}
              >
                <MessageBubble
                  message={m}
                  busy={busy}
                  onRegenerate={isLastAssistant ? handleRegenerate : undefined}
                  onEdit={m.role === "user" && !busy ? handleEdit : undefined}
                  onBranch={activeId && !busy ? handleBranch : undefined}
                />
              </div>
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
