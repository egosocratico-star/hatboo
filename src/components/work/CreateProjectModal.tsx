import { useEffect, useRef, useState } from "react";
import { documentDir } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, X } from "lucide-react";
import { t } from "../../i18n";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, CAMPO } from "../modalUi";
import { useWorkStore } from "../../store/workStore";

/** Nombres que el sistema de archivos no acepta como carpeta. */
const PROHIBIDOS = new Set([
  "con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
]);

function join(parent: string, name: string) {
  const sep = /[\\/]$/.test(parent) ? "" : parent.includes("\\") ? "\\" : "/";
  return `${parent}${sep}${name}`;
}

/**
 * Creación de proyecto. Vive fuera de las vistas porque se abre desde la página
 * de Proyectos, y allí el `ProjectView` ni siquiera está montado.
 */
export default function CreateProjectModal() {
  const draft = useWorkStore((s) => s.newProjectDraft);
  const confirmar = useWorkStore((s) => s.confirmCreateProject);
  const cancelar = useWorkStore((s) => s.cancelCreateProject);

  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!draft) {
      setName("");
      setError(null);
      setCreando(false);
      return;
    }
    void documentDir().then(setParent);
    inputRef.current?.focus();
  }, [draft]);

  useEffect(() => {
    if (!draft) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        cancelar();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [draft, cancelar]);

  if (!draft) return null;

  const recortado = name.trim();
  const invalido =
    recortado.length > 0 &&
    (/[\\/:*?"<>|]/.test(recortado) || PROHIBIDOS.has(recortado.toLowerCase()));
  const puedeCrear = recortado.length > 0 && !invalido && !!parent && !creando;

  const elegirCarpeta = async () => {
    const dir = await open({ directory: true, title: t("Elige dónde crear el proyecto"), defaultPath: parent });
    if (dir) setParent(dir);
  };

  const crear = async () => {
    if (!puedeCrear) return;
    setCreando(true);
    setError(null);
    try {
      await confirmar(recortado, parent);
    } catch (e) {
      setError(String(e));
      setCreando(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 animate-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) cancelar();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void crear();
        }}
        className="w-full max-w-md overflow-clip rounded-2xl border border-base-border hatboo-blur shadow-2xl shadow-shade/50 animate-pop-in"
      >
        <div className="flex items-center gap-3 border-b border-base-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold tracking-tight">{t("Crear proyecto nuevo")}</h2>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              {t("Se crea la carpeta, no solo se registra.")}
            </p>
          </div>
          <button
            type="button"
            onClick={cancelar}
            title={t("Cerrar (Esc)")}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-zinc-500 transition-colors hover:bg-base-hover hover:text-layer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-zinc-400" htmlFor="new-project-name">
              {t("Nombre del proyecto")}
            </label>
            <input
              id="new-project-name"
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="mi-proyecto"
              className={`${CAMPO} placeholder:text-zinc-600`}
            />
            {invalido && (
              <p className="text-[11px] text-red-400">{t("Ese nombre no vale como carpeta.")}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-zinc-400" htmlFor="new-project-parent">
              {t("Dentro de la carpeta")}
            </label>
            <div className="flex items-center gap-2">
              <input
                id="new-project-parent"
                readOnly
                value={parent}
                title={parent}
                onClick={() => void elegirCarpeta()}
                className={`${CAMPO} min-w-0 flex-1 cursor-pointer truncate text-zinc-400 hover:border-accent/50`}
              />
              <button
                type="button"
                onClick={() => void elegirCarpeta()}
                className={`${BOTON_SECUNDARIO} shrink-0 self-stretch px-3 text-xs`}
                title={t("Elegir otra carpeta")}
              >
                <FolderOpen className="w-3.5 h-3.5" />
                {t("Examinar")}
              </button>
            </div>
            {recortado.length > 0 && !invalido && parent && (
              <p className="truncate text-[11px] text-zinc-500" title={join(parent, recortado)}>
                {t("Se creará en")} {join(parent, recortado)}
              </p>
            )}
          </div>

          {error && <p className="text-[11px] text-red-400">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-base-border bg-base-raised px-5 py-3">
          <button
            type="button"
            onClick={cancelar}
            className={BOTON_SECUNDARIO}
          >
            {t("Cancelar")}
          </button>
          <button
            type="submit"
            disabled={!puedeCrear}
            className={BOTON_PRIMARIO}
          >
            {creando ? t("Creando…") : t("Crear")}
          </button>
        </div>
      </form>
    </div>
  );
}
