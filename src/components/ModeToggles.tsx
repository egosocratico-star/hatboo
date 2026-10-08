import { t } from "../i18n";
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
    // Se lee el estado en el momento de escribir: guardar el blob entero desde la
    // copia de este render podía pisar un cambio hecho mientras tanto (el tema).
    const current = useChatStore.getState().settings;
    if (!current) return;
    const next: Settings = { ...current, [key]: !current[key] };
    void saveSettings(next).catch(() => {});
  };

  // El chip apagado es un icono, sin palabra: eran dos pastillas con rótulo fijo
  // delante del cursor, ocupando la línea del compositor para decir «esto NO está
  // activado». Encendido vuelve la palabra, que es cuando el estado tiene que ser
  // imposible de pasar por alto —el prompt cambia con él—. Fondo de superficie
  // elevada en el apagado: sin él era un contorno sobre el panel, del mismo peso
  // que los iconos de la cabecera, y no se leía como «esto se puede pulsar».
  const chip = (activo: boolean) =>
    `flex items-center gap-1.5 rounded-full border py-1.5 text-xs transition-colors disabled:opacity-40 ${
      activo ? "px-2.5" : "px-1.5"
    } ${
      activo
        ? "border-accent/60 bg-accent/10 text-accent-soft"
        : "border-base-border bg-base-card text-zinc-400 hover:bg-base-hover hover:text-zinc-100 hover:border-accent/50"
    }`;

  return (
    <>
      <button
        onClick={() => toggle("codeMode")}
        disabled={disabled}
        aria-pressed={settings.codeMode}
        title={
          settings.codeMode
            ? t("Modo código activado: respuestas directas, con código completo")
            : t("Activar modo código")
        }
        className={chip(settings.codeMode)}
      >
        <Code2 className="w-3.5 h-3.5 shrink-0" />
        {settings.codeMode && <span>{t("Código")}</span>}
      </button>
      <button
        onClick={() => toggle("webSearch")}
        disabled={disabled}
        aria-pressed={settings.webSearch}
        title={
          settings.webSearch
            ? t("Búsqueda web activada: el chat consulta DuckDuckGo antes de responder y el modo trabajo puede pedir usar la herramienta web_search.")
            : t("Activar búsqueda web (DuckDuckGo, sin cuenta). Afecta al chat y al modo trabajo.")
        }
        className={chip(settings.webSearch)}
      >
        <Globe className="w-3.5 h-3.5 shrink-0" />
        {settings.webSearch && <span>{t("Web")}</span>}
      </button>
    </>
  );
}
