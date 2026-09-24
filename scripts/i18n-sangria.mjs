// El envoltor de párrafos escribía `{t("…")}` a seis espacios y el cierre de la
// etiqueta en columna 0. Aquí se reindentan esos bloques con la sangría del tag
// que los contiene.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

let tocados = 0;
for (const rel of files) {
  const ruta = join(process.cwd(), rel);
  const lineas = readFileSync(ruta, "utf8").split(/\r?\n/);
  let cambio = 0;
  const salida = lineas.map((l, i) => {
    const m = l.match(/^      (\{t\(.*\}|\{t\()$/);
    if (!m) return l;
    // Sangría del tag de apertura más cercana por encima, dos espacios dentro.
    let ab = i - 1;
    while (ab >= 0 && !/>$/.test(lineas[ab])) ab--;
    if (ab < 0) return l;
    const base = (lineas[ab].match(/^\s*/) || [""])[0];
    cambio++;
    return `${base}  ${l.trim()}`;
  });
  // Cierre de etiqueta que quedó en columna 0.
  const corregido = salida.map((l, i) => {
    if (!/^<\/[a-zA-Z]/.test(l)) return l;
    let ab = i - 1;
    while (ab >= 0 && !/>$/.test(salida[ab])) ab--;
    if (ab < 0) return l;
    cambio++;
    return `${(salida[ab].match(/^\s*/) || [""])[0]}${l}`;
  });
  if (cambio) {
    writeFileSync(ruta, corregido.join("\n"));
    tocados += cambio;
    console.log(String(cambio).padStart(3), rel);
  }
}
console.log("líneas reindentadas:", tocados);
