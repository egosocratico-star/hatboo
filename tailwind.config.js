/** @type {import('tailwindcss').Config} */

// Todos los colores salen de las variables de `src/index.css`, que es lo que
// hace que el tema claro no exija tocar ningún componente. Se declaran como
// "R G B" para que Tailwind pueda aplicarles opacidad.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: {
          DEFAULT: v("surface"),
          raised: v("surface-raised"),
          border: v("surface-border"),
          hover: v("surface-hover"),
          code: v("surface-code"),
        },
        accent: {
          DEFAULT: v("accent"),
          soft: v("accent-soft"),
          dim: v("accent-dim"),
        },
        // Sombreado por encima de una superficie (hover, bordes de chip). Se
        // invierte con el tema; `white` a secas se queda blanco siempre.
        layer: v("layer"),
        // Tinte de las sombras (`shadow-shade/50`).
        shade: v("shade"),
        zinc: {
          100: v("zinc-100"),
          200: v("zinc-200"),
          300: v("zinc-300"),
          400: v("zinc-400"),
          500: v("zinc-500"),
          600: v("zinc-600"),
        },
        red: {
          300: v("red-300"),
          400: v("red-400"),
          500: v("red-500"),
          600: v("red-600"),
        },
        emerald: {
          400: v("emerald-400"),
          500: v("emerald-500"),
        },
        amber: {
          300: v("amber-300"),
          400: v("amber-400"),
          500: v("amber-500"),
        },
        violet: { 400: v("violet-400") },
        sky: { 400: v("sky-400") },
        yellow: { 400: v("yellow-400") },
        orange: { 400: v("orange-400") },
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Cascadia Code", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
