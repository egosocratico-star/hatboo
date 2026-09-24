import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export interface MenuItem {
  label: string;
  icon: ReactNode;
  danger?: boolean;
  onSelect: () => void;
}

interface Props {
  /** Punto donde salió el clic derecho; se corrige si asoma por un borde. */
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

/** Menú contextual. Vive en `document.body` porque dentro del <aside>, que tiene
 *  su propio scroll, recortaría las opciones contra el borde. */
export default function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState({ x, y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setAnchor({
      x: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
    });
  }, [x, y]);

  useEffect(() => {
    const away = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    // En la fase de captura: el clic que abrió el menú ya pasó, y así el menú
    // se cierra también al pulsar encima de otro elemento sin tragarlo.
    document.addEventListener("mousedown", away, true);
    document.addEventListener("keydown", key, true);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("mousedown", away, true);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      style={{ left: anchor.x, top: anchor.y }}
      className="fixed z-50 min-w-44 rounded-lg border border-base-border hatboo-blur p-1 shadow-xl shadow-shade/40 animate-pop-in"
    >
      {items.map((it) => (
        <button
          key={it.label}
          onClick={() => {
            it.onSelect();
            onClose();
          }}
          className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
            it.danger
              ? "text-red-400 hover:bg-red-500/10"
              : "text-zinc-300 hover:bg-base-hover"
          }`}
        >
          <span className="shrink-0">{it.icon}</span>
          {it.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
