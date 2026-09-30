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
/** Lo que tiene que caber debajo para preferir abrir hacia abajo. */
const MIN_ABAJO = 220;
/** La barra de título vive DENTRO del viewport, pegada arriba: respetar solo el
 *  borde de la ventana dejaba que un menú que abre hacia arriba se metiera debajo
 *  de ella y le comiera la primera opción. Es el alto de `TitleBar` (h-10). */
const BARRA_TITULO = 40;

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
  /** Menús con caras (el `+`). Apagado por defecto: los demás popovers —el
   *  selector de modelo, el de tema— siguen con su comportamiento de siempre.
   *  Encendido: al abrir se enfoca la primera fila, el Tab no se escapa del
   *  panel, las flechas suben y bajan, y al cerrar el foco vuelve al disparador. */
  atraparFoco?: boolean;
  /** Si viene, es el dueño quien decide qué hace Escape (volver una cara antes de
   *  cerrar). Sin él, Escape cierra. */
  onEscape?: () => void;
  /** Nombre del diálogo para los lectores de pantalla. */
  etiqueta?: string;
  /** Cambia al saltar de cara en un menú con caras. Sin esto, la fila enfocada se
   *  desmonta con la cara anterior y el foco cae a `body`: las flechas dejan de
   *  moverse por el menú hasta volver a pulsar. */
  reenfoca?: string | null;
  children: ReactNode;
}

/** Lo enfocable del panel, en orden de lectura. Cae lo deshabilitado y lo que no
 *  se pinta: una fila oculta no debe tragarse una pulsación de flecha. */
function filas(panel: HTMLElement | null): HTMLElement[] {
  if (!panel) return [];
  return Array.from(
    panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => el.offsetParent !== null);
}

/**
 * Panel flotante medido contra la ventana real. Con `position: absolute` y un
 * `max-height` a ojo los menús del composer seguían saliendo por encima del
 * borde superior en ventanas bajas: aquí se calcula el hueco libre por encima y
 * por debajo del disparador y el panel se ancla con `top` o con `bottom`, así
 * que nunca desborda el viewport y, si no cabe, se desplaza dentro de él.
 *
 * Hacia abajo siempre que quepa: un disparador por encima del centro de la
 * ventana (el compositor del chat vacío, los filtros del Centro) mandaba el
 * panel encima de lo que se estaba mirando, porque arriba siempre hay más sitio.
 */
export default function Popover({
  open,
  anchorRef,
  onClose,
  width,
  cap,
  align = "start",
  className = "",
  atraparFoco = false,
  onEscape,
  etiqueta,
  reenfoca,
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
      const above = rect.top - GAP - MARGIN - BARRA_TITULO;
      const below = window.innerHeight - rect.bottom - GAP - MARGIN;
      const haceFalta = cap === undefined ? MIN_ABAJO : Math.min(cap, MIN_ABAJO);
      const up = below < haceFalta && above >= below;
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
  // listener del clic para ser el último en decidir. Con `onEscape` el dueño del
  // menú decide: en el `+` lo primero es deshacer la cara, y cerrar solo si ya
  // estaba en la de arriba.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      (onEscape ?? onClose)();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, onEscape, open]);

  // Foco de un menú con caras. Entra en la primera fila al abrir, el Tab no se
  // escapa del panel (sin esto se iba a la barra lateral, que está debajo en el
  // DOM aunque no se vea), las flechas recorren las filas de una columna y al
  // cerrar el foco vuelve al `+`, que es donde estaba quien lo abrió.
  const estabaAbierto = useRef(false);
  useEffect(() => {
    if (!atraparFoco) return;
    if (open) {
      estabaAbierto.current = true;
      const temporizador = setTimeout(() => {
        filas(panelRef.current)[0]?.focus();
      }, 40);
      const onKey = (e: KeyboardEvent) => {
        const panel = panelRef.current;
        if (!panel) return;
        const dentro = panel.contains(document.activeElement);
        const lista = filas(panel);
        if (!lista.length) return;
        const i = dentro ? lista.indexOf(document.activeElement as HTMLElement) : -1;
        if (e.key === "Tab") {
          if (!dentro) return;
          e.preventDefault();
          const d = e.shiftKey ? -1 : 1;
          lista[(i + d + lista.length) % lista.length].focus();
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          // Se cambia de fila aunque el foco esté en un campo de texto: dentro del
          // panel no hay más forma de moverse que la lista.
          if (!dentro) return;
          e.preventDefault();
          const d = e.key === "ArrowDown" ? 1 : -1;
          const n = lista.length;
          const k = i < 0 ? (d > 0 ? 0 : n - 1) : (i + d + n) % n;
          lista[k].focus();
        }
      };
      document.addEventListener("keydown", onKey, true);
      return () => {
        clearTimeout(temporizador);
        document.removeEventListener("keydown", onKey, true);
      };
    }
    if (estabaAbierto.current) {
      estabaAbierto.current = false;
      anchorRef.current?.focus();
    }
  }, [atraparFoco, open, anchorRef, reenfoca]);

  if (!mounted || !style) return null;
  return createPortal(
    <div
      ref={panelRef}
      style={style}
      {...(atraparFoco
        ? // Sin `aria-modal`: el Tab queda atrapado, pero tapar lo de detrás a un
          // lector de pantalla sería peor de lo que arregla.
          { role: "dialog", "aria-label": etiqueta ?? "" }
        : {})}
      onAnimationEnd={(e) => {
        // Solo el cierre de la nuestra: los iconos girando también terminan.
        if (e.target !== panelRef.current || !leaving) return;
        setMounted(false);
        setLeaving(false);
        setStyle(null);
      }}
      className={`fixed z-50 ${
        leaving ? "animate-pop-out pointer-events-none" : "animate-pop-in"
      } overflow-y-auto overscroll-contain rounded-campo border border-base-border hatboo-blur shadow-flotante ${className}`}
    >
      {children}
    </div>,
    document.body,
  );
}
