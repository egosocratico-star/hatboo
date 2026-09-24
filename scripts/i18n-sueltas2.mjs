// Etiquetas sueltas de una palabra sin tilde (`Proyectos`, `Archivos`,
// `Confirmar`…): ni el heurístico de acentos ni el de dos palabras las cazaba.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PALABRAS = [
  "Conectores", "Plantillas", "Comparar", "Confirmar", "Proveedor", "Descargar",
  "Credenciales", "Razonamiento", "Proyectos", "Conversaciones", "Tema",
  "Archivos", "Tareas", "Argumentos", "Rechazar", "Aprobar",
];

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

let total = 0;
for (const rel of files) {
  const ruta = join(process.cwd(), rel);
  const lineas = readFileSync(ruta, "utf8").split("\n");
  let cambio = 0;
  const salida = lineas.map((l) => {
    const m = l.match(/^(\s*)([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)(\s*)$/);
    if (!m || !PALABRAS.includes(m[2])) return l;
    cambio++;
    return `${m[1]}{t("${m[2]}")}${m[3]}`;
  });
  if (cambio) {
    writeFileSync(ruta, salida.join("\n"));
    total += cambio;
    console.log(String(cambio).padStart(3), rel);
  }
}
console.log("etiquetas envueltas:", total);
