// Cierre del barrido: los literales que el envoltor general dejó fuera porque
// llevan paréntesis o puntos suspensivos pegados a las palabras.
import { readFileSync, writeFileSync } from "node:fs";

const CAMBIOS = [
  ["src/components/ChatWindow.tsx", [
    ['title="Siguiente (Enter)"', 'title={t("Siguiente (Enter)")}'],
    ['"Buscando en la web…"', 't("Buscando en la web…")'],
  ]],
  ["src/components/ComparePanel.tsx", [['title="Cerrar (Esc)"', 'title={t("Cerrar (Esc)")}']]],
  ["src/components/SearchOverlay.tsx", [['title="Cerrar (Esc)"', 'title={t("Cerrar (Esc)")}']]],
  ["src/components/Settings.tsx", [
    ['placeholder="descargar un modelo nuevo, p. ej. qwen3:4b"', 'placeholder={t("descargar un modelo nuevo, p. ej. qwen3:4b")}'],
    ['"Cargando ajustes…"', 't("Cargando ajustes…")'],
    ['title="Cerrar (Esc)"', 'title={t("Cerrar (Esc)")}'],
    ['title="Agente (modo trabajo)"', 'title={t("Agente (modo trabajo)")}'],
    ['"¿Cómo debería llamarte Hatboo?"', 't("¿Cómo debería llamarte Hatboo?")'],
    ['placeholder="p. ej. Azrael (vacío = sin nombre)"', 'placeholder={t("p. ej. Azrael (vacío = sin nombre)")}'],
  ]],
  ["src/components/Sidebar.tsx", [
    ['title="Ajustes (Ctrl+,)"', 'title={t("Ajustes (Ctrl+,)")}'],
    ['title="Plegar la barra lateral"', 'title={t("Plegar la barra lateral")}'],
  ]],
  ["src/components/SkillsSettings.tsx", [
    ['placeholder="Nombre, p. ej. Explicar paso a paso"', 'placeholder={t("Nombre, p. ej. Explicar paso a paso")}'],
    ['title="Un archivo .md con cabecera «name:» y «description:», o el cuerpo a pelo"',
     'title={t("Un archivo .md con cabecera «name:» y «description:», o el cuerpo a pelo")}'],
  ]],
  ["src/components/work/FileTree.tsx", [['placeholder="Buscar archivos…"', 'placeholder={t("Buscar archivos…")}']]],
  ["src/components/work/ProjectRules.tsx", [
    ['placeholder="Escribe aquí las convenciones del proyecto…"', 'placeholder={t("Escribe aquí las convenciones del proyecto…")}'],
  ]],
  ["src/components/work/ProjectView.tsx", [['>Trabajando en la tarea…<', '>{t("Trabajando en la tarea…")}<']]],
  ["src/components/work/SessionChanges.tsx", [['>(sin diff)<', '>{t("(sin diff)")}<']]],
];

for (const [ruta, pares] of CAMBIOS) {
  let src = readFileSync(ruta, "utf8");
  for (const [antes, despues] of pares) {
    if (!src.includes(antes)) {
      console.log("NO ENCONTRADO:", ruta, "→", antes.slice(0, 56));
      continue;
    }
    src = src.split(antes).join(despues);
  }
  writeFileSync(ruta, src);
}
console.log("hecho");
