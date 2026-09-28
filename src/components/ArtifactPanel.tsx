import { t } from "../i18n";
import { useMemo, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  PanelRightClose,
} from "lucide-react";
import { useChatStore } from "../store/chatStore";
import { resaltar } from "../highlight";
import { fmtDate } from "../time";
import ResizeHandle from "./work/ResizeHandle";

/** Extensión con la que se baja cada lenguaje. Lo que no está aquí sale como
 *  `.txt`: mejor un archivo que abre cualquier editor que uno que no se reconoce. */
const EXTENSIONES: Record<string, string> = {
  html: "html",
  css: "css",
  js: "js",
  jsx: "jsx",
  ts: "ts",
  tsx: "tsx",
  json: "json",
  rust: "rs",
  python: "py",
  bash: "sh",
  sh: "sh",
  sql: "sql",
  svg: "svg",
  toml: "toml",
  yaml: "yml",
  markdown: "md",
  md: "md",
};

/** Nombre con el que se guarda un bloque: la primera línea con contenido, que
 *  es donde un `<html>`, un `# Título` o un `func main()` dicen qué es. Si no
 *  hay manera de sacarlo, queda «Sin título». */
export function tituloDeBloque(codigo: string): string {
  const linea = codigo
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!linea) return t("Sin título");
  const limpio = linea.replace(/^[#/*>\s]+/, "").trim();
  return limpio.length > 46 ? `${limpio.slice(0, 46)}…` : limpio || t("Sin título");
}

/** Vale la pena abrirlo en el panel: un `x = 1` no, un documento o un bloque
 *  largo sí. El umero de líneas es lo que separa el ejemplo suelto del
 *  entregable, y es lo que usa el propio plan de fases. */
export function merecePanel(lang: string, codigo: string): boolean {
  const lenguaje = lang.toLowerCase();
  if (["html", "svg", "markdown", "md", "css"].includes(lenguaje)) return true;
  return codigo.split("\n").length >= 12;
}

function Contenido() {
  const abierto = useChatStore((s) => s.artefactoAbierto);
  const artefactos = useChatStore((s) => s.artefactos);
  const ver = useChatStore((s) => s.verArtefacto);
  const cerrar = useChatStore((s) => s.cerrarArtefacto);
  const [copiado, setCopiado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const versiones = useMemo(() => {
    if (!abierto) return [];
    return artefactos.filter(
      (a) => a.titulo === abierto.titulo && a.lenguaje === abierto.lenguaje,
    );
  }, [artefactos, abierto]);

  const lineas = useMemo(
    () => (abierto ? resaltar(abierto.contenido, abierto.lenguaje) : []),
    [abierto],
  );

  if (!abierto) return null;
  const i = versiones.findIndex((v) => v.id === abierto.id);

  const copia = async () => {
    try {
      await navigator.clipboard.writeText(abierto.contenido);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch {
      setAviso(t("El portapapeles no está disponible."));
    }
  };

  // Se baja con un blob del propio documento, no con un comando nuevo que
  // escriba «esta ruta con este contenido»: ese comando sería un agujero —lo
  // llamaría cualquier script que llamara a `invoke()` desde dentro de un
  // iframe—, y aquí no hace falta: el archivo lo pide el navegador.
  const descarga = () => {
    const ext = EXTENSIONES[abierto.lenguaje.toLowerCase()] ?? "txt";
    const base =
      abierto.titulo.replace(/[\\/:*?"<>|]/g, "_").slice(0, 60) || "artifacto";
    const cabecera =
      ["html", "svg", "markdown", "md", "css"].includes(abierto.lenguaje.toLowerCase())
        ? `<!-- ${abierto.titulo} · v${abierto.version} · Hatboo -->\n`
        : `// ${abierto.titulo} · v${abierto.version} · Hatboo\n`;
    const url = URL.createObjectURL(
      new Blob([cabecera + abierto.contenido], { type: "text/plain;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${base}.${ext}`;
    a.click();
    // El objeto vive en memoria hasta que el navegador lo descargue.
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  const botonera =
    "grid h-6 w-6 place-items-center rounded-md text-zinc-500 transition-colors hover:bg-base-hover hover:text-zinc-200 disabled:opacity-30";

  return (
    <div className="flex h-full min-h-0 flex-col bg-base-raised">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-base-border px-2.5 py-2">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-200" title={abierto.titulo}>
          {abierto.titulo}
        </span>
        <span className="shrink-0 rounded-chip bg-accent/[0.14] px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-accent-soft">
          {abierto.lenguaje}
        </span>
        {versiones.length > 1 && (
          <span className="flex shrink-0 items-center gap-0.5">
            <button
              onClick={() => i > 0 && ver(versiones[i - 1].id)}
              disabled={i <= 0}
              title={t("Versión anterior")}
              className={botonera}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="text-[10px] tabular-nums text-zinc-500">
              v{abierto.version}
            </span>
            <button
              onClick={() => i < versiones.length - 1 && ver(versiones[i + 1].id)}
              disabled={i >= versiones.length - 1}
              title={t("Versión siguiente")}
              className={botonera}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </span>
        )}
        <button
          onClick={() => void copia()}
          title={copiado ? t("Copiado") : t("Copiar el artifacto")}
          className={botonera}
        >
          {copiado ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={() => void descarga()}
          title={t("Descargar como archivo")}
          className={botonera}
        >
          <Download className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={cerrar}
          title={t("Cerrar el panel")}
          className={botonera}
        >
          <PanelRightClose className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-base-code px-3 py-2">
        <pre className="font-mono leading-relaxed text-zinc-200" style={{ fontSize: "calc(var(--chat-fs, 15px) - 2px)" }}>
          <div className="flex">
            <div
              aria-hidden
              className="mr-3 shrink-0 select-none text-right tabular-nums text-zinc-600"
            >
              {lineas.map((_, n) => (
                <div key={n}>{n + 1}</div>
              ))}
            </div>
            <code className="min-w-0">
              {lineas.map((piezas, n) => (
                <div key={n} className="whitespace-pre">
                  {piezas.map((p, j) =>
                    p.clase ? (
                      <span key={j} className={p.clase}>
                        {p.texto}
                      </span>
                    ) : (
                      <span key={j}>{p.texto}</span>
                    ),
                  )}
                  {piezas.length === 0 && " "}
                </div>
              ))}
            </code>
          </div>
        </pre>
      </div>

      <div className="shrink-0 space-y-1 border-t border-base-border px-2.5 py-2">
        {aviso && <p className="text-[11px] leading-snug text-zinc-400">{aviso}</p>}
        <p className="text-[10px] text-zinc-600">
          {t("{n} líneas · v{v} · {cuando}", {
            n: lineas.length,
            v: abierto.version,
            cuando: fmtDate(abierto.creadoEn),
          })}
        </p>
        {artefactos.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {artefactos.map((a) => (
              <button
                key={a.id}
                onClick={() => ver(a.id)}
                title={`${a.titulo} · ${a.lenguaje} · v${a.version}`}
                className={`max-w-full truncate rounded-chip border px-1.5 py-0.5 text-[10px] transition-colors ${
                  a.id === abierto.id
                    ? "border-accent/50 bg-accent/[0.14] text-accent-soft"
                    : "border-base-border text-zinc-500 hover:bg-base-hover hover:text-zinc-200"
                }`}
              >
                {a.titulo} v{a.version}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** El panel en sí: tirador + columna. Se monta al lado del chat y se va con lo
 *  que haya dentro, así que el ancho vive aquí y no en `App`. No se guarda entre
 *  sesiones: para eso haría falta una preferencia nueva, y preferí no inventarla.
 */
export default function ArtifactPanel() {
  const abierto = useChatStore((s) => s.artefactoAbierto);
  const [px, setPx] = useState(420);
  if (!abierto) return null;
  return (
    <>
      <ResizeHandle
        width={px}
        min={280}
        max={900}
        def={420}
        side="right"
        onWidth={setPx}
        onCommit={setPx}
      />
      <div
        className="shrink-0 overflow-clip border-l border-base-border"
        style={{ width: px }}
      >
        <Contenido />
      </div>
    </>
  );
}
