// Cambia a mano las cadenas con interpolación que el envoltor no toca.
import { readFileSync, writeFileSync } from "node:fs";

const CAMBIOS = [
  ["src/components/Sidebar.tsx", [
    ["title={`${conv.title} · ${fmtDate(conv.updatedAt)} · clic derecho para más opciones`}",
     'title={`${conv.title} · ${fmtDate(conv.updatedAt)} · ${t("clic derecho para más opciones")}`}'],
    ["`Archivadas (${archivedCount})`", 't("Archivadas ({n})", { n: archivedCount })'],
  ]],
  ["src/components/work/ProjectView.tsx", [
    ["title={`Rama ${git.branch} · ${git.dirtyCount} archivo(s) con cambios`}",
     'title={t("Rama {r} · {n} archivo(s) con cambios", { r: git.branch, n: git.dirtyCount })}'],
    ['title={`${a.text.length.toLocaleString("es")} caracteres`}',
     'title={t("{n} caracteres", { n: a.text.length.toLocaleString("es") })}'],
  ]],
  ["src/components/ChatWindow.tsx", [
    ["title={`${a.text.length.toLocaleString()} caracteres`}",
     'title={t("{n} caracteres", { n: a.text.length.toLocaleString() })}'],
  ]],
  ["src/components/MessageBubble.tsx", [
    ['title={`${a.text.length.toLocaleString("es")} caracteres`}',
     'title={t("{n} caracteres", { n: a.text.length.toLocaleString("es") })}'],
  ]],
  ["src/components/work/SessionChanges.tsx", [
    [': `${total} archivo${total === 1 ? "" : "s"} escrito${total === 1 ? "" : "s"} en esta sesión`',
     ': total === 1\n              ? t("{n} archivo escrito en esta sesión", { n: total })\n              : t("{n} archivos escritos en esta sesión", { n: total })'],
  ]],
  ["src/components/work/CommandBlock.tsx", [
    [": `El proceso terminó con código ${codigo}`",
     ': t("El proceso terminó con código {c}", { c: codigo })'],
  ]],
  ["src/components/PermissionPicker.tsx", [
    ["title={`Permisos de herramientas — ${current.label}`}",
     'title={t("Permisos de herramientas — {l}", { l: current.label })}'],
    ["`Se guarda en el proyecto «${project?.name}».`",
     't("Se guarda en el proyecto «{n}».", { n: project?.name })'],
  ]],
  ["src/components/work/ApprovalLevelPicker.tsx", [
    ["title={`Nivel de aprobación: ${current.label} — ${current.help}`}",
     'title={t("Nivel de aprobación: {l} — {h}", { l: current.label, h: current.help })}'],
  ]],
  ["src/components/Settings.tsx", [
    ["`«${payload.model}» ya está disponible.`", 't("«{m}» ya está disponible.", { m: payload.model })'],
    ["`No se pudo descargar: ${payload.error}`", 't("No se pudo descargar: {e}", { e: payload.error })'],
    ["`No se pudo listar modelos: ${String(e)}`", 't("No se pudo listar modelos: {e}", { e: String(e) })'],
  ]],
  ["src/components/ContextMeter.tsx", [
    ['title={`${uso.chars.toLocaleString("es")} caracteres · ${uso.messages} mensajes${\n        uso.images ? ` · ${uso.images} imagen(es) en base64, no contadas aquí` : ""\n      }. Los tokens son una estimación, no el contador del proveedor.`}',
     'title={t(\n        "{c} caracteres · {m} mensajes{imagenes}. Los tokens son una estimación, no el contador del proveedor.",\n        {\n          c: uso.chars.toLocaleString("es"),\n          m: uso.messages,\n          imagenes: uso.images\n            ? t(" · {n} imagen(es) en base64, no contadas aquí", { n: uso.images })\n            : "",\n        },\n      )}'],
    ["Contexto ≈ {miles(uso.estTokens)}", "{t(\"Contexto\")} ≈ {miles(uso.estTokens)}"],
  ]],
  ["src/components/Sidebar.tsx", [
    ['if (minutos < 1) return "ahora";', 'if (minutos < 1) return t("ahora");'],
    ["if (minutos < 60) return `hace ${minutos} min`;", 'if (minutos < 60) return t("hace {n} min", { n: minutos });'],
    ["if (horas < 24) return `hace ${horas} h`;", 'if (horas < 24) return t("hace {n} h", { n: horas });'],
    ['if (dias === 1) return "ayer";', 'if (dias === 1) return t("ayer");'],
    ["if (dias < 7) return `hace ${dias} días`;", 'if (dias < 7) return t("hace {n} días", { n: dias });'],
    ["if (semanas < 5) return `hace ${semanas} sem`;", 'if (semanas < 5) return t("hace {n} sem", { n: semanas });'],
  ]],
  ["src/components/ComparePanel.tsx", [
    ["? `Se envían también los ${mensajes.length} mensajes anteriores, igual que en el chat.`",
     '? t("Se envían también los {n} mensajes anteriores, igual que en el chat.", {\n                n: mensajes.length,\n              })'],
  ]],
];

for (const [ruta, pares] of CAMBIOS) {
  let src = readFileSync(ruta, "utf8");
  for (const [antes, despues] of pares) {
    if (!src.includes(antes)) {
      console.log("NO ENCONTRADO:", ruta, "→", antes.slice(0, 52));
      continue;
    }
    src = src.replace(antes, despues);
  }
  writeFileSync(ruta, src);
}
console.log("hecho");
