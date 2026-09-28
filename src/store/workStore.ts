import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { proximaDeCola } from "../cola";
import { useChatStore } from "./chatStore";
import type {
  ApprovalLevel,
  CommandData,
  Conversation,
  Message,
  PendingApproval,
  Project,
  StepLine,
  Task,
} from "../types";

export type AgentStatus = "idle" | "running" | "awaiting" | "error";

export type { CommandData, StepLine };

/** Payload del evento `agent:step_result`. */
export interface StepResult {
  conversationId: string;
  tasks: Task[];
  toolName: string;
  ok: boolean;
  brief: string;
  durationMs: number;
  creado?: boolean;
  data?: Record<string, unknown> | null;
  diff?: string | null;
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
  /** Plan esperando que el usuario lo revise antes de ejecutarse. */
  planReview: PlanReview | null;
  error: string | null;
  git: GitInfo | null;
  approvalLevel: ApprovalLevel;
  /** Tareas escritas mientras el agente trabaja. Se lanzan una tras otra, así
   *  que se puede dejar el proyecto encadenando pasos y volver a verlos hechos. */
  cola: string[];
  /** La cadena se para sola si la tarea anterior acabó mal o se canceló: reanudar
   *  es decisión de uno, no algo que la app haga por su cuenta. */
  colaEnPausa: boolean;
}

/** Lo que trae `agent:plan_review`: el id que hay que devolver y los pasos tal
 *  como los propuso el modelo, que es lo que se edita en la lista. */
export interface PlanReview {
  conversationId: string;
  planId: string;
  pasos: string[];
}

const emptyTab = (): TabState => ({
  sessionId: null,
  messages: [],
  tasks: [],
  stepLines: [],
  agentStatus: "idle",
  approval: null,
  planReview: null,
  error: null,
  git: null,
  approvalLevel: "approve_for_me",
  cola: [],
  colaEnPausa: false,
});

interface WorkStore {
  projects: Project[];
  activeProjectId: string | null;
  tabs: Record<string, TabState>;
  toolSupport: boolean | null;
  error: string | null;
  newProjectDraft: true | null;
  treeVersion: number;

  loadProjects: () => Promise<void>;
  openProjectPicker: () => Promise<void>;
  /** Abre una carpeta ya existente como proyecto: la del selector o la soltada. */
  openProjectPath: (path: string) => Promise<void>;
  startCreateProject: () => void;
  confirmCreateProject: (name: string, parentPath: string) => Promise<void>;
  cancelCreateProject: () => void;
  selectProject: (id: string) => Promise<void>;
  closeTab: (id: string) => void;
  refreshGit: (projectId: string) => Promise<void>;
  removeProject: (id: string) => Promise<void>;
  setProjectPinned: (id: string, pinned: boolean) => Promise<void>;
  newWorkSession: (projectId: string) => Promise<string>;
  selectSession: (conversationId: string) => Promise<void>;
  /** `projectId` se pasa al lanzar desde la cola: no debe cambiar la pestaña que
   *  se está mirando. */
  startTask: (request: string, projectId?: string) => Promise<void>;
  cancelTask: () => Promise<void>;
  /** Apunta una tarea para cuando termine la que está en curso. */
  encolarTarea: (texto: string) => void;
  quitarDeCola: (projectId: string, indice: number) => void;
  /** Lanza la siguiente de la cola si esa sesión quedó libre. */
  seguirConLaCola: (projectId: string) => void;
  /** Quita la pausa que dejaron un fallo o un cancelar, y sigue. */
  reanudarCola: (projectId: string) => void;
  setApprovalLevel: (projectId: string, level: ApprovalLevel) => Promise<void>;
  respond: (approved: boolean) => Promise<void>;
  refreshToolSupport: () => Promise<void>;
  clearError: () => void;

  // Handlers de eventos del agente (ruteados por sesión → pestaña)
  onPlan: (conversationId: string, tasks: Task[]) => void;
  onStepResult: (result: StepResult) => void;
  onApprovalNeeded: (approval: PendingApproval) => void;
  onReasoning: (conversationId: string, text: string) => void;
  onPlanReview: (review: PlanReview) => void;
  confirmPlan: (pasos?: string[]) => Promise<void>;
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

/** El retardo corto con el que arranca la siguiente de la cola. Se guarda por
 *  proyecto para poder cortarlo al cerrar la pestaña: suelto, lanzaría una tarea
 *  contra una sesión que ya nadie está mirando. */
const temporizadoresCola: Record<string, number> = {};

function cortandoCola(projectId: string) {
  const pendiente = temporizadoresCola[projectId];
  if (pendiente) {
    window.clearTimeout(pendiente);
    delete temporizadoresCola[projectId];
  }
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

/** Lo que devuelve `session_trace`: los pasos guardados, ya repartidos entre las
 *  respuestas del agente. */
interface TrazaMensaje {
  messageId: string;
  pasos: StepLine[];
}

/** Mensajes de una sesión con su traza puesta. Al ejecutar, la traza vive en la
 *  memoria del pestaña; al volver a abrir la sesión no queda nada de eso, así que
 *  se reconstruye desde `tool_calls`. Sin este paso cerrar y abrir una sesión de
 *  trabajo borraba lo que había hecho el agente. */
async function mensajesConTraza(conversationId: string): Promise<Message[]> {
  const [messages, trazas] = await Promise.all([
    invoke<Message[]>("list_messages", { conversationId }),
    invoke<TrazaMensaje[]>("session_trace", { conversationId }).catch(
      () => [] as TrazaMensaje[],
    ),
  ]);
  if (trazas.length === 0) return messages;
  const porMensaje = new Map(trazas.map((t) => [t.messageId, t.pasos]));
  return messages.map((m) => {
    const pasos = porMensaje.get(m.id);
    if (!pasos || pasos.length === 0) return m;
    return {
      ...m,
      steps: pasos.map((p) => ({ ...p, data: comando(p.data as Record<string, unknown> | null) })),
    };
  });
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
    void mensajesConTraza(conversationId).then((messages) =>
      patchSession(conversationId, { messages }),
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
      await get().openProjectPath(dir);
    },

    openProjectPath: async (path) => {
      try {
        const project = await invoke<Project>("open_project", { path });
        await get().loadProjects();
        await get().selectProject(project.id);
        useChatStore.getState().setView("work");
      } catch (e) {
        set({ error: String(e) });
      }
    },

    startCreateProject: () => set({ newProjectDraft: true }),

    confirmCreateProject: async (name, parentPath) => {
      const project = await invoke<Project>("create_project", {
        parentPath,
        name: name.trim(),
      });
      set({ newProjectDraft: null });
      await get().loadProjects();
      await get().selectProject(project.id);
      useChatStore.getState().setView("work");
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
      cortandoCola(id);
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
      cortandoCola(id);
      set((s) => {
        const tabs = { ...s.tabs };
        delete tabs[id];
        const remaining = Object.keys(tabs);
        const activeProjectId =
          s.activeProjectId === id ? remaining[remaining.length - 1] ?? null : s.activeProjectId;
        return { tabs, activeProjectId };
      });
      await get().loadProjects();
      // Quitar el proyecto se lleva sus sesiones puestas; la recarga solo
      // limpia de la lista las que ya no existen en SQLite.
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
        planReview: null,
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
        mensajesConTraza(conversationId),
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
        // Sin esto, el plan que esperaba en la sesión anterior se queda flotando
        // encima de la que se acaba de abrir.
        planReview: null,
      });
      set({ activeProjectId: projectId });
    },

    startTask: async (request, projectId) => {
      const pid = projectId ?? get().activeProjectId;
      if (!pid) return;
      // Todo el cuerpo va dentro del `try`: lanzar desde la cola quita primero el
      // texto de la lista, y si esto reventaba a medias la tarea desaparecía sin
      // dejar ni rastro ni aviso.
      try {
        let sessionId = get().tabs[pid]?.sessionId ?? null;
        if (!sessionId) sessionId = await get().newWorkSession(pid);

        patchTab(pid, {
          agentStatus: "running",
          tasks: [],
          stepLines: [],
          error: null,
          // Arrancar una tarea a mano reanuda la cola; que lo haga la propia cola
          // no debe borrar una pausa que él puso.
          ...(projectId ? {} : { colaEnPausa: false }),
          messages: [
            ...get().tabs[pid]?.messages ?? [],
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

        await invoke("start_work_task", {
          conversationId: sessionId,
          projectId: pid,
          request,
        });
      } catch (e) {
        patchTab(pid, { agentStatus: "error", error: String(e) });
      }
    },

    encolarTarea: (texto) => {
      const pid = get().activeProjectId;
      const tab = pid ? get().tabs[pid] : null;
      const limpio = texto.trim();
      if (!pid || !tab || !limpio) return;
      // No se quita la pausa: apuntar una tarea mientras la cadena está parada es
      // preparar el siguiente paso, no ordenar que arranque.
      patchTab(pid, { cola: [...tab.cola, limpio] });
    },

    quitarDeCola: (projectId, indice) => {
      const tab = get().tabs[projectId];
      if (!tab) return;
      patchTab(projectId, { cola: tab.cola.filter((_, i) => i !== indice) });
    },

    seguirConLaCola: (projectId) => {
      const tab = get().tabs[projectId];
      if (!tab) return;
      // La regla vive en `cola.ts` para poder probarla sin Tauri delante.
      const siguiente = proximaDeCola(tab);
      if (!siguiente) return;
      // Se corta el retardo pendiente: si no, un «Seguir con la cola» a mano y el
      // que puso `onDone` lanzarían la misma tarea dos veces.
      cortandoCola(projectId);
      patchTab(projectId, { cola: tab.cola.slice(1) });
      void get().startTask(siguiente, projectId);
    },

    reanudarCola: (projectId) => {
      patchTab(projectId, { colaEnPausa: false });
      get().seguirConLaCola(projectId);
    },

    cancelTask: async () => {
      const activeSessionId = activeTab(get())?.sessionId ?? null;
      if (!activeSessionId) return;
      try {
        await invoke("cancel_work_task", { conversationId: activeSessionId });
      } catch (e) {
        // El backend dice que no queda nada en curso: los mandos abiertos sobre
        // esa sesión sobran, y dejarlos sería una pantalla bloqueada sin tarea.
        patchSession(activeSessionId, {
          agentStatus: "idle",
          error: String(e),
          approval: null,
          planReview: null,
        });
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
      // Se quita la aprobación ANTES del viaje: si el `invoke` falla (la tarea ya
      // murió, el id caducó) el mando se habría quedado para siempre pidiendo una
      // respuesta que ya nadie espera.
      patchSession(approval.conversationId, { approval: null });
      try {
        await invoke("respond_to_approval", {
          toolCallId: approval.toolCallId,
          approved,
        });
        patchSession(approval.conversationId, { agentStatus: "running" });
      } catch (e) {
        patchSession(approval.conversationId, {
          agentStatus: "error",
          error: String(e),
          colaEnPausa: true,
        });
      }
    },

    onPlanReview: (review) => {
      patchSession(review.conversationId, {
        planReview: review,
        agentStatus: "awaiting",
      });
    },

    /** Confirmar el plan, con los pasos tal cual o ya editados. */
    confirmPlan: async (pasos) => {
      const review = activeTab(get())?.planReview ?? null;
      if (!review) return;
      const validos = pasos?.length ? pasos : review.pasos;
      // Igual que con la aprobación: la revisión se quita primero. Un fallo del
      // `invoke` habría dejado el modal abierto sobre una tarea que ya no existe.
      patchSession(review.conversationId, { planReview: null });
      try {
        await invoke("respond_plan_review", {
          planId: review.planId,
          steps: validos,
        });
        patchSession(review.conversationId, { agentStatus: "running" });
      } catch (e) {
        patchSession(review.conversationId, {
          agentStatus: "error",
          error: String(e),
          colaEnPausa: true,
        });
      }
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
      if (!projectId) return;
      const tab = get().tabs[projectId];
      if (!tab) return;
      // Solo se baja el estado cuando estaba en error: ponerlo a `idle` porque sí
      // dejaba la app dando el agente por acabado mientras seguía escribiendo
      // archivos, y con ello un segundo arranque sobre la misma carpeta.
      patchTab(projectId, {
        error: null,
        ...(tab.agentStatus === "error" ? { agentStatus: "idle" as AgentStatus } : {}),
      });
    },

    onPlan: (conversationId, tasks) => {
      patchSession(conversationId, { tasks, stepLines: [], agentStatus: "running" });
    },

    onStepResult: ({
      conversationId,
      tasks,
      toolName,
      ok,
      brief,
      durationMs,
      creado,
      data,
      diff,
    }) => {
      const projectId = projectOfSession(get().tabs, conversationId);
      if (!projectId) return;
      const tab = get().tabs[projectId];
      if (!tab) return;
      patchTab(projectId, {
        tasks,
        stepLines: [
          ...tab.stepLines,
          { toolName, ok, brief, durationMs, creado, data: comando(data), diff },
        ].slice(-30),
      });
      if ((toolName === "write_file" || toolName === "generate_image") && ok) {
        // El árbol se vuelve a leer: el archivo new (escrito o dibujado) ya está
        // en el disco y si no, la vista queda mintiendo hasta el siguiente paso.
        set((s) => ({ treeVersion: s.treeVersion + 1 }));
        void get().refreshGit(projectId);
      }
    },

    onApprovalNeeded: (approval) => {
      patchSession(approval.conversationId, { approval, agentStatus: "awaiting" });
    },

    onReasoning: (conversationId, text) => {
      const projectId = projectOfSession(get().tabs, conversationId);
      if (!projectId) return;
      const tab = get().tabs[projectId];
      if (!tab) return;
      patchTab(projectId, {
        stepLines: [
          ...tab.stepLines,
          { toolName: "razonamiento", ok: true, brief: "", durationMs: 0, reasoning: text },
        ].slice(-30),
      });
    },

    onDone: (conversationId) => {
      patchSession(conversationId, {
        agentStatus: "idle",
        approval: null,
        planReview: null,
      });
      reloadMessages(conversationId);
      void useChatStore.getState().loadConversations();
      // La cola sigue sola —para eso se dejó escrita. Sale en un retardo corto
      // para que el resumen de la tarea anterior termine de llegar antes de que
      // la siguiente empiece a escribir en la misma sesión.
      const pid = projectOfSession(get().tabs, conversationId);
      if (pid) {
        cortandoCola(pid);
        temporizadoresCola[pid] = window.setTimeout(
          () => {
            delete temporizadoresCola[pid];
            get().seguirConLaCola(pid);
          },
          400,
        );
      }
    },

    onError: (conversationId, message) => {
      const pid = projectOfSession(get().tabs, conversationId);
      const tab = pid ? get().tabs[pid] : null;
      // Con una tarea a medias no se encadena la siguiente: lo más probable es
      // que cuente con lo que la anterior no llegó a hacer.
      if (pid && tab && tab.cola.length > 0) patchTab(pid, { colaEnPausa: true });
      // Y se quitan lo que estaba esperando: un fallo con el modal de aprobación
      // o el de revisión del plan delante dejaba la pantalla bloqueada para
      // siempre, sin botón que la desatrase.
      patchSession(conversationId, {
        agentStatus: "error",
        error: message,
        approval: null,
        planReview: null,
      });
      reloadMessages(conversationId);
      void useChatStore.getState().loadConversations();
    },

    onCancelled: (conversationId) => {
      const pid = projectOfSession(get().tabs, conversationId);
      // Quien cancela una tarea no espera que arranque otra detrás.
      if (pid) {
        cortandoCola(pid);
        patchTab(pid, { colaEnPausa: true });
      }
      patchSession(conversationId, {
        agentStatus: "idle",
        approval: null,
        planReview: null,
      });
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
