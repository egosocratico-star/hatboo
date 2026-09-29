/**
 * Contraste de las paletas, medido sobre `src/index.css`.
 *
 * Se corre con `npm run prueba-contraste`. Existe porque la pasada minimalista
 * acerca las superficies al fondo, y acercar superficies baja el contraste del
 * texto sin que nadie lo vea hasta que alguien se queja. Los umbrales son el
 * suelo que ya tenía la app: ninguna paleta puede quedar por debajo.
 */
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");

/** Bloques `:root` y `[data-theme="..."]` con sus variables `R G B`. */
function bloques() {
  const salida = [];
  const re = /(?::root|\[data-theme="([a-z-]+)"\])\s*\{([^}]*)\}/g;
  for (const m of css.matchAll(re)) {
    const vars = {};
    for (const v of m[2].matchAll(/--([\w-]+):\s*(\d+)\s+(\d+)\s+(\d+)/g)) {
      vars[v[1]] = [Number(v[2]), Number(v[3]), Number(v[4])];
    }
    salida.push({ nombre: m[1] ?? "oscuro (raíz)", vars });
  }
  return salida;
}

const lum = (rgb) => {
  const f = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
};

const razon = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/** Lo que tiene que aguantar cada combinación: texto de cuerpo, tenue y muy
 *  tenue sobre las dos superficies que se mueven en esta pasada. */
const COMBINACIONES = [
  ["zinc-100", "surface-card", 7, "título sobre tarjeta"],
  ["zinc-100", "surface-raised", 7, "título sobre elevado"],
  ["zinc-400", "surface-card", 4, "cuerpo tenue sobre tarjeta"],
  ["zinc-400", "surface-raised", 4, "cuerpo tenue sobre elevado"],
  ["zinc-500", "surface", 3, "tenue sobre fondo"],
  ["zinc-600", "surface", 2.2, "muy tenue sobre fondo (10 px)"],
  ["zinc-600", "surface-card", 2.2, "muy tenue sobre tarjeta"],
  ["accent-soft", "surface", 4.5, "acento sobre fondo"],
];

let fallos = 0;
let casos = 0;
const filas = [];

for (const { nombre, vars } of bloques()) {
  const malos = [];
  const medida = [];
  for (const [texto, fondo, minimo, etiqueta] of COMBINACIONES) {
    const t = vars[texto];
    const f = vars[fondo];
    if (!t || !f) continue;
    casos += 1;
    const r = razon(t, f);
    medida.push(`${fondo.split("-")[1]}:${r.toFixed(2)}`);
    if (r < minimo) {
      fallos += 1;
      malos.push(`${etiqueta} = ${r.toFixed(2)} (piso ${minimo})`);
    }
  }
  filas.push({ nombre, medida, malos });
}

for (const f of filas) {
  console.log(`  ${f.nombre.padEnd(18)} ${f.medida.join("  ")}`);
  for (const m of f.malos) console.log(`      FALLA ${m}`);
}
console.log(`\n${casos} medidas, ${fallos} por debajo del piso.`);
process.exit(fallos > 0 ? 1 : 0);
