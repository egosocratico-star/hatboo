import { t } from "../../i18n";
import { useRef, useState } from "react";
import { ChevronDown, MessageSquare, Plus, X } from "lucide-react";
import Popover from "../Popover";
import { useWorkStore, type AgentStatus } from "../../store/workStore";
import { useChatStore } from "../../store/chatStore";
import { haceRelativo } from "../../time";
import type { Project } from "../../types";

/** Punto de estado de una pestaña. Es el mismo semáforo que tenía la barra de
 *  pestañas, que ahora vive dentro de estos dos menús. */
function punto(estado: AgentStatus) {
  return estado === "running"
    ? "bg-accent-soft animate-pulse"
    : estado === "awaiting"
      ? "bg-amber-400"
      : estado === "error"
        ? "bg-red-400"
        : "bg-zinc-600";
}

const DISPARADOR =
  "flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 transition-colors hover:bg-base-hover";

const FILA =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-base-hover";

/** El proyecto y su sesión, en una sola línea y cada uno con su menú. Antes
 *  esto eran dos filas: la barra de pestañas arriba repetía el nombre que la
 *  cabecera volvía a decir, y para cambiar de sesión había que ir a la barra
 *  lateral. */
export function ProyectoSwitcher({ project }: { project: Project }) {
  const tabs = useWorkStore((s) => s.tabs);
  const activeProjectId = useWorkStore((s) => s.activeProjectId);
  const selectProject = useWorkStore((s) => s.selectProject);
  const closeTab = useWorkStore((s) => s.closeTab);
  const openProjectPicker = useWorkStore((s) => s.openProjectPicker);
  const abiertos = Object.keys(tabs);
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        ref={ref}
        onClick={() => setAbierto((v) => !v)}
        title={project.rootPath}
        className={`${DISPARADOR} text-[13px] font-semibold tracking-tight text-zinc-100`}
        aria-expanded={abierto}
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${punto(tabs[project.id]?.agentStatus ?? "idle")}`} />
        <span className="min-w-0 truncate">{project.name}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-zinc-600" />
      </button>
      <Popover
        open={abierto}
        anchorRef={ref}
        onClose={() => setAbierto(false)}
        width={244}
        align="start"
        className="p-1"
      >
        {/* La ficha de la carpeta que se está mirando: qué es y dónde está.
            Vivía en la cabecera, en la misma línea que el nombre, y pesaba más
            que lo que dice. */}
        <div className="mb-1 border-b border-base-border/70 px-2 pb-1.5 pt-1">
          <span
            className="text-[10px] font-medium uppercase tracking-wider text-zinc-500"
            title={
              project.esCodigo
                ? t("Carpeta de código: hay repo de git o un manifiesto de proyecto arriba.")
                : t("Carpeta de documentos: sin marcas de repo. El agente lee y escribe aquí igual.")
            }
          >
            {project.esCodigo ? t("Código") : t("Docs")}
          </span>
          <span
            className="mt-0.5 block truncate font-mono text-[10px] text-zinc-600"
            title={project.rootPath}
          >
            {project.rootPath}
          </span>
        </div>
        {abiertos.map((id) => {
          const p = useWorkStore.getState().projects.find((pr) => pr.id === id);
          const estado = tabs[id]?.agentStatus ?? "idle";
          const ocupada = estado === "running" || estado === "awaiting";
          return (
            <div
              key={id}
              className={`${FILA} ${id === activeProjectId ? "bg-accent/[0.12] text-zinc-100" : "text-zinc-400"} cursor-pointer`}
              onClick={() => {
                setAbierto(false);
                if (id !== activeProjectId) void selectProject(id);
              }}
              title={p?.rootPath}
            >
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${punto(estado)}`} />
              <span className="min-w-0 flex-1 truncate">{p?.name ?? t("Proyecto")}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(id);
                }}
                disabled={ocupada}
                title={ocupada ? t("Está trabajando") : t("Cerrar pestaña")}
                className="shrink-0 rounded p-0.5 text-zinc-600 transition-colors hover:bg-base hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-30"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
        <button
          onClick={() => {
            setAbierto(false);
            void openProjectPicker();
          }}
          className={`${FILA} mt-0.5 border-t border-base-border/70 pt-2 text-zinc-500`}
        >
          <Plus className="h-3 w-3 shrink-0" />
          {t("Abrir otra carpeta")}
        </button>
      </Popover>
    </>
  );
}

/** Las sesiones de esta carpeta, sin salir del proyecto. */
export function SesionSwitcher({ projectId }: { projectId: string }) {
  const sessionId = useWorkStore((s) => s.tabs[projectId]?.sessionId ?? null);
  const selectSession = useWorkStore((s) => s.selectSession);
  const newWorkSession = useWorkStore((s) => s.newWorkSession);
  const conversations = useChatStore((s) => s.conversations);
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  const sesiones = conversations
    .filter((c) => c.projectId === projectId && !c.archived)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const actual = sesiones.find((c) => c.id === sessionId);

  return (
    <>
      <button
        ref={ref}
        onClick={() => setAbierto((v) => !v)}
        className={`${DISPARADOR} max-w-[220px] text-xs text-zinc-500`}
        aria-expanded={abierto}
        title={actual ? `${actual.title} · ${t("otras sesiones de esta carpeta, abajo")}` : t("Sesiones de esta carpeta")}
      >
        <span className="min-w-0 truncate">{actual?.title ?? t("Sin sesión abierta")}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-zinc-700" />
      </button>
      <Popover
        open={abierto}
        anchorRef={ref}
        onClose={() => setAbierto(false)}
        width={252}
        align="start"
        cap={320}
        className="p-1"
      >
        {sesiones.length === 0 && (
          <p className="px-2 py-1.5 text-xs text-zinc-600">
            {t("Aún no hay sesiones en esta carpeta.")}
          </p>
        )}
        {sesiones.map((c) => (
          <button
            key={c.id}
            onClick={() => {
              setAbierto(false);
              if (c.id !== sessionId) void selectSession(c.id);
            }}
            className={`${FILA} ${c.id === sessionId ? "bg-accent/[0.12] text-zinc-100" : "text-zinc-400"}`}
          >
            <MessageSquare className={`h-3 w-3 shrink-0 ${c.id === sessionId ? "text-accent-soft" : "text-zinc-600"}`} />
            <span className="min-w-0 flex-1 truncate">{c.title}</span>
            <span className="shrink-0 text-[10px] text-zinc-600">{haceRelativo(c.updatedAt)}</span>
          </button>
        ))}
        <button
          onClick={() => {
            setAbierto(false);
            void newWorkSession(projectId);
          }}
          className={`${FILA} mt-0.5 border-t border-base-border/70 pt-2 text-zinc-500`}
        >
          <Plus className="h-3 w-3 shrink-0" />
          {t("Nueva sesión")}
        </button>
      </Popover>
    </>
  );
}
