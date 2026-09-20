import { Fragment, useState } from "react";
import { Check, Copy, Paperclip, RotateCcw } from "lucide-react";
import type { Message } from "../types";

const CODE_FENCE = /```(\w*)\n?([\s\S]*?)```/g;

function renderContent(content: string) {
  const parts: Array<string | { lang: string; code: string }> = [];
  let last = 0;
  for (const match of content.matchAll(CODE_FENCE)) {
    const idx = match.index ?? 0;
    if (idx > last) parts.push(content.slice(last, idx));
    parts.push({ lang: match[1] || "code", code: match[2].replace(/\n$/, "") });
    last = idx + match[0].length;
  }
  if (last < content.length) parts.push(content.slice(last));

  return parts.map((part, i) =>
    typeof part === "string" ? (
      <Fragment key={i}>{part}</Fragment>
    ) : (
      <pre
        key={i}
        className="my-2 p-3 rounded-lg bg-black/50 border border-base-border overflow-x-auto text-[13px] leading-relaxed font-mono text-zinc-200"
      >
        <div className="text-[10px] uppercase tracking-wider text-accent-soft mb-1.5">
          {part.lang}
        </div>
        <code>{part.code}</code>
      </pre>
    ),
  );
}

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

  return (
    <div className={`group flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`relative max-w-[78%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words ${
          isUser
            ? "bg-accent text-white rounded-br-md"
            : "bg-base-raised border border-base-border text-zinc-100 rounded-bl-md"
        }`}
      >
        {!isUser && (
          <div className="absolute -top-3 right-1.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => void copy()}
              title={copied ? "Copiado" : "Copiar respuesta"}
              className={`p-1.5 rounded-md border text-xs shadow-lg transition-colors ${
                copied
                  ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-400"
                  : "border-base-border bg-base-raised text-zinc-400 hover:text-white hover:border-accent/50"
              }`}
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
            {onRegenerate && (
              <button
                onClick={onRegenerate}
                title="Regenerar respuesta"
                className="p-1.5 rounded-md border border-base-border bg-base-raised text-zinc-400 hover:text-white hover:border-accent/50 shadow-lg transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
        {message.attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {message.attachments.map((a, i) => (
              <span
                key={i}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] border ${
                  isUser
                    ? "border-white/25 bg-white/10 text-white"
                    : "border-base-border bg-black/30 text-zinc-300"
                }`}
                title={`${a.text.length.toLocaleString()} caracteres`}
              >
                <Paperclip className="w-3 h-3 shrink-0" />
                <span className="max-w-[180px] truncate">{a.name}</span>
              </span>
            ))}
          </div>
        )}
        {renderContent(message.content)}
        {!isUser && message.provider && (
          <div className="mt-1.5 text-[10px] text-zinc-500">{message.provider}</div>
        )}
      </div>
    </div>
  );
}
