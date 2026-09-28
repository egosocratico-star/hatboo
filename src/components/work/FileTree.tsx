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
  FolderOpen,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import ContextMenu, { type MenuItem } from "../ContextMenu";
import type { FileEntry } from "../../types";

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
}: RamaProps) {
  const abierta = abiertas.has(entry.path);
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
    // cosas distintas y antes solo se podía hacer la segunda. El «+» va encima
    // del tamaño, que es lo menos mirado de la fila, y no desaparece con el
    // foco del teclado.
    return (
      <div
        className="group/fila relative flex w-full items-center gap-1.5 py-[3px] pr-1 text-xs text-zinc-400 transition-colors hover:bg-base-hover hover:text-zinc-100"
        style={{ paddingLeft: depth * 12 + 6 }}
        onContextMenu={(e) => {
          e.preventDefault();
          onMenu(e.clientX, e.clientY, entry);
        }}
      >
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
        <span className="shrink-0 text-[10px] tabular-nums text-zinc-700">
          {tamano(entry.size)}
        </span>
        {onAddFile && (
          <button
            type="button"
            onClick={() => onAddFile(entry.path, entry.name)}
            title={t("Añadir {n} al mensaje", { n: entry.name })}
            className="absolute right-1 shrink-0 rounded bg-base-hover p-0.5 text-zinc-600 opacity-0 transition-opacity hover:text-zinc-100 focus-visible:opacity-100 group-hover/fila:opacity-100"
          >
            <Plus className="h-3 w-3" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => onAlternar(entry.path)}
        onContextMenu={(e) => {
          e.preventDefault();
          onMenu(e.clientX, e.clientY, entry);
        }}
        className="flex w-full items-center gap-1.5 py-[3px] pr-1.5 text-left text-xs text-zinc-300 transition-colors hover:bg-base-hover"
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
          style={{ paddingLeft: (depth + 1) * 12 + 6 }}
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
            className="group/fila flex w-full items-center gap-1.5 rounded px-1 py-1 text-xs text-zinc-400 transition-colors hover:bg-base-hover hover:text-zinc-100"
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
}

export default function FileTree({ projectId, raiz, version = 0, onAddFile }: Props) {
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
  const ultimaConsulta = useRef("");
  /** Ruta relativa del archivo abierto en la vista previa; `null` la cierra. */
  const [previa, setPrevia] = useState<string | null>(null);
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
      void invoke<string[]>("search_project_files", { projectId, query })
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
  }, [projectId, query, version]);

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

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Una sola raya: la cabecera del panel cierra, el buscador va suelto
          debajo. Con la suya propia parecían dos barras distintas. */}
      <div className="shrink-0 px-2 pt-2 pb-1.5">
        <div className="flex items-center gap-1 rounded-lg border border-base-border bg-base pr-1 pl-2 transition-colors focus-within:border-accent/60">
          <Search className="w-3 h-3 shrink-0 text-zinc-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Buscar archivos…")}
            aria-label={t("Buscar archivos")}
            className="w-full min-w-0 bg-transparent py-1.5 text-xs outline-none placeholder:text-zinc-600"
          />
          {query ? (
            <button onClick={() => setQuery("")} className={boton} title={t("Limpiar")}>
              <X className="w-3 h-3" />
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
                onClick={() => setAbiertas(new Set())}
                className={boton}
                title={t("Colapsar las carpetas abiertas")}
                disabled={abiertas.size === 0}
              >
                <ChevronsDownUp className="h-3 w-3" />
              </button>
              <button
                onClick={() => setVerOcultos((v) => !v)}
                className={boton}
                title={
                  verOcultos ? t("Ocultar los nombres con punto") : t("Mostrar los nombres con punto")
                }
                aria-pressed={verOcultos}
              >
                {verOcultos ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              </button>
            </>
          )}
        </div>
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
              />
            ))}
          </>
        )}
      </div>

      {/* La vista previa vive DENTRO del panel y se come como mucho la mitad:
          se puede leer un archivo y seguir viendo el árbol, sin abrir otra
          ventana ni perder de vista dónde estaba. */}
      {previa && (
        <div className="flex max-h-[55%] min-h-0 shrink-0 flex-col border-t border-base-border bg-base">
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
      )}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={itemsMenu(menu.entry)} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}
