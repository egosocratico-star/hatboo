import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  Check,
  Copy,
  FileCode2,
  File as FileIcon,
  FileText,
  FolderOpen,
  Image as ImageIcon,
} from "lucide-react";
import { t, useT } from "../../i18n";
import type { StepLine } from "../../types";

interface Meta {
  size: number;
  mtime: number;
}

function es(nombre: string, exts: string[]): boolean {
  const ext = nombre.split(".").pop()?.toLowerCase() ?? "";
  return exts.includes(ext);
}

function etiqueta(nombre: string): string {
  if (es(nombre, ["txt", "md", "doc", "docx", "rtf", "odt"])) return t("Texto");
  if (es(nombre, ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"])) return t("Imagen");
  if (es(nombre, ["pdf"])) return t("PDF");
  if (
    es(nombre, [
      "ts", "tsx", "js", "jsx", "rs", "py", "go", "java", "c", "cpp", "h",
      "json", "html", "css", "sql", "sh", "toml", "yml", "yaml",
    ])
  )
    return t("Código");
  return t("Archivo");
}

function Icono({ nombre }: { nombre: string }) {
  const clases = "h-4 w-4 shrink-0 text-accent-soft";
  if (etiqueta(nombre) === t("Imagen")) return <ImageIcon className={clases} />;
  if (etiqueta(nombre) === t("Código")) return <FileCode2 className={clases} />;
  if (etiqueta(nombre) === t("Texto")) return <FileText className={clases} />;
  return <FileIcon className={clases} />;
}

/** Las unidades no se traducen: B/KB/MB se leen igual en los dos idiomas. */
function tamano(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function Tarjeta({
  ruta,
  projectId,
  rootPath,
}: {
  ruta: string;
  projectId: string;
  rootPath: string;
}) {
  const [meta, setMeta] = useState<Meta | "gone" | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let vivo = true;
    void invoke<Meta>("file_meta", { projectId, ruta }).then(
      (m) => vivo && setMeta(m),
      () => vivo && setMeta("gone"),
    );
    return () => {
      vivo = false;
    };
  }, [projectId, ruta]);

  const nombre = ruta.split(/[\\/]/).pop() ?? ruta;
  // El agente manda rutas relativas, pero si se le cuela una absoluta no hay que
  // pegarle la raíz delante.
  const absoluta = /^[a-z]:[\\/]/i.test(ruta) || ruta.startsWith("/")
    ? ruta
    : `${rootPath}\\${ruta.replace(/\//g, "\\")}`;

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(absoluta);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // portapapeles no disponible: ignorar
    }
  };

  return (
    <div className="flex items-center gap-3 rounded-xl border border-base-border bg-base-card px-3 py-2.5">
      <Icono nombre={nombre} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-zinc-200">{nombre}</p>
        <p className="truncate text-[11px] text-zinc-500">
          {meta === "gone"
            ? t("El archivo ya no existe en disco")
            : meta
              ? `${etiqueta(nombre)} · ${tamano(meta.size)}`
              : etiqueta(nombre)}
        </p>
      </div>
      <button
        title={t("Mostrar en la carpeta")}
        aria-label={t("Mostrar en la carpeta")}
        disabled={meta === "gone"}
        onClick={() => void revealItemInDir(absoluta).catch(() => {})}
        className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-base-hover hover:text-zinc-100 disabled:opacity-40"
      >
        <FolderOpen className="h-3.5 w-3.5" />
      </button>
      <button
        title={copied ? t("Ruta copiada") : t("Copiar ruta")}
        aria-label={copied ? t("Ruta copiada") : t("Copiar ruta")}
        onClick={() => void copiar()}
        className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-base-hover hover:text-zinc-100"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

/** Lo que esta respuesta escribió de verdad, con su tamaño de ahora mismo: el
 *  archivo vive en tu disco, así que «descargar» no aplica; abrir la carpeta y
 *  copiar la ruta sí. Sale bajo la traza de la respuesta que lo cerró. */
export default function FileCards({
  steps,
  projectId,
  rootPath,
}: {
  steps?: StepLine[];
  projectId: string;
  rootPath: string;
}) {
  useT();
  const rutas = [
    ...new Set(
      (steps ?? [])
        .filter((s) => s.toolName === "write_file" && s.ok && s.ruta)
        .map((s) => s.ruta as string),
    ),
  ];
  if (rutas.length === 0) return null;
  return (
    <div className="space-y-2">
      {rutas.map((r) => (
        <Tarjeta key={r} ruta={r} projectId={projectId} rootPath={rootPath} />
      ))}
    </div>
  );
}
