import { invoke } from "@tauri-apps/api/core";

export type ThemeChoice = "dark" | "light" | "system";

const STORED = "hatboo-theme";
const STORED_MOTION = "hatboo-motion";
const LIGHT = "(prefers-color-scheme: light)";

function prefersLight(): boolean {
  return typeof window !== "undefined" && window.matchMedia(LIGHT).matches;
}

function resolve(choice: string): "dark" | "light" {
  if (choice === "light") return "light";
  if (choice === "system") return prefersLight() ? "light" : "dark";
  return "dark";
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

/**
 * Pide a Windows que componga Mica detrás del webview y pone el gancho CSS que
 * deja de pintar fondo opaco para que se vea. El tinte se lee del tema ya
 * resuelto en el DOM, no de la elección: Hatboo en claro con Windows en oscuro
 * tiene que recibir el tinte claro.
 *
 * Si el backend falla (otros sistemas, o Windows sin soporte para Mica) se quita
 * el gancho y la app vuelve a su fondo opaco normal.
 */
export function applyVibrancy(enabled: boolean): void {
  const root = document.documentElement;
  if (!enabled) {
    delete root.dataset.vibrancy;
    void invoke("set_window_transparency", { enabled: false, dark: null }).catch(() => {});
    return;
  }
  root.dataset.vibrancy = "on";
  const dark = root.dataset.theme === "dark" ? true : root.dataset.theme === "light" ? false : null;
  void invoke("set_window_transparency", { enabled: true, dark }).catch(() => {
    delete root.dataset.vibrancy;
  });
}
