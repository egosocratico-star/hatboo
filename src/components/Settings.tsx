import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  CheckCircle2,
  KeyRound,
  RefreshCw,
  Trash2,
  XCircle,
  Zap,
} from "lucide-react";
import { useChatStore } from "../store/chatStore";
import { useWorkStore } from "../store/workStore";
import type { Settings as SettingsType } from "../types";

const PROVIDERS = [
  { id: "anthropic", label: "Anthropic (Claude)", needsKey: true },
  { id: "openai", label: "OpenAI", needsKey: true },
  { id: "local", label: "Local (Ollama / llama.cpp)", needsKey: false },
] as const;

type TestState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "ok"; msg: string }
  | { status: "error"; msg: string };

function modelFor(draft: SettingsType, providerId: string): string {
  if (providerId === "anthropic") return draft.anthropicModel;
  if (providerId === "openai") return draft.openaiModel;
  return draft.localModel;
}

function ConnectionTestButton({
  providerId,
  draft,
}: {
  providerId: string;
  draft: SettingsType;
}) {
  const [test, setTest] = useState<TestState>({ status: "idle" });

  const run = async () => {
    setTest({ status: "running" });
    try {
      const msg = await invoke<string>("test_provider", {
        provider: providerId,
        model: modelFor(draft, providerId),
        endpoint: draft.localEndpoint,
      });
      setTest({ status: "ok", msg });
    } catch (e) {
      setTest({ status: "error", msg: String(e) });
    }
  };

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        onClick={() => void run()}
        disabled={test.status === "running"}
        title="Probar conexión con este proveedor"
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-base-border text-xs text-zinc-300 hover:border-accent/50 hover:text-white disabled:opacity-50 transition-colors"
      >
        {test.status === "running" ? (
          <RefreshCw className="w-3 h-3 animate-spin" />
        ) : (
          <Zap className="w-3 h-3 text-accent-soft" />
        )}
        {test.status === "running" ? "Probando…" : "Probar conexión"}
      </button>
      {test.status === "ok" && (
        <span className="inline-flex items-start gap-1 text-[11px] text-emerald-400 max-w-xs">
          <CheckCircle2 className="w-3 h-3 mt-0.5 shrink-0" />
          <span>{test.msg}</span>
        </span>
      )}
      {test.status === "error" && (
        <span className="inline-flex items-start gap-1 text-[11px] text-red-400 max-w-xs">
          <XCircle className="w-3 h-3 mt-0.5 shrink-0" />
          <span>{test.msg}</span>
        </span>
      )}
    </div>
  );
}

function LocalModelField({
  draft,
  onChange,
  field,
}: {
  draft: SettingsType;
  onChange: (model: string) => void;
  field: string;
}) {
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setNotice(null);
    try {
      const list = await invoke<string[]>("list_local_models", {
        endpoint: draft.localEndpoint,
      });
      setModels(list);
      if (list.length === 0) setNotice("Ollama responde pero no tiene modelos descargados.");
    } catch (e) {
      setModels([]);
      setNotice(`No se pudo listar modelos: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.localEndpoint]);

  return (
    <label className="block space-y-1">
      <span className="text-xs text-zinc-500">Modelo local</span>
      <div className="flex gap-2">
        <input
          value={draft.localModel}
          onChange={(e) => onChange(e.target.value)}
          list="hatboo-local-models"
          className={`${field} flex-1`}
          placeholder="llama3.2"
        />
        <datalist id="hatboo-local-models">
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          title="Recargar modelos desde Ollama"
          className="px-3 py-2 rounded-lg border border-base-border text-zinc-400 hover:text-white hover:border-accent/50 disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>
      {models.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {models.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onChange(m)}
              className={`px-2 py-0.5 rounded-md border text-[11px] transition-colors ${
                draft.localModel === m
                  ? "border-accent bg-accent/10 text-accent-soft"
                  : "border-base-border text-zinc-400 hover:text-white hover:border-accent/40"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      )}
      {notice && <p className="text-[11px] text-zinc-500 pt-0.5">{notice}</p>}
    </label>
  );
}

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
              <div
                key={p.id}
                className={`rounded-lg border px-3 py-2.5 transition-colors ${
                  draft.activeProvider === p.id
                    ? "border-accent bg-accent/10"
                    : "border-base-border bg-base"
                }`}
              >
                <button
                  onClick={() => setDraft({ ...draft, activeProvider: p.id })}
                  className={`w-full text-left text-sm ${
                    draft.activeProvider === p.id
                      ? "text-accent-soft"
                      : "text-zinc-400"
                  }`}
                >
                  {p.label}
                </button>
                <div className="mt-2">
                  <ConnectionTestButton providerId={p.id} draft={draft} />
                </div>
              </div>
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
            <LocalModelField
              draft={draft}
              field={field}
              onChange={(model) => setDraft({ ...draft, localModel: model })}
            />
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
                proyecto. Desactivado por defecto. Si está habilitado, si cada
                comando pide aprobación lo decide el nivel de aprobación del
                proyecto (vista Trabajo).
              </span>
            </span>
          </label>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-medium text-zinc-300">Perfil</h2>
          <label className="block space-y-1">
            <span className="text-xs text-zinc-500">¿Cómo debería llamarte Hatboo?</span>
            <input
              value={draft.assistantName ?? ""}
              maxLength={40}
              onChange={(e) =>
                setDraft({ ...draft, assistantName: e.target.value })
              }
              className={field}
              placeholder="p. ej. Azrael (vacío = sin nombre)"
            />
            <span className="block text-[11px] text-zinc-600">
              Se añade al prompt del chat y del agente para que te trate por ese
              nombre. Solo local.
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
