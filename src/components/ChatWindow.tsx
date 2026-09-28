import { t } from "../i18n";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  AlertCircle,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Code2,
  FileText,
  Mail,
  Paperclip,
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
import Dots from "./Dots";
import SuggestionGrid, { type Sugerencia } from "./SuggestionGrid";
import ModeToggles from "./ModeToggles";
import ThinkingBlock, { formatDuration } from "./ThinkingBlock";
import { useSoltados } from "../hooks/useSoltados";
import type { Attachment, MascotState } from "../types";
import { CHAT_FONT_SIZES, CHAT_FONT_STACKS } from "../types";
import { saleDelEquipo } from "../modelo";
import { modeloActivo } from "../proveedores";

/** En español a pelo: si se tradujeran aquí, el texto quedaría congelado al del
 *  arranque, porque esto se evalúa al importar el módulo. Se traduce al pintar. */
const SUGERENCIAS: Sugerencia[] = [
  { texto: "Resúmeme un archivo", icono: FileText },
  { texto: "Explícame un error", icono: AlertCircle },
  { texto: "Escríbeme un email", icono: Mail },
  { texto: "Ayúdame con código", icono: Code2 },
];

/** Cuatro franjas; la madrugada tiene la suya porque esta app se usa a deshoras.
 *  Va seguida de "Soy <nombre>", así que es un saludo al usuario, no a la app. */
function saludo(hora: number): string {
  if (hora < 6) return t("Aún despiertos");
  if (hora < 13) return t("Buenos días");
  if (hora < 20) return t("Buenas tardes");
  return t("Buenas noches");
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
  // Es el nombre del USUARIO (Ajustes → Perfil: «¿Cómo debería llamarte
  // Hatboo?»), no el del asistente: por eso se saluda con él y no se dice «Soy».
  const nombre = useChatStore((s) => s.settings?.assistantName?.trim() ?? "");
  const proveedor = useChatStore((s) => s.settings?.activeProvider ?? "local");
  const modelo = useChatStore((s) => (s.settings ? modeloActivo(s.settings) : ""));
  /** Modo código: mientras espera, la etiqueta dice lo que se va a hacer. */
  const codigo = useChatStore((s) => s.settings?.codeMode ?? false);
  const findNonce = useChatStore((s) => s.findNonce);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const regenerate = useChatStore((s) => s.regenerate);
  const editMessage = useChatStore((s) => s.editMessage);
  const branchConversation = useChatStore((s) => s.branchConversation);
  const stopStreaming = useChatStore((s) => s.stopStreaming);
  const clearError = useChatStore((s) => s.clearError);
  /** El motor de imagen está tardando: no hay stream que enseñar, solo espera. */
  const imageBusy = useChatStore((s) => s.imageBusy);

  // El texto sin enviar vive en el store, por hilo: cambiar de conversación ya
  // no deja en blanco lo que se estaba escribiendo.
  const claveBorrador = activeId ?? "nueva";
  const input = useChatStore((s) => s.drafts[claveBorrador] ?? "");
  const setDraft = useChatStore((s) => s.setDraft);
  const setInput = (value: string) => setDraft(claveBorrador, value);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [happy, setHappy] = useState(false);
  /** Lo que falló al adjuntar un archivo soltado sobre la ventana: se dice aquí,
   *  que es donde se soltó, en vez de perderse en un aviso que pasa volando. */
  const [avisoSoltada, setAvisoSoltada] = useState<string | null>(null);
  const adjuntaSoltados = useCallback(
    (lista: Attachment[]) => setAttachments((prev) => [...prev, ...lista]),
    [],
  );
  const avisaSoltada = useCallback((texto: string) => setAvisoSoltada(texto), []);
  useSoltados(adjuntaSoltados, avisaSoltada, true);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [hitIdx, setHitIdx] = useState(0);
  // Cuánto separa del final la vista: se usa para el botón flotante «Ir al final».
  const [lejos, setLejos] = useState(false);
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
    const d = el.scrollHeight - el.scrollTop - el.clientHeight;
    pinnedRef.current = d < 120;
    setLejos(d > 480);
  };

  // Al bajar a mano se vuelve a pegar el stream al final, que es lo que espera
  // quien pulsa el botón.
  const bajar = () => {
    const el = listRef.current;
    if (!el) return;
    pinnedRef.current = true;
    setLejos(false);
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
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
    // De segundo en segundo: lo único que cambia es un dígito, y cada tick
    // re-renderiza toda la ventana.
    const timer = setInterval(() => setElapsed(Date.now() - startedAt), 1000);
    return () => clearInterval(timer);
  }, [status, startedAt, thinkingMs]);
  const thinkMs = thinkingMs ?? elapsed;

  // Lo que se dice mientras no llega ni una letra. Cada frase tiene que
  // corresponder a algo que esté pasando de verdad: «Pensando» salía con el
  // razonamiento activado aunque el modelo no hubiera devuelto un solo
  // pensamiento, y eso no lo estaba haciendo nadie. Cuando el pensamiento llega
  // de verdad ya tiene su propio bloque con su cronómetro.
  const adjuntos = [...messages].reverse().find((m) => m.role === "user")?.attachments ?? [];
  const imagenes = adjuntos.filter((a) => a.imageMediaType).length;
  const espera =
    imagenes > 1
      ? t("Viendo las imágenes…")
      : imagenes === 1
        ? t("Viendo la imagen…")
        : adjuntos.length > 0
          ? t("Leyendo el archivo…")
          : codigo
            ? t("Preparando el código…")
            : t("En espera…");

  // "Feliz" breve al completar una respuesta larga.
  useEffect(() => {
    if (
      status === "idle" &&
      messages.length > prevLen.current &&
      messages[messages.length - 1]?.role === "assistant" &&
      (messages[messages.length - 1]?.content.length ?? 0) > 200
    ) {
      setHappy(true);
      const temporizador = setTimeout(() => setHappy(false), 2500);
      return () => clearTimeout(temporizador);
    }
    prevLen.current = messages.length;
  }, [messages.length, status, messages]);

  const mascotState: MascotState =
    status === "error"
      ? "confused"
      : status === "streaming" || imageBusy
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
    setAvisoSoltada(null);
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
  // Índice de la última pregunta, para el reintento de su burbuja.
  const ultimoUsuario = messages.map((m) => m.role).lastIndexOf("user");
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
  // indicador de búsqueda/pensamiento, aunque aún no haya mensajes. Lo mismo con
  // una imagen pidiéndose: el hilo lleva segundos sin nada escrito.
  const empty = messages.length === 0 && !busy && !imageBusy;

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
    <div className="rounded-2xl border border-base-border bg-base-card shadow-xl shadow-shade/30 px-3 pt-3 pb-2.5 transition-colors focus-within:border-accent/50">
      {avisoSoltada && (
        <p className="pb-2 pl-1 text-[11px] leading-snug text-red-400/90">{avisoSoltada}</p>
      )}
      {attachments.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pb-2 pl-0.5">
          {attachments.map((a, i) => (
            <span key={i} className="relative inline-flex">
              {a.imageFile ? (
                <AttachmentImage file={a.imageFile} name={a.name} />
              ) : (
                <span
                  className="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-md text-[11px] border border-base-border bg-base text-zinc-300"
                  title={t("{n} caracteres", { n: a.text.length.toLocaleString() })}
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
                title={t("Quitar adjunto")}
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
        placeholder={t("Pregúntame lo que necesites…")}
        className="w-full resize-none bg-transparent px-1 pb-2 text-sm leading-relaxed outline-none placeholder:text-zinc-600 max-h-48"
      />

      <div className="flex items-center gap-2">
        <ChatPlusMenu
          onPickFiles={(files) => setAttachments((prev) => [...prev, ...files])}
          onInsertTemplate={insertTemplate}
          disabled={busy}
        />
        <ModeToggles />
        <div className="flex-1 min-w-0" />
        <ContextMeter conversationId={activeId} tick={messages.length} />
        <ProviderModelPicker />
        {busy ? (
          <button
            onClick={() => void stopStreaming()}
            className="grid place-items-center w-8 h-8 shrink-0 rounded-full bg-accent text-white hover:bg-accent-dim transition-colors"
            title={t("Detener respuesta")}
          >
            <Square className="w-3 h-3 fill-current" />
          </button>
        ) : (
          <button
            onClick={() => void submit()}
            disabled={!input.trim() && attachments.length === 0}
            className="grid place-items-center w-8 h-8 shrink-0 rounded-full bg-accent text-white disabled:opacity-35 disabled:cursor-not-allowed hover:bg-accent-dim transition-colors"
            title={t("Enviar")}
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
            <Mascot state={mascotState} size={132} />
            <div className="flex flex-col items-center gap-1.5">
              <h1 className="text-[28px] font-semibold leading-tight tracking-tight">
                {nombre ? (
                  <>
                    {saludo(new Date().getHours())},{" "}
                    <span className="text-accent-soft">{nombre}</span>
                  </>
                ) : (
                  <>
                    {saludo(new Date().getHours())}. {t("Soy")}{" "}
                    <span className="text-accent-soft">Hatboo</span>
                  </>
                )}
              </h1>
              <p className="text-sm text-zinc-400">
                {saleDelEquipo(proveedor, modelo)
                  ? t("El historial se queda aquí. Esta respuesta la genera {m} fuera de tu equipo.", {
                      m: modelo || t("el proveedor elegido"),
                    })
                  : t("Local-first: nada sale de tu equipo salvo lo que mandes al proveedor que elijas.")}
              </p>
            </div>
          </div>
          <div className="w-full max-w-3xl space-y-3">
            {errorBanner}
            {composer}
            <div className="pt-1">
              <SuggestionGrid
                items={SUGERENCIAS}
                onPick={(s) => {
                  setInput(s);
                  inputRef.current?.focus();
                }}
              />
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
              placeholder={t("Buscar en el chat")}
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
              title={t("Siguiente (Enter)")}
              className="rounded-full p-1 text-zinc-500 hover:bg-layer/8 hover:text-zinc-100 disabled:opacity-30 transition-colors"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={closeSearch}
              title={t("Cerrar búsqueda (Esc)")}
              className="rounded-full p-1 text-zinc-500 hover:bg-layer/8 hover:text-zinc-100 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button
            onClick={openSearch}
            title={t("Buscar en la conversación")}
            className="rounded-md p-1.5 text-zinc-500 hover:bg-layer/5 hover:text-zinc-100 transition-colors"
          >
            <Search className="w-4 h-4" />
          </button>
        )}
      </header>

      {/* El hilo va dentro de un relativo para que «Ir al final» flote sobre la
          lista y no sobre el compositor; `min-h-0` mantiene el reparto del flex. */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={listRef}
          onScroll={onListScroll}
          style={fontVars}
          className="h-full overflow-y-auto"
        >
        <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
          {messages.map((m, i) => {
            const isLastAssistant =
              m.role === "assistant" &&
              i === messages.length - 1 &&
              status === "idle";
            // El reintento también va en la última pregunta: cuando la respuesta
            // falla no queda burbuja que regenerar, y sin esto tocaba reescribir
            // el mensaje. Con el fallo en pantalla tampoco hay que quitarlo.
            const esUltimaPregunta =
              m.role === "user" && i === ultimoUsuario && status !== "streaming";
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
                  onRegenerate={isLastAssistant || esUltimaPregunta ? handleRegenerate : undefined}
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
                  <span className="flex items-center gap-2 text-sm text-zinc-500">
                    <Dots />
                    {t("Buscando en la web…")}
                  </span>
                )}
                {searchNote && !searching && (
                  <p className="mb-1 text-[12px] text-amber-400/80">{searchNote}</p>
                )}
                {/* El bloque de razonamiento ocupa SIEMPRE el mismo sitio del
                    árbol. Estaba montado en dos huecos distintos —uno mientras no
                    había texto, otro cuando lo había—, y al llegar la primera
                    letra React lo desmontaba y lo volvía a crear: el bloque abierto
                    se cerraba solo justo cuando interesa leerlo. */}
                {streamingReasoning && (
                  <ThinkingBlock
                    reasoning={streamingReasoning}
                    ms={thinkMs}
                    streaming={!streamingText}
                  />
                )}
                {streamingText ? (
                  <RichText text={streamingText} />
                ) : (
                  // Con razonamiento en vivo el encabezado del bloque ya cronometra.
                  !searching &&
                  !streamingReasoning && (
                    <span className="flex items-center gap-2 text-sm text-zinc-500">
                      <Dots />
                      {thinkMs >= 1000 ? `${espera} ${formatDuration(thinkMs)}` : espera}
                    </span>
                  )
                )}
              </div>
            </div>
          )}
          {imageBusy && (
            // Sin stream que enseñar: el motor de nube está devolviendo los
            // bytes. El hilo se ve quieto unos segundos y luego llega la imagen.
            <div className="flex justify-start">
              <span className="flex items-center gap-2 text-sm text-zinc-500">
                <Dots />
                {t("Dibujando…")}
              </span>
            </div>
          )}
        </div>
        </div>
        {lejos && (
          <button
            onClick={bajar}
            title={t("Ir al final")}
            aria-label={t("Ir al final")}
            className="absolute bottom-4 right-5 rounded-full border border-base-border bg-base-raised p-2 text-zinc-400 shadow-lg shadow-shade/40 transition-colors hover:text-zinc-100"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        )}
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
