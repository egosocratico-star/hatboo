import { useState } from "react";
import { ChevronDown, Globe } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { WebSource } from "../types";

function hostname(url: string): string {
  const match = /^[a-z]+:\/\/([^/?#]+)/i.exec(url);
  return match ? match[1].replace(/^www\./, "") : url;
}

// Lista colapsable con las páginas que la búsqueda web le pasó al modelo.
export default function SourcesBlock({ sources }: { sources: WebSource[] }) {
  const [open, setOpen] = useState(false);
  if (sources.length === 0) return null;

  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 -ml-1 text-[12px] text-zinc-500 hover:text-zinc-300 transition-colors"
        title={open ? "Ocultar las fuentes" : "Ver las fuentes de la web"}
      >
        <Globe className="w-3.5 h-3.5" />
        <span>
          {sources.length} {sources.length === 1 ? "fuente" : "fuentes"} de la web
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <ul className="mt-1 ml-1.5 pl-3 border-l-2 border-base-border space-y-1.5">
          {sources.map((source, i) => (
            <li key={`${source.url}-${i}`}>
              <button
                onClick={() => void openUrl(source.url).catch(() => {})}
                className="text-left hover:underline decoration-zinc-600 underline-offset-2"
                title={source.url}
              >
                <span className="text-[12.5px] text-zinc-400">{source.title}</span>
                <span className="block text-[11px] text-zinc-600">
                  {hostname(source.url)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
