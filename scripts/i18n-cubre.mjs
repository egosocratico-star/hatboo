// Comprueba que toda clave usada con t() esté traducida, y avisa de las que
// sobran en el diccionario (texto que ya no existe en la interfaz).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dirs = [
  "src",
  "src/components",
  "src/components/work",
  "src/components/mascot",
  "src/components/settings",
  // Las tiendas también llaman a `t()`: si no se escanean, sus cadenas se
  // traducen por accidente o se quedan en español sin que nadie lo vea.
  "src/store",
  "src/hooks",
];
const files = [
  ...new Set(
    dirs.flatMap((d) =>
      readdirSync(join(process.cwd(), d))
        .filter((f) => (f.endsWith(".tsx") || f.endsWith(".ts")) && !f.includes("i18n"))
        .map((f) => join(d, f)),
    ),
  ),
];

const RE = /\bt\(\s*"((?:[^"\\]|\\.)*)"\s*[,)]/g;
const usadas = new Set();
for (const f of files) {
  for (const m of readFileSync(join(process.cwd(), f), "utf8").matchAll(RE)) {
    usadas.add(JSON.parse(`"${m[1]}"`));
  }
}

// Las etiquetas de las listas de opciones (`{ id, label }` en types.ts y en las
// categorías de Ajustes) se pintan con `t(opción.label)`: al ser una variable no
// la ve el patrón de arriba, así que se cuentan por su cuenta.
const ETIQUETAS = /(?:label|help|short|texto|desc|subtitle|title):\s*"((?:[^"\\]|\\.)*)"/g;
for (const f of ["src/types.ts", "src/components/Settings.tsx", "src/components/settings/Atajos.tsx"]) {
  for (const m of readFileSync(join(process.cwd(), f), "utf8").matchAll(ETIQUETAS)) {
    usadas.add(JSON.parse(`"${m[1]}"`));
  }
}

const dic = readFileSync(join(process.cwd(), "src/i18n-en.ts"), "utf8");
const traducidas = new Set();
const duplicadas = [];
const vistas = new Set();
for (const m of dic.matchAll(/^\s*(?:"((?:[^"\\]|\\.)*)"|([A-Za-zÁÉÍÓÚÑáéíóúñ¿¡]+)):\s*"/gm)) {
  const k = m[1] ? JSON.parse(`"${m[1]}"`) : m[2];
  if (vistas.has(k)) duplicadas.push(k);
  vistas.add(k);
  traducidas.add(k);
}

// Una clave también cuenta como usada si el texto español aparece literal en
// algún fichero: son las listas de opciones (`EXAMPLES`, `LABELS`, `SHORTCUTS`),
// que guardan el español y lo pasan por `t()` al pintar.
const todo = files.map((f) => readFileSync(join(process.cwd(), f), "utf8")).join("\n");
for (const k of traducidas) {
  if (todo.includes(`"${k}"`)) usadas.add(k);
}

const faltan = [...usadas].filter((k) => !traducidas.has(k));
const sobran = [...traducidas].filter((k) => !usadas.has(k));
console.log(`usadas ${usadas.size} · traducidas ${traducidas.size} · faltan ${faltan.length} · sobran ${sobran.length}`);
for (const k of faltan) console.log("  FALTA:", JSON.stringify(k));
for (const k of sobran) console.log("  SOBRA:", JSON.stringify(k));
if (duplicadas.length) {
  console.log(`  DUPLICADAS: ${duplicadas.map((k) => JSON.stringify(k)).join(" · ")}`);
}
// Las sobras también cortan: una clave que ya no usa nadie no es deuda, es un
// texto muerto que se traduce, se revisa y no aparece en ninguna pantalla. Con
// `Propuesto` y `Sin verificar` pasó justo eso —la palabra se cambió en la
// interfaz y el diccionario se quedó con las dos viejas— y nadie se enteró.
process.exit(faltan.length || sobran.length || duplicadas.length ? 1 : 0);
