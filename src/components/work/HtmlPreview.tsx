import { t } from "../../i18n";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, Eye, RefreshCw } from "lucide-react";

/**
 * Vista previa de un HTML del proyecto. Se pinta en un iframe con `sandbox=""`,
 * o sea sin scripts ni formularios: vale para ver maquetas y salidas estáticas.
 * Lo que necesite JavaScript se abre en el navegador real con el botón de al lado
 * — dentro de la app no se le da permiso para ejecutar nada.
 *
 * Esto no es un navegador embebido: un iframe no puede cargar webs de fuera por
 * X-Frame-Options y CSP de terceros, así que el alcance es deliberadamente el
 * archivo local.
 */
export default function HtmlPreview({
  projectId,
  raiz,
  onCerrar,
}: {
  projectId: string;
  /** Raíz del proyecto en disco: hace falta para abrir el archivo en el navegador. */
  raiz: string;
  onCerrar: () => void;
}) {
  const [opciones, setOpciones] = useState<string[]>([]);
  const [archivo, setArchivo] = useState("");
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    void invoke<string[]>("search_project_files", { projectId, query: ".html" })
      .then((v) => {
        // `search_project_files` busca por subcadena en el nombre, no por
        // extensión: «index.htm» o «html_tips.md» también salen.
        const vistas = v.filter((p) => /\.x?html?$/i.test(p));
        setOpciones(vistas);
        setArchivo((prev) => prev || vistas[0] || "");
      })
      .catch(() => setOpciones([]));
  }, [projectId, nonce]);

  useEffect(() => {
    if (!archivo) {
      setHtml(null);
      return;
    }
    let vivo = true;
    setCargando(true);
    setError(null);
    void invoke<string>("read_project_file", { projectId, path: archivo }).then(
      (c) => {
        if (!vivo) return;
        setHtml(c);
        setCargando(false);
      },
      (e) => {
        if (!vivo) return;
        setHtml(null);
        setError(String(e));
        setCargando(false);
      }
    );
    return () => {
      vivo = false;
    };
  }, [projectId, archivo, nonce]);

  return (
    <aside className="w-[420px] shrink-0 flex flex-col border-l border-base-border bg-base-raised/40">
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-base-border">
        <Eye className="w-4 h-4 text-accent-soft shrink-0" />
        <span className="text-xs font-medium text-zinc-300 uppercase tracking-wider">
          {t("Vista previa")}
        </span>
        <button
          onClick={() => setNonce((n) => n + 1)}
          title={t("Volver a leer")}
          className="ml-auto p-1 rounded text-zinc-500 hover:text-layer hover:bg-base transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${cargando ? "animate-spin" : ""}`} />
        </button>
        <button
          onClick={onCerrar}
          title={t("Cerrar")}
          className="p-1 rounded text-zinc-500 hover:text-layer hover:bg-base transition-colors"
        >
          ×
        </button>
      </div>

      <div className="px-3 py-2 space-y-1.5 border-b border-base-border">
        <select
          value={archivo}
          onChange={(e) => setArchivo(e.target.value)}
          className="w-full rounded-lg border border-base-border bg-base px-2 py-1.5 text-xs outline-none focus:border-accent/70"
        >
          {opciones.length === 0 && <option value="">{t("(sin archivos HTML)")}</option>}
          {opciones.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <button
          onClick={() =>
            archivo &&
            void openUrl(
              // El separador de una URL file:// es «/» incluso en Windows, y la
              // raíz llega con barras invertidas.
              `file:///${[
                raiz.replace(/\\/g, "/").replace(/\/+$/, ""),
                ...archivo.split(/[\\/]+/),
              ].join("/")}`
            )
          }
          disabled={!archivo}
          className="flex items-center gap-1.5 text-[11px] text-zinc-400 hover:text-layer disabled:opacity-40 transition-colors"
          title={t("Ábrelo en el navegador si necesita JavaScript")}
        >
          <ExternalLink className="w-3 h-3" />
          {t("Abrir en el navegador")}
        </button>
      </div>

      <div className="flex-1 min-h-0 bg-white">
        {error ? (
          <p className="p-3 text-xs text-red-400">{error}</p>
        ) : html === null ? (
          <p className="p-3 text-xs text-zinc-500">
            {opciones.length === 0
              ? t("Este proyecto no tiene ningún .html que previsualizar.")
              : t("Cargando…")}
          </p>
        ) : (
          <iframe
            title={t("Vista previa")}
            srcDoc={html}
            // Vacío del todo: sin scripts, sin formularios, sin mismo-origen.
            sandbox=""
            className="w-full h-full border-0"
          />
        )}
      </div>
    </aside>
  );
}
