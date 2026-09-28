import type { LocalModel } from "./types";

/** Para qué da un modelo local, según los parámetros que declara Ollama. */
export type NivelModelo = "chat" | "codigo" | "agente";

export const NIVELES: Record<NivelModelo, { corto: string; aviso: string; clases: string }> = {
  chat: {
    corto: "chat",
    aviso: "Da para charla rápida. Para que toque archivos de un proyecto se queda corto.",
    clases: "bg-amber-500/15 text-amber-300",
  },
  codigo: {
    corto: "código",
    aviso: "Da para explicar y escribir código. Para un agente que lea, escriba y ejecute, mejor 7B o más.",
    clases: "bg-sky-500/15 text-sky-300",
  },
  agente: {
    corto: "agente",
    aviso: "Con este tamaño el agente ya mueve archivos y herramientas dentro del proyecto.",
    clases: "bg-emerald-500/15 text-emerald-300",
  },
};

/** Ollama ofrece modelos que no bajan a tu disco: los ejecuta en su nube y el
 *  nombre lo avisa (`nemotron-3-ultra:cloud`, `gpt-oss:120b-cloud`). */
export function esNube(nombre: string): boolean {
  return /(^|[:_-])cloud\b/i.test(nombre);
}

/** De lo que Ollama declara, solo esto le dice algo al usuario:
 *  «completion», «insert» o «embedding» no se pintan. */
export function capsVisibles(capabilities: string[]): string[] {
  return capabilities.filter((c) => c === "vision" || c === "tools");
}

/** Si la respuesta va a salir del equipo: cualquier API, o un modelo `:cloud`. */
export function saleDelEquipo(proveedor: string, modelo: string): boolean {
  return proveedor !== "local" || esNube(modelo);
}

function nivelDesdeParametros(p: number | null): NivelModelo | null {
  if (p === null || !Number.isFinite(p) || p <= 0) return null;
  if (p >= 7) return "agente";
  if (p >= 2.5) return "codigo";
  return "chat";
}

/** Ollama los escribe como «7.6B»; sin ese dato no hay semáforo que enseñar. */
export function nivelModelo(m: LocalModel): NivelModelo | null {
  return nivelDesdeParametros(parseFloat(m.parameterSize));
}

/** Para cuando solo está el nombre (`qwen3.5:0.8b`): el tamaño suele venir en la etiqueta. */
export function nivelPorNombre(nombre: string): NivelModelo | null {
  const m = /[:-](\d+(?:[.,]\d+)?)b(?![a-z])/i.exec(nombre);
  return m ? nivelDesdeParametros(parseFloat(m[1].replace(",", "."))) : null;
}
