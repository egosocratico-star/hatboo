// Dry-run: enseña cuántas cadenas visibles habría que envolver en t() por fichero.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dirs = ["src", "src/components", "src/components/work", "src/components/mascot"];
const files = dirs
  .flatMap((d) => readdirSync(d).filter((f) => f.endsWith(".tsx") || f.endsWith(".ts")).map((f) => join(d, f)))
  .filter((f, i, a) => a.indexOf(f) === i);

const PROPS = ["title", "placeholder", "aria-label"];
let total = 0;
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const texto = [];
  // Nodos de texto JSX: entre > y <, sin llaves.
  for (const m of src.matchAll(/>([^<>{}\n]{3,})</g)) {
    const s = m[1].trim();
    if (/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(s) && !/^\/\//.test(s)) texto.push(s);
  }
  // Líneas de texto JSX multilínea (entre etiquetas, solas en su línea).
  for (const linea of src.split("\n")) {
    const s = linea.trim();
    if (/^[A-Za-zÁÉÍÓÚÑáéíóúñ¿¡][\w\sÁÉÍÓÚÑáéíóúñ¿¡,.;:()'"%+/-]{6,}$/.test(s) && !s.includes("=")) {
      texto.push(s);
    }
  }
  const attrs = [];
  for (const p of PROPS) {
    for (const m of src.matchAll(new RegExp(`${p}="([^"]{3,})"`, "g"))) attrs.push(m[1]);
    for (const m of src.matchAll(new RegExp(`${p}=\\{\\s*"([^"]{3,})"`, "g"))) attrs.push(m[1]);
  }
  const unicas = new Set([...texto, ...attrs]);
  if (unicas.size) console.log(String(unicas.size).padStart(4), file);
  total += unicas.size;
}
console.log("total", total);
