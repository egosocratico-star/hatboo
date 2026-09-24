import { t } from "../../i18n";
import { useRef } from "react";

interface Props {
  /** Ancho actual del panel que este tirador separa del borde de la ventana. */
  width: number;
  min: number;
  max: number;
  /** Ancho de fábrica, para el doble clic. */
  def: number;
  /** `left` = el panel queda a la izquierda (Archivos); `right` = a la derecha (Tareas). */
  side: "left" | "right";
  onWidth: (px: number) => void;
  /** Se llama al soltar, una vez por arrastre: es cuando se guarda. */
  onCommit: (px: number) => void;
}

/** Tirador de ancho. Mientras se arrastra pone `hatboo-resizing` en <html>, que
 *  en index.css apaga las transiciones y el seleccionador de texto. */
export default function ResizeHandle({ width, min, max, def, side, onWidth, onCommit }: Props) {
  const drag = useRef<{ x: number; w: number; last: number } | null>(null);

  const begin = (e: React.PointerEvent) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, w: width, last: width };
    document.documentElement.classList.add("hatboo-resizing");
  };

  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const delta = e.clientX - d.x;
    const next = Math.round(
      Math.min(max, Math.max(min, side === "left" ? d.w + delta : d.w - delta)),
    );
    if (next === d.last) return;
    d.last = next;
    onWidth(next);
  };

  const end = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    document.documentElement.classList.remove("hatboo-resizing");
    onCommit(d.last);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => {
        onWidth(def);
        onCommit(def);
      }}
      title={t("Arrastra para cambiar el ancho · doble clic para dejar el de fábrica")}
      className="w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-accent/30 active:bg-accent/50 transition-colors"
    />
  );
}
