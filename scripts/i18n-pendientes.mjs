// Lista los literales con pinta de prosa que aún NO pasan por t().
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dirs = ["src", "src/components", "src/components/work", "src/components/mascot"];
const files = [
  ...new Set(
    dirs.flatMap((d) =>
      readdirSync(join(process.cwd(), d))
        .filter((f) => f.endsWith(".tsx"))
        .map((f) => join(d, f)),
    ),
  ),
];

const limpia = (s) => s.replace(/^[^\p{L}]+|[^\p{L}.…]+$/gu, "");
const esPalabra = (s) => /^[\p{L}]{2,}[.!…]?$/u.test(limpia(s));
const PROHIBIDAS = new Set([
  "top left", "top right", "bottom left", "bottom right", "center center",
  "Ctrl+.", "image/png", "text/plain",
]);

const busca = (s) => {
  const t = s.trim();
  if (t.length < 4 || PROHIBIDAS.has(t)) return false;
  if (/[$`{}[\]\\]/.test(t)) return false;
  if (/[áéíóúñ¿¡ÁÉÍÓÚÑ]/.test(t)) {
    const w = t.split(/\s+/);
    return w.length === 1 ? true : w.filter(esPalabra).length / w.length >= 0.5;
  }
  const w = t.split(/\s+/);
  return w.length >= 2 && w.filter(esPalabra).length / w.length >= 0.6;
};

let total = 0;
for (const f of files) {
  const lineas = readFileSync(join(process.cwd(), f), "utf8").split("\n");
  const hits = [];
  lineas.forEach((l, i) => {
    const s = l.trim();
    if (s.startsWith("//") || s.startsWith("*") || s.startsWith("/*")) return;
    const candidatas = [];
    for (const m of l.matchAll(/\b([a-zA-Z][\w-]*)="([^"]{4,})"/g)) {
      if (["className", "style", "id", "key", "type", "value", "lang", "href", "src", "d", "role"].includes(m[1])) continue;
      candidatas.push(m[2]);
    }
    for (const m of l.matchAll(/(^|[^t(])"([^"\n]{4,})"(?=[\s,;)\]}:])/g)) candidatas.push(m[2]);
    for (const m of l.matchAll(/>([^<>{}\n]{4,})</g)) candidatas.push(m[1]);
    if (/^\s*[A-Za-zÁÉÍÓÚÑáéíóúñ¿¡][^<>{}"'`]*[a-záéíóúñ?.…]\s*$/.test(l)) {
      const anterior = (lineas[i - 1] ?? "").trim();
      const siguiente = (lineas[i + 1] ?? "").trim();
      if (/>\s*$/.test(anterior) && /^\s*</.test(siguiente)) candidatas.push(s);
    }
    for (const c of candidatas) {
      if (busca(c)) hits.push(`  ${i + 1}: ${JSON.stringify(c.trim().slice(0, 70))}`);
    }
  });
  if (hits.length) {
    console.log(f);
    console.log([...new Set(hits)].join("\n"));
    total += new Set(hits).size;
  }
}
console.log("total pendientes:", total);
