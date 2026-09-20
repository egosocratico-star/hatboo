import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CheckCircle2, KeyRound, Trash2 } from "lucide-react";
import { useChatStore } from "../store/chatStore";
import { useWorkStore } from "../store/workStore";
import type { Settings as SettingsType } from "../types";

const PROVIDERS = [
  { id: "anthropic", label: "Anthropic (Claude)", needsKey: true },
  { id: "openai", label: "OpenAI", needsKey: true },
  { id: "local", label: "Local (Ollama / llama.cpp)", needsKey: false },
] as const;

function ApiKeyField({ provider }: { provider: string }) {
  const [key, setKey] = useState("");
  const [configured, setConfigured] = useState(false);
  const [saved, setSaved] = useState(false);

  const refresh = () =>
    invoke<boolean>("has_api_key", { provider }).then(setConfigured);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  const save = async () => {
    if (!key.trim()) return;
    await invoke("set_api_key", { provider, key: key.trim() });
    setKey("");
    setSaved(true);
    await refresh();
    setTimeout(() => setSaved(false), 1500);
  };

  const remove = async () => {
    await invoke("delete_api_key", { provider });
    await refresh();
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-xs text-zinc-400">
        <KeyRound className="w-3.5 h-3.5" />
        API key de {provider}
        {configured && (
          <span className="ml-1 inline-flex items-center gap-1 text-emerald-400">
            <CheckCircle2 className="w-3 h-3" /> guardada en el llavero
          </span>
        )}
      </div>
      <div className="flex gap-2">
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void save()}
          placeholder={configured ? "•••••••• (configurada)" : "sk-…"}
          className="flex-1 rounded-lg border border-base-border bg-base px-3 py-2 text-sm outline-none focus:border-accent/70 placeholder:text-zinc-600"
        />
        <button
          onClick={() => void save()}
          disabled={!key.trim()}
          className="px-3 py-2 rounded-lg bg-accent text-white text-sm disabled:opacity-40 hover:bg-accent-dim transition-colors"
        >
          {saved ? "Guardada" : "Guardar"}
        </button>
        {configured && (
          <button
            onClick={() => void remove()}
            title="Borrar key"
            className="px-2.5 py-2 rounded-lg border border-base-border text-zinc-400 hover:text-red-400 hover:border-red-500/40 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

export default function Settings() {
  const settings = useChatStore((s) => s.settings);
  const saveSettings = useChatStore((s) => s.saveSettings);
  const [draft, setDraft] = useState<SettingsType | null>(settings);
  const [savingMsg, setSavingMsg] = useState(false);

  useEffect(() => setDraft(settings), [settings]);

  if (!draft) {
    return <div className="p-8 text-sm text-zinc-500">Cargando ajustes…</div>;
  }

  const activeProviderMeta = PROVIDERS.find(
    (p) => p.id === draft.activeProvider,
  );

  const save = async () => {
    await saveSettings(draft);
    setSavingMsg(true);
    setTimeout(() => setSavingMsg(false), 1500);
  };

  const field =
    "w-full rounded-lg border border-base-border bg-base px-3 py-2 text-sm outline-none focus:border-accent/70";

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-8 py-8 space-y-8">
        <header>
          <h1 className="text-xl font-semibold">Ajustes</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Proveedor de IA, credenciales y modelos.
          </p>
        </header>

        <section className="space-y-3">
          <h2 className="text-sm font-medium text-zinc-300">
            Proveedor activo
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                onClick={() => setDraft({ ...draft, activeProvider: p.id })}
                className={`rounded-lg border px-3 py-2.5 text-sm text-left transition-colors ${
                  draft.activeProvider === p.id
                    ? "border-accent bg-accent/10 text-accent-soft"
                    : "border-base-border bg-base text-zinc-400 hover:border-accent/40"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </section>

        {activeProviderMeta?.needsKey && (
          <section className="space-y-4">
            <h2 className="text-sm font-medium text-zinc-300">Credenciales</h2>
            <p className="text-xs text-zinc-500">
              Las keys se guardan en el llavero del sistema operativo, nunca en
              la base de datos.
            </p>
            <ApiKeyField provider={draft.activeProvider} />
          </section>
        )}

        <section className="space-y-3">
          <h2 className="text-sm font-medium text-zinc-300">Modelos</h2>
          <div className="space-y-3">
            <label className="block space-y-1">
              <span className="text-xs text-zinc-500">Modelo de Anthropic</span>
              <input
                value={draft.anthropicModel}
                onChange={(e) =>
                  setDraft({ ...draft, anthropicModel: e.target.value })
                }
                className={field}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-zinc-500">Modelo de OpenAI</span>
              <input
                value={draft.openaiModel}
                onChange={(e) =>
                  setDraft({ ...draft, openaiModel: e.target.value })
                }
                className={field}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-zinc-500">Modelo local</span>
              <input
                value={draft.localModel}
                onChange={(e) =>
                  setDraft({ ...draft, localModel: e.target.value })
                }
                className={field}
                placeholder="llama3.2"
              />
            </label>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-medium text-zinc-300">
            Servidor local
          </h2>
          <label className="block space-y-1">
            <span className="text-xs text-zinc-500">
              Endpoint (compatible con Ollama / llama.cpp)
            </span>
            <input
              value={draft.localEndpoint}
              onChange={(e) =>
                setDraft({ ...draft, localEndpoint: e.target.value })
              }
              className={field}
              placeholder="http://localhost:11434"
            />
          </label>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-medium text-zinc-300">
            Agente (modo trabajo)
          </h2>
          <label className="flex items-start gap-3 rounded-lg border border-base-border bg-base px-3 py-3 cursor-pointer">
            <input
              type="checkbox"
              checked={draft.runCommandEnabled}
              onChange={(e) =>
                setDraft({ ...draft, runCommandEnabled: e.target.checked })
              }
              className="mt-0.5 accent-violet-500"
            />
            <span className="space-y-0.5">
              <span className="block text-sm text-zinc-200">
                Habilitar <code className="font-mono text-accent-soft">run_command</code>
              </span>
              <span className="block text-xs text-zinc-500">
                Permite que el agente ejecute comandos de shell dentro del
                proyecto. Desactivado por defecto; cada comando requiere
                aprobación explícita de todas formas.
              </span>
            </span>
          </label>
        </section>

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={() =>
              void save().then(() =>
                useWorkStore.getState().refreshToolSupport(),
              )
            }
            className="px-4 py-2 rounded-lg bg-accent text-white text-sm hover:bg-accent-dim transition-colors"
          >
            {savingMsg ? "Guardado ✓" : "Guardar ajustes"}
          </button>
        </div>
      </div>
    </div>
  );
}
