import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useChatStore } from "./chatStore";
import type {
  Conversation,
  Message,
  PendingApproval,
  Project,
  Task,
} from "../types";

export type AgentStatus = "idle" | "running" | "awaiting" | "error";

interface StepLine {
  toolName: string;
  ok: boolean;
  brief: string;
}

interface WorkStore {
  projects: Project[];
  activeProjectId: string | null;
  activeSessionId: string | null;
  messages: Message[];
  tasks: Task[];
  stepLines: StepLine[];
  agentStatus: AgentStatus;
  approval: PendingApproval | null;
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
  removeProject: (id: string) => Promise<void>;
  newWorkSession: (projectId: string) => Promise<string>;
  selectSession: (conversationId: string) => Promise<void>;
  startTask: (request: string) => Promise<void>;
  cancelTask: () => Promise<void>;
  respond: (approved: boolean) => Promise<void>;
  refreshToolSupport: () => Promise<void>;
  clearError: () => void;

  // Handlers de eventos del agente
  onPlan: (conversationId: string, tasks: Task[]) => void;
  onStepResult: (
    conversationId: string,
    tasks: Task[],
    toolName: string,
    ok: boolean,
    brief: string,
  ) => void;
  onApprovalNeeded: (approval: PendingApproval) => void;
  onDone: (conversationId: string, summary: string) => void;
  onError: (conversationId: string, message: string) => void;
  onCancelled: (conversationId: string) => void;
}

export const useWorkStore = create<WorkStore>((set, get) => ({
  projects: [],
  activeProjectId: null,
  activeSessionId: null,
  messages: [],
  tasks: [],
  stepLines: [],
  agentStatus: "idle",
  approval: null,
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
    const convs = await invoke<Conversation[]>("list_conversations");
    const sessions = convs
      .filter((c) => c.projectId === id)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    set({
      activeProjectId: id,
      error: null,
      approval: null,
      stepLines: [],
    });
    if (sessions.length > 0) {
      await get().selectSession(sessions[0].id);
    } else {
      await get().newWorkSession(id);
    }
    void get().refreshToolSupport();
  },

  removeProject: async (id) => {
    await invoke("delete_project", { projectId: id });
    if (get().activeProjectId === id) {
      set({ activeProjectId: null, activeSessionId: null, messages: [], tasks: [] });
    }
    await get().loadProjects();
  },

  newWorkSession: async (projectId) => {
    const conv = await invoke<Conversation>("create_conversation", {
      title: "Sesión de trabajo",
      projectId,
    });
    set({
      activeProjectId: projectId,
      activeSessionId: conv.id,
      messages: [],
      tasks: [],
      stepLines: [],
      agentStatus: "idle",
      error: null,
    });
    return conv.id;
  },

  selectSession: async (conversationId) => {
    const [messages, tasks] = await Promise.all([
      invoke<Message[]>("list_messages", { conversationId }),
      invoke<Task[]>("get_tasks", { conversationId }),
    ]);
    const convs = await invoke<Conversation[]>("list_conversations");
    const conv = convs.find((c) => c.id === conversationId);
    set({
      activeSessionId: conversationId,
      activeProjectId: conv?.projectId ?? get().activeProjectId,
      messages,
      tasks,
      stepLines: [],
      agentStatus: "idle",
      error: null,
      approval: null,
    });
  },

  startTask: async (request) => {
    const { activeSessionId, activeProjectId } = get();
    if (!activeProjectId) return;
    const sessionId =
      activeSessionId ?? (await get().newWorkSession(activeProjectId));

    set({
      agentStatus: "running",
      tasks: [],
      stepLines: [],
      error: null,
      messages: [
        ...get().messages,
        {
          id: "pending-user",
          conversationId: sessionId,
          role: "user",
          content: request,
          provider: null,
          createdAt: Date.now(),
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
      set({ agentStatus: "error", error: String(e) });
    }
  },

  cancelTask: async () => {
    const { activeSessionId } = get();
    if (!activeSessionId) return;
    try {
      await invoke("cancel_work_task", { conversationId: activeSessionId });
    } catch (e) {
      set({ agentStatus: "idle", error: String(e) });
    }
  },

  respond: async (approved) => {
    const approval = get().approval;
    if (!approval) return;
    await invoke("respond_to_approval", {
      toolCallId: approval.toolCallId,
      approved,
    });
    set({ approval: null, agentStatus: "running" });
  },

  refreshToolSupport: async () => {
    try {
      const support = await invoke<boolean>("check_tool_support");
      set({ toolSupport: support });
    } catch {
      set({ toolSupport: null });
    }
  },

  clearError: () => set({ error: null, agentStatus: "idle" }),

  onPlan: (conversationId, tasks) => {
    if (conversationId !== get().activeSessionId) return;
    set({ tasks, stepLines: [], agentStatus: "running" });
  },

  onStepResult: (conversationId, tasks, toolName, ok, brief) => {
    if (conversationId !== get().activeSessionId) return;
    set((s) => ({
      tasks,
      stepLines: [...s.stepLines, { toolName, ok, brief }].slice(-30),
      treeVersion:
        toolName === "write_file" && ok ? s.treeVersion + 1 : s.treeVersion,
    }));
  },

  onApprovalNeeded: (approval) => {
    if (approval.conversationId !== get().activeSessionId) return;
    set({ approval, agentStatus: "awaiting" });
  },

  onDone: (conversationId) => {
    if (conversationId !== get().activeSessionId) return;
    set({ agentStatus: "idle" });
    void invoke<Message[]>("list_messages", { conversationId }).then((messages) =>
      set({ messages }),
    );
    void useChatStore.getState().loadConversations();
  },

  onError: (conversationId, message) => {
    if (conversationId !== get().activeSessionId) return;
    set({ agentStatus: "error", error: message });
    void invoke<Message[]>("list_messages", { conversationId }).then((messages) =>
      set({ messages }),
    );
    void useChatStore.getState().loadConversations();
  },

  onCancelled: (conversationId) => {
    if (conversationId !== get().activeSessionId) return;
    set({ agentStatus: "idle", approval: null });
    void invoke<Message[]>("list_messages", { conversationId }).then((messages) =>
      set({ messages }),
    );
    void useChatStore.getState().loadConversations();
  },
}));
