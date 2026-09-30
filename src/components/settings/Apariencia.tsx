import { t } from "../../i18n";
import ThemePicker from "../ThemePicker";
import { SectionTitle } from "./piezas";
import type { ThemeChoice } from "../../theme";
import {
  ACENTO_OPCIONES,
  BUBBLE_STYLES,
  CHAT_FONTS,
  CHAT_FONT_SIZES,
  CHAT_FONT_STACKS,
  DENSIDAD_OPCIONES,
  LANGUAGE_OPTIONS,
  type LanguageChoice,
  type Settings as SettingsType,
} from "../../types";

/** Ajustes → Apariencia. Todo esto se aplica al pulsar, no al guardar: lo que se
 *  ve en la pantalla es lo que ya está pintado. */
export default function AjustesApariencia({
  draft,
  patchAppearance,
  saveErr,
}: {
  draft: SettingsType;
  patchAppearance: (part: Partial<SettingsType>) => Promise<void>;
  saveErr: string | null;
}) {
  return (
    <>
      <SectionTitle
        title="Apariencia"
        subtitle={t("Cómo se ve Hatboo. Se aplica al momento: no hay botón de guardar.")}
      />
      <section className="space-y-3">
        <div className="rounded-xl border border-base-border bg-base-card px-3 py-3">
          <p className="text-sm text-zinc-200">{t("Tema")}</p>
          <p className="mt-0.5 mb-2.5 text-xs text-zinc-500">
            {t("«Sistema» sigue el claro/oscuro de Windows mientras la app esté abierta. Las paletas de debajo son fijas y se aplican al pulsarlas.")}
          </p>
          <ThemePicker
            value={(draft.theme || "dark") as ThemeChoice}
            onChange={(id) => void patchAppearance({ theme: id })}
          />
        </div>

        <div className="rounded-xl border border-base-border bg-base-card px-3 py-3">
          <p className="text-sm text-zinc-200">{t("Densidad")}</p>
          <p className="mt-0.5 mb-2.5 text-xs text-zinc-500">
            {t("«Compacta» baja el tamaño base del documento, y con él todo el espaciado: no es letra más pequeña en un sitio, es la interfaz entera más apretada.")}
          </p>
          <div className="flex gap-1">
            {DENSIDAD_OPCIONES.map((d) => (
              <button
                key={d.id}
                onClick={() => void patchAppearance({ densidad: d.id })}
                aria-pressed={(draft.densidad || "comoda") === d.id}
                className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                  (draft.densidad || "comoda") === d.id
                    ? "bg-accent/20 text-accent-soft"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {t(d.label)}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-base-border bg-base-card px-3 py-3">
          <p className="text-sm text-zinc-200">{t("Acento")}</p>
          <p className="mt-0.5 mb-2.5 text-xs text-zinc-500">
            {t("Cuatro colores, no uno a mano: cada trío está medido contra el fondo de las nueve paletas, así que el texto de acento aguanta el contraste sea cual sea la que uses.")}
          </p>
          <div className="flex flex-wrap gap-1">
            {ACENTO_OPCIONES.map((a) => {
              const activo = (draft.acento || "violeta") === a.id;
              return (
                <button
                  key={a.id}
                  onClick={() => void patchAppearance({ acento: a.id })}
                  aria-pressed={activo}
                  title={
                    a.id === "violeta"
                      ? t("El violeta que ya trae cada paleta")
                      : t("{n} fijo, sobre cualquier paleta", { n: a.label })
                  }
                  className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors ${
                    activo
                      ? "border-accent/60 bg-accent/15 text-zinc-100"
                      : "border-base-border text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {/* La muestra es el color en sí; el `border` de dentro
                      le da borde a la muestra sobre fondos oscuros y
                      claros sin añadir un contenedor más. */}
                  <span
                    aria-hidden
                    className="inline-block h-3 w-3 rounded-full ring-1 ring-inset ring-black/25"
                    style={{ background: a.muestra }}
                  />
                  {t(a.label)}
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-base-border bg-base-card px-3 py-3">
          <p className="text-sm text-zinc-200">{t("Idioma")}</p>
          <p className="mt-0.5 mb-2.5 text-xs text-zinc-500">
            {t(
              "«Sistema» sigue el idioma de Windows. No cambia lo que escribe el modelo: eso se le pide en cada charla.",
            )}
          </p>
          <div className="flex gap-1">
            {LANGUAGE_OPTIONS.map((o) => (
              <button
                key={o.id}
                onClick={() =>
                  void patchAppearance({ uiLanguage: o.id as LanguageChoice })
                }
                className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                  (draft.uiLanguage || "system") === o.id
                    ? "bg-accent/20 text-accent-soft"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {o.id === "system" ? t("Sistema") : o.label}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-base-border bg-base-card px-3 py-3">
          <p className="text-sm text-zinc-200">{t("Tamaño del texto del chat")}</p>
          <p className="mt-0.5 mb-2.5 text-xs text-zinc-500">
            {t("Afecta a las respuestas y a tus mensajes; el código va dos puntos por debajo.")}
          </p>
          <div className="flex gap-1">
            {CHAT_FONT_SIZES.map((f) => (
              <button
                key={f.id}
                onClick={() => void patchAppearance({ chatFontSize: f.id })}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  (draft.chatFontSize || "md") === f.id
                    ? "bg-accent/20 text-accent-soft"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
                style={{ fontSize: f.px * 0.8 }}
              >
                {t(f.label)}
              </button>
            ))}
          </div>
          <p className="mt-3 mb-1.5 text-xs text-zinc-500">{t("Fuente")}</p>
          <div className="flex gap-1">
            {CHAT_FONTS.map((f) => (
              <button
                key={f.id}
                onClick={() =>
                  void patchAppearance({ chatFontFamily: f.id })
                }
                className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                  (draft.chatFontFamily || "sans") === f.id
                    ? "bg-accent/20 text-accent-soft"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
                style={{ fontFamily: CHAT_FONT_STACKS[f.id] }}
              >
                {t(f.label)}
              </button>
            ))}
          </div>
          <p
            className="mt-2.5 text-zinc-300"
            style={{
              fontSize:
                CHAT_FONT_SIZES.find(
                  (f) => f.id === (draft.chatFontSize || "md"),
                )?.px ?? 15,
              fontFamily:
                CHAT_FONT_STACKS[draft.chatFontFamily || "sans"],
            }}
          >
            {t("Ejemplo: así se vería una respuesta de Hatboo.")}
          </p>
        </div>

        <div className="rounded-xl border border-base-border bg-base-card px-3 py-3">
          <p className="text-sm text-zinc-200">{t("Tus mensajes")}</p>
          <p className="mt-0.5 mb-2.5 text-xs text-zinc-500">
            {t("Cada tarjeta enseña cómo queda; se aplica al momento.")}
          </p>
          <div className="flex flex-wrap gap-2">
            {BUBBLE_STYLES.map((b) => (
              <button
                key={b.id}
                onClick={() => void patchAppearance({ bubbleStyle: b.id })}
                title={t(b.help)}
                className={`min-w-[150px] flex-1 rounded-lg border p-2.5 text-left transition-colors ${
                  (draft.bubbleStyle || "solida") === b.id
                    ? "border-accent/60 bg-accent/10"
                    : "border-base-border hover:border-zinc-600"
                }`}
              >
                <span
                  className={`inline-block max-w-full truncate px-3 py-1.5 text-xs ${
                    b.id === "solida"
                      ? "rounded-3xl bg-accent-dim text-white"
                      : "rounded-xl border border-accent/40 bg-accent/20 text-layer"
                  }`}
                >
                  {t("Hola, Hatboo")}
                </span>
                <span className="mt-2 block text-[11px] text-zinc-500">
                  {t(b.label)}
                </span>
              </button>
            ))}
          </div>
        </div>
        {saveErr && <p className="text-xs text-red-400">{saveErr}</p>}
      </section>
    </>
  );
}
