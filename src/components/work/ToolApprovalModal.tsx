import { t } from "../../i18n";
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useWorkStore, useActiveTab } from "../../store/workStore";

export default function ToolApprovalModal() {
  const tab = useActiveTab();
  const approval = tab?.approval ?? null;
  const approvalLevel = tab?.approvalLevel ?? "approve_for_me";
  const respond = useWorkStore((s) => s.respond);
  const [busy, setBusy] = useState(false);

  if (!approval) return null;

  const answer = async (approved: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      await respond(approved);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className="w-full max-w-xl rounded-xl border border-base-border hatboo-blur shadow-2xl">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-base-border">
          <AlertTriangle className="w-5 h-5 text-amber-400" />
          <h2 className="text-sm font-semibold">
            El agente quiere ejecutar{" "}
            <span className="text-accent-soft font-mono">{approval.toolName}</span>
          </h2>
          {approvalLevel === "ask_always" && (
            <span className="ml-auto text-[10px] uppercase tracking-wider text-amber-300/80 shrink-0">
              {t("Preguntar siempre")}
            </span>
          )}
        </div>

        <div className="px-5 py-4 space-y-3 max-h-[55vh] overflow-y-auto">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
              {t("Argumentos")}
            </div>
            <pre className="p-3 rounded-lg bg-base-code border border-base-border text-[12px] font-mono text-zinc-300 whitespace-pre-wrap break-words">
              {JSON.stringify(approval.input, null, 2)}
            </pre>
          </div>
          {approval.preview && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
                {approval.toolName === "write_file" ? t("Diff del cambio") : t("Vista previa")}
              </div>
              <pre className="p-3 rounded-lg bg-base-code border border-base-border text-[12px] font-mono whitespace-pre-wrap break-words max-h-72 overflow-y-auto">
                {approval.preview.split("\n").map((line, i) => (
                  <div
                    key={i}
                    className={
                      line.startsWith("+")
                        ? "text-emerald-400"
                        : line.startsWith("-")
                          ? "text-red-400"
                          : "text-zinc-500"
                    }
                  >
                    {line}
                  </div>
                ))}
              </pre>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-base-border">
          <button
            onClick={() => void answer(false)}
            disabled={busy}
            className="px-4 py-2 rounded-lg border border-base-border text-sm text-zinc-300 hover:border-red-500/50 hover:text-red-300 transition-colors disabled:opacity-40"
          >
            {t("Rechazar")}
          </button>
          <button
            onClick={() => void answer(true)}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-accent text-white text-sm hover:bg-accent-dim transition-colors disabled:opacity-40"
          >
            {t("Aprobar")}
          </button>
        </div>
      </div>
    </div>
  );
}
