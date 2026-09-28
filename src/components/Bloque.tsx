import type { ReactNode } from "react";

/**
 * Tarjeta de sección para Ajustes. Cada página se las apañaba con un `<section>`
 * suelto y un `<h2>` de `text-sm`, y unas iban en tarjeta y otras flotaban sobre
 * el fondo: la misma pantalla se leía a dos niveles de profundidad.
 *
 * `extra` es el hueco de la derecha del título, para lo que actúa sobre toda la
 * sección («Comprobar todos») y no sobre un campo.
 */
export default function Bloque({
  titulo,
  descripcion,
  extra,
  children,
  className = "",
}: {
  titulo: string;
  /** Qué se toca aquí, en una línea. No es un subtítulo decorativo. */
  descripcion?: string;
  extra?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-base-border bg-base-card p-4 ${className}`}>
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-zinc-200">{titulo}</h2>
          {descripcion && (
            <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">{descripcion}</p>
          )}
        </div>
        {extra && <div className="flex shrink-0 items-center gap-1.5">{extra}</div>}
      </header>
      {children}
    </section>
  );
}

/** Botón pequeño de cabecera de sección: mismo tamaño en las tres páginas. */
export function BotonSeccion({
  onClick,
  disabled = false,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="inline-flex items-center gap-1.5 rounded-lg border border-base-border px-2.5 py-1 text-xs text-zinc-400 transition-colors hover:border-accent/50 hover:text-zinc-100 disabled:opacity-50"
    >
      {children}
    </button>
  );
}
