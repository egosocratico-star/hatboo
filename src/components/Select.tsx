import { useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import Popover from "./Popover";

export interface OpcionSelect {
  valor: string;
  etiqueta: string;
  /** Segunda línea atenuada: para cuando el nombre solo no explica la opción. */
  detalle?: string;
}

interface Props {
  valor: string;
  opciones: OpcionSelect[];
  alCambiar: (valor: string) => void;
  /** Ancho mínimo del panel; si el disparador es más ancho, manda él. */
  ancho?: number;
  /** Tope de alto del panel en px. */
  cap?: number;
  align?: "start" | "end";
  /** `sm` es un control de fila (filtros); `md` ocupa el sitio de un campo. */
  size?: "sm" | "md";
  /** Clases extra del disparador; que no repitan tamaño, para eso está `size`. */
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
}

const FILA =
  "flex w-full items-start gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors";

const TAMANO = {
  sm: "px-2.5 py-1 text-xs",
  md: "w-full px-3 py-2 text-sm",
} as const;

/**
 * Desplegable de la app, no el del sistema: el `<select>` nativo pinta su lista
 * con el tema de Windows (gris claro, otra tipografía) en mitad de una interfaz
 * oscura, y ni se puede describir una opción ni se ve cuál está activa hasta
 * abrirla. El panel sale del mismo `Popover` que los menús del compositor, así
 * que se coloca, se anima y se cierra igual que ellos.
 *
 * El foco se queda en el disparador mientras la lista está abierta, como en un
 * `<select>` de toda la vida: las flechas mueven, Enter confirma y Esc cierra.
 */
export default function Select({
  valor,
  opciones,
  alCambiar,
  ancho = 200,
  cap = 280,
  align = "start",
  size = "sm",
  className = "",
  ariaLabel,
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [res, setRes] = useState(0);
  const [panelAncho, setPanelAncho] = useState(ancho);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const filasRef = useRef<Array<HTMLButtonElement | null>>([]);

  const activa = opciones.findIndex((o) => o.valor === valor);
  const etiqueta = opciones[activa]?.etiqueta ?? "";

  // El panel nunca es más estrecho que el hueco que sustituye: en un campo de
  // Ajustes a media columna, un desplegable de 200 px se queda ridículo.
  useLayoutEffect(() => {
    if (!open) return;
    const el = triggerRef.current;
    if (el) setPanelAncho(Math.max(ancho, el.offsetWidth));
  }, [open, ancho]);

  useLayoutEffect(() => {
    if (open) setRes(activa < 0 ? 0 : activa);
  }, [open, activa]);

  useLayoutEffect(() => {
    if (!open) return;
    filasRef.current[res]?.scrollIntoView({ block: "nearest" });
  }, [open, res]);

  const elegir = (i: number) => {
    const op = opciones[i];
    if (!op) return;
    setOpen(false);
    triggerRef.current?.focus();
    if (op.valor !== valor) alCambiar(op.valor);
  };

  const teclado = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setRes((i) => Math.min(i + 1, opciones.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setRes((i) => Math.max(i - 1, 0));
        break;
      case "Home":
        e.preventDefault();
        setRes(0);
        break;
      case "End":
        e.preventDefault();
        setRes(opciones.length - 1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        elegir(res);
        break;
      case "Tab":
        setOpen(false);
        break;
      case "Escape":
        // `Popover` también la escucha; aquí se evita que además active el botón.
        e.preventDefault();
        setOpen(false);
        break;
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={teclado}
        className={`flex items-center gap-1.5 rounded-lg border border-base-border bg-base text-left text-zinc-200 outline-none transition-[border-color,box-shadow] hover:border-accent/40 focus:border-accent focus:ring-2 focus:ring-accent/25 disabled:opacity-40 ${TAMANO[size]} ${
          open ? "border-accent/60" : ""
        } ${className}`}
      >
        <span className="min-w-0 flex-1 truncate">{etiqueta}</span>
        <ChevronDown
          className={`${
            size === "md" ? "h-4 w-4" : "h-3 w-3"
          } shrink-0 text-zinc-500 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      <Popover
        open={open}
        anchorRef={triggerRef}
        onClose={() => setOpen(false)}
        width={panelAncho}
        cap={cap}
        align={align}
        className="p-1.5"
      >
        <div role="listbox" aria-label={ariaLabel}>
          {opciones.map((op, i) => (
            <button
              key={op.valor}
              ref={(el) => {
                filasRef.current[i] = el;
              }}
              type="button"
              role="option"
              aria-selected={op.valor === valor}
              onMouseEnter={() => setRes(i)}
              onClick={() => elegir(i)}
              className={`${FILA} ${
                res === i
                  ? "bg-base-hover text-zinc-100"
                  : "text-zinc-400 hover:bg-base-hover/60"
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate">{op.etiqueta}</span>
                {op.detalle && (
                  <span className="mt-0.5 block text-[10px] leading-snug text-zinc-600">
                    {op.detalle}
                  </span>
                )}
              </span>
              {op.valor === valor && (
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-soft" />
              )}
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}
