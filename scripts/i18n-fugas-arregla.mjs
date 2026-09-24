// Arregla las fugas del barrido i18n: nodos de texto que iban pegados a una
// expresión `{...}` o a un elemento en línea, y por eso no se envolvieron.
import { readFileSync, writeFileSync } from "node:fs";

const CAMBIOS = [
  ["src/components/ProviderModelPicker.tsx", [
    ["            Modelo ({PROVIDER_LABELS[settings.activeProvider]})\n",
     '            {t("Modelo ({p})", { p: PROVIDER_LABELS[settings.activeProvider] })}\n'],
    ["            Ajustes (claves, endpoints, pruebas)\n",
     '            {t("Ajustes (claves, endpoints, pruebas)")}\n'],
  ]],
  ["src/components/SearchOverlay.tsx", [
    ['              Nada coincide con «{query.trim()}».\n',
     '              {t("Nada coincide con «{q}».", { q: query.trim() })}\n'],
  ]],
  ["src/components/SourcesBlock.tsx", [
    ['          {sources.length} {sources.length === 1 ? "fuente" : "fuentes"} de la web\n',
     '          {sources.length === 1\n            ? t("{n} fuente de la web", { n: sources.length })\n            : t("{n} fuentes de la web", { n: sources.length })}\n'],
  ]],
  ["src/components/work/PlanReviewModal.tsx", [
    ['<Plus className="w-3.5 h-3.5" /> Añadir un paso\n',
     '<Plus className="w-3.5 h-3.5" /> {t("Añadir un paso")}\n'],
  ]],
  ["src/components/work/ToolApprovalModal.tsx", [
    ["            El agente quiere ejecutarse {\" \"}\n", ""],
    ["            El agente quiere ejecutar{\" \"}\n",
     '            {t("El agente quiere ejecutar")}{" "}\n'],
  ]],
  ["src/components/ChatWindow.tsx", [
    ["              {saludo(new Date().getHours())}. Soy{\" \"}\n",
     '              {saludo(new Date().getHours())}. {t("Soy")}{" "}\n'],
  ]],
  ["src/components/Settings.tsx", [
    ["                      Habilitar{\" \"}\n", '                      {t("Habilitar")}{" "}\n'],
    [`                        Se borran de este PC todas las conversaciones, los
                        proyectos, las tareas, las imágenes adjuntas y los
                        ajustes, y también las claves de API del llavero. No se
                        puede deshacer: exporta una copia antes si quieres
                        conservar algo. Escribe{" "}
`,
     `                        {t(
                          "Se borran de este PC todas las conversaciones, los proyectos, las tareas, las imágenes adjuntas y los ajustes, y también las claves de API del llavero. No se puede deshacer: exporta una copia antes si quieres conservar algo. Escribe",
                        )}{" "}
`],
    ["                        para confirmar.\n", '                        {t("para confirmar.")}\n'],
    [`                Aquí irá el control de {CATEGORIES.find((c) => c.id === cat)?.label.toLowerCase()} de
                Hatboo. Todavía no está construido; volveremos en una próxima
                tanda.
`,
     `                {t(
                  "Aquí irá el control de {c} de Hatboo. Todavía no está construido; volveremos en una próxima tanda.",
                  { c: CATEGORIES.find((k) => k.id === cat)?.label.toLowerCase() ?? "" },
                )}
`],
  ]],
  ["src/components/work/ProjectRules.tsx", [
    [`            {reglas?.path ?? "HATBOO.md"} — se añade al prompt del agente al
            empezar cada sesión de trabajo de esta carpeta. No amplía el sandbox
            ni quita aprobaciones.
`,
     `            {t(
              "{p} — se añade al prompt del agente al empezar cada sesión de trabajo de esta carpeta. No amplía el sandbox ni quita aprobaciones.",
              { p: reglas?.path ?? "HATBOO.md" },
            )}
`],
  ]],
  ["src/components/work/ProjectView.tsx", [
    [`            <span className="font-semibold">{t("Acceso total activo:")}</span> el agente
            ejecuta todas las acciones sin pedir aprobación, incluida escritura
            de archivos y comandos. Las rutas siguen limitadas a la carpeta del
            proyecto.
`,
     `            <span className="font-semibold">{t("Acceso total activo:")}</span>{" "}
            {t(
              "el agente ejecuta todas las acciones sin pedir aprobación, incluida escritura de archivos y comandos. Las rutas siguen limitadas a la carpeta del proyecto.",
            )}
`],
    [`            Este modelo no soporta tool calling — cambia de proveedor o modelo
            en Ajustes para usar el modo trabajo.
`,
     `            {t(
              "Este modelo no soporta tool calling — cambia de proveedor o modelo en Ajustes para usar el modo trabajo.",
            )}
`],
  ]],
];

for (const [ruta, pares] of CAMBIOS) {
  let src = readFileSync(ruta, "utf8");
  for (const [antes, despues] of pares) {
    if (!antes || !src.includes(antes)) {
      if (antes) console.log("NO ENCONTRADO:", ruta, "→", JSON.stringify(antes.slice(0, 46)));
      continue;
    }
    src = src.replace(antes, despues);
  }
  writeFileSync(ruta, src);
}
console.log("hecho");
