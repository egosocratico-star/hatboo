import { Monitor, Moon, Sun } from "lucide-react";
import { t } from "../i18n";
import { MODOS, PALETAS, type Tema, type ThemeId } from "../temas";

const ICONOS: Record<string, typeof Sun> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};

/** Muestra de una paleta: cuatro golpes de color, que es como se reconoce una
 *  tema mejor que leyéndole el nombre. Los valores vienen de `src/temas.ts`. */
function Muestra({ tema }: { tema: Tema }) {
  return (
    <span
      aria-hidden
      className="relative h-[18px] w-[26px] shrink-0 overflow-hidden rounded-[5px] border border-base-border"
      style={{ background: tema.fondo }}
    >
      <span
        className="absolute bottom-0 right-0 h-[9px] w-[11px] rounded-tl-[5px]"
        style={{ background: tema.panel }}
      />
      <span
        className="absolute left-[4px] top-[4px] h-[3px] w-[11px] rounded-full"
        style={{ background: tema.texto, opacity: 0.9 }}
      />
      <span
        className="absolute left-[4px] top-[10px] h-[3px] w-[7px] rounded-full"
        style={{ background: tema.texto, opacity: 0.45 }}
      />
      <span
        className="absolute right-[3px] top-[3px] h-[5px] w-[5px] rounded-full"
        style={{ background: tema.acento }}
      />
    </span>
  );
}

interface Props {
  value: ThemeId;
  onChange: (v: ThemeId) => void;
  /** Las paletas con muestra y nombre. En el menú rápido del avatar no caben y
   *  estorban: ahí se viene a cambiar de claro a oscuro, no a elegir paleta. */
  paletas?: boolean;
}

export default function ThemePicker({ value, onChange, paletas = true }: Props) {
  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        {MODOS.map((m) => {
          const Icon = ICONOS[m.id] ?? Moon;
          const activo = value === m.id;
          return (
            <button
              key={m.id}
              onClick={() => onChange(m.id)}
              title={t(m.nombre)}
              aria-label={t(m.nombre)}
              aria-pressed={activo}
              className={`grid place-items-center rounded-md px-2.5 py-1.5 transition-colors ${
                activo
                  ? "bg-accent/15 text-accent-soft"
                  : "text-zinc-400 hover:bg-base-hover hover:text-zinc-200"
              }`}
            >
              <Icon className="w-4 h-4" />
            </button>
          );
        })}
      </div>

      {/* Las paletas van debajo y en otro formato (muestra + nombre) para que no
          parezcan una cuarta opción del bloque de arriba: los tres de arriba son
          modos —uno de ellos decide el SO—, estas son paletas concretas. */}
      {paletas && (
        <div className="flex flex-wrap gap-1">
          {PALETAS.map((p) => {
            const activo = value === p.id;
            return (
              <button
                key={p.id}
                onClick={() => onChange(p.id)}
                title={t(p.nota)}
                aria-pressed={activo}
                className={`flex items-center gap-1.5 rounded-lg border px-1.5 py-1 text-[11px] transition-colors ${
                  activo
                    ? "border-accent/60 bg-accent/10 text-zinc-100"
                    : "border-base-border text-zinc-400 hover:border-accent/40 hover:bg-base-hover hover:text-zinc-200"
                }`}
              >
                <Muestra tema={p} />
                <span className="max-w-[86px] truncate">{p.nombre}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
