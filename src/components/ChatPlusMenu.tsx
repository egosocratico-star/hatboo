import { t } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  Camera,
  Download,
  Github,
  Paperclip,
  Plus,
  Sparkles,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { useChatStore } from "../store/chatStore";
import Popover from "./Popover";
import type { Attachment } from "../types";
import { motorImagen, soportaVision } from "../proveedores";

interface Props {
  onPickFiles: (files: Attachment[]) => void;
  /** Insertar el texto de una plantilla en el mensaje, donde esté el cursor. */
  onInsertTemplate: (text: string) => void;
  disabled?: boolean;
}

export default function ChatPlusMenu({ onPickFiles, onInsertTemplate, disabled }: Props) {
  const [open_, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [urlGitHub, setUrlGitHub] = useState<string | null>(null);
  /** Mientras es `null` el campo de «Generar imagen» está cerrado. */
  const [pedidoImagen, setPedidoImagen] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const settings = useChatStore((s) => s.settings);
  const skills = useChatStore((s) => s.skills);
  const imageBusy = useChatStore((s) => s.imageBusy);
  const localModels = useChatStore((s) => s.localModels);
  const visionOk = soportaVision(settings, localModels);
  const motor = motorImagen(settings?.imageProvider ?? "");

  // La lista con las capacidades se pide una vez y la comparte el chip del
  // modelo; aquí solo hace falta si el proveedor activo es local.
  useEffect(() => {
    if (settings?.activeProvider === "local" && localModels === null) {
      void useChatStore.getState().loadLocalModels();
    }
  }, [settings?.activeProvider, localModels]);

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

  const close = () => setOpen(false);

  /** Un solo selector para todo: `read_attachment` decide en el backend si lo
   *  que cayó es una imagen (payload de visión) o texto. */
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
          if (a.imageMediaType && !visionOk) {
            failures.push(
              t("«{n}» es una imagen y el modelo actual no ve imágenes.", { n: a.name }),
            );
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

  /** Se cierra el menú antes de pedir: la espera se ve en el hilo («Dibujando…»),
   *  que es donde va a aparecer la imagen, y no aquí dentro. */
  const generarImagen = async () => {
    const texto = (pedidoImagen || "").trim();
    if (!texto || imageBusy) return;
    setPedidoImagen(null);
    close();
    await useChatStore.getState().generateImage(texto);
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
      title: t("Exportar conversación"),
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
        title={t("Añadir")}
        className="grid place-items-center w-8 h-8 rounded-full border border-base-border text-zinc-400 hover:text-layer hover:border-accent/50 disabled:opacity-40 transition-colors"
      >
        <Plus className="w-4 h-4" />
      </button>

      <Popover
        open={open_}
        anchorRef={triggerRef}
        onClose={close}
        width={256}
        cap={380}
        className="p-1.5"
      >
          <button onClick={() => void pickFiles()} className={item} disabled={busy}>
            <Paperclip className="w-4 h-4 text-accent-soft shrink-0" />
            <span className="flex-1">{busy ? t("Leyendo…") : t("Archivos")}</span>
            <span className="shrink-0 text-[10px] text-zinc-600">
              {t("de cualquier tipo")}
            </span>
          </button>
          <button
            onClick={() => setUrlGitHub((v) => (v === null ? "" : null))}
            className={item}
          >
            <Github className="w-4 h-4 text-accent-soft shrink-0" />
            <span className="flex-1">{t("Desde GitHub")}</span>
            <span className="text-[10px] text-zinc-600">{t("sin clonar")}</span>
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
                {ocupado ? t("Descargando…") : t("Añadir como contexto")}
              </button>
            </div>
          )}
          {visionOk ? (
            <button onClick={() => void capturarPantalla()} className={item} disabled={busy}>
              <Camera className="w-4 h-4 text-accent-soft shrink-0" />
              <span className="flex-1">{t("Tomar captura")}</span>
              <span className="text-[10px] text-zinc-600">{t("pantalla entera")}</span>
            </button>
          ) : (
            <div
              className={item + " opacity-45 cursor-not-allowed"}
              title={t("Hace falta un modelo con visión para que Hatboo lea una captura.")}
            >
              <Camera className="w-4 h-4 text-zinc-500 shrink-0" />
              <span className="flex-1">{t("Tomar captura")}</span>
              <span className="text-[10px] text-zinc-500">{t("sin visión")}</span>
            </div>
          )}
          {motor ? (
            <>
              <button
                onClick={() => setPedidoImagen((v) => (v === null ? "" : null))}
                className={item}
                disabled={imageBusy}
                title={t(
                  "Se la pide a {m}, con la clave que ya tengas guardada. Cuesta dinero aparte del chat: el precio está en Ajustes → API.",
                  { m: motor.corto },
                )}
              >
                <WandSparkles className="w-4 h-4 text-accent-soft shrink-0" />
                <span className="flex-1">{imageBusy ? t("Dibujando…") : t("Generar imagen")}</span>
                <span className="text-[10px] text-zinc-600">{motor.corto}</span>
              </button>
              {pedidoImagen !== null && !imageBusy && (
                <div className="px-1 pb-1.5">
                  <textarea
                    autoFocus
                    value={pedidoImagen}
                    onChange={(e) => setPedidoImagen(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void generarImagen();
                      }
                      if (e.key === "Escape") {
                        e.stopPropagation();
                        setPedidoImagen(null);
                      }
                    }}
                    rows={2}
                    placeholder={t("Describe la imagen: «un gato astronauta, acuarela»")}
                    className="w-full resize-none rounded-lg border border-base-border bg-base px-2 py-1.5 text-xs leading-relaxed outline-none placeholder:text-zinc-600 focus:border-accent/70"
                  />
                  <button
                    onClick={() => void generarImagen()}
                    disabled={!pedidoImagen.trim()}
                    className="mt-1 w-full rounded-lg bg-accent px-2 py-1.5 text-xs text-white hover:bg-accent-dim disabled:opacity-40 transition-colors"
                  >
                    {t("Pedir a {m}", { m: motor.corto })}
                  </button>
                </div>
              )}
            </>
          ) : (
            <button
              onClick={() => {
                const st = useChatStore.getState();
                st.setSettingsCat("api");
                st.setView("settings");
                close();
              }}
              className={item}
              title={t("El motor de imágenes se elige en Ajustes → API.")}
            >
              <WandSparkles className="w-4 h-4 text-zinc-500 shrink-0" />
              <span className="flex-1">{t("Generar imagen")}</span>
              <span className="shrink-0 text-[10px] text-zinc-500">{t("Ajustes → API")}</span>
            </button>
          )}

          <div className="my-1.5 h-px bg-base-border" />
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
                title={
                  s.enabled
                    ? `${s.prompt}\n\n(esta plantilla ya se aplica sola a cada respuesta)`
                    : s.prompt
                }
              >
                <Sparkles className="w-4 h-4 text-accent-soft shrink-0" />
                <span className="flex-1 truncate">{s.name}</span>
                {s.enabled && (
                  <span className="text-[10px] text-accent-soft/80">{t("siempre")}</span>
                )}
              </button>
            ))
          )}

          <div className="my-1.5 h-px bg-base-border" />
          <div className="px-2 pt-0.5 pb-1 text-[10px] uppercase tracking-wider text-zinc-500">
            {t("Sesión")}
          </div>
          <button
            onClick={() => void exportConversation()}
            className={item + (canClear ? "" : " opacity-45 cursor-not-allowed")}
            disabled={!canClear}
          >
            <Download className="w-4 h-4 text-accent-soft shrink-0" />
            <span className="flex-1">{t("Exportar conversación")}</span>
          </button>
          <button
            onClick={() => void clearConversation()}
            className={item + (canClear ? " hover:text-red-300" : " opacity-45 cursor-not-allowed")}
            disabled={!canClear}
          >
            <Trash2 className="w-4 h-4 shrink-0" />
            <span className="flex-1">{t("Limpiar conversación")}</span>
          </button>

          {notice && (
            <div className="px-2.5 py-1.5 mt-1 text-[11px] text-red-400">{notice}</div>
          )}
      </Popover>
    </div>
  );
}
