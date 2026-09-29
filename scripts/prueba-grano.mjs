/**
 * Ajuste del grano, por paleta. `npm run prueba-grano`.
 *
 * El grano es un tile de ruido (`feTurbulence`) que se mezcla con `overlay` sobre el
 * color de cada superficie. Antes de escribir este script se midió en Chromium:
 *
 *   - la distribución del ruido con `color-interpolation-filters='sRGB'`: mediana
 *     0,502 en canal y p05..p95 = 0,353..0,647, o sea ±0,294 alrededor de la mitad;
 *   - el resultado de mezclar ese tile con nueve superficies reales de las paletas,
 *     que encaja con la fórmula de abajo hasta ±1 nivel de 8 bits en las nueve.
 *
 * La fórmula dice lo que se ve: `salto = 2·min(b,1−b)·0,294·F`. Depende del tono,
 * así que UNA fuerza para las nueve paletas es imposible: Nord textura el doble que
 * el oscuro de Hatboo con la misma F. Y `overlay` tiene dos puntos fijos medidos:
 * el blanco puro del tema claro no se mueve ni un nivel, y el `#000` del fondo OLED
 * tampoco — el grano solo toca las tarjetas de 18, así que el píxel apagado sigue
 * apagado.
 *
 * Suelos: los mismos de `prueba-contraste`. El grano sube y baja la superficie, así
 * que se mide el PEOR píxel, no la media.
 */
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");

/** Medido en Chromium sobre el tile, en canal 0..1. */
const MEDIANA = 0.502;
/** Media distancia de la cola (p95 − mediana). */
const COLA = 0.294;
const NIV = 255;

/** Las dos fuerzas que hay hornedas en `src/assets/grano-*.svg`. Son dos porque la
 *  banda de textura se cumple con dos y cada tile cuesta un archivo y una línea de
 *  CSS por paleta; tres no aportaban nada que no hicieran estas dos. */
const FUERZAS = [0.15, 0.45];

/** Banda de textura sobre la tarjeta: por debajo no se ve; por encima se lee como
 *  suciedad. La cota la fija Nord, que es la paleta que más textura saca. */
const MIN_NIV = 3;
const MAX_NIV = 8;

function bloques() {
  const salida = [];
  const re = /(?::root|\[data-theme="([a-z-]+)"\])\s*\{([^}]*)\}/g;
  for (const m of css.matchAll(re)) {
    const vars = {};
    for (const v of m[2].matchAll(/--([\w-]+):\s*(\d+)\s+(\d+)\s+(\d+)/g)) {
      vars[v[1]] = [Number(v[2]), Number(v[3]), Number(v[4])];
    }
    if (Object.keys(vars).length) salida.push({ nombre: m[1] ?? "oscuro (raíz)", vars });
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

/** Salto pico a pico, en niveles de 8 bits, de un canal `c` (0..255) con fuerza `F`. */
const salto = (c, F) => 2 * Math.min(c / NIV, 1 - c / NIV) * COLA * F * NIV;

/** De qué se corre el TONO MEDIO: solo por la mediana medida (0,502 en vez de 0,5),
 *  porque la desviación del ruido es simétrica y se cancela. */
const deriva = (c, F) => Math.abs(2 * MEDIANA - 1) * Math.min(c, NIV - c) * F;

/** El color de la superficie en el extremo del grano: cada canal se mueve el suyo. */
const extremo = (base, F, arriba) =>
  base.map((c) =>
    Math.max(0, Math.min(NIV, c + (arriba ? 1 : -1) * (salto(c, F) / 2)))
  );

const COMBINACIONES = [
  ["zinc-100", "surface-card", 7, "título sobre tarjeta"],
  ["zinc-400", "surface-card", 4, "cuerpo tenue sobre tarjeta"],
  ["zinc-500", "surface", 3, "tenue sobre fondo"],
  ["zinc-600", "surface", 2.2, "muy tenue sobre fondo (10 px)"],
  ["zinc-600", "surface-card", 2.2, "muy tenue sobre tarjeta"],
  ["accent-soft", "surface", 4.5, "acento sobre fondo"],
];

let avisos = 0;
const filas = [];

for (const { nombre, vars } of bloques()) {
  const tarjeta = vars["surface-card"];
  const fondo = vars.surface;
  if (!tarjeta || !fondo) continue;

  // Se elige la MAYOR fuerza que entra en la banda y no rompe ningún suelo, en el
  // peor píxel. Si la más suave ya se pasa de textura, ese tema se queda sin grano.
  let elegida = null;
  let motivo = "";
  for (const F of [...FUERZAS].sort((a, b) => b - a)) {
    const s = salto(tarjeta[0], F);
    if (s > MAX_NIV) continue;
    if (s < MIN_NIV) {
      motivo = `textura de ${s.toFixed(1)} niv: no se ve`;
      break;
    }
    const roto = COMBINACIONES.map(([texto, superficie, minimo]) => {
      const t = vars[texto];
      const base = vars[superficie];
      if (!t || !base) return null;
      const peor = extremo(base, F, lum(t) > lum(base));
      const r = razon(t, peor);
      return r < minimo ? `${texto}/${superficie} ${r.toFixed(2)} < ${minimo}` : null;
    }).filter(Boolean);
    if (roto.length) {
      motivo = `F ${F} rompe ${roto[0]}`;
      continue;
    }
    elegida = F;
    motivo = `textura ${s.toFixed(1)} niv en tarjeta`;
    break;
  }

  const F = elegida ?? 0;
  const corrimiento = deriva(tarjeta[0], Math.max(...FUERZAS));
  if (corrimiento > 1.2) {
    avisos++;
    motivo += ` | ALERTA: el tono medio se correría ${corrimiento.toFixed(2)} niv`;
  }
  filas.push({
    nombre,
    grano: elegida === null ? "NINGUNO" : `F ${elegida}`,
    tarjeta: F ? salto(tarjeta[0], F).toFixed(1) : "0,0",
    fondo: F ? salto(fondo[0], F).toFixed(1) : "0,0",
    deriv: F ? deriva(tarjeta[0], F).toFixed(2) : "0",
    motivo,
  });
}

console.log("  paleta              grano    salto tarjeta  salto fondo  deriva  por qué");
for (const f of filas) {
  console.log(
    `  ${f.nombre.padEnd(19)} ${f.grano.padEnd(8)} ${f.tarjeta.padStart(6)} niv      ${f.fondo.padStart(6)} niv   ${f.deriv.padStart(5)}   ${f.motivo}`
  );
}
console.log(
  `\nBandas: textura de ${MIN_NIV}-${MAX_NIV} niveles en la tarjeta, deriva del tono medio < 1,2 niv, y los suelos de ${COMBINACIONES.length} combinaciones aguantan en el peor píxel.`
);
process.exit(avisos > 0 ? 1 : 0);
