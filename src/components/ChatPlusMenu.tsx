import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  Check,
  Code2,
  Download,
  FileText,
  FolderKanban,
  Github,
  Camera,
  Globe,
  Image as ImageIcon,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useChatStore } from "../store/chatStore";
import Popover from "./Popover";
import type { Attachment, Settings } from "../types";

interface Props {
  onPickFiles: (files: Attachment[]) => void;
  /** Insertar el texto de una plantilla en el mensaje, donde esté el cursor. */
  onInsertTemplate: (text: string) => void;
  disabled?: boolean;
}

const VISION_LOCAL_KEYWORDS = [
  "vl",
  "vision",
  "llava",
  "minicpm-v",
  "moondream",
  "gemma3",
];

function supportsVision(settings: Settings | null): boolean {
  if (!settings) return false;
  if (settings.activeProvider === "anthropic" || settings.activeProvider === "openai") {
    return true;
  }
  const model = settings.localModel.toLowerCase();
  return VISION_LOCAL_KEYWORDS.some((k) => model.includes(k));
}

export default function ChatPlusMenu({ onPickFiles, onInsertTemplate, disabled }: Props) {
  const [open_, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [urlGitHub, setUrlGitHub] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const settings = useChatStore((s) => s.settings);
  const skills = useChatStore((s) => s.skills);
  const visionOk = supportsVision(settings);

  /** Conector activo/inactivo. Se lee el estado en el momento de escribir, como
   *  en ModeToggles: guardar el blob desde el render de este menú podía pisar un
   *  cambio hecho mientras estaba abierto. */
  const toggleConector = (key: "codeMode" | "webSearch") => {
    const actual = useChatStore.getState().settings;
    if (!actual) return;
    void useChatStore
      .getState()
      .saveSettings({ ...actual, [key]: !actual[key] })
      .catch(() => {});
  };

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

  /** Pedir un archivo a GitHub y meterlo por la misma ruta que un adjunto del disco. */
  const traerDeGitHub = async () => {
    const url = (urlGitHub || "").trim();
    if (!url) return;
    setNotice(null);
    setOcupado(true);
    try {
      const adjunto = await invoke<Attachment>("fetch_github", { url });
      onPickFiles([adjunto]);
      setUrlGitHub(null);
      close();
    } catch (e) {
      setNotice(String(e));
    } finally {
      setOcupado(false);
    }
  };

  /** Captura la pantalla entera y la adjunta. El nombre lo pone aquí, que es
   *  donde hay hora local; el backend solo lo sanea. */
  const capturarPantalla = async () => {
    setNotice(null);
    setOcupado(true);
    try {
      const ahora = new Date().toISOString().slice(0, 16).replace("T", "_").replace(/:/g, "-");
      const adjunto = await invoke<Attachment>("capture_screen", { nombre: `captura-${ahora}` });
      onPickFiles([adjunto]);
      close();
    } catch (e) {
      setNotice(String(e));
    } finally {
      setOcupado(false);
    }
  };

  const pickImages = async () => {
    setNotice(null);
    const picked = await open({
      multiple: true,
      directory: false,
      title: "Adjuntar imágenes",
      filters: [
        {
          name: "Imágenes",
          extensions: ["png", "jpg", "jpeg", "gif", "webp"],
        },
      ],
    });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    setBusy(true);
    try {
      const results: Attachment[] = [];
      const failures: string[] = [];
      for (const path of paths) {
        try {
          results.push(
            await invoke<Attachment>("save_image_attachment", { path }),
          );
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

  const exportConversation = async () => {
    const state = useChatStore.getState();
    if (!state.activeId) return;
    setNotice(null);
    const title =
      state.conversations.find((c) => c.id === state.activeId)?.title ||
      "conversacion";
    const safeName = title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 60) || "conversacion";
    const path = await save({
      title: "Exportar conversación",
      defaultPath: `${safeName}.md`,
      filters: [
        { name: "Markdown", extensions: ["md"] },
        { name: "JSON", extensions: ["json"] },
      ],
    });
    if (!path) {
      close();
      return;
    }
    const format = path.toLowerCase().endsWith(".json") ? "json" : "markdown";
    try {
      await invoke("export_conversation", {
        conversationId: state.activeId,
        path,
        format,
      });
    } catch (e) {
      setNotice(String(e));
    }
    close();
  };

  const canClear = useChatStore(
    (s) => s.activeId !== null && s.messages.length > 0,
  );

  const item =
    "w-full flex items-center gap-2.5 px-3 py-2 text-sm text-zinc-200 hover:bg-base-raised rounded-lg transition-colors text-left";

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title="Añadir"
        className="grid place-items-center w-8 h-8 rounded-full border border-base-border text-zinc-400 hover:text-layer hover:border-accent/50 disabled:opacity-40 transition-colors"
      >
        <Plus className="w-4 h-4" />
      </button>

      <Popover
        open={open_}
        anchorRef={triggerRef}
        onClose={close}
        width={256}
        className="p-1.5"
      >
          <div className="px-2 pt-1 pb-1 text-[10px] uppercase tracking-wider text-zinc-500">
            Añadir
          </div>
          <button onClick={() => void pickTextFiles()} className={item} disabled={busy}>
            <FileText className="w-4 h-4 text-accent-soft shrink-0" />
            <span className="flex-1">{busy ? "Leyendo…" : "Archivo de texto"}</span>
          </button>
          <button
            onClick={() => setUrlGitHub((v) => (v === null ? "" : null))}
            className={item}
          >
            <Github className="w-4 h-4 text-accent-soft shrink-0" />
            <span className="flex-1">Desde GitHub</span>
            <span className="text-[10px] text-zinc-600">sin clonar</span>
          </button>
          {urlGitHub !== null && (
            <div className="px-1 pb-1.5">
              <input
                autoFocus
                value={urlGitHub}
                onChange={(e) => setUrlGitHub(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void traerDeGitHub();
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setUrlGitHub(null);
                  }
                }}
                placeholder="https://github.com/autor/repo/blob/main/archivo.rs"
                className="w-full rounded-lg border border-base-border bg-base px-2 py-1.5 text-xs outline-none placeholder:text-zinc-600 focus:border-accent/70"
              />
              <button
                onClick={() => void traerDeGitHub()}
                disabled={!urlGitHub.trim() || ocupado}
                className="mt-1 w-full rounded-lg bg-accent px-2 py-1.5 text-xs text-white hover:bg-accent-dim disabled:opacity-40 transition-colors"
              >
                {ocupado ? "Descargando…" : "Añadir como contexto"}
              </button>
            </div>
          )}
          {visionOk ? (
            <button onClick={() => void capturarPantalla()} className={item} disabled={busy}>
              <Camera className="w-4 h-4 text-accent-soft shrink-0" />
              <span className="flex-1">Tomar captura</span>
              <span className="text-[10px] text-zinc-600">pantalla entera</span>
            </button>
          ) : (
            <div
              className={item + " opacity-45 cursor-not-allowed"}
              title="Hace falta un modelo con visión para que Hatboo lea una captura."
            >
              <Camera className="w-4 h-4 text-zinc-500 shrink-0" />
              <span className="flex-1">Tomar captura</span>
              <span className="text-[10px] text-zinc-500">sin visión</span>
            </div>
          )}
          {visionOk ? (
            <button onClick={() => void pickImages()} className={item} disabled={busy}>
              <ImageIcon className="w-4 h-4 text-accent-soft shrink-0" />
              <span className="flex-1">Imagen</span>
            </button>
          ) : (
            <div
              className={item + " opacity-45 cursor-not-allowed"}
              title="El modelo actual no admite imágenes. Cambia a un modelo con visión en Ajustes."
            >
              <ImageIcon className="w-4 h-4 text-zinc-500 shrink-0" />
              <span className="flex-1">Imagen</span>
              <span className="text-[10px] text-zinc-500">sin visión</span>
            </div>
          )}

          <div className="my-1.5 h-px bg-base-border" />
          <div className="px-2 pt-0.5 pb-1 text-[10px] uppercase tracking-wider text-zinc-500">
            Conectores
          </div>
          {(
            [
              {
                key: "webSearch" as const,
                label: "Búsqueda web",
                Icon: Globe,
                ayuda: "Consulta DuckDuckGo antes de responder. Sin cuenta ni clave.",
              },
              {
                key: "codeMode" as const,
                label: "Modo código",
                Icon: Code2,
                ayuda: "Prompt orientado a programar: respuestas directas y código completo.",
              },
            ]
          ).map(({ key, label, Icon, ayuda }) => {
            const activo = !!settings?.[key];
            return (
              <button
                key={key}
                onClick={() => toggleConector(key)}
                disabled={!settings}
                title={ayuda}
                aria-pressed={activo}
                className={item}
              >
                <Icon className="w-4 h-4 text-accent-soft shrink-0" />
                <span className="flex-1">{label}</span>
                {activo && <Check className="w-4 h-4 text-accent-soft shrink-0" />}
              </button>
            );
          })}

          <div className="my-1.5 h-px bg-base-border" />
          <div className="px-2 pt-0.5 pb-1 text-[10px] uppercase tracking-wider text-zinc-500">
            Plantillas
          </div>
          {skills.length === 0 ? (
            <div
              className={item + " opacity-45 cursor-not-allowed"}
              title="Créalas en Ajustes → Skills"
            >
              <Sparkles className="w-4 h-4 text-zinc-500 shrink-0" />
              <span className="flex-1">Aún no hay plantillas</span>
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
                title={
                  s.enabled
                    ? `${s.prompt}\n\n(esta plantilla ya se aplica sola a cada respuesta)`
                    : s.prompt
                }
              >
                <Sparkles className="w-4 h-4 text-accent-soft shrink-0" />
                <span className="flex-1 truncate">{s.name}</span>
                {s.enabled && (
                  <span className="text-[10px] text-accent-soft/80">siempre</span>
                )}
              </button>
            ))
          )}

          <div className="my-1.5 h-px bg-base-border" />
          <div className="px-2 pt-0.5 pb-1 text-[10px] uppercase tracking-wider text-zinc-500">
            Sesión
          </div>
          <button onClick={goWork} className={item}>
            <FolderKanban className="w-4 h-4 text-accent-soft shrink-0" />
            <span className="flex-1">Proyectos</span>
          </button>
          <button
            onClick={() => void exportConversation()}
            className={item + (canClear ? "" : " opacity-45 cursor-not-allowed")}
            disabled={!canClear}
          >
            <Download className="w-4 h-4 text-accent-soft shrink-0" />
            <span className="flex-1">Exportar conversación</span>
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
      </Popover>
    </div>
  );
}
