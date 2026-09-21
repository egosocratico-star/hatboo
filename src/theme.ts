export type ThemeChoice = "dark" | "light" | "system";

const STORED = "hatboo-theme";
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
