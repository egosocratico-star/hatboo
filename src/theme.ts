
import type { ThemeId } from "./temas";

export type { ThemeId as ThemeChoice };

const STORED = "hatboo-theme";
const STORED_MOTION = "hatboo-motion";
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

/**
 * `reduced` pone el atributo que apaga animaciones y transiciones; `system` no
 * pone nada y deja que decida el `prefers-reduced-motion` del SO (index.css).
 * Se guarda en localStorage por lo mismo que el tema: antes del primer `invoke`.
 */
export function applyMotion(choice: string): void {
  const root = document.documentElement;
  if (choice === "reduced") root.dataset.motion = "reduced";
  else delete root.dataset.motion;
  try {
    localStorage.setItem(STORED_MOTION, choice === "reduced" ? "reduced" : "system");
  } catch {
    // Sin almacenamiento la preferencia de esta sesión sigue aplicándose.
  }
}
