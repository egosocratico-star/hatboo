import { t } from "../i18n";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Check, Copy, PanelRightOpen } from "lucide-react";
import { resaltar } from "../highlight";
import { useChatStore } from "../store/chatStore";
import { merecePanel, tituloDeBloque } from "./ArtifactPanel";

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
          className="rounded-md border border-base-border bg-base-raised px-1.5 py-0.5 font-mono text-zinc-100"
          style={{ fontSize: "calc(var(--chat-fs, 15px) - 2.5px)" }}
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <Fragment key={`${keyPrefix}-${i}`}>{part}</Fragment>;
  });
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copiado, setCopiado] = useState(false);
  const abrirArtefacto = useChatStore((s) => s.abrirArtefacto);
  const hayConversacion = useChatStore((s) => !!s.activeId);
  const puedeAbrirse = hayConversacion && merecePanel(lang, code);
  const lineas = useMemo(() => resaltar(code, lang), [code, lang]);
  const abrir = async () => {
    const conversacion = useChatStore.getState().activeId;
    if (!conversacion) return;
    await abrirArtefacto(tituloDeBloque(code), lang || "texto", code);
  };
  const copia = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch {
      // portapapeles no disponible: el botón simplemente no hace nada
    }
  };
  return (
    // La cabecera va FUERA del <pre> que hace scroll: si no, en un bloque ancho
    // el botón se sale de la caja y desaparece con el desplazamiento.
    <div className="group my-2.5 rounded-lg border border-base-border bg-base-code">
      <div className="flex items-center gap-2 px-3 pt-2">
        <span className="text-[10px] uppercase tracking-wider text-accent-soft">
          {lang}
        </span>
        <button
          onClick={() => void copia()}
          title={copiado ? t("Copiado") : t("Copiar código")}
          className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-zinc-500 opacity-0 transition-opacity hover:text-zinc-200 focus:opacity-100 group-hover:opacity-100"
        >
          {copiado ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {t("Copiar")}
        </button>
        {/* El panel solo tiene sentido con una conversación guardada a la que
            asignar el artifacto, y con un bloque que merezca la pena: un `x = 1`
            no se abre, un documento de cuarenta líneas sí. */}
        {puedeAbrirse && (
          <button
            onClick={() => void abrir()}
            title={t("Abrir en el panel de la derecha")}
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-zinc-500 opacity-0 transition-opacity hover:text-accent-soft focus:opacity-100 group-hover:opacity-100"
          >
            <PanelRightOpen className="w-3 h-3" />
            {t("Abrir")}
          </button>
        )}
      </div>
      <pre
        className="px-3 pb-3 pt-1 overflow-x-auto leading-relaxed font-mono text-zinc-200"
        style={{ fontSize: "calc(var(--chat-fs, 15px) - 2px)" }}
      >
        {/* Una línea por div: el resaltador ya partió el código, y así la
            numeración de la izquierda cae en la misma altura que cada línea. */}
        <div className="flex">
          {lineas.length > 1 && (
            <div
              aria-hidden
              className="mr-3 shrink-0 select-none text-right tabular-nums text-zinc-600"
            >
              {lineas.map((_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
          )}
          <code className="min-w-0">
            {lineas.map((piezas, i) => (
              <div key={i} className="whitespace-pre">
                {piezas.map((p, j) =>
                  p.clase ? (
                    <span key={j} className={p.clase}>
                      {p.texto}
                    </span>
                  ) : (
                    <span key={j}>{p.texto}</span>
                  ),
                )}
                {piezas.length === 0 && " "}
              </div>
            ))}
          </code>
        </div>
      </pre>
    </div>
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
        lang={match[1] || t("código")}
        code={match[2].replace(/\n$/, "")}
      />,
    );
    last = idx + match[0].length;
  }
  if (last < trimmed.length) pushProse(trimmed.slice(last));

  return (
    <div className="leading-[1.65]" style={{ fontSize: "var(--chat-fs, 15px)" }}>
      {blocks}
    </div>
  );
}
