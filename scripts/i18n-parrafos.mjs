// Párrafos de JSX que ocupan varias líneas: el envoltor línea a línea no los ve
// porque el texto empieza en una línea y termina en otra. Se unen en una sola
// cadena y se envuelven. Los que llevan elementos dentro (<code>, <strong>) se
// listan al final para tratarlos a mano: partir una frase en dos nodos hace que
// la traducción salga con las palabras en desorden.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";

const dirs = ["src/components", "src/components/work", "src/components/mascot"];
const files = [
  ...new Set(
    dirs.flatMap((d) =>
      readdirSync(join(process.cwd(), d))
        .filter((f) => f.endsWith(".tsx"))
        .map((f) => join(d, f)),
    ),
  ),
];

const esProsa = (s) => /[áéíóúñ¿¡ÁÉÍÓÚÑ]/.test(s) && s.trim().split(/\s+/).length >= 3;

let total = 0;
const conElementos = [];
for (const rel of files) {
  const ruta = join(process.cwd(), rel);
  let src = readFileSync(ruta, "utf8");
  const original = src;

  // Región de texto entre el `>` de una etiqueta y el `<` de la siguiente, sin
  // llaves ni etiquetas dentro, repartida en dos o más líneas.
  src = src.replace(/>([ \t]*\r?\n)([^<>{}]*[áéíóúñ¿¡ÁÉÍÓÚÑ][^<>{}]*)\r?\n[ \t]*</g, (todo, salto1, cuerpo) => {
    const texto = cuerpo.replace(/\s+/g, " ").trim();
    if (!esProsa(texto)) return todo;
    if (texto.includes("t(\"")) return todo;
    total++;
    return `>${salto1}      {t(${JSON.stringify(texto)})}\n<`;
  });

  if (src !== original) {
    if (!/^\s*import \{[^}]*\bt\b[^}]*\} from "[^"]*i18n"/m.test(src)) {
      let r = relative(dirname(join(process.cwd(), rel)), join(process.cwd(), "src/i18n.ts"))
        .replace(/\\/g, "/").replace(/\.ts$/, "");
      if (!r.startsWith(".")) r = "./" + r;
      src = `import { t } from "${r}";\n` + src;
    }
    writeFileSync(ruta, src);
    console.log(String((src.match(/\r?\n/g) || []).length).padStart(4), rel);
  }

  // Señala las frases partidas por un elemento: hay que reescribirlas.
  for (const m of src.matchAll(/<strong|<code/g)) {
    const linea = src.slice(0, m.index).split("\n").length;
    const trozo = src.split("\n").slice(linea - 1, linea + 1).join(" ");
    if (/[áéíóúñ]/.test(trozo)) conElementos.push(`${rel}:${linea}`);
  }
}
console.log("párrafos envueltos:", total);
console.log("con elementos dentro (revisar a mano):", conElementos.join(" ") || "ninguna");
