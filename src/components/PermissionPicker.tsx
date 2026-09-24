import { t } from "../i18n";
import { useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
} from "lucide-react";
import { useChatStore } from "../store/chatStore";
import { useWorkStore } from "../store/workStore";
import Popover from "./Popover";
import { APPROVAL_LEVELS, type ApprovalLevel } from "../types";

function LevelIcon({ level, className }: { level: ApprovalLevel; className: string }) {
  if (level === "full_access") return <ShieldAlert className={className} />;
  if (level === "auto_sandbox") return <ShieldCheck className={className} />;
  if (level === "ask_always") return <ShieldQuestion className={className} />;
  return <ShieldCheck className={className} />;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/// Nivel de aprobación del proyecto abierto; si no hay proyecto, el valor por
/// defecto que heredan los proyectos nuevos.
export default function PermissionPicker({ open, onOpenChange }: Props) {
  const settings = useChatStore((s) => s.settings);
  const saveSettings = useChatStore((s) => s.saveSettings);
  const projectId = useWorkStore((s) => s.activeProjectId);
  const project = useWorkStore((s) =>
    s.projects.find((p) => p.id === projectId),
  );
  const setProjectLevel = useWorkStore((s) => s.setApprovalLevel);

  const [confirming, setConfirming] = useState<ApprovalLevel | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const fallback: ApprovalLevel = "approve_for_me";
  const level: ApprovalLevel = projectId
    ? project?.approvalLevel ?? fallback
    : settings?.defaultApprovalLevel ?? fallback;

  const current = APPROVAL_LEVELS.find((l) => l.id === level) ?? APPROVAL_LEVELS[1];

  const close = () => {
    setConfirming(null);
    onOpenChange(false);
  };

  const apply = async (id: ApprovalLevel) => {
    onOpenChange(false);
    setConfirming(null);
    if (projectId) {
      await setProjectLevel(projectId, id);
      return;
    }
    // Se lee al escribir, no del render: así un cambio hecho mientras el menú
    // estaba abierto (el tema, p. ej.) no se pisa al guardar el nivel.
    const current = useChatStore.getState().settings;
    if (!current) return;
    await saveSettings({ ...current, defaultApprovalLevel: id });
  };

  const choose = (id: ApprovalLevel) => {
    if (id === level) {
      onOpenChange(false);
      return;
    }
    if (id === "full_access" || level === "full_access") setConfirming(id);
    else void apply(id);
  };

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        onClick={() => (open ? close() : onOpenChange(true))}
        title={t("Permisos de herramientas — {l}", { l: t(current.label) })}
        className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs transition-colors ${
          level === "full_access"
            ? "border-red-500/60 text-red-300 hover:border-red-400"
            : "border-base-border text-zinc-400 hover:text-zinc-100 hover:border-accent/50"
        }`}
      >
        <LevelIcon level={level} className="w-3.5 h-3.5 shrink-0" />
        <span className="max-w-32 truncate">{t(current.short)}</span>
        <ChevronDown
          className={`w-3 h-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      <Popover
        open={open}
        anchorRef={triggerRef}
        onClose={close}
        width={320}
        cap={420}
        className="p-1.5"
      >
          {!confirming ? (
            <>
              <p className="px-2.5 py-1.5 text-xs text-zinc-500">
                {t("¿Cómo se aprueban las acciones de Hatboo?")}
              </p>
              {APPROVAL_LEVELS.map((l) => (
                <button
                  key={l.id}
                  onClick={() => choose(l.id)}
                  className={`w-full text-left rounded-lg px-2.5 py-2 transition-colors ${
                    l.id === level ? "bg-base-hover" : "hover:bg-base-hover/60"
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <LevelIcon
                      level={l.id}
                      className={`w-4 h-4 shrink-0 ${
                        l.id === "full_access" ? "text-red-400" : "text-zinc-400"
                      }`}
                    />
                    <span
                      className={`flex-1 text-sm ${
                        l.id === "full_access"
                          ? "text-red-300"
                          : "text-zinc-100"
                      }`}
                    >
                      {t(l.label)}
                    </span>
                    {l.id === level && (
                      <Check className="w-4 h-4 shrink-0 text-accent-soft" />
                    )}
                  </span>
                  <span className="block pl-[26px] pt-1 text-[11px] leading-snug text-zinc-500">
                    {t(l.help)}
                  </span>
                </button>
              ))}
              <p className="px-2.5 pt-1.5 pb-1 text-[11px] text-zinc-600">
                {projectId
                  ? t("Se guarda en el proyecto «{n}».", { n: project?.name })
                  : t("No hay proyecto abierto: se guarda como nivel por defecto de los proyectos nuevos.")}
              </p>
            </>
          ) : (
            <div className="p-2 space-y-2">
              <p className="text-sm font-medium text-zinc-100">
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
                  onClick={() => void apply(confirming)}
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
