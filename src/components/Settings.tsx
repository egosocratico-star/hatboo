import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { open as pickFile, save as pickSavePath } from "@tauri-apps/plugin-dialog";
import {
  CheckCircle2,
  Cpu,
  Bot,
  FolderOpen,
  Info,
  KeyRound,
  Keyboard,
  Palette,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  User,
  Database,
  Download,
  HardDrive,
  AlertTriangle,
  Upload,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { useChatStore } from "../store/chatStore";
import { useWorkStore } from "../store/workStore";
import SkillsSettings from "./SkillsSettings";
import { applyTheme, type ThemeChoice } from "../theme";
import {
  REASONING_LEVELS,
  CHAT_FONT_SIZES,
  type ReasoningEffort,
  type Settings as SettingsType,
  type StorageInfo,
  type ExportSummary,
  type ImportReport,
  RESET_TOKEN,
} from "../types";

const PROVIDERS = [
  { id: "anthropic", label: "Anthropic (Claude)", needsKey: true },
  { id: "openai", label: "OpenAI", needsKey: true },
  { id: "local", label: "Local (Ollama / llama.cpp)", needsKey: false },
] as const;

const THEMES: Array<{ id: ThemeChoice; label: string }> = [
  { id: "dark", label: "Oscuro" },
  { id: "light", label: "Claro" },
  { id: "system", label: "Sistema" },
];

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
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-base-border text-xs text-zinc-300 hover:border-accent/50 hover:text-layer disabled:opacity-50 transition-colors"
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
          className="px-3 py-2 rounded-lg border border-base-border text-zinc-400 hover:text-layer hover:border-accent/50 disabled:opacity-50 transition-colors"
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
                  : "border-base-border text-zinc-400 hover:text-layer hover:border-accent/40"
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

type CategoryId =
  | "api"
  | "agent"
  | "skills"
  | "profile"
  | "shortcuts"
  | "about"
  | "general"
  | "appearance"
  | "system"
  | "data";

const CATEGORIES: Array<{
  id: CategoryId;
  label: string;
  icon: typeof Cpu;
  ready: boolean;
}> = [
  { id: "general", label: "General", icon: SlidersHorizontal, ready: false },
  { id: "appearance", label: "Apariencia", icon: Palette, ready: true },
  { id: "api", label: "API y modelos", icon: Cpu, ready: true },
  { id: "agent", label: "Agente", icon: Bot, ready: true },
  { id: "skills", label: "Skills", icon: Sparkles, ready: true },
  { id: "profile", label: "Perfil", icon: User, ready: true },
  { id: "system", label: "Sistema", icon: HardDrive, ready: true },
  { id: "data", label: "Datos", icon: Database, ready: true },
  { id: "shortcuts", label: "Atajos", icon: Keyboard, ready: true },
  { id: "about", label: "Acerca de", icon: Info, ready: true },
];

const MOD = navigator.platform.toLowerCase().includes("mac") ? "⌘" : "Ctrl";

const SHORTCUTS: Array<{ keys: string[]; desc: string }> = [
  { keys: [MOD, "Enter"], desc: "Enviar mensaje" },
  { keys: ["Shift", "Enter"], desc: "Salto de línea en el campo" },
  { keys: [MOD, "N"], desc: "Nueva conversación" },
  { keys: [MOD, ","], desc: "Abrir Ajustes" },
  { keys: [MOD, "F"], desc: "Buscar en la conversación" },
  { keys: [MOD, "B"], desc: "Plegar o desplegar la barra lateral" },
  { keys: ["Esc"], desc: "Volver al chat desde Ajustes / cerrar un menú" },
];

export default function Settings() {
  const settings = useChatStore((s) => s.settings);
  const settingsError = useChatStore((s) => s.settingsError);
  const loadSettings = useChatStore((s) => s.loadSettings);
  const saveSettings = useChatStore((s) => s.saveSettings);
  const [draft, setDraft] = useState<SettingsType | null>(settings);
  const [savingMsg, setSavingMsg] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [cat, setCat] = useState<CategoryId>("api");
  const [query, setQuery] = useState("");
  const setView = useChatStore((s) => s.setView);
  const [version, setVersion] = useState<string>("");
  const [storage, setStorage] = useState<StorageInfo | null>(null);

  useEffect(() => setDraft(settings), [settings]);

  const [dataBusy, setDataBusy] = useState(false);
  const [dataMsg, setDataMsg] = useState<string | null>(null);
  const [dataErr, setDataErr] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetText, setResetText] = useState("");

  const loadStorage = () =>
    void invoke<StorageInfo>("get_storage_info")
      .then(setStorage)
      .catch(() => setStorage(null));

  /** Tras importar o borrar hay que recargar todo lo que estaba en caché. */
  const reloadEverywhere = () => {
    loadStorage();
    void useChatStore.getState().loadConversations();
    void useChatStore.getState().loadSettings();
    void useChatStore.getState().loadSkills();
    void useWorkStore.getState().loadProjects();
  };

  const exportAll = async () => {
    const day = new Date().toISOString().slice(0, 10);
    const path = await pickSavePath({
      defaultPath: `hatboo-copia-${day}.json`,
      filters: [{ name: "Copia de Hatboo", extensions: ["json"] }],
    });
    if (!path) return;
    setDataBusy(true);
    setDataMsg(null);
    setDataErr(null);
    try {
      const r = await invoke<ExportSummary>("export_all_data", { path });
      setDataMsg(
        `Copia creada con ${r.conversations} conversación(es), ${r.messages} mensaje(s) y ${r.images} imagen(es) · ${Math.max(1, Math.round(r.bytes / 1024))} KB`,
      );
    } catch (e) {
      setDataErr(String(e));
    } finally {
      setDataBusy(false);
    }
  };

  const importAll = async () => {
    const path = await pickFile({
      multiple: false,
      filters: [{ name: "Copia de Hatboo", extensions: ["json"] }],
    });
    if (typeof path !== "string") return;
    setDataBusy(true);
    setDataMsg(null);
    setDataErr(null);
    try {
      const r = await invoke<ImportReport>("import_all_data", { path });
      setDataMsg(
        `Importación terminada: ${r.conversationsAdded} conversación(es) y ${r.messagesAdded} mensaje(s) nuevos` +
          (r.skillsAdded > 0 ? `, ${r.skillsAdded} plantilla(s)` : "") +
          (r.skippedExisting > 0 ? `, ${r.skippedExisting} elemento(s) ya estaban` : "") +
          (r.imagesRestored > 0 ? `, ${r.imagesRestored} imagen(es) restaurada(s)` : "") +
          (r.imagesMissing > 0 ? `, ${r.imagesMissing} imagen(es) no estaban en la copia` : ""),
      );
      reloadEverywhere();
    } catch (e) {
      setDataErr(String(e));
    } finally {
      setDataBusy(false);
    }
  };

  const doReset = async () => {
    setDataBusy(true);
    setDataErr(null);
    try {
      await invoke("factory_reset", { token: resetText });
      setResetOpen(false);
      setResetText("");
      setDataMsg("Hatboo restablecida: sin conversaciones, sin proyectos, sin claves guardadas.");
      reloadEverywhere();
    } catch (e) {
      setDataErr(String(e));
    } finally {
      setDataBusy(false);
    }
  };

  useEffect(() => {
    void getVersion().then(setVersion).catch(() => setVersion(""));
    loadStorage();
  }, []);

  // Si `get_settings` falla no puede quedar un "Cargando ajustes…" eterno: hay
  // que poder cerrar y reintentar desde el propio modal.
  if (!draft) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) setView("chat");
        }}
      >
        <div className="w-full max-w-md rounded-2xl border border-base-border bg-base p-5 shadow-2xl shadow-shade/50">
          <p className="text-sm font-medium text-zinc-100">
            {settingsError ? "No se pudieron leer los ajustes" : "Cargando ajustes…"}
          </p>
          <p className="mt-1.5 text-xs leading-snug text-zinc-500">
            {settingsError ??
              "Tarda más de lo normal; puedes cerrar y volver a abrir."}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={() => setView("chat")}
              className="rounded-lg border border-base-border px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-500 transition-colors"
            >
              Cerrar
            </button>
            <button
              onClick={() => void loadSettings()}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs text-white hover:bg-accent-dim transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Reintentar
            </button>
          </div>
        </div>
      </div>
    );
  }

  const activeProviderMeta = PROVIDERS.find(
    (p) => p.id === draft.activeProvider,
  );

  /** Devuelve si se guardó, para no refrescar dependencias en vano. */
  const save = async (): Promise<boolean> => {
    setSaveErr(null);
    try {
      await saveSettings(draft);
      setSavingMsg(true);
      setTimeout(() => setSavingMsg(false), 1500);
      return true;
    } catch (e) {
      setSaveErr(String(e));
      return false;
    }
  };

  const field =
    "w-full rounded-lg border border-base-border bg-base px-3 py-2 text-sm outline-none focus:border-accent/70";

  /** Apariencia se aplica al pulsar: esperar a «Guardar ajustes» sería despistado. */
  const patchAppearance = async (part: Partial<SettingsType>) => {
    const next = { ...draft, ...part };
    setDraft(next);
    if (part.theme) applyTheme(part.theme);
    setSaveErr(null);
    try {
      await saveSettings(next);
    } catch (e) {
      setSaveErr(String(e));
    }
  };

  const editable = cat === "api" || cat === "agent" || cat === "profile";

  const needle = query.trim().toLowerCase();
  const visible = CATEGORIES.filter((c) =>
    c.label.toLowerCase().includes(needle),
  );

  const close = () => setView("chat");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="relative flex w-full max-w-5xl h-[85vh] overflow-clip rounded-2xl border border-base-border bg-base shadow-2xl shadow-shade/50">
        <button
          onClick={close}
          title="Cerrar (Esc)"
          className="absolute right-3 top-3 z-10 grid place-items-center w-8 h-8 rounded-lg text-zinc-500 hover:text-layer hover:bg-base-hover transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Rail de categorías */}
        <nav className="w-60 shrink-0 border-r border-base-border bg-base-raised/40 p-3 overflow-y-auto">
          <h1 className="px-1 mb-2 mt-9 text-sm font-semibold text-zinc-200">
            Ajustes
          </h1>
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 w-3.5 h-3.5 -translate-y-1/2 text-zinc-600" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar en Ajustes"
              className="w-full rounded-lg border border-base-border bg-base py-1.5 pl-8 pr-2 text-xs outline-none placeholder:text-zinc-600 focus:border-accent/70"
            />
          </div>
          <div className="space-y-0.5">
            {visible.map((c) => {
              const Icon = c.icon;
              const active = c.id === cat;
              return (
                <button
                  key={c.id}
                  onClick={() => setCat(c.id)}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors text-left ${
                    active
                      ? "bg-accent/15 text-accent-soft"
                      : "text-zinc-400 hover:bg-base-hover hover:text-zinc-200"
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="flex-1">{c.label}</span>
                  {!c.ready && (
                    <span className="text-[9px] uppercase tracking-wide text-zinc-600">
                      pronto
                    </span>
                  )}
                </button>
              );
            })}
            {visible.length === 0 && (
              <p className="px-2 py-3 text-xs text-zinc-600">
                Sin coincidencias para «{query.trim()}».
              </p>
            )}
          </div>
        </nav>

        {/* Contenido */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-8 py-8 space-y-8">
          {cat === "api" && (
            <>
              <SectionTitle
                title="API y modelos"
                subtitle="Proveedor de IA, credenciales y modelos."
              />
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
                        onClick={() =>
                          setDraft({ ...draft, activeProvider: p.id })
                        }
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
                  <h2 className="text-sm font-medium text-zinc-300">
                    Credenciales
                  </h2>
                  <p className="text-xs text-zinc-500">
                    Las keys se guardan en el llavero del sistema operativo,
                    nunca en la base de datos.
                  </p>
                  <ApiKeyField provider={draft.activeProvider} />
                </section>
              )}

              <section className="space-y-3">
                <h2 className="text-sm font-medium text-zinc-300">Modelos</h2>
                <div className="space-y-3">
                  <label className="block space-y-1">
                    <span className="text-xs text-zinc-500">
                      Modelo de Anthropic
                    </span>
                    <input
                      value={draft.anthropicModel}
                      onChange={(e) =>
                        setDraft({ ...draft, anthropicModel: e.target.value })
                      }
                      className={field}
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-xs text-zinc-500">
                      Modelo de OpenAI
                    </span>
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
                    onChange={(model) =>
                      setDraft({ ...draft, localModel: model })
                    }
                  />
                </div>
              </section>

              <section className="space-y-3">
                <h2 className="text-sm font-medium text-zinc-300">
                  Razonamiento
                </h2>
                <div className="flex items-center justify-between gap-4 rounded-lg border border-base-border bg-base px-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm text-zinc-300">
                      Pensamiento extendido en el chat
                    </p>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      Pide al modelo que razone antes de responder. Solo funciona
                      con modelos que lo soportan y no afecta al modo trabajo.
                    </p>
                  </div>
                  <div className="shrink-0 flex rounded-lg border border-base-border bg-base-raised p-0.5">
                    {REASONING_LEVELS.map((l) => (
                      <button
                        key={l.id}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            reasoningEffort: l.id as ReasoningEffort,
                          })
                        }
                        className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                          (draft.reasoningEffort ?? "off") === l.id
                            ? "bg-accent/20 text-accent-soft"
                            : "text-zinc-500 hover:text-zinc-300"
                        }`}
                      >
                        {l.label}
                      </button>
                    ))}
                  </div>
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
            </>
          )}

          {cat === "agent" && (
            <>
              <SectionTitle
                title="Agente (modo trabajo)"
                subtitle="Qué puede hacer el agente en la vista de Trabajo."
              />
              <section className="space-y-3">
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
                      Habilitar{" "}
                      <code className="font-mono text-accent-soft">
                        run_command
                      </code>
                    </span>
                    <span className="block text-xs text-zinc-500">
                      Permite que el agente ejecute comandos de shell dentro del
                      proyecto. Desactivado por defecto. Si está habilitado, si
                      cada comando pide aprobación lo decide el nivel de
                      aprobación del proyecto (vista Trabajo).
                    </span>
                  </span>
                </label>
                <p className="text-[11px] text-zinc-600">
                  El nivel de aprobación se ajusta por proyecto en la vista de
                  Trabajo. El límite de pasos del agente y las categorías de
                  herramientas globales llegarán en una próxima tanda.
                </p>
              </section>
            </>
          )}

          {cat === "appearance" && (
            <>
              <SectionTitle
                title="Apariencia"
                subtitle="Cómo se ve Hatboo. Se aplica al elegirlo, sin guardar."
              />
              <section className="space-y-3">
                <div className="rounded-lg border border-base-border bg-base px-3 py-3">
                  <p className="text-sm text-zinc-200">Tema</p>
                  <p className="mt-0.5 mb-2.5 text-xs text-zinc-500">
                    «Sistema» sigue el claro/oscuro de Windows mientras la app
                    esté abierta.
                  </p>
                  <div className="flex gap-1">
                    {THEMES.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => void patchAppearance({ theme: t.id })}
                        className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                          (draft.theme || "dark") === t.id
                            ? "bg-accent/20 text-accent-soft"
                            : "text-zinc-500 hover:text-zinc-300"
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border border-base-border bg-base px-3 py-3">
                  <p className="text-sm text-zinc-200">Tamaño del texto del chat</p>
                  <p className="mt-0.5 mb-2.5 text-xs text-zinc-500">
                    Afecta a las respuestas y a tus mensajes; el código va dos
                    puntos por debajo.
                  </p>
                  <div className="flex gap-1">
                    {CHAT_FONT_SIZES.map((f) => (
                      <button
                        key={f.id}
                        onClick={() => void patchAppearance({ chatFontSize: f.id })}
                        className={`px-2.5 py-1 rounded-md transition-colors ${
                          (draft.chatFontSize || "md") === f.id
                            ? "bg-accent/20 text-accent-soft"
                            : "text-zinc-500 hover:text-zinc-300"
                        }`}
                        style={{ fontSize: f.px * 0.8 }}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                  <p
                    className="mt-2.5 text-zinc-300"
                    style={{
                      fontSize:
                        CHAT_FONT_SIZES.find(
                          (f) => f.id === (draft.chatFontSize || "md"),
                        )?.px ?? 15,
                    }}
                  >
                    Ejemplo: así se vería una respuesta de Hatboo.
                  </p>
                </div>
                {saveErr && <p className="text-xs text-red-400">{saveErr}</p>}
              </section>
            </>
          )}

          {cat === "skills" && (
            <>
              <SectionTitle
                title="Skills"
                subtitle="Plantillas de comportamiento escritas por ti."
              />
              <SkillsSettings />
            </>
          )}

          {cat === "profile" && (
            <>
              <SectionTitle title="Perfil" subtitle="Cómo te trata Hatboo." />
              <section className="space-y-3">
                <label className="block space-y-1">
                  <span className="text-xs text-zinc-500">
                    ¿Cómo debería llamarte Hatboo?
                  </span>
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
                    Se añade al prompt del chat y del agente para que te trate
                    por ese nombre. Solo local.
                  </span>
                </label>
              </section>
            </>
          )}

          {cat === "shortcuts" && (
            <>
              <SectionTitle
                title="Atajos"
                subtitle="Atajos de teclado disponibles en esta versión."
              />
              <section className="space-y-2">
                {SHORTCUTS.map((s) => (
                  <div
                    key={s.desc}
                    className="flex items-center justify-between gap-4 rounded-lg border border-base-border bg-base px-3 py-2.5"
                  >
                    <span className="text-sm text-zinc-300">{s.desc}</span>
                    <span className="flex items-center gap-1.5 shrink-0">
                      {s.keys.map((k) => (
                        <kbd
                          key={k}
                          className="px-1.5 py-0.5 rounded-md border border-base-border bg-base-raised text-[11px] font-mono text-zinc-400"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </div>
                ))}
                <p className="text-[11px] text-zinc-600">
                  Remapear atajos llegará en una versión futura.
                </p>
              </section>
            </>
          )}

          {cat === "system" && (
            <>
              <SectionTitle
                title="Sistema"
                subtitle="Dónde guarda Hatboo sus archivos en este equipo."
              />
              {!storage && (
                <p className="text-sm text-zinc-500">
                  No se pudo leer el estado de almacenamiento.
                </p>
              )}
              {storage && (
                <div className="space-y-3">
                  <PathRow
                    label="Base de datos"
                    path={storage.dbPath}
                    detail={`${formatBytes(storage.dbSizeBytes)} · SQLite`}
                  />
                  <PathRow
                    label="Imágenes adjuntas"
                    path={storage.attachmentsPath}
                    detail={`${storage.attachmentsCount} archivo(s) · ${formatBytes(
                      storage.attachmentsSizeBytes,
                    )}`}
                  />
                  <div className="flex items-center justify-between gap-4 rounded-lg border border-base-border bg-base px-3 py-3">
                    <div>
                      <p className="text-sm text-zinc-300">Versión</p>
                      <p className="mt-0.5 text-xs text-zinc-600">
                        Tauri 2 · React · Rust
                      </p>
                    </div>
                    <span className="text-sm text-zinc-400">
                      v{version || "—"}
                    </span>
                  </div>
                  <button
                    onClick={loadStorage}
                    className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-200 transition-colors"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Volver a calcular
                  </button>
                </div>
              )}
            </>
          )}

          {cat === "data" && (
            <>
              <SectionTitle
                title="Datos"
                subtitle="Resumen de lo que hay en tu base de datos local."
              />
              <div className="space-y-4">
                {storage ? (
                  <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    <Stat label="Conversaciones" value={storage.counts.conversations} />
                    <Stat label="Mensajes" value={storage.counts.messages} />
                    <Stat label="Proyectos" value={storage.counts.projects} />
                    <Stat label="Tareas" value={storage.counts.tasks} />
                    <Stat
                      label="Llamadas a herramientas"
                      value={storage.counts.toolCalls}
                    />
                    <Stat label="Imágenes" value={storage.attachmentsCount} />
                  </div>
                  <p className="text-xs text-zinc-500 leading-relaxed">
                    Todo esto se calcula leyendo tu propio histórico en este PC;
                    no se envía a ningún servicio. Las claves de API no aparecen
                    aquí porque solo viven en el llavero del sistema. Puedes
                    exportar una conversación concreta desde el botón{" "}
                    <span className="text-zinc-400">+</span> del chat.
                  </p>
                  </>
                ) : (
                  <p className="text-sm text-zinc-500">
                    No se pudo leer la base de datos ahora mismo; más abajo
                    puedes exportar, importar o restablecer igualmente.
                  </p>
                )}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      onClick={() => void exportAll()}
                      disabled={dataBusy}
                      className="flex items-center gap-1.5 rounded-lg border border-base-border px-3 py-1.5 text-xs text-zinc-300 hover:border-accent/50 hover:text-layer transition-colors disabled:opacity-40"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Exportar todo (JSON)
                    </button>
                    <button
                      onClick={() => void importAll()}
                      disabled={dataBusy}
                      className="flex items-center gap-1.5 rounded-lg border border-base-border px-3 py-1.5 text-xs text-zinc-300 hover:border-accent/50 hover:text-layer transition-colors disabled:opacity-40"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      Importar copia
                    </button>
                    <button
                      onClick={() => {
                        setResetOpen(true);
                        setDataErr(null);
                      }}
                      disabled={dataBusy}
                      className="flex items-center gap-1.5 rounded-lg border border-red-500/40 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/10 transition-colors disabled:opacity-40"
                    >
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Restablecer de fábrica
                    </button>
                  </div>
                  {dataMsg && (
                    <p className="text-xs text-emerald-400/80">{dataMsg}</p>
                  )}
                  {dataErr && <p className="text-xs text-red-400">{dataErr}</p>}
                  {resetOpen && (
                    <div className="space-y-2 rounded-xl border border-red-500/40 bg-red-500/5 p-3">
                      <p className="text-sm font-medium text-zinc-100">
                        Restablecer Hatboo
                      </p>
                      <p className="text-[11px] leading-snug text-zinc-400">
                        Se borran de este PC todas las conversaciones, los
                        proyectos, las tareas, las imágenes adjuntas y los
                        ajustes, y también las claves de API del llavero. No se
                        puede deshacer: exporta una copia antes si quieres
                        conservar algo. Escribe{" "}
                        <span className="font-medium text-zinc-100">
                          {RESET_TOKEN}
                        </span>{" "}
                        para confirmar.
                      </p>
                      <input
                        value={resetText}
                        onChange={(e) => setResetText(e.target.value)}
                        placeholder={RESET_TOKEN}
                        className="w-full rounded-lg border border-base-border bg-base px-2.5 py-1.5 text-xs outline-none focus:border-red-500/50"
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => {
                            setResetOpen(false);
                            setResetText("");
                          }}
                          className="rounded-lg border border-base-border px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-500 transition-colors"
                        >
                          Cancelar
                        </button>
                        <button
                          onClick={() => void doReset()}
                          disabled={resetText.trim() !== RESET_TOKEN || dataBusy}
                          className="rounded-lg bg-red-500 px-3 py-1.5 text-xs text-white hover:bg-red-600 disabled:opacity-40 transition-colors"
                        >
                          Borrar todo
                        </button>
                      </div>
                    </div>
                  )}
              </div>
            </>
          )}

          {cat === "about" && (
            <>
              <SectionTitle
                title="Acerca de"
                subtitle="Información de la aplicación."
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
                  Chat de IA de escritorio, local-first: sin cuentas, sin
                  telemetría y sin alojar inferencia. Tus conversaciones viven en
                  una base de datos SQLite local y tus claves solo en el llavero
                  del sistema.
                </p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs pt-1">
                  <dt className="text-zinc-500">Interfaz</dt>
                  <dd className="text-zinc-400">Tauri 2 · React · TypeScript · Tailwind</dd>
                  <dt className="text-zinc-500">Backend</dt>
                  <dd className="text-zinc-400">Rust · SQLite · keyring</dd>
                  <dt className="text-zinc-500">Proveedores</dt>
                  <dd className="text-zinc-400">
                    Anthropic · OpenAI · local (Ollama / llama.cpp)
                  </dd>
                </dl>
              </section>
            </>
          )}

          {!CATEGORIES.find((c) => c.id === cat)?.ready && (
            <>
              <SectionTitle
                title={
                  CATEGORIES.find((c) => c.id === cat)?.label ?? "Ajustes"
                }
                subtitle="Esta categoría está en desarrollo."
              />
              <p className="text-sm text-zinc-500">
                Aquí irá el control de {CATEGORIES.find((c) => c.id === cat)?.label.toLowerCase()} de
                Hatboo. Todavía no está construido; volveremos en una próxima
                tanda.
              </p>
            </>
          )}

          {editable && (
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={() =>
                  void save().then((ok) => {
                    if (ok) useWorkStore.getState().refreshToolSupport();
                  })
                }
                className="px-4 py-2 rounded-lg bg-accent text-white text-sm hover:bg-accent-dim transition-colors"
              >
                {savingMsg ? "Guardado ✓" : "Guardar ajustes"}
              </button>
              {saveErr && (
                <span className="text-xs text-red-400">{saveErr}</span>
              )}
            </div>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header>
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="text-sm text-zinc-500 mt-1">{subtitle}</p>
    </header>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function PathRow({
  label,
  path,
  detail,
}: {
  label: string;
  path: string;
  detail: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-base-border bg-base px-3 py-3">
      <div className="min-w-0">
        <p className="text-sm text-zinc-300">{label}</p>
        <p className="mt-0.5 text-xs font-mono text-zinc-500 break-all">{path}</p>
        <p className="mt-1 text-xs text-zinc-600">{detail}</p>
      </div>
      <button
        onClick={() => void revealItemInDir(path).catch(() => {})}
        title="Mostrar en el explorador de archivos"
        className="shrink-0 flex items-center gap-1.5 rounded-lg border border-base-border px-2.5 py-1.5 text-xs text-zinc-400 hover:text-zinc-100 hover:border-accent/50 transition-colors"
      >
        <FolderOpen className="w-3.5 h-3.5" />
        Mostrar
      </button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-base-border bg-base px-3 py-3 text-center">
      <div className="text-xl font-semibold text-layer">
        {value.toLocaleString("es")}
      </div>
      <div className="mt-0.5 text-[11px] text-zinc-500">{label}</div>
    </div>
  );
}
