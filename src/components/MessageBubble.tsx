import { useState } from "react";
import { Check, Copy, Image as ImageIcon, Paperclip, RotateCcw } from "lucide-react";
import RichText from "./RichText";
import ThinkingBlock from "./ThinkingBlock";
import SourcesBlock from "./SourcesBlock";
import type { Message } from "../types";

interface Props {
  message: Message;
  onRegenerate?: () => void;
}

export default function MessageBubble({ message, onRegenerate }: Props) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // portapapeles no disponible: ignorar
    }
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
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent text-white px-4 py-2.5">
          {chips}
          <div className="whitespace-pre-wrap break-words text-[14.5px] leading-relaxed">
            {message.content}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group">
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
      <div className="mt-1 flex items-center gap-1">
        <button
          onClick={() => void copy()}
          title={copied ? "Copiado" : "Copiar respuesta"}
          className={`p-1.5 rounded-md transition-colors ${
            copied
              ? "text-emerald-400"
              : "text-zinc-500 opacity-0 group-hover:opacity-100 hover:text-zinc-100"
          }`}
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
        {onRegenerate && (
          <button
            onClick={onRegenerate}
            title="Regenerar respuesta"
            className="p-1.5 rounded-md text-zinc-500 opacity-0 group-hover:opacity-100 hover:text-zinc-100 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        )}
        {message.provider && (
          <span className="ml-1 text-[11px] text-zinc-600">{message.provider}</span>
        )}
      </div>
    </div>
  );
}
