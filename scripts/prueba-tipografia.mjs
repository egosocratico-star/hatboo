// El ratchet de la tipografía. `text-[Npx]` es lo que la densidad no puede
// cambiar: la densidad mueve el `font-size` del `<html>` (`theme.ts`) y un valor
// en píxeles absolutos no le hace caso. El bloque D va vaciando esos literales,
// y este script existe para que el vaciado no vaya a menos: si alguien escribe un
// `text-[12px]` nuevo, la puerta corta y dice en qué fichero.
//
// `PRESUPUESTO` **solo puede bajar**. Cuando llegue a 0 se borra la lista de
// permitidos y el `text-[Npx]` deja de ser legal en el repo.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const LITERALES = /text-\[[0-9.]+px\]/g;

// Vaciado el 2026-10-05 con el bloque D: ya no queda ningún `text-[Npx]` en `src`.
// A partir de aquí `text-[Npx]` está prohibido y el 0 es la guardia anti-regresión.
const PRESUPUESTO = 0;

function ficheros(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules") continue;
    const ruta = join(dir, e.name);
    if (e.isDirectory()) out.push(...ficheros(ruta));
    else if (/\.tsx?$/.test(e.name)) out.push(ruta);
  }
  return out;
}

const conteo = new Map();
let total = 0;
const tamaños = new Map();
for (const f of ficheros(join(RAIZ, "src"))) {
  const texto = readFileSync(f, "utf8");
  const hits = texto.match(LITERALES) ?? [];
  if (hits.length) {
    conteo.set(relative(RAIZ, f).replace(/\\/g, "/"), hits.length);
    total += hits.length;
    for (const h of hits) tamaños.set(h, (tamaños.get(h) ?? 0) + 1);
  }
}

console.log(`text-[Npx]: ${total} (presupuesto ${PRESUPUESTO})`);
if (tamaños.size > 1) {
  const orden = [...tamaños.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`  ${orden.length} tamaños distintos: ${orden.map(([t, n]) => `${t}×${n}`).join("  ")}`);
} else {
  console.log("  un solo tamaño distinto en los literales que quedan");
}

let roto = false;
if (total > PRESUPUESTO) {
  console.error(
    `\nHan aparecido ${total - PRESUPUESTO} literales más de lo que este fichero ` +
      `autoriza. Un tamaño de letra se elige con la clase de la escala ` +
      `(text-micro · text-etiqueta · text-ui · text-xs · text-sm · text-base · ` +
      `text-xl · text-saludo · text-2xl) o con la variable ` +
      `--letra-<nombre> de src/index.css, nunca en px: en px no escala con la ` +
      `densidad, y esa era la «densidad inconsistente» del plan.`,
  );
  roto = true;
} else if (total < PRESUPUESTO) {
  console.error(
    `\nQuedan ${total} y el presupuesto dice ${PRESUPUESTO}: baja el número en ` +
      `scripts/prueba-tipografia.mjs en el mismo commit, que es lo que hace que ` +
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
