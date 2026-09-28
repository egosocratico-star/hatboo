import { t } from "../../i18n";
import { useMemo, useState } from "react";
import {
  FileText,
  FolderCode,
  FolderOpen,
  MessageCircle,
  Pin,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { useChatStore } from "../../store/chatStore";
import { useWorkStore } from "../../store/workStore";
import { fmtDate, haceRelativo } from "../../time";
import Mascot from "../mascot/Mascot";
import ConfirmModal, { type AvisoBorrado } from "../ConfirmModal";
import { APPROVAL_LEVELS, type Project } from "../../types";

/** La página de proyectos: los mismos que viven en el árbol de la barra lateral,
 *  pero con sitio para ver la ruta, cuántas sesiones tiene y cuándo lo abriste. */
export default function ProjectsView() {
  const projects = useWorkStore((s) => s.projects);
  const conversations = useChatStore((s) => s.conversations);
  const selectProject = useWorkStore((s) => s.selectProject);
  const removeProject = useWorkStore((s) => s.removeProject);
  const setProjectPinned = useWorkStore((s) => s.setProjectPinned);
  const openProjectPicker = useWorkStore((s) => s.openProjectPicker);
  const startCreateProject = useWorkStore((s) => s.startCreateProject);
  const error = useWorkStore((s) => s.error);
  // Aquí el aviso es el del store (un proyecto que no se pudo abrir, un `invoke`
  // que falló), no el de la pestaña: `clearError` del store limpia la pestaña
  // activa, así que la X de esta cinta no cerraba nunca el aviso.
  const cierraAviso = () => useWorkStore.setState({ error: null });
  const setView = useChatStore((s) => s.setView);

  const [q, setQ] = useState("");
  const [aviso, setAviso] = useState<AvisoBorrado | null>(null);

  const sesionesDe = useMemo(() => {
    const cuenta = new Map<string, number>();
    for (const c of conversations) {
      if (!c.projectId) continue;
      cuenta.set(c.projectId, (cuenta.get(c.projectId) ?? 0) + 1);
    }
    return cuenta;
  }, [conversations]);

  const buscar = q.trim().toLowerCase();
  const visibles = buscar
    ? projects.filter(
        (p) =>
          p.name.toLowerCase().includes(buscar) ||
          p.rootPath.toLowerCase().includes(buscar),
      )
    : projects;

  const abrir = (p: Project) => {
    setView("work");
    void selectProject(p.id);
  };

  return (
    <div className="flex-1 min-w-0 min-h-0 flex flex-col">
      <header className="shrink-0 flex flex-wrap items-center gap-3 px-8 py-6">
        <h1 className="mr-auto flex items-baseline gap-2 text-2xl font-semibold tracking-tight">
          {t("Proyectos")}
          {projects.length > 0 && (
            <span className="text-sm font-normal text-zinc-600">{projects.length}</span>
          )}
        </h1>
        {projects.length > 0 && (
          <div className="relative min-w-52 flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("Buscar proyectos…")}
              className="w-full rounded-full border border-base-border bg-base-card py-2 pl-9 pr-3 text-sm outline-none placeholder:text-zinc-600 transition-[border-color,box-shadow] focus:border-accent focus:ring-2 focus:ring-accent/25"
            />
          </div>
        )}
        {/* Con la lista vacía los dos botones se van al centro, que es donde
            mira quien entra por primera vez: arriba y abajo a la vez era el
            mismo botón dos veces. */}
        {projects.length > 0 && (
          <>
            <button
              onClick={() => void openProjectPicker()}
              className="flex items-center gap-2 rounded-full border border-base-border bg-base-card px-3.5 py-2 text-sm text-zinc-300 transition-colors hover:border-accent/50 hover:text-zinc-100"
              title={t("Abrir una carpeta existente como proyecto")}
            >
              <FolderOpen className="h-4 w-4" />
              {t("Abrir carpeta")}
            </button>
            <button
              onClick={() => void startCreateProject()}
              className="flex items-center gap-2 rounded-full bg-accent px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-dim"
            >
              <Plus className="h-4 w-4" />
              {t("Nuevo proyecto")}
            </button>
          </>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-8 pb-8">
        {error && (
          <div className="mb-4 flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-200">
            <span className="flex-1">{error}</span>
            <button onClick={cierraAviso} className="p-0.5 hover:text-layer" title={t("Descartar")}>
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {projects.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <Mascot state="walking" size={104} />
            <div className="space-y-1.5">
              <p className="text-base font-medium">{t("Aún no hay proyectos.")}</p>
              <p className="mx-auto max-w-sm text-sm text-zinc-400">
                {t("Un proyecto es una carpeta: Hatboo lee sus archivos, propone cambios y ejecuta dentro de ella, sin salirse.")}
              </p>
              <p className="mx-auto max-w-sm text-xs text-zinc-500">
                {t("También puedes soltar una carpeta en cualquier parte de la ventana.")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void startCreateProject()}
                className="flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-dim"
              >
                <Plus className="h-4 w-4" />
                {t("Nuevo proyecto")}
              </button>
              <button
                onClick={() => void openProjectPicker()}
                className="flex items-center gap-2 rounded-full border border-base-border bg-base-card px-4 py-2 text-sm text-zinc-300 transition-colors hover:border-accent/50 hover:text-zinc-100"
                title={t("Abrir una carpeta existente como proyecto")}
              >
                <FolderOpen className="h-4 w-4" />
                {t("Abrir carpeta")}
              </button>
            </div>
          </div>
        ) : visibles.length === 0 ? (
          <p className="py-10 text-center text-sm text-zinc-500">
            {t("Sin coincidencias para «{q}».", { q: q.trim() })}
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {visibles.map((p) => {
              const nivel = APPROVAL_LEVELS.find((l) => l.id === p.approvalLevel);
              return (
                <div
                  key={p.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => abrir(p)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      abrir(p);
                    }
                  }}
                  className="group flex min-h-[132px] cursor-pointer flex-col gap-3 rounded-2xl border border-base-border bg-base-card p-5 transition-colors hover:border-accent/50 hover:bg-base-raised"
                >
                  <div className="flex items-start gap-2.5">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-base-border bg-base">
                      {p.esCodigo ? (
                        <FolderCode className="h-4 w-4 text-accent-soft" />
                      ) : (
                        <FileText className="h-4 w-4 text-accent-soft" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-[15px] font-medium">
                          {p.name}
                        </span>
                        {/* La clase de carpeta se decide por lo que hay dentro, no
                            por cómo la llamó el usuario. */}
                        <span
                          className="shrink-0 rounded-md border border-base-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500"
                          title={
                            p.esCodigo
                              ? t(
                                  "Carpeta de código: hay repo de git o un manifiesto de proyecto arriba.",
                                )
                              : t(
                                  "Carpeta de documentos: sin marcas de repo. El agente lee y escribe aquí igual.",
                                )
                          }
                        >
                          {p.esCodigo ? t("Código") : t("Docs")}
                        </span>
                        {p.pinned && (
                          <Pin
                            className="h-3.5 w-3.5 shrink-0 text-accent-soft/80"
                            aria-label={t("Proyecto fijado")}
                          />
                        )}
                      </div>
                      <p className="truncate font-mono text-[11px] text-zinc-600" title={p.rootPath}>
                        {p.rootPath}
                      </p>
                    </div>
                  </div>

                  <div className="mt-auto flex items-center gap-2 border-t border-base-border pt-3 text-[11px] text-zinc-500">
                    <MessageCircle className="h-3 w-3 shrink-0" />
                    <span>{t("{n} sesión(es)", { n: sesionesDe.get(p.id) ?? 0 })}</span>
                    <span className="text-zinc-700">·</span>
                    <span title={fmtDate(p.lastOpenedAt)}>
                      {haceRelativo(p.lastOpenedAt)}
                    </span>
                    {nivel && (
                      <span
                        className="ml-auto flex shrink-0 items-center gap-1 rounded-full border border-base-border bg-base px-2 py-0.5 text-zinc-400"
                        title={t(nivel.help)}
                      >
                        <ShieldCheck className="h-3 w-3 text-accent-soft/80" />
                        {t(nivel.short)}
                      </span>
                    )}
                    <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void setProjectPinned(p.id, !p.pinned);
                        }}
                        title={p.pinned ? t("Quitar de arriba") : t("Fijar arriba")}
                        className={`rounded p-1 transition-colors hover:bg-base-hover ${
                          p.pinned ? "text-accent-soft" : "text-zinc-500"
                        }`}
                      >
                        <Pin className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setAviso({
                            title: t("¿Quitar {p} de Hatboo?", { p: p.name }),
                            body: t(
                              "Se borran sus sesiones y su historial. La carpeta y sus archivos no se tocan.",
                            ),
                            confirmLabel: t("Quitar"),
                            onConfirm: () => void removeProject(p.id),
                          });
                        }}
                        title={t("Quitar proyecto")}
                        className="rounded p-1 text-zinc-500 transition-colors hover:bg-base-hover hover:text-red-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <ConfirmModal aviso={aviso} cerrar={() => setAviso(null)} />
    </div>
  );
}
