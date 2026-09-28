import { t } from "../i18n";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Settings,
  Trash2,
  LayoutGrid,
  Briefcase,
  MessageSquare,
  MoreHorizontal,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  Palette,
  Pin,
  Archive,
  ArchiveRestore,
  ChevronsUpDown,
  Plus,
  Bell,
  FolderOpen,
} from "lucide-react";
import { useChatStore } from "../store/chatStore";
import { useWorkStore } from "../store/workStore";
import { fmtDate, grupoDeFecha, haceRelativo } from "../time";
import ContextMenu, { type MenuItem } from "./ContextMenu";
import ConfirmModal, { type AvisoBorrado } from "./ConfirmModal";
import EmptyHint from "./EmptyHint";
import Popover from "./Popover";
import ThemePicker from "./ThemePicker";
import Avatar from "./Avatar";
import Mascot from "./mascot/Mascot";
import { type ThemeChoice } from "../theme";
import {
  LANGUAGE_OPTIONS,
  MOTION_OPTIONS,
  type Conversation,
  type LanguageChoice,
  type MascotState,
  type MotionChoice,
  type Project,
  type AvatarStyle,
} from "../types";

/** La barra que marca «esta». Medía 2 px y pegaba al borde izquierdo de la
 *  fila, justo donde el `rounded-lg` recorta: se leía como una línea cortada
 *  que tocaba el canto de la ventana. Con 3 px y cuatro de aire dentro de la
 *  fila se ve como lo que es, un indicador puesto a propósito. */
const BARRA_SELECCION =
  "absolute left-1 top-1.5 bottom-1.5 w-[3px] shrink-0 rounded-full bg-accent-soft";

/** Fila de control del menú rápido: el nombre a la izquierda y el mando a la
 *  derecha. Todas miden lo mismo para que el menú se lea en dos columnas fijas
 *  en vez de como una lista de botones sueltos. */
function FilaControl({
  etiqueta,
  ayuda,
  children,
}: {
  etiqueta: string;
  ayuda?: string;
  children: ReactNode;
}) {
  return (
    <div
      className="flex items-center justify-between gap-2 px-1.5 py-[3px]"
      title={ayuda}
    >
      <span className="min-w-0 shrink-0 truncate text-xs text-zinc-400">{etiqueta}</span>
      {children}
    </div>
  );
}

/** Conmutador de dos o tres valores. Es la pieza que falta para poder tocar
 *  algo aquí sin abrir Ajustes. */
function Segmento({
  opciones,
  valor,
  alElegir,
}: {
  opciones: { id: string; etiqueta: string }[];
  valor: string;
  alElegir: (id: string) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-base-border bg-base p-0.5">
      {opciones.map((o) => (
        <button
          key={o.id}
          onClick={() => alElegir(o.id)}
          aria-pressed={valor === o.id}
          title={o.etiqueta}
          className={`rounded-md px-1.5 py-0.5 text-[11px] leading-4 transition-colors ${
            valor === o.id
              ? "bg-accent/20 text-accent-soft"
              : "text-zinc-500 hover:text-zinc-200"
          }`}
        >
          {o.etiqueta}
        </button>
      ))}
    </div>
  );
}

/** Botón del lateral plegado: sin texto, todo a `title`. */
const RAIL_BTN =
  "shrink-0 grid place-items-center h-9 rounded-lg transition-colors";

/** Tesela del riel: el estado activo lleva el mismo borde acento que las pills
 *  del panel ancho, para que los dos estados se lean como la misma app. El
 *  borde transparente de las inactivas evita que nada salte al activarse. */
function railTile(activo: boolean): string {
  return `${RAIL_BTN} w-full border ${
    activo
      ? "border-accent/60 bg-accent/[0.14] text-accent-soft"
      : "border-transparent text-zinc-400 hover:bg-base-hover hover:text-zinc-100"
  }`;
}

/** Pelo que no toca los bordes: en un riel de 56 px, la línea de lado a lado
 *  se lee como un corte del panel, no como un separador de grupos. */
const RAIL_CORTE = "mx-1.5 my-1.5 h-px shrink-0 bg-base-border/70";

/** Mando de los encabezados de sección: icono suelto con su `title`, sin
 *  texto, para que la lista siga teniendo una sola columna de nombres. */
function IconoSeccion({
  children,
  titulo,
  onClick,
  activo = false,
}: {
  children: ReactNode;
  titulo: string;
  onClick: () => void;
  activo?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={titulo}
      className={`shrink-0 rounded-md p-1 transition-colors ${
        activo
          ? "bg-accent/[0.14] text-accent-soft"
          : "text-zinc-600 hover:bg-base-hover hover:text-zinc-300"
      }`}
    >
      {children}
    </button>
  );
}

/** Encabezado de sección: chevrón, nombre en versalitas y cuántas cosas hay
 *  dentro. Sin icono: el de la sección y el de cada fila eran el mismo dibujo
 *  repetido, y dos briefcases seguidos no dicen nada que no diga la palabra.
 *  A la derecha van los mandos de esa lista. */
function EncabezadoSeccion({
  titulo,
  abierto,
  onPlegar,
  contador,
  acciones,
}: {
  titulo: string;
  abierto: boolean;
  onPlegar: () => void;
  contador?: number;
  acciones?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1 px-0.5 pt-4 pb-1">
      <button
        onClick={onPlegar}
        aria-expanded={abierto}
        title={abierto ? t("Ocultar la sección") : t("Mostrar la sección")}
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-[10px] font-semibold uppercase tracking-[0.07em] text-zinc-500 transition-colors hover:text-zinc-300"
      >
        <ChevronRight
          className={`h-3 w-3 shrink-0 text-zinc-600 transition-transform duration-200 ${
            abierto ? "rotate-90" : ""
          }`}
        />
        <span className="truncate">{titulo}</span>
        {typeof contador === "number" && contador > 0 && (
          <span className="shrink-0 text-[10px] font-normal normal-case tracking-normal tabular-nums text-zinc-600">
            {contador}
          </span>
        )}
      </button>
      {abierto && acciones}
    </div>
  );
}

/** Edición del título en la propia fila: `onDone` recibe `null` si se cancela. */
function InlineRename({
  inicial,
  className,
  onDone,
}: {
  inicial: string;
  className: string;
  onDone: (titulo: string | null) => void;
}) {
  const [texto, setTexto] = useState(inicial);
  const terminar = (guardar: boolean) => {
    const limpio = texto.trim();
    onDone(guardar && limpio && limpio !== inicial ? limpio : null);
  };
  return (
    <input
      autoFocus
      value={texto}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setTexto(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") terminar(true);
        else if (e.key === "Escape") terminar(false);
        e.stopPropagation();
      }}
      onBlur={() => terminar(true)}
      maxLength={80}
      className={className}
    />
  );
}

function SessionRow({
  conv,
  isActive,
  agentStatus,
  onOpen,
  onDelete,
  onRename,
  onMenu,
}: {
  conv: Conversation;
  isActive: boolean;
  agentStatus: string;
  onOpen: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
  onMenu: (e: React.MouseEvent) => void;
}) {
  const [editando, setEditando] = useState(false);
  // El punto solo dice algo en la sesión abierta: es el estado del agente de la
  // carpeta, y en las demás siempre sería un gris mudo. Era la viñeta suelta
  // que aparecía delante de todos los nombres.
  const dot =
    agentStatus === "running"
      ? "bg-accent-soft animate-pulse"
      : agentStatus === "awaiting"
        ? "bg-amber-400"
        : agentStatus === "error"
          ? "bg-red-400"
          : "bg-accent-soft/50";

  if (editando) {
    return (
      <div className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs bg-base-hover">
        <span aria-hidden className="w-1.5 shrink-0">
          {isActive && (
            <span className={`block h-1.5 w-1.5 rounded-full ${dot}`} />
          )}
        </span>
        <InlineRename
          inicial={conv.title}
          className="min-w-0 flex-1 rounded border border-accent/60 bg-base px-1 py-0.5 text-xs outline-none"
          onDone={(titulo) => {
            setEditando(false);
            if (titulo) onRename(titulo);
          }}
        />
      </div>
    );
  }

  return (
    <div
      onClick={onOpen}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setEditando(true);
      }}
      onContextMenu={onMenu}
      className={`group relative flex items-center gap-1.5 rounded-md px-2 py-1 cursor-pointer text-xs transition-colors ${
        isActive
          ? "bg-base-hover text-zinc-100"
          : "text-zinc-500 hover:bg-base-hover hover:text-zinc-300"
      }`}
      title={`${conv.title} · ${fmtDate(conv.updatedAt)} · ${t("clic derecho para más opciones; doble clic para renombrar")}`}
    >
      {/* El activo se marcaba con el mismo fondo que el hover, así que no había
          forma de saber cuál estabas leyendo. La barrita es lo que lo
          distingue; el tinte se queda para el ratón. */}
      {isActive && (
        <span
          aria-hidden
          className={BARRA_SELECCION}
        />
      )}
      {/* El hueco se queda aunque el punto no: sin él los nombres saltarían de
          fila en fila. */}
      <span aria-hidden className="w-1.5 shrink-0">
        {isActive && (
          <span className={`block h-1.5 w-1.5 rounded-full ${dot}`} />
        )}
      </span>
      <span className="flex-1 truncate">{conv.title}</span>
      {conv.pinned && <Pin className="w-3 h-3 shrink-0 text-accent-soft/70" />}
      <span className="shrink-0 text-[10px] tabular-nums text-zinc-600">
        {haceRelativo(conv.updatedAt)}
      </span>
      {/* Encima de la hora, no en su lugar: si aparece y desaparece moviendo la
          fila, el botón tampoco se alcanza con el teclado. */}
      <button
        onClick={(ev) => {
          ev.stopPropagation();
          onDelete();
        }}
        disabled={isActive}
        title={isActive ? t("Es la sesión abierta") : t("Eliminar sesión")}
        className="absolute right-1 rounded bg-base-hover p-0.5 text-zinc-500 opacity-0 transition-opacity hover:text-red-400 focus-visible:opacity-100 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
}

/** Cabecera de un cajón de fechas dentro de la lista de chats. Más chica que
 *  la de sección: manda una línea, no es plegable y no tiene mandos. */
function Grupo({ titulo }: { titulo: string }) {
  return (
    <p className="px-2 pb-0.5 pt-3 text-[10px] font-semibold uppercase tracking-[0.07em] text-zinc-600">
      {titulo}
    </p>
  );
}

/** Hilo suelto, sin carpeta. Mismo doble clic para renombrar que las sesiones. */
function ChatRow({
  conv,
  isActive,
  onOpen,
  onDelete,
  onRename,
  onMenu,
}: {
  conv: Conversation;
  isActive: boolean;
  onOpen: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
  onMenu: (e: React.MouseEvent) => void;
}) {
  const [editando, setEditando] = useState(false);
  if (editando) {
    return (
      <div className="px-3 py-1.5">
        <InlineRename
          inicial={conv.title}
          className="w-full rounded border border-accent/60 bg-base px-2 py-1 text-sm outline-none"
          onDone={(titulo) => {
            setEditando(false);
            if (titulo) onRename(titulo);
          }}
        />
      </div>
    );
  }
  return (
    <div
      onClick={onOpen}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setEditando(true);
      }}
      onContextMenu={onMenu}
      className={`group relative flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer text-sm transition-colors ${
        isActive ? "bg-accent/[0.14] text-zinc-100" : "text-zinc-400 hover:bg-base-hover hover:text-zinc-200"
      }`}
      title={`${conv.title} · ${fmtDate(conv.updatedAt)} · ${t("clic derecho para más opciones; doble clic para renombrar")}`}
    >
      {/* El tinte solo se confundía con el del proyecto activo encima; la barra
          de acento dice «esta» sin competir con él. */}
      {isActive && (
        <span aria-hidden className={BARRA_SELECCION} />
      )}
      <MessageSquare
        className={`w-3.5 h-3.5 shrink-0 ${isActive ? "text-accent-soft" : "opacity-60"}`}
      />
      <span className="flex-1 truncate">{conv.title}</span>
      {conv.pinned && <Pin className="w-3.5 h-3.5 shrink-0 text-accent-soft/70" />}
      <button
        title={t("Eliminar")}
        onClick={(ev) => {
          ev.stopPropagation();
          onDelete();
        }}
        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-accent-dim/30 text-zinc-500 hover:text-red-400 transition-all"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

/** Lo que pasa en las carpetas que no se están mirando: una sesión pidiendo
 *  aprobación o una cola parada se perdía hasta entrar ahí. El proyecto activo
 *  no entra porque su modal ya está delante de la cara. */
function AvisoAtencion({
  items,
  onAbrir,
}: {
  items: { pid: string; sessionId: string; nombre: string; motivo: string; color: string }[];
  onAbrir: (pid: string, sessionId: string) => void;
}) {
  return (
    <div className="mb-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-2 py-1.5">
      <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-amber-300/80">
        <Bell className="h-3 w-3 shrink-0" />
        {t("Necesita tu atención")}
      </span>
      {items.map((a) => (
        <button
          key={a.pid + a.sessionId}
          onClick={() => onAbrir(a.pid, a.sessionId)}
          title={t("Entrar en esa sesión")}
          className="mt-1 flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-[11px] text-zinc-300 transition-colors hover:bg-base-hover"
        >
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${a.color}`} />
          <span className="min-w-0 flex-1 truncate">{a.nombre}</span>
          <span className="shrink-0 text-[10px] text-zinc-500">{a.motivo}</span>
        </button>
      ))}
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
  const renameConversation = useChatStore((s) => s.renameConversation);
  const setView = useChatStore((s) => s.setView);
  const settings = useChatStore((s) => s.settings);
  const assistantName = settings?.assistantName?.trim() || "Hatboo";

  const projects = useWorkStore((s) => s.projects);
  const activeProjectId = useWorkStore((s) => s.activeProjectId);
  const tabs = useWorkStore((s) => s.tabs);
  const selectProject = useWorkStore((s) => s.selectProject);
  const selectSession = useWorkStore((s) => s.selectSession);
  const newWorkSession = useWorkStore((s) => s.newWorkSession);
  const removeProject = useWorkStore((s) => s.removeProject);
  const setProjectPinned = useWorkStore((s) => s.setProjectPinned);
  const openProjectPicker = useWorkStore((s) => s.openProjectPicker);
  const focus = settings?.focusMode ?? false;
  // El modo foco es un arreglo del workspace: en la vista de chat la barra
  // lateral sigue con su propio estado, si no se quedaría sin forma de salir.
  const hidden = focus && view === "work";
  const compact = settings?.sidebarCompact ?? false;
  const chatsAbiertos = settings?.chatsSectionOpen ?? true;
  const proyectosAbiertos = settings?.projectsSectionOpen ?? true;
  const patchSettings = useChatStore((s) => s.patchSettings);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggleExpanded = (id: string) =>
    setExpanded((e) => ({ ...e, [id]: !e[id] }));
  // La carpeta en la que estás trabaja con sus sesiones a la vista: con un solo
  // proyecto en la lista, la barra era un nombre arriba y un hueco enorme hasta
  // el pie. Esto fija el estado inicial; plegarla a mano sigue funcionando.
  useEffect(() => {
    if (!activeProjectId || view !== "work") return;
    setExpanded((e) => (e[activeProjectId] ? e : { ...e, [activeProjectId]: true }));
  }, [activeProjectId, view]);
  const [showArchived, setShowArchived] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; conv: Conversation } | null>(null);
  const [projectMenu, setProjectMenu] = useState<{
    x: number;
    y: number;
    project: Project;
  } | null>(null);
  const [aviso, setAviso] = useState<AvisoBorrado | null>(null);
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

  /**
   * Borrado con confirmación. Una sesión dice de qué carpeta sale — y deja
   * claro que no se toca ningún archivo — porque la papelera ya no es obvia.
   */
  const pideBorradoHilo = (conv: Conversation) => {
    const carpeta = conv.projectId
      ? projects.find((p) => p.id === conv.projectId)?.name
      : undefined;
    setAviso({
      title: carpeta
        ? t("¿Borrar esta sesión de {p}?", { p: carpeta })
        : t("¿Borrar esta conversación?"),
      body: carpeta
        ? t("Se elimina el hilo. Los archivos de la carpeta no se tocan.")
        : t("Se elimina el hilo con todos sus mensajes."),
      onConfirm: () => void removeConversation(conv.id),
    });
  };

  const pideBorradoProyecto = (p: Project) => {
    setAviso({
      title: t("¿Quitar {p} de Hatboo?", { p: p.name }),
      body: t(
        "Se borran sus sesiones y su historial. La carpeta y sus archivos no se tocan.",
      ),
      confirmLabel: t("Quitar"),
      onConfirm: () => void removeProject(p.id),
    });
  };

  const projectMenuItems = (p: Project): MenuItem[] => [
    {
      label: p.pinned ? t("Dejar de fijar") : t("Fijar arriba"),
      icon: <Pin className="w-3.5 h-3.5" />,
      onSelect: () => void setProjectPinned(p.id, !p.pinned),
    },
    {
      label: t("Quitar de Hatboo"),
      detail: t("Se borran sus sesiones. La carpeta no se toca."),
      icon: <Trash2 className="w-3.5 h-3.5" />,
      danger: true,
      onSelect: () => pideBorradoProyecto(p),
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
      onSelect: () => pideBorradoHilo(conv),
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
  /** Los chats sueltos se reparten por calendario: con la lista plana, cinco
   *  hilos seguidos no decían cuál es de hoy. Las fijadas van arriba y sin
   *  cabecera, porque ya llevan el chinchete en la propia fila. */
  const chatsFijados = chatConversations.filter((c) => c.pinned);
  const gruposDeChats = [...(() => {
    const porTitulo = new Map<string, Conversation[]>();
    for (const c of chatConversations) {
      if (c.pinned) continue;
      const titulo = grupoDeFecha(c.updatedAt);
      const caja = porTitulo.get(titulo);
      if (caja) caja.push(c);
      else porTitulo.set(titulo, [c]);
    }
    return porTitulo;
  })()];
  const archivedChats = conversations.filter((c) => !c.projectId && c.archived).length;
  /** Todas las archivadas, también las sesiones de carpeta: estas solo salían
   *  de la lista y no había forma de volver a enseñarlas desde la barra. */
  const archivadasTotal = conversations.filter((c) => c.archived).length;
  /** Con proyectos abiertos y ningún chat suelto, la sección de conversaciones
   *  solo era un segundo vacío que parecía un error. Vuelve en cuanto hay algo. */
  const seccionChats =
    chatConversations.length > 0 || archivedChats > 0 || projects.length === 0;
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

  /** Lo que espera a uno en otra carpeta. Se recorre la lista de proyectos —
   *  no las pestañas — para que un nombre borrado de la sesión no cuelgue un
   *  aviso sin dueño. */
  const avisosAtencion = projects.flatMap((p) => {
    const tab = tabs[p.id];
    if (!tab?.sessionId) return [];
    if (view === "work" && p.id === activeProjectId) return [];
    const caso =
      tab.approval
        ? { motivo: t("pide aprobación"), color: "bg-amber-400" }
        : tab.planReview
          ? { motivo: t("revisa el plan"), color: "bg-amber-400" }
          : tab.agentStatus === "error"
            ? { motivo: t("acabó en error"), color: "bg-red-400" }
            : tab.colaEnPausa
              ? { motivo: t("cola parada"), color: "bg-amber-400/70" }
              : null;
    return caso
      ? [{ pid: p.id, sessionId: tab.sessionId, nombre: p.name, ...caso }]
      : [];
  });
  const pendientes = new Map(avisosAtencion.map((a) => [a.pid, a]));

  /** La mascota del pie de la lista es el estado de la carpeta abierta, no un
   *  adorno: dormida significa que el agente no está en nada. Fuera del modo
   *  trabajo no hay agente que describir, así que reposa. */
  const tabActivo = activeProjectId ? tabs[activeProjectId] : undefined;
  const poseLateral: MascotState =
    view === "work" && tabActivo
      ? tabActivo.agentStatus === "running"
        ? "working"
        : tabActivo.approval || tabActivo.planReview
          ? "surprised"
          : tabActivo.agentStatus === "error"
            ? "confused"
            : "sleeping"
      : "idle";

  if (hidden) {
    return <aside className="w-0 shrink-0 overflow-clip transition-[width] duration-200 ease-[cubic-bezier(.2,.8,.2,1)]" />;
  }

  /** Menú rápido de la tarjeta de perfil. El mismo contenido en el panel ancho y
   *  en el riel; lo único que cambia es el botón del ancla. Arriba lo que se toca
   *  a diario (tres conmutadores), abajo lo que lleva a otra pantalla. */
  const menuRapido = (
    <>
      <div className="space-y-0.5">
        <FilaControl etiqueta={t("Tema")}>
          <ThemePicker
            value={(settings?.theme ?? "dark") as ThemeChoice}
            onChange={(id) => patchSettings({ theme: id })}
            paletas={false}
          />
        </FilaControl>
        <FilaControl
          etiqueta={t("Movimiento")}
          ayuda={t("«Reducido» quita animaciones y transiciones solo dentro de Hatboo, sin tocar el ajuste de Windows.")}
        >
          <Segmento
            valor={settings?.motion ?? "system"}
            alElegir={(id) => patchSettings({ motion: id as MotionChoice })}
            opciones={MOTION_OPTIONS.map((m) => ({ id: m.id, etiqueta: t(m.label) }))}
          />
        </FilaControl>
        <FilaControl
          etiqueta={t("Idioma")}
          ayuda={t("«Sistema» sigue el idioma de Windows. No cambia lo que escribe el modelo: eso se le pide en cada charla.")}
        >
          <Segmento
            valor={settings?.uiLanguage ?? "system"}
            alElegir={(id) => patchSettings({ uiLanguage: id as LanguageChoice })}
            opciones={LANGUAGE_OPTIONS.map((o) => ({
              id: o.id,
              // «ES» y «EN» se leen en cualquier idioma; «Sistema» no.
              etiqueta: o.id === "system" ? t("Sistema") : o.id.toUpperCase(),
            }))}
          />
        </FilaControl>
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
            const st = useChatStore.getState();
            st.setSettingsCat("appearance");
            st.setView("settings");
            setProfileOpen(false);
          }}
          className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-zinc-300 hover:bg-base-hover transition-colors"
        >
          <Palette className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
          {t("Paletas y tipografía")}
          <span className="ml-auto text-[10px] text-zinc-600">{t("Ajustes")}</span>
        </button>
        <button
          onClick={() => {
            patchSettings({ sidebarCompact: !compact });
            setProfileOpen(false);
          }}
          className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-zinc-300 hover:bg-base-hover transition-colors"
        >
          {compact ? (
            <PanelLeftOpen className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
          ) : (
            <PanelLeftClose className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
          )}
          {compact ? t("Desplegar la barra lateral") : t("Plegar la barra lateral")}
          <span className="ml-auto text-[10px] text-zinc-600">Ctrl+B</span>
        </button>
      </div>
    </>
  );

  if (compact) {
    return (
      <aside className="w-14 shrink-0 h-full flex flex-col gap-1 px-2.5 py-2 border-r border-base-border bg-base-raised transition-[width] duration-200 ease-[cubic-bezier(.2,.8,.2,1)]">
        {/* El logo, el plegado y la búsqueda viven ahora en la barra de título:
            el rail empieza directo por lo que hace. */}
        <button
          onClick={() => void newConversation()}
          className={`${RAIL_BTN} w-full border border-accent/40 bg-accent/[0.08] text-accent-soft hover:bg-accent/[0.16] hover:border-accent/60`}
          title={t("Nueva conversación (Ctrl+N)")}
        >
          <Plus className="w-4 h-4" />
        </button>
        <div className={RAIL_CORTE} />
        <button
          onClick={() => setView("projects")}
          className={railTile(view === "projects")}
          title={t("Ver todos los proyectos")}
        >
          <LayoutGrid className="w-4 h-4" />
        </button>

        <div className={RAIL_CORTE} />
        <div className="flex-1 min-h-0 overflow-y-auto space-y-1">
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                setView("work");
                void selectProject(p.id);
              }}
              className={`${railTile(p.id === activeProjectId && view === "work")} relative`}
              title={
                pendientes.get(p.id)
                  ? `${p.name} · ${pendientes.get(p.id)?.motivo}`
                  : p.name
              }
            >
              <Briefcase className="w-4 h-4" />
              {/* El riel no tiene sitio para el aviso entero, pero un icono que
                  espera a uno no puede parecer silencioso. */}
              {pendientes.get(p.id) && (
                <span
                  aria-hidden
                  className={`absolute right-1 top-1 h-1.5 w-1.5 rounded-full ${pendientes.get(p.id)!.color}`}
                />
              )}
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
              className={railTile(conv.id === activeId && view === "chat")}
              title={conv.title}
            >
              <MessageSquare className="w-4 h-4" />
            </button>
          ))}
        </div>

        {/* Abajo, lo mismo que la tarjeta de perfil del panel ancho: quién eres.
            Ajustes vive dentro de su menú rápido y en Ctrl+,: el engranaje suelto
            del riel era un segundo camino a lo mismo, pegado al avatar. */}
        <div className={RAIL_CORTE} />
        <button
          ref={profileRef}
          onClick={() => setProfileOpen((v) => !v)}
          title={t("Menú rápido")}
          className={`${RAIL_BTN} w-full rounded-full ${
            profileOpen ? "bg-base-hover ring-2 ring-accent/30" : "hover:bg-base-hover"
          }`}
        >
          <Avatar
            style={(settings?.avatarStyle ?? "mascota") as AvatarStyle}
            colorId={settings?.avatarColor ?? "violeta"}
            emoji={settings?.avatarEmoji ?? "🎩"}
            name={assistantName}
            size={26}
          />
        </button>
        <Popover
          open={profileOpen}
          anchorRef={profileRef}
          onClose={() => setProfileOpen(false)}
          width={248}
          align="start"
          className="p-1.5 space-y-1.5"
        >
          {menuRapido}
        </Popover>
      </aside>
    );
  }

  return (
    <aside className="w-64 shrink-0 h-full flex flex-col border-r border-base-border bg-base-raised transition-[width] duration-200 ease-[cubic-bezier(.2,.8,.2,1)]">
      {/* Zona de acción. Era una píldora morada centrada que competía con todo
          lo de abajo; ahora es un control del mismo nivel que las filas: caja
          discreta, icono a la izquierda y el atajo a la derecha. */}
      <div className="px-2.5 pt-3 pb-1">
        <button
          onClick={() => void newConversation()}
          title={t("Chat suelto, sin carpeta de proyecto")}
          className="flex w-full items-center gap-2 rounded-lg border border-base-border bg-base-card py-1.5 pl-1.5 pr-2 text-left text-[13px] text-zinc-200 transition-colors hover:border-accent/40 hover:bg-base-hover"
        >
          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-accent/[0.16] text-accent-soft">
            <Plus className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0 flex-1 truncate">{t("Nueva conversación")}</span>
          <span className="shrink-0 text-[10px] text-zinc-600">Ctrl+N</span>
        </button>
      </div>

      {/* `gap` en vez de `space-y`: el bloque de abajo necesita `mt-auto` y la
          utilidad de espacio lo ganaría en especificidad. */}
      <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 pb-2 gap-0.5">
        {avisosAtencion.length > 0 && (
          <AvisoAtencion items={avisosAtencion} onAbrir={openSession} />
        )}
        <EncabezadoSeccion
          titulo={t("Proyectos")}
          abierto={proyectosAbiertos}
          onPlegar={() => patchSettings({ projectsSectionOpen: !proyectosAbiertos })}
          contador={projects.length}
          acciones={
            <>
              <IconoSeccion
                titulo={t("Ver todos los proyectos")}
                activo={view === "projects"}
                onClick={() => setView("projects")}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </IconoSeccion>
              <IconoSeccion
                titulo={t("Abrir una carpeta existente como proyecto")}
                onClick={() => void openProjectPicker()}
              >
                <FolderOpen className="h-3.5 w-3.5" />
              </IconoSeccion>
            </>
          }
        />
        {proyectosAbiertos && projects.length === 0 && (
          <EmptyHint
            pose="walking"
            text={t("Aún no hay proyectos.")}
            detail={t("Una carpeta: el agente lee y escribe dentro de ella.")}
            accion={
              <button
                onClick={() => void openProjectPicker()}
                className="flex items-center gap-1.5 rounded-md border border-base-border bg-base-card px-2 py-1 text-[11px] text-zinc-300 transition-colors hover:border-accent/50 hover:bg-base-hover"
              >
                <FolderOpen className="h-3 w-3 shrink-0 text-accent-soft" />
                {t("Abrir carpeta")}
              </button>
            }
          />
        )}
        {(proyectosAbiertos ? projects : []).map((p) => {
          const isOpen = !!expanded[p.id];
          const tab = tabs[p.id];
          const sessions = sessionsOf(p.id);
          const activo = p.id === activeProjectId && view === "work";
          return (
            <div key={p.id}>
              <div
                className={`group relative flex items-center gap-0.5 rounded-lg px-0.5 pr-1.5 cursor-pointer text-sm transition-colors ${
                  activo
                    ? "bg-accent/[0.14] text-zinc-100"
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
                {/* La barra de acento es la misma que en los chats: el tinte solo
                    se leía como una fila pasada por encima. */}
                {activo && (
                  <span
                    aria-hidden
                    className={BARRA_SELECCION}
                  />
                )}
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
                {/* Plegada, la carpeta no dice qué hay dentro; abierta, sobra el
                    número porque ya se ven las sesiones. */}
                {!isOpen && sessions.length > 0 && (
                  <span className="shrink-0 text-[10px] tabular-nums text-zinc-600">
                    {sessions.length}
                  </span>
                )}
                {p.pinned && (
                  <Pin
                    className="w-3 h-3 shrink-0 text-accent-soft/70"
                    aria-label={t("Proyecto fijado")}
                  />
                )}
                {/* Fuera el punto de «pestaña abierta»: era el mismo estado que
                    lleva la sesión de abajo, repetido y suelto al final de la
                    fila, donde se leía como un aviso. */}
                <button
                  title={t("Más opciones del proyecto")}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    openProjectMenu(p)(ev);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded text-zinc-500 hover:bg-base-hover hover:text-zinc-200 transition-all"
                >
                  <MoreHorizontal className="w-3.5 h-3.5" />
                </button>
              </div>

              {isOpen && (
                /* La carpeta abierta se convierte en un hueco hundido: un
                   `bg-base` sobre el panel, más oscuro que los dos. Con la
                   rayita de antes las sesiones parecían sueltas al lado del
                   nombre, y no había forma de ver dónde terminaba la carpeta. */
                <div className="ml-4 mr-0.5 mb-1 mt-0.5 space-y-0.5 rounded-lg bg-base py-1 pl-2 pr-1">
                  {sessions.map((conv) => (
                    <SessionRow
                      key={conv.id}
                      conv={conv}
                      isActive={conv.id === tab?.sessionId}
                      agentStatus={tab?.agentStatus ?? "idle"}
                      onOpen={() => openSession(p.id, conv.id)}
                      onDelete={() => pideBorradoHilo(conv)}
                      onRename={(titulo) => void renameConversation(conv.id, titulo)}
                      onMenu={openMenu(conv)}
                    />
                  ))}
                  <button
                    onClick={() => openBlankSession(p.id)}
                    className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs text-zinc-600 transition-colors hover:bg-base-hover hover:text-zinc-300"
                    title={t("Hilo nuevo dentro de esta carpeta, con sus mismas reglas")}
                  >
                    <Plus className="w-3 h-3 shrink-0" />
                    {t("Nueva sesión")}
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {seccionChats && (
          <EncabezadoSeccion
            titulo={t("Conversaciones")}
            abierto={chatsAbiertos}
            onPlegar={() => patchSettings({ chatsSectionOpen: !chatsAbiertos })}
            contador={chatConversations.length}
          />
        )}
        {seccionChats && chatsAbiertos && chatConversations.length === 0 && (
          <EmptyHint
            pose="sleeping"
            text={t("Aún no hay conversaciones.")}
            detail={t("En cuanto escribas en el chat, aparecerá aquí.")}
          />
        )}
        {chatsAbiertos &&
          chatsFijados.map((conv) => (
            <ChatRow
              key={conv.id}
              conv={conv}
              isActive={conv.id === activeId && view === "chat"}
              onOpen={() => {
                setView("chat");
                void selectConversation(conv.id);
              }}
              onDelete={() => pideBorradoHilo(conv)}
              onRename={(titulo) => void renameConversation(conv.id, titulo)}
              onMenu={openMenu(conv)}
            />
          ))}
        {chatsAbiertos &&
          gruposDeChats.map(([titulo, lista]) => (
            <Fragment key={titulo}>
              <Grupo titulo={titulo} />
              {lista.map((conv) => (
                <ChatRow
                  key={conv.id}
                  conv={conv}
                  isActive={conv.id === activeId && view === "chat"}
                  onOpen={() => {
                    setView("chat");
                    void selectConversation(conv.id);
                  }}
                  onDelete={() => pideBorradoHilo(conv)}
                  onRename={(titulo2) => void renameConversation(conv.id, titulo2)}
                  onMenu={openMenu(conv)}
                />
              ))}
            </Fragment>
          ))}
        {/* Pie de la lista. Con una sola carpeta abierta todo esto caía al
            fondo del todo y dejaba un hueco enorme encima; `mt-auto` lo pega
            abajo cuando sobra sitio y lo deja colar cuando la lista crece. */}
        <div className="mt-auto pt-4">
          {archivadasTotal > 0 && (
            <button
              onClick={() => setShowArchived((v) => !v)}
              className="mb-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-zinc-500 transition-colors hover:bg-base-hover hover:text-zinc-300"
              title={t("Las archivadas no se borran: solo salen de la lista")}
            >
              <Archive className="w-3 h-3 shrink-0" />
              {showArchived
                ? t("Ocultar archivadas")
                : t("Archivadas ({n})", { n: archivadasTotal })}
            </button>
          )}
          <div className="flex flex-col items-center gap-1.5 pb-1">
            <span aria-hidden className="opacity-[0.55]">
              <Mascot state={poseLateral} size={44} />
            </span>
            <p className="text-center text-[10px] leading-snug text-zinc-600">
              {t("Ctrl+K busca en chats, sesiones y carpetas")}
            </p>
          </div>
        </div>
      </nav>

      {/* El pie era una tarjeta con borde y fondo, otra isla brillante al final
          del hueco. Se queda como una fila más de la barra, con su línea
          encima marcando que ahí termina la lista. */}
      <div className="px-2.5 pb-2.5 pt-1.5 border-t border-base-border/50">
        <button
          ref={profileRef}
          onClick={() => setProfileOpen((v) => !v)}
          className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-base-hover"
          title={t("Menú rápido")}
        >
          <Avatar
            style={(settings?.avatarStyle ?? "mascota") as AvatarStyle}
            colorId={settings?.avatarColor ?? "violeta"}
            emoji={settings?.avatarEmoji ?? "🎩"}
            name={assistantName}
            size={24}
          />
          <span className="min-w-0 flex-1 truncate text-[13px] text-zinc-300">
            {assistantName}
          </span>
          <ChevronsUpDown className="w-3.5 h-3.5 shrink-0 text-zinc-600" />
        </button>

        <Popover
          open={profileOpen}
          anchorRef={profileRef}
          onClose={() => setProfileOpen(false)}
          width={248}
          align="start"
          className="p-1.5 space-y-1.5"
        >
          {menuRapido}
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
      <ConfirmModal aviso={aviso} cerrar={() => setAviso(null)} />
    </aside>
  );
}
