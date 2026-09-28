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
      tabIndex={0}
      aria-label={t("Ancho del panel")}
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={(e) => {
        // Con el teclado no hace falta acertar con el ratón en una línea de dos
        // píxeles: flecha mueve de diez en diez, Enter vuelve al de fábrica.
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          const paso = (e.key === "ArrowRight") === (side === "left") ? 10 : -10;
          const siguiente = Math.round(Math.min(max, Math.max(min, width + paso)));
          onWidth(siguiente);
          onCommit(siguiente);
        } else if (e.key === "Enter") {
          e.preventDefault();
          onWidth(def);
          onCommit(def);
        }
      }}
      onDoubleClick={() => {
        onWidth(def);
        onCommit(def);
      }}
      title={t("Arrastra para cambiar el ancho · doble clic para dejar el de fábrica")}
      // Ocho píxeles de zona de agarre con una línea de dos dentro: el tirador de
      // cuatro transparentes estaba tan escondido que nadie lo encontraba.
      className="group relative w-2 shrink-0 cursor-col-resize select-none focus-visible:outline-none"
      style={{ touchAction: "none" }}
    >
      <span
        className="absolute inset-x-1/2 top-0 bottom-0 -translate-x-1/2 bg-transparent transition-colors group-hover:bg-accent/60 group-active:bg-accent group-focus-visible:bg-accent/60"
        style={{ width: 2 }}
      />
    </div>
  );
}
