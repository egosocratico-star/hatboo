import { t } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  Camera,
  ChevronRight,
  Download,
  Ellipsis,
  Eye,
  Github,
  Paperclip,
  Plus,
  Sparkles,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { useChatStore } from "../store/chatStore";
import Popover from "./Popover";
import MenuAtras from "./MenuAtras";
import type { Attachment } from "../types";
import { motorImagen, modeloActivo, soportaVision } from "../proveedores";

interface Props {
  onPickFiles: (files: Attachment[]) => void;
  /** Insertar el texto de una plantilla en el mensaje, donde esté el cursor. */
  onInsertTemplate: (text: string) => void;
  disabled?: boolean;
}

type Cara = "anadir" | "mas" | "github" | "imagen";

export default function ChatPlusMenu({ onPickFiles, onInsertTemplate, disabled }: Props) {
  /** Las cuatro caras del menú. El panel no crece: cambia de cara, así que el
   *  saludo de detrás no se tapa más que con la cara de arriba. */
  const [cara, setCara] = useState<Cara>("anadir");
  const [open_, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [urlGitHub, setUrlGitHub] = useState("");
  /** El texto de «Generar imagen»; vacío = la cara está abierta pero sin nada. */
  const [pedidoImagen, setPedidoImagen] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const settings = useChatStore((s) => s.settings);
  const skills = useChatStore((s) => s.skills);
  const imageBusy = useChatStore((s) => s.imageBusy);
  const localModels = useChatStore((s) => s.localModels);
  const visionOk = soportaVision(settings, localModels);
  const motor = motorImagen(settings?.imageProvider ?? "");
  const patchSettings = useChatStore((s) => s.patchSettings);
  const modelo = settings ? modeloActivo(settings) : "";
  /** Lo que pasó bien, para que el rojo quede solo para lo que falló. */
  const [info, setInfo] = useState<string | null>(null);
  /** Imágenes que no se adjuntaron porque el modelo no está marcado como vidente.
   *  Se quedan aquí para que un clic las suelte, en vez de obligarle a volver a
   *  abrir el diálogo de archivos. */
  const [pendDeVision, setPendDeVision] = useState<Attachment[]>([]);
  /** Si acaba de pasar algo con una imagen sin marcado: es lo que enseña el botón. */
  const [avisoVision, setAvisoVision] = useState(false);

  /** Declarar que el modelo activo lee imágenes y soltar lo que quedó preso. Escribe
   *  en los ajustes de una vez (`patchSettings` guarda), porque un interruptor que
   *  hay que ir a buscar a otra pantalla no lo mueve nadie. */
  const declararVision = () => {
    if (!settings || !modelo) return;
    const lista = settings.visionModelos ?? [];
    if (!lista.some((m) => m.toLowerCase() === modelo.trim().toLowerCase())) {
      patchSettings({ visionModelos: [...lista, modelo.trim()] });
    }
    if (pendDeVision.length > 0) onPickFiles(pendDeVision);
    setPendDeVision([]);
    setAvisoVision(false);
    setNotice(null);
    setInfo(t("{m} queda marcado como modelo que lee imágenes.", { m: modelo }));
  };

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

  /** Al abrir se siempre se entra por la cara de arriba: volver a medio menú de
   *  la última vez que se usó no es un atajo, es un despiste. */
  const abrir = (v: boolean) => {
    setOpen(v);
    if (v) {
      setCara("anadir");
      setNotice(null);
      setInfo(null);
      setAvisoVision(false);
    }
  };

  /** Escape: primero deshace la cara; solo cierra el menú si ya estaba en la de
   *  arriba. Es lo que hace un menú nativo en cascada. */
  const escapar = () => {
    if (cara !== "anadir") setCara("anadir");
    else close();
  };

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
      const pendientes: Attachment[] = [];
      const failures: string[] = [];
      for (const path of paths) {
        try {
          const a = await invoke<Attachment>("read_attachment", { path });
          if (a.imageMediaType && !visionOk) {
            pendientes.push(a);
            continue;
          }
          results.push(a);
        } catch (e) {
          failures.push(String(e));
        }
      }
      if (results.length > 0) onPickFiles(results);
      if (pendientes.length > 0) {
        setPendDeVision((prev) => [...prev, ...pendientes]);
        setAvisoVision(true);
      }
      if (failures.length > 0) setNotice(failures[0]);
      else if (pendientes.length > 0)
        setNotice(
          t("«{n}» es una imagen y no sabemos si {m} las lee. El botón de abajo lo arregla.", {
            n: pendientes[0].name,
            m: modelo || t("tu modelo"),
          }),
        );
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
      setUrlGitHub("");
      close();
    } catch (e) {
      setNotice(String(e));
    } finally {
      setOcupado(false);
    }
  };

  /** Captura la pantalla entera y la adjunta. El nombre lo pone aquí, que es
   *  donde hay hora local; el backend solo lo sanea.
   *
   *  Sin modelo vidente declarado la captura SE ADJUNTA IGUAL: es suya, ya la
   *  pidió, y negársela dejándola tirada en el portapapeles de Windows era lo
   *  peor de las dos opciones. Lo que no se puede fingir es si el modelo la va
   *  a leer, y por eso el menú se queda abierto con el botón para decirlo. */
  const capturarPantalla = async () => {
    setNotice(null);
    setOcupado(true);
    try {
      const ahora = new Date().toISOString().slice(0, 16).replace("T", "_").replace(/:/g, "-");
      const adjunto = await invoke<Attachment>("capture_screen", { nombre: `captura-${ahora}` });
      onPickFiles([adjunto]);
      if (visionOk) {
        close();
      } else {
        setAvisoVision(true);
        setNotice(
          t("Captura adjuntada. No sabemos si {m} lee imágenes: márcalo si las lee.", {
            m: modelo || t("tu modelo"),
          }),
        );
      }
    } catch (e) {
      setNotice(String(e));
    } finally {
      setOcupado(false);
    }
  };

  /** Se cierra el menú antes de pedir: la espera se ve en el hilo («Dibujando…»),
   *  que es donde va a aparecer la imagen, y no aquí dentro. */
  const generarImagen = async () => {
    const texto = pedidoImagen.trim();
    if (!texto || imageBusy) return;
    setPedidoImagen("");
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

  /** Si el proveedor que ya usa para el texto también dibuja (Gemini u OpenAI),
   *  no hay que ir a Ajustes a elegir lo que ya está delante. Son los dos únicos
   *  motores escritos en el backend: Ollama no genera imágenes y Hugging Face
   *  todavía no está conectado, así que aquí no se finge lo contrario. */
  const motorDelActivo =
    settings && (settings.activeProvider === "gemini" || settings.activeProvider === "openai")
      ? motorImagen(settings.activeProvider)
      : undefined;

  const activarDelActivo = () => {
    if (!motorDelActivo) return;
    patchSettings({
      imageProvider: motorDelActivo.id,
      imageModel: motorDelActivo.modeloPorDefecto,
      imageSize: "1024x1024",
    });
    setInfo(t("Motor de imágenes encendido: {m}.", { m: motorDelActivo.corto }));
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        onClick={() => abrir(!open_)}
        disabled={disabled}
        title={t("Añadir")}
        aria-expanded={open_}
        aria-haspopup="true"
        className="grid place-items-center w-8 h-8 rounded-full border border-base-border text-zinc-400 hover:text-layer hover:border-accent/50 disabled:opacity-40 transition-colors"
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
            <button onClick={() => void pickFiles()} className={item} disabled={busy}>
              <Paperclip className="w-4 h-4 text-accent-soft shrink-0" />
              <span className="flex-1">{busy ? t("Leyendo…") : t("Archivos")}</span>
            </button>
          )}
          {cara === "anadir" && (
            <button onClick={() => setCara("github")} className={item}>
              <Github className="w-4 h-4 text-accent-soft shrink-0" />
              <span className="flex-1">{t("GitHub")}</span>
              <span className="text-[10px] text-zinc-600">{t("sin clonar")}</span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
            </button>
          )}
          {cara === "github" && (
            <div className="px-1 pb-1.5">
              <MenuAtras hacia={t("Añadir")} onClick={() => setCara("anadir")} />
              <input
                autoFocus
                value={urlGitHub}
                onChange={(e) => setUrlGitHub(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void traerDeGitHub();
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setCara("anadir");
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
          {/* La captura está siempre disponible. Lo único que puede faltar es que
              sepamos si tu modelo la va a leer, y eso se dice con la etiqueta y con
              el botón de abajo — no con un mando muerto que además tapa el atajo. */}
          {cara === "anadir" && (
            <button
              onClick={() => void capturarPantalla()}
              className={item}
              disabled={busy || ocupado}
              title={
                visionOk
                  ? t("Captura la pantalla entera y la añade al mensaje.")
                  : t(
                      "Captura y la añade igual; Hatboo no sabe si tu modelo lee imágenes, y abajo está el botón para decirlo.",
                    )
              }
            >
              <Camera
                className={`w-4 h-4 shrink-0 ${visionOk ? "text-accent-soft" : "text-zinc-500"}`}
              />
              <span className="flex-1">{t("Captura")}</span>
              {!visionOk && (
                <span className="text-[10px] text-zinc-500">{t("sin marcar")}</span>
              )}
            </button>
          )}
          {cara === "anadir" &&
            (motor ? (
              <button
                onClick={() => setCara("imagen")}
                className={item}
                disabled={imageBusy}
                title={t(
                  "Se la pide a {m}, con la clave que ya tengas guardada. Cuesta dinero aparte del chat: el precio está en Ajustes → API.",
                  { m: motor.corto },
                )}
              >
                <WandSparkles className="w-4 h-4 text-accent-soft shrink-0" />
                <span className="flex-1">{imageBusy ? t("Dibujando…") : t("Imagen")}</span>
                <span className="text-[10px] text-zinc-600">{motor.corto}</span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
              </button>
            ) : motorDelActivo ? (
              <button
                onClick={activarDelActivo}
                className={item}
                title={t(
                  "{p} ya tiene la clave guardada y sabe dibujar. Se enciende aquí mismo, y cobra aparte del chat: {precio}.",
                  { p: motorDelActivo.corto, precio: motorDelActivo.precio },
                )}
              >
                <WandSparkles className="w-4 h-4 text-accent-soft shrink-0" />
                <span className="flex-1">{t("Imagen")}</span>
                <span className="shrink-0 text-[10px] text-zinc-500">
                  {t("encender {p}", { p: motorDelActivo.corto })}
                </span>
              </button>
            ) : (
              <button
                onClick={() => {
                  const st = useChatStore.getState();
                  st.setSettingsCat("api");
                  st.setView("settings");
                  close();
                }}
                className={item}
                title={t(
                  "Dibujan solo Gemini y OpenAI, que son los dos motores escritos en Hatboo: Ollama no genera imágenes y Hugging Face todavía no está conectado. Se elige en Ajustes → API.",
                )}
              >
                <WandSparkles className="w-4 h-4 text-zinc-500 shrink-0" />
                <span className="flex-1">{t("Imagen")}</span>
                <span className="shrink-0 text-[10px] text-zinc-500">{t("Ajustes → API")}</span>
              </button>
            ))}
          {cara === "imagen" && motor && (
            <div className="px-1 pb-1.5">
              <MenuAtras hacia={t("Añadir")} onClick={() => setCara("anadir")} />
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
                    setCara("anadir");
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

          {cara === "anadir" && (
            <>
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
            </>
          )}

          {/* `role="alert"`: el aviso sale de un fallo (una imagen que el modelo
              no ve, un .md que no se puede leer) y sin él se queda mudo para un
              lector de pantalla. */}
          {notice && (
            <div role="alert" className="px-2.5 py-1.5 mt-1 text-[11px] text-red-400">
              {notice}
            </div>
          )}
          {info && (
            <p className="px-2.5 py-1.5 mt-1 text-[11px] leading-snug text-zinc-400">{info}</p>
          )}
          {/* El arreglo al lado del problema: sin esto tocaría ir a Ajustes, buscar
              la ficha del modelo y volver con el archivo ya perdido. */}
          {!visionOk && avisoVision && modelo && (
            <button onClick={declararVision} className={`${item} mt-0.5`}>
              <Eye className="w-4 h-4 shrink-0 text-accent-soft" />
              <span className="flex-1">{t("Mi modelo sí lee imágenes")}</span>
              <span className="shrink-0 text-[10px] text-zinc-500">{t("marcar")}</span>
            </button>
          )}
      </Popover>
    </div>
  );
}
