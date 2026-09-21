import { Fragment, type ReactNode } from "react";

const CODE_FENCE = /```(\w*)\n?([\s\S]*?)```/g;
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`)/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={`${keyPrefix}-${i}`} className="font-semibold text-layer">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={`${keyPrefix}-${i}`}
          className="rounded px-1.5 py-0.5 bg-base-code border border-base-border font-mono text-[12.5px] text-accent-soft"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <Fragment key={`${keyPrefix}-${i}`}>{part}</Fragment>;
  });
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  return (
    <pre className="my-2.5 p-3 rounded-lg bg-base-code border border-base-border overflow-x-auto text-[13px] leading-relaxed font-mono text-zinc-200">
      <div className="text-[10px] uppercase tracking-wider text-accent-soft mb-1.5">
        {lang}
      </div>
      <code>{code}</code>
    </pre>
  );
}

/** Renderiza el texto del modelo sin depender de un parser de Markdown:
 *  bloques de código, listas con guiones y negritas/código en línea. */
export default function RichText({ text }: { text: string }) {
  const trimmed = text.trim();
  const blocks: ReactNode[] = [];
  let last = 0;
  let key = 0;

  const pushProse = (chunk: string) => {
    let list: string[] = [];
    const flushList = () => {
      if (list.length === 0) return;
      blocks.push(
        <ul key={`l${key++}`} className="list-disc pl-5 my-1.5 space-y-1">
          {list.map((item, i) => (
            <li key={i}>{renderInline(item, `li${key}-${i}`)}</li>
          ))}
        </ul>,
      );
      list = [];
    };

    for (const line of chunk.split("\n")) {
      const stripped = line.trim();
      const bullet = /^(?:[-*•])\s+(.*)$/.exec(stripped);
      if (bullet) {
        list.push(bullet[1]);
        continue;
      }
      flushList();
      if (!stripped) continue;
      const standaloneBold = /^\*\*([^*]+)\*\*$/.exec(stripped);
      blocks.push(
        standaloneBold ? (
          <p key={`p${key++}`} className="mt-3 mb-1 font-semibold text-layer">
            {standaloneBold[1]}
          </p>
        ) : (
          <p key={`p${key++}`} className="my-1.5">
            {renderInline(stripped, `p${key}`)}
          </p>
        ),
      );
    }
    flushList();
  };

  for (const match of trimmed.matchAll(CODE_FENCE)) {
    const idx = match.index ?? 0;
    if (idx > last) pushProse(trimmed.slice(last, idx));
    blocks.push(
      <CodeBlock
        key={`c${key++}`}
        lang={match[1] || "código"}
        code={match[2].replace(/\n$/, "")}
      />,
    );
    last = idx + match[0].length;
  }
  if (last < trimmed.length) pushProse(trimmed.slice(last));

  return <div className="text-[15px] leading-[1.65]">{blocks}</div>;
}
