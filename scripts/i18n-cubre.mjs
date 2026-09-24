// Comprueba que toda clave usada con t() esté traducida, y avisa de las que
// sobran en el diccionario (texto que ya no existe en la interfaz).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dirs = ["src", "src/components", "src/components/work", "src/components/mascot"];
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
const ETIQUETAS = /(?:label|help|short):\s*"((?:[^"\\]|\\.)*)"/g;
for (const f of ["src/types.ts", "src/components/Settings.tsx"]) {
  for (const m of readFileSync(join(process.cwd(), f), "utf8").matchAll(ETIQUETAS)) {
    usadas.add(JSON.parse(`"${m[1]}"`));
  }
}

const dic = readFileSync(join(process.cwd(), "src/i18n-en.ts"), "utf8");
const traducidas = new Set();
for (const m of dic.matchAll(/^\s*(?:"((?:[^"\\]|\\.)*)"|([A-Za-zÁÉÍÓÚÑáéíóúñ¿¡]+)):\s*"/gm)) {
  traducidas.add(m[1] ? JSON.parse(`"${m[1]}"`) : m[2]);
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
process.exit(faltan.length ? 1 : 0);
