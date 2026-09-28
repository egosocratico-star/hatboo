import { t } from "../../i18n";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileText } from "lucide-react";
import Popover from "../Popover";

interface Reglas {
  exists: boolean;
  content: string;
  path: string;
}

const PLANTILLA = `# Reglas de este proyecto

## Cómo trabajar aquí
-

## Qué no tocar
-
`;

export default function ProjectRules({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [reglas, setReglas] = useState<Reglas | null>(null);
  const [borrador, setBorrador] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let vivo = true;
    setReglas(null);
    invoke<Reglas>("project_rules", { projectId })
      .then((r) => {
        if (!vivo) return;
        setReglas(r);
        setBorrador(r.content);
      })
      .catch(() => {
        // Un proyecto cuya carpeta ya no existe no debe tapar la cabecera.
        if (vivo) setReglas({ exists: false, content: "", path: "HATBOO.md" });
      });
    return () => {
      vivo = false;
    };
  }, [projectId]);

  const hayReglas = !!reglas?.exists && reglas.content.trim() !== "";
  /** Lo que hay escrito y no se ha enviado al disco. Sin esto no sabías si al
   *  cerrar el panel se iba todo. */
  const sinGuardar = (reglas?.content ?? "") !== borrador;
  /** En la cabecera solo el nombre: la ruta entera no cabe en 440 px y no es lo
   *  que uno mira — está en el `title` y en el árbol de archivos. */
  const nombre = (reglas?.path ?? "HATBOO.md").split(/[\\/]/).pop() ?? "HATBOO.md";

  const guardar = async () => {
    setGuardando(true);
    setError(null);
    try {
      setReglas(await invoke<Reglas>("save_project_rules", { projectId, content: borrador }));
    } catch (e) {
      setError(String(e));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        title={
          hayReglas
            ? t("El agente está leyendo las reglas de este proyecto (HATBOO.md)")
            : t("Reglas de este proyecto (HATBOO.md): aún no hay ninguna")
        }
        className={`grid h-[26px] w-[26px] place-items-center rounded-md transition-colors ${
          hayReglas
            ? "bg-accent/10 text-accent-soft hover:bg-accent/20"
            : "text-zinc-500 hover:bg-base-hover hover:text-zinc-200"
        }`}
      >
        <FileText className="w-3.5 h-3.5 shrink-0" />
      </button>

      <Popover
        open={open}
        anchorRef={triggerRef}
        onClose={() => setOpen(false)}
        width={440}
        cap={520}
        className="p-0"
      >
        <div
          onKeyDown={(e) => {
            // Ctrl+S estaba reservado arriba solo para que WebView2 no abriera
            // «Guardar página»; aquí por fin hace algo.
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
              e.preventDefault();
              e.stopPropagation();
              if (sinGuardar && !guardando) void guardar();
            }
          }}
        >
          {/* Una línea de cabecera en vez de tres: el título manda, y la ruta
              pasa a ser el nombre del archivo, que es lo que se busca en el
              árbol. La ruta entera sigue en el `title`. */}
          <div className="flex items-center gap-2 border-b border-base-border px-3 py-2">
            <FileText className="h-3.5 w-3.5 shrink-0 text-accent-soft" />
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-200">
              {t("Reglas de este proyecto")}
            </span>
            <span
              className="shrink-0 rounded-md bg-base px-1.5 py-0.5 font-mono text-[10px] text-zinc-500"
              title={reglas?.path ?? "HATBOO.md"}
            >
              {nombre}
            </span>
          </div>

          <div className="space-y-2 p-3">
            <p className="text-[10px] leading-snug text-zinc-600">
              {t(
                "Se añade al prompt del agente al empezar cada sesión de trabajo de esta carpeta. No amplía el sandbox ni quita aprobaciones.",
              )}
            </p>

            <textarea
              value={borrador}
              onChange={(e) => setBorrador(e.target.value)}
              rows={9}
              spellCheck={false}
              placeholder={t("Escribe aquí las convenciones del proyecto…")}
              className="w-full resize-y rounded-lg border border-base-border bg-base px-2.5 py-2 font-mono text-[11px] leading-relaxed text-zinc-200 focus:border-accent/60 focus:outline-none"
            />

            {error && <p className="text-[11px] text-red-400">{error}</p>}

            <div className="flex items-center gap-2">
              <span className="text-[10px] tabular-nums text-zinc-600">
                {t("{n} caracteres", { n: borrador.length })}
              </span>
              {sinGuardar && (
                <span className="text-[10px] text-amber-300/80">{t("sin guardar")}</span>
              )}
              {!reglas?.exists && (
                <button
                  onClick={() => setBorrador(PLANTILLA)}
                  className="rounded-md px-1.5 py-0.5 text-[11px] text-zinc-400 transition-colors hover:bg-base-hover hover:text-zinc-200"
                >
                  {t("Empezar con una plantilla")}
                </button>
              )}
              <button
                onClick={() => void guardar()}
                disabled={guardando || !sinGuardar}
                title={sinGuardar ? t("Guardar") : t("No hay nada que guardar")}
                className="ml-auto rounded-lg bg-accent px-3 py-1.5 text-xs text-white transition-colors hover:bg-accent-dim disabled:opacity-40"
              >
                {guardando
                  ? t("Guardando…")
                  : reglas?.exists
                    ? t("Guardar")
                    : t("Crear HATBOO.md")}
              </button>
            </div>
          </div>
        </div>
      </Popover>
    </div>
  );
}
