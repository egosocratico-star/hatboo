import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import Mascot from "./mascot/Mascot";
import type { MascotState } from "../types";

/** Un hueco de una lista explicado, en vez de una frase suelta en gris que
 *  parece un error de render. Con `pose` lo cuenta la mascota, que es la
 *  identidad de la app; con `icon` se deja el icono cuando dice más.
 *  `accion` es el botón que resuelve el vacío desde donde se ve: sin él hay que
 *  ir a buscar el mando a otra pantalla. */
export default function EmptyHint({
  icon: Icono,
  pose,
  text,
  detail,
  accion,
}: {
  icon?: LucideIcon;
  pose?: MascotState;
  text: string;
  detail?: string;
  accion?: ReactNode;
}) {
  return (
    /* La caja discontinua es un hueco explicado, no una tarjeta: con el borde a
       plena opacidad y 26 px de mascota competía con el botón de arriba y se leía
       como dos controles del mismo peso. Borde al 55 %, radio de campo y la
       mascota un punto más chica. */
    <div className="flex items-start gap-2.5 rounded-campo border border-base-border/60 bg-base-raised px-2.5 py-2 text-xs text-zinc-500">
      {pose ? (
        <Mascot state={pose} size={22} />
      ) : (
        Icono && <Icono className="mt-px h-3.5 w-3.5 shrink-0 text-accent-soft/70" />
      )}
      <span className="min-w-0 pt-0.5">
        <span className="block">{text}</span>
        {detail && <span className="mt-0.5 block text-[11px] text-zinc-600">{detail}</span>}
        {accion && <span className="mt-1.5 block">{accion}</span>}
      </span>
    </div>
  );
}
