import { t } from "../../i18n";
import { useState, type ReactNode } from "react";
import {
  CircleDashed,
  CircleCheck,
  CircleX,
  Clock,
  Copy,
  ListChecks,
  Loader2,
  PanelRightClose,
  Wrench,
  CircleSlash2,
  X,
} from "lucide-react";
import type { Task } from "../../types";
import type { StepLine } from "../../store/workStore";
import Dots from "../Dots";

const ICONS: Record<Task["status"], ReactNode> = {
  pending: <CircleDashed className="w-4 h-4 text-zinc-600" />,
  in_progress: <Loader2 className="w-4 h-4 text-accent-soft animate-spin" />,
  done: <CircleCheck className="w-4 h-4 text-emerald-400" />,
  failed: <CircleX className="w-4 h-4 text-red-400" />,
};

/** Segundos legibles: el panel mide cuánto cuesta cada paso, y eso es lo que
 *  uno mira para saber si merece la pena dejarle seguir. */
function duracion(ms: number) {
  if (!ms || ms < 1000) return `${ms || 0} ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/** El modelo ya suele numerar sus propios pasos («1. Lista los archivos…»), así
 *  que el número que nosotros pintamos salía doble. Se quita el suyo y mandamos
 *  el nuestro, que es el único que coincide con `stepOrder`. */
function sinNumero(texto: string): string {
  return texto.replace(/^\s*\d+[.)]\s*/, "");
}

/** El plan como Markdown, para pegarlo donde se quiera. */
function planEnMarkdown(tasks: Task[]): string {
  return tasks
    .map((x) => `- [${x.status === "done" ? "x" : " "}] ${x.stepOrder}. ${sinNumero(x.description)}`)
    .join("\n");
}

/** Lo que se le pide al reintentar. Se nombran los pasos que fallaron y se le
 *  dice que mire la causa antes de repetir: reintentar a ciegas es justo lo que
 *  acababa en veinte vueltas iguales, que es lo que ahora corta el anti-bucle. */
function pedidoDeReintento(tasks: Task[]): string {
  const lista = tasks
    .filter((x) => x.status === "failed")
    .map((x) => `- paso ${x.stepOrder}: ${sinNumero(x.description)}`)
    .join("\n");
  return [
    t("Estos pasos del plan fallaron y no se volvieron a intentar:"),
    lista,
    t("Antes de repetir nada, mira por qué falló cada uno y dímelo. Después inténtalo de otra manera: si una llamada ya falló dos veces, no la vuelvas a hacer igual."),
  ].join("\n\n");
}

interface Props {
  tasks: Task[];
  /** Lo que el agente fue ejecutando. Muchos modelos locales no llaman a
   *  submit_plan: sin esto el panel se queda vacío aunque haya trabajado. */
  stepLines: StepLine[];
  running: boolean;
  /** Tareas escritas para después, en el orden en que se lanzarán. */
  cola: string[];
  /** `true` si la cadena se paró por un fallo o un cancelar. */
  colaEnPausa: boolean;
  onQuitarDeCola: (indice: number) => void;
  onReanudar: () => void;
  /** Vuelve a pedir los pasos fallidos. Sin él el botón no sale: el panel no
   *  sabe lanzar tareas por su cuenta. */
  onReintentar?: (pedido: string) => void;
  onCerrar?: () => void;
}

export default function TaskList({
  tasks,
  stepLines,
  running,
  cola,
  colaEnPausa,
  onQuitarDeCola,
  onReanudar,
  onReintentar,
  onCerrar,
}: Props) {
  const [soloPendientes, setSoloPendientes] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const hechos = tasks.filter((x) => x.status === "done").length;
  const enCurso = tasks.find((x) => x.status === "in_progress");
  const fallidos = tasks.filter((x) => x.status === "failed").length;
  /** Suma de las duraciones medidas, no el tiempo de pared: lo que no pasó por
   *  una herramienta (la respuesta del modelo) no está contado. */
  const totalMs = stepLines.reduce((a, l) => a + (l.durationMs || 0), 0);
  const visibles = soloPendientes
    ? tasks.filter((x) => x.status === "pending" || x.status === "in_progress")
    : tasks;

  const copiar = () => {
    void navigator.clipboard
      .writeText(planEnMarkdown(tasks))
      .then(() => {
        setCopiado(true);
        setTimeout(() => setCopiado(false), 2000);
      })
      .catch(() => {});
  };

  const boton =
    "shrink-0 rounded p-1 text-zinc-600 transition-colors hover:bg-base-hover hover:text-zinc-200 disabled:opacity-40 disabled:hover:bg-transparent";

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-1.5 border-b border-base-border pl-2.5 pr-1.5 py-2">
        <ListChecks className="w-3.5 h-3.5 shrink-0 text-accent-soft" />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          {t("Tareas")}
        </span>
        {tasks.length > 0 && (
          <span
            className="shrink-0 rounded-full bg-base-hover px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-zinc-400"
            title={t("{n} de {total} pasos hechos", { n: hechos, total: tasks.length })}
          >
            {hechos}/{tasks.length}
          </span>
        )}
        {totalMs >= 1000 && (
          <span
            className="shrink-0 text-[10px] tabular-nums text-zinc-600"
            title={t("Suma de lo que tardaron las acciones medidas. Lo que pensó el modelo no cuenta.")}
          >
            {duracion(totalMs)}
          </span>
        )}
        {tasks.length > 0 && (
          <button
            onClick={() => setSoloPendientes((v) => !v)}
            className={boton}
            title={
              soloPendientes ? t("Ver todos los pasos") : t("Ver solo lo que queda")
            }
            aria-pressed={soloPendientes}
          >
            {soloPendientes ? (
              <CircleDashed className="w-3.5 h-3.5 text-accent-soft" />
            ) : (
              <CircleSlash2 className="w-3.5 h-3.5" />
            )}
          </button>
        )}
        {tasks.length > 0 && (
          <button onClick={copiar} className={boton} title={t("Copiar el plan")}>
            {copiado ? (
              <CircleCheck className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
        )}
        {onCerrar && (
          <button onClick={onCerrar} className={boton} title={t("Ocultar las tareas")}>
            <PanelRightClose className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {/* Un hilo de progreso bajo la cabecera: el número de arriba dice cuántos
          faltan, la línea dice en un vistazo si la tarea va lejos o no. */}
      {tasks.length > 0 && (
        <div className="h-px shrink-0 bg-base-border">
          <div
            className="h-px bg-accent-soft transition-[width] duration-300 ease-out"
            style={{ width: `${Math.round((hechos / tasks.length) * 100)}%` }}
          />
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-2.5 py-2 space-y-1">
        {tasks.length === 0 && stepLines.length === 0 && (
          <div className="px-0.5 py-1">
            <p className="text-[11px] leading-relaxed text-zinc-500">
              {t("Aquí se ve lo que el agente se propone y por dónde va.")}
            </p>
            <ul className="mt-2.5 space-y-1.5 text-[11px] text-zinc-600">
              <li className="flex items-start gap-2">
                <CircleDashed className="mt-px h-3.5 w-3.5 shrink-0 text-zinc-600" />
                {t("Cada paso del plan, con su estado")}
              </li>
              <li className="flex items-start gap-2">
                <Wrench className="mt-px h-3.5 w-3.5 shrink-0 text-zinc-600" />
                {t("Si el modelo no hace plan, las acciones que hizo")}
              </li>
              <li className="flex items-start gap-2">
                <Clock className="mt-px h-3.5 w-3.5 shrink-0 text-zinc-600" />
                {t("Cuánto tardó cada una")}
              </li>
            </ul>
            <p className="mt-3 text-[11px] leading-relaxed text-zinc-600">
              {t("Pide una tarea abajo y esto se llena solo.")}
            </p>
          </div>
        )}

        {visibles.map((x) => (
          <div
            key={x.id}
            className={`flex items-start gap-2 rounded-md py-1 pr-1.5 pl-1.5 text-xs leading-relaxed transition-colors ${
              x.status === "in_progress"
                ? "bg-accent/10 border-l-2 border-accent text-zinc-100"
                : x.status === "failed"
                  ? "border-l-2 border-red-500/50 text-red-200/90"
                  : x.status === "done"
                    ? "border-l-2 border-transparent text-zinc-500 line-through decoration-zinc-700"
                    : "border-l-2 border-transparent text-zinc-300"
            }`}
          >
            <span className="mt-px shrink-0">{ICONS[x.status]}</span>
            <span className="min-w-0 flex-1">
              <span className="mr-1 tabular-nums text-zinc-500 no-underline">
                {x.stepOrder}.
              </span>
              {sinNumero(x.description)}
            </span>
          </div>
        ))}

        {soloPendientes && tasks.length > 0 && visibles.length === 0 && (
          <p className="flex items-center gap-2 px-1 py-2 text-[11px] text-zinc-600">
            <CircleCheck className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
            {t("No queda ningún paso por hacer.")}
          </p>
        )}

        {/* Resumen de la vuelta: dónde está el agente ahora mismo, sin subir. */}
        {tasks.length > 0 && enCurso && !soloPendientes && (
          <p className="px-1.5 pt-1 text-[11px] text-zinc-500">
            {t("En curso: {p}", { p: sinNumero(enCurso.description).slice(0, 60) })}
          </p>
        )}
        {fallidos > 0 && (
          <div className="flex items-start gap-2 px-1.5 pt-1">
            <p className="min-w-0 flex-1 text-[11px] text-red-400/90">
              {t("{n} pasos fallaron", { n: fallidos })}
            </p>
            {onReintentar && (
              <button
                onClick={() => onReintentar(pedidoDeReintento(tasks))}
                title={t("Vuelve a pedirle los pasos fallidos, con la orden de mirar la causa antes de repetir")}
                className="shrink-0 rounded-md border border-red-500/40 px-1.5 py-0.5 text-[11px] text-red-200 transition-colors hover:border-red-400/70 hover:bg-red-500/10"
              >
                {t("Reintentar")}
              </button>
            )}
          </div>
        )}

        {tasks.length === 0 && stepLines.length > 0 && (
          <>
            <p className="flex items-center justify-between gap-2 px-1 pb-0.5 text-[11px] text-zinc-600">
              <span>{t("Sin plan: acciones de esta tarea")}</span>
              <span className="shrink-0 tabular-nums">{stepLines.length}</span>
            </p>
            {stepLines.map((l, i) => (
              <div
                key={i}
                className={`flex items-start gap-2 rounded-md py-1 pr-1.5 pl-1.5 text-xs leading-relaxed ${
                  l.ok ? "" : "bg-red-500/5"
                }`}
              >
                <span className="mt-px shrink-0">
                  {l.ok ? (
                    <CircleCheck className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <CircleX className="w-4 h-4 text-red-400" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="inline-flex items-center gap-1 font-mono text-[11px] text-zinc-400">
                    <Wrench className="w-3 h-3 shrink-0" />
                    {l.toolName}
                  </span>
                  {l.brief && (
                    <span className="block break-words text-zinc-500">{l.brief}</span>
                  )}
                </span>
                {l.durationMs > 0 && (
                  <span
                    className="mt-px shrink-0 text-[10px] tabular-nums text-zinc-600"
                    title={t("Tardó {d}", { d: duracion(l.durationMs) })}
                  >
                    {duracion(l.durationMs)}
                  </span>
                )}
              </div>
            ))}
            {running && (
              <p className="flex items-center gap-2 px-1 pt-0.5 text-[11px] text-zinc-500">
                <Dots />
                {t("Trabajando…")}
              </p>
            )}
          </>
        )}

        {cola.length > 0 && (
          <div className="mt-2 border-t border-base-border pt-2">
            <p className="flex items-center justify-between gap-2 px-1 pb-1 text-[11px] text-zinc-600">
              <span>{t("En cola para después")}</span>
              <span className="shrink-0 tabular-nums">{cola.length}</span>
            </p>
            {cola.map((c, i) => (
              <div
                key={`${i}-${c.slice(0, 8)}`}
                className="group/cola flex items-start gap-1.5 rounded px-1 py-1 transition-colors hover:bg-base-hover"
              >
                <span className="mt-px shrink-0 text-[10px] tabular-nums text-zinc-600">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 break-words text-[11px] leading-snug text-zinc-400 line-clamp-3">
                  {c}
                </span>
                <button
                  onClick={() => onQuitarDeCola(i)}
                  className="shrink-0 rounded p-0.5 text-zinc-600 opacity-0 transition-opacity hover:text-zinc-200 group-hover/cola:opacity-100"
                  title={t("Quitar de la cola")}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            {colaEnPausa && (
              <div className="mt-1.5 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5">
                <span className="min-w-0 flex-1 text-[11px] leading-snug text-amber-200">
                  {t("La cola está en pausa: la tarea anterior no terminó bien.")}
                </span>
                <button
                  onClick={onReanudar}
                  className="shrink-0 rounded-md border border-amber-500/40 px-1.5 py-0.5 text-[11px] text-amber-100 transition-colors hover:border-amber-400/60"
                >
                  {t("Seguir con la cola")}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
