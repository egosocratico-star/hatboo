import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ChevronDown,
  ChevronRight,
  File,
  FileCode,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
  Search,
  X,
} from "lucide-react";
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

interface NodeProps {
  projectId: string;
  entry: FileEntry;
  depth: number;
}

function TreeNode({ projectId, entry, depth }: NodeProps) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<FileEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (children !== null || loading) return;
    setLoading(true);
    try {
      const entries = await invoke<FileEntry[]>("list_project_dir", {
        projectId,
        relativePath: entry.path,
      });
      setChildren(entries);
    } catch {
      setChildren([]);
    } finally {
      setLoading(false);
    }
  }, [children, loading, entry.path, projectId]);

  if (!entry.isDir) {
    const { Icon, className } = fileIcon(entry.name);
    return (
      <div
        className="flex items-center gap-1.5 py-0.5 text-xs text-zinc-400 hover:text-zinc-200"
        style={{ paddingLeft: depth * 14 + 6 }}
      >
        <Icon className={`w-3.5 h-3.5 shrink-0 ${className}`} />
        <span className="truncate">{entry.name}</span>
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) void load();
        }}
        className="w-full flex items-center gap-1 py-0.5 text-xs text-zinc-300 hover:text-layer"
        style={{ paddingLeft: depth * 14 + 2 }}
      >
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
        )}
        {open ? (
          <FolderOpen className="w-3.5 h-3.5 shrink-0 text-accent-soft" />
        ) : (
          <Folder className="w-3.5 h-3.5 shrink-0 text-accent-soft" />
        )}
        <span className="truncate">{entry.name}</span>
      </button>
      {open && loading && (
        <div className="text-[10px] text-zinc-600" style={{ paddingLeft: (depth + 1) * 14 + 6 }}>
          Cargando…
        </div>
      )}
      {open &&
        children?.map((child) => (
          <TreeNode key={child.path} projectId={projectId} entry={child} depth={depth + 1} />
        ))}
    </div>
  );
}

function SearchResults({ paths }: { paths: string[] }) {
  return (
    <div className="px-1 py-2 space-y-0.5">
      {paths.map((p) => {
        const name = p.split("/").pop() ?? p;
        const dir = p.slice(0, p.length - name.length).replace(/\/$/, "");
        const { Icon, className } = fileIcon(name);
        return (
          <div
            key={p}
            className="flex items-center gap-1.5 px-1 py-0.5 text-xs text-zinc-400 hover:text-zinc-200"
            title={p}
          >
            <Icon className={`w-3.5 h-3.5 shrink-0 ${className}`} />
            <span className="truncate">{name}</span>
            {dir && <span className="truncate text-[10px] text-zinc-600">{dir}</span>}
          </div>
        );
      })}
      {paths.length === 0 && (
        <p className="px-2 py-2 text-[11px] text-zinc-600">Sin coincidencias.</p>
      )}
    </div>
  );
}

export default function FileTree({
  projectId,
  version = 0,
}: {
  projectId: string | null;
  version?: number;
}) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEntries([]);
    if (!projectId) return;
    void invoke<FileEntry[]>("list_project_dir", { projectId, relativePath: "" })
      .then((res) => {
        if (!cancelled) setEntries(res);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, version]);

  useEffect(() => {
    setResults(null);
    if (!projectId || query.trim().length < 2) return;
    let cancelled = false;
    const t = setTimeout(() => {
      void invoke<string[]>("search_project_files", { projectId, query })
        .then((res) => {
          if (!cancelled) setResults(res);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [projectId, query, version]);

  if (!projectId) return null;

  const searching = query.trim().length >= 2;

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="shrink-0 px-2 py-2 border-b border-base-border/60">
        <div className="flex items-center gap-1.5 rounded-md border border-base-border bg-base px-2 py-1 focus-within:border-accent/70">
          <Search className="w-3 h-3 shrink-0 text-zinc-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar archivos…"
            className="w-full min-w-0 bg-transparent text-xs outline-none placeholder:text-zinc-600"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="shrink-0 text-zinc-500 hover:text-layer"
              title="Limpiar"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {searching ? (
          results === null ? (
            <p className="px-3 py-2 text-[11px] text-zinc-600">Buscando…</p>
          ) : (
            <SearchResults paths={results} />
          )
        ) : (
          <>
            {entries.length === 0 && (
              <p className="px-3 py-2 text-[11px] text-zinc-600">Carpeta vacía.</p>
            )}
            {entries.map((e) => (
              <TreeNode key={e.path} projectId={projectId} entry={e} depth={0} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
