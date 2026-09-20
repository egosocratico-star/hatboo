import { useState } from "react";
import {
  MessageSquarePlus,
  Settings,
  Trash2,
  Ghost,
  FolderPlus,
  FolderOpen,
  Briefcase,
  MessageCircle,
  ChevronDown,
  ChevronRight,
  Plus,
} from "lucide-react";
import { useChatStore } from "../store/chatStore";
import { useWorkStore } from "../store/workStore";
import type { Conversation } from "../types";

const fmtDate = (ms: number) =>
  new Intl.DateTimeFormat("es", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(ms);

function SessionRow({
  conv,
  isActive,
  agentStatus,
  onOpen,
  onDelete,
}: {
  conv: Conversation;
  isActive: boolean;
  agentStatus: string;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const dot = !isActive
    ? "bg-zinc-600"
    : agentStatus === "running"
      ? "bg-accent-soft animate-pulse"
      : agentStatus === "awaiting"
        ? "bg-amber-400"
        : agentStatus === "error"
          ? "bg-red-400"
          : "bg-accent-soft/50";
  return (
    <div
      onClick={onOpen}
      className={`group flex items-center gap-1.5 rounded-md px-2 py-1 cursor-pointer text-xs transition-colors ${
        isActive
          ? "bg-base-hover text-zinc-100"
          : "text-zinc-500 hover:bg-base-hover hover:text-zinc-300"
      }`}
      title={`${conv.title} · ${fmtDate(conv.updatedAt)}`}
    >
      <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${dot}`} />
      <span className="flex-1 truncate">{conv.title}</span>
      <span className="shrink-0 text-[10px] text-zinc-600 group-hover:hidden">
        {fmtDate(conv.updatedAt)}
      </span>
      <button
        onClick={(ev) => {
          ev.stopPropagation();
          onDelete();
        }}
        disabled={isActive}
        title={isActive ? "Es la sesión abierta" : "Eliminar sesión"}
        className="hidden group-hover:block shrink-0 p-0.5 rounded text-zinc-500 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
}

export default function Sidebar() {
  const conversations = useChatStore((s) => s.conversations);
  const activeId = useChatStore((s) => s.activeId);
  const view = useChatStore((s) => s.view);
  const newConversation = useChatStore((s) => s.newConversation);
  const selectConversation = useChatStore((s) => s.selectConversation);
  const removeConversation = useChatStore((s) => s.removeConversation);
  const setView = useChatStore((s) => s.setView);

  const projects = useWorkStore((s) => s.projects);
  const activeProjectId = useWorkStore((s) => s.activeProjectId);
  const tabs = useWorkStore((s) => s.tabs);
  const openProjectPicker = useWorkStore((s) => s.openProjectPicker);
  const startCreateProject = useWorkStore((s) => s.startCreateProject);
  const selectProject = useWorkStore((s) => s.selectProject);
  const selectSession = useWorkStore((s) => s.selectSession);
  const newWorkSession = useWorkStore((s) => s.newWorkSession);
  const removeProject = useWorkStore((s) => s.removeProject);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggleExpanded = (id: string) =>
    setExpanded((e) => ({ ...e, [id]: !e[id] }));

  const chatConversations = conversations.filter((c) => !c.projectId);
  const sessionsOf = (projectId: string) =>
    conversations
      .filter((c) => c.projectId === projectId)
      .sort((a, b) => b.updatedAt - a.updatedAt);

  const openSession = (projectId: string, conversationId: string) => {
    setView("work");
    void (async () => {
      await selectProject(projectId);
      await selectSession(conversationId);
    })();
  };

  const openBlankSession = (projectId: string) => {
    setView("work");
    void (async () => {
      await selectProject(projectId);
      await newWorkSession(projectId);
      // Si "+" reutilizó la sesión en blanco no cambia nada en pantalla:
      // llevar el foco al input para que el click se sienta respondido.
      setTimeout(() => document.getElementById("work-task-input")?.focus(), 60);
    })();
  };

  return (
    <aside className="w-64 shrink-0 h-full flex flex-col border-r border-base-border bg-base-raised">
      <div className="flex items-center gap-2 px-4 h-14 border-b border-base-border">
        <Ghost className="w-5 h-5 text-accent-soft" />
        <span className="font-semibold tracking-tight">Hatboo</span>
      </div>

      <div className="p-3 space-y-2">
        <button
          onClick={() => void newConversation()}
          className="w-full flex items-center gap-2 justify-center px-3 py-2 rounded-lg
                     bg-accent hover:bg-accent-dim text-white text-sm font-medium transition-colors"
        >
          <MessageSquarePlus className="w-4 h-4" />
          Nueva conversación
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => void openProjectPicker()}
            className="flex items-center gap-1.5 justify-center px-2 py-1.5 rounded-lg border border-base-border text-xs text-zinc-300 hover:border-accent/50 hover:text-white transition-colors"
            title="Abrir carpeta existente"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            Abrir
          </button>
          <button
            onClick={() => void startCreateProject()}
            className="flex items-center gap-1.5 justify-center px-2 py-1.5 rounded-lg border border-base-border text-xs text-zinc-300 hover:border-accent/50 hover:text-white transition-colors"
            title="Crear proyecto nuevo"
          >
            <FolderPlus className="w-3.5 h-3.5" />
            Crear
          </button>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
        <div className="flex items-center gap-1.5 px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-zinc-600">
          <Briefcase className="w-3 h-3" />
          Proyectos de trabajo
        </div>
        {projects.length === 0 && (
          <p className="px-3 py-1 text-xs text-zinc-500">
            Aún no hay proyectos.
          </p>
        )}
        {projects.map((p) => {
          const isOpen = !!expanded[p.id];
          const tab = tabs[p.id];
          const sessions = sessionsOf(p.id);
          return (
            <div key={p.id}>
              <div
                className={`group flex items-center gap-1 rounded-lg pr-2 cursor-pointer text-sm transition-colors ${
                  p.id === activeProjectId && view === "work"
                    ? "bg-base-hover text-zinc-100"
                    : "text-zinc-400 hover:bg-base-hover hover:text-zinc-200"
                }`}
                onClick={() => {
                  setView("work");
                  void selectProject(p.id);
                  setExpanded((e) => ({ ...e, [p.id]: true }));
                }}
                title={p.rootPath}
              >
                <button
                  onClick={(ev) => {
                    ev.stopPropagation();
                    toggleExpanded(p.id);
                  }}
                  className="p-1 shrink-0 text-zinc-500 hover:text-white"
                  title={isOpen ? "Ocultar sesiones" : "Ver sesiones"}
                >
                  {isOpen ? (
                    <ChevronDown className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5" />
                  )}
                </button>
                <Briefcase className="w-3.5 h-3.5 shrink-0 text-accent-soft/70" />
                <span className="flex-1 truncate">{p.name}</span>
                {tab && (
                  <span
                    className="shrink-0 w-1.5 h-1.5 rounded-full bg-accent-soft/80"
                    title="Pestaña abierta"
                  />
                )}
                <button
                  title="Quitar proyecto"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    void removeProject(p.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-accent-dim/30 text-zinc-500 hover:text-red-400 transition-all"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {isOpen && (
                <div className="ml-4 pl-1 border-l border-base-border space-y-0.5 py-0.5">
                  {sessions.map((conv) => (
                    <SessionRow
                      key={conv.id}
                      conv={conv}
                      isActive={conv.id === tab?.sessionId}
                      agentStatus={tab?.agentStatus ?? "idle"}
                      onOpen={() => openSession(p.id, conv.id)}
                      onDelete={() => void removeConversation(conv.id)}
                    />
                  ))}
                  <button
                    onClick={() => openBlankSession(p.id)}
                    className="w-full flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-base-hover hover:text-zinc-200 transition-colors"
                    title="Nueva sesión de trabajo"
                  >
                    <Plus className="w-3 h-3" />
                    Nueva sesión
                  </button>
                </div>
              )}
            </div>
          );
        })}

        <div className="flex items-center gap-1.5 px-3 pt-4 pb-1 text-[10px] uppercase tracking-wider text-zinc-600">
          <MessageCircle className="w-3 h-3" />
          Conversaciones
        </div>
        {chatConversations.length === 0 && (
          <p className="px-3 py-2 text-xs text-zinc-500">
            Aún no hay conversaciones.
          </p>
        )}
        {chatConversations.map((conv) => (
          <div
            key={conv.id}
            className={`group flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer text-sm transition-colors ${
              conv.id === activeId && view === "chat"
                ? "bg-base-hover text-zinc-100"
                : "text-zinc-400 hover:bg-base-hover hover:text-zinc-200"
            }`}
            onClick={() => {
              setView("chat");
              void selectConversation(conv.id);
            }}
          >
            <span className="flex-1 truncate">{conv.title}</span>
            <button
              title="Eliminar"
              onClick={(ev) => {
                ev.stopPropagation();
                void removeConversation(conv.id);
              }}
              className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-accent-dim/30 text-zinc-500 hover:text-red-400 transition-all"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </nav>

      <div className="p-3 border-t border-base-border">
        <button
          onClick={() => setView(view === "settings" ? "chat" : "settings")}
          className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
            view === "settings"
              ? "bg-base-hover text-accent-soft"
              : "text-zinc-400 hover:bg-base-hover hover:text-zinc-200"
          }`}
        >
          <Settings className="w-4 h-4" />
          Ajustes
        </button>
      </div>
    </aside>
  );
}
