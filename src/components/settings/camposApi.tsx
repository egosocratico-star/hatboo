import { t } from "../../i18n";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import {
  CheckCircle2,
  Copy,
  KeyRound,
  RefreshCw,
  Trash2,
  XCircle,
  Zap,
} from "lucide-react";
import Insignia from "../Insignia";
import Bloque, { BotonSeccion } from "../Bloque";
import { CAMPO } from "../modalUi";
import { NIVELES, nivelModelo, nivelPorNombre, saleDelEquipo } from "../../modelo";
import { PROVEEDORES, endpointDe, modeloDe } from "../../proveedores";
import { esfuerzoVisible, type LocalModel, type Settings as SettingsType } from "../../types";

type TestState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "ok"; msg: string }
  | { status: "error"; msg: string };

/** Las tarjetas de proveedor, su estado real y una prueba que se puede lanzar
 *  sobre todas a la vez: antes había que ir de una en una para saber cuál
 *  estaba viva, y el modelo que se iba a usar no se veía hasta probar. */
export function SelectorProveedor({
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

export function LocalModelField({
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
export function ModeloTexto({
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

export function ApiKeyField({ provider }: { provider: string }) {
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
