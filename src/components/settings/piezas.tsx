import { t } from "../../i18n";
import { FolderOpen } from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

/** Cabecera de cada sección: título, qué contiene, y el divisor que separa del
 *  primer bloque. Sin ella las secciones empezaban pegadas al scroll. */
export function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="border-b border-base-border pb-3">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <p className="text-sm text-zinc-500 mt-1">{subtitle}</p>
    </header>
  );
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/** Ruta con su botón de «enséñame dónde está». Va en Datos y en Sistema, y las
 *  dos veces era el mismo cuadrito. */
export function PathRow({
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

export function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-base-border bg-base-card px-3 py-3 text-center">
      <div className="text-xl font-semibold text-layer">
        {value.toLocaleString("es")}
      </div>
      <div className="mt-0.5 text-[11px] text-zinc-500">{label}</div>
    </div>
  );
}
