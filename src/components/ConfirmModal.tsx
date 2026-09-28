import { useEffect } from "react";
import { createPortal } from "react-dom";
import { t } from "../i18n";
import { BOTON_PELIGRO, BOTON_SECUNDARIO } from "./modalUi";

export interface AvisoBorrado {
  /** Pregunta corta: tiene que decir de qué se va, no solo «¿Seguro?». */
  title: string;
  /** Qué se pierde y qué no se toca. */
  body: string;
  confirmLabel?: string;
  onConfirm: () => void;
}

/**
 * Confirmación de un borrado. La papelera era destructiva a un toque y encima
 * no explicaba qué hacía: ahora hay que pulsar «Borrar» después de leer.
 */
export default function ConfirmModal({
  aviso,
  cerrar,
}: {
  aviso: AvisoBorrado | null;
  cerrar: () => void;
}) {
  useEffect(() => {
    if (!aviso) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        cerrar();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [aviso, cerrar]);

  if (!aviso) return null;

  // En `document.body`: la barra lateral tiene su propio scroll y difuminado, y
  // un `fixed` ahí dentro se coloca contra la barra, no contra la ventana.
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-6 animate-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) cerrar();
      }}
    >
      <div className="w-full max-w-sm rounded-2xl border border-base-border hatboo-blur p-5 shadow-2xl shadow-shade/50 animate-pop-in">
        <h2 className="text-sm font-semibold tracking-tight text-zinc-100">{aviso.title}</h2>
        {/* `pre-line` para que un aviso pueda listar archivos en varias líneas. */}
        <p className="mt-1.5 text-xs leading-relaxed text-zinc-400 whitespace-pre-line">
          {aviso.body}
        </p>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            autoFocus
            onClick={cerrar}
            className={BOTON_SECUNDARIO}
          >
            {t("Cancelar")}
          </button>
          <button
            onClick={() => {
              aviso.onConfirm();
              cerrar();
            }}
            className={BOTON_PELIGRO}
          >
            {aviso.confirmLabel ?? t("Borrar")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
