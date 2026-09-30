import { t } from "../../i18n";
import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Download, Ellipsis, Eraser, Paperclip, Plus, Sparkles, ChevronRight } from "lucide-react";
import { useChatStore } from "../../store/chatStore";
import { useWorkStore } from "../../store/workStore";
import Popover from "../Popover";
import MenuAtras from "../MenuAtras";
import type { Attachment } from "../../types";

type Cara = "anadir" | "mas";

interface Props {
  onPickFiles: (files: Attachment[]) => void;
  /** Insertar el texto de una plantilla en el cursor del compositor. */
  onInsertTemplate: (text: string) => void;
  disabled?: boolean;
}

/** El «+» de la vista de Trabajo: las mismas caras que en el chat, sin lo que aquí
 *  no aplica. Sin Imagen y sin Captura porque el agente no ve; sin Exportar porque
 *  la sesión de trabajo se exporta por el panel de Cambios. */
export default function WorkPlusMenu({ onPickFiles, onInsertTemplate, disabled }: Props) {
  const [cara, setCara] = useState<Cara>("anadir");
  const [open_, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const skills = useChatStore((s) => s.skills);
  const close = () => setOpen(false);

  const abrir = (v: boolean) => {
    setOpen(v);
    if (v) {
      setCara("anadir");
      setNotice(null);
    }
  };

  /** Escape: primero deshace la cara; cierra si ya estaba en la de arriba. */
  const escapar = () => {
    if (cara !== "anadir") setCara("anadir");
    else close();
  };

  /** Plantilla instalada desde un .md ajeno, sin salir a Ajustes. */
  const instalarPlantilla = async () => {
    setNotice(null);
    const ruta = await open({
      multiple: false,
      directory: false,
      title: t("Elige la plantilla"),
      filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }],
    });
    if (!ruta) return;
    try {
      await invoke("install_skill", { path: ruta });
      await useChatStore.getState().loadSkills();
      setNotice(t("Plantilla instalada."));
    } catch (e) {
      setNotice(String(e));
    }
  };

  /** El mismo selector del chat. Aquí las imágenes se descartan con aviso: el
   *  agente trabaja con texto y con archivos, no mira fotos. */
  const pickFiles = async () => {
    setNotice(null);
    const picked = await open({
      multiple: true,
      directory: false,
      title: t("Adjuntar archivos"),
    });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    setBusy(true);
    try {
      const results: Attachment[] = [];
      const failures: string[] = [];
      for (const path of paths) {
        try {
          const a = await invoke<Attachment>("read_attachment", { path });
          if (a.imageMediaType) {
            failures.push(t("«{n}» es una imagen: el agente no mira fotos.", { n: a.name }));
            continue;
          }
          results.push(a);
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
        onClick={() => abrir(!open_)}
        disabled={disabled}
        title={t("Añadir")}
        aria-expanded={open_}
        aria-haspopup="true"
        className="grid place-items-center w-8 h-8 shrink-0 rounded-full border border-base-border text-zinc-400 hover:text-white hover:border-accent/50 disabled:opacity-40 transition-colors"
      >
        <Plus className="w-4 h-4" />
      </button>

      <Popover
        open={open_}
        anchorRef={triggerRef}
        onClose={close}
        onEscape={escapar}
        atraparFoco
        etiqueta={t("Añadir")}
        reenfoca={cara}
        width={244}
        cap={400}
        className="p-1.5 min-h-[212px]"
      >
        {cara === "anadir" && (
          <>
            <button onClick={() => void pickFiles()} className={item} disabled={busy}>
              <Paperclip className="w-4 h-4 text-accent-soft shrink-0" />
              <span className="flex-1">{busy ? t("Leyendo…") : t("Archivos")}</span>
              <span className="shrink-0 text-[10px] text-zinc-600">{t("solo texto")}</span>
            </button>
            <div className="my-1.5 h-px bg-base-border" />
            <button onClick={() => setCara("mas")} className={item}>
              <Ellipsis className="w-4 h-4 text-accent-soft shrink-0" />
              <span className="flex-1">{t("Más")}</span>
              <span className="text-[10px] text-zinc-600">{t("plantillas y sesión")}</span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
            </button>
          </>
        )}
        {cara === "mas" && (
          <>
        <MenuAtras hacia={t("Añadir")} onClick={() => setCara("anadir")} />
        <div className="px-2 pt-0.5 pb-1 text-[10px] uppercase tracking-wider text-zinc-500">
          {t("Plantillas")}
        </div>
        {skills.length === 0 ? (
          <>
            <button
              onClick={() => {
                const st = useChatStore.getState();
                st.setSettingsCat("skills");
                st.setView("settings");
                close();
              }}
              className={item}
            >
              <Plus className="w-4 h-4 text-accent-soft shrink-0" />
              <span className="flex-1">{t("Crear plantilla")}</span>
              <span className="shrink-0 text-[10px] text-zinc-500">{t("Ajustes → Skills")}</span>
            </button>
            <button onClick={() => void instalarPlantilla()} className={item}>
              <Download className="w-4 h-4 text-accent-soft shrink-0" />
              <span className="flex-1">{t("Instalar desde un .md")}</span>
            </button>
          </>
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
              {s.enabled && <span className="text-[10px] text-accent-soft/80">{t("siempre")}</span>}
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
          </>
        )}

        {notice && (
          <div role="alert" className="px-2.5 py-1.5 mt-1 text-[11px] text-red-400">
            {notice}
          </div>
        )}
      </Popover>
    </div>
  );
}
