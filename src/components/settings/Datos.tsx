import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as pickFile, save as pickSavePath } from "@tauri-apps/plugin-dialog";
import { AlertTriangle, Download, Upload } from "lucide-react";
import { t } from "../../i18n";
import { CAMPO } from "../modalUi";
import { SectionTitle, Stat } from "./piezas";
import {
  RESET_TOKEN,
  type ExportSummary,
  type ImportReport,
  type StorageInfo,
} from "../../types";

/** Ajustes → Datos. Lo que hay en el disco, la copia entera y el borrón y cuenta
 *  nueva. Las claves no se listan aquí: solo viven en el llavero. */
export default function AjustesDatos({
  storage,
  onRecargar,
}: {
  storage: StorageInfo | null;
  onRecargar: () => void;
}) {
  const [dataBusy, setDataBusy] = useState(false);
  const [dataMsg, setDataMsg] = useState<string | null>(null);
  const [dataErr, setDataErr] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetText, setResetText] = useState("");

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
      onRecargar();
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
      onRecargar();
    } catch (e) {
      setDataErr(String(e));
    } finally {
      setDataBusy(false);
    }
  };

  return (
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
  );
}
