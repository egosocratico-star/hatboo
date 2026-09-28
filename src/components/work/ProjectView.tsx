import { t } from "../../i18n";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  AlertCircle,
  AlertTriangle,
  ArrowUp,
  BookOpen,
  ChevronDown,
  FlaskConical,
  FolderOpen,
  GitCompare,
  Paperclip,
  Search,
  Square,
  X,
  FolderTree,
  GitBranch,
  ListChecks,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  Plus,
  type LucideIcon,
} from "lucide-react";
import { useWorkStore, useActiveTab, type StepLine } from "../../store/workStore";
import { nivelPorNombre } from "../../modelo";
import { useChatStore } from "../../store/chatStore";
import MessageBubble from "../MessageBubble";
import Mascot from "../mascot/Mascot";
import Dots from "../Dots";
import SuggestionGrid, { type Sugerencia } from "../SuggestionGrid";
import FileTree from "./FileTree";
import AgentTrace from "./AgentTrace";
import FileCards from "./FileCards";
import ResizeHandle from "./ResizeHandle";
import TaskList from "./TaskList";
import ToolApprovalModal from "./ToolApprovalModal";
import PlanReviewModal from "./PlanReviewModal";
import ApprovalLevelPicker from "./ApprovalLevelPicker";
import ProjectRules from "./ProjectRules";
import SessionChanges from "./SessionChanges";
import { ProyectoSwitcher, SesionSwitcher } from "./Switchers";
import LayerChips from "./LayerChips";
import WorkPlusMenu from "./WorkPlusMenu";
import ModeToggles from "../ModeToggles";
import { useSoltados } from "../../hooks/useSoltados";
import ProviderModelPicker from "../ProviderModelPicker";
import { PANEL_WIDTHS, type Attachment, type MascotState, type Message, type Task } from "../../types";

/** OneDrive no es un sitio malo para tener un proyecto: es un sitio donde otro
 *  programa mueve archivos mientras el agente escribe. Se avisa, no se prohíbe. */
function estaEnOneDrive(ruta: string) {
  return /onedrive/i.test(ruta);
}

/** Panel oculto a mano. Deja un riel de 26 px con el icono para que volver a
 *  abrirlo no dependa de los botones de la cabecera, que es lo que hacía que
 *  «Ocultar los archivos» pareciera un botón roto: el panel se iba y no quedaba
 *  nada donde antes estaba. Llevaba el nombre escrito en vertical; en un riel así
 *  se leía como un fallo de maquetación, así que el nombre se queda en el tooltip. */
function Riel({
  Icono,
  etiqueta,
  lado,
  onAbrir,
}: {
  Icono: LucideIcon;
  etiqueta: string;
  lado: "izquierda" | "derecha";
  onAbrir: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onAbrir}
      title={t("Mostrar {e}", { e: etiqueta })}
      aria-label={t("Mostrar {e}", { e: etiqueta })}
      className={`flex w-[26px] shrink-0 items-start justify-center bg-base-raised pt-2.5 text-zinc-600 transition-colors hover:bg-base-hover hover:text-accent-soft ${
        lado === "izquierda" ? "border-r" : "border-l"
      } border-base-border`}
    >
      <Icono className="h-3.5 w-3.5 shrink-0" />
    </button>
  );
}

/** Cinta de aviso: una línea, no una caja. Antes había hasta tres cajas
 *  apiladas bajo la cabecera, cada una con su borde y su fondo, y pesaban más
 *  que el proyecto. */
function Cinta({
  tono,
  children,
}: {
  tono: "aviso" | "peligro";
  children: ReactNode;
}) {
  return (
    <div
      className={`flex shrink-0 items-start gap-2 border-b px-4 py-1.5 text-[11px] leading-snug ${
        tono === "peligro"
          ? "border-red-500/20 bg-red-500/[0.06] text-red-300/90"
          : "border-amber-500/20 bg-amber-500/[0.05] text-amber-300/90"
      }`}
    >
      {children}
    </div>
  );
}

/** Constantes estables: si no hay pestaña, devolver un array nuevo en cada render
 *  re-renderizaría las listas hijas sin motivo. */
const NO_MESSAGES: Message[] = [];
const NO_TASKS: Task[] = [];
const NO_STEPS: StepLine[] = [];
const NO_COLA: string[] = [];

/** En español a pelo y traducidas al pintar: una constante de módulo se evalúa al
 *  importar, antes de conocer el idioma guardado. */
const TASK_SUGGESTIONS: Sugerencia[] = [
  { texto: "Explícame qué hace este proyecto", icono: BookOpen },
  { texto: "Busca en los archivos dónde se define X", icono: Search },
  { texto: "Resume los cambios sin commitear", icono: GitCompare },
  { texto: "Añade pruebas a lo último que toqué", icono: FlaskConical },
];

/** Los cinco iconos de la derecha y los tres toggles miden lo mismo (26 px): en
 *  la misma fila, cualquier diferencia de alto se ve como un desalineado. */
const panelToggle = (open: boolean) =>
  `grid h-[26px] w-[26px] shrink-0 place-items-center rounded-md transition-colors ${
    open
      ? "text-accent-soft bg-accent/10 hover:bg-accent/20"
      : "text-zinc-500 hover:bg-base-hover hover:text-zinc-200"
  }`;

/**
 * Segundos de tarea en marcha. Va en un componente aparte, con su propio
 * intervalo: dejando el cronómetro en el panel, cada segundo re-renderizaba el
 * árbol de archivos y la lista de tareas entera. Se monta con la tarea y se va
 * con ella.
 */
function Cronometro() {
  const inicio = useRef(Date.now());
  const [seg, setSeg] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSeg(Math.floor((Date.now() - inicio.current) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  if (seg <= 0) return null;
  return <span className="tabular-nums text-zinc-500">{seg} s</span>;
}

export default function ProjectView() {
  const project = useWorkStore((s) =>
    s.projects.find((p) => p.id === s.activeProjectId) ?? null,
  );
  const tab = useActiveTab();
  const messages = tab?.messages ?? NO_MESSAGES;
  const tasks = tab?.tasks ?? NO_TASKS;
  const stepLines = tab?.stepLines ?? NO_STEPS;
  const cola = tab?.cola ?? NO_COLA;
  const colaEnPausa = tab?.colaEnPausa ?? false;
  const agentStatus = tab?.agentStatus ?? "idle";
  const toolSupport = useWorkStore((s) => s.toolSupport);
  const error = tab?.error ?? null;
  const treeVersion = useWorkStore((s) => s.treeVersion);
  const git = tab?.git ?? null;
  const approvalLevel = tab?.approvalLevel ?? "approve_for_me";
  const busy = agentStatus === "running" || agentStatus === "awaiting";
  const startTask = useWorkStore((s) => s.startTask);
  const encolarTarea = useWorkStore((s) => s.encolarTarea);
  const quitarDeCola = useWorkStore((s) => s.quitarDeCola);
  const reanudarCola = useWorkStore((s) => s.reanudarCola);
  const openProjectPicker = useWorkStore((s) => s.openProjectPicker);
  const startCreateProject = useWorkStore((s) => s.startCreateProject);
  const cancelTask = useWorkStore((s) => s.cancelTask);
  const clearError = useWorkStore((s) => s.clearError);
  const refreshGit = useWorkStore((s) => s.refreshGit);

  const activeProjectId = useWorkStore((s) => s.activeProjectId);
  const tabs = useWorkStore((s) => s.tabs);

  // Borrador por sesión de trabajo, en el store y en disco: cambiar de pestaña
  // o cerrar la ventana ya no deja en blanco lo escrito a medias.
  const claveBorrador =
    tabs[activeProjectId ?? ""]?.sessionId ?? activeProjectId ?? "nueva";
  const input = useChatStore((s) => s.drafts[claveBorrador] ?? "");
  const setDraft = useChatStore((s) => s.setDraft);
  const setInput = (value: string) => setDraft(claveBorrador, value);
  const focus = useChatStore((s) => s.settings?.focusMode ?? false);
  const storedFilesOpen = useChatStore((s) => s.settings?.filesPanelOpen ?? true);
  const storedTasksOpen = useChatStore((s) => s.settings?.tasksPanelOpen ?? true);
  const filesWidth = useChatStore((s) => s.settings?.filesPanelWidth ?? PANEL_WIDTHS.files.def);
  const tasksWidth = useChatStore((s) => s.settings?.tasksPanelWidth ?? PANEL_WIDTHS.tasks.def);
  const patchSettings = useChatStore((s) => s.patchSettings);
  const proveedor = useChatStore((s) => s.settings?.activeProvider ?? "local");
  const modeloLocal = useChatStore((s) => s.settings?.localModel ?? "");
  const setSettingsCat = useChatStore((s) => s.setSettingsCat);
  const setView = useChatStore((s) => s.setView);
  /** Un modelo de chat no sostiene el modo trabajo: mejor decirlo antes de que
   *  la tarea «se haga» inventando el archivo en el chat. */
  const modeloCorto = proveedor === "local" && nivelPorNombre(modeloLocal) === "chat";
  // El ancho se mueve en estado local durante el arrastre y se guarda al soltar:
  // escribir en SQLite en cada pointermove saldría carísimo.
  const [dragFiles, setDragFiles] = useState<number | null>(null);
  const [dragTasks, setDragTasks] = useState<number | null>(null);
  // El modo foco manda sobre los paneles, pero tocar cualquiera de sus botones
  // lo apaga: si no, el control quedaría sin efecto visible.
  const filesOpen = !focus && storedFilesOpen;
  const tasksOpen = !focus && storedTasksOpen;
  const filesPx = dragFiles ?? filesWidth;
  const tasksPx = dragTasks ?? tasksWidth;
  const [happy, setHappy] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  /** Lo que falló al meter un archivo del árbol en el mensaje. Se dice aquí, que
   *  es donde se pulsó, en vez de perderse en un aviso que pasa. */
  const [avisoAdjunto, setAvisoAdjunto] = useState<string | null>(null);

  /** Pinchar un archivo del árbol lo añade al mensaje por la misma vía que los
   *  adjuntos del «+»: `read_attachment` con la ruta absoluta del proyecto. */
  const anadirAlContexto = async (ruta: string, nombre: string) => {
    if (!project) return;
    setAvisoAdjunto(null);
    const absoluta = `${project.rootPath.replace(/[\\/]+$/, "")}/${ruta}`;
    try {
      const adjunto = await invoke<Attachment>("read_attachment", { path: absoluta });
      setAttachments((prev) =>
        prev.some((a) => a.name === nombre && a.text.length === adjunto.text.length)
          ? prev
          : [...prev, adjunto],
      );
    } catch (e) {
      setAvisoAdjunto(String(e));
    }
  };
  const bottomRef = useRef<HTMLDivElement>(null);
  // Lo que se suelta sobre la ventana llega al mensaje, igual que en el chat. Con
  // `false`: el agente trabaja con archivos, las imágenes se descartan con aviso.
  useSoltados(
    (lista) => setAttachments((prev) => [...prev, ...lista]),
    (texto) => setAvisoAdjunto(texto),
    false,
  );
  const taskRef = useRef<HTMLTextAreaElement>(null);
  const prevStatus = useRef(agentStatus);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [lejos, setLejos] = useState(false);
  const pinnedRef = useRef(true);

  const onScrollHilo = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const d = el.scrollHeight - el.scrollTop - el.clientHeight;
    pinnedRef.current = d < 140;
    setLejos(d > 480);
  };

  const bajar = () => {
    const el = scrollerRef.current;
    if (!el) return;
    pinnedRef.current = true;
    setLejos(false);
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  /** Inserta una plantilla en el cursor, no al final del texto ya escrito. */
  const insertTemplate = (text: string) => {
    const el = taskRef.current;
    const from = el?.selectionStart ?? input.length;
    const to = el?.selectionEnd ?? input.length;
    const before = input.slice(0, from);
    const glue = before && !/\s$/.test(before) ? " " : "";
    setInput(before + glue + text + input.slice(to));
    const caret = before.length + glue.length + text.length;
    requestAnimationFrame(() => {
      if (!taskRef.current) return;
      taskRef.current.focus();
      taskRef.current.setSelectionRange(caret, caret);
    });
  };

  useEffect(() => {
    // Solo sigue el final si el usuario no ha subido a leer la traza.
    if (pinnedRef.current) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, tasks, stepLines]);

  // Al cambiar de pestaña la lista vuelve arriba: seguir el final vuelve a tener
  // sentido y el botón de bajar no pinta nada ahí.
  useEffect(() => {
    pinnedRef.current = true;
    setLejos(false);
  }, [activeProjectId]);

  // Al terminar una tarea (o escribir archivos), refrescamos el estado git.
  useEffect(() => {
    if (activeProjectId && agentStatus === "idle") void refreshGit(activeProjectId);
  }, [activeProjectId, agentStatus, treeVersion, refreshGit]);

  useEffect(() => {
    if (prevStatus.current === "running" && agentStatus === "idle") {
      setHappy(true);
      const temporizador = setTimeout(() => setHappy(false), 3000);
      prevStatus.current = agentStatus;
      return () => clearTimeout(temporizador);
    }
    prevStatus.current = agentStatus;
  }, [agentStatus]);

  const mascotState: MascotState =
    agentStatus === "error"
      ? "confused"
      : agentStatus === "awaiting"
        ? "surprised"
        : agentStatus === "running"
          ? // El agente no está pensando quieto: está moviéndose por la carpeta.
            "running"
          : happy
            ? "happy"
            : "idle";

  /** Lanza un pedido: a la cola si hay una tarea en curso, al agente si no. Es
   *  el mismo camino para lo que se escribe abajo y para el «Reintentar» del
   *  panel de tareas, que antes no tenía forma de pedir nada. */
  const lanzar = async (pedido: string) => {
    if (agentStatus === "running" || agentStatus === "awaiting") {
      encolarTarea(pedido);
      return;
    }
    clearError();
    try {
      await startTask(pedido);
    } catch (e) {
      useWorkStore.getState().onError(
        useWorkStore.getState().tabs[activeProjectId ?? ""]?.sessionId ?? "",
        String(e),
      );
    }
  };

  const submit = async () => {
    const text = input.trim();
    if (!text && attachments.length === 0) return;
    const sent = attachments;
    setInput("");
    setAttachments([]);
    setAvisoAdjunto(null);
    // El agente no tiene adjuntos como el chat: el texto de los archivos se
    // antepone a la petición, que es lo que recibe igual que en el chat.
    const prefix = sent
      .filter((a) => !a.imageFile)
      .map((a) => `[Archivo adjunto: ${a.name}]\n${a.text}\n\n`)
      .join("");
    await lanzar(`${prefix}${text}`);
  };

  if (!project) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
          <Mascot state="idle" size={140} />
          <h1 className="text-2xl font-semibold tracking-tight">
            <span className="text-accent-soft">{t("Modo Trabajo")}</span>
          </h1>
          <p className="text-sm text-zinc-500 max-w-md text-center">
            {t("Hatboo lee, escribe y ejecuta dentro de una carpeta. Elige una que ya exista o crea un proyecto nuevo.")}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void openProjectPicker()}
              className="flex items-center gap-2 rounded-full border border-base-border bg-base-card px-3.5 py-2 text-sm text-zinc-300 transition-colors hover:border-accent/50 hover:text-zinc-100"
            >
              <FolderOpen className="h-4 w-4" />
              {t("Abrir carpeta")}
            </button>
            <button
              onClick={startCreateProject}
              className="flex items-center gap-2 rounded-full border border-accent/40 bg-accent/[0.08] px-3.5 py-2 text-sm text-accent-soft transition-colors hover:bg-accent/[0.16]"
            >
              <Plus className="h-4 w-4" />
              {t("Nuevo proyecto")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 flex min-h-0">
      {/* Desviación deliberada de la guía de visual, que dice "anima translateX,
       *  no width". Eso vale para un cajón que se superpone; aquí los paneles son
       *  columnas de un flex y al plegarlas el chat TIENE que quedarse el hueco,
       *  así que el layout cambia de todos modos en cada fotograma. Mover el panel
       *  con transform dejaría el ancho saltando al final: peor. Lo que sí se hace
       *  es recortar el coste: 200 ms justos, y `hatboo-resizing` mata la
       *  transición mientras se arrastra el ancho a mano. */}
      {/* Ocultado a mano deja un riel para volver a abrirlo desde el mismo sitio.
          Con el modo foco activado no sale: ahí lo que se pidió era no ver paneles,
          y un riel en pantalla sería justo lo que el foco quiere quitar. */}
      {!focus && !storedFilesOpen && (
        <Riel
          Icono={FolderTree}
          etiqueta={t("Archivos")}
          lado="izquierda"
          onAbrir={() => patchSettings({ filesPanelOpen: true })}
        />
      )}
      <div
        className={`shrink-0 overflow-clip bg-base-raised transition-[width] duration-200 ease-[cubic-bezier(.2,.8,.2,1)] ${
          filesOpen ? "border-r border-base-border" : "w-0"
        }`}
        style={{ width: filesOpen ? filesPx : 0 }}
      >
        <div className="h-full flex flex-col" style={{ width: filesPx }}>
          <div className="flex items-center gap-2 border-b border-base-border px-2.5 py-2">
            <FolderTree className="w-3.5 h-3.5 shrink-0 text-accent-soft" />
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium uppercase tracking-wide text-zinc-500">
              {t("Archivos")}
            </span>
            {/* Sin botón de Explorador aquí: la ruta de la cabecera ya hace eso y
                tenerlo en dos sitios era de lo que sobraba. */}
            <button
              onClick={() => patchSettings({ filesPanelOpen: false })}
              title={t("Ocultar los archivos")}
              className="shrink-0 rounded p-1 text-zinc-600 transition-colors hover:bg-base-hover hover:text-zinc-200"
            >
              <PanelLeftClose className="w-3.5 h-3.5" />
            </button>
          </div>
          <FileTree
            projectId={project.id}
            raiz={project.rootPath}
            version={treeVersion}
            onAddFile={anadirAlContexto}
          />
        </div>
      </div>
      {filesOpen && (
        <ResizeHandle
          width={filesPx}
          min={PANEL_WIDTHS.files.min}
          max={PANEL_WIDTHS.files.max}
          def={PANEL_WIDTHS.files.def}
          side="left"
          onWidth={setDragFiles}
          onCommit={(px) => {
            setDragFiles(null);
            patchSettings({ filesPanelWidth: px });
          }}
        />
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Una sola línea con la identidad arriba: el proyecto manda, la sesión
            se abre con un clic, y el resto son mandos. La ruta salió de aquí —
            está en el `title` del proyecto y en el botón del Explorador — porque
            era lo más largo y lo menos mirado. */}
        <header className="shrink-0 flex items-center gap-1 px-3 py-1.5 border-b border-base-border">
          <ProyectoSwitcher project={project} />
          <span aria-hidden className="shrink-0 text-zinc-700">
            /
          </span>
          <SesionSwitcher projectId={project.id} />
          {/* El aviso de OneDrive se queda aquí: es un riesgo real mientras
              trabaja. El badge Código/Docs se fue al menú del proyecto, que es
              donde ya está la ruta y se mira antes de pedir la primera tarea. */}
          {estaEnOneDrive(project.rootPath) && (
            <span
              className="shrink-0 text-[10px] uppercase tracking-wider text-amber-300/80"
              title={t(
                "OneDrive sube y baja archivos por su cuenta: puede tener bloqueado justo el que escriba el agente, o pisar un cambio al sincronizar. Si se repite, mueve el proyecto fuera de OneDrive.",
              )}
            >
              {t("en OneDrive")}
            </span>
          )}

          <div className="ml-auto flex min-w-0 shrink-0 items-center gap-1">
            <button
              onClick={() => void revealItemInDir(project.rootPath).catch(() => {})}
              title={t("Mostrar la carpeta del proyecto en el Explorador")}
              className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-md text-zinc-500 transition-colors hover:bg-base-hover hover:text-zinc-200"
            >
              <FolderOpen className="h-3.5 w-3.5" />
            </button>
            <ProjectRules projectId={project.id} />
            <SessionChanges conversationId={tab?.sessionId ?? null} recargarCon={stepLines.length} />
            <ApprovalLevelPicker projectId={project.id} />
            <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-base-border" />
            {/* Los tres juntos: son «qué se ve», no acciones sobre el proyecto. */}
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                onClick={() => patchSettings({ focusMode: false, filesPanelOpen: !filesOpen })}
                className={panelToggle(filesOpen)}
                title={filesOpen ? t("Ocultar los archivos") : t("Mostrar los archivos")}
                aria-pressed={filesOpen}
              >
                <FolderTree className="w-4 h-4" />
              </button>
              <button
                onClick={() => patchSettings({ focusMode: false, tasksPanelOpen: !tasksOpen })}
                className={panelToggle(tasksOpen)}
                title={tasksOpen ? t("Ocultar las tareas") : t("Mostrar las tareas")}
                aria-pressed={tasksOpen}
              >
                <ListChecks className="w-4 h-4" />
              </button>
              <button
                onClick={() => patchSettings({ focusMode: !focus })}
                className={panelToggle(focus)}
                title={
                  focus
                    ? t("Salir del modo foco (Ctrl+.)")
                    : t("Modo foco: solo el chat, sin barra lateral ni paneles (Ctrl+.)")
                }
                aria-pressed={focus}
              >
                {focus ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </header>

        {approvalLevel === "full_access" && (
          <Cinta tono="peligro">
            <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
            <span className="min-w-0">
              <span className="font-semibold">{t("Acceso total activo:")}</span>{" "}
              {t(
                "el agente ejecuta todas las acciones sin pedir aprobación, incluida escritura de archivos y comandos. Las rutas siguen limitadas a la carpeta del proyecto.",
              )}
            </span>
          </Cinta>
        )}

        {toolSupport === false && (
          <Cinta tono="aviso">
            <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
            <span className="min-w-0">
              {t(
                "Este modelo no soporta tool calling — cambia de proveedor o modelo en Ajustes para usar el modo trabajo.",
              )}
            </span>
          </Cinta>
        )}

        {/* `key` por proyecto: al cambiar de pestaña el contenido entra con el
            fundido corto en vez de sustituirse de golpe, y la lista vuelve arriba. */}
        <div key={project.id} className="relative min-h-0 flex-1 animate-rise-in">
        <div ref={scrollerRef} onScroll={onScrollHilo} className="h-full overflow-y-auto">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center gap-4 px-6">
              {/* Pose propia: el chat vacío enseña al fantasma quieto; aquí ya
                  tiene proyecto bajo los pies. */}
              <Mascot
                state={mascotState === "idle" ? "working" : mascotState}
                size={80}
              />
              <div className="text-center space-y-2">
                {/* Sin título: el nombre del proyecto está en la cabecera, y la
                    sesión debajo. Repetirlo aquí era la tercera vez. */}
                <p className="max-w-sm text-[13px] leading-relaxed text-zinc-500">
                  {t("Pide una tarea sobre este proyecto. Hatboo hará un plan, leerá archivos y pedirá aprobación antes de escribir o ejecutar.")}
                </p>
                {/* Las capas del agente bajaron de la cabecera: son un dato para
                    decidir la primera tarea, no algo que haya que tener delante
                    mientras se trabaja. */}
                <span className="flex flex-wrap items-center justify-center gap-1.5">
                  <LayerChips />
                </span>
              </div>
              <SuggestionGrid
                items={TASK_SUGGESTIONS}
                disabled={toolSupport === false}
                onPick={(texto) => {
                  setInput(t(texto));
                  requestAnimationFrame(() => taskRef.current?.focus());
                }}
              />
            </div>
          ) : (
            <div className="max-w-3xl mx-auto px-6 py-4 space-y-2.5">
              {messages
                .filter((m) => m.role === "user" || m.content.trim() !== "")
                .map((m) => (
                  <div key={m.id} className="space-y-1.5">
                    <MessageBubble message={m} accionesFlotando={false} />
                    {/* La traza va debajo de la respuesta que la cerró, y sigue
                        ahí al reabrir la sesión: viene de `tool_calls`. */}
                    {m.steps && m.steps.length > 0 && <AgentTrace lines={m.steps} />}
                    {/* Los archivos que escribió la tarea, con tamaño real de disco. */}
                    {m.steps && m.steps.length > 0 && (
                      <FileCards
                        steps={m.steps}
                        projectId={project.id}
                        rootPath={project.rootPath}
                      />
                    )}
                  </div>
                ))}
              {/* Mientras se trabaja (o se espera una aprobación, o la tarea
                  reventó) la traza en curso es la de la pestaña: la respuesta
                  todavía no está escrita y sus pasos tampoco. */}
              {stepLines.length > 0 && agentStatus !== "idle" && (
                <AgentTrace lines={stepLines} running={agentStatus === "running"} />
              )}
              {agentStatus === "running" && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-base-border bg-base-raised px-4 py-2.5 text-sm text-zinc-400">
                    <Dots />
                    {t("Trabajando en la tarea…")}
                    <Cronometro />
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>
        {lejos && (
          <button
            onClick={bajar}
            title={t("Ir al final")}
            aria-label={t("Ir al final")}
            className="absolute bottom-4 right-5 rounded-full border border-base-border bg-base-raised p-2 text-zinc-400 shadow-lg shadow-shade/40 transition-colors hover:text-zinc-100"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
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

        <div className="shrink-0 px-6 pb-5 pt-2">
          <div className="mx-auto flex max-w-3xl items-end gap-3">
            {/* Como en el chat: la mascota solo sale cuando hay algo en curso, y
                ya no pelea sitio en la cabecera. */}
            {agentStatus !== "idle" && (
              <div className="hidden sm:block shrink-0 pb-1">
                <Mascot state={mascotState} size={36} />
              </div>
            )}
            <div className="flex-1 min-w-0 rounded-tarjeta border border-base-border bg-base-card px-3 pb-2.5 pt-3 shadow-flotante transition-colors focus-within:border-accent/50">
            {attachments.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pb-2 pl-0.5">
                {attachments.map((a, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1.5 rounded-md border border-base-border bg-base px-2 py-1 text-[11px] text-zinc-300"
                    title={t("{n} caracteres", { n: a.text.length.toLocaleString("es") })}
                  >
                    <Paperclip className="w-3 h-3 shrink-0 text-accent-soft" />
                    <span className="max-w-[200px] truncate">{a.name}</span>
                    <button
                      onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                      className="rounded p-0.5 text-zinc-500 hover:bg-white/10 hover:text-white transition-colors"
                      title={t("Quitar adjunto")}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {avisoAdjunto && (
              <p className="pb-2 pl-1 text-[11px] leading-snug text-red-400/90">
                {avisoAdjunto}
              </p>
            )}

            {modeloCorto && (
              <button
                onClick={() => {
                  setSettingsCat("api");
                  setView("settings");
                }}
                className="mb-1 flex w-full items-start gap-1.5 px-1 text-left text-[11px] leading-snug text-amber-300/90 transition-colors hover:text-amber-200"
                title={t("Abrir Ajustes → API y modelos")}
              >
                <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
                {/* Una línea, no una caja: el aviso vive dentro del compositor,
                    que ya tiene su propio borde, y otra pastilla dentro de otra
                    era ruido. La acción va escrita dentro de la frase. */}
                <span className="min-w-0 flex-1">
                  {t("{m} sirve para charlar; para crear o editar archivos hace falta uno de 7B o más.", { m: modeloLocal })}{" "}
                  <span className="whitespace-nowrap underline decoration-amber-400/40 underline-offset-2">
                    {t("Cambiar modelo")}
                  </span>
                </span>
              </button>
            )}

            {/* Con una tarea en curso el compositor no se congela: lo que se
                escriba se apunta y sale cuando esta termine. */}
            {busy && (
              <p className="flex items-center gap-1.5 pb-1.5 pl-1 text-[11px] text-zinc-500">
                <ListChecks className="h-3 w-3 shrink-0 text-accent-soft" />
                {cola.length > 0
                  ? t("En cola: {n} · se lanzan al terminar esta", { n: cola.length })
                  : t("Escribe otra si quieres: queda en cola hasta que termine esta.")}
              </p>
            )}

            <textarea
              ref={taskRef}
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
              placeholder={
                busy ? t("Añadir a la cola de tareas…") : t("¿Qué quieres hacer en este proyecto?")
              }
              disabled={toolSupport === false}
              className="max-h-48 w-full resize-none bg-transparent px-1 pb-2 text-sm leading-relaxed outline-none placeholder:text-zinc-600 disabled:cursor-not-allowed"
            />

            <div className="flex items-center gap-2">
              <WorkPlusMenu
                onPickFiles={(files) => setAttachments((prev) => [...prev, ...files])}
                onInsertTemplate={insertTemplate}
                disabled={busy || toolSupport === false}
              />
              {/* Sin `disabled`: los dos chips afectan al MENSAJE SIGUIENTE, no al
                  que está en curso. Apagarlos mientras trabaja los dejaba muertos
                  justo cuando se decide buscar en la web después de esta tarea. */}
              <ModeToggles />
              <div className="flex-1 min-w-0" />
              <ProviderModelPicker />
              {busy ? (
                <>
                  <button
                    onClick={() => void cancelTask()}
                    className="grid place-items-center w-8 h-8 shrink-0 rounded-full bg-accent text-white hover:bg-accent-dim transition-colors"
                    title={t("Detener la tarea en curso")}
                  >
                    <Square className="w-3 h-3 fill-current" />
                  </button>
                  {/* Detener sigue siendo el botón principal mientras trabaja;
                      encolar es el secundario, y Enter en el campo hace lo mismo. */}
                  <button
                    onClick={() => void submit()}
                    disabled={(!input.trim() && attachments.length === 0) || toolSupport === false}
                    className="grid place-items-center w-8 h-8 shrink-0 rounded-full border border-base-border text-zinc-400 disabled:opacity-35 disabled:cursor-not-allowed hover:border-accent/50 hover:text-zinc-100 transition-colors"
                    title={t("Añadir a la cola de tareas")}
                  >
                    <ArrowUp className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <button
                  onClick={() => void submit()}
                  disabled={(!input.trim() && attachments.length === 0) || toolSupport === false}
                  className="grid place-items-center w-8 h-8 shrink-0 rounded-full bg-accent text-white disabled:opacity-35 disabled:cursor-not-allowed hover:bg-accent-dim transition-colors"
                  title={t("Enviar")}
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
              )}
            </div>
            </div>
          </div>
          {/* La rama vive aquí, junto a lo que se va a commitear, no repetida en
              la cabecera: al estilo de Bionic. */}
          {git?.isRepo && git.branch && (
            <div className="mx-auto mt-1.5 flex max-w-3xl justify-end">
              <button
                onClick={() => void refreshGit(project.id)}
                title={t("Rama {r} · {n} archivo(s) con cambios", { r: git.branch, n: git.dirtyCount })}
                className="flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] text-zinc-600 transition-colors hover:bg-base-hover hover:text-zinc-300"
              >
                <GitBranch className="w-3 h-3" />
                <span className="font-mono">{git.branch}</span>
                {git.dirtyCount > 0 && (
                  <span className="text-amber-300/80">
                    · {t("{n} cambios", { n: git.dirtyCount })}
                  </span>
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      {tasksOpen && (
        <ResizeHandle
          width={tasksPx}
          min={PANEL_WIDTHS.tasks.min}
          max={PANEL_WIDTHS.tasks.max}
          def={PANEL_WIDTHS.tasks.def}
          side="right"
          onWidth={setDragTasks}
          onCommit={(px) => {
            setDragTasks(null);
            patchSettings({ tasksPanelWidth: px });
          }}
        />
      )}
      <div
        className={`shrink-0 overflow-clip bg-base-raised transition-[width] duration-200 ease-[cubic-bezier(.2,.8,.2,1)] ${
          tasksOpen ? "border-l border-base-border" : "w-0"
        }`}
        style={{ width: tasksOpen ? tasksPx : 0 }}
      >
        <div className="h-full" style={{ width: tasksPx }}>
          <TaskList
            tasks={tasks}
            stepLines={stepLines}
            running={busy}
            cola={cola}
            colaEnPausa={colaEnPausa}
            onQuitarDeCola={(i) => activeProjectId && quitarDeCola(activeProjectId, i)}
            onReanudar={() => activeProjectId && reanudarCola(activeProjectId)}
            onReintentar={(pedido) => void lanzar(pedido)}
            onCerrar={() => patchSettings({ tasksPanelOpen: false })}
          />
        </div>
      </div>
      {!focus && !storedTasksOpen && (
        <Riel
          Icono={ListChecks}
          etiqueta={t("Tareas")}
          lado="derecha"
          onAbrir={() => patchSettings({ tasksPanelOpen: true })}
        />
      )}

      <ToolApprovalModal />
      <PlanReviewModal />

      </div>
    </div>
  );
}

