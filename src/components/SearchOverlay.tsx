import { t } from "../i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Briefcase, MessageSquare, Pin, Search, X } from "lucide-react";
import { useChatStore } from "../store/chatStore";
import { useWorkStore } from "../store/workStore";

interface Hit {
  conversationId: string;
  title: string;
  projectId: string | null;
  updatedAt: number;
  pinned: boolean;
  snippet: string | null;
}

const DIA = 86_400_000;

/** Cuatro cubos a mano; suficientemente cerca de como la gente piensa "el otro día". */
function grupo(ms: number, hoy: number): string {
  const dias = Math.floor((hoy - ms) / DIA);
  if (dias <= 0) return "Hoy";
  if (dias < 7) return t("Esta semana");
  if (dias < 31) return t("Este mes");
  return "Antes";
}

export default function SearchOverlay() {
  const open = useChatStore((s) => s.searchOpen);
  const setOpen = useChatStore((s) => s.setSearchOpen);
  const setView = useChatStore((s) => s.setView);
  const selectConversation = useChatStore((s) => s.selectConversation);
  const projects = useWorkStore((s) => s.projects);

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [sel, setSel] = useState(0);
  const cajaRef = useRef<HTMLInputElement>(null);

  const nombreProyecto = useMemo(
    () => Object.fromEntries(projects.map((p) => [p.id, p.name])),
    [projects],
  );

  // Se cierra y limpia: al volver a abrir no debe salir la búsqueda anterior.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHits([]);
    setSel(0);
    cajaRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
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

  if (!open) return null;

  const grupos: Array<{ titulo: string; items: Array<{ hit: Hit; i: number }> }> = [];
  const hoy = Date.now();
  hits.forEach((hit, i) => {
    const titulo = grupo(hit.updatedAt, hoy);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.titulo === titulo) ultimo.items.push({ hit, i });
    else grupos.push({ titulo, items: [{ hit, i }] });
  });

  const abrir = async (hit: Hit) => {
    setOpen(false);
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
      setSel((s) => Math.min(s + 1, Math.max(hits.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter" && hits[sel]) {
      e.preventDefault();
      void abrir(hits[sel]);
    }
  };

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
            placeholder={t("Buscar en todos los chats y sesiones…")}
            className="flex-1 min-w-0 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
          />
          {buscando && (
            <span className="shrink-0 text-[11px] text-zinc-600">buscando…</span>
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
            <p className="px-4 py-6 text-center text-xs text-zinc-600">
              {t("Escribe al menos dos letras. Busca en títulos y en el contenido de los mensajes; las sesiones archivadas quedan fuera.")}
            </p>
          )}
          {query.trim().length >= 2 && !buscando && hits.length === 0 && (
            <p className="px-4 py-6 text-center text-xs text-zinc-600">
              {t("Nada coincide con «{q}».", { q: query.trim() })}
            </p>
          )}
          {grupos.map((g) => (
            <div key={g.titulo}>
              <p className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-wider text-zinc-600">
                {g.titulo}
              </p>
              {g.items.map(({ hit, i }) => (
                <button
                  key={hit.conversationId}
                  onMouseEnter={() => setSel(i)}
                  onClick={() => void abrir(hit)}
                  className={`w-full flex items-start gap-2.5 px-4 py-2 text-left transition-colors ${
                    sel === i ? "bg-base-hover" : "hover:bg-base-hover/60"
                  }`}
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
                          {nombreProyecto[hit.projectId] ?? "proyecto"}
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
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
