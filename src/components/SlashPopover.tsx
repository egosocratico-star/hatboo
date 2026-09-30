import { t } from "../i18n";
import { Sparkles } from "lucide-react";
import type { Skill } from "../types";

interface Props {
  lista: Skill[];
  indice: number;
  onPick: (skill: Skill) => void;
}

/** La lista que saca el `/` del compositor. Va anclada por encima del campo, así
 *  que el contenedor tiene que ser `relative`. */
export default function SlashPopover({ lista, indice, onPick }: Props) {
  return (
    <div
      role="listbox"
      aria-label={t("Plantillas")}
      className="absolute bottom-full left-2 z-30 mb-1.5 w-72 rounded-campo border border-base-border bg-base-raised p-1 shadow-flotante animate-pop-in"
    >
      {lista.map((s, i) => (
        <button
          key={s.id}
          type="button"
          role="option"
          aria-selected={i === indice}
          // `mousedown` con el defecto evitado: si no, el botón se lleva el foco y
          // el caret del campo se pierde antes de insertar.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(s)}
          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
            i === indice ? "bg-accent/15 text-zinc-100" : "text-zinc-300 hover:bg-base-hover"
          }`}
        >
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-accent-soft" />
          <span className="min-w-0 flex-1 truncate">{s.name}</span>
          {s.enabled && (
            <span className="shrink-0 text-[10px] text-accent-soft/80">{t("siempre")}</span>
          )}
        </button>
      ))}
      <p className="px-2 pt-1 text-[10px] text-zinc-600">
        {t("Subir y bajar: flechas · insertar: Enter o Tab · cerrar: Esc")}
      </p>
    </div>
  );
}
