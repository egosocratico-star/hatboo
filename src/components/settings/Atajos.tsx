import { t } from "../../i18n";
import { SectionTitle } from "./piezas";

const MOD = navigator.platform.toLowerCase().includes("mac") ? "⌘" : "Ctrl";

const SHORTCUTS: Array<{ keys: string[]; desc: string }> = [
  { keys: [MOD, "Enter"], desc: "Enviar mensaje" },
  { keys: ["Shift", "Enter"], desc: "Salto de línea en el campo" },
  { keys: [MOD, "N"], desc: "Nueva conversación" },
  { keys: [MOD, ","], desc: "Abrir Ajustes" },
  { keys: [MOD, "F"], desc: "Buscar en la conversación" },
  { keys: [MOD, "K"], desc: "Buscar chats, sesiones, proyectos o modelos" },
  { keys: [MOD, "Shift", "P"], desc: "Abrir la lista de proyectos" },
  { keys: [MOD, "B"], desc: "Plegar o desplegar la barra lateral" },
  { keys: [MOD, "."], desc: "Modo foco en el modo trabajo (solo el chat)" },
  { keys: ["/"], desc: "Plantillas desde el compositor (al principio de una palabra)" },
  { keys: ["↑", "↓", "Tab"], desc: "Recorrer la lista de plantillas del / y el menú +" },
  { keys: ["Esc"], desc: "Volver al chat desde Ajustes / atrás en el menú + / cerrar" },
];

/** Ajustes → Atajos. Lo que funciona hoy, no lo que se planeó. */
export default function AjustesAtajos() {
  return (
    <>
      <SectionTitle
        title="Atajos"
        subtitle={t("Atajos de teclado disponibles en esta versión.")}
      />
      <section className="space-y-2">
        {SHORTCUTS.map((s) => (
          <div
            key={s.desc}
            className="flex items-center justify-between gap-4 rounded-lg border border-base-border bg-base px-3 py-2.5"
          >
            <span className="text-sm text-zinc-300">{t(s.desc)}</span>
            <span className="flex items-center gap-1.5 shrink-0">
              {s.keys.map((k) => (
                <kbd
                  key={k}
                  className="px-1.5 py-0.5 rounded-md border border-base-border bg-base-raised text-[11px] font-mono text-zinc-400"
                >
                  {k}
                </kbd>
              ))}
            </span>
          </div>
        ))}
        <p className="text-[11px] text-zinc-600">
          {t("Remapear atajos llegará en una versión futura.")}
        </p>
      </section>
    </>
  );
}
