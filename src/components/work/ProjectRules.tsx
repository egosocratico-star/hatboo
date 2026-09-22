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
            ? "El agente está leyendo las reglas de este proyecto (HATBOO.md)"
            : "Reglas de este proyecto (HATBOO.md): aún no hay ninguna"
        }
        className={`relative flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] transition-colors ${
          hayReglas
            ? "border-accent/50 bg-accent/10 text-accent-soft hover:border-accent"
            : "border-base-border bg-base-raised text-zinc-400 hover:border-accent/50 hover:text-zinc-200"
        }`}
      >
        <FileText className="w-3.5 h-3.5 shrink-0" />
        <span>Reglas</span>
      </button>

      <Popover
        open={open}
        anchorRef={triggerRef}
        onClose={() => setOpen(false)}
        width={420}
        cap={460}
        className="p-3 space-y-2.5"
      >
        <div>
          <p className="text-xs font-medium text-zinc-200">
            Reglas de este proyecto
          </p>
          <p className="text-[11px] text-zinc-500 break-all">
            {reglas?.path ?? "HATBOO.md"} — se añade al prompt del agente al
            empezar cada sesión de trabajo de esta carpeta. No amplía el sandbox
            ni quita aprobaciones.
          </p>
        </div>

        <textarea
          value={borrador}
          onChange={(e) => setBorrador(e.target.value)}
          rows={11}
          spellCheck={false}
          placeholder={"Escribe aquí las convenciones del proyecto…"}
          className="w-full resize-y rounded-lg border border-base-border bg-base-code px-2.5 py-2 font-mono text-[11px] leading-relaxed text-zinc-200 focus:border-accent/60 focus:outline-none"
        />

        {error && <p className="text-[11px] text-red-400">{error}</p>}

        <div className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-600">{borrador.length} caracteres</span>
          {!reglas?.exists && (
            <button
              onClick={() => setBorrador(PLANTILLA)}
              className="rounded-md px-2 py-1 text-[11px] text-zinc-400 hover:bg-base-hover hover:text-zinc-200 transition-colors"
            >
              Empezar con una plantilla
            </button>
          )}
          <button
            onClick={() => void guardar()}
            disabled={guardando}
            className="ml-auto rounded-lg bg-accent px-3 py-1.5 text-xs text-white hover:bg-accent-dim transition-colors disabled:opacity-50"
          >
            {guardando ? "Guardando…" : reglas?.exists ? "Guardar" : "Crear HATBOO.md"}
          </button>
        </div>
      </Popover>
    </div>
  );
}
