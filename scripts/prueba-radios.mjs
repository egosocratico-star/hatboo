// El ratchet de los radios. El bloque D dejó cuatro tokens de geometría en
// `src/index.css` —`--radio-chip` 8 · `--radio-campo` 12 · `--radio-tarjeta` 16 ·
// `--radio-entrada` 14— y `tailwind.config.js` los expone como `rounded-chip`,
// `rounded-campo`, `rounded-tarjeta` y `rounded-entrada`.
//
// Lo que mide este script es la deuda que queda: cada `rounded-lg` escrito a mano es
// un canto que no se mueve cuando se mueve la familia, y es la razón por la que la
// previa de Apariencia dibujaba una burbuja de 24 px mientras la app dibujaba una de
// 14 (arreglado el 06-10, pero así se veía: dos dueños del mismo gesto).
//
// `PRESUPUESTO` **solo puede bajar**. No se vaciaron los 227 antes de sacar la
// 0.7.0 a propósito: convertir `rounded-md` (6 px) a un token es cambiar píxeles en
// 87 sitios, y eso no se hace en la semana de un corte de versión. El presupuesto de
// hoy es el número medido hoy, para que la puerta cierre el paso hacia atrás.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

// Cualquier radio literal de Tailwind, también en sus variantes de esquina
// (`rounded-tl-lg`). `rounded-full` no cuenta: una píldora o un avatar redondo no
// son un paso de la escala, son otra cosa.
const LITERAL = /\brounded(?:-(?:t|b|l|r|tl|tr|bl|br))?-(?:xs|sm|md|lg|xl|2xl|3xl|4xl|\[[^\]]*\])/g;

// Medido el 2026-10-07 sobre `src/**/*.tsx`: **227** (91 `lg` · 87 `md` · 37 `xl` ·
// 7 `2xl` · 3 de esquina `tl-md`/`bl-md`/`tl-[5px]` · 2 arbitrarios). Bajar la cifra
// es trabajo de diseño, no de esta puerta.
const PRESUPUESTO = 227;

function ficheros(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules") continue;
    const ruta = join(dir, e.name);
    if (e.isDirectory()) out.push(...ficheros(ruta));
    else if (/\.tsx$/.test(e.name)) out.push(ruta);
  }
  return out;
}

const conteo = new Map();
const valores = new Map();
let total = 0;
for (const f of ficheros(join(RAIZ, "src"))) {
  const hits = readFileSync(f, "utf8").match(LITERAL) ?? [];
  if (!hits.length) continue;
  const rel = relative(RAIZ, f).replace(/\\/g, "/");
  conteo.set(rel, hits.length);
  total += hits.length;
  for (const h of hits) valores.set(h, (valores.get(h) ?? 0) + 1);
}

console.log(`radios literales: ${total} (presupuesto ${PRESUPUESTO})`);
const orden = [...valores.entries()].sort((a, b) => b[1] - a[1]);
console.log(`  ${orden.length} valores distintos: ${orden.map(([t, n]) => `${t}×${n}`).join("  ")}`);

let roto = false;
if (total > PRESUPUESTO) {
  console.error(
    `\nHan aparecido ${total - PRESUPUESTO} radios más de los que este fichero ` +
      `autoriza. Un radio se elige con la clase de la escala (rounded-chip · ` +
      `rounded-campo · rounded-tarjeta · rounded-entrada) o, si es de verdad otra ` +
      `cosa, rounded-full. Un literal no se mueve cuando cambia la familia, y es lo ` +
      `que hace que una pantalla previa y la real dibujen distinto.`,
  );
  roto = true;
} else if (total < PRESUPUESTO) {
  console.error(
    `\nQuedan ${total} y el presupuesto dice ${PRESUPUESTO}: baja el número en ` +
      `scripts/prueba-radios.mjs en el mismo commit, que es lo que hace que la deuda ` +
      `se vea reducirse y no pueda volver a subir.`,
  );
  roto = true;
}

const lista = [...conteo.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
if (lista.length) {
  console.log("  dónde más duele:");
  for (const [f, n] of lista) console.log(`   ${String(n).padStart(4)}  ${f}`);
}

process.exit(roto ? 1 : 0);
