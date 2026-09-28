import { t } from "../../i18n";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BookMarked, Globe, Wrench } from "lucide-react";
import { useChatStore } from "../../store/chatStore";

interface Capas {
  herramientas: number;
  comandos: boolean;
  web: boolean;
  plantillas: number;
}

/** Pastilla, no texto suelto: en la cabecera iban separadas a puntos y formaban
 *  una frase ilegible de tres grises distintos. Mismo idioma que los chips del
 *  Centro de modelos. */
const CHIP =
  "flex shrink-0 items-center gap-1 rounded-full border border-base-border bg-base-card px-2 py-0.5 text-[11px] tabular-nums text-zinc-500";

/**
 * Las capas del agente a la vista: cuántas tools tiene puestas, si puede salir a
 * internet y cuántas plantillas se inyectan en el prompt. Se leen del mismo
 * sitio que lee el bucle, así que la cabecera no promete nada que el loop no
 * vaya a recibir. No son controles: cada capa se sigue cambiando donde estaba.
 */
export default function LayerChips() {
  const [capas, setCapas] = useState<Capas | null>(null);
  const webSearch = useChatStore((s) => s.settings?.webSearch);
  const plantillas = useChatStore((s) => s.skills.filter((k) => k.enabled).length);

  useEffect(() => {
    let vivo = true;
    invoke<Capas>("agent_layers")
      .then((c) => vivo && setCapas(c))
      .catch(() => vivo && setCapas(null));
    return () => {
      vivo = false;
    };
  }, [webSearch, plantillas]);

  if (!capas) return null;

  const faltan = [
    !capas.comandos && t("ejecutar comandos (apagado en Ajustes → Agente)"),
    !capas.web && t("buscar en la web (apagado con el 🌐 del compositor)"),
  ].filter(Boolean);
  const detalleTools =
    faltan.length === 0
      ? t(
          "Leer, listar, buscar archivos, escribir y git. Todo dentro de esta carpeta.",
        )
      : t("Ahora mismo no puede: {q}", { q: faltan.join(" · ") });

  return (
    <>
      <span className={CHIP} title={detalleTools}>
        <Wrench className="h-3 w-3" />
        <span className="tabular-nums">{capas.herramientas}</span>
        {t("tools")}
      </span>
      <span
        className={`${CHIP} ${capas.web ? "text-zinc-300" : ""}`}
        title={
          capas.web
            ? t("Puede salir a internet con la búsqueda web.")
            : t("Sin salida a internet: se activa con el 🌐 bajo el compositor.")
        }
      >
        <Globe
          className={`h-3 w-3 ${capas.web ? "text-accent-soft" : "text-zinc-700"}`}
        />
        {capas.web ? t("web") : t("sin web")}
      </span>
      <span
        className={CHIP}
        title={
          capas.plantillas === 0
            ? t("Ninguna plantilla activa: el prompt no lleva extras.")
            : t("{n} plantilla(s) activas: se añaden al prompt de cada sesión.", {
                n: capas.plantillas,
              })
        }
      >
        <BookMarked className="h-3 w-3" />
        <span className="tabular-nums">{capas.plantillas}</span>
        {t("plantillas")}
      </span>
    </>
  );
}
