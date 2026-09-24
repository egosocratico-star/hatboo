import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileDiff, FilePlus2, FilePen } from "lucide-react";
import Popover from "../Popover";

interface Cambio {
  ruta: string;
  diff: string;
  creado: boolean;
  escrituras: number;
}

/**
 * Lo que el agente escribió en esta sesión de trabajo. Sale de los diffs que ya
 * se guardaron al aplicar cada `write_file`, así que funciona también en
 * proyectos que no son repo de git. Si el archivo se escribió varias veces se
 * muestra el último diff, que es el estado final.
 */
export default function SessionChanges({
  conversationId,
  recargarCon,
}: {
  conversationId: string | null;
  /** Algo que cambia cuando el agente termina: fuerza a volver a leer. */
  recargarCon: unknown;
}) {
  const [open, setOpen] = useState(false);
  const [cambios, setCambios] = useState<Cambio[]>([]);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open || !conversationId) return;
    let vivo = true;
    void invoke<Cambio[]>("session_changes", { conversationId }).then(
      (c) => vivo && setCambios(c),
      () => vivo && setCambios([])
    );
    return () => {
      vivo = false;
    };
  }, [open, conversationId, recargarCon]);

  const total = cambios.length;

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        title={
          total === 0
            ? "Aún no has escrito archivos en esta sesión"
            : `${total} archivo${total === 1 ? "" : "s"} escrito${total === 1 ? "" : "s"} en esta sesión`
        }
        className={`relative flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] transition-colors ${
          total > 0
            ? "border-accent/50 bg-accent/10 text-accent-soft hover:border-accent"
            : "border-base-border bg-base-raised text-zinc-400 hover:border-accent/50 hover:text-zinc-200"
        }`}
      >
        <FileDiff className="w-3.5 h-3.5 shrink-0" />
        <span>Cambios</span>
        {total > 0 && <span className="tabular-nums">{total}</span>}
      </button>

      <Popover
        open={open}
        anchorRef={triggerRef}
        onClose={() => setOpen(false)}
        width={480}
        cap={480}
        className="p-3 space-y-2"
      >
        <p className="text-xs font-medium text-zinc-200">
          Cambios de esta sesión
        </p>
        {total === 0 ? (
          <p className="text-[11px] text-zinc-500">
            El agente todavía no escribió ningún archivo aquí.
          </p>
        ) : (
          cambios.map((c) => (
            <div key={c.ruta} className="rounded-lg border border-base-border overflow-hidden">
              <div className="flex items-center gap-1.5 px-2 py-1.5 bg-base text-[11px]">
                {c.creado ? (
                  <FilePlus2 className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
                ) : (
                  <FilePen className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                )}
                <span className="font-mono truncate text-zinc-200">{c.ruta}</span>
                <span className="ml-auto shrink-0 text-zinc-500">
                  {c.creado ? "nuevo" : "modificado"}
                  {c.escrituras > 1 ? ` · ${c.escrituras} escrituras` : ""}
                </span>
              </div>
              <pre className="max-h-40 overflow-auto px-2 py-1.5 bg-base-code text-[11px] font-mono leading-relaxed whitespace-pre text-zinc-300">
                {c.diff || "(sin diff)"}
              </pre>
            </div>
          ))
        )}
      </Popover>
    </div>
  );
}
