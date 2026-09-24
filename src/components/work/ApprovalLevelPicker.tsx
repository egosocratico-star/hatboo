import { t } from "../../i18n";
import { useRef, useState } from "react";
import { ChevronDown, ShieldCheck, ShieldAlert, ShieldQuestion } from "lucide-react";
import { useWorkStore } from "../../store/workStore";
import Popover from "../Popover";
import { APPROVAL_LEVELS, type ApprovalLevel } from "../../types";

function LevelIcon({ level }: { level: ApprovalLevel }) {
  if (level === "full_access") return <ShieldAlert className="w-3.5 h-3.5 text-red-400" />;
  if (level === "auto_sandbox") return <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />;
  if (level === "ask_always") return <ShieldQuestion className="w-3.5 h-3.5 text-amber-300" />;
  return <ShieldCheck className="w-3.5 h-3.5 text-accent-soft" />;
}

export default function ApprovalLevelPicker({ projectId }: { projectId: string }) {
  const level = useWorkStore((s) => s.tabs[projectId]?.approvalLevel ?? "approve_for_me");
  const setApprovalLevel = useWorkStore((s) => s.setApprovalLevel);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<ApprovalLevel | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = () => {
    setOpen(false);
    setConfirming(null);
  };

  const current = APPROVAL_LEVELS.find((l) => l.id === level)!;

  const apply = (id: ApprovalLevel) => {
    void setApprovalLevel(projectId, id);
    setOpen(false);
    setConfirming(null);
  };

  const choose = (id: ApprovalLevel) => {
    if (id === level) return;
    if (id === "full_access" || level === "full_access") setConfirming(id);
    else apply(id);
  };

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        title={t("Nivel de aprobación: {l} — {h}", { l: t(current.label), h: t(current.help) })}
        className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] transition-colors ${
          level === "full_access"
            ? "border-red-500/60 text-red-300 hover:border-red-400"
            : "border-base-border bg-base-raised text-zinc-400 hover:border-accent/50 hover:text-zinc-200"
        }`}
      >
        <LevelIcon level={level} />
        <span className="max-w-28 truncate">{current.short}</span>
        <ChevronDown className="w-3 h-3" />
      </button>

      <Popover
        open={open}
        anchorRef={triggerRef}
        onClose={close}
        width={288}
        align="end"
        className="p-1"
      >
          {!confirming ? (
            APPROVAL_LEVELS.map((l) => (
              <button
                key={l.id}
                onClick={() => choose(l.id)}
                className={`w-full text-left rounded-lg px-2.5 py-2 transition-colors ${
                  l.id === level ? "bg-base-hover" : "hover:bg-base-hover/60"
                }`}
              >
                <span className="flex items-center gap-2">
                  <LevelIcon level={l.id} />
                  <span
                    className={`text-xs font-medium ${
                      l.id === "full_access" ? "text-red-300" : "text-zinc-200"
                    }`}
                  >
                    {t(l.label)}
                  </span>
                  {l.id === level && (
                    <span className="ml-auto text-[10px] text-accent-soft">{t("activo")}</span>
                  )}
                </span>
                <span className="block pl-[22px] pt-0.5 text-[11px] leading-snug text-zinc-500">
                  {t(l.help)}
                </span>
              </button>
            ))
          ) : (
            <div className="p-2 space-y-2">
              <p className="text-xs text-zinc-200 font-medium">
                {confirming === "full_access"
                  ? t("Activar Acceso total")
                  : t("Salir de Acceso total")}
              </p>
              <p className="text-[11px] leading-snug text-zinc-400">
                {confirming === "full_access"
                  ? t("Hatboo ejecutará TODAS las acciones sin pedir aprobación, incluida escritura de archivos y comandos. El sandbox de rutas dentro de la carpeta del proyecto se mantiene.")
                  : t("Vas a cambiar fuera de Acceso total: las tools de alto riesgo volverán a pedir aprobación.")}
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setConfirming(null)}
                  className="px-2.5 py-1 rounded-lg border border-base-border text-xs text-zinc-300 hover:border-zinc-500"
                >
                  {t("Cancelar")}
                </button>
                <button
                  onClick={() => apply(confirming)}
                  className={`px-2.5 py-1 rounded-lg text-xs text-white ${
                    confirming === "full_access"
                      ? "bg-red-500 hover:bg-red-600"
                      : "bg-accent hover:bg-accent-dim"
                  }`}
                >
                  {t("Confirmar")}
                </button>
              </div>
            </div>
          )}
      </Popover>
    </div>
  );
}
