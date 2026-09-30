import { useState } from "react";
import { X } from "lucide-react";
import { t } from "../../i18n";
import { SectionTitle } from "./piezas";
import { APPROVAL_LEVELS, type Settings as SettingsType } from "../../types";

/** Ajustes → Agente. Lo que puede hacer en la vista de Trabajo y qué carpetas
 *  no se le enseñan (la misma lista que ve el árbol de Archivos). */
export default function AjustesAgente({
  draft,
  setDraft,
}: {
  draft: SettingsType;
  setDraft: (s: SettingsType) => void;
}) {
  /** Lo escrito en el campo de «carpeta que no quiero ver», antes de añadirlo a
   *  la lista de los ajustes. */
  const [nuevaIgnorada, setNuevaIgnorada] = useState("");

  /** Añade a la lista de ignoradas lo escrito en el campo. Se guarda solo el
   *  nombre: si alguien pega `C:\\Users\\x\\My Games`, lo que compara el árbol
   *  es `My Games`, y una ruta entera no casaría con nada (Rust sanea igual al
   *  guardar, para el caso de que se edite desde fuera). */
  const anadirIgnorada = () => {
    const n = nuevaIgnorada.trim().split(/[\\/]/).pop()?.trim();
    if (!n) return;
    const actual = draft.ignoreDirs ?? [];
    if (!actual.some((d) => d.toLowerCase() === n.toLowerCase())) {
      setDraft({ ...draft, ignoreDirs: [...actual, n] });
    }
    setNuevaIgnorada("");
  };

  return (
    <>
      <SectionTitle
        title={t("Agente (modo trabajo)")}
        subtitle={t("Qué puede hacer el agente en la vista de Trabajo.")}
      />
      <section className="space-y-3">
        <div className="rounded-xl border border-base-border bg-base-card px-3 py-3 space-y-2">
          <p className="text-xs font-medium text-zinc-300">
            {t("Niveles de aprobación")}
          </p>
          <ul className="space-y-1">
            {APPROVAL_LEVELS.map((l) => (
              <li key={l.id} className="flex flex-wrap gap-x-2 text-[11px]">
                <span className="font-medium text-zinc-200">{t(l.label)}</span>
                <span className="text-zinc-500">{t(l.help)}</span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] leading-snug text-zinc-500">
            {t("Cada proyecto guarda su propio nivel; sin proyecto abierto, esto es el valor por defecto. Con «Acceso total» Hatboo no pide aprobación, pero las tools siguen encerradas en la carpeta del proyecto: el sandbox de rutas no se relaja nunca.")}
          </p>
        </div>
        <label className="flex items-start gap-3 rounded-xl border border-base-border bg-base-card px-3 py-3 cursor-pointer">
          <input
            type="checkbox"
            checked={draft.runCommandEnabled}
            onChange={(e) =>
              setDraft({ ...draft, runCommandEnabled: e.target.checked })
            }
            className="mt-0.5 accent-violet-500"
          />
          <span className="space-y-0.5">
            <span className="block text-sm text-zinc-200">
              {t("Habilitar")}{" "}
              <code className="font-mono text-accent-soft">
                run_command
              </code>
            </span>
            <span className="block text-xs text-zinc-500">
              {t("Permite que el agente ejecute comandos de shell dentro del proyecto. Desactivado por defecto. Si está habilitado, si cada comando pide aprobación lo decide el nivel de aprobación del proyecto (vista Trabajo).")}
            </span>
          </span>
        </label>
        <label className="flex items-start gap-3 rounded-xl border border-base-border bg-base-card px-3 py-3 cursor-pointer">
          <input
            type="checkbox"
            checked={!!draft.reviewPlan}
            onChange={(e) =>
              setDraft({ ...draft, reviewPlan: e.target.checked })
            }
            className="mt-0.5 accent-violet-500"
          />
          <span className="space-y-0.5">
            <span className="block text-sm text-zinc-200">
              {t("Revisar el plan antes de ejecutarlo")}
            </span>
            <span className="block text-xs text-zinc-500">
              {t("Cuando el agente propone los pasos se para y te los enseña: puedes reescribirlos, quitar alguno o añadir pasos, y con lo que salga de ahí se queda el plan. Sin esto ejecuta tal cual.")}
            </span>
          </span>
        </label>
        <div className="rounded-xl border border-base-border bg-base-card px-3 py-3">
          <p className="text-xs font-medium text-zinc-300">
            {t("Carpetas ignoradas")}
          </p>
          <p className="mt-0.5 mb-2 text-[11px] leading-snug text-zinc-500">
            {t("LA MISMA lista para las tres cosas que miran el disco: el árbol de Archivos, su buscador y `list_dir` del agente. Si una carpeta no está en el panel, tampoco la ve el agente; si la ve él, también la ves tú.")}
          </p>
          <div className="flex flex-wrap gap-1">
            {(draft.ignoreDirs ?? []).map((d) => (
              <span
                key={d}
                className="inline-flex items-center gap-1 rounded-chip border border-base-border bg-base py-0.5 pr-0.5 pl-1.5 font-mono text-[11px] text-zinc-300"
              >
                {d}
                <button
                  onClick={() =>
                    setDraft({
                      ...draft,
                      ignoreDirs: (draft.ignoreDirs ?? []).filter((x) => x !== d),
                    })
                  }
                  title={t("Quitar {n} de la lista", { n: d })}
                  className="grid h-4 w-4 place-items-center rounded text-zinc-500 transition-colors hover:bg-base-hover hover:text-zinc-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {(draft.ignoreDirs ?? []).length === 0 && (
              <span className="text-[11px] text-zinc-600">
                {t("Ninguna: el árbol y el agente lo ven todo.")}
              </span>
            )}
          </div>
          <div className="mt-2 flex gap-1">
            <input
              value={nuevaIgnorada}
              onChange={(e) => setNuevaIgnorada(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                anadirIgnorada();
              }}
              placeholder={t("nombre de carpeta")}
              className="min-w-0 flex-1 rounded-campo border border-base-border bg-base px-2 py-1 text-xs outline-none placeholder:text-zinc-600 focus:border-accent/70"
            />
            <button
              onClick={anadirIgnorada}
              disabled={!nuevaIgnorada.trim()}
              className="rounded-campo border border-base-border bg-base-raised px-2.5 py-1 text-xs text-zinc-300 transition-colors hover:border-accent/50 hover:text-zinc-100 disabled:opacity-40"
            >
              {t("Añadir")}
            </button>
          </div>
          <p className="mt-1.5 text-[11px] leading-snug text-zinc-600">
            {t("Se salta por su nombre en cualquier nivel, sin distinguir mayúsculas. Escribe una ruta y se guarda solo el último tramo.")}
          </p>
        </div>
        <p className="text-[11px] text-zinc-600">
          {t("El nivel de aprobación se ajusta por proyecto en la vista de Trabajo.")}
        </p>
      </section>
    </>
  );
}
