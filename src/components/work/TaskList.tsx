import type { ReactNode } from "react";
import { CircleDashed, Loader2, CircleCheck, CircleX, ListChecks } from "lucide-react";
import type { Task } from "../../types";

const ICONS: Record<Task["status"], ReactNode> = {
  pending: <CircleDashed className="w-4 h-4 text-zinc-600" />,
  in_progress: <Loader2 className="w-4 h-4 text-accent-soft animate-spin" />,
  done: <CircleCheck className="w-4 h-4 text-emerald-400" />,
  failed: <CircleX className="w-4 h-4 text-red-400" />,
};

export default function TaskList({ tasks }: { tasks: Task[] }) {
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-base-border text-xs font-medium text-zinc-400 uppercase tracking-wider">
        <ListChecks className="w-4 h-4 text-accent-soft" />
        Tareas
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
        {tasks.length === 0 && (
          <p className="text-[11px] text-zinc-600">
            El plan aparecerá aquí cuando el agente empiece.
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
              {t.description}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
