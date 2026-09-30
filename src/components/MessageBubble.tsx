import { memo, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { t, useT, currentLanguage } from "../i18n";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  GitBranch,
  MoreHorizontal,
  Paperclip,
  Pencil,
  RotateCcw,
  RotateCw,
  ScrollText,
  Square,
  ThumbsDown,
  ThumbsUp,
  Volume2,
  X,
} from "lucide-react";
import RichText from "./RichText";
import PromptModal from "./PromptModal";
import ThinkingBlock from "./ThinkingBlock";
import SourcesBlock from "./SourcesBlock";
import AttachmentImage from "./AttachmentThumb";
import Popover from "./Popover";
import { useChatStore } from "../store/chatStore";
import { haceRelativo, fmtDate } from "../time";
import type { Message } from "../types";

interface Props {
  message: Message;
  onRegenerate?: () => void;
  /** Editar un mensaje propio: sin esta prop el lápiz no aparece. */
  onEdit?: (messageId: string, content: string) => void;
  /** Bifurcar la conversación hasta este mensaje. Estable entre renders para no
   *  invalidar el `memo` de todas las burbujas durante el streaming. */
  onBranch?: (messageId: string) => void;
  /** Bloquea editar mientras hay una respuesta en curso. */
  busy?: boolean;
  /** `false` donde la fila flotante se plantaría encima de lo que viene debajo. */
  accionesFlotando?: boolean;
}

/** «‹ 2/3 ›» de un punto del hilo. Editar o regenerar ya no borra la versión
 *  anterior, así que hace falta una forma de volver a ella sin salir de la
 *  conversación. Se queda visible —no al pasar el ratón— porque si no nadie
 *  sabe que existe otra versión. */
function SelectorVariantes({ message }: { message: Message }) {
  const cambiar = useChatStore((s) => s.cambiarVariante);
  const v = message.variantas;
  if (!v || v.total < 2) return null;
  const i = v.hermanas.indexOf(message.id);
  const ir = (paso: number) => {
    const destino = v.hermanas[i + paso];
    if (destino) void cambiar(destino);
  };
  const flecha =
    "grid h-5 w-5 place-items-center rounded-md text-zinc-500 transition-colors hover:bg-base-hover hover:text-zinc-200 disabled:opacity-30";
  return (
    <span className="inline-flex items-center gap-0.5">
      <button
        onClick={() => ir(-1)}
        disabled={i <= 0}
        title={t("Versión anterior de este mensaje")}
        className={flecha}
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      <span className="text-[10px] tabular-nums text-zinc-500">
        {v.posicion}/{v.total}
      </span>
      <button
        onClick={() => ir(1)}
        disabled={i < 0 || i >= v.hermanas.length - 1}
        title={t("Versión siguiente de este mensaje")}
        className={flecha}
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

function ActionButton({
  title,
  onClick,
  active = false,
  children,
}: {
  title: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`rounded-md p-1 transition-colors hover:bg-layer/8 ${
        active ? "text-accent-soft" : "text-zinc-500 hover:text-zinc-100"
      }`}
    >
      {children}
    </button>
  );
}

/** La fila de acciones flota en el hueco que ya deja el mensaje en vez de
 *  reservar el suyo: con `opacity-0` seguía ocupando ~30 px y la separación real
 *  entre dos frases se iba a más de 50 px, que es el hueco enorme del hilo.
 *  Cabe en los 24 px de `space-y-6` con `p-1` en cada botón.
 *  En el hilo de trabajo no puede flotar: allí los mensajes van casi pegados y
 *  justo debajo de cada respuesta está su traza, así que ocupa su sitio. */
const BASE_ACCIONES =
  "flex items-center gap-0.5 transition-opacity focus-within:opacity-100";
const ACCIONES_FLOTANDO = `absolute top-full mt-0.5 ${BASE_ACCIONES}`;
const ACCIONES_EN_FLUJO = `mt-0.5 ${BASE_ACCIONES}`;

const FILA_MENU =
  "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-zinc-300 transition-colors hover:bg-base-hover hover:text-zinc-100";

/** La hora relativa vive en la propia fila de acciones: antes solo salía en un
 *  `title` y nadie la descubría; así se lee de un vistazo al pasar por encima. */
function Sello({ ms }: { ms: number }) {
  return (
    <span
      title={fmtDate(ms)}
      className="px-1 text-[11px] tabular-nums text-zinc-600 select-none"
    >
      {haceRelativo(ms)}
    </span>
  );
}

function MessageBubble({
  message,
  onRegenerate,
  onEdit,
  onBranch,
  busy = false,
  accionesFlotando = true,
}: Props) {
  // Va memo: sin este suscriptor se quedaría con el idioma del último render,
  // que ya no coincide con el de la app tras cambiarlo en Ajustes.
  useT();
  const isUser = message.role === "user";
  const acciones = accionesFlotando ? ACCIONES_FLOTANDO : ACCIONES_EN_FLUJO;
  // Las dos burbujas conviven: la sólida (morado hondo, máximo contraste) y la
  // tarjeta translúcida. Se elige en Ajustes → Apariencia.
  const solida = (useChatStore((s) => s.settings?.bubbleStyle) ?? "solida") === "solida";
  const setFeedback = useChatStore((s) => s.setFeedback);
  /** Motor de voz de nube elegido en Ajustes → API. Vacío = voces del sistema. */
  const motorDeVoz = useChatStore((s) => s.settings?.audioProvider ?? "");
  const [copied, setCopied] = useState(false);
  const [verPrompt, setVerPrompt] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [leyendo, setLeyendo] = useState(false);
  const leyendoRef = useRef(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // portapapeles no disponible: ignorar
    }
  };

  // Lectura en voz alta. Con motor de nube apuntado en Ajustes → API se pide el
  // audio y se reproduce; sin él, las voces del sistema, que no cuestan ni red.
  // El ref espeja el estado para que el cleanup al desmontar sepa si lo que
  // suena ahora es de esta burbuja y no de otra.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [saliendo, setSaliendo] = useState(false);
  const [avisoLectura, setAvisoLectura] = useState<string | null>(null);

  const pararLectura = () => {
    window.speechSynthesis.cancel();
    audioRef.current?.pause();
    audioRef.current = null;
    leyendoRef.current = false;
    setLeyendo(false);
  };

  const hablar = () => {
    if (leyendoRef.current || saliendo) {
      pararLectura();
      return;
    }
    setAvisoLectura(null);
    if (!motorDeVoz) {
      const voz = new SpeechSynthesisUtterance(message.content);
      voz.lang = currentLanguage() === "en" ? "en-US" : "es-ES";
      voz.onend = pararLectura;
      voz.onerror = pararLectura;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(voz);
      leyendoRef.current = true;
      setLeyendo(true);
      return;
    }
    // La primera vez cobra; el backend deja el MP3 en disco con el id del
    // mensaje, así que volver a escuchar la misma respuesta no gasta nada.
    void (async () => {
      setSaliendo(true);
      let uri: string;
      try {
        uri = await invoke<string>("speak_message", { messageId: message.id });
      } catch (e) {
        setSaliendo(false);
        setAvisoLectura(String(e));
        return;
      }
      setSaliendo(false);
      const audio = new Audio(uri);
      audio.onended = pararLectura;
      audio.onerror = () => {
        pararLectura();
        setAvisoLectura(t("El audio no se pudo reproducir."));
      };
      audioRef.current = audio;
      leyendoRef.current = true;
      setLeyendo(true);
      void audio.play().catch(() => {
        pararLectura();
        setAvisoLectura(t("El navegador bloqueó la reproducción del audio."));
      });
    })();
  };

  useEffect(
    () => () => {
      if (leyendoRef.current) {
        window.speechSynthesis.cancel();
        audioRef.current?.pause();
      }
    },
    [],
  );

  const startEdit = () => {
    setDraft(message.content);
    setEditing(true);
  };

  useEffect(() => {
    if (!editing) return;
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  const commitEdit = () => {
    const text = draft.trim();
    setEditing(false);
    if (text && text !== message.content) onEdit?.(message.id, text);
  };

  // Las imágenes se muestran como miniatura; los documentos siguen como chip.
  const imageAtts = message.attachments.flatMap((a) =>
    a.imageFile ? [{ file: a.imageFile, name: a.name }] : [],
  );
  const docAtts = message.attachments.filter((a) => !a.imageFile);

  const chips =
    message.attachments.length > 0 && (
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {imageAtts.map((a) => (
          <AttachmentImage key={a.file} file={a.file} name={a.name} onAccent={isUser && solida} />
        ))}
        {docAtts.map((a, i) => (
          <span
            key={i}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] border ${
              isUser && solida
                ? "border-white/25 bg-white/10 text-white"
                : "border-base-border bg-base-raised text-zinc-300"
            }`}
            title={t("{n} caracteres", { n: a.text.length.toLocaleString("es") })}
          >
            <Paperclip className="w-3 h-3 shrink-0" />
            <span className="max-w-[180px] truncate">{a.name}</span>
          </span>
        ))}
      </div>
    );

  if (isUser) {
    return (
      <div className="group relative flex animate-rise-in flex-col items-end">
        {editing ? (
          <div className="w-full max-w-2xl rounded-tarjeta border border-accent/40 bg-base-raised p-3">
            <textarea
              ref={editorRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  commitEdit();
                }
                if (e.key === "Escape") setEditing(false);
              }}
              rows={Math.min(8, Math.max(2, draft.split("\n").length))}
              className="w-full resize-none bg-transparent text-sm leading-relaxed outline-none text-zinc-100"
            />
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => setEditing(false)}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-100 hover:bg-layer/5 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
                {t("Cancelar")}
              </button>
              <button
                onClick={commitEdit}
                disabled={!draft.trim() || busy}
                className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 text-xs font-medium text-white hover:bg-accent-dim disabled:opacity-40 transition-colors"
              >
                <Check className="w-3.5 h-3.5" />
                {t("Enviar")}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div
              className={`max-w-[85%] px-4 py-2.5 ${
                solida
                  ? // Morado hondo sólido: el aro interior le quita el canto vivo
                    // al accent de marca sin perder contraste.
                    "rounded-entrada bg-accent-dim text-white ring-1 ring-inset ring-white/5"
                  : "rounded-xl border border-accent/40 bg-accent/20 text-layer"
              }`}
            >
              {chips}
              {message.content && (
                <div
                  className="whitespace-pre-wrap break-words leading-relaxed"
                  style={{ fontSize: "calc(var(--chat-fs, 15px) - 0.5px)" }}
                >
                  {message.content}
                </div>
              )}
            </div>
            {message.variantas && (
              <div className="mt-0.5 flex justify-end">
                <SelectorVariantes message={message} />
              </div>
            )}
            {/* La fila sale siempre: lleva la hora, que interesa aunque no se
                pueda editar (en el hilo de trabajo o con una respuesta en curso). */}
            <div className={`${acciones} right-0 opacity-0 group-hover:opacity-100`}>
              <Sello ms={message.createdAt} />
              {/* Reintentar en la pregunta, no solo en la respuesta: si el
                  proveedor falló, de la respuesta no queda nada que regenerar. */}
              {onRegenerate && (
                <ActionButton title={t("Reintentar")} onClick={onRegenerate}>
                  <RotateCw className="w-3.5 h-3.5" />
                </ActionButton>
              )}
              <ActionButton title={copied ? t("Copiado") : t("Copiar")} onClick={() => void copy()}>
                {copied ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </ActionButton>
              {onEdit && (
                <ActionButton title={t("Editar mensaje")} onClick={startEdit}>
                  <Pencil className="w-3.5 h-3.5" />
                </ActionButton>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="group flex animate-rise-in gap-2.5">
      {/* Sin cara: la pidió fuera del chat el 29-09. Lo que distingue quién habla
          no era el dibujo —es que lo suyo va en burbuja morada y lo de Hatboo
          texto suelto—, y así la respuesta coincide con el borde de la que se
          está escribiendo en vivo, que nunca llevó avatar. */}
      <div className="relative min-w-0 flex-1">
      {message.reasoning && (
        <ThinkingBlock
          reasoning={message.reasoning}
          ms={message.thinkingMs}
          streaming={false}
        />
      )}
      {chips}
      <RichText text={message.content} />
      {message.variantas && (
        <div className="pt-1">
          <SelectorVariantes message={message} />
        </div>
      )}
      {message.webSources && message.webSources.length > 0 && (
        <SourcesBlock sources={message.webSources} />
      )}
      {avisoLectura && (
        <p className="mt-1 text-[12px] leading-snug text-red-400/90">{avisoLectura}</p>
      )}
      <div
        className={`${acciones} left-0 -ml-1.5 ${
          message.feedback ? "" : "opacity-0 group-hover:opacity-100"
        }`}
      >
        <ActionButton
          title={copied ? t("Copiado") : t("Copiar respuesta")}
          onClick={() => void copy()}
        >
          {copied ? (
            <Check className="w-3.5 h-3.5" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
        </ActionButton>
        <ActionButton
          title={
            saliendo
              ? t("Poniéndole voz…")
              : leyendo
                ? t("Detener la lectura")
                : motorDeVoz
                  ? t("Leer en voz alta con la voz de nube")
                  : t("Leer en voz alta")
          }
          active={leyendo}
          onClick={hablar}
        >
          {leyendo ? (
            <Square className="w-3.5 h-3.5" />
          ) : (
            <Volume2 className={`w-3.5 h-3.5 ${saliendo ? "animate-pulse" : ""}`} />
          )}
        </ActionButton>
        <ActionButton
          title={t("Buena respuesta")}
          active={message.feedback === "up"}
          onClick={() => void setFeedback(message.id, "up")}
        >
          <ThumbsUp className="w-3.5 h-3.5" />
        </ActionButton>
        <ActionButton
          title={t("Mala respuesta")}
          active={message.feedback === "down"}
          onClick={() => void setFeedback(message.id, "down")}
        >
          <ThumbsDown className="w-3.5 h-3.5" />
        </ActionButton>
        {onRegenerate && (
          <ActionButton title={t("Regenerar respuesta")} onClick={onRegenerate}>
            <RotateCcw className="w-3.5 h-3.5" />
          </ActionButton>
        )}
        {/* Bifurcar y ver el prompt son de uso raro: viven en el «…» para que la
            fila que sí se usa a diario quepa en el hueco del mensaje. El botón
            sale siempre porque el prompt del sistema se puede ver en cualquier
            respuesta, haya o haya rama. */}
        <button
          ref={menuRef}
          onClick={() => setMenu((v) => !v)}
          title={t("Más acciones")}
          aria-label={t("Más acciones")}
          aria-expanded={menu}
          className={`rounded-md p-1 transition-colors hover:bg-layer/8 ${
            menu ? "text-zinc-100" : "text-zinc-500 hover:text-zinc-100"
          }`}
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
        </button>
        <Sello ms={message.createdAt} />
      </div>
      <Popover
        open={menu}
        anchorRef={menuRef}
        onClose={() => setMenu(false)}
        width={224}
        className="p-1"
      >
        {onBranch && (
          <button
            onClick={() => {
              setMenu(false);
              onBranch(message.id);
            }}
            className={FILA_MENU}
          >
            <GitBranch className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
            {t("Crear una rama desde aquí")}
          </button>
        )}
        <button
          onClick={() => {
            setMenu(false);
            setVerPrompt(true);
          }}
          className={FILA_MENU}
        >
          <ScrollText className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
          {t("Ver el prompt del sistema")}
        </button>
      </Popover>
      {verPrompt && (
        <PromptModal
          conversationId={message.conversationId}
          cerrar={() => setVerPrompt(false)}
        />
      )}
      </div>
    </div>
  );
}

// Las burbujas ya cerradas no tienen por qué re-renderizar con cada fragmento del stream.
export default memo(MessageBubble);
