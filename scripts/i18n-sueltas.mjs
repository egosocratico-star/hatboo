// Etiquetas de una sola palabra que los patrones generales no cazaron, y dos
// frases que estaban partidas por un <span>/<strong> (traducirlas por trozos
// sale mal en inglés por el orden de las palabras).
import { readFileSync, writeFileSync } from "node:fs";

const UNO_A_UNO = [
  ["src/components/ChatPlusMenu.tsx", [
    [">Imagen<", ">{t(\"Imagen\")}<"],
    [">Proyectos<", ">{t(\"Proyectos\")}<"],
  ]],
  ["src/components/ChatWindow.tsx", [[">Comparar<", ">{t(\"Comparar\")}<"]]],
  ["src/components/ProviderModelPicker.tsx", [[">Razonamiento<", ">{t(\"Razonamiento\")}<"]]],
  ["src/components/Settings.tsx", [
    [">Modelos<", ">{t(\"Modelos\")}<"],
    [">Tema<", ">{t(\"Tema\")}<"],
    [">Movimiento<", ">{t(\"Movimiento\")}<"],
    [">Fuente<", ">{t(\"Fuente\")}<"],
    [">Avatar<", ">{t(\"Avatar\")}<"],
    [">Emoji<", ">{t(\"Emoji\")}<"],
    [">Interfaz<", ">{t(\"Interfaz\")}<"],
    [">Backend<", ">{t(\"Backend\")}<"],
    [">Proveedores<", ">{t(\"Proveedores\")}<"],
  ]],
  ["src/components/work/ApprovalLevelPicker.tsx", [[">activo<", ">{t(\"activo\")}<"]]],
  ["src/components/work/ProjectRules.tsx", [[">Reglas<", ">{t(\"Reglas\")}<"]]],
  ["src/components/work/SessionChanges.tsx", [[">Cambios<", ">{t(\"Cambios\")}<"]]],
  ["src/components/work/WorkPlusMenu.tsx", [[">Imagen<", ">{t(\"Imagen\")}<"], [">Proyectos<", ">{t(\"Proyectos\")}<"]]],
];

for (const [ruta, pares] of UNO_A_UNO) {
  let src = readFileSync(ruta, "utf8");
  for (const [antes, despues] of pares) {
    if (!src.includes(antes)) console.log("NO ENCONTRADO:", ruta, antes);
    src = src.split(antes).join(despues);
  }
  writeFileSync(ruta, src);
}

// «Modo Trabajo» partido en dos nodos: en inglés el orden es el inverso.
let pv = readFileSync("src/components/work/ProjectView.tsx", "utf8");
pv = pv.replace(
  "Modo <span className=\"text-accent-soft\">Trabajo</span>",
  "<span className=\"text-accent-soft\">{t(\"Modo Trabajo\")}</span>",
);
writeFileSync("src/components/work/ProjectView.tsx", pv);

// Párrafo con «todas» emphasis en medio: la frase va entera a una clave.
let sk = readFileSync("src/components/SkillsSettings.tsx", "utf8");
sk = sk.replace(
  /        Cada plantilla es un trozo de instrucciones escrito por ti\. Si está\n        activada, Hatboo la aplica en <strong className="text-zinc-400">todas<\/strong>\{" "\}\n        las respuestas del chat y del modo trabajo; si no, siempre puedes\n        insertarla en un mensaje concreto desde el botón «\+» de la barra de chat\.\n/,
  '        {t(\n          "Cada plantilla es un trozo de instrucciones escrito por ti. Si está activada, Hatboo la aplica en todas las respuestas del chat y del modo trabajo; si no, siempre puedes insertarla en un mensaje concreto desde el botón «+» de la barra de chat.",\n        )}\n',
);
writeFileSync("src/components/SkillsSettings.tsx", sk);
console.log("hecho");
