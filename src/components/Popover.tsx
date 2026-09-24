import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

const MARGIN = 12;
const GAP = 8;

interface Props {
  /** Quiere el menú abierto. Al pasar a `false` el panel no se quita de golpe:
   *  termina de animar su salida y entonces se desmonta. */
  open: boolean;
  /** Elemento que abre el menú: su rectángulo decide la posición. */
  anchorRef: RefObject<HTMLElement>;
  onClose: () => void;
  /** Ancho del panel en px; se usa para no salirse del borde derecho. */
  width: number;
  /**
   * Tope de alto en px. Sin él el panel estira hasta llenar el hueco libre de la
   * ventana y menús cortos se ven desproporcionados; con él, si hace falta se
   * desplaza dentro del panel.
   */
  cap?: number;
  align?: "start" | "end";
  className?: string;
  children: ReactNode;
}

/**
 * Panel flotante medido contra la ventana real. Con `position: absolute` y un
 * `max-height` a ojo los menús del composer seguían saliendo por encima del
 * borde superior en ventanas bajas: aquí se calcula el hueco libre por encima y
 * por debajo del disparador y el panel se ancla con `top` o con `bottom`, así
 * que nunca desborda el viewport y, si no cabe, se desplaza dentro de él.
 */
export default function Popover({
  open,
  anchorRef,
  onClose,
  width,
  cap,
  align = "start",
  className = "",
  children,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties | null>(null);
  // El panel sigue montado mientras termina de salir; sin eso elegir una opción
  // lo hacía desaparecer de golpe.
  const [mounted, setMounted] = useState(open);
  const [leaving, setLeaving] = useState(false);

  useLayoutEffect(() => {
    if (open) {
      setMounted(true);
      setLeaving(false);
    } else if (mounted) {
      setLeaving(true);
    }
  }, [open, mounted]);

  useLayoutEffect(() => {
    if (!mounted || leaving) return;
    const place = () => {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const above = rect.top - GAP - MARGIN;
      const below = window.innerHeight - rect.bottom - GAP - MARGIN;
      const up = above >= below;
      const room = up ? above : below;
      const maxHeight = Math.max(140, cap ? Math.min(room, cap) : room);
      const wanted = align === "end" ? rect.right - width : rect.left;
      const left = Math.min(
        Math.max(MARGIN, wanted),
        Math.max(MARGIN, window.innerWidth - width - MARGIN),
      );
      const next: CSSProperties = up
        ? {
            left,
            bottom: window.innerHeight - rect.top + GAP,
            width,
            maxHeight,
            transformOrigin: align === "end" ? "bottom right" : "bottom left",
          }
        : {
            left,
            top: rect.bottom + GAP,
            width,
            maxHeight,
            transformOrigin: align === "end" ? "top right" : "top left",
          };
      // Sin esta comparación, cualquier scroll dentro del panel lo re-renderizaba
      // entero (y se notaba como un temblor al deslizar la lista de modelos).
      setStyle((current) =>
        current &&
        current.left === next.left &&
        current.top === next.top &&
        current.bottom === next.bottom &&
        current.maxHeight === next.maxHeight
          ? current
          : next,
      );
    };
    place();
    const onScroll = (e: Event) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      place();
    };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [anchorRef, align, width, cap, mounted, leaving]);

  // Red de seguridad: si `animationend` no llega a dispararse (ventana en segundo
  // plano, animaciones suspendidas) el panel quedaría invisible pero presente,
  // tapando los clics de lo que hay debajo.
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => {
      setMounted(false);
      setLeaving(false);
      setStyle(null);
    }, 220);
    return () => clearTimeout(timer);
  }, [leaving]);

  // El panel vive en document.body, así que el clic-fuera se controla aquí: ni
  // el disparador ni el propio panel deben cerrarlo.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [anchorRef, onClose, open]);

  // Esc cierra también, como en cualquier menú nativo. Se registra después del
  // listener del clic para ser el último en decidir.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, open]);

  if (!mounted || !style) return null;
  return createPortal(
    <div
      ref={panelRef}
      style={style}
      onAnimationEnd={(e) => {
        // Solo el cierre de la nuestra: los iconos girando también terminan.
        if (e.target !== panelRef.current || !leaving) return;
        setMounted(false);
        setLeaving(false);
        setStyle(null);
      }}
      className={`fixed z-50 ${
        leaving ? "animate-pop-out pointer-events-none" : "animate-pop-in"
      } overflow-y-auto overscroll-contain rounded-xl border border-base-border hatboo-blur shadow-2xl shadow-shade/50 ${className}`}
    >
      {children}
    </div>,
    document.body,
  );
}
