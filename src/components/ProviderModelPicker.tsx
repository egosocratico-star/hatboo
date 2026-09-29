import { t } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CAMPO } from "./modalUi";
import {
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  ExternalLink,
  Eye,
  Power,
  RefreshCw,
  Search,
  Settings2,
  Wrench,
} from "lucide-react";
import { useChatStore } from "../store/chatStore";
import Popover from "./Popover";
import {
  REASONING_LEVELS,
  esfuerzoVisible,
  type Settings,
} from "../types";
import {
  NIVELES,
  capsVisibles,
  esNube,
  nivelModelo,
  nivelPorNombre,
  saleDelEquipo,
  type NivelModelo,
} from "../modelo";
import { CORTOS, PROVEEDORES, campoModelo, endpointDe, modeloActivo } from "../proveedores";

/** Fila ya normalizada de la lista de modelos (Ollama o el router de HF). */
type FilaModelo = { nombre: string; nivel: NivelModelo | null; nube: boolean; caps: string[] };

type Probe = "checking" | "ok" | "error" | null;

export default function ProviderModelPicker() {
  const settings = useChatStore((s) => s.settings);
  const saveSettings = useChatStore((s) => s.saveSettings);
  const setView = useChatStore((s) => s.setView);

  const [open, setOpen] = useState(false);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [provOpen, setProvOpen] = useState(false);
  const [probe, setProbe] = useState<Probe>(null);
  const localModels = useChatStore((s) => s.localModels);
  const localModelsEndpoint = useChatStore((s) => s.localModelsEndpoint);
  const [hfModels, setHfModels] = useState<string[] | null>(null);
  const [loadingHf, setLoadingHf] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [filtro, setFiltro] = useState("");
  const [expulsando, setExpulsando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const probeKey = settings
    ? `${settings.activeProvider}|${modeloActivo(settings)}|${endpointDe(
        settings,
        settings.activeProvider,
      )}`
    : "";

  useEffect(() => {
    if (!settings) return;
    let cancelled = false;
    setProbe("checking");
    void invoke<string>("test_provider", {
      provider: settings.activeProvider,
      model: modeloActivo(settings),
      endpoint: endpointDe(settings, settings.activeProvider),
    })
      .then(() => !cancelled && setProbe("ok"))
      .catch(() => !cancelled && setProbe("error"));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probeKey]);

  /** La lista vive en el store: el gate de visión del menú + usa la misma copia. */
  const refreshOllama = async () => {
    if (!settings) return;
    setLoadingModels(true);
    try {
      await useChatStore.getState().loadLocalModels();
    } finally {
      setLoadingModels(false);
    }
  };

  /** Ids del router de Hugging Face; sin token no hay lista que pedir. */
  const refreshHf = async () => {
    if (!settings) return;
    setLoadingHf(true);
    try {
      setHfModels(
        await invoke<string[]>("list_hf_models", { endpoint: settings.hfEndpoint }),
      );
    } catch {
      setHfModels(null);
    } finally {
      setLoadingHf(false);
    }
  };

  useEffect(() => {
    if (!open || !settings) return;
    if (
      settings.activeProvider === "local" &&
      (localModels === null || localModelsEndpoint !== settings.localEndpoint)
    )
      void refreshOllama();
    if (settings.activeProvider === "hf" && hfModels === null) void refreshHf();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, settings?.activeProvider]);

  /** Libera un modelo de la RAM de Ollama sin borrarlo del disco. */
  const expulsar = async (m: string) => {
    if (!settings) return;
    setExpulsando(m);
    setAviso(null);
    try {
      await invoke("unload_local_model", { endpoint: settings.localEndpoint, model: m });
      setAviso(t("{m} quedó fuera de la memoria.", { m }));
    } catch (e) {
      setAviso(String(e));
    } finally {
      setExpulsando(null);
    }
  };

  if (!settings) return null;

  const patch = async (part: Partial<Settings>) => {
    // Leer al escribir: el blob de ajustes se guarda completo y una copia vieja
    // del render barrería cualquier cambio reciente (el tema, p. ej.).
    const current = useChatStore.getState().settings;
    if (!current) return;
    await saveSettings({ ...current, ...part });
  };

  const model = modeloActivo(settings);
  const esLocal = settings.activeProvider === "local";
  const cargando = loadingModels || loadingHf;
  /** Fila normalizada: Ollama manda objetos con el tamaño y las capacidades
   *  declaradas, y el router de Hugging Face solo ids, así que la lista se
   *  pinta desde una forma común. */
  const todas: FilaModelo[] = esLocal
    ? (localModels ?? []).map((m) => ({
        nombre: m.name,
        nivel: nivelModelo(m),
        nube: esNube(m.name),
        caps: capsVisibles(m.capabilities),
      }))
    : (hfModels ?? []).map((n) => ({
        nombre: n,
        nivel: nivelPorNombre(n),
        nube: true,
        caps: [],
      }));
  // Búsqueda por subcadena sin distinguir mayúsculas: los nombres llevan
  // dos-points, barras y guiones, y uno escribe «qwen» a secas.
  const filtradas = todas.filter((f) =>
    f.nombre.toLowerCase().includes(filtro.trim().toLowerCase()),
  );
  const effort = esfuerzoVisible(settings.reasoningEffort);
  const effortLabel =
    REASONING_LEVELS.find((l) => l.id === effort)?.short ?? "Off";
  const dot =
    probe === "ok"
      ? saleDelEquipo(settings.activeProvider, model)
        ? "bg-amber-400"
        : "bg-emerald-400"
      : probe === "error"
        ? "bg-red-400"
        : probe === "checking"
          ? "bg-amber-400 animate-pulse"
          : "bg-zinc-600";
  const fuera = saleDelEquipo(settings.activeProvider, model);

  /** Una fila de la lista: nombre, para qué da y, en Ollama, expulsar de RAM. */
  const fila = (f: FilaModelo) => {
    const activo = model === f.nombre;
    return (
      <div
        key={f.nombre}
        className={`group flex items-center gap-1 rounded-lg pr-1 transition-colors ${
          activo ? "bg-base-hover" : "hover:bg-base-hover/60"
        }`}
      >
        <button
          onClick={() => {
            void patch({
              [campoModelo(settings.activeProvider)]: f.nombre,
            } as Partial<Settings>);
            setOpen(false);
          }}
          className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-left text-xs font-mono text-zinc-300"
        >
          <span className="truncate">{f.nombre}</span>
          {f.nivel && (
            <span
              title={t(NIVELES[f.nivel].aviso)}
              className={`shrink-0 rounded-full px-1.5 py-px font-sans text-[10px] ${NIVELES[f.nivel].clases}`}
            >
              {t(NIVELES[f.nivel].corto)}
            </span>
          )}
          {f.caps.includes("vision") && (
            <span title={t("Ve imágenes")} className="flex shrink-0 items-center">
              <Eye className="h-3 w-3 text-zinc-500" />
            </span>
          )}
          {f.caps.includes("tools") && (
            <span title={t("Puede llamar a herramientas")} className="flex shrink-0 items-center">
              <Wrench className="h-3 w-3 text-zinc-500" />
            </span>
          )}
          {activo && <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-accent-soft" />}
        </button>
        {esLocal && (
          <button
            onClick={() => void expulsar(f.nombre)}
            disabled={expulsando !== null}
            title={t("Expulsar de la memoria")}
            className="shrink-0 rounded p-1 text-zinc-600 opacity-0 transition-all hover:bg-base hover:text-zinc-200 focus:opacity-100 group-hover:opacity-100 disabled:opacity-40"
          >
            {expulsando === f.nombre ? (
              <RefreshCw className="h-3 w-3 animate-spin" />
            ) : (
              <Power className="h-3 w-3" />
            )}
          </button>
        )}
      </div>
    );
  };

  const enPc = filtradas.filter((f) => !f.nube);
  const enNube = filtradas.filter((f) => f.nube);

  // El icono del proveedor activo, para la fila plegada de «Proveedor».
  const ActivoIcono =
    PROVEEDORES.find((p) => p.id === settings.activeProvider)?.icono ?? PROVEEDORES[0].icono;

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        title={fuera ? t("Esta respuesta sale de tu equipo") : t("Se genera en tu equipo")}
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-zinc-400 hover:bg-layer/5 hover:text-zinc-100 transition-colors max-w-72"
      >
        <span className={`w-1.5 h-1.5 shrink-0 rounded-full ${dot}`} />
        <span className="truncate font-medium">{model || t("sin modelo")}</span>
        {/* El punto ámbar solo se explicaba al pasar el ratón por encima: la nube
            a la vista dice sin palabras que esto no se responde en el equipo. */}
        {fuera && (
          <span
            title={t("Esta respuesta sale de tu equipo")}
            className="flex shrink-0 items-center text-amber-400/80"
          >
            <Cloud className="h-3 w-3" />
          </span>
        )}
        <span className="shrink-0 text-zinc-500">
          {CORTOS[settings.activeProvider]}
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
          {/* El proveedor se elige una vez y se cambia poco, así que no ocupa
              seis filas siempre: una línea con el activo y se despliega igual
              que la del razonamiento. Lo que se mira al abrir es la lista de
              modelos, y esa queda arriba. */}
          <div className="border-b border-base-border pb-1">
            <button
              onClick={() => setProvOpen((v) => !v)}
              className="w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-base-hover/60 hover:text-zinc-200 transition-colors"
            >
              <ActivoIcono className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
              <span>{t("Proveedor")}</span>
              <span className="ml-auto text-zinc-300">
                {CORTOS[settings.activeProvider]}
              </span>
              {provOpen ? (
                <ChevronDown className="w-3 h-3 shrink-0 rotate-180 text-zinc-600" />
              ) : (
                <ChevronRight className="w-3 h-3 shrink-0 text-zinc-600" />
              )}
            </button>
            {provOpen && (
              <div className="pt-1 space-y-0.5">
                {PROVEEDORES.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => void patch({ activeProvider: p.id })}
                    className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-1 text-xs transition-colors ${
                      settings.activeProvider === p.id
                        ? "bg-base-hover text-zinc-100"
                        : "text-zinc-400 hover:bg-base-hover/60 hover:text-zinc-200"
                    }`}
                  >
                    <p.icono className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                    {p.corto}
                    {settings.activeProvider === p.id && (
                      <Check className="w-3.5 h-3.5 ml-auto text-accent-soft" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="text-[10px] uppercase tracking-wider text-zinc-600 px-2 pt-2 pb-0.5">
            {t("Modelo ({p})", { p: CORTOS[settings.activeProvider] })}
          </div>
          {esLocal || settings.activeProvider === "hf" ? (
            <div className="px-1 pb-1 space-y-1">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
                <input
                  value={filtro}
                  onChange={(e) => setFiltro(e.target.value)}
                  placeholder={t("Buscar modelos…")}
                  className={`${CAMPO} py-1.5 pl-8 pr-2 text-xs`}
                />
              </div>
              {cargando && (
                <div className="flex items-center gap-2 px-1.5 py-1 text-[11px] text-zinc-500">
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  {esLocal ? t("Consultando Ollama…") : t("Consultando Hugging Face…")}
                </div>
              )}
              {!cargando && (esLocal ? localModels : hfModels) === null && (
                <div className="px-1.5 py-1 text-[11px] text-zinc-500">
                  {esLocal
                    ? t("No se pudo listar los modelos de Ollama.")
                    : t("No se pudo listar los modelos de Hugging Face.")}
                </div>
              )}
              {!cargando &&
                (esLocal ? localModels : hfModels) !== null &&
                todas.length === 0 && (
                  <div className="px-1.5 py-1 text-[11px] text-zinc-500">
                    {esLocal
                      ? t("Ollama responde pero no tiene modelos descargados.")
                      : t("Hugging Face responde pero no lista modelos: revisa el token y su permiso de Inference Providers.")}
                  </div>
                )}
              {!cargando && todas.length > 0 && filtradas.length === 0 && (
                <div className="px-1.5 py-1 text-[11px] text-zinc-500">
                  {t("Sin coincidencias para «{q}».", { q: filtro.trim() })}
                </div>
              )}
              {!cargando && filtradas.length > 0 && (
                <div className="max-h-56 space-y-0.5 overflow-y-auto">
                  {enPc.length > 0 && (
                    <div className="px-2 pt-1 pb-0.5 text-[10px] uppercase tracking-wider text-zinc-600">
                      {t("En este PC")}
                    </div>
                  )}
                  {enPc.map(fila)}
                  {enNube.length > 0 && (
                    <>
                      <div className="px-2 pt-2 pb-0.5 text-[10px] uppercase tracking-wider text-zinc-600">
                        {esLocal ? t("Vía Ollama Cloud") : t("Vía Hugging Face")}
                      </div>
                      {enNube.map(fila)}
                    </>
                  )}
                </div>
              )}
              {aviso && (
                <p className="px-1.5 pb-0.5 text-[11px] leading-snug text-zinc-500">{aviso}</p>
              )}
              <button
                onClick={() => void (esLocal ? refreshOllama() : refreshHf())}
                className="w-full flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] text-zinc-500 hover:text-zinc-200 hover:bg-base-hover/60 transition-colors"
              >
                <RefreshCw className="w-3 h-3" /> {t("Recargar lista")}
              </button>
            </div>
          ) : (
            <div className="px-1 pb-1">
              <input
                key={`${settings.activeProvider}-${model}`}
                defaultValue={model}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== model)
                    void patch({
                      [campoModelo(settings.activeProvider)]: v,
                    } as Partial<Settings>);
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
                  {t(
                    "«Sin razonamiento» se lo pide expresamente a lo de este equipo (Ollama, llama.cpp). En la nube no hay campo que mandar: los que razonan por defecto siguen haciéndolo, y lo que pasó de verdad lo dice el «Pensó N s» de la respuesta. Aplica al chat y al modo trabajo.",
                  )}
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
            {t("Ajustes (claves, endpoints, pruebas)")}
            <ExternalLink className="w-3 h-3 ml-auto" />
          </button>
      </Popover>
    </div>
  );
}
