import { t } from "../../i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  File,
  FileCode,
  FileImage,
  FileText,
  Folder,
  FolderInput,
  FolderOpen,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import ContextMenu, { type MenuItem } from "../ContextMenu";
import { TiradorAlto } from "./ResizeHandle";
import type { FileEntry } from "../../types";

/** El cajón de la vista previa. Su alto se guarda en `localStorage`, como el tema
 *  o el movimiento: es una medida de esta ventana, no un dato del proyecto, y
 *  escribirlo en `Settings` obligaba a tocar Rust (y a reiniciarle la app). */
const CLAVE_ALTO = "hatboo.alto-previa";
const ALTO_DEF = 220;
const ALTO_MIN = 96;

/** La barra de la fila activa, la misma seña de la barra lateral. A 1 px del
 *  borde porque las filas del árbol llevan su propio `px-1.5`. */
const BARRA_FILA = "absolute bottom-1 left-1 top-1 w-[3px] shrink-0 rounded-full bg-accent-soft";

function fileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg"].includes(ext))
    return { Icon: FileImage, className: "text-fuchsia-400/80" };
  if (["html", "htm"].includes(ext))
    return { Icon: FileCode, className: "text-orange-400/80" };
  if (["css", "scss", "less", "sass"].includes(ext))
    return { Icon: FileCode, className: "text-sky-400/80" };
  if (["js", "jsx", "mjs", "cjs", "ts", "tsx"].includes(ext))
    return { Icon: FileCode, className: "text-yellow-400/80" };
  if (["json", "yaml", "yml", "toml"].includes(ext))
    return { Icon: FileCode, className: "text-emerald-400/80" };
  if (["md", "txt", "rst", "log"].includes(ext))
    return { Icon: FileText, className: "text-zinc-400/80" };
  if (["rs", "py", "go", "java", "c", "cpp", "cs", "rb", "php"].includes(ext))
    return { Icon: FileCode, className: "text-violet-400/80" };
  return { Icon: File, className: "text-zinc-600" };
}

/** Ruta absoluta dentro del proyecto. El backend trabaja en relativo y aquí se
 *  necesita la completa para enseñarla en el Explorador o copiarla. */
function absoluta(raiz: string, rel: string) {
  return `${raiz.replace(/[\\/]+$/, "")}/${rel}`;
}

/** Bytes legibles. El tamaño va en la fila para saber de un vistazo si esto es
 *  un apunte de dos líneas o un volcado que no conviene meter en el mensaje. */
function tamano(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Lo que devuelve `preview_project_file`. */
interface Previa {
  texto: string;
  bytes: number;
  lineas: number;
  truncado: boolean;
}

interface RamaProps {
  projectId: string;
  entry: FileEntry;
  depth: number;
  abiertas: Set<string>;
  onAlternar: (ruta: string) => void;
  onAddFile?: (ruta: string, nombre: string) => void;
  /** Pinchar el nombre lo lee y lo enseña abajo, sin meterlo en el mensaje. */
  onVer?: (entry: FileEntry) => void;
  onMenu: (x: number, y: number, entry: FileEntry) => void;
  /** Cambia cuando el agente escribe archivos: vuelve a leer lo abierto. */
  refresco: number;
  /** Ruta del archivo que se está enseñando abajo. La fila activa se marca: sin
   *  esto, el árbol no decía cuál de todos estás leyendo. */
  activo?: string | null;
}

function Rama({
  projectId,
  entry,
  depth,
  abiertas,
  onAlternar,
  onAddFile,
  onVer,
  onMenu,
  refresco,
  activo,
}: RamaProps) {
  const abierta = abiertas.has(entry.path);
  /** La carpeta por la que pasa el camino al archivo que se está enseñando: se
   *  le sube el texto para que la cadena hasta lo que lees se vea de un vistazo. */
  const esAncestroDeAbierta = !!activo && activo.startsWith(`${entry.path}/`);
  const [hijos, setHijos] = useState<FileEntry[] | null>(null);
  const [cargando, setCargando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setHijos(await invoke<FileEntry[]>("list_project_dir", { projectId, relativePath: entry.path }));
      setFallo(null);
    } catch (e) {
      // Antes esto se tragaba el error y dejaba la carpeta vacía: una carpeta que
      // no contesta parece una carpeta sin nada dentro.
      setHijos([]);
      setFallo(String(e));
    } finally {
      setCargando(false);
    }
  }, [entry.path, projectId]);

  useEffect(() => {
    if (abierta) void cargar();
  }, [abierta, refresco, cargar]);

  if (!entry.isDir) {
    const { Icon, className } = fileIcon(entry.name);
    // Pinchar el nombre lo enseña abajo y el «+» lo añade al mensaje: son dos
    // cosas distintas y antes solo se podía hacer la segunda.
    //
    // La fila se construye igual que las de la barra lateral: `pr-1.5` de aire,
    // radio de insignia y una COLUMNA reservada de 22 px para el «+». Antes el
    // botón iba `absolute right-1` ENCIMA del tamaño, tapándolo; ahora el tamaño
    // cede su sitio solo mientras se ve el botón.
    //
    // Sangría: paso fijo de 12 px. La carpeta arranca en `depth*12+2` y lleva el
    // chevrón delante, así que su icono cae en +22 y su nombre en +42; el hijo,
    // con `depth*12+22`, queda justo un paso por dentro de los dos. Medido. El
    // archivo que tienes enseñado abajo lleva la barra de acento.
    const elegido = activo === entry.path;
    return (
      <div
        className={`group/fila relative flex w-full items-center gap-1.5 rounded-chip py-[3px] pr-1.5 text-xs transition-colors ${
          elegido
            ? "bg-accent/[0.14] text-zinc-100"
            : "text-zinc-400 hover:bg-base-hover hover:text-zinc-100"
        }`}
        style={{ paddingLeft: depth * 12 + 22 }}
        onContextMenu={(e) => {
          e.preventDefault();
          onMenu(e.clientX, e.clientY, entry);
        }}
      >
        {elegido && <span aria-hidden className={BARRA_FILA} />}
        <button
          type="button"
          onClick={() => onVer?.(entry)}
          onDoubleClick={() => onAddFile?.(entry.path, entry.name)}
          title={t("Ver {n} · doble clic lo añade al mensaje", { n: entry.name })}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <Icon className={`w-3.5 h-3.5 shrink-0 ${className}`} />
          <span className="min-w-0 flex-1 truncate">{entry.name}</span>
        </button>
        {onAddFile ? (
          /* Una columna de 22 px al final, con el tamaño y el «+» ENCIMADOS el uno
             del otro y cambiándose por opacidad. Así la fila mide lo mismo con el
             ratón y sin él (22 px de alto, como la de carpeta: con el botón en
             flujo la fila de archivo salía a 28 y la lista bailaba), el tamaño no
             se corta nunca por la mitad, y el botón sigue alcanzable con teclado
             — con `display:none` un elemento no se puede enfocar. */
          <span className="relative flex h-4 min-w-[22px] shrink-0 items-center justify-end pl-1">
            <span className="text-[10px] tabular-nums text-zinc-600 transition-opacity group-hover/fila:opacity-0">
              {tamano(entry.size)}
            </span>
            <button
              type="button"
              onClick={() => onAddFile(entry.path, entry.name)}
              title={t("Añadir {n} al mensaje", { n: entry.name })}
              className="absolute inset-0 grid place-items-center rounded-md text-zinc-400 opacity-0 transition-opacity hover:bg-base-hover hover:text-zinc-100 focus-visible:bg-base-hover focus-visible:opacity-100 group-hover/fila:opacity-100"
            >
              <Plus className="h-3 w-3" />
            </button>
          </span>
        ) : (
          <span className="min-w-[22px] shrink-0 pl-1 text-right text-[10px] tabular-nums text-zinc-600">
            {tamano(entry.size)}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Guía de nivel: un hilo fino bajo la carpeta abierta. Con el árbol a
          300 px y nombres que truncaban, la sangría sola no decía qué pertenece
          a qué; el hilo sí lo dice sin gastar píxeles de indentación. */}
      {abierta && (
        <span
          aria-hidden
          className="absolute bottom-1 top-5 w-px bg-base-border/50"
          style={{ left: depth * 12 + 9 }}
        />
      )}
      <button
        type="button"
        onClick={() => onAlternar(entry.path)}
        onContextMenu={(e) => {
          e.preventDefault();
          onMenu(e.clientX, e.clientY, entry);
        }}
        className={`flex w-full items-center gap-1.5 rounded-chip py-[3px] pr-1.5 text-left text-xs transition-colors ${
          esAncestroDeAbierta
            ? "text-zinc-100 hover:bg-base-hover"
            : "text-zinc-300 hover:bg-base-hover"
        }`}
        style={{ paddingLeft: depth * 12 + 2 }}
      >
        {abierta ? (
          <ChevronDown className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
        )}
        {abierta ? (
          <FolderOpen className="w-3.5 h-3.5 shrink-0 text-accent-soft" />
        ) : (
          <Folder className="w-3.5 h-3.5 shrink-0 text-accent-soft" />
        )}
        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
        {cargando && <RefreshCw className="h-3 w-3 shrink-0 animate-spin text-zinc-600" />}
      </button>
      {abierta && fallo && (
        <p
          className="py-0.5 pr-1.5 text-[11px] leading-snug text-red-400/90"
          style={{ paddingLeft: (depth + 1) * 12 + 22 }}
        >
          {fallo}
        </p>
      )}
      {abierta &&
        hijos?.map((h) => (
          <Rama
            key={h.path}
            projectId={projectId}
            entry={h}
            depth={depth + 1}
            abiertas={abiertas}
            onAlternar={onAlternar}
            onAddFile={onAddFile}
            onVer={onVer}
            onMenu={onMenu}
            refresco={refresco}
            activo={activo}
          />
        ))}
    </div>
  );
}

function Resultados({
  paths,
  onAddFile,
  onVer,
  onMenu,
}: {
  paths: string[];
  onAddFile?: (ruta: string, nombre: string) => void;
  onVer?: (entry: FileEntry) => void;
  onMenu: (x: number, y: number, entry: FileEntry) => void;
}) {
  return (
    <div className="px-1 py-1.5 space-y-px">
      {paths.map((p) => {
        const name = p.split("/").pop() ?? p;
        const dir = p.slice(0, p.length - name.length).replace(/\/$/, "");
        const { Icon, className } = fileIcon(name);
        // La búsqueda devuelve rutas peladas: sin tamaño que enseñar.
        const entrada: FileEntry = { name, path: p, isDir: false, size: 0 };
        return (
          <div
            key={p}
            className="group/fila flex w-full items-center gap-1.5 rounded-chip px-1.5 py-1 text-xs text-zinc-400 transition-colors hover:bg-base-hover hover:text-zinc-100"
            onContextMenu={(e) => {
              e.preventDefault();
              onMenu(e.clientX, e.clientY, entrada);
            }}
          >
            <button
              type="button"
              onClick={() => onVer?.(entrada)}
              onDoubleClick={() => onAddFile?.(p, name)}
              title={t("Ver {n} · doble clic lo añade al mensaje", { n: name })}
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
            >
              <Icon className={`w-3.5 h-3.5 shrink-0 ${className}`} />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{name}</span>
                {dir && <span className="block truncate text-[10px] text-zinc-600">{dir}</span>}
              </span>
            </button>
            {onAddFile && (
              <button
                type="button"
                onClick={() => onAddFile(p, name)}
                title={t("Añadir {n} al mensaje", { n: name })}
                className="shrink-0 rounded p-0.5 text-zinc-600 opacity-0 transition-opacity hover:text-zinc-100 focus-visible:opacity-100 group-hover/fila:opacity-100"
              >
                <Plus className="h-3 w-3" />
              </button>
            )}
          </div>
        );
      })}
      {paths.length === 0 && (
        <p className="px-2 py-2 text-[11px] text-zinc-600">{t("Sin coincidencias.")}</p>
      )}
    </div>
  );
}

interface Props {
  projectId: string | null;
  /** Raíz absoluta del proyecto, para el Explorador y para copiar rutas. */
  raiz: string;
  /** Se incrementa cuando el agente escribe archivos. */
  version?: number;
  onAddFile?: (ruta: string, nombre: string) => void;
  /** Clic derecho en una carpeta → abrir ESA carpeta como proyecto raíz. */
  onProyecto?: (ruta: string) => void;
  /** Clic derecho → añadir el nombre a la lista de ignoradas de los ajustes. */
  onIgnorar?: (nombre: string) => void;
}

export default function FileTree({
  projectId,
  raiz,
  version = 0,
  onAddFile,
  onProyecto,
  onIgnorar,
}: Props) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [fallo, setFallo] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<string[] | null>(null);
  // Las carpetas abiertas viven aquí, no en cada fila: así «colapsar todo» es
  // posible y un refresco no cierra lo que el usuario tenía mirando.
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());
  const [verOcultos, setVerOcultos] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; entry: FileEntry } | null>(null);
  const [nonce, setNonce] = useState(0);
  /** El menú del `⋯` del buscador: mandos de la lista, no de un archivo. */
  const [menuPanel, setMenuPanel] = useState<{ x: number; y: number } | null>(null);
  /** «Buscar aquí»: recorte de la búsqueda a una carpeta. Se saca del clic
   *  derecho del árbol y se quita con la X de la cinta de abajo. */
  const [dentro, setDentro] = useState<{ path: string; nombre: string } | null>(null);
  const ultimaConsulta = useRef("");
  /** Ruta relativa del archivo abierto en la vista previa; `null` la cierra. */
  const [previa, setPrevia] = useState<string | null>(null);
  /** Alto del cajón de la vista previa, en px. Se lee del `localStorage` al montar
   *  y se guarda al soltar el tirador (no en cada píxel del arrastre). */
  const [alto, setAlto] = useState(() => {
    const guardado = Number(localStorage.getItem(CLAVE_ALTO));
    return Number.isFinite(guardado) && guardado >= ALTO_MIN ? guardado : ALTO_DEF;
  });
  /** El techo del cajón depende del alto del panel: no puede comerse el árbol. */
  const cajaRef = useRef<HTMLDivElement>(null);
  const [datos, setDatos] = useState<Previa | null>(null);
  const [falloPrevia, setFalloPrevia] = useState<string | null>(null);

  // Cambio de proyecto: se parte de cero. El refresco por `version` NO pasa por
  // aquí, y esa era la causa del parpadeo: vaciar la lista y volver a llenarla
  // en dos tiempos hacía que el árbol saltara en cada archivo que escribía el
  // agente, cerrando además las carpetas abiertas.
  useEffect(() => {
    setEntries([]);
    setAbiertas(new Set());
    setQuery("");
    setFallo(null);
    setPrevia(null);
    setDentro(null);
  }, [projectId]);

  /** La vista previa. Va con `version` en las dependencias: si el agente
   *  reescribe justo el archivo que estás mirando, lo que se ve se actualiza en
   *  vez de quedarse en el estado anterior. */
  useEffect(() => {
    if (!projectId || !previa) return;
    let vivo = true;
    setDatos(null);
    setFalloPrevia(null);
    void invoke<Previa>("preview_project_file", { projectId, relativePath: previa }).then(
      (r) => vivo && setDatos(r),
      (e) => vivo && setFalloPrevia(String(e)),
    );
    return () => {
      vivo = false;
    };
  }, [projectId, previa, version]);

  useEffect(() => {
    if (!projectId) return;
    let cancelado = false;
    void invoke<FileEntry[]>("list_project_dir", { projectId, relativePath: "" })
      .then((res) => {
        if (!cancelado) {
          setEntries(res);
          setFallo(null);
        }
      })
      .catch((e) => {
        // Se deja lo que había en pantalla y se dice qué pasó.
        if (!cancelado) setFallo(String(e));
      });
    return () => {
      cancelado = true;
    };
  }, [projectId, version, nonce]);

  useEffect(() => {
    if (!projectId || query.trim().length < 2) {
      setResults(null);
      return;
    }
    let cancelado = false;
    // «Buscando…» solo cuando cambia lo escrito. Volviendo a poner la lista a
    // null en cada refresco del agente, el panel se vaciaba y se llenaba a la
    // vista cada vez que escribía un archivo: era el parpadeo que quedaba aquí.
    if (query !== ultimaConsulta.current) setResults(null);
    ultimaConsulta.current = query;
    // `temporizador`, no `t`: así no pisa la función de traducción del módulo,
    // que es justo lo que rompe cualquier llamada que se añada aquí más tarde.
    const temporizador = setTimeout(() => {
      void invoke<string[]>("search_project_files", {
        projectId,
        query,
        dentro: dentro?.path ?? null,
      })
        .then((res) => {
          if (!cancelado) setResults(res);
        })
        .catch(() => {
          if (!cancelado) setResults([]);
        });
    }, 250);
    return () => {
      cancelado = true;
      clearTimeout(temporizador);
    };
  }, [projectId, query, version, dentro]);

  // Esc cierra la vista previa, que es lo que está delante. Se para la
  // propagación para no cerrar también el panel o el modo foco de paso.
  useEffect(() => {
    if (!previa) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setPrevia(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [previa]);

  if (!projectId) return null;

  const buscando = query.trim().length >= 2;
  const visibles = verOcultos ? entries : entries.filter((e) => !e.name.startsWith("."));

  const alternar = (ruta: string) =>
    setAbiertas((prev) => {
      const s = new Set(prev);
      if (s.has(ruta)) s.delete(ruta);
      else s.add(ruta);
      return s;
    });

  const abrirMenu = (x: number, y: number, entry: FileEntry) => setMenu({ x, y, entry });

  const itemsMenu = (e: FileEntry): MenuItem[] => {
    const absolutaDe = absoluta(raiz, e.path);
    const salida: MenuItem[] = [];
    if (e.isDir) {
      // Promover la subcarpeta: con `Documentos` o una carpeta de descargas como
      // raíz, lo que uno quiere no es el árbol de arriba sino la carpeta de
      // dentro. Es el mismo `open_project` de «Abrir carpeta», sin el diálogo.
      if (onProyecto) {
        salida.push({
          label: t("Usar esta carpeta como proyecto"),
          detail: absolutaDe,
          icon: <FolderInput className="h-3.5 w-3.5" />,
          onSelect: () => onProyecto(absolutaDe),
        });
      }
      if (onIgnorar) {
        salida.push({
          label: t("Ocultar «{n}» del árbol", { n: e.name }),
          // Se dice de una vez que la lista es global: lo que se oculta aquí no se
          // oculta solo en este proyecto, y descubrirlo más tarde es peor.
          detail: t("Vale para todos los proyectos · se quita en Ajustes → Agente"),
          icon: <EyeOff className="h-3.5 w-3.5" />,
          onSelect: () => {
            onIgnorar(e.name);
            setNonce((x) => x + 1);
          },
        });
      }
      salida.push({
        label: t("Buscar solo aquí"),
        detail: dentro
          ? t("Ahora mismo: {n}", { n: dentro.nombre })
          : t("Ahora mismo: todo el proyecto"),
        icon: <Search className="h-3.5 w-3.5" />,
        onSelect: () => setDentro({ path: e.path, nombre: e.name }),
      });
    }
    if (!e.isDir) {
      salida.push({
        label: t("Ver el contenido"),
        icon: <Eye className="h-3.5 w-3.5" />,
        onSelect: () => setPrevia(e.path),
      });
      if (onAddFile) {
        salida.push({
          label: t("Añadir al mensaje"),
          icon: <Plus className="h-3.5 w-3.5" />,
          onSelect: () => onAddFile(e.path, e.name),
        });
      }
    }
    salida.push(
      {
        label: t("Mostrar en el Explorador"),
        icon: <ExternalLink className="h-3.5 w-3.5" />,
        onSelect: () => void revealItemInDir(absolutaDe).catch(() => {}),
      },
      {
        label: t("Copiar la ruta"),
        detail: absolutaDe,
        icon: <Copy className="h-3.5 w-3.5" />,
        onSelect: () => void navigator.clipboard.writeText(absolutaDe).catch(() => {}),
      },
    );
    return salida;
  };

  const boton =
    "shrink-0 rounded p-1 text-zinc-500 transition-colors hover:bg-base-hover hover:text-zinc-200";

  // Techo del cajón: deja al menos ~160 px de árbol y buscador por encima. Se lee
  // en cada render para que, si el panel se encoge, el alto guardado no se coma
  // el árbol (el `?? 700` es solo el primer render, antes de existir la medida).
  const techo = Math.max(ALTO_MIN + 40, (cajaRef.current?.clientHeight ?? 700) - 160);

  return (
    <div ref={cajaRef} className="h-full flex flex-col min-h-0">
      {/* Una sola raya: la cabecera del panel cierra, el buscador va suelto
          debajo. Con la suya propia parecían dos barras distintas.
          MANDOS: siguen DENTRO de la caja y siguen cediendo el sitio a la consulta
          (al escribir no hay nada que recargar todavía), pero son DOS en vez de
          tres: «colapsar abiertas» y «los nombres con punto» viven ahora en el `⋯`,
          que eran los dos que se usan una vez por sesión. Medido con el panel a
          300 px, reproduciendo el marcado: el campo pasa de 197 px a 221 px de hueco
          útil en reposo, y al escribir tiene 247 (antes también 247, porque los
          mandos ya se apartaban), así que no se le quita lectura a la ruta. */}
      <div className="shrink-0 px-2 pt-2 pb-1.5">
        <div className="flex items-center gap-1 rounded-lg border border-base-border bg-base py-0.5 pl-2 pr-1 transition-colors focus-within:border-accent/60">
          <Search className="w-3 h-3 shrink-0 text-zinc-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Buscar archivos…")}
            aria-label={t("Buscar archivos")}
            className="w-full min-w-0 bg-transparent py-1 text-xs outline-none placeholder:text-zinc-600"
          />
          {query ? (
            <button onClick={() => setQuery("")} className={boton} title={t("Limpiar")}>
              <X className="h-3 w-3" />
            </button>
          ) : (
            <>
              <button
                onClick={() => setNonce((n) => n + 1)}
                className={boton}
                title={t("Volver a leer la carpeta")}
              >
                <RefreshCw className="h-3 w-3" />
              </button>
              <button
                onClick={(ev) => {
                  const r = ev.currentTarget.getBoundingClientRect();
                  setMenuPanel({ x: r.right - 176, y: r.bottom + 4 });
                }}
                className={boton}
                title={t("Más mandos del árbol")}
                aria-expanded={menuPanel !== null}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
        {/* La cinta del recorte: si busca solo en una carpeta tiene que estar
            escrito arriba, no solo notado en menos resultados. */}
        {dentro && (
          <div className="mt-1.5 flex items-center gap-1.5 rounded-chip border border-accent/40 bg-accent/[0.08] py-0.5 pr-0.5 pl-1.5 text-[11px] text-accent-soft">
            <Folder className="h-3 w-3 shrink-0" />
            <span className="min-w-0 flex-1 truncate" title={dentro.path}>
              {t("en {n}", { n: dentro.nombre })}
            </span>
            <button
              onClick={() => setDentro(null)}
              title={t("Volver a buscar en todo el proyecto")}
              className="shrink-0 rounded p-0.5 transition-colors hover:bg-base-hover"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {fallo && !buscando && (
          <p className="px-3 py-1.5 text-[11px] leading-snug text-red-400/90">{fallo}</p>
        )}
        {buscando ? (
          results === null ? (
            <p className="px-3 py-2 text-[11px] text-zinc-600">{t("Buscando…")}</p>
          ) : (
            <Resultados
              paths={results}
              onAddFile={onAddFile}
              onVer={(e) => setPrevia(e.path)}
              onMenu={abrirMenu}
            />
          )
        ) : (
          <>
            {visibles.length === 0 && (
              <p className="px-3 py-2 text-[11px] text-zinc-600">
                {entries.length > 0 ? t("Todo empieza por punto.") : t("Carpeta vacía.")}
              </p>
            )}
            {visibles.map((e) => (
              <Rama
                key={e.path}
                projectId={projectId}
                entry={e}
                depth={0}
                abiertas={abiertas}
                onAlternar={alternar}
                onAddFile={onAddFile}
                onVer={(x) => setPrevia(x.path)}
                onMenu={abrirMenu}
                refresco={version + nonce}
                activo={previa}
              />
            ))}
          </>
        )}
      </div>

      {/* La vista previa vive DENTRO del panel y se puede subir y bajar con el
          tirador de encima: se puede leer un archivo y seguir viendo el árbol, sin
          abrir otra ventana ni perder de vista dónde estaba. Antes su alto lo
          decidía el contenido (tope del 55 %), así que un archivo corto daba un
          cajón de dos líneas y uno largo se lo comía casi todo. */}
      {previa && (
        <>
          <TiradorAlto
            alto={alto}
            min={ALTO_MIN}
            max={techo}
            def={ALTO_DEF}
            onAlto={setAlto}
            onCommit={(px) => {
              setAlto(px);
              localStorage.setItem(CLAVE_ALTO, String(px));
            }}
          />
          <div
            className="pozo flex min-h-0 shrink-0 flex-col border-t border-base-border bg-base"
            style={{ height: Math.min(alto, techo) }}
          >
          <div className="flex shrink-0 items-center gap-1 px-2 py-1">
            <FileText className="h-3 w-3 shrink-0 text-zinc-500" />
            <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-300" title={previa}>
              {previa.split("/").pop()}
            </span>
            {datos && (
              <span className="shrink-0 text-[10px] tabular-nums text-zinc-600">
                {tamano(datos.bytes)} · {t("{n} líneas", { n: datos.lineas })}
              </span>
            )}
            {onAddFile && (
              <button
                onClick={() => onAddFile(previa, previa.split("/").pop() ?? previa)}
                title={t("Añadir al mensaje")}
                className={boton}
              >
                <Plus className="h-3 w-3" />
              </button>
            )}
            <button
              onClick={() => setPrevia(null)}
              title={t("Cerrar la vista previa")}
              className={boton}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto border-t border-base-border/60">
            {falloPrevia && (
              <p className="px-2 py-2 text-[11px] leading-snug text-red-400/90">{falloPrevia}</p>
            )}
            {!falloPrevia && !datos && (
              <p className="px-2 py-2 text-[11px] text-zinc-600">{t("Leyendo…")}</p>
            )}
            {datos && (
              <>
                <pre className="whitespace-pre px-2 py-1.5 font-mono text-[11px] leading-relaxed text-zinc-300">
                  {datos.texto}
                </pre>
                {datos.truncado && (
                  <p className="px-2 pb-2 text-[10px] text-zinc-600">
                    {t("Se enseña el principio: el archivo es más grande que la vista previa.")}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
        </>
      )}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={itemsMenu(menu.entry)} onClose={() => setMenu(null)} />
      )}
      {menuPanel && (
        <ContextMenu
          x={menuPanel.x}
          y={menuPanel.y}
          items={[
            ...(abiertas.size > 0
              ? [
                  {
                    label: t("Colapsar las carpetas abiertas"),
                    icon: <ChevronsDownUp className="h-3.5 w-3.5" />,
                    onSelect: () => setAbiertas(new Set()),
                  },
                ]
              : []),
            {
              label: verOcultos
                ? t("Ocultar los nombres con punto")
                : t("Mostrar los nombres con punto"),
              icon: verOcultos ? (
                <EyeOff className="h-3.5 w-3.5" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              ),
              onSelect: () => setVerOcultos((v) => !v),
            },
          ]}
          onClose={() => setMenuPanel(null)}
        />
      )}
    </div>
  );
}
