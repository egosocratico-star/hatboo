import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Send,
  Square,
  X,
  FolderTree,
  GitBranch,
} from "lucide-react";
import { useWorkStore } from "../../store/workStore";
import MessageBubble from "../MessageBubble";
import Mascot from "../mascot/Mascot";
import FileTree from "./FileTree";
import TaskList from "./TaskList";
import ToolApprovalModal from "./ToolApprovalModal";
import ApprovalLevelPicker from "./ApprovalLevelPicker";
import type { MascotState } from "../../types";

export default function ProjectView() {
  const project = useWorkStore((s) =>
    s.projects.find((p) => p.id === s.activeProjectId) ?? null,
  );
  const messages = useWorkStore((s) => s.messages);
  const tasks = useWorkStore((s) => s.tasks);
  const stepLines = useWorkStore((s) => s.stepLines);
  const agentStatus = useWorkStore((s) => s.agentStatus);
  const toolSupport = useWorkStore((s) => s.toolSupport);
  const error = useWorkStore((s) => s.error);
  const newProjectDraft = useWorkStore((s) => s.newProjectDraft);
  const treeVersion = useWorkStore((s) => s.treeVersion);
  const git = useWorkStore((s) => s.tabs[s.activeProjectId ?? ""]?.git ?? null);
  const approvalLevel = useWorkStore(
    (s) => s.tabs[s.activeProjectId ?? ""]?.approvalLevel ?? "approve_for_me",
  );
  const startTask = useWorkStore((s) => s.startTask);
  const cancelTask = useWorkStore((s) => s.cancelTask);
  const clearError = useWorkStore((s) => s.clearError);
  const confirmCreateProject = useWorkStore((s) => s.confirmCreateProject);
  const cancelCreateProject = useWorkStore((s) => s.cancelCreateProject);
  const selectProject = useWorkStore((s) => s.selectProject);
  const closeTab = useWorkStore((s) => s.closeTab);
  const refreshGit = useWorkStore((s) => s.refreshGit);

  const activeProjectId = useWorkStore((s) => s.activeProjectId);
  const tabs = useWorkStore((s) => s.tabs);
  const openProjectIds = Object.keys(tabs);

  const [inputByProject, setInputByProject] = useState<Record<string, string>>({});
  const input = activeProjectId ? (inputByProject[activeProjectId] ?? "") : "";
  const setInput = (value: string) =>
    setInputByProject((m) => ({ ...m, [activeProjectId ?? ""]: value }));
  const [treeOpen, setTreeOpen] = useState(true);
  const [newName, setNewName] = useState("");
  const [happy, setHappy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevStatus = useRef(agentStatus);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, tasks, stepLines]);

  // Al terminar una tarea (o escribir archivos), refrescamos el estado git.
  useEffect(() => {
    if (activeProjectId && agentStatus === "idle") void refreshGit(activeProjectId);
  }, [activeProjectId, agentStatus, treeVersion, refreshGit]);

  useEffect(() => {
    if (prevStatus.current === "running" && agentStatus === "idle") {
      setHappy(true);
      const t = setTimeout(() => setHappy(false), 3000);
      prevStatus.current = agentStatus;
      return () => clearTimeout(t);
    }
    prevStatus.current = agentStatus;
  }, [agentStatus]);

  const mascotState: MascotState =
    agentStatus === "error"
      ? "confused"
      : agentStatus === "awaiting"
        ? "surprised"
        : agentStatus === "running"
          ? "thinking"
          : happy
            ? "happy"
            : "idle";

  const submit = async () => {
    const text = input.trim();
    if (!text || agentStatus === "running" || agentStatus === "awaiting") return;
    setInput("");
    clearError();
    try {
      await startTask(text);
    } catch (e) {
      useWorkStore.getState().onError(
        useWorkStore.getState().activeSessionId ?? "",
        String(e),
      );
    }
  };

  const TabBar = (
    <div className="shrink-0 flex items-center gap-1 px-2 pt-2 overflow-x-auto">
      {openProjectIds.map((id) => {
        const p = useWorkStore.getState().projects.find((pr) => pr.id === id);
        const status = tabs[id]?.agentStatus ?? "idle";
        const isActive = id === activeProjectId;
        return (
          <div
            key={id}
            className={`group flex items-center gap-1.5 max-w-44 rounded-t-lg border border-b-0 px-3 py-1.5 text-xs cursor-pointer transition-colors ${
              isActive
                ? "bg-base-raised border-base-border text-zinc-100"
                : "bg-transparent border-transparent text-zinc-500 hover:bg-base-hover hover:text-zinc-300"
            }`}
            onClick={() => void selectProject(id)}
            title={p?.rootPath}
          >
            <span
              className={`w-1.5 h-1.5 shrink-0 rounded-full ${
                status === "running"
                  ? "bg-accent-soft animate-pulse"
                  : status === "awaiting"
                    ? "bg-amber-400"
                    : status === "error"
                      ? "bg-red-400"
                      : "bg-zinc-600"
              }`}
            />
            <span className="truncate">{p?.name ?? "Proyecto"}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeTab(id);
              }}
              disabled={status === "running" || status === "awaiting"}
              className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-base text-zinc-500 hover:text-layer transition-all disabled:cursor-not-allowed"
              title="Cerrar pestaña"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        );
      })}
    </div>
  );

  if (!project) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        {openProjectIds.length > 0 && TabBar}
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
          <Mascot state="idle" size={140} />
          <h1 className="text-2xl font-semibold tracking-tight">
            Modo <span className="text-accent-soft">Trabajo</span>
          </h1>
          <p className="text-sm text-zinc-500 max-w-md text-center">
            Abre una carpeta existente o crea un proyecto nuevo desde la barra
            lateral para que Hatboo pueda leer, escribir y ejecutar dentro de él.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {openProjectIds.length > 0 && TabBar}
      <div className="flex-1 flex min-h-0">
      {treeOpen && (
        <div className="w-60 shrink-0 border-r border-base-border bg-base-raised/40">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-base-border text-xs font-medium text-zinc-400 uppercase tracking-wider">
            <FolderTree className="w-4 h-4 text-accent-soft" />
            Archivos
          </div>
          <FileTree projectId={project.id} version={treeVersion} />
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-base-border">
          <button
            onClick={() => setTreeOpen((v) => !v)}
            className="p-1.5 rounded-lg text-zinc-400 hover:bg-base-hover hover:text-zinc-200 transition-colors"
            title="Mostrar/ocultar árbol de archivos"
          >
            <FolderTree className="w-4 h-4" />
          </button>
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{project.name}</div>
            <div className="text-[10px] text-zinc-600 truncate">{project.rootPath}</div>
          </div>
          {git?.isRepo && git.branch && (
            <button
              onClick={() => void refreshGit(project.id)}
              className="shrink-0 flex items-center gap-1.5 rounded-lg border border-base-border bg-base-raised px-2 py-1 text-[11px] text-zinc-400 hover:border-accent/50 hover:text-zinc-200 transition-colors"
              title={`Rama ${git.branch} · ${git.dirtyCount} archivo(s) con cambios`}
            >
              <GitBranch className="w-3.5 h-3.5 text-accent-soft" />
              <span className="font-mono max-w-28 truncate">{git.branch}</span>
              {git.dirtyCount > 0 && (
                <span className="rounded-full bg-amber-500/20 text-amber-300 px-1.5 text-[10px] font-medium">
                  {git.dirtyCount}
                </span>
              )}
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <ApprovalLevelPicker projectId={project.id} />
            <Mascot state={mascotState} size={32} />
          </div>
        </header>

        {approvalLevel === "full_access" && (
          <div className="mx-4 mt-3 rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            <span className="font-semibold">Acceso total activo:</span> el agente
            ejecuta todas las acciones sin pedir aprobación, incluida escritura
            de archivos y comandos. Las rutas siguen limitadas a la carpeta del
            proyecto.
          </div>
        )}

        {toolSupport === false && (
          <div className="mx-4 mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            Este modelo no soporta tool calling — cambia de proveedor o modelo
            en Ajustes para usar el modo trabajo.
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center gap-2 px-6 text-center">
              <p className="text-sm text-zinc-500 max-w-sm">
                Pide una tarea sobre este proyecto. Hatboo hará un plan, leerá
                archivos y pedirá aprobación antes de escribir o ejecutar.
              </p>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto px-6 py-6 space-y-4">
              {messages
                .filter((m) => m.role === "user" || m.content.trim() !== "")
                .map((m) => (
                  <MessageBubble key={m.id} message={m} />
                ))}
              {agentStatus !== "idle" && <ActivityLine lines={stepLines} />}
              {agentStatus === "running" && (
                <div className="flex justify-start">
                  <div className="rounded-2xl rounded-bl-md px-4 py-2.5 text-sm bg-base-raised border border-base-border text-zinc-400">
                    <span className="inline-block w-2 h-2 mr-1 rounded-full bg-accent-soft animate-bounce" />
                    Trabajando en la tarea…
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {error && (
          <div className="max-w-3xl mx-auto w-full px-6 pb-2">
            <div className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span className="flex-1">{error}</span>
              <button onClick={clearError} className="p-0.5 hover:text-layer">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        <div className="shrink-0 border-t border-base-border bg-base-raised/60 px-6 py-4">
          <div className="flex items-end gap-2 rounded-xl border border-base-border bg-base px-3 py-2 focus-within:border-accent/70 transition-colors">
            <textarea
              id="work-task-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
              rows={Math.min(6, Math.max(1, input.split("\n").length))}
              placeholder="¿Qué quieres hacer en este proyecto?"
              disabled={toolSupport === false}
              className="flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-zinc-600 max-h-48 disabled:cursor-not-allowed"
            />
            {agentStatus === "running" || agentStatus === "awaiting" ? (
              <button
                onClick={() => void cancelTask()}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-500/50 text-red-300 text-sm hover:bg-red-500/10 transition-colors"
                title="Detener la tarea en curso"
              >
                <Square className="w-3.5 h-3.5" />
                Cancelar
              </button>
            ) : (
              <button
                onClick={() => void submit()}
                disabled={
                  !input.trim() || toolSupport === false
                }
                className="p-2 rounded-lg bg-accent text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent-dim transition-colors"
                title="Enviar"
              >
                <Send className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="w-72 shrink-0 border-l border-base-border bg-base-raised/40">
        <TaskList tasks={tasks} />
      </div>

      <ToolApprovalModal />

      {newProjectDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void confirmCreateProject(newName);
            }}
            className="w-full max-w-sm rounded-xl border border-base-border bg-base-raised p-5 space-y-4"
          >
            <h2 className="text-sm font-semibold">Nombre del proyecto</h2>
            <p className="text-xs text-zinc-500 break-all">en {newProjectDraft.parentPath}</p>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="mi-proyecto"
              className="w-full rounded-lg border border-base-border bg-base px-3 py-2 text-sm outline-none focus:border-accent/70"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={cancelCreateProject}
                className="px-3 py-2 rounded-lg border border-base-border text-sm text-zinc-300 hover:border-zinc-500"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={!newName.trim()}
                className="px-3 py-2 rounded-lg bg-accent text-white text-sm disabled:opacity-40 hover:bg-accent-dim"
              >
                Crear
              </button>
            </div>
          </form>
        </div>
      )}
      </div>
    </div>
  );
}

function ActivityLine({ lines }: { lines: Array<{ toolName: string; ok: boolean; brief: string }> }) {
  if (lines.length === 0) return null;
  return (
    <div className="ml-1 space-y-0.5 border-l-2 border-base-border pl-3">
      {lines.map((l, i) => (
        <div key={i} className="text-[11px] text-zinc-500 font-mono">
          <span className={l.ok ? "text-emerald-500/80" : "text-red-400/80"}>
            {l.ok ? "✓" : "✗"}
          </span>{" "}
          {l.toolName}
          {l.brief && <span className="text-zinc-600"> — {l.brief}</span>}
        </div>
      ))}
    </div>
  );
}
