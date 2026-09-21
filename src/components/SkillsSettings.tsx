import { useState } from "react";
import { Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";
import { useChatStore } from "../store/chatStore";
import type { Skill } from "../types";

const NAME_MAX = 60;
const PROMPT_MAX = 2000;

/** Plantillas que se pueden añadir de un clic. Entran apagadas: no cambian el
 *  comportamiento de Hatboo hasta que el usuario las activa. */
const EXAMPLES: Array<{ name: string; prompt: string }> = [
  {
    name: "Explicar paso a paso",
    prompt:
      "Antes de ejecutar cada paso explica en una línea qué hace y por qué. Al final resume qué has hecho y qué queda pendiente.",
  },
  {
    name: "Revisión de código",
    prompt:
      "Revisa el código buscando bugs, casos sin cubrir y problemas de seguridad. Prioriza por gravedad, cita archivo y línea, y no propongas cambios de estilo.",
  },
  {
    name: "Resumen ejecutivo",
    prompt:
      "Responde primero con tres viñetas de conclusión y solo después el detalle. Si falta información para concluir, dilo antes de improvisar.",
  },
  {
    name: "Preguntar antes de asumir",
    prompt:
      "Si la petición admite dos interpretaciones, pregunta cuál quiere en vez de elegir tú una. Máximo una pregunta por turno.",
  },
];

type Draft = { id: string; name: string; prompt: string; enabled: boolean };

const BLANK: Draft = { id: "", name: "", prompt: "", enabled: true };

export default function SkillsSettings() {
  const skills = useChatStore((s) => s.skills);
  const saveSkill = useChatStore((s) => s.saveSkill);
  const setSkillEnabled = useChatStore((s) => s.setSkillEnabled);
  const removeSkill = useChatStore((s) => s.removeSkill);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const commit = async (values: Draft) => {
    setError(null);
    try {
      await saveSkill(values);
      setDraft(null);
    } catch (e) {
      setError(String(e));
    }
  };

  const toggle = async (skill: Skill, enabled: boolean) => {
    setError(null);
    try {
      await setSkillEnabled(skill.id, enabled);
    } catch (e) {
      setError(String(e));
    }
  };

  const drop = async (id: string) => {
    setError(null);
    setConfirming(null);
    try {
      await removeSkill(id);
      if (draft?.id === id) setDraft(null);
    } catch (e) {
      setError(String(e));
    }
  };

  const field =
    "w-full rounded-lg border border-base-border bg-base px-3 py-2 text-sm outline-none focus:border-accent/70";

  return (
    <section className="space-y-3">
      <p className="text-xs leading-snug text-zinc-500">
        Cada plantilla es un trozo de instrucciones escrito por ti. Si está
        activada, Hatboo la aplica en <strong className="text-zinc-400">todas</strong>{" "}
        las respuestas del chat y del modo trabajo; si no, siempre puedes
        insertarla en un mensaje concreto desde el botón «+» de la barra de chat.
      </p>

      {skills.length === 0 && !draft && (
        <div className="rounded-lg border border-dashed border-base-border px-4 py-6 text-center">
          <Sparkles className="mx-auto w-5 h-5 text-zinc-600" />
          <p className="mt-2 text-sm text-zinc-400">Todavía no tienes plantillas.</p>
          <p className="mt-0.5 text-xs text-zinc-600">
            Crea la primera o añade una de los ejemplos de abajo.
          </p>
        </div>
      )}

      <ul className="space-y-2">
        {skills.map((s) => (
          <li
            key={s.id}
            className="rounded-lg border border-base-border bg-base px-3 py-2.5"
          >
            <div className="flex items-start gap-3">
              <label className="mt-0.5 flex shrink-0 cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={s.enabled}
                  onChange={(e) => void toggle(s, e.target.checked)}
                  className="accent-violet-500"
                  title={s.enabled ? "Se aplica a cada respuesta" : "Solo se puede insertar a mano"}
                />
              </label>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-zinc-100">{s.name}</p>
                <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-zinc-500">
                  {s.prompt}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  onClick={() => {
                    setError(null);
                    setDraft({
                      id: s.id,
                      name: s.name,
                      prompt: s.prompt,
                      enabled: s.enabled,
                    });
                  }}
                  title="Editar"
                  className="rounded-md p-1.5 text-zinc-500 hover:bg-layer/8 hover:text-zinc-100 transition-colors"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                {confirming === s.id ? (
                  <button
                    onClick={() => void drop(s.id)}
                    className="rounded-md bg-red-500/15 px-2 py-1 text-[11px] text-red-300 hover:bg-red-500/25 transition-colors"
                  >
                    Confirmar
                  </button>
                ) : (
                  <button
                    onClick={() => setConfirming(s.id)}
                    title="Borrar"
                    className="rounded-md p-1.5 text-zinc-500 hover:bg-layer/8 hover:text-red-300 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {draft ? (
        <div className="space-y-2 rounded-lg border border-accent/40 bg-base-raised p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-zinc-100">
              {draft.id ? "Editar plantilla" : "Nueva plantilla"}
            </h3>
            <button
              onClick={() => {
                setDraft(null);
                setError(null);
              }}
              title="Descartar"
              className="rounded-md p-1 text-zinc-500 hover:text-zinc-100 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Nombre, p. ej. Explicar paso a paso"
            maxLength={NAME_MAX}
            className={field}
          />
          <textarea
            value={draft.prompt}
            onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
            placeholder="Qué debe hacer Hatboo cuando esta plantilla esté activa…"
            maxLength={PROMPT_MAX}
            rows={5}
            className={field + " resize-y leading-relaxed"}
          />
          <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
              className="accent-violet-500"
            />
            Aplicarla siempre (si la desactivas, sigue disponible en el menú «+» del chat)
          </label>
          <div className="flex items-center justify-between pt-0.5">
            <span className="text-[11px] text-zinc-600">
              {draft.prompt.length.toLocaleString("es")}/{PROMPT_MAX}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setDraft(null);
                  setError(null);
                }}
                className="rounded-lg border border-base-border px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-500 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => void commit(draft)}
                disabled={!draft.name.trim() || !draft.prompt.trim()}
                className="rounded-lg bg-accent px-3.5 py-1.5 text-xs font-medium text-white hover:bg-accent-dim disabled:opacity-40 transition-colors"
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          onClick={() => {
            setError(null);
            setDraft({ ...BLANK });
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-base-border px-3 py-1.5 text-xs text-zinc-300 hover:border-accent/50 hover:text-layer transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Nueva plantilla
        </button>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      {!draft && EXAMPLES.length > 0 && (
        <div className="pt-1">
          <p className="mb-1.5 text-[10px] uppercase tracking-wider text-zinc-600">
            Ejemplos para añadir
          </p>
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex) => (
              <button
                key={ex.name}
                onClick={() => void commit({ id: "", ...ex, enabled: false })}
                title={ex.prompt}
                className="rounded-full border border-base-border bg-base-raised/60 px-2.5 py-1 text-[11px] text-zinc-400 hover:text-zinc-100 hover:border-accent/50 transition-colors"
              >
                + {ex.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
