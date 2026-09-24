import { t } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { useChatStore } from "../store/chatStore";
import Popover from "./Popover";
import {
  REASONING_LEVELS,
  type ReasoningEffort,
  type Settings,
} from "../types";

const PROVIDER_LABELS: Record<Settings["activeProvider"], string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  local: "Local",
};

type ModelKey = "anthropicModel" | "openaiModel" | "localModel";

function modelField(s: Settings): ModelKey {
  if (s.activeProvider === "anthropic") return "anthropicModel";
  if (s.activeProvider === "openai") return "openaiModel";
  return "localModel";
}

type Probe = "checking" | "ok" | "error" | null;

export default function ProviderModelPicker() {
  const settings = useChatStore((s) => s.settings);
  const saveSettings = useChatStore((s) => s.saveSettings);
  const setView = useChatStore((s) => s.setView);

  const [open, setOpen] = useState(false);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [probe, setProbe] = useState<Probe>(null);
  const [ollamaModels, setOllamaModels] = useState<string[] | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const probeKey = settings
    ? `${settings.activeProvider}|${settings.anthropicModel}|${settings.openaiModel}|${settings.localModel}|${settings.localEndpoint}`
    : "";

  useEffect(() => {
    if (!settings) return;
    let cancelled = false;
    setProbe("checking");
    void invoke<string>("test_provider", {
      provider: settings.activeProvider,
      model: settings[modelField(settings)],
      endpoint: settings.localEndpoint,
    })
      .then(() => !cancelled && setProbe("ok"))
      .catch(() => !cancelled && setProbe("error"));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probeKey]);

  const refreshOllama = async () => {
    if (!settings) return;
    setLoadingModels(true);
    try {
      setOllamaModels(
        await invoke<string[]>("list_local_models", {
          endpoint: settings.localEndpoint,
        }),
      );
    } catch {
      setOllamaModels(null);
    } finally {
      setLoadingModels(false);
    }
  };

  useEffect(() => {
    if (open && settings?.activeProvider === "local" && ollamaModels === null) {
      void refreshOllama();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, settings?.activeProvider]);

  if (!settings) return null;

  const patch = async (part: Partial<Settings>) => {
    // Leer al escribir: el blob de ajustes se guarda completo y una copia vieja
    // del render barrería cualquier cambio reciente (el tema, p. ej.).
    const current = useChatStore.getState().settings;
    if (!current) return;
    await saveSettings({ ...current, ...part });
  };

  const model = settings[modelField(settings)];
  const effort: ReasoningEffort = settings.reasoningEffort ?? "off";
  const effortLabel =
    REASONING_LEVELS.find((l) => l.id === effort)?.short ?? "Off";
  const dot =
    probe === "ok"
      ? "bg-emerald-400"
      : probe === "error"
        ? "bg-red-400"
        : probe === "checking"
          ? "bg-amber-400 animate-pulse"
          : "bg-zinc-600";

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        title={t("Proveedor y modelo activo")}
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-zinc-400 hover:bg-layer/5 hover:text-zinc-100 transition-colors max-w-72"
      >
        <span className={`w-1.5 h-1.5 shrink-0 rounded-full ${dot}`} />
        <span className="truncate font-medium">{model || t("sin modelo")}</span>
        <span className="shrink-0 text-zinc-500">
          {PROVIDER_LABELS[settings.activeProvider]}
        </span>
        {effort !== "off" && (
          <span className="shrink-0 text-accent-soft">{effortLabel}</span>
        )}
        <ChevronDown className="w-3 h-3 shrink-0 text-zinc-500" />
      </button>

      <Popover
        open={open}
        anchorRef={triggerRef}
        onClose={() => setOpen(false)}
        width={320}
        cap={340}
        align="end"
        className="p-2 space-y-1"
      >
          <div className="text-[10px] uppercase tracking-wider text-zinc-600 px-2 pt-1 pb-0.5">
            {t("Proveedor")}
          </div>
          {(Object.keys(PROVIDER_LABELS) as Settings["activeProvider"][]).map(
            (p) => (
              <button
                key={p}
                onClick={() => void patch({ activeProvider: p })}
                className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
                  settings.activeProvider === p
                    ? "bg-base-hover text-zinc-100"
                    : "text-zinc-400 hover:bg-base-hover/60 hover:text-zinc-200"
                }`}
              >
                {PROVIDER_LABELS[p]}
                {settings.activeProvider === p && (
                  <Check className="w-3.5 h-3.5 ml-auto text-accent-soft" />
                )}
              </button>
            ),
          )}

          <div className="text-[10px] uppercase tracking-wider text-zinc-600 px-2 pt-2 pb-0.5">
            Modelo ({PROVIDER_LABELS[settings.activeProvider]})
          </div>
          {settings.activeProvider === "local" ? (
            <div className="px-1 pb-1 space-y-1 min-h-[96px]">
              {loadingModels && (
                <div className="flex items-center gap-2 px-1.5 py-1 text-[11px] text-zinc-500">
                  <RefreshCw className="w-3 h-3 animate-spin" /> Consultando Ollama…
                </div>
              )}
              {!loadingModels && ollamaModels === null && (
                <div className="px-1.5 py-1 text-[11px] text-zinc-500">
                  {t("No se pudo listar los modelos de Ollama.")}
                </div>
              )}
              {!loadingModels &&
                ollamaModels?.length === 0 && (
                  <div className="px-1.5 py-1 text-[11px] text-zinc-500">
                    {t("Ollama responde pero no tiene modelos descargados.")}
                  </div>
                )}
              {!loadingModels &&
                ollamaModels?.map((m) => (
                  <button
                    key={m}
                    onClick={() => {
                      void patch({ localModel: m });
                      setOpen(false);
                    }}
                    className={`w-full flex items-center gap-2 rounded-lg px-2 py-1 text-xs font-mono transition-colors truncate ${
                      settings.localModel === m
                        ? "bg-base-hover text-zinc-100"
                        : "text-zinc-400 hover:bg-base-hover/60"
                    }`}
                  >
                    {m}
                    {settings.localModel === m && (
                      <Check className="w-3 h-3 ml-auto shrink-0 text-accent-soft" />
                    )}
                  </button>
                ))}
              <button
                onClick={() => void refreshOllama()}
                className="w-full flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] text-zinc-500 hover:text-zinc-200 hover:bg-base-hover/60 transition-colors"
              >
                <RefreshCw className="w-3 h-3" /> Recargar lista
              </button>
            </div>
          ) : (
            <div className="px-1 pb-1">
              <input
                key={`${settings.activeProvider}-${model}`}
                defaultValue={model}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== model) void patch({ [modelField(settings)]: v } as Partial<Settings>);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                className="w-full rounded-lg border border-base-border bg-base px-2.5 py-1.5 text-xs font-mono outline-none focus:border-accent/70"
                placeholder={t("nombre del modelo")}
              />
            </div>
          )}

          <div className="border-t border-base-border mt-1 pt-1">
            <button
              onClick={() => setReasonOpen((v) => !v)}
              className="w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-base-hover/60 hover:text-zinc-200 transition-colors"
            >
              <Brain className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
              <span>{t("Razonamiento")}</span>
              <span
                className={`ml-auto ${
                  effort === "off" ? "text-zinc-500" : "text-accent-soft"
                }`}
              >
                {effortLabel}
              </span>
              {reasonOpen ? (
                <ChevronDown className="w-3 h-3 shrink-0 rotate-180 text-zinc-600" />
              ) : (
                <ChevronRight className="w-3 h-3 shrink-0 text-zinc-600" />
              )}
            </button>
            <div
              className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
                reasonOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
              }`}
            >
              <div className="overflow-hidden">
                <div className="pl-2 pb-1 space-y-0.5">
                {REASONING_LEVELS.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => void patch({ reasoningEffort: l.id })}
                    className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-1 text-xs transition-colors ${
                      effort === l.id
                        ? "bg-base-hover text-zinc-100"
                        : "text-zinc-400 hover:bg-base-hover/60"
                    }`}
                  >
                    {t(l.label)}
                    {effort === l.id && (
                      <Check className="w-3.5 h-3.5 ml-auto text-accent-soft" />
                    )}
                  </button>
                ))}
                <p className="px-2.5 pt-1 text-[10px] leading-snug text-zinc-600">
                  {t("Solo con modelos que lo soportan. No se aplica al modo trabajo.")}
                </p>
                </div>
              </div>
            </div>
          </div>

          <button
            onClick={() => {
              setOpen(false);
              setView("settings");
            }}
            className="w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] text-zinc-500 hover:bg-base-hover/60 hover:text-zinc-200 transition-colors"
          >
            <Settings2 className="w-3 h-3" />
            Ajustes (claves, endpoints, pruebas)
            <ExternalLink className="w-3 h-3 ml-auto" />
          </button>
      </Popover>
    </div>
  );
}
