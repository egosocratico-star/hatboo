// Busca texto de la interfaz en español que NUNCA pasó por t(): nodos JSX que
// el barrido por líneas no vio porque llevan una expresión `{...}` pegada.
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

const PROSA = /\b(el|la|los|las|un|una|que|de|del|en|con|por|para|sin|más|mas|su|sus|está|esta|este|esto|como|cuando|donde|si|no|hay|muy|puede|debe|tiene|cada|sobre|entre|escribe|habilitar|conservar|quiero|quiere|agente|ejecutar|mensaje|archivo|carpeta|proyecto|ajustes|modelo|tarea|plan|borrar|guardar|poner|hacer|ver|sin)\b/i;

let total = 0;
for (const rel of files) {
  const lineas = readFileSync(join(process.cwd(), rel), "utf8").split(/\r?\n/);
  const hits = [];
  lineas.forEach((l, i) => {
    const s = l.trim();
    if (/^(\/\/|\*|\/\*)/.test(s)) return;
    // Quito los strings ya envueltos y los literales dentro de t(...) o atributos.
    const sinT = l.replace(/t\(\s*"[^"]*"\s*[,)]/g, 't("")');
    // Un nodo de texto JSX: letras sueltas entre `>` y `<`, o una línea de texto
    // que empieza en su propio nodo y puede llevar `{expr}` pegado.
    const trozos = [];
    for (const m of sinT.matchAll(/>([^<>{}]+)/g)) trozos.push(m[1]);
    for (const m of sinT.matchAll(/(?:^|\})\s*([A-Za-zÁÉÍÓÚÑáéíóúñ¿¡][^<>{}"']{6,}?)\s*(?:\{|<|$)/g))
      trozos.push(m[1]);
    for (const t of trozos) {
      const limpio = t.trim();
      if (limpio.length < 6 || !/[a-záéíóúñ]/i.test(limpio)) continue;
      if (!PROSA.test(limpio)) continue;
      if (/^[\w.-]+$/.test(limpio)) continue;
      hits.push(`  ${i + 1}: ${JSON.stringify(limpio.slice(0, 72))}`);
    }
  });
  if (hits.length) {
    console.log(rel);
    console.log([...new Set(hits)].join("\n"));
    total += new Set(hits).size;
  }
}
console.log("sospechosos:", total);
