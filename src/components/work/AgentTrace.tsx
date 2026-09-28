import { useState } from "react";
import {
  FileCode2,
  FileText,
  FolderOpen,
  GitBranch,
  GitCommit,
  GitCompare,
  History,
  Image as ImageIcon,
  ListChecks,
  Globe,
  Search,
  Terminal,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import { t } from "../../i18n";
import type { StepLine } from "../../store/workStore";
import CommandBlock from "./CommandBlock";
import DiffView from "../DiffView";
import ThinkingBlock from "../ThinkingBlock";
import Dots from "../Dots";

/** Qué pinta cada tool: icono, y cómo se dice una y varias de seguida. */
const TOOLS: Record<
  string,
  { icono: LucideIcon; uno: (b: string) => string; varias: (n: number) => string }
> = {
  read_file: {
    icono: FileText,
    uno: (b) => (b ? t("Leyó {b}", { b }) : t("Leyó un archivo")),
    varias: (n) => t("Leyó {n} archivos", { n }),
  },
  list_dir: {
    icono: FolderOpen,
    uno: (b) => (b ? t("Listó {b}", { b }) : t("Listó una carpeta")),
    varias: (n) => t("Listó {n} carpetas", { n }),
  },
  search_files: {
    icono: Search,
    uno: (b) => (b ? t("Buscó {b}", { b }) : t("Buscó en los archivos")),
    varias: (n) => t("Ejecutó {n} búsquedas", { n }),
  },
  web_search: {
    icono: Globe,
    uno: (b) => (b ? t("Buscó en la web {b}", { b }) : t("Buscó en la web")),
    varias: (n) => t("{n} búsquedas web", { n }),
  },
  write_file: {
    icono: FileCode2,
    uno: (b) => (b ? t("Escribió {b}", { b }) : t("Escribió un archivo")),
    varias: (n) => t("Escribió {n} archivos", { n }),
  },
  generate_image: {
    icono: ImageIcon,
    uno: (b) => (b ? t("Dibujó {b}", { b }) : t("Generó una imagen")),
    varias: (n) => t("Generó {n} imágenes", { n }),
  },
  run_command: {
    icono: Terminal,
    uno: (b) => (b ? t("Ejecutó {b}", { b }) : t("Ejecutó un comando")),
    varias: (n) => t("Ejecutó {n} comandos", { n }),
  },
  git_status: { icono: GitBranch, uno: () => "git status", varias: (n) => `git status ×${n}` },
  git_diff: { icono: GitCompare, uno: () => "git diff", varias: (n) => `git diff ×${n}` },
  git_log: { icono: History, uno: () => "git log", varias: (n) => `git log ×${n}` },
  git_commit: { icono: GitCommit, uno: () => "git commit", varias: (n) => `git commit ×${n}` },
  update_step: {
    icono: ListChecks,
    uno: (b) => (b ? t("Plan: {b}", { b }) : t("Actualizó el plan")),
    varias: (n) => t("Actualizó el plan {n} veces", { n }),
  },
};

const POR_DEFECTO = {
  icono: Search,
  uno: (b: string) => (b ? `${b}` : t("Usó una herramienta")),
  varias: (n: number) => t("{n} llamadas de herramienta", { n }),
};

function duracion(ms: number) {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/** El tiempo siempre en mono: alineado a la derecha, si no, las cifras bailan. */
function Tiempo({ ms }: { ms: number }) {
  return (
    <span className="shrink-0 font-mono text-[11px] tabular-nums text-zinc-600">
      {duracion(ms)}
    </span>
  );
}

/** La ruta o el nombre de archivo, en chip mono: es lo que se lee de una línea. */
const CHIP_RUTA =
  "rounded border border-base-border bg-base-raised px-1 py-px font-mono text-[11px] text-accent-soft";

/** ✓ o ✗ al principio del paso: el estado de un vistazo, sin leer la frase. */
function Hecho({ ok }: { ok: boolean }) {
  return (
    <span
      className={`w-3 shrink-0 text-center font-mono text-[11px] ${
        ok ? "text-emerald-400" : "text-red-400"
      }`}
      title={ok ? t("Salió bien") : t("Falló")}
    >
      {ok ? "✓" : "✗"}
    </span>
  );
}

/** La frase del paso con la ruta en chip. */
function conRuta(texto: string, ruta: string) {
  const i = ruta ? texto.indexOf(ruta) : -1;
  if (i < 0) return texto;
  return (
    <>
      {texto.slice(0, i)}
      <code className={CHIP_RUTA}>{ruta}</code>
      {texto.slice(i + ruta.length)}
    </>
  );
}

/** La frase de un paso: un `write_file` que creó el archivo se dice «Creó», no
 *  «Escribió». */
function frasePaso(tool: string, brief: string, creado: boolean) {
  const meta = TOOLS[tool] ?? POR_DEFECTO;
  if (tool === "write_file" && creado) {
    return brief ? t("Creó {b}", { b: brief }) : t("Creó un archivo");
  }
  return meta.uno(brief);
}

function fraseGrupo(tool: string, cuenta: number, creado: boolean) {
  const meta = TOOLS[tool] ?? POR_DEFECTO;
  if (tool === "write_file" && creado) return t("Creó {n} archivos", { n: cuenta });
  return meta.varias(cuenta);
}

/** Un paso suelto, o varios del mismo tipo agrupados en una línea. Los archivos
 *  creados no se mezclan con los modificados: son dos cosas que hizo el agente. */
type Fila =
  | { kind: "paso"; line: StepLine }
  | { kind: "grupo"; tool: string; creado: boolean; cuenta: number; total: number; fallo: boolean };
function agrupar(lines: StepLine[]): Fila[] {
  const filas: Fila[] = [];
  for (const line of lines) {
    if (line.data || line.reasoning || line.diff) {
      filas.push({ kind: "paso", line });
      continue;
    }
    const ultimo = filas[filas.length - 1];
    if (
      ultimo &&
      ultimo.kind === "grupo" &&
      ultimo.tool === line.toolName &&
      ultimo.creado === !!line.creado
    ) {
      ultimo.cuenta += 1;
      ultimo.total += line.durationMs;
      ultimo.fallo = ultimo.fallo || !line.ok;
    } else if (
      ultimo &&
      ultimo.kind === "paso" &&
      !ultimo.line.data &&
      !ultimo.line.reasoning &&
      ultimo.line.toolName === line.toolName &&
      !!ultimo.line.creado === !!line.creado
    ) {
      filas[filas.length - 1] = {
        kind: "grupo",
        tool: line.toolName,
        creado: !!line.creado,
        cuenta: 2,
        total: ultimo.line.durationMs + line.durationMs,
        fallo: !ultimo.line.ok || !line.ok,
      };
    } else {
      filas.push({ kind: "paso", line });
    }
  }
  return filas;
}

/**
 * De qué trata realmente la traza. Contar los milisegundos salía en «Trabajó
 * por 0 ms» justo cuando el modelo no había tocado nada: el tiempo no distingue
 * entre trabajar y fingir, las herramientas sí. Y «Escribió 1» se leía sin
 * saber de qué: mejor «1 archivo escrito».
 */
function resumen(lines: StepLine[]) {
  const cuenta = (...tools: string[]) =>
    lines.filter((l) => tools.includes(l.toolName)).length;
  const partes: string[] = [];
  // Las frases van escritas con `t()` en el sitio, no pasadas como variables a
  // un helper: el barrido de i18n solo ve los literales.
  const escritos = cuenta("write_file");
  const creados = lines.filter((l) => l.toolName === "write_file" && l.creado).length;
  const modificados = escritos - creados;
  if (creados === 1) partes.push(t("{n} archivo creado", { n: creados }));
  else if (creados > 1) partes.push(t("{n} archivos creados", { n: creados }));
  if (modificados === 1) partes.push(t("{n} archivo modificado", { n: modificados }));
  else if (modificados > 1) partes.push(t("{n} archivos modificados", { n: modificados }));
  const leidos = cuenta("read_file", "list_dir", "search_files", "web_search");
  if (leidos === 1) partes.push(t("{n} lectura", { n: leidos }));
  else if (leidos > 1) partes.push(t("{n} lecturas", { n: leidos }));
  const comandos = cuenta("run_command");
  if (comandos === 1) partes.push(t("{n} comando", { n: comandos }));
  else if (comandos > 1) partes.push(t("{n} comandos", { n: comandos }));
  const git = cuenta("git_status", "git_diff", "git_log", "git_commit");
  if (git === 1) partes.push(t("{n} consulta de git", { n: git }));
  else if (git > 1) partes.push(t("{n} consultas de git", { n: git }));
  return partes.length > 0
    ? { texto: partes.join(" · "), vacio: false }
    : { texto: t("Sin herramientas"), vacio: true };
}

export default function AgentTrace({
  lines,
  running = false,
}: {
  lines: StepLine[];
  running?: boolean;
}) {
  // Nace abierta mientras se está trabajando y cerrada cuando es la traza de una
  // respuesta ya terminada: la línea de resumen dice lo que hizo, y el detalle se
  // abre si hace falta.
  const [abierto, setAbierto] = useState(running);
  if (lines.length === 0) return null;

  const msTotal = lines.reduce((acc, l) => acc + l.durationMs, 0);
  const fallos = lines.filter((l) => !l.ok).length;
  const filas = agrupar(lines);
  const { texto, vacio } = resumen(lines);

  return (
    <div className="max-w-full">
      {/* Píldora: no ocupa el ancho de la pantalla. El `>_` en mono es la señal
          de «aquí está el proceso», en vez de otro icono decorativo. */}
      <button
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="inline-flex max-w-full items-center gap-2 rounded-[10px] border border-base-border bg-base-card px-2.5 py-1 text-left text-xs text-zinc-400 transition-colors hover:border-accent/40 hover:text-zinc-200"
      >
        {running ? (
          <Dots />
        ) : (
          <span
            className={`shrink-0 font-mono text-[11px] font-semibold ${
              vacio ? "text-amber-400" : "text-accent-soft"
            }`}
          >
            &gt;_
          </span>
        )}
        <span className={`min-w-0 truncate ${vacio && !running ? "text-amber-400/90" : ""}`}>
          {running ? t("Trabajando · {r}", { r: texto }) : texto}
        </span>
        {!running && msTotal > 0 && (
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-zinc-600">
            · {duracion(msTotal)}
          </span>
        )}
        {fallos > 0 && (
          <span className="shrink-0 text-[10px] text-red-400/80">
            {t("{n} fallaron", { n: fallos })}
          </span>
        )}
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${abierto ? "rotate-180" : ""}`}
        />
      </button>

      {abierto && (
        <div className="ml-[10px] mt-1.5 space-y-1 border-l border-base-border pl-3.5">
          {filas.map((fila, i) => {
            if (fila.kind === "grupo") {
              const meta = TOOLS[fila.tool] ?? POR_DEFECTO;
              const Icono = meta.icono;
              return (
                <div key={i} className="flex items-center gap-2 py-0.5 text-[12px]">
                  <Hecho ok={!fila.fallo} />
                  <Icono className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                  <span className={`min-w-0 flex-1 truncate ${fila.fallo ? "text-red-300" : "text-zinc-400"}`}>
                    {fraseGrupo(fila.tool, fila.cuenta, fila.creado)}
                  </span>
                  {fila.total > 0 && <Tiempo ms={fila.total} />}
                </div>
              );
            }
            const l = fila.line;
            if (l.reasoning) return <ThinkingBlock key={i} reasoning={l.reasoning} />;
            if (l.data)
              return <CommandBlock key={i} data={l.data} ok={l.ok} durationMs={l.durationMs} />;
            const meta = TOOLS[l.toolName] ?? POR_DEFECTO;
            const Icono = meta.icono;
            return (
              <div key={i}>
                <div className="flex items-center gap-2 py-0.5 text-[12px]">
                  <Hecho ok={l.ok} />
                  <Icono className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                  <span
                    className={`min-w-0 flex-1 truncate ${l.ok ? "text-zinc-400" : "text-red-300"}`}
                    title={l.brief}
                  >
                    {conRuta(frasePaso(l.toolName, l.brief, !!l.creado), l.brief)}
                  </span>
                  {l.durationMs > 0 && <Tiempo ms={l.durationMs} />}
                </div>
                {l.diff && (
                  <div className="mb-1 mt-0.5 ml-[26px]">
                    <DiffView diff={l.diff} altoMax={190} corte={60} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
