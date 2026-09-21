import { Code2, Globe } from "lucide-react";
import { useChatStore } from "../store/chatStore";
import type { Settings } from "../types";

interface Props {
  disabled?: boolean;
}

// Chip de modo código y chip de búsqueda web: mutan un ajuste global al vuelo.
export default function ModeToggles({ disabled = false }: Props) {
  const settings = useChatStore((s) => s.settings);
  const saveSettings = useChatStore((s) => s.saveSettings);

  if (!settings) return null;

  const toggle = (key: "codeMode" | "webSearch") => {
    const next: Settings = { ...settings, [key]: !settings[key] };
    void saveSettings(next).catch(() => {});
  };

  const chip = (active: boolean) =>
    `flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs transition-colors disabled:opacity-40 ${
      active
        ? "border-accent/60 bg-accent/10 text-accent-soft"
        : "border-base-border text-zinc-400 hover:text-zinc-100 hover:border-accent/50"
    }`;

  return (
    <>
      <button
        onClick={() => toggle("codeMode")}
        disabled={disabled}
        aria-pressed={settings.codeMode}
        title={
          settings.codeMode
            ? "Modo código activado: respuestas directas, con código completo"
            : "Activar modo código"
        }
        className={chip(settings.codeMode)}
      >
        <Code2 className="w-3.5 h-3.5 shrink-0" />
        <span className="hidden sm:inline">Código</span>
      </button>
      <button
        onClick={() => toggle("webSearch")}
        disabled={disabled}
        aria-pressed={settings.webSearch}
        title={
          settings.webSearch
            ? "Búsqueda web activada: el chat consulta DuckDuckGo antes de responder y el modo trabajo puede pedir usar la herramienta web_search."
            : "Activar búsqueda web (DuckDuckGo, sin cuenta). Afecta al chat y al modo trabajo."
        }
        className={chip(settings.webSearch)}
      >
        <Globe className="w-3.5 h-3.5 shrink-0" />
        <span className="hidden sm:inline">Web</span>
      </button>
    </>
  );
}
