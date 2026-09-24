// Lista claves repetidas del diccionario (tsc las prohíbe en un objeto literal).
import { readFileSync } from "node:fs";
const s = readFileSync("src/i18n-en.ts", "utf8");
const RE = /^  (?:"((?:[^"\\]|\\.)*)"|([A-Za-zÁÉÍÓÚÑáéíóúñ]+)):\s/gm;
const cuenta = new Map();
for (const m of s.matchAll(RE)) {
  const k = m[1] ? JSON.parse(`"${m[1]}"`) : m[2];
  cuenta.set(k, (cuenta.get(k) || 0) + 1);
}
for (const [k, n] of cuenta) if (n > 1) console.log(`x${n}  ${JSON.stringify(k)}`);
console.log("claves:", cuenta.size);
