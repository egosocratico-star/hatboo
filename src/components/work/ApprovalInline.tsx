import { t } from "../../i18n";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, FileCode2, FilePlus2 } from "lucide-react";
import { useActiveTab, useWorkStore } from "../../store/workStore";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO } from "../modalUi";
import DiffView, { ArchivoCompleto } from "../DiffView";
import { parseaDiff } from "../../diff";

/** La ruta del archivo que se va a escribir, sacada del propio diff: las
 *  cabeceras `--- /dev/null` / `+++ b/ruta` ya la traen. */
function rutaDelDiff(diff: string) {
  for (const f of parseaDiff(diff)) {
    if (f.kind === "archivo" && f.texto.startsWith("+++ ")) {
      return f.texto.slice(4).replace(/^b\//, "");
    }
  }
  return "";
}

/**
 * La aprobación del agente, en el hilo y no en un modal encima de todo: lo que
 * se decide aquí es un cambio concreto sobre un archivo, y verlo junto al paso
 * que lo produjo —con sus números de línea— es más directo que un cartel
 * centrado. Cuándo se pide sigue mandándolo los niveles de aprobación; esto solo
 * cambia dónde se enseña.
 */
export default function ApprovalInline() {
  const tab = useActiveTab();
  const approval = tab?.approval ?? null;
  const approvalLevel = tab?.approvalLevel ?? "approve_for_me";
  const respond = useWorkStore((s) => s.respond);
  const [busy, setBusy] = useState(false);
  const [entero, setEntero] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);

  // Sin modal ya no hay nada que obligue a mirar: si el hilo está largo, la
  // tarjeta puede haber quedado fuera de la pantalla. Se baja hasta ella al
  // aparecer, de golpe y sin animación.
  useEffect(() => {
    raiz.current?.scrollIntoView({ block: "nearest" });
  }, [approval?.toolCallId]);

  if (!approval) return null;

  const escribe = approval.toolName === "write_file";
  const contenido = escribe ? String(approval.input["content"] ?? "") : "";
  const nuevo = approval.preview.startsWith("--- /dev/null");
  const ruta = escribe ? (String(approval.input["path"] ?? "") || rutaDelDiff(approval.preview)) : "";

  const answer = async (aprobado: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      await respond(aprobado);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={raiz} className="rounded-lg border border-amber-500/40 bg-amber-500/[0.07]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-amber-500/30 px-2.5 py-2">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
        <span className="text-xs font-medium text-zinc-200">
          {t("El agente quiere ejecutar")}{" "}
          <span className="font-mono text-accent-soft">{approval.toolName}</span>
        </span>
        {escribe && (
          <span className="flex min-w-0 items-center gap-1 text-xs text-zinc-300">
            {nuevo ? (
              <FilePlus2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
            ) : (
              <FileCode2 className="h-3.5 w-3.5 shrink-0 text-amber-400" />
            )}
            {ruta && (
              <code className="min-w-0 truncate rounded border border-base-border bg-base-raised px-1 py-px font-mono text-[11px] text-accent-soft">
                {ruta}
              </code>
            )}
            <span className="shrink-0 text-[10px] text-zinc-500">
              {nuevo ? t("nuevo") : t("modificado")}
            </span>
          </span>
        )}
        {approvalLevel === "ask_always" && (
          <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wider text-amber-300/80">
            {t("Preguntar siempre")}
          </span>
        )}
      </div>

      <div className="space-y-2 px-2.5 py-2">
        {escribe && entero && (
          <ArchivoCompleto texto={contenido} />
        )}
        {escribe && !entero && approval.preview.trim() !== "" && (
          <DiffView diff={approval.preview} altoMax={300} />
        )}
        {/* Sin diff no hay nada que colorear: se enseña la vista previa que
            aporta la tool, y si no trae ninguna, sus argumentos tal cual. */}
        {(!escribe || approval.preview.trim() === "") && (
          <>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">
              {approval.preview ? t("Vista previa") : t("Argumentos")}
            </div>
            <pre className="max-h-52 overflow-auto rounded-md border border-base-border bg-base-code px-2 py-1.5 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-zinc-300">
              {approval.preview || JSON.stringify(approval.input, null, 2)}
            </pre>
          </>
        )}
        {escribe && contenido.length > 0 && approval.preview.trim() !== "" && (
          <button
            onClick={() => setEntero((v) => !v)}
            className="rounded-md border border-base-border px-1.5 py-0.5 text-[10px] text-zinc-500 transition-colors hover:bg-base-hover hover:text-zinc-200"
          >
            {entero ? t("Ver solo los cambios") : t("Ver el archivo completo")}
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-amber-500/30 px-2.5 py-2">
        <span className="mr-auto min-w-0 truncate text-[10px] text-zinc-500">
          {t("Se aplica dentro de la carpeta del proyecto y nada más.")}
        </span>
        <button
          onClick={() => void answer(false)}
          disabled={busy}
          className={`${BOTON_SECUNDARIO} hover:border-red-500/50 hover:text-red-300 disabled:opacity-40`}
        >
          {t("Rechazar")}
        </button>
        <button onClick={() => void answer(true)} disabled={busy} className={BOTON_PRIMARIO}>
          {t("Aprobar")}
        </button>
      </div>
    </div>
  );
}
