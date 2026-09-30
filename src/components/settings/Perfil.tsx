import { t, currentLanguage } from "../../i18n";
import Avatar from "../Avatar";
import Bloque from "../Bloque";
import Select from "../Select";
import PerfilEstadisticas from "../PerfilEstadisticas";
import { SectionTitle } from "./piezas";
import {
  AVATAR_COLORS,
  AVATAR_STYLES,
  type AvatarStyle,
  type Settings as SettingsType,
} from "../../types";

/** El saludo de ejemplo se compone aquí, no se traduce: es texto que escribiría
 *  el modelo, no interfaz. Con `auto` se enseña en el idioma de la app, que es lo
 *  más parecido a «el mismo en que le escribas» que se puede pintar en seco. */
function saludoDeMuestra(
  idioma: "es" | "en",
  usted: boolean,
  nombre?: string,
): string {
  const quien = nombre ? `, ${nombre}` : "";
  if (idioma === "en") {
    return usted ? `Hello${quien}. How may I help you?` : `Hi${quien}. What can I help you with?`;
  }
  return usted ? `Hola${quien}. ¿En qué puedo ayudarle?` : `Hola${quien}. ¿En qué te echo una mano?`;
}

/** Cómo suena Hatboo con estos ajustes, antes de guardar. La frase real la
 *  compone el modelo; de aquí salen el nombre, el trato y el idioma. */
function SaludoPrevio({ draft }: { draft: SettingsType }) {
  const idioma: "es" | "en" =
    draft.answerLanguage === "en"
      ? "en"
      : draft.answerLanguage === "es"
        ? "es"
        : currentLanguage();
  const frase = saludoDeMuestra(
    idioma,
    draft.userAddress === "usted",
    draft.assistantName?.trim() || undefined,
  );

  return (
    <Bloque
      titulo={t("Vista previa")}
      descripcion={t(
        "Un ejemplo de cómo suena con estos ajustes. La frase exacta la compone el modelo.",
      )}
    >
      <div className="flex gap-2.5">
        <span className="mt-0.5 shrink-0">
          <Avatar
            style={(draft.avatarStyle || "mascota") as AvatarStyle}
            colorId={draft.avatarColor || "violeta"}
            emoji={draft.avatarEmoji || "🎩"}
            name="Hatboo"
            size={24}
          />
        </span>
        <p className="min-w-0 flex-1 rounded-2xl rounded-tl-md border border-base-border bg-base-raised px-3.5 py-2.5 text-sm text-zinc-200">
          {frase}
        </p>
      </div>
      {draft.answerLanguage === "auto" && (
        <p className="mt-2 text-[11px] text-zinc-600">
          {t(
            "Con «el mismo en que le escribas», aquí se ve en el idioma de la interfaz.",
          )}
        </p>
      )}
    </Bloque>
  );
}

/** Ajustes → Perfil. Cómo te llama, cómo te habla y con qué cara. */
export default function AjustesPerfil({
  draft,
  setDraft,
  field,
}: {
  draft: SettingsType;
  setDraft: (s: SettingsType) => void;
  field: string;
}) {
  return (
    <>
      <SectionTitle title="Perfil" subtitle={t("Cómo te trata Hatboo.")} />
      <SaludoPrevio draft={draft} />

      <Bloque
        titulo={t("Cómo te llama")}
        descripcion={t(
          "Se añade al prompt del chat y del agente para que te trate por ese nombre. Solo local.",
        )}
      >
        <label className="block space-y-1">
          <span className="text-xs text-zinc-500">
            {t("¿Cómo debería llamarte Hatboo?")}
          </span>
          <input
            value={draft.assistantName ?? ""}
            maxLength={40}
            onChange={(e) =>
              setDraft({ ...draft, assistantName: e.target.value })
            }
            className={field}
            placeholder={t("p. ej. Azrael (vacío = sin nombre)")}
          />
        </label>

        {/* La ambigüedad que hay que cortar: un modelo chico leía el nombre
            y se presentaba con él. Que quede escrito en la propia pantalla. */}
        <p className="mt-2 text-[11px] text-zinc-500">
          {t("Hatboo te llamará «{n}». Él sigue llamándose Hatboo.", {
            n: draft.assistantName?.trim() || t("como quieras"),
          })}
        </p>
      </Bloque>

      <Bloque
        titulo={t("Cómo te habla")}
        descripcion={t("Trato e idioma de las respuestas.")}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="block space-y-1">
            <span className="text-xs text-zinc-500">
              {t("¿De qué forma te habla?")}
            </span>
            <Select
              valor={draft.userAddress || "tú"}
              alCambiar={(v) => setDraft({ ...draft, userAddress: v })}
              size="md"
              ariaLabel={t("¿De qué forma te habla?")}
              opciones={[
                {
                  valor: "tú",
                  etiqueta: t("De tú"),
                  detalle: t("Cercano: «puedes pedirme…»"),
                },
                {
                  valor: "usted",
                  etiqueta: t("De usted"),
                  detalle: t("Formal: «puede pedirme…»"),
                },
              ]}
            />
          </div>
          <div className="block space-y-1">
            <span className="text-xs text-zinc-500">
              {t("Idioma de las respuestas")}
            </span>
            <Select
              valor={draft.answerLanguage || "auto"}
              alCambiar={(v) => setDraft({ ...draft, answerLanguage: v })}
              size="md"
              ariaLabel={t("Idioma de las respuestas")}
              opciones={[
                {
                  valor: "auto",
                  etiqueta: t("El mismo en que le escribas"),
                  detalle: t("Se decide mensaje a mensaje"),
                },
                {
                  valor: "es",
                  etiqueta: t("Siempre español"),
                  detalle: t("Aunque le escribas en otro idioma"),
                },
                {
                  valor: "en",
                  etiqueta: t("Siempre inglés"),
                  detalle: t("Aunque le escribas en otro idioma"),
                },
              ]}
            />
          </div>
        </div>
      </Bloque>

      <Bloque titulo={t("Sobre ti")}>
        <label className="block space-y-1">
          <span className="text-xs text-zinc-500">
            {t("Una línea sobre ti (opcional)")}
          </span>
          <textarea
            rows={2}
            maxLength={200}
            value={draft.userNotes ?? ""}
            onChange={(e) => setDraft({ ...draft, userNotes: e.target.value })}
            className={`${field} resize-none`}
            placeholder={t("p. ej. Estudio programación; prefiero ejemplos cortos")}
          />
        </label>
        <div className="mt-1 flex items-start justify-between gap-3">
          <span className="min-w-0 text-[11px] text-zinc-600">
            {t(
              "200 caracteres como mucho. Va solo al chat: un modelo pequeño mezcla una biografía larga con las reglas del agente.",
            )}
          </span>
          {/* Lo que falta se ve mientras se escribe, no al pasarse. */}
          <span className="shrink-0 text-[11px] tabular-nums text-zinc-500">
            {(draft.userNotes ?? "").length}/200
          </span>
        </div>
      </Bloque>

      <Bloque
        titulo={t("Avatar")}
        descripcion={t(
          "Sin subir un archivo: color de una paleta fija y qué se pinta encima. Se ve en la tarjeta de perfil del lateral.",
        )}
      >
        <div className="flex items-center gap-3">
          <Avatar
            style={(draft.avatarStyle || "mascota") as AvatarStyle}
            colorId={draft.avatarColor || "violeta"}
            emoji={draft.avatarEmoji || "🎩"}
            name={draft.assistantName?.trim() || "Hatboo"}
            size={44}
          />
          <div
            role="radiogroup"
            aria-label={t("Estilo del avatar")}
            className="flex gap-1"
          >
            {AVATAR_STYLES.map((a) => (
              <button
                key={a.id}
                role="radio"
                aria-checked={(draft.avatarStyle || "mascota") === a.id}
                onClick={() => setDraft({ ...draft, avatarStyle: a.id })}
                className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                  (draft.avatarStyle || "mascota") === a.id
                    ? "bg-accent/20 text-accent-soft"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {t(a.label)}
              </button>
            ))}
          </div>
        </div>

        <div
          role="radiogroup"
          aria-label={t("Color del avatar")}
          className="mt-3 flex gap-1.5"
        >
          {AVATAR_COLORS.map((c) => (
            <button
              key={c.id}
              role="radio"
              aria-checked={(draft.avatarColor || "violeta") === c.id}
              onClick={() => setDraft({ ...draft, avatarColor: c.id })}
              title={t(c.label)}
              aria-label={t(c.label)}
              className={`w-6 h-6 rounded-full transition-shadow ${
                (draft.avatarColor || "violeta") === c.id
                  ? "ring-2 ring-offset-2 ring-accent ring-offset-base"
                  : "hover:scale-110"
              }`}
              style={{ background: c.bg }}
            />
          ))}
        </div>

        {draft.avatarStyle === "emoji" && (
          <label className="block space-y-1 mt-3">
            <span className="text-xs text-zinc-500">{t("Emoji")}</span>
            <input
              value={draft.avatarEmoji ?? "🎩"}
              maxLength={4}
              onChange={(e) =>
                setDraft({ ...draft, avatarEmoji: e.target.value })
              }
              className={field + " w-24 text-center text-lg"}
            />
          </label>
        )}
      </Bloque>

      <PerfilEstadisticas />
    </>
  );
}
