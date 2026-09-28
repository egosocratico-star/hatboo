import type { ReactNode } from "react";

/**
 * Los cuatro estados que sabe decir la app. Antes cada pantalla escribía su
 * propio `bg-emerald-500/15 text-emerald-300` y salían cinco verdes distintos
 * por la casa (medido: 14 chips a mano en cuatro ficheros, más los sellos del
 * Centro y el estado de proveedores).
 */
export type Aire = "ok" | "aviso" | "error" | "info";

const RECETA: Record<Aire, string> = {
  ok: "bg-emerald-500/15 text-emerald-400",
  aviso: "bg-amber-500/15 text-amber-300",
  error: "bg-red-500/15 text-red-400",
  info: "border border-base-border bg-base text-zinc-300",
};

interface Props {
  tipo?: Aire;
  /** Punto de color delante: para estados que se ven de reojo (en memoria). */
  punto?: boolean;
  /** Etiqueta de catálogo (Texto, Código, Cloud), no estado del sistema. */
  cuadrada?: boolean;
  /** Para lo que es un dato, no una palabra: `exit 0`, `404`, rutas. */
  mono?: boolean;
  title?: string;
  className?: string;
  children: ReactNode;
}

export default function Insignia({
  tipo = "info",
  punto = false,
  cuadrada = false,
  mono = false,
  title,
  className = "",
  children,
}: Props) {
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap ${
        cuadrada
          ? `rounded px-1.5 py-px ${mono ? "font-mono text-[10px]" : "text-[11px]"}`
          : "rounded-full px-2 py-0.5 text-[10px]"
      } ${RECETA[tipo]} ${className}`}
    >
      {punto && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />}
      {children}
    </span>
  );
}
