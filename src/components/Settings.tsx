import { setLanguage, t } from "../i18n";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import AjustesApi from "./settings/Api";
import AjustesGeneral from "./settings/General";
import AjustesAgente from "./settings/Agente";
import AjustesApariencia from "./settings/Apariencia";
import AjustesPerfil from "./settings/Perfil";
import AjustesAtajos from "./settings/Atajos";
import AjustesSistema from "./settings/Sistema";
import AjustesDatos from "./settings/Datos";
import AjustesAcercaDe from "./settings/AcercaDe";
import { SectionTitle } from "./settings/piezas";
import { CAMPO } from "./modalUi";
import {
  Cpu,
  Bot,
  Brain,
  Info,
  Keyboard,
  Palette,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  User,
  Database,
  HardDrive,
  X,
} from "lucide-react";
import { useChatStore } from "../store/chatStore";
import { useWorkStore } from "../store/workStore";
import SkillsSettings from "./SkillsSettings";
import MemoriaView from "./MemoriaView";
import { applyAccent, applyDensity, applyTheme } from "../theme";
import { type Settings as SettingsType, type StorageInfo } from "../types";
import { PROVEEDORES } from "../proveedores";

type CategoryId =
  | "api"
  | "agent"
  | "skills"
  | "profile"
  | "memoria"
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
  { id: "general", label: "General", icon: SlidersHorizontal, ready: true },
  { id: "appearance", label: "Apariencia", icon: Palette, ready: true },
  { id: "api", label: "API y modelos", icon: Cpu, ready: true },
  { id: "agent", label: "Agente", icon: Bot, ready: true },
  { id: "skills", label: "Skills", icon: Sparkles, ready: true },
  { id: "profile", label: "Perfil", icon: User, ready: true },
  { id: "memoria", label: "Memoria", icon: Brain, ready: true },
  { id: "system", label: "Sistema", icon: HardDrive, ready: true },
  { id: "data", label: "Datos", icon: Database, ready: true },
  { id: "shortcuts", label: "Atajos", icon: Keyboard, ready: true },
  { id: "about", label: "Acerca de", icon: Info, ready: true },
];

export default function Settings() {
  const settings = useChatStore((s) => s.settings);
  const settingsError = useChatStore((s) => s.settingsError);
  const loadSettings = useChatStore((s) => s.loadSettings);
  const saveSettings = useChatStore((s) => s.saveSettings);
  const [draft, setDraft] = useState<SettingsType | null>(settings);
  const [savingMsg, setSavingMsg] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const cat = useChatStore((s) => s.settingsCat) as CategoryId;
  const setCat = useChatStore((s) => s.setSettingsCat);
  const [query, setQuery] = useState("");
  const setView = useChatStore((s) => s.setView);
  const [version, setVersion] = useState<string>("");
  const [storage, setStorage] = useState<StorageInfo | null>(null);

  // El borrador se toma una sola vez, al abrir Ajustes. Volvíamos a pintar el
  // formulario cada vez que `settings` cambiaba de identidad, y eso se comía lo
  // escrito sin guardar: un Ctrl+B, un chip del compositor que queda detrás o un
  // modelo elegido en la paleta renuevan los ajustes desde fuera.
  useEffect(() => {
    if (!draft && settings) setDraft(settings);
  }, [draft, settings]);

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

  useEffect(() => {
    void getVersion().then(setVersion).catch(() => setVersion(""));
    loadStorage();
  }, []);

  // Si `get_settings` falla no puede quedar un t("Cargando ajustes…") eterno: hay
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
            {settingsError ? t("No se pudieron leer los ajustes") : t("Cargando ajustes…")}
          </p>
          <p className="mt-1.5 text-xs leading-snug text-zinc-500">
            {settingsError ??
              t("Tarda más de lo normal; puedes cerrar y volver a abrir.")}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={() => setView("chat")}
              className="rounded-lg border border-base-border px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-500 transition-colors"
            >
              {t("Cerrar")}
            </button>
            <button
              onClick={() => void loadSettings()}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs text-white hover:bg-accent-dim transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {t("Reintentar")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const activeProviderMeta = PROVEEDORES.find(
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

  const field = CAMPO;

  /** Apariencia se aplica al pulsar: esperar a «Guardar ajustes» sería despistado. */
  const patchAppearance = async (part: Partial<SettingsType>) => {
    const next = { ...draft, ...part };
    setDraft(next);
    if (part.theme) applyTheme(part.theme);
    if (part.densidad) applyDensity(part.densidad);
    if (part.acento) applyAccent(part.acento);
    if (part.uiLanguage) setLanguage(part.uiLanguage);
    setSaveErr(null);
    try {
      await saveSettings(next);
    } catch (e) {
      setSaveErr(String(e));
    }
  };

  const editable =
    cat === "api" || cat === "agent" || cat === "profile" || cat === "general";

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
      <div className="relative flex w-full max-w-5xl h-[85vh] overflow-clip rounded-2xl border border-base-border hatboo-blur shadow-2xl shadow-shade/50">
        <button
          onClick={close}
          title={t("Cerrar (Esc)")}
          className="absolute right-3 top-3 z-10 grid place-items-center w-8 h-8 rounded-lg text-zinc-500 hover:text-layer hover:bg-base-hover transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Rail de categorías */}
        <nav className="w-60 shrink-0 border-r border-base-border bg-base-raised p-3 overflow-y-auto">
          <h1 className="px-1 mb-2 mt-1 text-sm font-semibold text-zinc-200">
            {t("Ajustes")}
          </h1>
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 w-3.5 h-3.5 -translate-y-1/2 text-zinc-600" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("Buscar en Ajustes")}
              className={`${CAMPO} py-1.5 pl-8 pr-2 text-xs`}
            />
          </div>
          <div className="space-y-1">
            {visible.map((c) => {
              const Icon = c.icon;
              const active = c.id === cat;
              return (
                <button
                  key={c.id}
                  onClick={() => setCat(c.id)}
                  className={`relative w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors text-left ${
                    active
                      ? "bg-accent/15 text-accent-soft"
                      : "text-zinc-400 hover:bg-base-hover hover:text-zinc-200"
                  }`}
                >
                  {active && (
                    <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-accent" />
                  )}
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="flex-1">{t(c.label)}</span>
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
                {t("Sin coincidencias para «{q}».", { q: query.trim() })}
              </p>
            )}
          </div>
        </nav>

        {/* Contenido */}
        <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-8 py-8 space-y-6">
          {cat === "api" && (
            <AjustesApi
              draft={draft}
              setDraft={setDraft}
              field={field}
              activeProviderMeta={activeProviderMeta}
            />
          )}

          {cat === "general" && (
            <AjustesGeneral draft={draft} setDraft={setDraft} />
          )}

          {cat === "agent" && (
            <AjustesAgente draft={draft} setDraft={setDraft} />
          )}

          {cat === "appearance" && (
            <AjustesApariencia
              draft={draft}
              patchAppearance={patchAppearance}
              saveErr={saveErr}
            />
          )}

          {cat === "skills" && (
            <>
              <SectionTitle
                title="Skills"
                subtitle={t("Plantillas de comportamiento escritas por ti.")}
              />
              <SkillsSettings />
            </>
          )}

          {cat === "profile" && (
            <AjustesPerfil draft={draft} setDraft={setDraft} field={field} />
          )}

          {/* Guarda sola: cada nota se escribe en SQLite al añadirla, no hay un
              borrador global que perder al cambiar de pestaña. */}
          {cat === "memoria" && <MemoriaView />}

          {cat === "shortcuts" && <AjustesAtajos />}

          {cat === "system" && (
            <AjustesSistema
              storage={storage}
              version={version}
              onCargar={loadStorage}
            />
          )}

          {cat === "data" && (
            <AjustesDatos storage={storage} onRecargar={reloadEverywhere} />
          )}

          {cat === "about" && <AjustesAcercaDe version={version} />}

          {!CATEGORIES.find((c) => c.id === cat)?.ready && (
            <>
              <SectionTitle
                title={
                  CATEGORIES.find((c) => c.id === cat)?.label ?? "Ajustes"
                }
                subtitle={t("Esta categoría está en desarrollo.")}
              />
              <p className="text-sm text-zinc-500">
                {t(
                  "Aquí irá el control de {c} de Hatboo. Todavía no está construido; volveremos en una próxima tanda.",
                  { c: CATEGORIES.find((k) => k.id === cat)?.label.toLowerCase() ?? "" },
                )}
              </p>
            </>
          )}

          </div>
        </div>

        {editable && (
          // Pie aparte del scroll: sin él, «Guardar» caía al final de las
          // categorías largas y no había manera de saber si quedaban cambios.
          <div className="shrink-0 flex items-center gap-3 border-t border-base-border bg-base-raised px-8 py-3">
            <button
              onClick={() =>
                void save().then((ok) => {
                  if (ok) useWorkStore.getState().refreshToolSupport();
                })
              }
              className="px-4 py-2 rounded-lg bg-accent text-white text-sm hover:bg-accent-dim transition-colors"
            >
              {savingMsg ? t("Guardado ✓") : t("Guardar ajustes")}
            </button>
            {saveErr && <span className="text-xs text-red-400">{saveErr}</span>}
            <span className="ml-auto text-[11px] text-zinc-600">
              {t("Esc para cerrar")}
            </span>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

