import { useEffect, useRef, useState } from "react";
import { t } from "../../i18n";
import type { MascotState } from "../../types";
import idle from "./states/idle.png";
import coding from "./states/coding.png";
import run from "./states/run.png";
import sleeping from "./states/sleeping.png";
import walk from "./states/walk.png";
import confused from "./states/confused.png";
import happy from "./states/happy.png";
import surprised from "./states/surprised.png";

const SPRITES: Record<MascotState, string> = {
  idle,
  thinking: coding,
  working: coding,
  running: run,
  sleeping,
  walking: walk,
  confused,
  happy,
  surprised,
};

/** Etiquetas en español: se traducen al pintar, porque una constante de módulo
 *  se evalúa al importar, antes de conocer el idioma guardado. */
const LABELS: Record<MascotState, string> = {
  idle: "Hatboo",
  thinking: "Pensando…",
  working: "Trabajando en el proyecto",
  running: "Ejecutando",
  sleeping: "Sin nada por aquí",
  walking: "Buscando carpetas",
  confused: "Algo salió mal",
  happy: "¡Listo!",
  surprised: "¡Necesita tu aprobación!",
};

/** Cada pose se mueve como lo que está haciendo. Con un solo `animation` para
 *  todas, el fantasma flotaba igual mientras teclea que mientras duerme. */
const ANIMACION: Record<MascotState, string> = {
  idle: "anima-flota",
  thinking: "anima-cabeceo",
  working: "anima-cabeceo",
  running: "anima-vaiven",
  sleeping: "anima-duerme",
  walking: "anima-paso",
  confused: "anima-temblor",
  happy: "anima-rebote",
  surprised: "anima-saltito",
};

/** El aura solo respira en las poses en las que pasa algo: en reposo y dormida
 *  una luz moviéndose sería un anuncio parpadeando. */
const AURA_VIVA: MascotState[] = ["thinking", "working", "running", "happy", "surprised"];

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

  // El aura y la deriva solo en los tamaños grandes: son lo que hace que la
  // mascota parezca viva y no un icono pegado con celo. En los pequeños (el chip
  // del compositor, el avatar) serían parpadeo constante.
  const heroica = size >= 64;

  return (
    <div className="flex flex-col items-center gap-2 select-none">
      <div className="relative" style={{ width: size, height: size }}>
        {heroica && (
          <span
            aria-hidden
            className={`pointer-events-none absolute -inset-3 rounded-full ${
              AURA_VIVA.includes(state) ? "anima-latido" : ""
            }`}
            style={{
              background:
                "radial-gradient(circle, rgb(var(--accent) / 0.18) 0%, transparent 70%)",
            }}
          />
        )}
        {/* La mancha de abajo es la que vende la altura: se estrecha y se apaga
            cuando el fantasma sube, así que el desplazamiento de arriba deja de
            ser un PNG moviéndose y pasa a ser un cuerpo que se eleva. */}
        {heroica && (
          <span
            aria-hidden
            className="anima-sombra pointer-events-none absolute -bottom-1 left-1/2 h-[7px] rounded-full blur-[3px]"
            style={{
              width: size * 0.46,
              background: "rgb(var(--accent) / 0.45)",
            }}
          />
        )}
        <div
          className={`absolute inset-0 ${heroica ? ANIMACION[state] : ""}`}
          onAnimationEnd={() => setAnterior(null)}
        >
          {anterior && anterior !== state && (
            <img
              src={SPRITES[anterior]}
              alt=""
              width={size}
              height={size}
              className="absolute inset-0 h-full w-full object-contain"
              draggable={false}
            />
          )}
          <img
            key={state}
            src={SPRITES[state]}
            alt={t(LABELS[state])}
            width={size}
            height={size}
            className="relative h-full w-full animate-fade-in object-contain"
            draggable={false}
          />
        </div>
      </div>
      {showLabel && (
        <span className="text-xs text-zinc-500">{t(LABELS[state])}</span>
      )}
    </div>
  );
}
