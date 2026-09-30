import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RefreshCw } from "lucide-react";
import { t } from "../../i18n";
import { gigabytes } from "../../unidades";
import { SectionTitle, PathRow, formatBytes } from "./piezas";
import type { Hardware, StorageInfo } from "../../types";

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

/** Ajustes → Sistema. El equipo ahora mismo y dónde guarda Hatboo sus archivos. */
export default function AjustesSistema({
  storage,
  version,
  onCargar,
}: {
  storage: StorageInfo | null;
  version: string;
  onCargar: () => void;
}) {
  return (
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
            onClick={onCargar}
            className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-200 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            {t("Volver a calcular")}
          </button>
        </div>
      )}
    </>
  );
}
