// Envuelve en t() las etiquetas que vienen de constantes (tipos.ts) y se pintan
// con {x.label}: el script general no las ve porque no son literales.
import { readFileSync, writeFileSync } from "node:fs";

const CAMBIOS = [
  ["src/components/PermissionPicker.tsx", [["{l.label}", "{t(l.label)}"], ["{l.help}", "{t(l.help)}"]]],
  ["src/components/ProviderModelPicker.tsx", [["{l.label}", "{t(l.label)}"]]],
  ["src/components/work/ApprovalLevelPicker.tsx", [["{l.label}", "{t(l.label)}"], ["{l.help}", "{t(l.help)}"]]],
  ["src/components/Settings.tsx", [
    ["<span className=\"flex-1\">{c.label}</span>", "<span className=\"flex-1\">{t(c.label)}</span>"],
    ["{l.label}", "{t(l.label)}"],
    ["{m.label}", "{t(m.label)}"],
    ["{f.label}", "{t(f.label)}"],
    ["{a.label}", "{t(a.label)}"],
    ["title={c.label}", "title={t(c.label)}"],
    ["aria-label={c.label}", "aria-label={t(c.label)}"],
  ]],
  ["src/components/work/ApprovalLevelPicker.tsx", [
    ["{ l: current.label, h: current.help }", "{ l: t(current.label), h: t(current.help) }"],
  ]],
  ["src/components/PermissionPicker.tsx", [
    ["{ l: current.label }", "{ l: t(current.label) }"],
  ]],
];

const vistos = new Set();
for (const [ruta, pares] of CAMBIOS) {
  if (!pares.length) continue;
  let src = readFileSync(ruta, "utf8");
  for (const [antes, despues] of pares) {
    if (!src.includes(antes)) {
      console.log("NO ENCONTRADO:", ruta, "→", antes);
      continue;
    }
    src = src.split(antes).join(despues);
  }
  writeFileSync(ruta, src);
  vistos.add(ruta);
}
console.log("tocados:", [...vistos].join(" "));
