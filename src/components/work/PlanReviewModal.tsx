import { t } from "../../i18n";
import { useEffect, useState } from "react";
import { ListChecks, Plus, Trash2 } from "lucide-react";
import { useWorkStore, useActiveTab } from "../../store/workStore";

/**
 * El agente propuso un plan y espera aquí hasta que se confirme. Los pasos se
 * pueden reescribir, quitar o añadir; lo que salga de aquí es lo que se guarda
 * en SQLite y lo que el modelo lee, así que no existen dos versiones del plan.
 */
export default function PlanReviewModal() {
  const tab = useActiveTab();
  const review = tab?.planReview ?? null;
  const confirmPlan = useWorkStore((s) => s.confirmPlan);
  const cancelar = useWorkStore((s) => s.cancelTask);
  const [pasos, setPasos] = useState<string[]>([]);

  useEffect(() => {
    setPasos(review ? review.pasos : []);
  }, [review?.planId]);

  if (!review) return null;

  const validos = pasos.map((p) => p.trim()).filter(Boolean);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className="w-full max-w-xl rounded-xl border border-base-border hatboo-blur shadow-2xl">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-base-border">
          <ListChecks className="w-5 h-5 text-accent-soft" />
          <h2 className="text-sm font-semibold">
            {t("El agente propone este plan")}
          </h2>
          <span className="ml-auto text-[10px] uppercase tracking-wider text-zinc-500">
            {t("no ejecuta nada todavía")}
          </span>
        </div>

        <div className="px-5 py-4 space-y-2 max-h-[50vh] overflow-y-auto">
          {pasos.map((paso, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="shrink-0 mt-2 text-[11px] text-zinc-600 w-4 text-right">
                {i + 1}
              </span>
              <input
                value={paso}
                onChange={(e) =>
                  setPasos((prev) => prev.map((p, j) => (j === i ? e.target.value : p)))
                }
                className="flex-1 rounded-lg border border-base-border bg-base px-2.5 py-1.5 text-sm outline-none focus:border-accent/70"
              />
              <button
                onClick={() => setPasos((prev) => prev.filter((_, j) => j !== i))}
                title={t("Quitar este paso")}
                className="mt-1 p-1 rounded text-zinc-500 hover:text-red-400 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
          <button
            onClick={() => setPasos((prev) => [...prev, ""])}
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-zinc-400 hover:text-layer hover:bg-base-hover transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Añadir un paso
          </button>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-base-border">
          <button
            onClick={() => void cancelar()}
            className="px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-layer hover:bg-base-hover transition-colors"
          >
            {t("Cancelar la tarea")}
          </button>
          <button
            onClick={() => void confirmPlan(validos)}
            disabled={validos.length === 0}
            className="px-3.5 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent-dim disabled:opacity-40 transition-colors"
          >
            Ejecutar {validos.length > 0 ? `${validos.length} paso${validos.length > 1 ? "s" : ""}` : t("el plan")}
          </button>
        </div>
      </div>
    </div>
  );
}
