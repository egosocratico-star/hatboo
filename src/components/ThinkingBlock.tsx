import { useState } from "react";
import { Brain, ChevronDown } from "lucide-react";

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds} s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`;
}

interface Props {
  reasoning: string;
  /** Milisegundos del pensamiento; si no viene, se muestra solo el encabezado. */
  ms?: number | null;
  streaming?: boolean;
}

// Registro colapsable del razonamiento interno del modelo.
export default function ThinkingBlock({ reasoning, ms, streaming = false }: Props) {
  const [open, setOpen] = useState(false);
  if (!reasoning.trim()) return null;
  const label = ms != null ? formatDuration(ms) : null;

  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 -ml-1 text-[12px] text-zinc-500 hover:text-zinc-300 transition-colors"
        title={open ? "Ocultar el razonamiento" : "Ver el razonamiento"}
      >
        <Brain className="w-3.5 h-3.5" />
        <span>{streaming ? "Pensando" : "Pensó"}{label ? ` ${label}` : ""}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="mt-1 ml-1.5 border-l-2 border-base-border pl-3 text-[12.5px] leading-relaxed text-zinc-500 whitespace-pre-wrap">
          {reasoning}
        </div>
      )}
    </div>
  );
}
