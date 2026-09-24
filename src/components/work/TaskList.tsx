import { t } from "../../i18n";
import type { ReactNode } from "react";
import {
  CircleDashed,
  Loader2,
  CircleCheck,
  CircleX,
  ListChecks,
  Wrench,
} from "lucide-react";
import type { Task } from "../../types";
import type { StepLine } from "../../store/workStore";

const ICONS: Record<Task["status"], ReactNode> = {
  pending: <CircleDashed className="w-4 h-4 text-zinc-600" />,
  in_progress: <Loader2 className="w-4 h-4 text-accent-soft animate-spin" />,
  done: <CircleCheck className="w-4 h-4 text-emerald-400" />,
  failed: <CircleX className="w-4 h-4 text-red-400" />,
};

interface Props {
  tasks: Task[];
  /** Lo que el agente fue ejecutando. Muchos modelos locales no llaman a
   *  submit_plan: sin esto el panel se queda vacío aunque haya trabajado. */
  stepLines: StepLine[];
  running: boolean;
}

/** El modelo ya suele numerar sus propios pasos («1. Lista los archivos…»), así
 *  que el número que nosotros pintamos salía doble. Se quita el suyo y mandamos
 *  el nuestro, que es el único que coincide con `stepOrder`. */
function sinNumero(texto: string): string {
  return texto.replace(/^\s*\d+[.)]\s*/, "");
}

export default function TaskList({ tasks, stepLines, running }: Props) {
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-base-border text-xs font-medium text-zinc-400 uppercase tracking-wider">
        <ListChecks className="w-4 h-4 text-accent-soft" />
        {t("Tareas")}
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
        {tasks.length === 0 && stepLines.length === 0 && (
          <p className="text-[11px] text-zinc-600">
            {t("El plan aparecerá aquí cuando el agente empiece.")}
          </p>
        )}
        {tasks.map((t) => (
          <div
            key={t.id}
            className={`flex items-start gap-2 text-xs leading-relaxed ${
              t.status === "done" ? "text-zinc-500 line-through" : "text-zinc-300"
            }`}
          >
            <span className="shrink-0 mt-0.5">{ICONS[t.status]}</span>
            <span>
              <span className="text-zinc-500 mr-1">{t.stepOrder}.</span>
              {sinNumero(t.description)}
            </span>
          </div>
        ))}

        {tasks.length === 0 && stepLines.length > 0 && (
          <>
            <p className="text-[11px] text-zinc-600 pb-0.5">
              {t("Sin plan: acciones de esta tarea")}
            </p>
            {stepLines.map((l, i) => (
              <div key={i} className="flex items-start gap-2 text-xs leading-relaxed">
                <span className="shrink-0 mt-0.5">
                  {l.ok ? (
                    <CircleCheck className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <CircleX className="w-4 h-4 text-red-400" />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="inline-flex items-center gap-1 font-mono text-[11px] text-zinc-400">
                    <Wrench className="w-3 h-3 shrink-0" />
                    {l.toolName}
                  </span>
                  {l.brief && (
                    <span className="block break-words text-zinc-500">{l.brief}</span>
                  )}
                </span>
              </div>
            ))}
            {running && (
              <p className="text-[11px] text-zinc-600 pt-0.5">
                <span className="inline-block w-1.5 h-1.5 mr-1 rounded-full bg-accent-soft animate-pulse" />
                Trabajando…
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
