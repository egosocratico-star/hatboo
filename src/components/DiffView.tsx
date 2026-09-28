import { t } from "../i18n";
import { useMemo, useState } from "react";
import { cuentaDiff, parseaDiff, type Fila } from "../diff";

const CLASE_FILA: Record<Fila["kind"], string> = {
  // El tinte va en el fondo, no solo en el color del texto: con la línea marcada
  // de arriba abajo se ve el cambio sin leer palabra por palabra.
  add: "bg-emerald-500/[0.11] text-emerald-400",
  del: "bg-red-500/[0.11] text-red-400",
  ctx: "text-zinc-400",
  hunk: "bg-accent/[0.08] text-accent-soft",
  archivo: "text-zinc-500",
};

const NUMERO = "w-8 shrink-0 select-none pr-1.5 text-right text-zinc-600 tabular-nums";

function Linea({ fila }: { fila: Fila }) {
  if (fila.kind === "archivo" || fila.kind === "hunk") {
    return (
      <div className={`w-max min-w-full px-2 ${CLASE_FILA[fila.kind]}`}>{fila.texto || " "}</div>
    );
  }
  return (
    <div className={`flex w-max min-w-full px-2 ${CLASE_FILA[fila.kind]}`}>
      <span className={NUMERO}>{fila.viejo ?? ""}</span>
      <span className={NUMERO}>{fila.nuevo ?? ""}</span>
      <span className="w-3 shrink-0 select-none text-zinc-500">
        {fila.kind === "add" ? "+" : fila.kind === "del" ? "−" : " "}
      </span>
      <span className="whitespace-pre">{fila.texto || " "}</span>
    </div>
  );
}

/**
 * Un diff unificado, leído de un vistazo: números de línea de las dos versiones,
 * el hunk separado del anterior y verde/rojo suave sobre las líneas que cambian.
 * Lo comparten la aprobación del agente, la traza y el chip de cambios, que son
 * tres sitios donde se mira exactamente lo mismo.
 */
export default function DiffView({
  diff,
  altoMax = 260,
  corte = 120,
}: {
  diff: string;
  /** Altura del área con scroll, en px. */
  altoMax?: number;
  /** Líneas que se enseñan antes del botón de verlas todas. */
  corte?: number;
}) {
  const [todo, setTodo] = useState(false);
  const filas = useMemo(() => parseaDiff(diff), [diff]);
  const { mas, menos } = cuentaDiff(filas);
  const largo = filas.length > corte;
  const visibles = todo ? filas : filas.slice(0, corte);
  if (filas.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-md border border-base-border">
      <div className="flex items-center gap-2 border-b border-base-border bg-base-raised px-2 py-1 font-mono text-[10px] tabular-nums">
        <span className="text-emerald-400">+{mas}</span>
        <span className="text-red-400">−{menos}</span>
        {largo && !todo && (
          <span className="text-zinc-500">{t("{n} de {total} líneas", { n: corte, total: filas.length })}</span>
        )}
        {largo && (
          <button
            onClick={() => setTodo((v) => !v)}
            className="ml-auto rounded px-1 py-px text-zinc-500 transition-colors hover:bg-base-hover hover:text-zinc-200"
          >
            {todo ? t("Solo lo esencial") : t("Ver las {n} líneas", { n: filas.length })}
          </button>
        )}
      </div>
      <div
        className="overflow-auto bg-base-code py-1 font-mono text-[11px] leading-relaxed"
        style={{ maxHeight: altoMax }}
      >
        {visibles.map((f, i) => (
          <Linea key={i} fila={f} />
        ))}
      </div>
      {mas === 0 && menos === 0 && (
        <p className="border-t border-base-border bg-base-raised px-2 py-1 text-[10px] text-zinc-500">
          {t("No hay líneas añadidas ni quitadas en este diff.")}
        </p>
      )}
    </div>
  );
}

/** El archivo tal cual, con sus números: lo que hay detrás de «verlo entero». */
export function ArchivoCompleto({
  texto,
  altoMax = 320,
}: {
  texto: string;
  altoMax?: number;
}) {
  const lineas = texto.split("\n");
  return (
    <div className="overflow-hidden rounded-md border border-base-border">
      <div className="overflow-auto bg-base-code py-1 font-mono text-[11px] leading-relaxed text-zinc-300" style={{ maxHeight: altoMax }}>
        {lineas.map((l, i) => (
          <div key={i} className="flex w-max min-w-full px-2">
            <span className={NUMERO}>{i + 1}</span>
            <span className="w-3 shrink-0" />
            <span className="whitespace-pre">{l || " "}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
