import { t } from "../i18n";
import { useRef, useState } from "react";
import {
  Settings,
  Trash2,
  Ghost,
  FolderPlus,
  FolderOpen,
  Briefcase,
  MessageSquare,
  MessageCircle,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  Archive,
  ArchiveRestore,
  ChevronsUpDown,
  Search,
  Plus,
} from "lucide-react";
import { useChatStore } from "../store/chatStore";
import { useWorkStore } from "../store/workStore";
import ContextMenu, { type MenuItem } from "./ContextMenu";
import Popover from "./Popover";
import ThemePicker from "./ThemePicker";
import Avatar from "./Avatar";
import { type ThemeChoice } from "../theme";
import type { Conversation, Project, AvatarStyle } from "../types";

const PROVIDER_LABEL: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  local: "Local",
};

/** Botón del lateral plegado: sin texto, todo a `title`. */
const RAIL_BTN =
  "shrink-0 grid place-items-center h-9 rounded-lg transition-colors";

const fmtDate = (ms: number) =>
  new Intl.DateTimeFormat("es", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(ms);

/** "ahora" / "hace 12 min" / "ayer" en vez de la fecha exacta: lo que importa
 *  es la cercanía. La fecha completa se queda en el `title`. */
function haceRelativo(ms: number): string {
  const minutos = Math.floor((Date.now() - ms) / 60_000);
  if (minutos < 1) return t("ahora");
  if (minutos < 60) return t("hace {n} min", { n: minutos });
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return t("hace {n} h", { n: horas });
  const dias = Math.floor(horas / 24);
  if (dias === 1) return t("ayer");
  if (dias < 7) return t("hace {n} días", { n: dias });
  const semanas = Math.floor(dias / 7);
  if (semanas < 5) return t("hace {n} sem", { n: semanas });
  return fmtDate(ms);
}

function SessionRow({
  conv,
  isActive,
  agentStatus,
  onOpen,
  onDelete,
  onMenu,
}: {
  conv: Conversation;
  isActive: boolean;
  agentStatus: string;
  onOpen: () => void;
  onDelete: () => void;
  onMenu: (e: React.MouseEvent) => void;
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
      onContextMenu={onMenu}
      className={`group flex items-center gap-1.5 rounded-md px-2 py-1 cursor-pointer text-xs transition-colors ${
        isActive
          ? "bg-base-hover text-zinc-100"
          : "text-zinc-500 hover:bg-base-hover hover:text-zinc-300"
      }`}
      title={`${conv.title} · ${fmtDate(conv.updatedAt)} · ${t("clic derecho para más opciones")}`}
    >
      <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${dot}`} />
      <span className="flex-1 truncate">{conv.title}</span>
      {conv.pinned && <Pin className="w-3 h-3 shrink-0 text-accent-soft/70" />}
      <span className="shrink-0 text-[10px] text-zinc-600 group-hover:hidden">
        {haceRelativo(conv.updatedAt)}
      </span>
      <button
        onClick={(ev) => {
          ev.stopPropagation();
          onDelete();
        }}
        disabled={isActive}
        title={isActive ? t("Es la sesión abierta") : t("Eliminar sesión")}
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
  const settings = useChatStore((s) => s.settings);
  const assistantName = settings?.assistantName?.trim() || "Hatboo";
  const provider = settings?.activeProvider ?? "local";
  const activeModel =
    provider === "anthropic"
      ? settings?.anthropicModel
      : provider === "openai"
        ? settings?.openaiModel
        : settings?.localModel;

  const projects = useWorkStore((s) => s.projects);
  const activeProjectId = useWorkStore((s) => s.activeProjectId);
  const tabs = useWorkStore((s) => s.tabs);
  const openProjectPicker = useWorkStore((s) => s.openProjectPicker);
  const startCreateProject = useWorkStore((s) => s.startCreateProject);
  const selectProject = useWorkStore((s) => s.selectProject);
  const selectSession = useWorkStore((s) => s.selectSession);
  const newWorkSession = useWorkStore((s) => s.newWorkSession);
  const removeProject = useWorkStore((s) => s.removeProject);
  const setProjectPinned = useWorkStore((s) => s.setProjectPinned);
  const focus = settings?.focusMode ?? false;
  // El modo foco es un arreglo del workspace: en la vista de chat la barra
  // lateral sigue con su propio estado, si no se quedaría sin forma de salir.
  const hidden = focus && view === "work";
  const compact = settings?.sidebarCompact ?? false;
  const patchSettings = useChatStore((s) => s.patchSettings);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggleExpanded = (id: string) =>
    setExpanded((e) => ({ ...e, [id]: !e[id] }));
  const [showArchived, setShowArchived] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; conv: Conversation } | null>(null);
  const [projectMenu, setProjectMenu] = useState<{
    x: number;
    y: number;
    project: Project;
  } | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLButtonElement>(null);
  const setConversationFlags = useChatStore((s) => s.setConversationFlags);

  const openMenu = (conv: Conversation) => (e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, conv });
  };

  const openProjectMenu = (project: Project) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setProjectMenu({ x: e.clientX, y: e.clientY, project });
  };

  const projectMenuItems = (p: Project): MenuItem[] => [
    {
      label: p.pinned ? t("Dejar de fijar") : t("Fijar arriba"),
      icon: <Pin className="w-3.5 h-3.5" />,
      onSelect: () => void setProjectPinned(p.id, !p.pinned),
    },
    {
      label: t("Quitar de la lista"),
      icon: <Trash2 className="w-3.5 h-3.5" />,
      danger: true,
      onSelect: () => void removeProject(p.id),
    },
  ];

  const menuItems = (conv: Conversation): MenuItem[] => [
    {
      label: conv.pinned ? t("Dejar de fijar") : t("Fijar arriba"),
      icon: <Pin className="w-3.5 h-3.5" />,
      onSelect: () => void setConversationFlags(conv.id, { pinned: !conv.pinned }),
    },
    conv.archived
      ? {
          label: "Restaurar",
          icon: <ArchiveRestore className="w-3.5 h-3.5" />,
          onSelect: () => void setConversationFlags(conv.id, { archived: false }),
        }
      : {
          label: "Archivar",
          icon: <Archive className="w-3.5 h-3.5" />,
          onSelect: () => void setConversationFlags(conv.id, { archived: true }),
        },
    {
      label: t("Eliminar"),
      icon: <Trash2 className="w-3.5 h-3.5" />,
      danger: true,
      onSelect: () => void removeConversation(conv.id),
    },
  ];

  /** Archivado = fuera de la lista, no borrado: se vuelve a enseñar con el
   *  contador del pie de la sección. */
  const visibles = (lista: Conversation[]) =>
    showArchived ? lista : lista.filter((c) => !c.archived);

  const byPinnedThenRecent = (a: Conversation, b: Conversation) =>
    Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt;

  const chatConversations = visibles(
    conversations.filter((c) => !c.projectId),
  ).sort(byPinnedThenRecent);
  const archivedCount = conversations.filter((c) => !c.projectId && c.archived).length;
  const sessionsOf = (projectId: string) =>
    visibles(conversations.filter((c) => c.projectId === projectId)).sort(byPinnedThenRecent);

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

  if (hidden) {
    return <aside className="w-0 shrink-0 overflow-clip transition-[width] duration-200 ease-[cubic-bezier(.2,.8,.2,1)]" />;
  }

  if (compact) {
    return (
      <aside className="w-14 shrink-0 h-full flex flex-col gap-1 px-2.5 py-2 border-r border-base-border bg-base-raised transition-[width] duration-200 ease-[cubic-bezier(.2,.8,.2,1)]">
        <button
          onClick={() => patchSettings({ sidebarCompact: false })}
          className={`${RAIL_BTN} text-accent-soft hover:bg-base-hover`}
          title={t("Desplegar la barra lateral (Ctrl+B)")}
        >
          <Ghost className="w-5 h-5" />
        </button>
        <button
          onClick={() => void newConversation()}
          className={`${RAIL_BTN} text-accent-soft hover:bg-base-hover`}
          title={t("Nueva conversación (Ctrl+N)")}
        >
          <Plus className="w-4 h-4" />
        </button>
        <button
          onClick={() => useChatStore.getState().setSearchOpen(true)}
          className={`${RAIL_BTN} text-zinc-400 hover:bg-base-hover hover:text-zinc-100`}
          title={t("Buscar en todos los chats (Ctrl+K)")}
        >
          <Search className="w-4 h-4" />
        </button>
        <button
          onClick={() => void openProjectPicker()}
          className={`${RAIL_BTN} text-zinc-400 hover:bg-base-hover hover:text-zinc-100`}
          title={t("Abrir carpeta existente")}
        >
          <FolderOpen className="w-4 h-4" />
        </button>
        <button
          onClick={() => void startCreateProject()}
          className={`${RAIL_BTN} text-zinc-400 hover:bg-base-hover hover:text-zinc-100`}
          title={t("Crear proyecto nuevo")}
        >
          <FolderPlus className="w-4 h-4" />
        </button>

        <div className="flex-1 min-h-0 mt-1 pt-1 border-t border-base-border overflow-y-auto space-y-1">
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                setView("work");
                void selectProject(p.id);
              }}
              className={`${RAIL_BTN} w-full ${
                p.id === activeProjectId && view === "work"
                  ? "bg-base-hover text-zinc-100"
                  : "text-zinc-400 hover:bg-base-hover hover:text-zinc-200"
              }`}
              title={p.name}
            >
              <Briefcase className="w-4 h-4" />
            </button>
          ))}
          {chatConversations.map((conv) => (
            <button
              key={conv.id}
              onClick={() => {
                setView("chat");
                void selectConversation(conv.id);
              }}
              onContextMenu={openMenu(conv)}
              className={`${RAIL_BTN} w-full ${
                conv.id === activeId && view === "chat"
                  ? "bg-base-hover text-zinc-100"
                  : "text-zinc-400 hover:bg-base-hover hover:text-zinc-200"
              }`}
              title={conv.title}
            >
              <MessageSquare className="w-4 h-4" />
            </button>
          ))}
        </div>

        <button
          onClick={() => setView(view === "settings" ? "chat" : "settings")}
          className={`${RAIL_BTN} w-full ${
            view === "settings"
              ? "text-accent-soft bg-base-hover"
              : "text-zinc-500 hover:text-zinc-100 hover:bg-base-hover"
          }`}
          title={t("Ajustes (Ctrl+,)")}
        >
          <Settings className="w-4 h-4" />
        </button>
        <button
          onClick={() => patchSettings({ sidebarCompact: false })}
          className={`${RAIL_BTN} w-full text-zinc-500 hover:bg-base-hover hover:text-zinc-100`}
          title={t("Desplegar la barra lateral (Ctrl+B)")}
        >
          <PanelLeftOpen className="w-4 h-4" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="w-64 shrink-0 h-full flex flex-col border-r border-base-border bg-base-raised transition-[width] duration-200 ease-[cubic-bezier(.2,.8,.2,1)]">
      <div className="flex items-center gap-2 pl-4 pr-2 h-14">
        <Ghost className="w-5 h-5 shrink-0 text-accent-soft" />
        <span className="flex-1 font-semibold tracking-tight truncate">Hatboo</span>
        <button
          onClick={() => useChatStore.getState().setSearchOpen(true)}
          className="shrink-0 p-1.5 rounded-lg text-zinc-500 hover:bg-base-hover hover:text-zinc-100 transition-colors"
          title={t("Buscar en todos los chats (Ctrl+K)")}
        >
          <Search className="w-4 h-4" />
        </button>
        <button
          onClick={() => patchSettings({ sidebarCompact: true })}
          className="shrink-0 p-1.5 rounded-lg text-zinc-500 hover:bg-base-hover hover:text-zinc-100 transition-colors"
          title={t("Plegar la barra lateral (Ctrl+B)")}
        >
          <PanelLeftClose className="w-4 h-4" />
        </button>
      </div>

      <div className="px-3 pb-2">
        <button
          onClick={() => void newConversation()}
          className="w-full flex items-center gap-2 justify-center px-3 py-2 rounded-full
                     border border-accent/40 bg-accent/10 hover:bg-accent/20 text-accent-soft text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t("Nueva conversación")}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
        <div className="flex items-center gap-1.5 px-3 pt-3 pb-1.5 text-[11px] font-medium text-zinc-500">
          <Briefcase className="w-3.5 h-3.5" />
          {t("Proyectos")}
        </div>
        <div className="grid grid-cols-2 gap-2 px-1 pb-1">
          <button
            onClick={() => void openProjectPicker()}
            className="flex items-center gap-1.5 justify-center px-2 py-1.5 rounded-lg text-xs text-zinc-400 hover:bg-base-hover hover:text-zinc-100 transition-colors"
            title={t("Abrir carpeta existente")}
          >
            <FolderOpen className="w-3.5 h-3.5" />
            {t("Abrir")}
          </button>
          <button
            onClick={() => void startCreateProject()}
            className="flex items-center gap-1.5 justify-center px-2 py-1.5 rounded-lg text-xs text-zinc-400 hover:bg-base-hover hover:text-zinc-100 transition-colors"
            title={t("Crear proyecto nuevo")}
          >
            <FolderPlus className="w-3.5 h-3.5" />
            {t("Crear")}
          </button>
        </div>
        {projects.length === 0 && (
          <p className="px-3 py-1 text-xs text-zinc-500">
            {t("Aún no hay proyectos.")}
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
                onContextMenu={openProjectMenu(p)}
                title={p.rootPath}
              >
                <button
                  onClick={(ev) => {
                    ev.stopPropagation();
                    toggleExpanded(p.id);
                  }}
                  className="p-1 shrink-0 text-zinc-500 hover:text-layer"
                  title={isOpen ? t("Ocultar sesiones") : t("Ver sesiones")}
                >
                  {isOpen ? (
                    <ChevronDown className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5" />
                  )}
                </button>
                <Briefcase className="w-3.5 h-3.5 shrink-0 text-accent-soft/70" />
                <span className="flex-1 truncate">{p.name}</span>
                {p.pinned && (
                  <Pin
                    className="w-3 h-3 shrink-0 text-accent-soft/70"
                    aria-label={t("Proyecto fijado")}
                  />
                )}
                {tab && (
                  <span
                    className="shrink-0 w-1.5 h-1.5 rounded-full bg-accent-soft/80"
                    title={t("Pestaña abierta")}
                  />
                )}
                <button
                  title={t("Quitar proyecto")}
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
                      onMenu={openMenu(conv)}
                    />
                  ))}
                  <button
                    onClick={() => openBlankSession(p.id)}
                    className="w-full flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-base-hover hover:text-zinc-200 transition-colors"
                    title={t("Nueva sesión de trabajo")}
                  >
                    <Plus className="w-3 h-3" />
                    {t("Nueva sesión")}
                  </button>
                </div>
              )}
            </div>
          );
        })}

        <div className="flex items-center gap-1.5 px-3 pt-5 pb-1.5 text-[11px] font-medium text-zinc-500">
          <MessageCircle className="w-3.5 h-3.5" />
          {t("Conversaciones")}
        </div>
        {chatConversations.length === 0 && (
          <p className="px-3 py-2 text-xs text-zinc-500">
            {t("Aún no hay conversaciones.")}
          </p>
        )}
        {chatConversations.map((conv) => (
          <div
            key={conv.id}
            onClick={() => {
              setView("chat");
              void selectConversation(conv.id);
            }}
            onContextMenu={openMenu(conv)}
            className={`group flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer text-sm transition-colors ${
              conv.id === activeId && view === "chat"
                ? "bg-base-hover text-zinc-100"
                : "text-zinc-400 hover:bg-base-hover hover:text-zinc-200"
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5 shrink-0 opacity-60" />
            <span className="flex-1 truncate">{conv.title}</span>
            {conv.pinned && <Pin className="w-3.5 h-3.5 shrink-0 text-accent-soft/70" />}
            <button
              title={t("Eliminar")}
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
        {archivedCount > 0 && (
          <button
            onClick={() => setShowArchived((v) => !v)}
            className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
            title={t("Las archivadas no se borran: solo salen de la lista")}
          >
            <Archive className="w-3 h-3 shrink-0" />
            {showArchived ? t("Ocultar archivadas") : t("Archivadas ({n})", { n: archivedCount })}
          </button>
        )}
      </nav>

      <div className="p-2 border-t border-base-border">
        <button
          ref={profileRef}
          onClick={() => setProfileOpen((v) => !v)}
          className="w-full flex items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-base-hover transition-colors"
          title={t("Menú rápido")}
        >
          <Avatar
            style={(settings?.avatarStyle ?? "mascota") as AvatarStyle}
            colorId={settings?.avatarColor ?? "violeta"}
            emoji={settings?.avatarEmoji ?? "🎩"}
            name={assistantName}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm text-zinc-200">{assistantName}</span>
            <span className="block truncate text-[11px] text-zinc-500">
              {PROVIDER_LABEL[provider]}
              {activeModel ? ` · ${activeModel}` : ""}
            </span>
          </span>
          <ChevronsUpDown className="w-3.5 h-3.5 shrink-0 text-zinc-600" />
        </button>

        <Popover
          open={profileOpen}
          anchorRef={profileRef}
          onClose={() => setProfileOpen(false)}
          width={236}
          align="start"
          className="p-1.5 space-y-1.5"
        >
          <div>
            <p className="px-1.5 pb-1 text-[10px] uppercase tracking-wider text-zinc-600">
              {t("Tema")}
            </p>
            <ThemePicker
              value={(settings?.theme ?? "dark") as ThemeChoice}
              onChange={(id) => patchSettings({ theme: id })}
              grow
            />
          </div>
          <div className="pt-1 border-t border-base-border space-y-0.5">
            <button
              onClick={() => {
                setView("settings");
                setProfileOpen(false);
              }}
              className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-zinc-300 hover:bg-base-hover transition-colors"
            >
              <Settings className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
              {t("Ajustes")}
              <span className="ml-auto text-[10px] text-zinc-600">Ctrl+,</span>
            </button>
            <button
              onClick={() => {
                patchSettings({ sidebarCompact: true });
                setProfileOpen(false);
              }}
              className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-zinc-300 hover:bg-base-hover transition-colors"
            >
              <PanelLeftClose className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
              {t("Plegar la barra lateral")}
              <span className="ml-auto text-[10px] text-zinc-600">Ctrl+B</span>
            </button>
          </div>
        </Popover>
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.conv)}
          onClose={() => setMenu(null)}
        />
      )}
      {projectMenu && (
        <ContextMenu
          x={projectMenu.x}
          y={projectMenu.y}
          items={projectMenuItems(projectMenu.project)}
          onClose={() => setProjectMenu(null)}
        />
      )}
    </aside>
  );
}
