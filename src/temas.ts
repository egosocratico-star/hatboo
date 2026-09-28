/**
 * Las paletas que se ofrecen en Ajustes → Apariencia.
 *
 * El color de verdad vive en `src/index.css`, bajo `[data-theme="…"]`: este
 * fichero solo dice qué se ofrece, cómo se llama y qué cuatro colores pintar en
 * la muestra del selector. Por eso los valores de abajo son copias — si se toca
 * un token allí, hay que tocar la muestra aquí, o el selector enseñaría una
 * paleta distinta de la que se aplica.
 */
export type ThemeId =
  | "system"
  | "light"
  | "dark"
  | "space"
  | "tokyo"
  | "nord"
  | "catppuccin"
  | "dracula"
  | "rosepine"
  | "oled";

export interface Tema {
  id: ThemeId;
  /** Nombre propio de la paleta: NO va por `t()`, los nombres propios no se traducen. */
  nombre: string;
  /** En español a pelo; se traduce al pintar. */
  nota: string;
  /** `true` si el texto claro manda: decide el `color-scheme` y la muestra. */
  oscuro: boolean;
  fondo: string;
  panel: string;
  acento: string;
  texto: string;
}

/** Los tres de siempre, que son un MODO (el sistema elige) y no una paleta. */
export const MODOS: Tema[] = [
  {
    id: "system",
    nombre: "Sistema",
    nota: "El claro/oscuro de Windows",
    oscuro: false,
    fondo: "#101018",
    panel: "#1b1b26",
    acento: "#8b5cf6",
    texto: "#f4f4f7",
  },
  {
    id: "light",
    nombre: "Claro",
    nota: "Gris papel, morado bajo",
    oscuro: false,
    fondo: "#f4f4f7",
    panel: "#ffffff",
    acento: "#6d3fd4",
    texto: "#18181b",
  },
  {
    id: "dark",
    nombre: "Oscuro",
    nota: "El de siempre, negro azulado",
    oscuro: true,
    fondo: "#0b0b10",
    panel: "#181820",
    acento: "#8b5cf6",
    texto: "#f4f4f5",
  },
];

/** Las paletas con nombre. Todas oscuras: Hatboo es una app de escritorio a
 *  deshoras, y el claro ya está arriba como modo. */
export const PALETAS: Tema[] = [
  {
    id: "space",
    nombre: "Dark Space",
    nota: "Azul noche con acento cian",
    oscuro: true,
    fondo: "#070a14",
    panel: "#131a2b",
    acento: "#4cc9f0",
    texto: "#eaf0ff",
  },
  {
    id: "tokyo",
    nombre: "Tokyo Night",
    nota: "Índigo japonés, lavanda",
    oscuro: true,
    fondo: "#1a1b26",
    panel: "#292e42",
    acento: "#bb9af7",
    texto: "#c0caf5",
  },
  {
    id: "nord",
    nombre: "Nord",
    nota: "Ártico, azul hielo",
    oscuro: true,
    fondo: "#2e3440",
    panel: "#3b4252",
    acento: "#88c0d0",
    texto: "#eceff4",
  },
  {
    id: "catppuccin",
    nombre: "Catppuccin",
    nota: "Moka, malva y lavanda",
    oscuro: true,
    fondo: "#1e1e2e",
    panel: "#313244",
    acento: "#cba6f7",
    texto: "#cdd6f4",
  },
  {
    id: "dracula",
    nombre: "Dracula",
    nota: "Morado clásico sobre grafito",
    oscuro: true,
    fondo: "#21222c",
    panel: "#343746",
    acento: "#bd93f9",
    texto: "#f8f8f2",
  },
  {
    id: "rosepine",
    nombre: "Rosé Pine Moon",
    nota: "Pino rosado, apagado",
    oscuro: true,
    fondo: "#232136",
    panel: "#312e4b",
    acento: "#c4a7e7",
    texto: "#e0def4",
  },
  {
    id: "oled",
    nombre: "OLED Black",
    nota: "Negro puro: píxel apagado",
    oscuro: true,
    fondo: "#000000",
    panel: "#121216",
    acento: "#8b5cf6",
    texto: "#e8e8ea",
  },
];

export const TODOS: Tema[] = [...MODOS, ...PALETAS];

export function temaDe(id: string): Tema {
  return TODOS.find((t) => t.id === id) ?? MODOS[2];
}
