import { t } from "../i18n";
import type { LucideIcon } from "lucide-react";

export interface Sugerencia {
  texto: string;
  icono: LucideIcon;
}

/** El mismo bloque de cuatro accesos rápidos en el chat y en el modo trabajo:
 *  son el mismo tipo de cosa y antes se pintaban con dos tratamientos.
 *  El texto envuelve en vez de cortarse con puntos suspensivos: en el modo
 *  trabajo, con los paneles abiertos, las cuatro columnas no dan para «Busca en
 *  los archivos dónde se define X» y la sugerencia se leía a medias.
 *
 *  Rejilla de columnas iguales, no `flex-wrap` centrando: con flex cada chip
 *  medía lo que pedía su texto y, si eran impares, el último colgaba abajo con
 *  un ancho distinto, que es justo lo que hacía que la fila se viera torcida.
 *  Aquí todos miden lo mismo y el que sobra se alinea a la rejilla. */
export default function SuggestionGrid({
  items,
  onPick,
  disabled = false,
  compact = false,
}: {
  items: Sugerencia[];
  onPick: (texto: string) => void;
  disabled?: boolean;
  /** En el chat vacío: una fila de cuatro, para que quepan con el compositor. */
  compact?: boolean;
}) {
  return (
    <div
      className={
        compact
          ? "grid w-full grid-cols-2 gap-1.5 sm:grid-cols-4"
          : "grid w-full gap-2 sm:grid-cols-2"
      }
    >
      {items.map(({ texto, icono: Icono }) => (
        <button
          key={texto}
          onClick={() => onPick(texto)}
          disabled={disabled}
          title={t(texto)}
          className={`flex min-w-0 items-center gap-2 border border-base-border bg-base-card text-left leading-snug text-zinc-400 transition-colors hover:border-accent/45 hover:bg-base-hover hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 ${
            compact
              ? "rounded-campo px-2.5 py-2 text-[12px]"
              : "rounded-tarjeta px-3 py-2.5 text-[13px] gap-2.5"
          }`}
        >
          <Icono className="h-3.5 w-3.5 shrink-0 text-accent-soft" />
          <span className="min-w-0 truncate">{t(texto)}</span>
        </button>
      ))}
    </div>
  );
}
