import { currentLanguage, setLanguage, t } from "../i18n";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { open as pickFile, save as pickSavePath } from "@tauri-apps/plugin-dialog";
import Insignia from "./Insignia";
import Select from "./Select";
import Bloque, { BotonSeccion } from "./Bloque";
import { CAMPO } from "./modalUi";
import { gigabytes } from "../unidades";
import {
  CheckCircle2,
  Cpu,
  Bot,
  Brain,
  Copy,
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
import MemoriaView from "./MemoriaView";
import ThemePicker from "./ThemePicker";
import Avatar from "./Avatar";
import { applyMotion, applyTheme, type ThemeChoice } from "../theme";
import {
  REASONING_LEVELS,
  CHAT_FONT_SIZES,
  CHAT_FONTS,
  CHAT_FONT_STACKS,
  MOTION_OPTIONS,
  LANGUAGE_OPTIONS,
  type LanguageChoice,
  AVATAR_STYLES,
  BUBBLE_STYLES,
  AVATAR_COLORS,
  type AvatarStyle,
  type LocalModel,
  type Hardware,
  esfuerzoVisible,
  type MotionChoice,
  APPROVAL_LEVELS,
  type Settings as SettingsType,
  type StorageInfo,
  type ExportSummary,
  type ImportReport,
  RESET_TOKEN,
} from "../types";
import { NIVELES, nivelModelo, nivelPorNombre, saleDelEquipo } from "../modelo";
import {
  PROVEEDORES,
  endpointDe,
  modeloDe,
  MOTORES_IMAGEN,
  motorImagen,
  tamanosImagen,
  MOTORES_VOZ,
  motorVoz,
} from "../proveedores";

type TestState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "ok"; msg: string }
  | { status: "error"; msg: string };

/** Las tarjetas de proveedor, su estado real y una prueba que se puede lanzar
 *  sobre todas a la vez: antes había que ir de una en una para saber cuál
 *  estaba viva, y el modelo que se iba a usar no se veía hasta probar. */
function SelectorProveedor({
  draft,
  setDraft,
}: {
  draft: SettingsType;
  setDraft: (s: SettingsType) => void;
}) {
  const [pruebas, setPruebas] = useState<Record<string, TestState>>({});
  const [copiado, setCopiado] = useState(false);

  const probar = async (providerId: SettingsType["activeProvider"]) => {
    setPruebas((p) => ({ ...p, [providerId]: { status: "running" } }));
    try {
      const msg = await invoke<string>("test_provider", {
        provider: providerId,
        model: modeloDe(draft, providerId),
        endpoint: endpointDe(draft, providerId),
      });
      setPruebas((p) => ({ ...p, [providerId]: { status: "ok", msg } }));
    } catch (e) {
      setPruebas((p) => ({ ...p, [providerId]: { status: "error", msg: String(e) } }));
    }
  };

  const corriendo = PROVEEDORES.some((p) => pruebas[p.id]?.status === "running");

  /** Para pegar en un issue. Dice SI HAY clave, nunca cuál: las claves viven en
   *  el llavero y de ahí no salen ni para un diagnóstico. */
  const diagnostico = async () => {
    const claves = await Promise.all(
      PROVEEDORES.map(async (p) => {
        if (!p.needsKey) return `${p.id}: local, no usa clave`;
        const tiene = await invoke<boolean>("has_api_key", { provider: p.id }).catch(
          () => false,
        );
        return `${p.id}: ${tiene ? "clave en el llavero" : "sin clave"}`;
      }),
    );
    const version = await getVersion().catch(() => "?");
    const lineas = [
      `Hatboo ${version} · ${navigator.platform}`,
      `proveedor activo: ${draft.activeProvider}`,
      ...PROVEEDORES.map((p) => `modelo ${p.id}: ${modeloDe(draft, p.id) || "(vacío)"}`),
      ...claves,
      `endpoint local: ${draft.localEndpoint}`,
      `endpoint hf: ${draft.hfEndpoint}`,
      `razonamiento: ${esfuerzoVisible(draft.reasoningEffort)}`,
    ];
    try {
      await navigator.clipboard.writeText(lineas.join("\n"));
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch {
      // sin portapapeles no hay diagnóstico que copiar
    }
  };

  return (
    <Bloque
      titulo={t("Proveedor activo")}
      descripcion={t("De dónde salen las respuestas y con qué modelo.")}
      extra={
        <>
          <BotonSeccion
            onClick={() => void PROVEEDORES.forEach((p) => void probar(p.id))}
            disabled={corriendo}
            title={t("Prueba todos los proveedores a la vez")}
          >
            {corriendo ? (
              <RefreshCw className="w-3 h-3 animate-spin" />
            ) : (
              <Zap className="w-3 h-3 text-accent-soft" />
            )}
            {corriendo ? t("Probando…") : t("Comprobar todos")}
          </BotonSeccion>
          <BotonSeccion
            onClick={() => void diagnostico()}
            title={t("Copia el proveedor, los modelos y si hay clave guardada. La clave no viaja.")}
          >
            {copiado ? (
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            ) : (
              <Copy className="w-3 h-3" />
            )}
            {copiado ? t("Copiado") : t("Copiar diagnóstico")}
          </BotonSeccion>
        </>
      }
    >
      <div
        role="radiogroup"
        aria-label={t("Proveedor activo")}
        className="grid gap-1.5 sm:grid-cols-2"
      >
        {PROVEEDORES.map((p) => {
          const activo = draft.activeProvider === p.id;
          const modelo = modeloDe(draft, p.id);
          const nivel = nivelPorNombre(modelo);
          const prueba: TestState = pruebas[p.id] ?? { status: "idle" };
          const Icono = p.icono;
          return (
            <div
              key={p.id}
              className={`rounded-xl border p-2.5 transition-colors ${
                activo
                  ? "border-accent/60 bg-accent/[0.07]"
                  : "border-base-border bg-base hover:border-zinc-600"
              }`}
            >
              {/* El botón cubre la elección; la prueba va fuera para no anidar botones. */}
              <button
                role="radio"
                aria-checked={activo}
                onClick={() => setDraft({ ...draft, activeProvider: p.id })}
                className="flex w-full items-start gap-2 text-left"
              >
                <span
                  className={`mt-px grid h-6 w-6 shrink-0 place-items-center rounded-md ${
                    activo ? "bg-accent/20 text-accent-soft" : "bg-base-raised text-zinc-500"
                  }`}
                >
                  <Icono className="h-3 w-3" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={`truncate text-[13px] ${
                        activo ? "text-accent-soft" : "text-zinc-300"
                      }`}
                    >
                      {t(p.label)}
                    </span>
                    {activo && (
                      <Insignia tipo="ok" punto>
                        {t("Activo")}
                      </Insignia>
                    )}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">
                    {t(p.resumen)}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-1">
                    {modelo && (
                      <Insignia cuadrada mono title={t("Modelo que se usará con este proveedor")}>
                        {modelo}
                      </Insignia>
                    )}
                    {nivel && (
                      <Insignia
                        cuadrada
                        className={NIVELES[nivel].clases}
                        title={t(NIVELES[nivel].aviso)}
                      >
                        {t(NIVELES[nivel].corto)}
                      </Insignia>
                    )}
                    {saleDelEquipo(p.id, modelo) && (
                      <Insignia
                        tipo="info"
                        title={t("Las respuestas las genera un servidor externo.")}
                      >
                        {t("Sale del equipo")}
                      </Insignia>
                    )}
                  </span>
                </span>
              </button>
              <div className="mt-2 space-y-1 border-t border-base-border pt-2">
                <ProviderStatus providerId={p.id} endpoint={draft.localEndpoint} />
                <BotonSeccion
                  onClick={() => void probar(p.id)}
                  disabled={prueba.status === "running"}
                  title={t("Probar conexión con este proveedor")}
                >
                  {prueba.status === "running" ? (
                    <RefreshCw className="w-3 h-3 animate-spin" />
                  ) : (
                    <Zap className="w-3 h-3 text-accent-soft" />
                  )}
                  {prueba.status === "running" ? t("Probando…") : t("Probar conexión")}
                </BotonSeccion>
                {prueba.status === "ok" && (
                  <span className="flex items-start gap-1 text-[11px] text-emerald-400">
                    <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />
                    <span className="min-w-0 break-words">{prueba.msg}</span>
                  </span>
                )}
                {prueba.status === "error" && (
                  <span className="flex items-start gap-1 text-[11px] text-red-400">
                    <XCircle className="mt-0.5 h-3 w-3 shrink-0" />
                    <span className="min-w-0 break-words">{prueba.msg}</span>
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Bloque>
  );
}

/** El saludo de ejemplo se compone aquí, no se traduce: es texto que escribiría
 *  el modelo, no interfaz. Con `auto` se enseña en el idioma de la app, que es lo
 *  más parecido a «el mismo en que le escribas» que se puede pintar en seco. */
function saludoDeMuestra(
  idioma: "es" | "en",
  usted: boolean,
  nombre?: string,
): string {
  const quien = nombre ? `, ${nombre}` : "";
  if (idioma === "en") {
    return usted ? `Hello${quien}. How may I help you?` : `Hi${quien}. What can I help you with?`;
  }
  return usted ? `Hola${quien}. ¿En qué puedo ayudarle?` : `Hola${quien}. ¿En qué te echo una mano?`;
}

/** Cómo suena Hatboo con estos ajustes, antes de guardar. La frase real la
 *  compone el modelo; de aquí salen el nombre, el trato y el idioma. */
function SaludoPrevio({ draft }: { draft: SettingsType }) {
  const idioma: "es" | "en" =
    draft.answerLanguage === "en"
      ? "en"
      : draft.answerLanguage === "es"
        ? "es"
        : currentLanguage();
  const frase = saludoDeMuestra(
    idioma,
    draft.userAddress === "usted",
    draft.assistantName?.trim() || undefined,
  );

  return (
    <Bloque
      titulo={t("Vista previa")}
      descripcion={t(
        "Un ejemplo de cómo suena con estos ajustes. La frase exacta la compone el modelo.",
      )}
    >
      <div className="flex gap-2.5">
        <span className="mt-0.5 shrink-0">
          <Avatar
            style={(draft.avatarStyle || "mascota") as AvatarStyle}
            colorId={draft.avatarColor || "violeta"}
            emoji={draft.avatarEmoji || "🎩"}
            name="Hatboo"
            size={24}
          />
        </span>
        <p className="min-w-0 flex-1 rounded-2xl rounded-tl-md border border-base-border bg-base-raised px-3.5 py-2.5 text-sm text-zinc-200">
          {frase}
        </p>
      </div>
      {draft.answerLanguage === "auto" && (
        <p className="mt-2 text-[11px] text-zinc-600">
          {t(
            "Con «el mismo en que le escribas», aquí se ve en el idioma de la interfaz.",
          )}
        </p>
      )}
    </Bloque>
  );
}

/** Estado del proveedor sin haber pulsado nada: si hay clave guardada y si
 *  Ollama contesta. El botón de probar sigue para lo demás (el modelo responde).
 *
 *  Lleva pill además del punto de color: «Sin clave» con lucecita ámbar se leía
 *  igual que un proveedor ya configurado, y la duda era si aquello era un aviso
 *  o un simple adorno. */
function ProviderStatus({ providerId, endpoint }: { providerId: string; endpoint: string }) {
  const [estado, setEstado] = useState<{ texto: string; ok: boolean; etiqueta: string } | null>(
    null
  );

  useEffect(() => {
    let vivo = true;
    const mirar = async () => {
      try {
        if (providerId === "local") {
          const modelos = await invoke<LocalModel[]>("list_local_models", { endpoint });
          if (!vivo) return;
          setEstado(
            modelos.length === 0
              ? { texto: t("Ollama sin modelos"), ok: false, etiqueta: t("Vacío") }
              : {
                  texto: t("{n} modelos en este PC", { n: modelos.length }),
                  ok: true,
                  etiqueta: t("Activo"),
                },
          );
        } else {
          const tiene = await invoke<boolean>("has_api_key", { provider: providerId });
          if (!vivo) return;
          setEstado(
            tiene
              ? {
                  texto: t("Clave en el llavero"),
                  ok: true,
                  etiqueta: t("Configurado"),
                }
              : {
                  texto: t("Falta la clave en el llavero"),
                  ok: false,
                  etiqueta: t("Sin configurar"),
                },
          );
        }
      } catch {
        if (!vivo) return;
        // El fallo es de Ollama solo cuando se le pregunta a Ollama; atribuirlo
        // a un proveedor de API mandaba a buscar un servicio que no estaba.
        setEstado(
          providerId === "local"
            ? { texto: t("Ollama no responde"), ok: false, etiqueta: t("Fuera de línea") }
            : { texto: t("Sin comprobar"), ok: false, etiqueta: t("Sin configurar") },
        );
      }
    };
    void mirar();
    return () => {
      vivo = false;
    };
  }, [providerId, endpoint]);

  if (!estado) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-zinc-500">
      <Insignia tipo={estado.ok ? "ok" : "aviso"} punto>
        {estado.etiqueta}
      </Insignia>
      {estado.texto}
    </span>
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
  const [models, setModels] = useState<LocalModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setNotice(null);
    try {
      const list = await invoke<LocalModel[]>("list_local_models", {
        endpoint: draft.localEndpoint,
      });
      setModels(list);
      if (list.length === 0) setNotice(t("Ollama responde pero no tiene modelos descargados."));
    } catch (e) {
      setModels([]);
      setNotice(t("No se pudo listar modelos: {e}", { e: String(e) }));
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
      <span className="text-xs text-zinc-500">{t("Modelo local")}</span>
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
            <option key={m.name} value={m.name} />
          ))}
        </datalist>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          title={t("Recargar modelos desde Ollama")}
          className="px-3 py-2 rounded-lg border border-base-border text-zinc-400 hover:text-layer hover:border-accent/50 disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>
      {models.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {models.map((m) => {
            const nivel = nivelModelo(m);
            const activo = draft.localModel === m.name;
            return (
              <button
                key={m.name}
                type="button"
                onClick={() => onChange(m.name)}
                title={nivel ? t(NIVELES[nivel].aviso) : undefined}
                className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] transition-colors ${
                  activo
                    ? "border-accent bg-accent/10 text-accent-soft"
                    : "border-base-border text-zinc-400 hover:text-layer hover:border-accent/40"
                }`}
              >
                {m.name}
                {nivel && <span className="text-[10px] opacity-70">{t(NIVELES[nivel].corto)}</span>}
              </button>
            );
          })}
        </div>
      )}
      {models.length === 0 && (
        <p className="text-[11px] leading-snug text-zinc-600">
          {t("Nada en el disco todavía. Se bajan con Ollama —«ollama pull qwen3:1.7b», por ejemplo— y luego «Recargar lista».")}
        </p>
      )}
      {notice && <p className="text-[11px] text-zinc-500 pt-0.5">{notice}</p>}
    </label>
  );
}

/** Campo de modelo: cuatro proveedores repetían la misma receta con clases
 *  distintas (`field`, `field + " mt-2"`, con y sin ayuda debajo).
 *
 *  Con `proveedor` el campo deja de ser una adivinanza: pregunta al propio
 *  proveedor qué modelos deja usar la clave guardada y los pone como fichas. */
function ModeloTexto({
  etiqueta,
  valor,
  onChange,
  placeholder,
  ayuda,
  proveedor,
  endpoint,
}: {
  etiqueta: string;
  valor: string;
  onChange: (valor: string) => void;
  placeholder?: string;
  ayuda?: string;
  proveedor?: string;
  /** La base editable del proveedor (Hugging Face); los demás la llevan fija. */
  endpoint?: string;
}) {
  const [modelos, setModelos] = useState<string[] | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState("");

  const pedir = async () => {
    if (!proveedor) return;
    setCargando(true);
    setError(null);
    try {
      const lista = await invoke<string[]>("list_provider_models", {
        provider: proveedor,
        endpoint: endpoint ?? "",
      });
      setModelos(lista);
    } catch (e) {
      setModelos(null);
      setError(String(e));
    } finally {
      setCargando(false);
    }
  };

  const visibles = modelos
    ? modelos
        .filter((m) => m.toLowerCase().includes(filtro.trim().toLowerCase()))
        .slice(0, 80)
    : [];

  return (
    <div className="space-y-1">
      <span className="block text-xs text-zinc-500">{etiqueta}</span>
      <input
        value={valor}
        aria-label={etiqueta}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={CAMPO}
      />
      {ayuda && <span className="block text-[11px] text-zinc-600">{ayuda}</span>}
      {proveedor && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void pedir()}
            disabled={cargando}
            className="shrink-0 rounded-md border border-base-border px-2 py-0.5 text-[11px] text-zinc-400 transition-colors hover:border-accent/50 hover:text-zinc-200 disabled:opacity-50"
          >
            {cargando ? t("Consultando…") : t("Ver los de mi clave")}
          </button>
          {error && (
            <span className="min-w-0 truncate text-[11px] text-red-400" title={error}>
              {error}
            </span>
          )}
          {!error && modelos && modelos.length > 0 && (
            <span className="shrink-0 text-[11px] text-zinc-600">
              {t("{n} disponibles", { n: modelos.length })}
            </span>
          )}
          {!error && modelos && modelos.length === 0 && (
            <span className="shrink-0 text-[11px] text-zinc-600">
              {t("No devuelve ninguno.")}
            </span>
          )}
        </div>
      )}
      {modelos !== null && modelos.length > 0 && (
        <div className="space-y-1 pt-0.5">
          {modelos.length > 12 && (
            <input
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              placeholder={t("filtrar…")}
              aria-label={t("Filtrar modelos")}
              className={`${CAMPO} py-1 text-[11px]`}
            />
          )}
          <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto">
            {visibles.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onChange(m)}
                className={`shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[11px] transition-colors ${
                  m === valor
                    ? "border-accent/60 bg-accent/10 text-zinc-100"
                    : "border-base-border text-zinc-400 hover:border-accent/40 hover:text-zinc-200"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ApiKeyField({ provider }: { provider: string }) {
  const [key, setKey] = useState("");
  const [configured, setConfigured] = useState(false);
  const [saved, setSaved] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);

  const refresh = () =>
    invoke<boolean>("has_api_key", { provider }).then(setConfigured);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  const save = async () => {
    if (!key.trim()) return;
    setFallo(null);
    try {
      await invoke("set_api_key", { provider, key: key.trim() });
      setKey("");
      setSaved(true);
      await refresh();
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      // El llavero de Windows puede estar bloqueado o la sesión sin desbloquear.
      // Sin decirlo aquí, el botón se quedaba en «Guardar» y la key no estaba.
      setFallo(String(e));
    }
  };

  const remove = async () => {
    setFallo(null);
    try {
      await invoke("delete_api_key", { provider });
      await refresh();
    } catch (e) {
      setFallo(String(e));
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-xs text-zinc-400">
        <KeyRound className="w-3.5 h-3.5" />
        {t("API key de {p}", { p: provider })}
        {configured && (
          <span className="ml-1 inline-flex items-center gap-1 text-emerald-400">
            <CheckCircle2 className="w-3 h-3" /> {t("guardada en el llavero")}
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
          className={`${CAMPO} flex-1`}
        />
        <button
          onClick={() => void save()}
          disabled={!key.trim()}
          className="px-3 py-2 rounded-lg bg-accent text-white text-sm disabled:opacity-40 hover:bg-accent-dim transition-colors"
        >
          {saved ? t("Guardada") : t("Guardar")}
        </button>
        {configured && (
          <button
            onClick={() => void remove()}
            title={t("Borrar key")}
            className="px-2.5 py-2 rounded-lg border border-base-border text-zinc-400 hover:text-red-400 hover:border-red-500/40 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
      {fallo && <p className="text-xs leading-snug text-red-400">{fallo}</p>}
    </div>
  );
}

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

const MOD = navigator.platform.toLowerCase().includes("mac") ? "⌘" : "Ctrl";

const SHORTCUTS: Array<{ keys: string[]; desc: string }> = [
  { keys: [MOD, "Enter"], desc: "Enviar mensaje" },
  { keys: ["Shift", "Enter"], desc: "Salto de línea en el campo" },
  { keys: [MOD, "N"], desc: "Nueva conversación" },
  { keys: [MOD, ","], desc: "Abrir Ajustes" },
  { keys: [MOD, "F"], desc: "Buscar en la conversación" },
  { keys: [MOD, "K"], desc: "Buscar chats, sesiones, proyectos o modelos" },
  { keys: [MOD, "Shift", "P"], desc: "Abrir la lista de proyectos" },
  { keys: [MOD, "B"], desc: "Plegar o desplegar la barra lateral" },
  { keys: [MOD, "."], desc: "Modo foco en el modo trabajo (solo el chat)" },
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
  const [aviso, setAviso] = useState<string | null>(null);
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
      filters: [{ name: t("Copia de Hatboo"), extensions: ["json"] }],
    });
    if (!path) return;
    setDataBusy(true);
    setDataMsg(null);
    setDataErr(null);
    try {
      const r = await invoke<ExportSummary>("export_all_data", { path });
      setDataMsg(
        t(
          "Copia creada con {c} conversación(es), {m} mensaje(s) y {i} imagen(es) · {kb} KB",
          {
            c: r.conversations,
            m: r.messages,
            i: r.images,
            kb: Math.max(1, Math.round(r.bytes / 1024)),
          },
        ),
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
      filters: [{ name: t("Copia de Hatboo"), extensions: ["json"] }],
    });
    if (typeof path !== "string") return;
    setDataBusy(true);
    setDataMsg(null);
    setDataErr(null);
    try {
      const r = await invoke<ImportReport>("import_all_data", { path });
      setDataMsg(
        t("Importación terminada: {c} conversación(es) y {m} mensaje(s) nuevos", {
          c: r.conversationsAdded,
          m: r.messagesAdded,
        }) +
          (r.skillsAdded > 0
            ? t(", {n} plantilla(s)", { n: r.skillsAdded })
            : "") +
          (r.skippedExisting > 0
            ? t(", {n} elemento(s) ya estaban", { n: r.skippedExisting })
            : "") +
          (r.imagesRestored > 0
            ? t(", {n} imagen(es) restaurada(s)", { n: r.imagesRestored })
            : "") +
          (r.imagesMissing > 0
            ? t(", {n} imagen(es) no estaban en la copia", { n: r.imagesMissing })
            : ""),
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
      setDataMsg(t("Hatboo restablecida: sin conversaciones, sin proyectos, sin claves guardadas."));
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
    if (part.motion) applyMotion(part.motion);
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
            <>
              <SectionTitle
                title={t("API y modelos")}
                subtitle={t("Proveedor de IA, credenciales y modelos.")}
              />
              <SelectorProveedor draft={draft} setDraft={setDraft} />

              {activeProviderMeta?.needsKey && (
                <Bloque
                  titulo={t("Credenciales")}
                  descripcion={t(
                    "Las keys se guardan en el llavero del sistema operativo, nunca en la base de datos.",
                  )}
                >
                  <ApiKeyField provider={draft.activeProvider} />
                </Bloque>
              )}

              <Bloque
                titulo={t("Modelos")}
                descripcion={t(
                  "El que responde ahora y los que quedan apuntados en los demás proveedores.",
                )}
              >
                <div className="space-y-3">
                  {activeProviderMeta?.id === "local" && (
                    <LocalModelField
                      draft={draft}
                      field={field}
                      onChange={(model) => setDraft({ ...draft, localModel: model })}
                    />
                  )}
                  {activeProviderMeta && activeProviderMeta.id !== "local" && (
                    <>
                      <ModeloTexto
                        etiqueta={t("Modelo de {p}", { p: activeProviderMeta.corto })}
                        valor={draft[activeProviderMeta.modelo]}
                        placeholder={activeProviderMeta.ejemplo}
                        proveedor={activeProviderMeta.id}
                        endpoint={
                          activeProviderMeta.endpoint
                            ? draft[activeProviderMeta.endpoint]
                            : undefined
                        }
                        ayuda={
                          activeProviderMeta.ayudaModelo
                            ? t(activeProviderMeta.ayudaModelo)
                            : undefined
                        }
                        onChange={(v) =>
                          setDraft({
                            ...draft,
                            [activeProviderMeta.modelo]: v,
                          } as SettingsType)
                        }
                      />
                      {/* Solo Hugging Face tiene base editable: los demás llevan
                          la suya fija en el backend. */}
                      {activeProviderMeta.endpoint === "hfEndpoint" && (
                        <ModeloTexto
                          etiqueta={t("Endpoint compatible con OpenAI")}
                          valor={draft.hfEndpoint}
                          onChange={(v) => setDraft({ ...draft, hfEndpoint: v })}
                          ayuda={t(
                            "Por defecto el router de Hugging Face; vale también para cualquier servidor propio que hable /v1/chat/completions.",
                          )}
                        />
                      )}
                    </>
                  )}

                  {/* Uno solo, no seis: cambiar de proveedor no obliga a volver
                      a escribir su modelo, pero tampoco hace falta verlo siempre. */}
                  <details className="rounded-lg border border-base-border bg-base px-3 py-2">
                    <summary className="cursor-pointer text-xs text-zinc-500">
                      {t("Modelos de los otros proveedores")}
                    </summary>
                    <div className="mt-3 space-y-3">
                      {PROVEEDORES.filter((p) => p.id !== draft.activeProvider).map((p) =>
                        p.id === "local" ? (
                          <div key={p.id} className="space-y-1">
                            <span className="text-xs text-zinc-500">{t("Modelo local")}</span>
                            <LocalModelField
                              draft={draft}
                              field={field}
                              onChange={(model) => setDraft({ ...draft, localModel: model })}
                            />
                          </div>
                        ) : (
                          <ModeloTexto
                            key={p.id}
                            etiqueta={t("Modelo de {p}", { p: p.corto })}
                            valor={draft[p.modelo]}
                            placeholder={p.ejemplo}
                            proveedor={p.id}
                            endpoint={p.endpoint ? draft[p.endpoint] : undefined}
                            onChange={(v) =>
                              setDraft({ ...draft, [p.modelo]: v } as SettingsType)
                            }
                          />
                        ),
                      )}
                    </div>
                  </details>
                </div>
              </Bloque>

              <Bloque titulo={t("Razonamiento")}>
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm text-zinc-300">{t("Pensamiento extendido")}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
                      {t(
                        "Pide al modelo que razone antes de responder, en el chat y también en el modo trabajo. Solo funciona con modelos que lo soportan. En el agente cuesta más caro: piensa en cada uno de sus vueltas, no una sola vez.",
                      )}
                    </p>
                  </div>
                  <div
                    role="radiogroup"
                    aria-label={t("Razonamiento")}
                    className="flex shrink-0 flex-wrap justify-end gap-0.5 rounded-lg border border-base-border bg-base-raised p-0.5"
                  >
                    {REASONING_LEVELS.map((l) => {
                      const elegido = esfuerzoVisible(draft.reasoningEffort) === l.id;
                      return (
                        <button
                          key={l.id}
                          role="radio"
                          aria-checked={elegido}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              reasoningEffort: l.id,
                            })
                          }
                          className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                            elegido
                              ? "bg-accent/20 text-accent-soft"
                              : "text-zinc-500 hover:text-zinc-300"
                          }`}
                        >
                          {t(l.label)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </Bloque>

              <Bloque
                titulo={t("Motor de imágenes")}
                descripcion={t(
                  "Lo que usa el botón «Generar imagen» del chat. No tiene nada que ver con el proveedor del texto: la clave se pide a la que ya tengas guardada arriba, y lo que cobra cada uno va aparte.",
                )}
              >
                <div className="space-y-3">
                  <div className="block space-y-1">
                    <span className="text-xs text-zinc-500">{t("Motor")}</span>
                    <Select
                      valor={draft.imageProvider || "off"}
                      alCambiar={(v) => {
                        const m = motorImagen(v);
                        // Al mudar de motor se van el modelo y el tamaño: la
                        // escuadra de Gemini no existe en OpenAI y al revés.
                        setDraft({
                          ...draft,
                          imageProvider: m ? v : "",
                          imageModel: m?.modeloPorDefecto ?? "",
                          imageSize: "1024x1024",
                        });
                      }}
                      size="md"
                      ariaLabel={t("Motor de imágenes")}
                      opciones={[
                        {
                          valor: "off",
                          etiqueta: t("Apagado"),
                          detalle: t("El botón del chat avisa y no gasta nada"),
                        },
                        ...MOTORES_IMAGEN.map((m) => ({
                          valor: m.id,
                          etiqueta: m.corto,
                          detalle: t(m.precio),
                        })),
                      ]}
                    />
                  </div>
                  {motorImagen(draft.imageProvider) && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="block space-y-1">
                        <span className="text-xs text-zinc-500">{t("Modelo")}</span>
                        <Select
                          valor={draft.imageModel}
                          alCambiar={(v) =>
                            setDraft({
                              ...draft,
                              imageModel: v,
                              imageSize: "1024x1024",
                            })
                          }
                          size="md"
                          ariaLabel={t("Modelo de imagen")}
                          opciones={(
                            motorImagen(draft.imageProvider)?.modelos ?? []
                          ).map((m) => ({ valor: m, etiqueta: m }))}
                        />
                      </div>
                      <div className="block space-y-1">
                        <span className="text-xs text-zinc-500">{t("Tamaño")}</span>
                        <Select
                          valor={
                            tamanosImagen(draft.imageProvider, draft.imageModel).includes(
                              draft.imageSize,
                            )
                              ? draft.imageSize
                              : "1024x1024"
                          }
                          alCambiar={(v) => setDraft({ ...draft, imageSize: v })}
                          size="md"
                          ariaLabel={t("Tamaño de la imagen")}
                          opciones={tamanosImagen(
                            draft.imageProvider,
                            draft.imageModel,
                          ).map((s) => ({
                            valor: s,
                            etiqueta: s,
                            detalle:
                              s === "1024x1024"
                                ? t("cuadrada")
                                : /x1024$|x720$/.test(s)
                                  ? t("apaisada")
                                  : t("vertical"),
                          }))}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </Bloque>

              <Bloque
                titulo={t("Motor de voz")}
                descripcion={t(
                  "El botón del altavoz de cada respuesta. Apagado usa las voces que trae Windows: gratis y sin internet. Encenderlo pide la voz a la nube, y ahí se cobra por caracteres leídos.",
                )}
              >
                <div className="space-y-3">
                  <div className="block space-y-1">
                    <span className="text-xs text-zinc-500">{t("Motor")}</span>
                    <Select
                      valor={draft.audioProvider || "off"}
                      alCambiar={(v) => {
                        const m = motorVoz(v);
                        setDraft({
                          ...draft,
                          audioProvider: m ? v : "",
                          audioModel: m?.modeloPorDefecto ?? "",
                          audioVoice: m?.voces[0] ?? "",
                        });
                      }}
                      size="md"
                      ariaLabel={t("Motor de voz")}
                      opciones={[
                        {
                          valor: "off",
                          etiqueta: t("Apagado (voz del sistema)"),
                          detalle: t("Gratis, sin red"),
                        },
                        ...MOTORES_VOZ.map((m) => ({
                          valor: m.id,
                          etiqueta: m.corto,
                          detalle: t(m.precio),
                        })),
                      ]}
                    />
                  </div>
                  {motorVoz(draft.audioProvider) && (
                    <>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="block space-y-1">
                          <span className="text-xs text-zinc-500">{t("Modelo de voz")}</span>
                          <Select
                            valor={draft.audioModel}
                            alCambiar={(v) => setDraft({ ...draft, audioModel: v })}
                            size="md"
                            ariaLabel={t("Modelo de voz")}
                            opciones={(motorVoz(draft.audioProvider)?.modelos ?? []).map(
                              (m) => ({ valor: m, etiqueta: m }),
                            )}
                          />
                        </div>
                        <div className="block space-y-1">
                          <span className="text-xs text-zinc-500">{t("Voz")}</span>
                          <Select
                            valor={draft.audioVoice}
                            alCambiar={(v) => setDraft({ ...draft, audioVoice: v })}
                            size="md"
                            cap={320}
                            ariaLabel={t("Voz del lector")}
                            opciones={(motorVoz(draft.audioProvider)?.voces ?? []).map(
                              (v) => ({ valor: v, etiqueta: v }),
                            )}
                          />
                        </div>
                      </div>
                      <p className="text-xs leading-relaxed text-zinc-500">
                        {t(
                          "Una respuesta de 1.500 caracteres sale por unos 0,02 $. Lo que ya se escuchó queda guardado en el disco y no vuelve a cobrarse.",
                        )}
                      </p>
                    </>
                  )}
                </div>
              </Bloque>

              <Bloque
                titulo={t("Servidor local")}
                descripcion={t("Dónde escucha Ollama o llama.cpp en este equipo.")}
              >
                <ModeloTexto
                  etiqueta={t("Endpoint (compatible con Ollama / llama.cpp)")}
                  valor={draft.localEndpoint}
                  placeholder="http://localhost:11434"
                  onChange={(v) => setDraft({ ...draft, localEndpoint: v })}
                />
              </Bloque>
            </>
          )}

          {cat === "general" && (
            <>
              <SectionTitle
                title="General"
                subtitle={t("Avisos mientras trabajas en otra ventana, y qué sale de la máquina.")}
              />
              <section className="space-y-3">
                <label className="flex items-start gap-3 rounded-xl border border-base-border bg-base-card px-3 py-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.notifyOnFinish}
                    onChange={(e) =>
                      setDraft({ ...draft, notifyOnFinish: e.target.checked })
                    }
                    className="mt-0.5 accent-violet-500"
                  />
                  <span className="space-y-0.5">
                    <span className="block text-sm text-zinc-200">
                      {t("Avisar cuando una sesión de trabajo pida algo")}
                    </span>
                    <span className="block text-xs text-zinc-500">
                      {t("Notificación del sistema al terminar la tarea, al fallar o cuando hace falta aprobar una acción. Solo se manda si la ventana de Hatboo no está en primer plano: si la tienes delante, ya lo estás viendo.")}
                    </span>
                  </span>
                </label>
                <div className="flex items-center gap-2 px-1">
                  <button
                    onClick={() => {
                      setAviso(null);
                      void invoke("test_notification").then(
                        () => setAviso(t("Aviso enviado. Mira la esquina de Windows.")),
                        (e) => setAviso(String(e))
                      );
                    }}
                    className="px-2.5 py-1 rounded-lg border border-base-border text-xs text-zinc-300 hover:border-accent/50 hover:text-zinc-100 transition-colors"
                  >
                    {t("Probar aviso")}
                  </button>
                  <p className="text-xs text-zinc-500">
                    {aviso ??
                      t("Este no comprueba si la ventana está delante: lo lanza igual.")}
                  </p>
                </div>
                <label className="flex items-start gap-3 rounded-xl border border-base-border bg-base-card px-3 py-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.redactSecrets}
                    onChange={(e) =>
                      setDraft({ ...draft, redactSecrets: e.target.checked })
                    }
                    className="mt-0.5 accent-violet-500"
                  />
                  <span className="space-y-0.5">
                    <span className="block text-sm text-zinc-200">
                      {t("Tapar claves antes de enviarlas a un proveedor en la nube")}
                    </span>
                    <span className="block text-xs text-zinc-500">
                      {t(
                        "Cuando el agente lee un archivo del proyecto, las formas habituales de secreto (API keys, tokens de GitHub/Slack/Stripe/AWS, JWT, contraseñas en `clave = valor`, bloques de clave privada) se sustituyen por",
                      )}
                      <code className="mx-1 font-mono text-accent-soft">[REDACTED]</code>
                      {t(
                        "antes de salir hacia un proveedor en la nube, y también antes de guardarse en el historial. Con un modelo local no se toca nada. Es un filtro de patrones, no un detector perfecto.",
                      )}
                    </span>
                  </span>
                </label>
              </section>
            </>
          )}

          {cat === "agent" && (
            <>
              <SectionTitle
                title={t("Agente (modo trabajo)")}
                subtitle={t("Qué puede hacer el agente en la vista de Trabajo.")}
              />
              <section className="space-y-3">
                <div className="rounded-xl border border-base-border bg-base-card px-3 py-3 space-y-2">
                  <p className="text-xs font-medium text-zinc-300">
                    {t("Niveles de aprobación")}
                  </p>
                  <ul className="space-y-1">
                    {APPROVAL_LEVELS.map((l) => (
                      <li key={l.id} className="flex flex-wrap gap-x-2 text-[11px]">
                        <span className="font-medium text-zinc-200">{t(l.label)}</span>
                        <span className="text-zinc-500">{t(l.help)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-[11px] leading-snug text-zinc-500">
                    {t("Cada proyecto guarda su propio nivel; sin proyecto abierto, esto es el valor por defecto. Con «Acceso total» Hatboo no pide aprobación, pero las tools siguen encerradas en la carpeta del proyecto: el sandbox de rutas no se relaja nunca.")}
                  </p>
                </div>
                <label className="flex items-start gap-3 rounded-xl border border-base-border bg-base-card px-3 py-3 cursor-pointer">
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
                      {t("Habilitar")}{" "}
                      <code className="font-mono text-accent-soft">
                        run_command
                      </code>
                    </span>
                    <span className="block text-xs text-zinc-500">
                      {t("Permite que el agente ejecute comandos de shell dentro del proyecto. Desactivado por defecto. Si está habilitado, si cada comando pide aprobación lo decide el nivel de aprobación del proyecto (vista Trabajo).")}
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-3 rounded-xl border border-base-border bg-base-card px-3 py-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!draft.reviewPlan}
                    onChange={(e) =>
                      setDraft({ ...draft, reviewPlan: e.target.checked })
                    }
                    className="mt-0.5 accent-violet-500"
                  />
                  <span className="space-y-0.5">
                    <span className="block text-sm text-zinc-200">
                      {t("Revisar el plan antes de ejecutarlo")}
                    </span>
                    <span className="block text-xs text-zinc-500">
                      {t("Cuando el agente propone los pasos se para y te los enseña: puedes reescribirlos, quitar alguno o añadir pasos, y con lo que salga de ahí se queda el plan. Sin esto ejecuta tal cual.")}
                    </span>
                  </span>
                </label>
                <p className="text-[11px] text-zinc-600">
                  {t("El nivel de aprobación se ajusta por proyecto en la vista de Trabajo.")}
                </p>
              </section>
            </>
          )}

          {cat === "appearance" && (
            <>
              <SectionTitle
                title="Apariencia"
                subtitle={t("Cómo se ve Hatboo. Se aplica al elegirlo, sin guardar.")}
              />
              <section className="space-y-3">
                <div className="rounded-xl border border-base-border bg-base-card px-3 py-3">
                  <p className="text-sm text-zinc-200">{t("Tema")}</p>
                  <p className="mt-0.5 mb-2.5 text-xs text-zinc-500">
                    {t("«Sistema» sigue el claro/oscuro de Windows mientras la app esté abierta. Las paletas de debajo son fijas y se aplican al pulsarlas.")}
                  </p>
                  <ThemePicker
                    value={(draft.theme || "dark") as ThemeChoice}
                    onChange={(id) => void patchAppearance({ theme: id })}
                  />
                </div>

                <div className="rounded-xl border border-base-border bg-base-card px-3 py-3">
                  <p className="text-sm text-zinc-200">{t("Idioma")}</p>
                  <p className="mt-0.5 mb-2.5 text-xs text-zinc-500">
                    {t(
                      "«Sistema» sigue el idioma de Windows. No cambia lo que escribe el modelo: eso se le pide en cada charla.",
                    )}
                  </p>
                  <div className="flex gap-1">
                    {LANGUAGE_OPTIONS.map((o) => (
                      <button
                        key={o.id}
                        onClick={() =>
                          void patchAppearance({ uiLanguage: o.id as LanguageChoice })
                        }
                        className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                          (draft.uiLanguage || "system") === o.id
                            ? "bg-accent/20 text-accent-soft"
                            : "text-zinc-500 hover:text-zinc-300"
                        }`}
                      >
                        {o.id === "system" ? t("Sistema") : o.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-base-border bg-base-card px-3 py-3">
                  <p className="text-sm text-zinc-200">{t("Movimiento")}</p>
                  <p className="mt-0.5 mb-2.5 text-xs text-zinc-500">
                    {t(
                      "«Reducido» quita animaciones y transiciones solo dentro de Hatboo, sin tocar el ajuste de Windows.",
                    )}
                  </p>
                  <div className="flex gap-1">
                    {MOTION_OPTIONS.map((m) => (
                      <button
                        key={m.id}
                        onClick={() =>
                          void patchAppearance({ motion: m.id as MotionChoice })
                        }
                        className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                          (draft.motion || "system") === m.id
                            ? "bg-accent/20 text-accent-soft"
                            : "text-zinc-500 hover:text-zinc-300"
                        }`}
                      >
                        {t(m.label)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-base-border bg-base-card px-3 py-3">
                  <p className="text-sm text-zinc-200">{t("Tamaño del texto del chat")}</p>
                  <p className="mt-0.5 mb-2.5 text-xs text-zinc-500">
                    {t("Afecta a las respuestas y a tus mensajes; el código va dos puntos por debajo.")}
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
                        {t(f.label)}
                      </button>
                    ))}
                  </div>
                  <p className="mt-3 mb-1.5 text-xs text-zinc-500">{t("Fuente")}</p>
                  <div className="flex gap-1">
                    {CHAT_FONTS.map((f) => (
                      <button
                        key={f.id}
                        onClick={() =>
                          void patchAppearance({ chatFontFamily: f.id })
                        }
                        className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                          (draft.chatFontFamily || "sans") === f.id
                            ? "bg-accent/20 text-accent-soft"
                            : "text-zinc-500 hover:text-zinc-300"
                        }`}
                        style={{ fontFamily: CHAT_FONT_STACKS[f.id] }}
                      >
                        {t(f.label)}
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
                      fontFamily:
                        CHAT_FONT_STACKS[draft.chatFontFamily || "sans"],
                    }}
                  >
                    {t("Ejemplo: así se vería una respuesta de Hatboo.")}
                  </p>
                </div>

                <div className="rounded-xl border border-base-border bg-base-card px-3 py-3">
                  <p className="text-sm text-zinc-200">{t("Tus mensajes")}</p>
                  <p className="mt-0.5 mb-2.5 text-xs text-zinc-500">
                    {t("Cada tarjeta enseña cómo queda; se aplica al momento.")}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {BUBBLE_STYLES.map((b) => (
                      <button
                        key={b.id}
                        onClick={() => void patchAppearance({ bubbleStyle: b.id })}
                        title={t(b.help)}
                        className={`min-w-[150px] flex-1 rounded-lg border p-2.5 text-left transition-colors ${
                          (draft.bubbleStyle || "solida") === b.id
                            ? "border-accent/60 bg-accent/10"
                            : "border-base-border hover:border-zinc-600"
                        }`}
                      >
                        <span
                          className={`inline-block max-w-full truncate px-3 py-1.5 text-xs ${
                            b.id === "solida"
                              ? "rounded-3xl bg-accent-dim text-white"
                              : "rounded-xl border border-accent/40 bg-accent/20 text-layer"
                          }`}
                        >
                          {t("Hola, Hatboo")}
                        </span>
                        <span className="mt-2 block text-[11px] text-zinc-500">
                          {t(b.label)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
                {saveErr && <p className="text-xs text-red-400">{saveErr}</p>}
              </section>
            </>
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
            <>
              <SectionTitle title="Perfil" subtitle={t("Cómo te trata Hatboo.")} />
              <SaludoPrevio draft={draft} />

              <Bloque
                titulo={t("Cómo te llama")}
                descripcion={t(
                  "Se añade al prompt del chat y del agente para que te trate por ese nombre. Solo local.",
                )}
              >
                <label className="block space-y-1">
                  <span className="text-xs text-zinc-500">
                    {t("¿Cómo debería llamarte Hatboo?")}
                  </span>
                  <input
                    value={draft.assistantName ?? ""}
                    maxLength={40}
                    onChange={(e) =>
                      setDraft({ ...draft, assistantName: e.target.value })
                    }
                    className={field}
                    placeholder={t("p. ej. Azrael (vacío = sin nombre)")}
                  />
                </label>

                {/* La ambigüedad que hay que cortar: un modelo chico leía el nombre
                    y se presentaba con él. Que quede escrito en la propia pantalla. */}
                <p className="mt-2 text-[11px] text-zinc-500">
                  {t("Hatboo te llamará «{n}». Él sigue llamándose Hatboo.", {
                    n: draft.assistantName?.trim() || t("como quieras"),
                  })}
                </p>
              </Bloque>

              <Bloque
                titulo={t("Cómo te habla")}
                descripcion={t("Trato e idioma de las respuestas.")}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="block space-y-1">
                    <span className="text-xs text-zinc-500">
                      {t("¿De qué forma te habla?")}
                    </span>
                    <Select
                      valor={draft.userAddress || "tú"}
                      alCambiar={(v) => setDraft({ ...draft, userAddress: v })}
                      size="md"
                      ariaLabel={t("¿De qué forma te habla?")}
                      opciones={[
                        {
                          valor: "tú",
                          etiqueta: t("De tú"),
                          detalle: t("Cercano: «puedes pedirme…»"),
                        },
                        {
                          valor: "usted",
                          etiqueta: t("De usted"),
                          detalle: t("Formal: «puede pedirme…»"),
                        },
                      ]}
                    />
                  </div>
                  <div className="block space-y-1">
                    <span className="text-xs text-zinc-500">
                      {t("Idioma de las respuestas")}
                    </span>
                    <Select
                      valor={draft.answerLanguage || "auto"}
                      alCambiar={(v) => setDraft({ ...draft, answerLanguage: v })}
                      size="md"
                      ariaLabel={t("Idioma de las respuestas")}
                      opciones={[
                        {
                          valor: "auto",
                          etiqueta: t("El mismo en que le escribas"),
                          detalle: t("Se decide mensaje a mensaje"),
                        },
                        {
                          valor: "es",
                          etiqueta: t("Siempre español"),
                          detalle: t("Aunque le escribas en otro idioma"),
                        },
                        {
                          valor: "en",
                          etiqueta: t("Siempre inglés"),
                          detalle: t("Aunque le escribas en otro idioma"),
                        },
                      ]}
                    />
                  </div>
                </div>
              </Bloque>

              <Bloque titulo={t("Sobre ti")}>
                <label className="block space-y-1">
                  <span className="text-xs text-zinc-500">
                    {t("Una línea sobre ti (opcional)")}
                  </span>
                  <textarea
                    rows={2}
                    maxLength={200}
                    value={draft.userNotes ?? ""}
                    onChange={(e) => setDraft({ ...draft, userNotes: e.target.value })}
                    className={`${field} resize-none`}
                    placeholder={t("p. ej. Estudio programación; prefiero ejemplos cortos")}
                  />
                </label>
                <div className="mt-1 flex items-start justify-between gap-3">
                  <span className="min-w-0 text-[11px] text-zinc-600">
                    {t(
                      "200 caracteres como mucho. Va solo al chat: un modelo pequeño mezcla una biografía larga con las reglas del agente.",
                    )}
                  </span>
                  {/* Lo que falta se ve mientras se escribe, no al pasarse. */}
                  <span className="shrink-0 text-[11px] tabular-nums text-zinc-500">
                    {(draft.userNotes ?? "").length}/200
                  </span>
                </div>
              </Bloque>

              <Bloque
                titulo={t("Avatar")}
                descripcion={t(
                  "Sin subir un archivo: color de una paleta fija y qué se pinta encima. Se ve en la tarjeta de perfil del lateral.",
                )}
              >
                <div className="flex items-center gap-3">
                  <Avatar
                    style={(draft.avatarStyle || "mascota") as AvatarStyle}
                    colorId={draft.avatarColor || "violeta"}
                    emoji={draft.avatarEmoji || "🎩"}
                    name={draft.assistantName?.trim() || "Hatboo"}
                    size={44}
                  />
                  <div
                    role="radiogroup"
                    aria-label={t("Estilo del avatar")}
                    className="flex gap-1"
                  >
                    {AVATAR_STYLES.map((a) => (
                      <button
                        key={a.id}
                        role="radio"
                        aria-checked={(draft.avatarStyle || "mascota") === a.id}
                        onClick={() => setDraft({ ...draft, avatarStyle: a.id })}
                        className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                          (draft.avatarStyle || "mascota") === a.id
                            ? "bg-accent/20 text-accent-soft"
                            : "text-zinc-500 hover:text-zinc-300"
                        }`}
                      >
                        {t(a.label)}
                      </button>
                    ))}
                  </div>
                </div>

                <div
                  role="radiogroup"
                  aria-label={t("Color del avatar")}
                  className="mt-3 flex gap-1.5"
                >
                  {AVATAR_COLORS.map((c) => (
                    <button
                      key={c.id}
                      role="radio"
                      aria-checked={(draft.avatarColor || "violeta") === c.id}
                      onClick={() => setDraft({ ...draft, avatarColor: c.id })}
                      title={t(c.label)}
                      aria-label={t(c.label)}
                      className={`w-6 h-6 rounded-full transition-shadow ${
                        (draft.avatarColor || "violeta") === c.id
                          ? "ring-2 ring-offset-2 ring-accent ring-offset-base"
                          : "hover:scale-110"
                      }`}
                      style={{ background: c.bg }}
                    />
                  ))}
                </div>

                {draft.avatarStyle === "emoji" && (
                  <label className="block space-y-1 mt-3">
                    <span className="text-xs text-zinc-500">{t("Emoji")}</span>
                    <input
                      value={draft.avatarEmoji ?? "🎩"}
                      maxLength={4}
                      onChange={(e) =>
                        setDraft({ ...draft, avatarEmoji: e.target.value })
                      }
                      className={field + " w-24 text-center text-lg"}
                    />
                  </label>
                )}
              </Bloque>
            </>
          )}

          {/* Guarda sola: cada nota se escribe en SQLite al añadirla, no hay un
              borrador global que perder al cambiar de pestaña. */}
          {cat === "memoria" && <MemoriaView />}

          {cat === "shortcuts" && (
            <>
              <SectionTitle
                title="Atajos"
                subtitle={t("Atajos de teclado disponibles en esta versión.")}
              />
              <section className="space-y-2">
                {SHORTCUTS.map((s) => (
                  <div
                    key={s.desc}
                    className="flex items-center justify-between gap-4 rounded-lg border border-base-border bg-base px-3 py-2.5"
                  >
                    <span className="text-sm text-zinc-300">{t(s.desc)}</span>
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
                  {t("Remapear atajos llegará en una versión futura.")}
                </p>
              </section>
            </>
          )}

          {cat === "system" && (
            <>
              <SectionTitle
                title="Sistema"
                subtitle={t("Tu equipo ahora mismo y dónde guarda Hatboo sus archivos.")}
              />
              <div className="space-y-2">
                <MonitorVivo />
                <p className="text-[11px] text-zinc-600">
                  {t("Se relee solo mientras esta pestaña está abierta.")}
                </p>
              </div>
              {!storage && (
                <p className="text-sm text-zinc-500">
                  {t("No se pudo leer el estado de almacenamiento.")}
                </p>
              )}
              {storage && (
                <div className="space-y-3">
                  <PathRow
                    label={t("Base de datos")}
                    path={storage.dbPath}
                    detail={`${formatBytes(storage.dbSizeBytes)} · SQLite`}
                  />
                  <PathRow
                    label={t("Imágenes adjuntas")}
                    path={storage.attachmentsPath}
                    detail={t("{n} archivo(s) · {tamaño}", {
                      n: storage.attachmentsCount,
                      tamaño: formatBytes(storage.attachmentsSizeBytes),
                    })}
                  />
                  <div className="flex items-center justify-between gap-4 rounded-xl border border-base-border bg-base-card px-3 py-3">
                    <div>
                      <p className="text-sm text-zinc-300">{t("Versión")}</p>
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
                    {t("Volver a calcular")}
                  </button>
                </div>
              )}
            </>
          )}

          {cat === "data" && (
            <>
              <SectionTitle
                title="Datos"
                subtitle={t("Resumen de lo que hay en tu base de datos local.")}
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
                      label={t("Llamadas a herramientas")}
                      value={storage.counts.toolCalls}
                    />
                    <Stat label={t("Imágenes")} value={storage.attachmentsCount} />
                  </div>
                  <p className="text-xs text-zinc-500 leading-relaxed">
                    {t(
                      "Todo esto se calcula leyendo tu propio histórico en este PC; no se envía a ningún servicio. Las claves de API no aparecen aquí porque solo viven en el llavero del sistema. Puedes exportar una conversación concreta desde el botón «+» del chat.",
                    )}
                  </p>
                  </>
                ) : (
                  <p className="text-sm text-zinc-500">
                    {t("No se pudo leer la base de datos ahora mismo; más abajo puedes exportar, importar o restablecer igualmente.")}
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
                      {t("Importar copia")}
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
                      {t("Restablecer de fábrica")}
                    </button>
                  </div>
                  {dataMsg && (
                    <p className="text-xs text-emerald-400/80">{dataMsg}</p>
                  )}
                  {dataErr && <p className="text-xs text-red-400">{dataErr}</p>}
                  {resetOpen && (
                    <div className="space-y-2 rounded-xl border border-red-500/40 bg-red-500/5 p-3">
                      <p className="text-sm font-medium text-zinc-100">
                        {t("Restablecer Hatboo")}
                      </p>
                      <p className="text-[11px] leading-snug text-zinc-400">
                        {t(
                          "Se borran de este PC todas las conversaciones, los proyectos, las tareas, las imágenes adjuntas y los ajustes, y también las claves de API del llavero. No se puede deshacer: exporta una copia antes si quieres conservar algo. Escribe",
                        )}{" "}
                        <span className="font-medium text-zinc-100">
                          {RESET_TOKEN}
                        </span>{" "}
                        {t("para confirmar.")}
                      </p>
                      <input
                        value={resetText}
                        onChange={(e) => setResetText(e.target.value)}
                        placeholder={RESET_TOKEN}
                        className={`${CAMPO} px-2.5 py-1.5 text-xs focus:border-red-500 focus:ring-red-500/25`}
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => {
                            setResetOpen(false);
                            setResetText("");
                          }}
                          className="rounded-lg border border-base-border px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-500 transition-colors"
                        >
                          {t("Cancelar")}
                        </button>
                        <button
                          onClick={() => void doReset()}
                          disabled={resetText.trim() !== RESET_TOKEN || dataBusy}
                          className="rounded-lg bg-red-500 px-3 py-1.5 text-xs text-white hover:bg-red-600 disabled:opacity-40 transition-colors"
                        >
                          {t("Borrar todo")}
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
          )}

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

/** Equipo en vivo, como un panel de sistema: el número suelto de «8 GB» no dice
 *  si AHORA hay sitio; la barra, sí. Solo se sondea con la pestaña abierta. */
function MonitorVivo() {
  const [hw, setHw] = useState<Hardware | null>(null);
  useEffect(() => {
    let vivo = true;
    const lee = () => {
      void invoke<Hardware>("hardware_info").then((h) => {
        if (vivo) setHw(h);
      });
    };
    lee();
    const id = setInterval(lee, 4000);
    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, []);
  if (!hw) return <p className="text-sm text-zinc-500">{t("Leyendo el equipo…")}</p>;
  const usada = hw.ramTotalBytes - hw.ramLibreBytes;
  const discoUsado = hw.discoTotalBytes - hw.discoLibreBytes;
  const pct = (usado: number, total: number) =>
    total > 0 ? Math.min(100, (usado / total) * 100) : 0;
  const tarjetas: Array<{ nombre: string; valor: string; detalle: string; pct: number | null }> = [
    {
      nombre: "CPU",
      valor: `${Math.round(hw.cpuUso)} %`,
      detalle: hw.cpuNombre || "—",
      pct: hw.cpuUso,
    },
    {
      nombre: "RAM",
      valor: `${gigabytes(usada)} / ${gigabytes(hw.ramTotalBytes)}`,
      detalle: t("{libre} libres ahora", { libre: gigabytes(hw.ramLibreBytes) }),
      pct: pct(usada, hw.ramTotalBytes),
    },
    {
      nombre: t("Disco"),
      valor: `${gigabytes(discoUsado)} / ${gigabytes(hw.discoTotalBytes)}`,
      detalle: t("{libre} libres", { libre: gigabytes(hw.discoLibreBytes) }),
      pct: pct(discoUsado, hw.discoTotalBytes),
    },
    {
      nombre: "GPU",
      valor: hw.gpu ?? t("sin GPU"),
      detalle: t("La VRAM no se lee: el presupuesto de Hatboo es la RAM."),
      pct: null,
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {tarjetas.map((c) => (
        <div key={c.nombre} className="rounded-xl border border-base-border bg-base-card px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-wider text-zinc-600">{c.nombre}</p>
          <p className="mt-1 truncate text-sm font-semibold tabular-nums" title={c.valor}>
            {c.valor}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-zinc-500" title={c.detalle}>
            {c.detalle}
          </p>
          {c.pct !== null && (
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-base-border">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-700"
                style={{ width: `${Math.min(100, Math.max(0, c.pct))}%` }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="border-b border-base-border pb-3">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
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
    <div className="flex items-start justify-between gap-4 rounded-xl border border-base-border bg-base-card px-3 py-3">
      <div className="min-w-0">
        <p className="text-sm text-zinc-300">{label}</p>
        <p className="mt-0.5 text-xs font-mono text-zinc-500 break-all">{path}</p>
        <p className="mt-1 text-xs text-zinc-600">{detail}</p>
      </div>
      <button
        onClick={() => void revealItemInDir(path).catch(() => {})}
        title={t("Mostrar en el explorador de archivos")}
        className="shrink-0 flex items-center gap-1.5 rounded-lg border border-base-border px-2.5 py-1.5 text-xs text-zinc-400 hover:text-zinc-100 hover:border-accent/50 transition-colors"
      >
        <FolderOpen className="w-3.5 h-3.5" />
        {t("Mostrar")}
      </button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-base-border bg-base-card px-3 py-3 text-center">
      <div className="text-xl font-semibold text-layer">
        {value.toLocaleString("es")}
      </div>
      <div className="mt-0.5 text-[11px] text-zinc-500">{label}</div>
    </div>
  );
}
