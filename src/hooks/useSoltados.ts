import { useEffect, useRef } from "react";

import { invoke } from "@tauri-apps/api/core";
import { t } from "../i18n";
import { soportaVision } from "../proveedores";
import { useChatStore } from "../store/chatStore";
import type { Attachment } from "../types";

/**
 * Lo que se suelta sobre la ventana acaba aquí: se lee con el mismo comando que
 * el «+» y se entrega como adjuntos al mensaje en curso. Las carpetas no llegan
 * (esas siguen abriendo un proyecto); lo que reparte `App` ya está filtrado.
 *
 * `conVision` decide qué se hace con una imagen: en el chat se adjunta si el
 * modelo ve, y en el modo trabajo se descarta con aviso — el agente trabaja con
 * archivos, no mira fotos.
 */
export function useSoltados(
  onAdjuntos: (lista: Attachment[]) => void,
  onAviso: (texto: string) => void,
  conVision: boolean,
) {
  const soltados = useChatStore((s) => s.soltados);
  // En refs: si formaran parte del `effect`, cambiar de hilo volvería a adjuntar
  // lo que ya se adjuntó.
  const entrega = useRef(onAdjuntos);
  const avisa = useRef(onAviso);
  entrega.current = onAdjuntos;
  avisa.current = onAviso;

  useEffect(() => {
    if (soltados.length === 0) return;
    const rutas = useChatStore.getState().recogeSoltados();
    if (rutas.length === 0) return;
    let vivo = true;
    void (async () => {
      const { settings, localModels } = useChatStore.getState();
      const puedeVer = conVision && soportaVision(settings, localModels);
      const buenos: Attachment[] = [];
      const fallos: string[] = [];
      for (const path of rutas) {
        try {
          const a = await invoke<Attachment>("read_attachment", { path });
          if (a.imageMediaType && !puedeVer) {
            fallos.push(
              conVision
                ? t("«{n}» es una imagen y el modelo actual no ve imágenes.", { n: a.name })
                : t("«{n}» es una imagen: el agente no mira fotos.", { n: a.name }),
            );
            continue;
          }
          buenos.push(a);
        } catch (e) {
          fallos.push(String(e));
        }
      }
      if (!vivo) return;
      if (buenos.length > 0) entrega.current(buenos);
      if (fallos.length > 0) avisa.current(fallos[0]);
    })();
    return () => {
      vivo = false;
    };
  }, [soltados, conVision]);
}
