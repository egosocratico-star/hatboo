import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Plus, Scale, Square, Trash2, X } from "lucide-react";
import { useChatStore } from "../store/chatStore";
import RichText from "./RichText";
import ThinkingBlock from "./ThinkingBlock";
import type { Settings } from "../types";

type ProviderId = Settings["activeProvider"];
type Estado = "corriendo" | "listo" | "error";

const PROVIDERS: Array<{ id: ProviderId; label: string }> = [
  { id: "local", label: "Local" },
  { id: "anthropic", label: "Anthropic" },
  { id: "openai", label: "OpenAI" },
];

interface Objetivo {
  id: string;
  provider: ProviderId;
  model: string;
}

interface Respuesta {
  texto: string;
  razon: string;
  estado: Estado;
  error?: string;
}

const nuevoId = () => Math.random().toString(36).slice(2, 10);

function modeloGuardado(s: Settings | null, provider: ProviderId): string {
  if (!s) return "";
  if (provider === "anthropic") return s.anthropicModel;
  if (provider === "openai") return s.openaiModel;
  return s.localModel;
}

const campo =
  "rounded-lg border border-base-border bg-base px-2 py-1.5 text-xs outline-none focus:border-accent/70";

/**
 * Compara la misma pregunta en 2-3 modelos a la vez. Es deliberadamente
 * efímero: lo que responden aquí no se guarda en la conversación, porque mezclar
 * tres versiones de una respuesta con el historial contaminaría lo que venga
 * después. Se envía el historial del chat + la pregunta, para que la comparación
 * se haga en las mismas condiciones que una respuesta normal.
 */
export default function ComparePanel({
  conversationId,
  onCerrar,
}: {
  conversationId: string | null;
  onCerrar: () => void;
}) {
  const settings = useChatStore((s) => s.settings);
  const mensajes = useChatStore((s) => s.messages);
  const [objetivos, setObjetivos] = useState<Objetivo[]>(() => {
    const activo = (settings?.activeProvider ?? "local") as ProviderId;
    const segundo: ProviderId = activo === "local" ? "openai" : "local";
    return [activo, segundo].map((p) => ({ id: nuevoId(), provider: p, model: modeloGuardado(settings, p) }));
  });
  const [pregunta, setPregunta] = useState("");
  const [respuestas, setRespuestas] = useState<Record<string, Respuesta>>({});
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelosLocales, setModelosLocales] = useState<string[]>([]);

  // Los deltas se acumulan en los listeners, que se montan una vez: leen el
  // valor actual por este ref en vez de por el cierre del primer render.
  const respuestasRef = useRef(respuestas);
  respuestasRef.current = respuestas;

  useEffect(() => {
    const acumular = (id: string, campoTexto: "texto" | "razon", delta: string, estado: Estado) =>
      setRespuestas((prev) => {
        const actual = prev[id] ?? { texto: "", razon: "", estado: "corriendo" as Estado };
        return {
          ...prev,
          [id]: { ...actual, [campoTexto]: actual[campoTexto] + delta, estado },
        };
      });
    const offs = [
      listen<{ id: string; delta: string }>("compare:chunk", ({ payload }) =>
        acumular(payload.id, "texto", payload.delta, "corriendo"),
      ),
      listen<{ id: string; delta: string }>("compare:reasoning", ({ payload }) =>
        acumular(payload.id, "razon", payload.delta, "corriendo"),
      ),
      listen<{ id: string }>("compare:done", ({ payload }) =>
        setRespuestas((prev) => ({
          ...prev,
          [payload.id]: { ...(prev[payload.id] ?? { texto: "", razon: "", estado: "corriendo" as Estado }), estado: "listo" },
        })),
      ),
      listen<{ id: string; message: string | null }>("compare:error", ({ payload }) =>
        setRespuestas((prev) => ({
          ...prev,
          [payload.id]: {
            ...(prev[payload.id] ?? { texto: "", razon: "", estado: "corriendo" as Estado }),
            estado: "error",
            error: payload.message ?? "La comparación falló.",
          },
        })),
      ),
    ];
    return () => {
      offs.forEach((p) => void p.then((un) => un()));
    };
  }, []);

  useEffect(() => {
    if (!objetivos.some((o) => o.provider === "local") || modelosLocales.length > 0 || !settings) return;
    void invoke<string[]>("list_local_models", { endpoint: settings.localEndpoint })
      .then(setModelosLocales)
      .catch(() => setModelosLocales([]));
    // Solo al abrir el panel: refrescar el catálogo de Ollama no es su asunto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objetivos, settings]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCerrar();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCerrar]);

  // El botón de detener se apaga solo: si no, se queda ofreciendo cancelar algo
  // que ya terminó. Se juzga por los objetivos actuales, no por los de aquella
  // tanda, para que quitar una columna a media comparación tampoco lo cuele.
  useEffect(() => {
    if (!ocupado || objetivos.length === 0) return;
    const todos = objetivos.every((o) => {
      const e = respuestas[o.id]?.estado;
      return e === "listo" || e === "error";
    });
    if (todos) setOcupado(false);
  }, [respuestas, objetivos, ocupado]);

  const lanzar = async () => {
    const texto = pregunta.trim();
    if (!texto || ocupado) return;
    setError(null);
    const arranque: Record<string, Respuesta> = {};
    for (const o of objetivos) arranque[o.id] = { texto: "", razon: "", estado: "corriendo" };
    setRespuestas(arranque);
    setOcupado(true);
    try {
      await invoke("start_comparison", {
        conversationId: conversationId ?? "",
        prompt: texto,
        targets: objetivos.map((o) => ({ id: o.id, provider: o.provider, model: o.model })),
      });
    } catch (e) {
      setError(String(e));
      setOcupado(false);
    }
  };

  const detener = async () => {
    await invoke("cancel_comparison", { conversationId: conversationId ?? "" }).catch(() => {});
    setOcupado(false);
  };

  const cambiar = (id: string, cambio: Partial<Objetivo>) =>
    setObjetivos((prev) =>
      prev.map((o) =>
        o.id === id
          ? {
              ...o,
              ...cambio,
              // Cambiar de proveedor sin cambiar de campo modelo dejaría un
              // nombre de otra marca en el hueco.
              model: cambio.provider ? modeloGuardado(settings, cambio.provider) : o.model,
            }
          : o,
      ),
    );

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-6">
      <div className="flex h-full max-h-[82vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-base-border bg-base-raised shadow-2xl shadow-shade/50">
        <div className="flex shrink-0 items-center gap-2 border-b border-base-border px-4 py-2.5">
          <Scale className="w-4 h-4 text-accent-soft" />
          <h2 className="text-sm font-medium text-zinc-100">Comparar modelos</h2>
          <p className="ml-2 hidden text-[11px] text-zinc-500 sm:block">
            La misma pregunta a la vez; no se guarda en la conversación.
          </p>
          <button
            onClick={onCerrar}
            title="Cerrar (Esc)"
            className="ml-auto rounded-md p-1 text-zinc-500 hover:bg-base hover:text-zinc-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="shrink-0 space-y-2 border-b border-base-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            {objetivos.map((o, i) => (
              <div
                key={o.id}
                className="flex items-center gap-1 rounded-lg border border-base-border bg-base p-1"
              >
                <span className="pl-1 text-[10px] uppercase tracking-wider text-zinc-600">
                  {i + 1}
                </span>
                <select
                  value={o.provider}
                  onChange={(e) => cambiar(o.id, { provider: e.target.value as ProviderId })}
                  className={campo}
                  title="Proveedor"
                >
                  {PROVIDERS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
                {o.provider === "local" && modelosLocales.length > 0 ? (
                  <select
                    value={o.model}
                    onChange={(e) => cambiar(o.id, { model: e.target.value })}
                    className={campo + " max-w-44"}
                    title="Modelo"
                  >
                    {!modelosLocales.includes(o.model) && <option value={o.model}>{o.model}</option>}
                    {modelosLocales.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={o.model}
                    onChange={(e) => cambiar(o.id, { model: e.target.value })}
                    placeholder="modelo"
                    spellCheck={false}
                    className={campo + " w-36 font-mono"}
                    title="Modelo"
                  />
                )}
                <button
                  onClick={() => setObjetivos((prev) => prev.filter((x) => x.id !== o.id))}
                  disabled={objetivos.length <= 1}
                  title="Quitar este modelo"
                  className="rounded p-1 text-zinc-600 hover:text-red-300 disabled:opacity-30 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            {objetivos.length < 3 && (
              <button
                onClick={() =>
                  setObjetivos((prev) => [
                    ...prev,
                    { id: nuevoId(), provider: "local", model: modeloGuardado(settings, "local") },
                  ])
                }
                className="inline-flex items-center gap-1 rounded-lg border border-dashed border-base-border px-2 py-1.5 text-[11px] text-zinc-500 hover:border-accent/50 hover:text-zinc-200 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Añadir modelo
              </button>
            )}
          </div>

          <div className="flex items-end gap-2">
            <textarea
              autoFocus
              value={pregunta}
              onChange={(e) => setPregunta(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void lanzar();
                }
              }}
              rows={2}
              placeholder="Escribe la pregunta y pulsa Ctrl+Enter"
              className="flex-1 resize-none rounded-lg border border-base-border bg-base px-3 py-2 text-sm outline-none focus:border-accent/70 placeholder:text-zinc-600"
            />
            {ocupado ? (
              <button
                onClick={() => void detener()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-accent-dim transition-colors"
                title="Detener las tres generaciones"
              >
                <Square className="w-3 h-3 fill-current" />
                Detener
              </button>
            ) : (
              <button
                onClick={() => void lanzar()}
                disabled={!pregunta.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-accent-dim disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Comparar
              </button>
            )}
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <div className="flex flex-1 min-h-0 divide-x divide-base-border">
          {objetivos.map((o) => {
            const r = respuestas[o.id];
            return (
              <div key={o.id} className="flex min-w-0 flex-1 flex-col">
                <div className="flex shrink-0 items-center gap-2 border-b border-base-border px-3 py-1.5">
                  <span className="truncate text-xs text-zinc-300">{o.model || "sin modelo"}</span>
                  <span className="shrink-0 text-[10px] uppercase tracking-wider text-zinc-600">
                    {PROVIDERS.find((p) => p.id === o.provider)?.label}
                  </span>
                  <span className="ml-auto shrink-0 text-[10px] text-zinc-600">
                    {r?.estado === "corriendo"
                      ? "escribiendo…"
                      : r?.estado === "listo"
                        ? "listo"
                        : r?.estado === "error"
                          ? "error"
                          : ""}
                  </span>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2.5">
                  {!r ? (
                    <p className="text-xs text-zinc-600">Sin respuesta todavía.</p>
                  ) : r.estado === "error" ? (
                    <p className="text-xs leading-relaxed text-red-400">{r.error}</p>
                  ) : (
                    <>
                      {r.razon && <ThinkingBlock reasoning={r.razon} />}
                      {r.texto ? (
                        <RichText text={r.texto} />
                      ) : (
                        <p className="text-xs text-zinc-600">Pensando…</p>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <p className="shrink-0 border-t border-base-border px-4 py-1.5 text-[10px] text-zinc-600">
          {mensajes.length > 0
            ? `Se envían también los ${mensajes.length} mensajes anteriores, igual que en el chat.`
            : "Sin historial de fondo: pregunta suelta."}
        </p>
      </div>
    </div>
  );
}
