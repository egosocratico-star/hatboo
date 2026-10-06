// El ratchet del movimiento. El bloque D dejó UNA curva (`--curva-suave`) y UNA
// familia de duraciones (`--mov-rapido` · `--mov-normal` · `--mov-lento`, más
// `--mov-barra` para la barra de progreso determinista), y la única forma de
// pedirlas es la clase: `duration-rapido|normal|lento` o
// `duration-[var(--mov-barra)]`. Un `duration-200` escrito a mano es un panel
// que frena a su aire: no se mueve con la familia cuando esta se ajusta y no
// le hace caso al `data-movimiento="reducido"` de la misma manera. Este script
// existe para que el vaciado no vaya a menos: si alguien escribe un
// `duration-[350ms]` nuevo, la puerta corta y dice en qué fichero.
//
// `PRESUPUESTO` **solo puede bajar**. Cuando llegue a 0 se borra la lista de
// permitidos y la duración fuera de la tokenizada deja de ser legal en el repo.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

// Cualquier clase de duración: `duration-200`, `duration-[350ms]`, `duration-lento`
// o `duration-[var(--mov-barra)]`. Se filtra contra `TOKENIZADAS`, que es lo único
// legal, así que el literal no se cuela nunca.
const OCURRENCIAS = /duration-(?:\[[^\]]*\]|[-\w]+)/g;
const TOKENIZADAS = new Set([
  "duration-rapido",
  "duration-normal",
  "duration-lento",
  "duration-[var(--mov-barra)]",
]);

// Vaciado el 2026-10-05 con el bloque D: las 16 duraciones escritas a mano que
// quedaban en `src` pasaron a la tokenizada. El 0 es la guardia anti-regresión.
const PRESUPUESTO = 0;

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
let total = 0;
const valores = new Map();
for (const f of ficheros(join(RAIZ, "src"))) {
  const texto = readFileSync(f, "utf8");
  const hits = (texto.match(OCURRENCIAS) ?? []).filter((h) => !TOKENIZADAS.has(h));
  if (hits.length) {
    conteo.set(relative(RAIZ, f).replace(/\\/g, "/"), hits.length);
    total += hits.length;
    for (const h of hits) valores.set(h, (valores.get(h) ?? 0) + 1);
  }
}

console.log(`duraciones escritas a mano: ${total} (presupuesto ${PRESUPUESTO})`);
if (valores.size > 1) {
  const orden = [...valores.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`  ${orden.length} valores distintos: ${orden.map(([t, n]) => `${t}×${n}`).join("  ")}`);
} else if (valores.size === 1) {
  console.log("  un solo valor distinto en las duraciones que quedan");
} else {
  console.log("  todas las transiciones van con la tokenizada");
}

let roto = false;
if (total > PRESUPUESTO) {
  console.error(
    `\nHan aparecido ${total - PRESUPUESTO} duraciones más de lo que este fichero ` +
      `autoriza. Un tiempo de transición se elige con la clase de la familia ` +
      `(duration-rapido · duration-normal · duration-lento) o, si es una barra de ` +
      `progreso determinista, con duration-[var(--mov-barra)]; nunca en ms: fuera ` +
      `de la tokenizada el panel no cambia cuando cambia la familia, y el gate del ` +
      `bloque D es justo ese —una sola familia de duraciones y una sola curva—`,
  );
  roto = true;
} else if (total < PRESUPUESTO) {
  console.error(
    `\nQuedan ${total} y el presupuesto dice ${PRESUPUESTO}: baja el número en ` +
      `scripts/prueba-movimiento.mjs en el mismo commit, que es lo que hace que ` +
      `la deuda se vea reducirse y no pueda volver a subir.`,
  );
  roto = true;
}

const lista = [...conteo.entries()].sort((a, b) => b[1] - a[1]);
if (lista.length) {
  console.log("  dónde quedan:");
  for (const [f, n] of lista) console.log(`   ${String(n).padStart(4)}  ${f}`);
}

process.exit(roto ? 1 : 0);
