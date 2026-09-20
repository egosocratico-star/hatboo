import { Fragment } from "react";
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

export default function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words ${
          isUser
            ? "bg-accent text-white rounded-br-md"
            : "bg-base-raised border border-base-border text-zinc-100 rounded-bl-md"
        }`}
      >
        {renderContent(message.content)}
        {!isUser && message.provider && (
          <div className="mt-1.5 text-[10px] text-zinc-500">{message.provider}</div>
        )}
      </div>
    </div>
  );
}
