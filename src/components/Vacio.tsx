import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * El hueco de una pantalla que se abre a propósito (una pestaña, un popover), no
 * el de una lista lateral: ese va en una fila y lo explica `EmptyHint`. Aquí hay
 * sitio por delante, así que el aviso se centra y trae la acción que lo resuelve
 * — si el botón está en otra pantalla, el vacío se lee como un error.
 */
export default function Vacio({
  icon: Icono,
  titulo,
  detalle,
  accion,
}: {
  icon: LucideIcon;
  titulo: string;
  detalle?: string;
  accion?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-base-border px-5 py-8 text-center">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-base-border bg-base-raised">
        <Icono className="h-4 w-4 text-accent-soft" />
      </span>
      <p className="text-[13px] font-semibold leading-snug text-zinc-200">{titulo}</p>
      {detalle && (
        <p className="max-w-[46ch] text-[11px] leading-relaxed text-zinc-500">{detalle}</p>
      )}
      {accion && <span className="pt-1">{accion}</span>}
    </div>
  );
}
