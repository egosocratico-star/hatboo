import type { Skill } from "./types";

/** La regla de «escribe `/` en el compositor y aparece la lista de plantillas».
 *  Vive aparte del componente para poder probarse con `npm run prueba-slash`. */
export interface Raiz {
  /** Posición de la barra que abre la orden. */
  desde: number;
  /** Lo escrito después: filtra la lista. */
  consulta: string;
}

/** ¿Está el caret dentro de una `/`-orden? `null` si no, para que un `https://`
 *  o una ruta Windows no abran el pop-up en medio de un texto. */
export function raizSlash(texto: string, caret: number): Raiz | null {
  const hasta = texto.slice(0, Math.max(0, Math.min(caret, texto.length)));
  const i = hasta.lastIndexOf("/");
  if (i < 0) return null;
  const antes = i === 0 ? "" : hasta[i - 1];
  // La barra tiene que empezar la palabra: principio del texto, tras un espacio
  // o tras un salto de línea.
  if (antes && !/\s/.test(antes)) return null;
  // Y tiene que venir pegada a lo escrito: «3 / 2» es una división, no una orden.
  const despues = hasta[i + 1];
  if (despues === " " || despues === "\n") return null;
  const consulta = hasta.slice(i + 1);
  if (consulta.includes("\n")) return null;
  return { desde: i, consulta };
}

export function filtraSkills<T extends { name: string }>(skills: T[], consulta: string): T[] {
  const q = consulta.toLowerCase().trim();
  if (!q) return skills;
  return skills.filter((s) => s.name.toLowerCase().includes(q));
}

/** Qué se sustituye al elegir: la `/orden` entera, no el texto completo. */
export function aplicarSlash(
  texto: string,
  caret: number,
  raiz: Raiz,
  insercion: string,
): { texto: string; caret: number } {
  const nuevo = texto.slice(0, raiz.desde) + insercion + texto.slice(caret);
  return { texto: nuevo, caret: raiz.desde + insercion.length };
}

/** Las que se enseñan: el compositor no se puede convertir en una lista de 40. */
export const MAX_SLASH = 6;

export function opciones(skills: Skill[], raiz: Raiz | null): Skill[] {
  if (!raiz) return [];
  return filtraSkills(skills, raiz.consulta).slice(0, MAX_SLASH);
}
