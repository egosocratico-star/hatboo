// Últimos nodos de texto JSX que el envoltor no vio: el tag de apertura cierra
// en otra línea, así que la regla de «línea de texto entre etiquetas» no los
// detectaba. Se traducen en su sitio exacto.
import { readFileSync, writeFileSync } from "node:fs";

const CAMBIOS = [
  ["src/components/ChatWindow.tsx", ["Buscando en la web…", "{t(\"Buscando en la web…\")}"]],
  ["src/components/Settings.tsx", ["¿Cómo debería llamarte Hatboo?", "{t(\"¿Cómo debería llamarte Hatboo?\")}"]],
  ["src/components/Sidebar.tsx", ["Plegar la barra lateral\n", "{t(\"Plegar la barra lateral\")}\n"]],
  ["src/components/work/HtmlPreview.tsx", ['<option value="">(sin archivos HTML)</option>', '<option value="">{t("(sin archivos HTML)")}</option>']],
  ["src/components/work/ProjectRules.tsx", ['placeholder={"Escribe aquí las convenciones del proyecto…"}', 'placeholder={t("Escribe aquí las convenciones del proyecto…")}']],
  ["src/components/work/ProjectView.tsx", ["Trabajando en la tarea…", "{t(\"Trabajando en la tarea…\")}"]],
  ["src/components/work/SessionChanges.tsx", ['{c.diff || "(sin diff)"}', "{c.diff || t(\"(sin diff)\")}"]],
];

for (const [ruta, [antes, despues]] of CAMBIOS) {
  const src = readFileSync(ruta, "utf8");
  const ocurrencias = src.split(antes).length - 1;
  if (ocurrencias === 0) {
    console.log("NO ENCONTRADO:", ruta, antes.slice(0, 40));
    continue;
  }
  if (ocurrencias > 1 && !ruta.includes("Sidebar")) {
    console.log("MÁS DE UNA:", ruta, antes.slice(0, 40), ocurrencias);
    continue;
  }
  writeFileSync(ruta, src.replace(antes, despues));
}
console.log("hecho");
