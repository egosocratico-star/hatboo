import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  FileText,
  FolderKanban,
  Image as ImageIcon,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useChatStore } from "../store/chatStore";
import type { Attachment } from "../types";

interface Props {
  onPickFiles: (files: Attachment[]) => void;
  disabled?: boolean;
}

export default function ChatPlusMenu({ onPickFiles, disabled }: Props) {
  const [open_, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open_) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open_]);

  const close = () => setOpen(false);

  const pickTextFiles = async () => {
    setNotice(null);
    const picked = await open({
      multiple: true,
      directory: false,
      title: "Adjuntar archivos de texto",
    });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    setBusy(true);
    try {
      const results: Attachment[] = [];
      const failures: string[] = [];
      for (const path of paths) {
        try {
          results.push(await invoke<Attachment>("read_attachment", { path }));
        } catch (e) {
          failures.push(String(e));
        }
      }
      if (results.length > 0) onPickFiles(results);
      if (failures.length > 0) setNotice(failures[0]);
    } finally {
      setBusy(false);
      close();
    }
  };

  const goWork = () => {
    useChatStore.getState().setView("work");
    close();
  };

  const clearConversation = async () => {
    await useChatStore.getState().clearMessages();
    close();
  };

  const canClear = useChatStore(
    (s) => s.activeId !== null && s.messages.length > 0,
  );

  const item =
    "w-full flex items-center gap-2.5 px-3 py-2 text-sm text-zinc-200 hover:bg-base-raised rounded-lg transition-colors text-left";

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title="Añadir"
        className="p-2 rounded-lg border border-base-border text-zinc-400 hover:text-white hover:border-accent/50 disabled:opacity-40 transition-colors"
      >
        <Plus className="w-4 h-4" />
      </button>

      {open_ && (
        <div className="absolute bottom-full mb-2 left-0 z-40 w-64 rounded-xl border border-base-border bg-base-raised shadow-2xl p-1.5">
          <div className="px-2 pt-1 pb-1 text-[10px] uppercase tracking-wider text-zinc-500">
            Añadir
          </div>
          <button onClick={() => void pickTextFiles()} className={item} disabled={busy}>
            <FileText className="w-4 h-4 text-accent-soft shrink-0" />
            <span className="flex-1">{busy ? "Leyendo…" : "Archivo de texto"}</span>
          </button>
          <div
            className={item + " opacity-45 cursor-not-allowed"}
            title="Adjuntar imágenes llegará en una próxima versión"
          >
            <ImageIcon className="w-4 h-4 text-zinc-500 shrink-0" />
            <span className="flex-1">Imagen</span>
            <span className="text-[10px] text-zinc-500">pronto</span>
          </div>

          <div className="my-1.5 h-px bg-base-border" />
          <div className="px-2 pt-0.5 pb-1 text-[10px] uppercase tracking-wider text-zinc-500">
            Sesión
          </div>
          <button onClick={goWork} className={item}>
            <FolderKanban className="w-4 h-4 text-accent-soft shrink-0" />
            <span className="flex-1">Proyectos</span>
          </button>
          <button onClick={goWork} className={item}>
            <ShieldCheck className="w-4 h-4 text-accent-soft shrink-0" />
            <span className="flex-1">Permisos de herramientas</span>
          </button>
          <button
            onClick={() => void clearConversation()}
            className={item + (canClear ? " hover:text-red-300" : " opacity-45 cursor-not-allowed")}
            disabled={!canClear}
          >
            <Trash2 className="w-4 h-4 shrink-0" />
            <span className="flex-1">Limpiar conversación</span>
          </button>

          {notice && (
            <div className="px-2.5 py-1.5 mt-1 text-[11px] text-red-400">{notice}</div>
          )}
        </div>
      )}
    </div>
  );
}
