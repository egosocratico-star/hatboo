import { t } from "../i18n";
import { Check } from "lucide-react";
import Mascot from "./mascot/Mascot";

export interface Paso {
  id: string;
  /** En español: se traduce al pintar, como en el resto de la app. */
  etiqueta: string;
  listo: boolean;
}

/**
 * Pantalla de arranque y de cierre. No es un lazo girando un rato por gusto:
 * cada línea es una carga que la app hace de verdad contra SQLite, y se marca
 * cuando termina. Así lo que tarde en llegar se ve, en vez de una ventana vacía
 * a la que le van brotando cosas por detrás.
 */
export default function PantallaCarga({
  pasos,
  titulo,
  pie,
}: {
  pasos: Paso[];
  titulo: string;
  pie: string;
}) {
  const hechos = pasos.filter((p) => p.listo).length;
  return (
    <div className="h-full flex flex-col items-center justify-center gap-7 bg-base select-none animate-fade-in">
      <Mascot state="idle" size={92} />
      <div className="flex flex-col items-center gap-3">
        <h1 className="text-lg font-semibold tracking-tight text-zinc-200">{titulo}</h1>
        {/* El avance sale de los mismos pasos de abajo: no es un lazo que gira,
            es cuántas cargas de las listas terminaron. */}
        <div className="h-px w-44 bg-base-border">
          <div
            className="h-px bg-accent-soft transition-[width] duration-300 ease-out"
            style={{ width: `${Math.round((hechos / pasos.length) * 100)}%` }}
          />
        </div>
        <ul className="space-y-1">
          {pasos.map((p) => (
            <li
              key={p.id}
              className={`flex items-center gap-2 text-[11px] transition-colors duration-200 ${
                p.listo ? "text-zinc-300" : "text-zinc-600"
              }`}
            >
              {p.listo ? (
                <Check className="h-3 w-3 shrink-0 text-accent-soft" />
              ) : (
                <span className="h-3 w-3 shrink-0 animate-pulse rounded-full border border-current opacity-60" />
              )}
              {t(p.etiqueta)}
            </li>
          ))}
        </ul>
        <p className="pt-1 text-[11px] text-zinc-600">{pie}</p>
      </div>
    </div>
  );
}
