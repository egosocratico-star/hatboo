import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { t } from "../../i18n";
import { SectionTitle } from "./piezas";
import type { Settings as SettingsType } from "../../types";

/** Ajustes → General. Lo que se avisa cuando Hatboo no está en primer plano, y
 *  qué se tapa antes de salir de la máquina. */
export default function AjustesGeneral({
  draft,
  setDraft,
}: {
  draft: SettingsType;
  setDraft: (s: SettingsType) => void;
}) {
  /** El resultado del botón de probar, sea bueno o malo. */
  const [aviso, setAviso] = useState<string | null>(null);

  return (
    <>
      <SectionTitle
        title="General"
        subtitle={t("Avisos mientras trabajas en otra ventana, y qué sale de la máquina.")}
      />
      <section className="space-y-3">
        <label className="flex items-start gap-3 rounded-xl border border-base-border bg-base-card px-3 py-3 cursor-pointer">
          <input
            type="checkbox"
            checked={draft.notifyOnFinish}
            onChange={(e) =>
              setDraft({ ...draft, notifyOnFinish: e.target.checked })
            }
            className="mt-0.5 accent-violet-500"
          />
          <span className="space-y-0.5">
            <span className="block text-sm text-zinc-200">
              {t("Avisar cuando una sesión de trabajo pida algo")}
            </span>
            <span className="block text-xs text-zinc-500">
              {t("Notificación del sistema al terminar la tarea, al fallar o cuando hace falta aprobar una acción. Solo se manda si la ventana de Hatboo no está en primer plano: si la tienes delante, ya lo estás viendo.")}
            </span>
          </span>
        </label>
        <div className="flex items-center gap-2 px-1">
          <button
            onClick={() => {
              setAviso(null);
              void invoke("test_notification").then(
                () => setAviso(t("Aviso enviado. Mira la esquina de Windows.")),
                (e) => setAviso(String(e))
              );
            }}
            className="px-2.5 py-1 rounded-lg border border-base-border text-xs text-zinc-300 hover:border-accent/50 hover:text-zinc-100 transition-colors"
          >
            {t("Probar aviso")}
          </button>
          <p className="text-xs text-zinc-500">
            {aviso ??
              t("Este no comprueba si la ventana está delante: lo lanza igual.")}
          </p>
        </div>
        <label className="flex items-start gap-3 rounded-xl border border-base-border bg-base-card px-3 py-3 cursor-pointer">
          <input
            type="checkbox"
            checked={draft.redactSecrets}
            onChange={(e) =>
              setDraft({ ...draft, redactSecrets: e.target.checked })
            }
            className="mt-0.5 accent-violet-500"
          />
          <span className="space-y-0.5">
            <span className="block text-sm text-zinc-200">
              {t("Tapar claves antes de enviarlas a un proveedor en la nube")}
            </span>
            <span className="block text-xs text-zinc-500">
              {t(
                "Cuando el agente lee un archivo del proyecto, las formas habituales de secreto (API keys, tokens de GitHub/Slack/Stripe/AWS, JWT, contraseñas en `clave = valor`, bloques de clave privada) se sustituyen por",
              )}
              <code className="mx-1 font-mono text-accent-soft">[REDACTED]</code>
              {t(
                "antes de salir hacia un proveedor en la nube, y también antes de guardarse en el historial. Con un modelo local no se toca nada. Es un filtro de patrones, no un detector perfecto.",
              )}
            </span>
          </span>
        </label>
      </section>
    </>
  );
}
