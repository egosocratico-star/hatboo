import { t } from "../../i18n";
import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Eraser, FileText, Plus, Sparkles } from "lucide-react";
import { useChatStore } from "../../store/chatStore";
import { useWorkStore } from "../../store/workStore";
import Popover from "../Popover";
import type { Attachment } from "../../types";

interface Props {
  onPickFiles: (files: Attachment[]) => void;
  /** Insertar el texto de una plantilla en el cursor del compositor. */
  onInsertTemplate: (text: string) => void;
  disabled?: boolean;
}

/** El «+» de la vista de Trabajo: mismas piezas que en el chat, sin lo que aquí
 *  no aplica (imágenes —el agente no ve— ni exportar conversación). */
export default function WorkPlusMenu({ onPickFiles, onInsertTemplate, disabled }: Props) {
  const [open_, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const skills = useChatStore((s) => s.skills);
  const close = () => setOpen(false);

  const pickTextFiles = async () => {
    setNotice(null);
    const picked = await open({
      multiple: true,
      directory: false,
      title: t("Adjuntar archivos de texto"),
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

  const clearSession = async () => {
    const work = useWorkStore.getState();
    const sessionId = work.activeProjectId
      ? (work.tabs[work.activeProjectId]?.sessionId ?? null)
      : null;
    if (!sessionId) return;
    await invoke("clear_conversation_messages", { conversationId: sessionId });
    // Recarga desde la base de datos: así se van el plan y el registro de tools.
    await work.selectSession(sessionId);
    close();
  };

  const item =
    "w-full flex items-center gap-2.5 px-3 py-2 text-sm text-zinc-200 hover:bg-base-raised rounded-lg transition-colors text-left";

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title={t("Añadir")}
        className="grid place-items-center w-8 h-8 shrink-0 rounded-full border border-base-border text-zinc-400 hover:text-white hover:border-accent/50 disabled:opacity-40 transition-colors"
      >
        <Plus className="w-4 h-4" />
      </button>

      <Popover
        open={open_}
        anchorRef={triggerRef}
        onClose={close}
        width={256}
        cap={340}
        className="p-1.5"
      >
        <div className="px-2 pt-1 pb-1 text-[10px] uppercase tracking-wider text-zinc-500">
          {t("Añadir")}
        </div>
        <button onClick={() => void pickTextFiles()} className={item} disabled={busy}>
          <FileText className="w-4 h-4 text-accent-soft shrink-0" />
          <span className="flex-1">{busy ? t("Leyendo…") : t("Archivo de texto")}</span>
        </button>

        <div className="my-1.5 h-px bg-base-border" />
        <div className="px-2 pt-0.5 pb-1 text-[10px] uppercase tracking-wider text-zinc-500">
          {t("Plantillas")}
        </div>
        {skills.length === 0 ? (
          <div className={item + " opacity-45 cursor-not-allowed"} title={t("Créalas en Ajustes → Skills")}>
            <Sparkles className="w-4 h-4 text-zinc-500 shrink-0" />
            <span className="flex-1">{t("Aún no hay plantillas")}</span>
          </div>
        ) : (
          skills.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                onInsertTemplate(s.prompt);
                close();
              }}
              className={item}
              disabled={disabled}
              title={s.prompt}
            >
              <Sparkles className="w-4 h-4 text-accent-soft shrink-0" />
              <span className="flex-1 truncate">{s.name}</span>
              {s.enabled && <span className="text-[10px] text-accent-soft/80">siempre</span>}
            </button>
          ))
        )}

        <div className="my-1.5 h-px bg-base-border" />
        <div className="px-2 pt-0.5 pb-1 text-[10px] uppercase tracking-wider text-zinc-500">
          {t("Sesión")}
        </div>
        <button onClick={() => void clearSession()} className={item + " hover:text-red-300"}>
          <Eraser className="w-4 h-4 shrink-0" />
          <span className="flex-1">{t("Limpiar esta sesión")}</span>
        </button>

        {notice && (
          <div className="px-2.5 py-1.5 mt-1 text-[11px] text-red-400">{notice}</div>
        )}
      </Popover>
    </div>
  );
}
