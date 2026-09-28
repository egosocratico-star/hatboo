import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Gauge } from "lucide-react";
import { t } from "../i18n";
import Popover from "./Popover";
import { useChatStore } from "../store/chatStore";
import { ventanaContexto } from "../proveedores";

interface Usage {
  chars: number;
  estTokens: number;
  messages: number;
  images: number;
  systemChars: number;
  historyChars: number;
}

function miles(n: number): string {
  if (n < 1000) return String(n);
  return (n / 1000).toFixed(1).replace(".", ",") + " mil";
}

/**
 * Barra partida en lo que se puede quitar y lo que no. Una sola barra llena
 * hasta el 82 % no dice si eso es culpa del historial (se resuelve) o del traje
 * fijo (se rediseña), que son dos avisos distintos. El tercer tramo es lo que
 * aún no se ha enviado: ninguno de los medidores que se ven por ahí avisa de
 * esto hasta que ya se ha mandado el turno.
 */
function Barra({
  fijo,
  historial,
  borrador,
  alto,
  ancha,
}: {
  fijo: number;
  historial: number;
  borrador: number;
  alto: string;
  ancha: string;
}) {
  // La conversación se pinta con el color de la presión: lo que llena la barra
  // es lo que llena la ventana, y el traje fijo queda siempre en morado.
  const presion = fijo + historial;
  const color =
    presion > 90 ? "bg-red-400" : presion > 70 ? "bg-amber-400" : "bg-accent-soft";
  return (
    <span
      className={`flex ${ancha} ${alto} shrink-0 overflow-hidden rounded-full bg-base-border`}
    >
      {fijo > 0 && <span style={{ width: `${Math.min(100, fijo)}%` }} className="h-full bg-accent" />}
      {historial > 0 && (
        <span style={{ width: `${Math.min(100, historial)}%` }} className={`h-full ${color}`} />
      )}
      {borrador > 0 && (
        <span
          style={{ width: `${Math.min(100, borrador)}%` }}
          className="h-full bg-accent-soft/40"
        />
      )}
    </span>
  );
}

/** Una fila de la leyenda: su color, su nombre y lo que manda. */
function Leyenda({ color, nombre, valor }: { color: string; nombre: string; valor: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className={`h-2 w-2 shrink-0 rounded-full ${color}`} />
      <span className="min-w-0 flex-1 truncate text-zinc-500">{nombre}</span>
      <span className="shrink-0 tabular-nums text-zinc-300">{valor}</span>
    </div>
  );
}

/**
 * Cuánto ocupa el prompt del próximo turno y cuánto le cabe al modelo. El número
 * lo calcula el backend con el mismo `history()` que se envía y ya partido en
 * traje fijo y conversación; la ventana la declara el propio modelo (Ollama en
 * `/api/show`, y una tabla corta para la nube).
 *
 * Sin ventana no hay porcentaje: los ejemplos de otros editores pintan un 82 %
 * sobre un número que se inventan. Aquí el porcentaje solo sale cuando el modelo
 * lo declara, y si no se leen tokens, que es lo único cierto.
 */
export default function ContextMeter({
  conversationId,
  tick,
}: {
  conversationId: string | null;
  tick: number;
}) {
  const [uso, setUso] = useState<Usage | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const settings = useChatStore((s) => s.settings);
  const localModels = useChatStore((s) => s.localModels);
  // Lo que se está escribiendo todavía no ha viajado, pero ya se puede medir:
  // es la parte del turno que depende de lo que se deje de escribir.
  const borrador = useChatStore((s) => s.drafts[conversationId ?? "nueva"] ?? "");

  useEffect(() => {
    if (!conversationId) {
      setUso(null);
      return;
    }
    let vivo = true;
    void invoke<Usage>("context_usage", { conversationId }).then(
      (u) => vivo && setUso(u),
      () => vivo && setUso(null),
    );
    return () => {
      vivo = false;
    };
  }, [conversationId, tick]);

  // Sin conversación no hay nada que medir: en un chat nuevo el contador no
  // aparece hasta que hay historial que contar.
  if (!uso || uso.chars < 400 || !settings) return null;

  const tokensFijos = Math.round(uso.systemChars / 4);
  const tokensHistoria = Math.round(uso.historyChars / 4);
  const ventana = ventanaContexto(settings, localModels);
  const tokens = ventana.tokens;
  const porcentaje =
    tokens > 0 ? Math.min(100, Math.round((uso.estTokens / tokens) * 100)) : null;
  const pFijo = tokens > 0 ? Math.min(100, (tokensFijos / tokens) * 100) : 0;
  const pHistoria = tokens > 0 ? Math.min(100 - pFijo, (tokensHistoria / tokens) * 100) : 0;
  const tokensBorrador = Math.round([...borrador].length / 4);
  const pBorrador =
    tokens > 0 ? Math.min(100 - pFijo - pHistoria, (tokensBorrador / tokens) * 100) : 0;
  // Con el 90 % encima el recorte es inminente: el color del número avisa antes
  // de que haya que leer la barra.
  const tono =
    porcentaje === null
      ? "text-zinc-500"
      : porcentaje > 90
        ? "text-red-400"
        : porcentaje > 70
          ? "text-amber-300/90"
          : "text-zinc-400";

  // Con la ventana por debajo del 1 % el medidor solo aportaba un «0%» y una
  // barra vacía: ruido en una fila que ya va cargada. Vuelve cuando tiene algo
  // que decir.
  if (porcentaje !== null && porcentaje < 1) return null;

  // De dónde sale el denominador. Decirlo es lo que separa un medidor de un
  // adorno: la ventana nativa de un modelo y el `num_ctx` con que Ollama lo
  // arranca pueden diferir por un factor de diez.
  const origen =
    ventana.fuente === "num_ctx"
      ? t("El techo lo pone el «num_ctx» con el que Ollama arranca este modelo.")
      : ventana.fuente === "nativa"
        ? t("Ventana nativa del modelo: si Ollama lo arranca con menos contexto, el corte llegará antes.")
        : t("Ventana que declara el proveedor.");

  const filas: Array<[string, string]> = [
    [t("Mensajes"), String(uso.messages)],
    [t("Caracteres"), uso.chars.toLocaleString("es")],
  ];

  return (
    <>
      <button
        ref={ref}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t("Contexto")}
        title={t("Cuánto ocupa el próximo turno")}
        className={`flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] tabular-nums transition-colors hover:bg-base-hover ${tono}`}
      >
        <Gauge className="h-3 w-3 shrink-0" aria-hidden />
        {porcentaje === null ? null : (
          <Barra
            fijo={pFijo}
            historial={pHistoria}
            borrador={pBorrador}
            alto="h-1.5"
            ancha="w-14"
          />
        )}
        {porcentaje === null ? `≈ ${miles(uso.estTokens)}` : `${porcentaje}%`}
      </button>

      <Popover
        open={open}
        anchorRef={ref}
        onClose={() => setOpen(false)}
        width={288}
        align="end"
        className="p-3"
      >
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[10px] uppercase tracking-wider text-zinc-600">
            {t("Ventana de contexto")}
          </p>
          {porcentaje !== null && (
            <span className={`text-sm font-semibold tabular-nums ${tono}`}>{porcentaje}%</span>
          )}
        </div>

        {porcentaje !== null ? (
          <>
            <div className="mt-2">
              <Barra
                fijo={pFijo}
                historial={pHistoria}
                borrador={pBorrador}
                alto="h-2"
                ancha="w-full"
              />
            </div>
            <div className="mt-2 space-y-1">
              <Leyenda
                color="bg-accent"
                nombre={t("Lo fijo: identidad, reglas y plantillas")}
                valor={`≈ ${miles(tokensFijos)}`}
              />
              <Leyenda
                color={
                  porcentaje > 90 ? "bg-red-400" : porcentaje > 70 ? "bg-amber-400" : "bg-accent-soft"
                }
                nombre={t("La conversación")}
                valor={`≈ ${miles(tokensHistoria)}`}
              />
              {tokensBorrador > 0 && (
                <Leyenda
                  color="bg-accent-soft/40"
                  nombre={t("Lo que estás escribiendo")}
                  valor={`≈ ${miles(tokensBorrador)}`}
                />
              )}
              <Leyenda
                color="bg-base-border"
                nombre={t("Libre")}
                valor={`≈ ${miles(Math.max(0, tokens - uso.estTokens - tokensBorrador))}`}
              />
            </div>
            <p className="mt-2 text-[11px] text-zinc-500">
              {t("{usado} de {total} tokens", {
                usado: `≈ ${miles(uso.estTokens)}`,
                total: miles(tokens),
              })}
            </p>
            <p className="mt-1 text-[11px] leading-snug text-zinc-600">{origen}</p>
            {uso.estTokens + tokensBorrador > tokens && (
              <p className="mt-2 rounded-lg border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-[11px] leading-snug text-red-200">
                {t("Con lo escrito hasta aquí no cabe entero: se cortará por el principio de la conversación.")}
              </p>
            )}
          </>
        ) : (
          <p className="mt-2 text-[11px] leading-snug text-zinc-500">
            {t("≈ {n} tokens. Este modelo no declara su ventana, así que no se saca un porcentaje de un número inventado.", {
              n: miles(uso.estTokens),
            })}
          </p>
        )}

        <div className="mt-2.5 space-y-1 border-t border-base-border pt-2.5">
          {filas.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-3 text-xs">
              <span className="text-zinc-500">{k}</span>
              <span className="tabular-nums text-zinc-200">{v}</span>
            </div>
          ))}
          {uso.images > 0 && (
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="text-zinc-500">{t("Imágenes adjuntas")}</span>
              <span className="tabular-nums text-amber-300/90">{uso.images}</span>
            </div>
          )}
        </div>

        {porcentaje !== null && porcentaje > 85 && (
          <p className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] leading-snug text-amber-200">
            {t("Si desborda, el proveedor recorta por el principio y la conversación pierde su arranque: exporta y abre una nueva antes de que pase.")}
          </p>
        )}
        {uso.images > 0 && (
          <p className="mt-2 text-[11px] leading-snug text-amber-300/80">
            {t(
              "Las {n} imágenes van en base64 y no entran en esa estimación: suelen ser lo que más abulta.",
              { n: uso.images },
            )}
          </p>
        )}
        <p className="mt-2 text-[11px] leading-snug text-zinc-600">
          {t("Los tokens son una estimación a ~4 caracteres por token, no el contador del proveedor.")}
        </p>
      </Popover>
    </>
  );
}
