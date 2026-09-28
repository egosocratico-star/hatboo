import { t } from "../i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Briefcase, Cpu, FolderOpen, MessageSquare, Pin, Search, X } from "lucide-react";
import { useChatStore } from "../store/chatStore";
import { useWorkStore } from "../store/workStore";
import type { LocalModel } from "../types";

interface Hit {
  conversationId: string;
  title: string;
  projectId: string | null;
  updatedAt: number;
  pinned: boolean;
  snippet: string | null;
}

/**
 * Una fila del resultado: un hilo, un proyecto o un modelo de Ollama. La
 * paleta de `Ctrl+K` encontró primero solo chats; cambiar de modelo exigía
 * ir al chip del compositor.
 */
type Fila =
  | { kind: "hilo"; grupo: string; hit: Hit }
  | { kind: "proyecto"; grupo: string; id: string; nombre: string; ruta: string }
  | { kind: "modelo"; grupo: string; nombre: string };

const DIA = 86_400_000;

/** Cuatro cubos a mano; suficientemente cerca de como la gente piensa "el otro día". */
function grupo(ms: number, hoy: number): string {
  const dias = Math.floor((hoy - ms) / DIA);
  if (dias <= 0) return t("Hoy");
  if (dias < 7) return t("Esta semana");
  if (dias < 31) return t("Este mes");
  return t("Antes");
}

/** Para que «documentos» encuentre «Documentos» y «música» encuentre «musica». */
const sinAcentos = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");

export default function SearchOverlay() {
  const open = useChatStore((s) => s.searchOpen);
  const setOpen = useChatStore((s) => s.setSearchOpen);
  const setView = useChatStore((s) => s.setView);
  const selectConversation = useChatStore((s) => s.selectConversation);
  const projects = useWorkStore((s) => s.projects);
  const conversations = useChatStore((s) => s.conversations);
  const activeId = useChatStore((s) => s.activeId);
  const endpoint = useChatStore((s) => s.settings?.localEndpoint ?? "");
  const modeloActivo = useChatStore((s) => s.settings?.localModel ?? "");
  const patchSettings = useChatStore((s) => s.patchSettings);

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [modelos, setModelos] = useState<LocalModel[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [sel, setSel] = useState(0);
  const cajaRef = useRef<HTMLInputElement>(null);

  // Se cierra y limpia: al volver a abrir no debe salir la búsqueda anterior.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHits([]);
    setSel(0);
    cajaRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open || modelos.length > 0 || !endpoint) return;
    invoke<LocalModel[]>("list_local_models", { endpoint })
      .then(setModelos)
      .catch(() => setModelos([]));
  }, [open, endpoint, modelos.length]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      // Y se apaga el aviso: si no, la última búsqueda que iba por mitad queda
      // el «buscando…» colgado para siempre sobre la caja vacía.
      setBuscando(false);
      return;
    }
    let vivo = true;
    setBuscando(true);
    const temporizador = setTimeout(async () => {
      try {
        const r = await invoke<Hit[]>("search_chats", { query: q });
        if (vivo) {
          setHits(r);
          setSel(0);
        }
      } finally {
        if (vivo) setBuscando(false);
      }
    }, 220);
    return () => {
      vivo = false;
      clearTimeout(temporizador);
    };
  }, [query, open]);

  /** Proyectos y modelos se filtran aquí, en memoria: ya están cargados. Con la
   *  caja vacía la paleta no es un muro de texto sino un conmutador: salen los
   *  últimos hilos para poder saltar a ellos sin escribir nada. */
  const filas = useMemo<Fila[]>(() => {
    const q = sinAcentos(query.trim());
    const hoy = Date.now();
    const salida: Fila[] = [];
    if (q.length < 2) {
      return conversations
        .filter((c) => !c.archived && c.id !== activeId)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 6)
        .map((c) => ({
          kind: "hilo" as const,
          grupo: t("Recientes"),
          hit: {
            conversationId: c.id,
            title: c.title,
            projectId: c.projectId,
            updatedAt: c.updatedAt,
            pinned: c.pinned,
            snippet: null,
          },
        }));
    }
    for (const p of projects) {
      if (sinAcentos(p.name).includes(q) || sinAcentos(p.rootPath).includes(q)) {
        salida.push({
          kind: "proyecto",
          grupo: t("Proyectos"),
          id: p.id,
          nombre: p.name,
          ruta: p.rootPath,
        });
      }
    }
    for (const m of modelos) {
      if (m.name !== modeloActivo && sinAcentos(m.name).includes(q)) {
        salida.push({ kind: "modelo", grupo: t("Modelos"), nombre: m.name });
      }
    }
    for (const hit of hits) {
      salida.push({ kind: "hilo", grupo: grupo(hit.updatedAt, hoy), hit });
    }
    return salida;
  }, [query, projects, modelos, modeloActivo, hits, conversations, activeId]);

  if (!open) return null;

  const grupos: Array<{ titulo: string; items: Fila[] }> = [];
  filas.forEach((f) => {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.titulo === f.grupo) ultimo.items.push(f);
    else grupos.push({ titulo: f.grupo, items: [f] });
  });

  const activar = async (fila: Fila) => {
    setOpen(false);
    if (fila.kind === "proyecto") {
      setView("work");
      await useWorkStore.getState().selectProject(fila.id);
      return;
    }
    if (fila.kind === "modelo") {
      // Cambiar de modelo es también pasarse a Ollama: si no, el nombre elegido
      // no coincide con el proveedor activo y la app parece ignorar el clic.
      void patchSettings({ activeProvider: "local", localModel: fila.nombre });
      return;
    }
    const hit = fila.hit;
    if (!hit.projectId) {
      setView("chat");
      await selectConversation(hit.conversationId);
      return;
    }
    setView("work");
    const work = useWorkStore.getState();
    await work.selectProject(hit.projectId);
    await work.selectSession(hit.conversationId);
  };

  const teclado = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, Math.max(filas.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter" && filas[sel]) {
      e.preventDefault();
      void activar(filas[sel]);
    }
  };

  const fila = (i: number) =>
    `w-full flex items-start gap-2.5 px-4 py-2 text-left transition-colors ${
      sel === i ? "bg-base-hover" : "hover:bg-base-hover/60"
    }`;

  let indice = -1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[12vh] px-6"
      onMouseDown={() => setOpen(false)}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-xl border border-base-border hatboo-blur shadow-2xl shadow-shade/50 overflow-hidden animate-pop-in"
      >
        <div className="flex items-center gap-2 px-3.5 py-3 border-b border-base-border">
          <Search className="w-4 h-4 shrink-0 text-zinc-500" />
          <input
            ref={cajaRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={teclado}
            placeholder={t("Buscar chats, sesiones, proyectos o modelos…")}
            className="flex-1 min-w-0 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
          />
          {buscando && (
            <span className="shrink-0 text-[11px] text-zinc-600">{t("buscando…")}</span>
          )}
          <button
            onClick={() => setOpen(false)}
            className="shrink-0 p-1 rounded-md text-zinc-500 hover:bg-base-hover hover:text-zinc-200 transition-colors"
            title={t("Cerrar (Esc)")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-[52vh] overflow-y-auto py-1.5">
          {query.trim().length < 2 && (
            <p className="px-4 pb-1.5 pt-2 text-[11px] leading-snug text-zinc-600">
              {t("Escribe dos letras y buscará también dentro de los mensajes, en los proyectos y en los modelos de Ollama.")}
            </p>
          )}
          {query.trim().length >= 2 && !buscando && filas.length === 0 && (
            <p className="px-4 py-6 text-center text-xs text-zinc-600">
              {t("Nada coincide con «{q}».", { q: query.trim() })}
            </p>
          )}
          {grupos.map((g) => (
            <div key={g.titulo}>
              <p className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-wider text-zinc-600">
                {g.titulo}
              </p>
              {g.items.map((f) => {
                indice += 1;
                const i = indice;
                if (f.kind === "proyecto") {
                  return (
                    <button
                      key={`p${f.id}`}
                      onMouseEnter={() => setSel(i)}
                      onClick={() => void activar(f)}
                      className={fila(i)}
                    >
                      <FolderOpen className="w-3.5 h-3.5 mt-0.5 shrink-0 text-accent-soft/70" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-zinc-200">
                          {f.nombre}
                        </span>
                        <span className="block truncate font-mono text-[11px] text-zinc-600">
                          {f.ruta}
                        </span>
                      </span>
                    </button>
                  );
                }
                if (f.kind === "modelo") {
                  return (
                    <button
                      key={`m${f.nombre}`}
                      onMouseEnter={() => setSel(i)}
                      onClick={() => void activar(f)}
                      className={fila(i)}
                    >
                      <Cpu className="w-3.5 h-3.5 mt-0.5 shrink-0 text-accent-soft/70" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-sm text-zinc-200">
                          {f.nombre}
                        </span>
                        <span className="block truncate text-[11px] text-zinc-600">
                          {t("Usar este modelo de Ollama")}
                        </span>
                      </span>
                    </button>
                  );
                }
                const hit = f.hit;
                return (
                  <button
                    key={hit.conversationId}
                    onMouseEnter={() => setSel(i)}
                    onClick={() => void activar(f)}
                    className={fila(i)}
                  >
                    {hit.projectId ? (
                      <Briefcase className="w-3.5 h-3.5 mt-0.5 shrink-0 text-accent-soft/70" />
                    ) : (
                      <MessageSquare className="w-3.5 h-3.5 mt-0.5 shrink-0 text-zinc-500" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm text-zinc-200">
                          {hit.title}
                        </span>
                        {hit.pinned && (
                          <Pin className="w-3 h-3 shrink-0 text-accent-soft/70" />
                        )}
                        {hit.projectId && (
                          <span className="shrink-0 text-[10px] text-zinc-600 truncate">
                            {projects.find((p) => p.id === hit.projectId)?.name ??
                              t("proyecto")}
                          </span>
                        )}
                      </span>
                      {hit.snippet && (
                        <span className="block truncate text-xs text-zinc-500">
                          …{hit.snippet}…
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 border-t border-base-border px-4 py-2 text-[10px] text-zinc-600">
          <Tecla k="↑↓">{t("navegar")}</Tecla>
          <Tecla k="Enter">{t("abrir")}</Tecla>
          <Tecla k="Esc">{t("cerrar")}</Tecla>
          {filas.length > 0 && (
            <span className="ml-auto tabular-nums">
              {filas.length === 1
                ? t("1 resultado")
                : t("{n} resultados", { n: filas.length })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Una tecla del pie de la paleta: se dibuja, no se escribe. */
function Tecla({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1">
      <kbd className="rounded border border-base-border bg-base px-1 py-px font-sans text-[10px] text-zinc-500">
        {k}
      </kbd>
      {children}
    </span>
  );
}
