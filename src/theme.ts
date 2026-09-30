
import type { ThemeId } from "./temas";

export type { ThemeId as ThemeChoice };

const STORED = "hatboo-theme";
const STORED_DENSIDAD = "hatboo-densidad";
const STORED_ACENTO = "hatboo-acento";
const LIGHT = "(prefers-color-scheme: light)";

function prefersLight(): boolean {
  return typeof window !== "undefined" && window.matchMedia(LIGHT).matches;
}

/**
 * `system` es el único que se resuelve a otro: el resto de identificadores son
 * paletas que existen tal cual en `index.css`. Antes esta función solo devolvía
 * `dark` o `light`, así que cualquier paleta nueva se venía abajo al oscuro.
 */
function resolve(choice: string): string {
  if (choice === "system") return prefersLight() ? "light" : "dark";
  return choice || "dark";
}

/**
 * Pinta el tema elegido. Guarda además el resultado en localStorage para que
 * index.html lo aplique antes del primer fotograma: leer `settings` cuesta un
 * `invoke` a SQLite y sin eso la ventana se abría en negro de golpe.
 */
export function applyTheme(choice: string): void {
  const theme = resolve(choice);
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORED, theme);
  } catch {
    // Sin almacenamiento disponible el tema sigue pintándose.
  }
}

/** Con `system` el SO puede cambiar mientras la app está abierta. */
export function watchSystemTheme(choice: string): () => void {
  if (choice !== "system") return () => {};
  const mq = window.matchMedia(LIGHT);
  const onChange = () => applyTheme("system");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

const PX_POR_DENSIDAD: Record<string, number> = { comoda: 16, compacta: 14.5 };

/** Densidad = tamaño de letra base del documento. El espaciado de Tailwind se
 *  mide en `rem`, así que esto compacta la interfaz entera de una vez; cambiar
 *  el `px` de cada burbuja no lo hacía. `comoda` no pone nada: es el 16 de
 *  serie, y así no hay que andarlo quitando. */
export function applyDensity(choice: string): void {
  const px = PX_POR_DENSIDAD[choice];
  if (px && px !== 16) document.documentElement.style.fontSize = `${px}px`;
  else document.documentElement.style.removeProperty("font-size");
  try {
    localStorage.setItem(STORED_DENSIDAD, choice === "compacta" ? "compacta" : "comoda");
  } catch {
    // Sin almacenamiento se pinta igual; se pierde al reopen.
  }
}

/** Acento por encima de la paleta. `violeta` = el de cada paleta, y se quita el
 *  atributo para que los bloques `[data-acento]` no tapen lo que ya traía. */
export function applyAccent(choice: string): void {
  const root = document.documentElement;
  if (choice && choice !== "violeta") root.dataset.acento = choice;
  else delete root.dataset.acento;
  try {
    localStorage.setItem(STORED_ACENTO, choice || "violeta");
  } catch {
    // Idem.
  }
}
