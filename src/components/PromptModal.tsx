import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { Check, Copy, ScrollText, X } from "lucide-react";
import { t } from "../i18n";
import { BOTON_SECUNDARIO } from "./modalUi";

/**
 * El prompt con el que se manda cada respuesta. No es un texto de ayuda escrito
 * a mano: lo arma el backend con las mismas funciones que lo envían, así que lo
 * que se lee aquí es lo que lee el modelo — identidad, reglas del proyecto,
 * plantillas activas y nivel de aprobación incluidos.
 */
export default function PromptModal({
  conversationId,
  cerrar,
}: {
  conversationId: string;
  cerrar: () => void;
}) {
  const [texto, setTexto] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    let vivo = true;
    invoke<string>("system_prompt_of", { conversationId })
      .then((p) => vivo && setTexto(p))
      .catch((e) => vivo && setError(String(e)));
    return () => {
      vivo = false;
    };
  }, [conversationId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        cerrar();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [cerrar]);

  const copia = async () => {
    if (!texto) return;
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch {
      // portapapeles no disponible
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-6 animate-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) cerrar();
      }}
    >
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-clip rounded-2xl border border-base-border hatboo-blur shadow-2xl shadow-shade/50 animate-pop-in">
        <div className="flex items-center gap-2 border-b border-base-border px-4 py-3">
          <ScrollText className="h-4 w-4 shrink-0 text-accent-soft" />
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">
            {t("Prompt del sistema")}
          </h2>
          {texto && (
            <button
              onClick={() => void copia()}
              className={`${BOTON_SECUNDARIO} px-2.5 py-1 text-xs`}
              title={copiado ? t("Copiado") : t("Copiar el prompt")}
            >
              {copiado ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          )}
          <button
            onClick={cerrar}
            title={t("Cerrar (Esc)")}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-zinc-500 transition-colors hover:bg-base-hover hover:text-layer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          {error ? (
            <p className="text-xs text-red-400">{error}</p>
          ) : !texto ? (
            <p className="text-xs text-zinc-500">{t("Leyendo…")}</p>
          ) : (
            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-zinc-300">
              {texto}
            </pre>
          )}
        </div>
        <p className="shrink-0 border-t border-base-border px-4 py-2 text-[11px] text-zinc-600">
          {t("Se reconstruye ahora con tus ajustes actuales; una respuesta vieja pudo mandarse con otro.")}
        </p>
      </div>
    </div>,
    document.body,
  );
}
