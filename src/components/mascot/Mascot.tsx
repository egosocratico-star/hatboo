import { useEffect, useRef, useState } from "react";
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
  // Crossfade de verdad: el sprite anterior se queda debajo mientras el nuevo
  // entra en opacidad. Con un solo <img> cambiando de `src`, la transición de
  // opacidad no llega a verse — el navegador pinta el cambio de imagen de golpe.
  const [anterior, setAnterior] = useState<MascotState | null>(null);
  const ultimo = useRef(state);
  useEffect(() => {
    if (ultimo.current === state) return;
    setAnterior(ultimo.current);
    ultimo.current = state;
  }, [state]);

  return (
    <div className="flex flex-col items-center gap-2 select-none">
      <div
        className={`relative ${state === "thinking" ? "animate-pulse" : ""}`}
        style={{ width: size, height: size }}
        onAnimationEnd={() => setAnterior(null)}
      >
        {anterior && anterior !== state && (
          <img
            src={SPRITES[anterior]}
            alt=""
            width={size}
            height={size}
            className="absolute inset-0 object-contain"
            draggable={false}
          />
        )}
        <img
          key={state}
          src={SPRITES[state]}
          alt={t(LABELS[state])}
          width={size}
          height={size}
          className="relative w-full animate-fade-in object-contain"
          draggable={false}
        />
      </div>
      {showLabel && (
        <span className="text-xs text-zinc-500">{t(LABELS[state])}</span>
      )}
    </div>
  );
}
