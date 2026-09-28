import { t } from "../../i18n";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { FilePlus2, FolderOpen, FolderPlus, Library, X } from "lucide-react";
import Popover from "../Popover";
import Vacio from "../Vacio";

interface Fuente {
  id: string;
  projectId: string;
  ruta: string;
  /** `"carpeta"` o `"archivo"`. */
  tipo: string;
  creadoEn: number;
}

/** Extensiones que el agente puede leer de verdad. Un .pdf o un .docx aquí sería
 *  un contexto que no se puede abrir: para eso hace falta una librería nueva y
 *  eso no se añade de rondón. */
const FILTRO_TEXTO = ["md", "txt", "rs", "ts", "tsx", "js", "jsx", "json", "py", "csv", "yml", "yaml", "toml", "sql", "html", "css", "sh"];

/**
 * El contexto extra del proyecto: carpetas y archivos que el agente puede leer
 * sin salir de su sandbox de escritura. Quitar una fuente no borra nada del
 * disco, solo cierra la puerta de lectura.
 */
export default function ProjectSources({ projectId }: { projectId: string }) {
  const [abierto, setAbierto] = useState(false);
  const [fuentes, setFuentes] = useState<Fuente[]>([]);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const recargar = () => {
    void invoke<Fuente[]>("list_sources", { projectId }).then(
      (f) => setFuentes(f),
      (e) => setAviso(String(e)),
    );
  };
  useEffect(recargar, [projectId]);

  const vincula = async (tipo: "carpeta" | "archivo") => {
    setOcupado(true);
    setAviso(null);
    try {
      const elegida = await open({
        multiple: tipo === "archivo",
        directory: tipo === "carpeta",
        filter: tipo === "archivo" ? [{ name: "Texto", extensions: FILTRO_TEXTO }] : undefined,
      });
      if (!elegida) return;
      const rutas = Array.isArray(elegida) ? elegida : [elegida];
      for (const r of rutas) {
        await invoke("add_source", { projectId, ruta: r, tipo });
      }
      recargar();
    } catch (e) {
      setAviso(String(e));
    } finally {
      setOcupado(false);
    }
  };

  const quita = async (f: Fuente) => {
    setAviso(null);
    try {
      await invoke("remove_source", { id: f.id });
      recargar();
    } catch (e) {
      setAviso(String(e));
    }
  };

  const boton =
    "flex items-center gap-1.5 rounded-lg border border-base-border px-2 py-1 text-[11px] text-zinc-400 transition-colors hover:bg-base-hover hover:text-zinc-200 disabled:opacity-40";

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        onClick={() => {
          setAviso(null);
          setAbierto((v) => !v);
        }}
        title={
          fuentes.length === 0
            ? t("Aún no has vinculado fuentes a este proyecto")
            : t("{n} fuentes de lectura en este proyecto", { n: fuentes.length })
        }
        className={`flex h-[26px] min-w-[26px] items-center justify-center gap-1 rounded-md px-1 text-[11px] transition-colors ${
          fuentes.length > 0
            ? "bg-accent/10 text-accent-soft hover:bg-accent/20"
            : "text-zinc-500 hover:bg-base-hover hover:text-zinc-200"
        }`}
      >
        <Library className="w-3.5 h-3.5 shrink-0" />
        {fuentes.length > 0 && <span className="tabular-nums">{fuentes.length}</span>}
      </button>

      <Popover
        open={abierto}
        anchorRef={triggerRef}
        onClose={() => setAbierto(false)}
        width={560}
        cap={560}
        className="p-3 space-y-2"
      >
        <p className="text-xs font-medium text-zinc-200">{t("Fuentes de este proyecto")}</p>
        <p className="text-[11px] leading-relaxed text-zinc-500">
          {t(
            "El agente las lee con read_source y list_source, y nunca escribe ahí: la carpeta donde trabaja sigue siendo la del proyecto.",
          )}
        </p>
        {aviso && <p className="text-[11px] leading-snug text-red-300">{aviso}</p>}
        {fuentes.length === 0 ? (
          <Vacio
            icon={FolderOpen}
            titulo={t("Dale contexto a este proyecto")}
            detalle={t(
              "Vincula una carpeta de apuntes o un archivo de texto: todos los chats de esta carpeta podrán consultarlo.",
            )}
          />
        ) : (
          <ul className="space-y-1">
            {fuentes.map((f) => (
              <li
                key={f.id}
                className="flex items-center gap-1.5 rounded-lg border border-base-border bg-base px-2 py-1.5"
              >
                {f.tipo === "carpeta" ? (
                  <FolderOpen className="h-3.5 w-3.5 shrink-0 text-accent-soft" />
                ) : (
                  <FilePlus2 className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                )}
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-200" title={f.ruta}>
                  {f.ruta}
                </span>
                <span className="shrink-0 text-[10px] text-zinc-500">
                  {f.tipo === "carpeta" ? t("carpeta") : t("archivo")}
                </span>
                <button
                  onClick={() => void quita(f)}
                  title={t("Quitar la fuente (no borra nada del disco)")}
                  className="shrink-0 rounded p-0.5 text-zinc-600 transition-colors hover:bg-base-hover hover:text-red-300"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2 pt-1 border-t border-base-border">
          <button
            onClick={() => void vincula("carpeta")}
            disabled={ocupado}
            className={boton}
          >
            <FolderPlus className="h-3.5 w-3.5 shrink-0" />
            {t("Vincular carpeta")}
          </button>
          <button
            onClick={() => void vincula("archivo")}
            disabled={ocupado}
            className={boton}
          >
            <FilePlus2 className="h-3.5 w-3.5 shrink-0" />
            {t("Añadir archivos de texto")}
          </button>
        </div>
      </Popover>
    </div>
  );
}
