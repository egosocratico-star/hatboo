import { type Dispatch, type SetStateAction, useLayoutEffect, useRef } from "react";
import { ArrowUp, Paperclip, Square, X } from "lucide-react";
import { t } from "../i18n";
import { useChatStore } from "../store/chatStore";
import { useSlashSkills } from "../hooks/useSlashSkills";
import AttachmentImage from "./AttachmentThumb";
import ChatPlusMenu from "./ChatPlusMenu";
import ModeToggles from "./ModeToggles";
import ProviderModelPicker from "./ProviderModelPicker";
import SlashPopover from "./SlashPopover";
import type { Attachment } from "../types";

/** El compositor crece con lo escrito hasta aquí; lo que pase del tope se lee con
 *  su propio scroll dentro de la caja. En píxeles y no en líneas a propósito: una
 *  sola línea larga sin espacios ocupa media pantalla y `split("\n")` no se entera. */
const TOPE_PX = 320;

type Props = {
  /** Qué hilo se está escribiendo: el borrador vive en el store por conversación. */
  clave: string;
  busy: boolean;
  /** Los adjuntos viven arriba: este componente se desmonta al pasar del chat
   *  vacío al hilo, y un archivo soltado no puede perderse por ese cambio. */
  attachments: Attachment[];
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  /** Lo que falló al soltar algo sobre la ventana; lo detecta quien escucha los
   *  solteos, que está arriba, pero se dice aquí. */
  aviso: string | null;
  onSubmit: (texto: string, adjuntos: Attachment[]) => void;
};

// La sombra es `flotante`, no `apoyada`: el hilo pasa por debajo de la caja,
// así que es una capa y no una superficie pegada al panel. Radio de caja de
// entrada (el que manda en el chat) y anillo al enfocar, no solo el borde
// cambiante: con el borde era imposible ver dónde estaba escribiendo a 1080p.
export default function Compositor({
  clave,
  busy,
  attachments,
  setAttachments,
  aviso,
  onSubmit,
}: Props) {
  const input = useChatStore((s) => s.drafts[clave] ?? "");
  const setDraft = useChatStore((s) => s.setDraft);
  const skills = useChatStore((s) => s.skills);
  const stopStreaming = useChatStore((s) => s.stopStreaming);
  const setInput = (value: string) => setDraft(clave, value);
  const cajaRef = useRef<HTMLTextAreaElement>(null);
  /** `/` en el compositor abre la lista de plantillas (la regla, en `src/slash.ts`). */
  const slash = useSlashSkills({ skills, caja: cajaRef, poner: setInput });

  // Se mide el contenido de verdad, no los saltos escritos: con una línea
  // larguísima sin espacios `split("\n")` daba 1 y la caja se quedaba recortada.
  useLayoutEffect(() => {
    const el = cajaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, TOPE_PX)}px`;
  }, [input]);

  /** Inserta una plantilla en el cursor del textarea, no al final. */
  const insertTemplate = (text: string) => {
    const el = cajaRef.current;
    const from = el?.selectionStart ?? input.length;
    const to = el?.selectionEnd ?? input.length;
    const before = input.slice(0, from);
    // Se separa de lo que haya escrito solo si hace falta.
    const glue = before && !/\s$/.test(before) ? " " : "";
    const next = before + glue + text + input.slice(to);
    setInput(next);
    const caret = before.length + glue.length + text.length;
    requestAnimationFrame(() => {
      const node = cajaRef.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(caret, caret);
    });
  };

  const enviar = () => {
    const texto = input.trim();
    if ((!texto && attachments.length === 0) || busy) return;
    const enviados = attachments;
    setInput("");
    setAttachments([]);
    onSubmit(texto, enviados);
  };

  return (
    <div className="relative rounded-entrada border border-base-border bg-base-card shadow-flotante px-3.5 pt-3 pb-2.5 ring-accent/25 transition-[border-color,box-shadow] focus-within:border-accent/60 focus-within:ring-2">
      {slash.abierto && (
        <SlashPopover lista={slash.lista} indice={slash.indice} onPick={slash.elegir} />
      )}
      {aviso && <p className="pb-2 pl-1 text-[11px] leading-snug text-red-400/90">{aviso}</p>}
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
                onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
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
        ref={cajaRef}
        value={input}
        onChange={(e) => {
          setInput(e.target.value);
          slash.onTexto(e.target.value, e.currentTarget.selectionStart);
        }}
        onKeyDown={(e) => {
          // Con la lista abierta, el Enter inserta la plantilla en vez de enviar.
          if (slash.onKeyDown(e)) return;
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            enviar();
          }
        }}
        rows={1}
        placeholder={t("Pregúntame lo que necesites…")}
        className="w-full resize-none bg-transparent px-1 pb-2 text-sm leading-relaxed outline-none placeholder:text-zinc-600 overflow-y-auto"
      />

      <div className="flex items-center gap-2">
        <ChatPlusMenu
          onPickFiles={(files) => setAttachments((prev) => [...prev, ...files])}
          onInsertTemplate={insertTemplate}
          disabled={busy}
        />
        <ModeToggles />
        <div className="flex-1 min-w-0" />
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
            onClick={enviar}
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
}
