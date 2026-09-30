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

/** Bloques `:root` y `[data-theme="..."]` con sus variables `R G B`.
 *  El borde de delante evita que se cuele `html[data-acento="x"][data-theme="y"]`
 *  como si fuera una paleta: esos son los bloques de acento, medida aparte. */
function bloques() {
  const salida = [];
  const re = /(?:^|[\s}])(?::root|\[data-theme="([a-z-]+)"\])\s*\{([^}]*)\}/gm;
  for (const m of css.matchAll(re)) {
    const vars = {};
    for (const v of m[2].matchAll(/--([\w-]+):\s*(\d+)\s+(\d+)\s+(\d+)/g)) {
      vars[v[1]] = [Number(v[2]), Number(v[3]), Number(v[4])];
    }
    salida.push({ nombre: m[1] ?? "oscuro (raíz)", vars });
  }
  return salida;
}

/** Los acentos fijos de `index.css`, con su variante clara si la tienen. */
function acentos() {
  const porNombre = new Map();
  for (const m of css.matchAll(/html\[data-acento="([a-z]+)"\]([^{]*)\{([^}]*)\}/g)) {
    const vars = {};
    for (const v of m[3].matchAll(/--([\w-]+):\s*(\d+)\s+(\d+)\s+(\d+)/g)) {
      vars[v[1]] = [Number(v[2]), Number(v[3]), Number(v[4])];
    }
    const extra = (m[2] || "").trim();
    const paraTema = /data-theme="([a-z-]+)"/.exec(extra)?.[1] ?? null;
    const actual = porNombre.get(m[1]) ?? { base: null, porTema: new Map() };
    if (paraTema) actual.porTema.set(paraTema, vars);
    else actual.base = vars;
    porNombre.set(m[1], actual);
  }
  return [...porNombre.entries()].map(([nombre, a]) => ({ nombre, ...a }));
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

const BLANCO = [255, 255, 255];
const PALETAS = bloques();

// El acento no es decorativo: `text-accent-soft` es texto y `--accent` es relleno
// con blanco encima. Los cuatro fijos tienen que aguantar en TODAS las paletas,
// así que se miden aquí en vez de fiarse del ojo del que lo elige.
for (const a of acentos()) {
  for (const { nombre, vars: paleta } of PALETAS) {
    const clave = nombre === "oscuro (raíz)" ? "dark" : nombre;
    const trío = a.porTema.get(clave) ?? a.base;
    if (!trío || !paleta["surface"]) continue;
    casos += 2;
    const texto = razon(trío["accent-soft"], paleta["surface"]);
    const relleno = razon(BLANCO, trío["accent"]);
    const malos = [];
    if (texto < 4.5) malos.push(`texto ${a.nombre} sobre ${nombre} = ${texto.toFixed(2)}`);
    if (relleno < 4) malos.push(`blanco sobre ${a.nombre} = ${relleno.toFixed(2)}`);
    filas.push({
      nombre: `${a.nombre}/${nombre}`.slice(0, 18),
      medida: [`texto:${texto.toFixed(2)}`, `blanco:${relleno.toFixed(2)}`],
      malos,
    });
    if (malos.length) fallos += malos.length;
  }
}

for (const f of filas) {
  console.log(`  ${f.nombre.padEnd(18)} ${f.medida.join("  ")}`);
  for (const m of f.malos) console.log(`      FALLA ${m}`);
}
console.log(`\n${casos} medidas, ${fallos} por debajo del piso.`);
process.exit(fallos > 0 ? 1 : 0);
