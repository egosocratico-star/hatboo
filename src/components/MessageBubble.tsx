import { memo, useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  Image as ImageIcon,
  Paperclip,
  Pencil,
  RotateCcw,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import RichText from "./RichText";
import ThinkingBlock from "./ThinkingBlock";
import SourcesBlock from "./SourcesBlock";
import { useChatStore } from "../store/chatStore";
import type { Message } from "../types";

interface Props {
  message: Message;
  onRegenerate?: () => void;
  /** Editar un mensaje propio: sin esta prop el lápiz no aparece. */
  onEdit?: (messageId: string, content: string) => void;
  /** Bloquea editar mientras hay una respuesta en curso. */
  busy?: boolean;
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
      className={`rounded-md p-1.5 transition-colors hover:bg-white/8 ${
        active ? "text-accent-soft" : "text-zinc-500 hover:text-zinc-100"
      }`}
    >
      {children}
    </button>
  );
}

function MessageBubble({
  message,
  onRegenerate,
  onEdit,
  busy = false,
}: Props) {
  const isUser = message.role === "user";
  const setFeedback = useChatStore((s) => s.setFeedback);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
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

  const chips =
    message.attachments.length > 0 && (
      <div className="flex flex-wrap gap-1.5 mb-2">
        {message.attachments.map((a, i) => {
          const isImage = Boolean(a.imageFile);
          return (
            <span
              key={i}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] border ${
                isUser
                  ? "border-white/25 bg-white/10 text-white"
                  : "border-base-border bg-base-raised text-zinc-300"
              }`}
              title={
                isImage
                  ? "Imagen adjunta"
                  : `${a.text.length.toLocaleString("es")} caracteres`
              }
            >
              {isImage ? (
                <ImageIcon className="w-3 h-3 shrink-0" />
              ) : (
                <Paperclip className="w-3 h-3 shrink-0" />
              )}
              <span className="max-w-[180px] truncate">{a.name}</span>
            </span>
          );
        })}
      </div>
    );

  if (isUser) {
    return (
      <div className="group flex animate-rise-in flex-col items-end">
        {editing ? (
          <div className="w-full max-w-2xl rounded-2xl border border-accent/40 bg-base-raised p-3">
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
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-100 hover:bg-white/5 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
                Cancelar
              </button>
              <button
                onClick={commitEdit}
                disabled={!draft.trim() || busy}
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-xs font-medium text-black hover:bg-zinc-200 disabled:opacity-40 transition-colors"
              >
                <Check className="w-3.5 h-3.5" />
                Enviar
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="max-w-[85%] rounded-3xl bg-accent px-4 py-2.5 text-white">
              {chips}
              <div className="whitespace-pre-wrap break-words text-[14.5px] leading-relaxed">
                {message.content}
              </div>
            </div>
            {onEdit && (
              <div className="mt-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <ActionButton title={copied ? "Copiado" : "Copiar"} onClick={() => void copy()}>
                  {copied ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </ActionButton>
                <ActionButton title="Editar mensaje" onClick={startEdit}>
                  <Pencil className="w-3.5 h-3.5" />
                </ActionButton>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="group animate-rise-in">
      {message.reasoning && (
        <ThinkingBlock
          reasoning={message.reasoning}
          ms={message.thinkingMs}
          streaming={false}
        />
      )}
      {chips}
      <RichText text={message.content} />
      {message.webSources && message.webSources.length > 0 && (
        <SourcesBlock sources={message.webSources} />
      )}
      <div
        className={`mt-1 -ml-1.5 flex items-center gap-0.5 transition-opacity ${
          message.feedback ? "" : "opacity-0 group-hover:opacity-100"
        }`}
      >
        <ActionButton
          title={copied ? "Copiado" : "Copiar respuesta"}
          onClick={() => void copy()}
        >
          {copied ? (
            <Check className="w-3.5 h-3.5" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
        </ActionButton>
        <ActionButton
          title="Buena respuesta"
          active={message.feedback === "up"}
          onClick={() => void setFeedback(message.id, "up")}
        >
          <ThumbsUp className="w-3.5 h-3.5" />
        </ActionButton>
        <ActionButton
          title="Mala respuesta"
          active={message.feedback === "down"}
          onClick={() => void setFeedback(message.id, "down")}
        >
          <ThumbsDown className="w-3.5 h-3.5" />
        </ActionButton>
        {onRegenerate && (
          <ActionButton title="Regenerar respuesta" onClick={onRegenerate}>
            <RotateCcw className="w-3.5 h-3.5" />
          </ActionButton>
        )}
      </div>
    </div>
  );
}

// Las burbujas ya cerradas no tienen por qué re-renderizar con cada fragmento del stream.
export default memo(MessageBubble);
