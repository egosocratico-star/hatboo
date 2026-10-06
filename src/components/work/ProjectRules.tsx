import { t } from "../../i18n";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileText, ShieldCheck } from "lucide-react";
import Popover from "../Popover";

/** Estado del Trust Gate, tal como lo devuelven `project_rules`,
 *  `save_project_rules`, `approve_project_rules` y `revoke_project_rules`. */
interface Reglas {
  exists: boolean;
  content: string;
  path: string;
  applied: boolean;
  approvedHash: string | null;
  currentHash: string | null;
}

const SIN_ARCHIVO: Reglas = {
  exists: false,
  content: "",
  path: "HATBOO.md",
  applied: false,
  approvedHash: null,
  currentHash: null,
};

const PLANTILLA = `# Reglas de este proyecto

## Cómo trabajar aquí
-

## Qué no tocar
-
`;

/** Los cuatro estados del archivo. `aplicadas` es el único que pinta de acento:
 *  es el único en el que el texto está entrando en el prompt. */
type Estado = "aplicadas" | "cambio" | "pendiente" | "vacio";

function estadoDe(r: Reglas): Estado {
  if (r.applied) return "aplicadas";
  if (!r.currentHash) return "vacio";
  return r.approvedHash ? "cambio" : "pendiente";
}

export default function ProjectRules({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [reglas, setReglas] = useState<Reglas | null>(null);
  const [borrador, setBorrador] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
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
        if (vivo) setReglas(SIN_ARCHIVO);
      });
    return () => {
      vivo = false;
    };
  }, [projectId]);

  const estado = estadoDe(reglas ?? SIN_ARCHIVO);
  /** Lo que hay escrito y no se ha enviado al disco. Sin esto no sabías si al
   *  cerrar el panel se iba todo. */
  const sinGuardar = (reglas?.content ?? "") !== borrador;
  /** Un archivo en blanco no tiene nada que aprobar: el botón se queda fuera en
   *  vez de esperar a que el comando falle por algo que se ve antes de pulsar. */
  const hayTexto = (reglas?.content ?? "").trim() !== "";
  /** En la cabecera solo el nombre: la ruta entera no cabe en 440 px y no es lo
   *  que uno mira — está en el `title` y en el árbol de archivos. */
  const nombre = (reglas?.path ?? "HATBOO.md").split(/[\\/]/).pop() ?? "HATBOO.md";

  /** Después de aprobar o de quitar la aprobación hay que volver a pedir el
   *  estado: lo que se pinta es lo que el gate hace a partir de ahora, no el
   *  botón que se pulsó hace un instante. */
  const traer = async () => {
    const r = await invoke<Reglas>("project_rules", { projectId });
    setReglas(r);
    setBorrador(r.content);
  };

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

  /** Aprobar hashea el archivo TAL CUAL ESTÁ EN EL DISCO, así que si hay borrador
   *  sin volcar se guarda primero: aprobar sin eso diría que el prompt recibe un
   *  texto que todavía no existe. */
  const aprobar = async () => {
    setOcupado(true);
    setError(null);
    try {
      if (sinGuardar) {
        await invoke<Reglas>("save_project_rules", { projectId, content: borrador });
      }
      await invoke<Reglas>("approve_project_rules", { projectId });
      await traer();
    } catch (e) {
      setError(String(e));
    } finally {
      setOcupado(false);
    }
  };

  const quitar = async () => {
    setOcupado(true);
    setError(null);
    try {
      await invoke<Reglas>("revoke_project_rules", { projectId });
      await traer();
    } catch (e) {
      setError(String(e));
    } finally {
      setOcupado(false);
    }
  };

  const titulo = !reglas
    ? t("Reglas de este proyecto (HATBOO.md)")
    : estado === "aplicadas"
      ? t("Reglas aprobadas: se están añadiendo al prompt")
      : estado === "cambio"
        ? t("El HATBOO.md cambió desde que lo aprobaste: ya NO se añade al prompt")
        : estado === "pendiente"
          ? t("Hay un HATBOO.md, pero no lo has aprobado: no se añade al prompt")
          : t("Reglas de este proyecto (HATBOO.md): aún no hay ninguna");

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        title={titulo}
        className={`grid h-[26px] w-[26px] place-items-center rounded-md transition-colors ${
          estado === "aplicadas"
            ? "bg-accent/10 text-accent-soft hover:bg-accent/20"
            : estado === "vacio"
              ? "text-zinc-500 hover:bg-base-hover hover:text-zinc-200"
              : "bg-amber-500/10 text-amber-300/90 hover:bg-amber-500/20"
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
              className="shrink-0 rounded-md bg-base px-1.5 py-0.5 font-mono text-micro text-zinc-500"
              title={reglas?.path ?? "HATBOO.md"}
            >
              {nombre}
            </span>
          </div>

          <div className="space-y-2 p-3">
            {/* El estado va arriba y con su color: es lo único que responde a
                «¿el agente está leyendo esto?», y se pinta teniendo delante el
                texto, para que nadie confunda verlo con usarlo. */}
            <div
              className={`flex items-start gap-1.5 rounded-lg border px-2 py-1.5 text-etiqueta leading-snug ${
                estado === "aplicadas"
                  ? "border-accent/35 bg-accent/10 text-accent-soft"
                  : estado === "vacio"
                    ? "border-base-border bg-base text-zinc-500"
                    : "border-amber-400/30 bg-amber-400/10 text-amber-200"
              }`}
            >
              <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0">
                {estado === "aplicadas"
                  ? t("Aprobadas: se añaden al prompt del agente")
                  : estado === "cambio"
                    ? t("Cambió desde tu aprobación: NO se añaden al prompt")
                    : estado === "pendiente"
                      ? t("Sin aprobar: NO se añaden al prompt")
                      : t("Todavía no hay HATBOO.md en esta carpeta.")}
              </span>
            </div>

            <p className="text-micro leading-snug text-zinc-600">
              {t(
                "Al aprobar entra en el prompt EXACTAMENTE lo que hay en el archivo. Cualquier edición —también la de fuera de Hatboo— lo saca de ahí hasta que vuelvas a aprobar. No amplía el sandbox ni quita aprobaciones.",
              )}
            </p>

            <textarea
              value={borrador}
              onChange={(e) => setBorrador(e.target.value)}
              rows={9}
              spellCheck={false}
              placeholder={t("Escribe aquí las convenciones del proyecto…")}
              className="w-full resize-y rounded-lg border border-base-border bg-base px-2.5 py-2 font-mono text-etiqueta leading-relaxed text-zinc-200 focus:border-accent/60 focus:outline-none"
            />

            {error && <p className="text-etiqueta text-red-400">{error}</p>}

            <div className="flex items-center gap-2">
              <span className="text-micro tabular-nums text-zinc-600">
                {t("{n} caracteres", { n: borrador.length })}
              </span>
              {sinGuardar && (
                <span className="text-micro text-amber-300/80">{t("sin guardar")}</span>
              )}
              {!reglas?.exists && (
                <button
                  onClick={() => setBorrador(PLANTILLA)}
                  className="rounded-md px-1.5 py-0.5 text-etiqueta text-zinc-400 transition-colors hover:bg-base-hover hover:text-zinc-200"
                >
                  {t("Empezar con una plantilla")}
                </button>
              )}
              {estado === "aplicadas" && (
                <button
                  onClick={() => void quitar()}
                  disabled={ocupado}
                  className="rounded-lg border border-base-border px-2 py-1 text-etiqueta text-zinc-400 transition-colors hover:bg-base-hover hover:text-zinc-200 disabled:opacity-40"
                >
                  {t("Dejar de usarlas")}
                </button>
              )}
              <button
                onClick={() => void guardar()}
                disabled={guardando || !sinGuardar}
                title={sinGuardar ? t("Guardar") : t("No hay nada que guardar")}
                className="ml-auto rounded-lg border border-base-border px-3 py-1.5 text-xs text-zinc-200 transition-colors hover:bg-base-hover disabled:opacity-40"
              >
                {guardando
                  ? t("Guardando…")
                  : reglas?.exists
                    ? t("Guardar")
                    : t("Crear HATBOO.md")}
              </button>
              {(estado === "pendiente" || estado === "cambio") && hayTexto && (
                <button
                  onClick={() => void aprobar()}
                  disabled={ocupado || guardando}
                  title={t("Añade este texto exacto al prompt del agente")}
                  className="rounded-lg bg-accent px-3 py-1.5 text-xs text-white transition-colors hover:bg-accent-dim disabled:opacity-40"
                >
                  {estado === "cambio" ? t("Volver a aprobar") : t("Aprobar reglas")}
                </button>
              )}
            </div>
          </div>
        </div>
      </Popover>
    </div>
  );
}
