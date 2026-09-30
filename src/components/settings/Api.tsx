import { t } from "../../i18n";
import Select from "../Select";
import Bloque from "../Bloque";
import { useChatStore } from "../../store/chatStore";
import { SectionTitle } from "./piezas";
import { ApiKeyField, LocalModelField, ModeloTexto, SelectorProveedor } from "./camposApi";
import {
  REASONING_LEVELS,
  esfuerzoVisible,
  type Settings as SettingsType,
} from "../../types";
import {
  PROVEEDORES,
  MOTORES_IMAGEN,
  motorImagen,
  tamanosImagen,
  MOTORES_VOZ,
  motorVoz,
  modeloActivo,
  soportaVision,
  visionDeclarada,
  ventanaContexto,
} from "../../proveedores";

type Meta = (typeof PROVEEDORES)[number];

/** Qué se puede decir de las capacidades del modelo activo, y de dónde sale.
 *  No se inventa nada: si no lo sabemos, se dice que no lo sabemos y se le
 *  pregunta a él, que es quien tiene el modelo delante. */
function Capacidades({
  draft,
  setDraft,
}: {
  draft: SettingsType;
  setDraft: (s: SettingsType) => void;
}) {
  const locales = useChatStore((s) => s.localModels);
  const modelo = modeloActivo(draft).trim();
  const ve = soportaVision(draft, locales);
  const declarado = visionDeclarada(draft, modelo);
  const ctx = ventanaContexto(draft, locales);

  // De dónde viene el «sí» de la visión: importa decirlo, porque un «sí» por
  // nombre es una suposición y un «sí» de Ollama es un dato.
  const origen = declarado
    ? t("Lo declaraste tú abajo.")
    : !ve
      ? draft.activeProvider === "local"
        ? t("Ollama no lo declara y el nombre tampoco lo dice.")
        : t("No lo sabemos: si tu modelo lee imágenes, márcalo.")
      : draft.activeProvider === "anthropic" ||
          draft.activeProvider === "openai" ||
          draft.activeProvider === "gemini"
        ? t("Este proveedor las ve en toda su gama.")
        : draft.activeProvider === "local"
          ? t("Ollama declara que ve imágenes.")
          : t("Deducido del nombre del modelo.");

  const marcar = (on: boolean) => {
    const otro = (draft.visionModelos ?? []).filter(
      (m) => m.trim().toLowerCase() !== modelo.toLowerCase(),
    );
    setDraft({ ...draft, visionModelos: on ? [...otro, modelo] : otro });
  };

  const fila = "flex items-start justify-between gap-4 py-2";
  const etiqueta = "text-sm text-zinc-200";
  const detalle = "mt-0.5 text-[11px] leading-snug text-zinc-500";

  return (
    <div className="mt-3 rounded-xl border border-base-border bg-base px-3 py-1.5">
      <div className={fila}>
        <div className="min-w-0">
          <p className={etiqueta}>{t("Lee imágenes")}</p>
          <p className={detalle}>
            {modelo ? origen : t("Apunta un modelo para poder decirlo.")}
          </p>
        </div>
        <label className="flex shrink-0 cursor-pointer items-center gap-2 pt-0.5">
          <input
            type="checkbox"
            checked={ve}
            disabled={!modelo}
            onChange={(e) => marcar(e.target.checked)}
            className="accent-violet-500"
          />
          <span className="text-xs text-zinc-400">{declarado ? t("declarado") : t("por nombre")}</span>
        </label>
      </div>
      <div className="h-px bg-base-border" />
      <div className={`${fila} border-0`}>
        <div className="min-w-0">
          <p className={etiqueta}>{t("Ventana de contexto")}</p>
          <p className={detalle}>
            {ctx.tokens > 0
              ? t("{n} tokens · sacado de {fuente}", {
                  n: ctx.tokens.toLocaleString("es"),
                  fuente:
                    ctx.fuente === "num_ctx"
                      ? t("el `num_ctx` con el que arranca Ollama")
                      : ctx.fuente === "nativa"
                        ? t("la ficha del modelo")
                        : t("la tabla pública del proveedor"),
                })
              : t("No la conocemos: el medidor se queda en tokens sin porcentaje.")}
          </p>
        </div>
      </div>
    </div>
  );
}

/** Ajustes → API y modelos. */
export default function AjustesApi({
  draft,
  setDraft,
  field,
  activeProviderMeta,
}: {
  draft: SettingsType;
  setDraft: (s: SettingsType) => void;
  field: string;
  activeProviderMeta: Meta | undefined;
}) {
  return (
    <>
      <SectionTitle
        title={t("API y modelos")}
        subtitle={t("Proveedor de IA, credenciales y modelos.")}
      />
      <SelectorProveedor draft={draft} setDraft={setDraft} />

      {activeProviderMeta?.needsKey && (
        <Bloque
          titulo={t("Credenciales")}
          descripcion={t(
            "Las keys se guardan en el llavero del sistema operativo, nunca en la base de datos.",
          )}
        >
          <ApiKeyField provider={draft.activeProvider} />
        </Bloque>
      )}

      <Bloque
        titulo={t("Modelo activo")}
        descripcion={t("Lo que responde ahora mismo, y lo que se le sabe.")}
      >
        {activeProviderMeta?.id === "local" ? (
          <LocalModelField
            draft={draft}
            field={field}
            onChange={(model) => setDraft({ ...draft, localModel: model })}
          />
        ) : activeProviderMeta ? (
          <>
            <ModeloTexto
              etiqueta={t("Modelo de {p}", { p: activeProviderMeta.corto })}
              valor={draft[activeProviderMeta.modelo]}
              placeholder={activeProviderMeta.ejemplo}
              proveedor={activeProviderMeta.id}
              endpoint={
                activeProviderMeta.endpoint
                  ? draft[activeProviderMeta.endpoint]
                  : undefined
              }
              ayuda={
                activeProviderMeta.ayudaModelo
                  ? t(activeProviderMeta.ayudaModelo)
                  : undefined
              }
              onChange={(v) =>
                setDraft({
                  ...draft,
                  [activeProviderMeta.modelo]: v,
                } as SettingsType)
              }
            />
            {/* Solo Hugging Face tiene base editable: los demás llevan
                la suya fija en el backend. */}
            {activeProviderMeta.endpoint === "hfEndpoint" && (
              <ModeloTexto
                etiqueta={t("Endpoint compatible con OpenAI")}
                valor={draft.hfEndpoint}
                onChange={(v) => setDraft({ ...draft, hfEndpoint: v })}
                ayuda={t(
                  "Por defecto el router de Hugging Face; vale también para cualquier servidor propio que hable /v1/chat/completions.",
                )}
              />
            )}
          </>
        ) : null}
        <Capacidades draft={draft} setDraft={setDraft} />
      </Bloque>

      {/* Uno solo, no seis: cambiar de proveedor no obliga a volver
          a escribir su modelo, pero tampoco hace falta verlo siempre. */}
      <details className="rounded-xl border border-base-border bg-base-card px-3 py-2">
        <summary className="cursor-pointer text-xs text-zinc-500">
          {t("Modelos de los otros proveedores")}
        </summary>
        <div className="mt-3 space-y-3">
          {PROVEEDORES.filter((p) => p.id !== draft.activeProvider).map((p) =>
            p.id === "local" ? (
              <div key={p.id} className="space-y-1">
                <span className="text-xs text-zinc-500">{t("Modelo local")}</span>
                <LocalModelField
                  draft={draft}
                  field={field}
                  onChange={(model) => setDraft({ ...draft, localModel: model })}
                />
              </div>
            ) : (
              <ModeloTexto
                key={p.id}
                etiqueta={t("Modelo de {p}", { p: p.corto })}
                valor={draft[p.modelo]}
                placeholder={p.ejemplo}
                proveedor={p.id}
                endpoint={p.endpoint ? draft[p.endpoint] : undefined}
                onChange={(v) =>
                  setDraft({ ...draft, [p.modelo]: v } as SettingsType)
                }
              />
            ),
          )}
        </div>
      </details>

      <Bloque titulo={t("Razonamiento")}>
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm text-zinc-300">{t("Pensamiento extendido")}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
              {t(
                "Pide al modelo que razone antes de responder, en el chat y también en el modo trabajo. Solo funciona con modelos que lo soportan. En el agente cuesta más caro: piensa en cada uno de sus vueltas, no una sola vez.",
              )}
            </p>
          </div>
          <div
            role="radiogroup"
            aria-label={t("Razonamiento")}
            className="flex shrink-0 flex-wrap justify-end gap-0.5 rounded-lg border border-base-border bg-base-raised p-0.5"
          >
            {REASONING_LEVELS.map((l) => {
              const elegido = esfuerzoVisible(draft.reasoningEffort) === l.id;
              return (
                <button
                  key={l.id}
                  role="radio"
                  aria-checked={elegido}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      reasoningEffort: l.id,
                    })
                  }
                  className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                    elegido
                      ? "bg-accent/20 text-accent-soft"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {t(l.label)}
                </button>
              );
            })}
          </div>
        </div>
      </Bloque>

      <Bloque
        titulo={t("Motor de imágenes")}
        descripcion={t(
          "Lo que usa el botón «Generar imagen» del chat. No tiene nada que ver con el proveedor del texto: la clave se pide a la que ya tengas guardada arriba, y lo que cobra cada uno va aparte.",
        )}
      >
        <div className="space-y-3">
          <div className="block space-y-1">
            <span className="text-xs text-zinc-500">{t("Motor")}</span>
            <Select
              valor={draft.imageProvider || "off"}
              alCambiar={(v) => {
                const m = motorImagen(v);
                // Al mudar de motor se van el modelo y el tamaño: la
                // escuadra de Gemini no existe en OpenAI y al revés.
                setDraft({
                  ...draft,
                  imageProvider: m ? v : "",
                  imageModel: m?.modeloPorDefecto ?? "",
                  imageSize: "1024x1024",
                });
              }}
              size="md"
              ariaLabel={t("Motor de imágenes")}
              opciones={[
                {
                  valor: "off",
                  etiqueta: t("Apagado"),
                  detalle: t("El botón del chat avisa y no gasta nada"),
                },
                ...MOTORES_IMAGEN.map((m) => ({
                  valor: m.id,
                  etiqueta: m.corto,
                  detalle: t(m.precio),
                })),
              ]}
            />
          </div>
          {/* Si el proveedor que ya tiene clave sabe dibujar, no hace falta ir a
              buscarlo a la lista: un botón lo pone. Sin esto, quien lleva Gemini
              o OpenAI puesto ve «Ajustes → API» en el menú + sin saber que ahí
              mismo estaba el interruptor. */}
          {!draft.imageProvider &&
            (draft.activeProvider === "gemini" || draft.activeProvider === "openai") && (
              <button
                onClick={() =>
                  setDraft({
                    ...draft,
                    imageProvider: draft.activeProvider,
                    imageModel:
                      motorImagen(draft.activeProvider)?.modeloPorDefecto ?? "",
                    imageSize: "1024x1024",
                  })
                }
                className="rounded-lg border border-base-border bg-base-raised px-2.5 py-1.5 text-xs text-zinc-300 transition-colors hover:border-accent/50 hover:text-zinc-100"
              >
                {t("Usar {p} para dibujar", { p: activeProviderMeta?.corto ?? "" })}
              </button>
            )}
          {motorImagen(draft.imageProvider) && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="block space-y-1">
                <span className="text-xs text-zinc-500">{t("Modelo")}</span>
                <Select
                  valor={draft.imageModel}
                  alCambiar={(v) =>
                    setDraft({
                      ...draft,
                      imageModel: v,
                      imageSize: "1024x1024",
                    })
                  }
                  size="md"
                  ariaLabel={t("Modelo de imagen")}
                  opciones={(
                    motorImagen(draft.imageProvider)?.modelos ?? []
                  ).map((m) => ({ valor: m, etiqueta: m }))}
                />
              </div>
              <div className="block space-y-1">
                <span className="text-xs text-zinc-500">{t("Tamaño")}</span>
                <Select
                  valor={
                    tamanosImagen(draft.imageProvider, draft.imageModel).includes(
                      draft.imageSize,
                    )
                      ? draft.imageSize
                      : "1024x1024"
                  }
                  alCambiar={(v) => setDraft({ ...draft, imageSize: v })}
                  size="md"
                  ariaLabel={t("Tamaño de la imagen")}
                  opciones={tamanosImagen(
                    draft.imageProvider,
                    draft.imageModel,
                  ).map((s) => ({
                    valor: s,
                    etiqueta: s,
                    detalle:
                      s === "1024x1024"
                        ? t("cuadrada")
                        : /x1024$|x720$/.test(s)
                          ? t("apaisada")
                          : t("vertical"),
                  }))}
                />
              </div>
            </div>
          )}
        </div>
      </Bloque>

      <Bloque
        titulo={t("Motor de voz")}
        descripcion={t(
          "El botón del altavoz de cada respuesta. Apagado usa las voces que trae Windows: gratis y sin internet. Encenderlo pide la voz a la nube, y ahí se cobra por caracteres leídos.",
        )}
      >
        <div className="space-y-3">
          <div className="block space-y-1">
            <span className="text-xs text-zinc-500">{t("Motor")}</span>
            <Select
              valor={draft.audioProvider || "off"}
              alCambiar={(v) => {
                const m = motorVoz(v);
                setDraft({
                  ...draft,
                  audioProvider: m ? v : "",
                  audioModel: m?.modeloPorDefecto ?? "",
                  audioVoice: m?.voces[0] ?? "",
                });
              }}
              size="md"
              ariaLabel={t("Motor de voz")}
              opciones={[
                {
                  valor: "off",
                  etiqueta: t("Apagado (voz del sistema)"),
                  detalle: t("Gratis, sin red"),
                },
                ...MOTORES_VOZ.map((m) => ({
                  valor: m.id,
                  etiqueta: m.corto,
                  detalle: t(m.precio),
                })),
              ]}
            />
          </div>
          {motorVoz(draft.audioProvider) && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="block space-y-1">
                  <span className="text-xs text-zinc-500">{t("Modelo de voz")}</span>
                  <Select
                    valor={draft.audioModel}
                    alCambiar={(v) => setDraft({ ...draft, audioModel: v })}
                    size="md"
                    ariaLabel={t("Modelo de voz")}
                    opciones={(motorVoz(draft.audioProvider)?.modelos ?? []).map(
                      (m) => ({ valor: m, etiqueta: m }),
                    )}
                  />
                </div>
                <div className="block space-y-1">
                  <span className="text-xs text-zinc-500">{t("Voz")}</span>
                  <Select
                    valor={draft.audioVoice}
                    alCambiar={(v) => setDraft({ ...draft, audioVoice: v })}
                    size="md"
                    cap={320}
                    ariaLabel={t("Voz del lector")}
                    opciones={(motorVoz(draft.audioProvider)?.voces ?? []).map(
                      (v) => ({ valor: v, etiqueta: v }),
                    )}
                  />
                </div>
              </div>
              <p className="text-xs leading-relaxed text-zinc-500">
                {t(
                  "Una respuesta de 1.500 caracteres sale por unos 0,02 $. Lo que ya se escuchó queda guardado en el disco y no vuelve a cobrarse.",
                )}
              </p>
            </>
          )}
        </div>
      </Bloque>

      <Bloque
        titulo={t("Servidor local")}
        descripcion={t("Dónde escucha Ollama o llama.cpp en este equipo.")}
      >
        <ModeloTexto
          etiqueta={t("Endpoint (compatible con Ollama / llama.cpp)")}
          valor={draft.localEndpoint}
          placeholder="http://localhost:11434"
          onChange={(v) => setDraft({ ...draft, localEndpoint: v })}
        />
      </Bloque>
    </>
  );
}
