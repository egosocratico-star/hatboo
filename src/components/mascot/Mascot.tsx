import { t } from "../../i18n";
import type { MascotState } from "../../types";
import idle from "./states/idle.png";
import coding from "./states/coding.png";
import confused from "./states/confused.png";
import happy from "./states/happy.png";
import surprised from "./states/surprised.png";

const SPRITES: Record<MascotState, string> = {
  idle,
  thinking: coding,
  confused,
  happy,
  surprised,
};

/** Etiquetas en español: se traducen al pintar, porque una constante de módulo
 *  se evalúa al importar, antes de conocer el idioma guardado. */
const LABELS: Record<MascotState, string> = {
  idle: "Hatboo",
  thinking: "Pensando…",
  confused: "Algo salió mal",
  happy: "¡Listo!",
  surprised: "¡Necesita tu aprobación!",
};

interface Props {
  state: MascotState;
  size?: number;
  showLabel?: boolean;
}

export default function Mascot({ state, size = 96, showLabel = false }: Props) {
  return (
    <div className="flex flex-col items-center gap-2 select-none">
      <img
        src={SPRITES[state]}
        alt={t(LABELS[state])}
        width={size}
        height={size}
        className={`object-contain transition-opacity duration-200 ${
          state === "thinking" ? "animate-pulse" : ""
        }`}
        draggable={false}
      />
      {showLabel && (
        <span className="text-xs text-zinc-500">{t(LABELS[state])}</span>
      )}
    </div>
  );
}
