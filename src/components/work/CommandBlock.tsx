import { useState } from "react";
import { Check, ChevronDown, ChevronRight, Copy } from "lucide-react";
import type { CommandData } from "../../store/workStore";

function duracion(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

interface Props {
  data: CommandData;
  /** false cuando el paso falló o el usuario la rechazó. */
  ok: boolean;
  durationMs: number;
}

/** Bloque de comando al estilo de una terminal: qué se ejecutó, cuánto tardó,
 *  cómo terminó y su salida, todo seleccionable y copiable de un clic. */
export default function CommandBlock({ data, ok, durationMs }: Props) {
  const [abierto, setAbierto] = useState(true);
  const [copiado, setCopiado] = useState(false);
  const codigo = data.exitCode;
  const exito = ok && codigo === 0;
  const salida = [data.stdout, data.stderr].filter((t) => t.trim() !== "").join("");

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(
        `$ ${data.command}\n${salida}`.trimEnd() + "\n",
      );
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch {
      // Sin portapapeles disponible: el texto sigue seleccionable a mano.
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-base-border bg-base-code">
      <div className="flex items-start gap-2 px-3 py-2">
        <span className="mt-0.5 shrink-0 font-mono text-xs text-accent-soft">$</span>
        <code className="min-w-0 flex-1 break-all font-mono text-xs leading-relaxed text-zinc-100">
          {data.command}
        </code>
        <span
          className={`shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] ${
            codigo === null
              ? "bg-red-500/15 text-red-300"
              : exito
                ? "bg-emerald-500/15 text-emerald-400"
                : "bg-red-500/15 text-red-300"
          }`}
          title={
            codigo === null
              ? "El comando no devolvió código de salida (cancelado o sin permisos)"
              : `El proceso terminó con código ${codigo}`
          }
        >
          {codigo === null ? "sin código" : `exit ${codigo}`}
        </span>
        {durationMs > 0 && (
          <span className="shrink-0 text-[10px] text-zinc-500 tabular-nums">
            {duracion(durationMs)}
          </span>
        )}
        <button
          onClick={copiar}
          className="shrink-0 rounded-md p-1 text-zinc-500 hover:bg-base-hover hover:text-zinc-200 transition-colors"
          title="Copiar el comando y su salida"
        >
          {copiado ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
        {salida !== "" && (
          <button
            onClick={() => setAbierto((v) => !v)}
            className="shrink-0 rounded-md p-1 text-zinc-500 hover:bg-base-hover hover:text-zinc-200 transition-colors"
            title={abierto ? "Ocultar la salida" : "Mostrar la salida"}
          >
            {abierto ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
          </button>
        )}
      </div>

      {abierto && salida !== "" && (
        <pre className="max-h-64 overflow-auto border-t border-base-border px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-zinc-300">
          {data.stdout}
          {data.stderr !== "" && (
            <span className="text-red-400/90">{data.stderr}</span>
          )}
        </pre>
      )}
      {abierto && salida === "" && (
        <p className="border-t border-base-border px-3 py-2 text-[11px] text-zinc-600">
          Sin salida.
        </p>
      )}
    </div>
  );
}
