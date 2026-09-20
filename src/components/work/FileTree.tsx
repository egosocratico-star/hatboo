import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronDown, ChevronRight, File, Folder } from "lucide-react";
import type { FileEntry } from "../../types";

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
    return (
      <div
        className="flex items-center gap-1.5 py-0.5 text-xs text-zinc-400 hover:text-zinc-200"
        style={{ paddingLeft: depth * 14 + 6 }}
      >
        <File className="w-3.5 h-3.5 shrink-0 text-zinc-600" />
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
        className="w-full flex items-center gap-1 py-0.5 text-xs text-zinc-300 hover:text-white"
        style={{ paddingLeft: depth * 14 + 2 }}
      >
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
        )}
        <Folder className="w-3.5 h-3.5 shrink-0 text-accent-soft" />
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

export default function FileTree({ projectId }: { projectId: string | null }) {
  const [entries, setEntries] = useState<FileEntry[]>([]);

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
  }, [projectId]);

  if (!projectId) return null;

  return (
    <div className="h-full overflow-y-auto py-2">
      {entries.length === 0 && (
        <p className="px-3 py-2 text-[11px] text-zinc-600">Carpeta vacía.</p>
      )}
      {entries.map((e) => (
        <TreeNode key={e.path} projectId={projectId} entry={e} depth={0} />
      ))}
    </div>
  );
}
