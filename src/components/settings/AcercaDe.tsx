import { t } from "../../i18n";
import { SectionTitle } from "./piezas";

/** Ajustes → Acerca de. Solo lo que es verdad hoy: sin telemetría que anunciar
 *  porque no la hay, y sin enlaces a una web que no existe. */
export default function AjustesAcercaDe({ version }: { version: string }) {
  return (
    <>
      <SectionTitle
        title={t("Acerca de")}
        subtitle={t("Información de la aplicación.")}
      />
      <section className="space-y-3 text-sm text-zinc-300">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-semibold text-layer">
            Hatboo
          </span>
          <span className="text-zinc-500">
            v{version || "—"}
          </span>
        </div>
        <p className="text-zinc-400 leading-relaxed">
          {t("Chat de IA de escritorio, local-first: sin cuentas, sin telemetría y sin alojar inferencia. Tus conversaciones viven en una base de datos SQLite local y tus claves solo en el llavero del sistema.")}
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs pt-1">
          <dt className="text-zinc-500">{t("Interfaz")}</dt>
          <dd className="text-zinc-400">Tauri 2 · React · TypeScript · Tailwind</dd>
          <dt className="text-zinc-500">{t("Backend")}</dt>
          <dd className="text-zinc-400">{t("Rust · SQLite · keyring")}</dd>
          <dt className="text-zinc-500">{t("Proveedores")}</dt>
          <dd className="text-zinc-400">
            Anthropic · OpenAI · OpenRouter · Google Gemini · Hugging Face ·
            local (Ollama / llama.cpp)
          </dd>
        </dl>
      </section>
    </>
  );
}
