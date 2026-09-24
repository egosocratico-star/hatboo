import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useChatStore } from "./chatStore";
import type {
  ApprovalLevel,
  Conversation,
  Message,
  PendingApproval,
  Project,
  Task,
} from "../types";

export type AgentStatus = "idle" | "running" | "awaiting" | "error";

/** Salida de `run_command`, ya con las claves tapadas si tocaba taparlas. */
export interface CommandData {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

interface StepLine {
  toolName: string;
  ok: boolean;
  brief: string;
  durationMs: number;
  data?: CommandData | null;
}

export type { StepLine };

/** Payload del evento `agent:step_result`. */
export interface StepResult {
  conversationId: string;
  tasks: Task[];
  toolName: string;
  ok: boolean;
  brief: string;
  durationMs: number;
  data?: Record<string, unknown> | null;
}

export interface GitInfo {
  isRepo: boolean;
  branch: string | null;
  dirtyCount: number;
}

/// Estado independiente por pestaña de proyecto.
export interface TabState {
  sessionId: string | null;
  messages: Message[];
  tasks: Task[];
  stepLines: StepLine[];
  agentStatus: AgentStatus;
  approval: PendingApproval | null;
  error: string | null;
  git: GitInfo | null;
  approvalLevel: ApprovalLevel;
}

const emptyTab = (): TabState => ({
  sessionId: null,
  messages: [],
  tasks: [],
  stepLines: [],
  agentStatus: "idle",
  approval: null,
  error: null,
  git: null,
  approvalLevel: "approve_for_me",
});

interface WorkStore {
  projects: Project[];
  activeProjectId: string | null;
  tabs: Record<string, TabState>;
  toolSupport: boolean | null;
  error: string | null;
  newProjectDraft: { parentPath: string } | null;
  treeVersion: number;

  loadProjects: () => Promise<void>;
  openProjectPicker: () => Promise<void>;
  startCreateProject: () => Promise<void>;
  confirmCreateProject: (name: string) => Promise<void>;
  cancelCreateProject: () => void;
  selectProject: (id: string) => Promise<void>;
  closeTab: (id: string) => void;
  refreshGit: (projectId: string) => Promise<void>;
  removeProject: (id: string) => Promise<void>;
  setProjectPinned: (id: string, pinned: boolean) => Promise<void>;
  newWorkSession: (projectId: string) => Promise<string>;
  selectSession: (conversationId: string) => Promise<void>;
  startTask: (request: string) => Promise<void>;
  cancelTask: () => Promise<void>;
  setApprovalLevel: (projectId: string, level: ApprovalLevel) => Promise<void>;
  respond: (approved: boolean) => Promise<void>;
  refreshToolSupport: () => Promise<void>;
  clearError: () => void;

  // Handlers de eventos del agente (ruteados por sesión → pestaña)
  onPlan: (conversationId: string, tasks: Task[]) => void;
  onStepResult: (result: StepResult) => void;
  onApprovalNeeded: (approval: PendingApproval) => void;
  onDone: (conversationId: string, summary: string) => void;
  onError: (conversationId: string, message: string) => void;
  onCancelled: (conversationId: string) => void;
}

function projectOfSession(
  tabs: Record<string, TabState>,
  sessionId: string,
): string | null {
  for (const [projectId, tab] of Object.entries(tabs)) {
    if (tab.sessionId === sessionId) return projectId;
  }
  return null;
}

type StoreSnapshot = Pick<WorkStore, "tabs" | "activeProjectId">;

function activeTab(s: StoreSnapshot): TabState | undefined {
  return s.activeProjectId ? s.tabs[s.activeProjectId] : undefined;
}

/** El payload trae las claves del `json!` de Rust (`exit_code`…), que no pasan
 *  por el `camelCase` de serde al ser un Value suelto. Y solo `run_command`
 *  manda data, así que lo demás vuelve null. */
function comando(data?: Record<string, unknown> | null): CommandData | null {
  if (!data || typeof data.command !== "string") return null;
  return {
    command: data.command,
    exitCode: typeof data.exit_code === "number" ? data.exit_code : null,
    stdout: typeof data.stdout === "string" ? data.stdout : "",
    stderr: typeof data.stderr === "string" ? data.stderr : "",
  };
}

export const useWorkStore = create<WorkStore>((set, get) => {
  const patchTab = (projectId: string, patch: Partial<TabState>) =>
    set((s) => {
      const tab = s.tabs[projectId];
      if (tab) return { tabs: { ...s.tabs, [projectId]: { ...tab, ...patch } } };
      // Sin pestaña abierta para ese proyecto: solo se monta si es la que el
      // usuario tiene delante. Crearla siempre haría que un evento tardío
      // resucitara una pestaña que ya cerró.
      if (projectId !== s.activeProjectId) return {};
      return { tabs: { ...s.tabs, [projectId]: { ...emptyTab(), ...patch } } };
    });

  const patchSession = (conversationId: string, patch: Partial<TabState>) => {
    const projectId = projectOfSession(get().tabs, conversationId);
    if (projectId) patchTab(projectId, patch);
  };

  const reloadMessages = (conversationId: string) => {
    void invoke<Message[]>("list_messages", { conversationId }).then(
      (messages) => patchSession(conversationId, { messages }),
    );
  };

  return {
    projects: [],
    activeProjectId: null,
    tabs: {},
    toolSupport: null,
    error: null,
    newProjectDraft: null,
    treeVersion: 0,

    loadProjects: async () => {
      const projects = await invoke<Project[]>("list_projects");
      set({ projects });
    },

    openProjectPicker: async () => {
      const dir = await open({ directory: true, title: "Abrir carpeta del proyecto" });
      if (!dir) return;
      const project = await invoke<Project>("open_project", { path: dir });
      await get().loadProjects();
      await get().selectProject(project.id);
    },

    startCreateProject: async () => {
      const dir = await open({ directory: true, title: "Elige dónde crear el proyecto" });
      if (!dir) return;
      set({ newProjectDraft: { parentPath: dir } });
    },

    confirmCreateProject: async (name) => {
      const draft = get().newProjectDraft;
      if (!draft || !name.trim()) return;
      const project = await invoke<Project>("create_project", {
        parentPath: draft.parentPath,
        name: name.trim(),
      });
      set({ newProjectDraft: null });
      await get().loadProjects();
      await get().selectProject(project.id);
    },

    cancelCreateProject: () => set({ newProjectDraft: null }),

    selectProject: async (id) => {
      if (!get().tabs[id]) {
        const convs = await invoke<Conversation[]>("list_conversations");
        const sessions = convs
          .filter((c) => c.projectId === id)
          .sort((a, b) => b.updatedAt - a.updatedAt);
        let tab = emptyTab();
        const project = get().projects.find((p) => p.id === id);
        if (project?.approvalLevel) tab.approvalLevel = project.approvalLevel;
        if (sessions.length > 0) {
          const [messages, tasks] = await Promise.all([
            invoke<Message[]>("list_messages", { conversationId: sessions[0].id }),
            invoke<Task[]>("get_tasks", { conversationId: sessions[0].id }),
          ]);
          tab = { ...tab, sessionId: sessions[0].id, messages, tasks };
        }
        // Sin sesiones no se crea una vacía: `startTask` la hace con el primer
        // mensaje. Abrir un proyecto no debe dejar filas sueltas en el historial.
        set((s) => ({ tabs: { ...s.tabs, [id]: tab } }));
        void get().refreshGit(id);
      }
      set({ activeProjectId: id, error: null });
      void get().refreshToolSupport();
    },

    closeTab: (id) => {
      set((s) => {
        const tabs = { ...s.tabs };
        delete tabs[id];
        const remaining = Object.keys(tabs);
        const activeProjectId =
          s.activeProjectId === id ? remaining[remaining.length - 1] ?? null : s.activeProjectId;
        return { tabs, activeProjectId };
      });
    },

    refreshGit: async (projectId) => {
      try {
        const git = await invoke<GitInfo>("project_git_info", { projectId });
        patchTab(projectId, { git });
      } catch {
        patchTab(projectId, { git: null });
      }
    },

    removeProject: async (id) => {
      await invoke("delete_project", { projectId: id });
      set((s) => {
        const tabs = { ...s.tabs };
        delete tabs[id];
        const remaining = Object.keys(tabs);
        const activeProjectId =
          s.activeProjectId === id ? remaining[remaining.length - 1] ?? null : s.activeProjectId;
        return { tabs, activeProjectId };
      });
      await get().loadProjects();
      // Las sesiones con historial sobreviven al proyecto como conversación.
      void useChatStore.getState().loadConversations();
    },

    setProjectPinned: async (id, pinned) => {
      // Se pinta al instante y se reordena en local; si el invoke falla, la
      // recarga devuelve la lista verdadera.
      const previa = get().projects;
      const tocados = previa.map((p) => (p.id === id ? { ...p, pinned } : p));
      set({
        projects: tocados.sort(
          (a, b) =>
            Number(b.pinned) - Number(a.pinned) || b.lastOpenedAt - a.lastOpenedAt,
        ),
      });
      try {
        await invoke("set_project_pinned", { projectId: id, pinned });
        await get().loadProjects();
      } catch {
        set({ projects: previa });
      }
    },

    newWorkSession: async (projectId) => {
      const tab = get().tabs[projectId];
      // Reutilizar la sesión en blanco: si la actual todavía no tiene ningún
      // mensaje, no se crea otra fila (evita acumular sesiones vacías al spammar "+").
      if (
        tab &&
        tab.sessionId &&
        tab.agentStatus === "idle" &&
        !tab.approval &&
        tab.messages.length === 0 &&
        tab.tasks.length === 0
      ) {
        set({ activeProjectId: projectId });
        return tab.sessionId;
      }
      const conv = await invoke<Conversation>("create_conversation", {
        title: "Sesión de trabajo",
        projectId,
      });
      patchTab(projectId, {
        sessionId: conv.id,
        messages: [],
        tasks: [],
        stepLines: [],
        agentStatus: "idle",
        approval: null,
        error: null,
      });
      set({ activeProjectId: projectId });
      void useChatStore.getState().loadConversations();
      return conv.id;
    },

    selectSession: async (conversationId) => {
      const convs = await invoke<Conversation[]>("list_conversations");
      const conv = convs.find((c) => c.id === conversationId);
      const projectId =
        projectOfSession(get().tabs, conversationId) ?? conv?.projectId ?? get().activeProjectId;
      if (!projectId) return;
      const [messages, tasks] = await Promise.all([
        invoke<Message[]>("list_messages", { conversationId }),
        invoke<Task[]>("get_tasks", { conversationId }),
      ]);
      patchTab(projectId, {
        sessionId: conversationId,
        messages,
        tasks,
        stepLines: [],
        agentStatus: "idle",
        error: null,
        approval: null,
      });
      set({ activeProjectId: projectId });
    },

    startTask: async (request) => {
      const { activeProjectId } = get();
      if (!activeProjectId) return;
      let sessionId = get().tabs[activeProjectId]?.sessionId ?? null;
      if (!sessionId) sessionId = await get().newWorkSession(activeProjectId);

      patchTab(activeProjectId, {
        agentStatus: "running",
        tasks: [],
        stepLines: [],
        error: null,
        messages: [
          ...get().tabs[activeProjectId]?.messages ?? [],
          {
            id: "pending-user",
            conversationId: sessionId,
            role: "user",
            content: request,
            provider: null,
            createdAt: Date.now(),
            attachments: [],
          },
        ],
      });

      try {
        await invoke("start_work_task", {
          conversationId: sessionId,
          projectId: activeProjectId,
          request,
        });
      } catch (e) {
        patchTab(activeProjectId, { agentStatus: "error", error: String(e) });
      }
    },

    cancelTask: async () => {
      const activeSessionId = activeTab(get())?.sessionId ?? null;
      if (!activeSessionId) return;
      try {
        await invoke("cancel_work_task", { conversationId: activeSessionId });
      } catch (e) {
        patchSession(activeSessionId, { agentStatus: "idle", error: String(e) });
      }
    },

    setApprovalLevel: async (projectId, level) => {
      await invoke("set_project_approval_level", { projectId, level });
      patchTab(projectId, { approvalLevel: level });
      set((s) => ({
        projects: s.projects.map((p) =>
          p.id === projectId ? { ...p, approvalLevel: level } : p,
        ),
      }));
    },

    respond: async (approved) => {
      const approval = activeTab(get())?.approval ?? null;
      if (!approval) return;
      await invoke("respond_to_approval", {
        toolCallId: approval.toolCallId,
        approved,
      });
      patchSession(approval.conversationId, {
        approval: null,
        agentStatus: "running",
      });
    },

    refreshToolSupport: async () => {
      try {
        const support = await invoke<boolean>("check_tool_support");
        set({ toolSupport: support });
      } catch {
        set({ toolSupport: null });
      }
    },

    clearError: () => {
      const projectId = get().activeProjectId;
      if (projectId) patchTab(projectId, { error: null, agentStatus: "idle" });
    },

    onPlan: (conversationId, tasks) => {
      patchSession(conversationId, { tasks, stepLines: [], agentStatus: "running" });
    },

    onStepResult: ({ conversationId, tasks, toolName, ok, brief, durationMs, data }) => {
      const projectId = projectOfSession(get().tabs, conversationId);
      if (!projectId) return;
      const tab = get().tabs[projectId];
      if (!tab) return;
      patchTab(projectId, {
        tasks,
        stepLines: [
          ...tab.stepLines,
          { toolName, ok, brief, durationMs, data: comando(data) },
        ].slice(-30),
      });
      if (toolName === "write_file" && ok) {
        set((s) => ({ treeVersion: s.treeVersion + 1 }));
        void get().refreshGit(projectId);
      }
    },

    onApprovalNeeded: (approval) => {
      patchSession(approval.conversationId, { approval, agentStatus: "awaiting" });
    },

    onDone: (conversationId) => {
      patchSession(conversationId, { agentStatus: "idle" });
      reloadMessages(conversationId);
      void useChatStore.getState().loadConversations();
    },

    onError: (conversationId, message) => {
      patchSession(conversationId, { agentStatus: "error", error: message });
      reloadMessages(conversationId);
      void useChatStore.getState().loadConversations();
    },

    onCancelled: (conversationId) => {
      patchSession(conversationId, { agentStatus: "idle", approval: null });
      reloadMessages(conversationId);
      void useChatStore.getState().loadConversations();
    },
  };
});

/**
 * Pestaña del proyecto activo. Los datos de la sesión se leen SIEMPRE desde aquí:
 * zustand fusiona el estado con `Object.assign({}, state, patch)`, y eso lee los
 * getters una sola vez y los deja como valores congelados en el nuevo objeto.
 * Tener `messages`/`tasks`/`agentStatus` como getters del store hacía que la vista
 * de trabajo se quedara mirando la foto vacía del arranque para siempre.
 */
export const useActiveTab = (): TabState | undefined =>
  useWorkStore((s) => (s.activeProjectId ? s.tabs[s.activeProjectId] : undefined));
