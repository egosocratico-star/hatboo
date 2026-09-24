import { useSyncExternalStore } from "react";
import { en } from "./i18n-en";

export type Idioma = "es" | "en";
export type EleccionIdioma = "system" | Idioma;

/** El texto de la interfaz está escrito en español y la clave de la traducción es
 *  ese mismo texto: así, si una cadena se queda sin traducir se ve en español en
 *  vez de ver su código, y añadir un idioma nuevo no obliga a renombrar nada. */
let actual: Idioma = "es";
const oyentes = new Set<() => void>();

function notificar() {
  oyentes.forEach((fn) => fn());
}

/** `system` pregunta por el idioma del navegador, que en WebView2 sigue el que
 *  tenga Windows. */
export function resuelveIdioma(eleccion: EleccionIdioma): Idioma {
  if (eleccion !== "system") return eleccion;
  const preferido = navigator.language || "es";
  return preferido.toLowerCase().startsWith("en") ? "en" : "es";
}

export function setLanguage(eleccion: EleccionIdioma) {
  const nuevo = resuelveIdioma(eleccion);
  document.documentElement.lang = nuevo;
  if (nuevo === actual) return;
  actual = nuevo;
  notificar();
}

export function currentLanguage(): Idioma {
  return actual;
}

function subscribe(fn: () => void) {
  oyentes.add(fn);
  return () => oyentes.delete(fn);
}

/**
 * Traduce una cadena de la interfaz. Las variables van entre llaves
 * (`{n}`) y se sustituyen aquí mismo, porque medio traducir una frase con
 * números dentro sale peor que no traducirla.
 */
export function t(texto: string, variables?: Record<string, string | number | null | undefined>): string {
  let salida = actual === "en" ? en[texto] ?? texto : texto;
  if (variables) {
    for (const [clave, valor] of Object.entries(variables)) {
      salida = salida.replaceAll(`{${clave}}`, valor == null ? "" : String(valor));
    }
  }
  return salida;
}

/** Hook: devuelve `t` y re-renderiza el componente cuando cambia el idioma. */
export function useT(): typeof t {
  useSyncExternalStore(subscribe, () => actual);
  return t;
}
