import { t, currentLanguage } from "../i18n";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useChatStore } from "../store/chatStore";
import { fmtDate } from "../time";
import Bloque from "./Bloque";

interface Estadisticas {
  chats: number;
  mensajes: number;
  tokensEstimados: number;
  /** Inicio del día, en milisegundos; `null` si no hay historial todavía. */
  diaMasActivo: number | null;
  diaMasActivoMensajes: number;
  chatMasLargo: string | null;
  chatMasLargoMensajes: number;
  rachaActual: number;
  rachaMasLarga: number;
}

function Celda({ valor, etiqueta, detalle }: { valor: string; etiqueta: string; detalle?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-base-border bg-base-raised px-2 py-2 text-center" title={detalle}>
      <p className="truncate text-base font-semibold leading-tight tabular-nums text-zinc-100">
        {valor}
      </p>
      <p className="mt-0.5 truncate text-[11px] text-zinc-500">{etiqueta}</p>
    </div>
  );
}

/**
 * Lo que hace Hatboo en este PC, contado sobre su propia base de datos. Todo es
 * un hecho menos los tokens: de esos no hay dato real, así que van marcados como
 * estimación en el propio número y con la explicación debajo.
 */
export default function PerfilEstadisticas() {
  const tz = useChatStore((s) => s.settings?.tzOffsetMin ?? 0);
  const [datos, setDatos] = useState<Estadisticas | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setFallo(null);
    void invoke<Estadisticas>("perfil_estadisticas", { tzOffsetMin: tz }).then(
      (r) => vivo && setDatos(r),
      (e) => vivo && setFallo(String(e)),
    );
    return () => {
      vivo = false;
    };
  }, [tz]);

  const nf = new Intl.NumberFormat(currentLanguage() === "en" ? "en" : "es");
  const n = (v: number) => nf.format(v);
  const dias = (v: number) => t("{n} días", { n: v });

  return (
    <Bloque
      titulo={t("Tus estadísticas")}
      descripcion={t(
        "Todo lo que sale aquí se calcula sobre tu propio historial en este PC. No se envía nada a nadie.",
      )}
    >
      {fallo && <p className="text-[11px] text-red-300">{fallo}</p>}
      {!fallo && !datos && <p className="text-[11px] text-zinc-500">{t("Contando…")}</p>}
      {datos && datos.mensajes === 0 && (
        <p className="text-[11px] leading-relaxed text-zinc-500">
          {t("Todavía no hay chats ni mensajes guardados en este PC.")}
        </p>
      )}
      {datos && datos.mensajes > 0 && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Celda valor={n(datos.chats)} etiqueta={t("Chats")} />
            <Celda valor={n(datos.mensajes)} etiqueta={t("Mensajes")} />
            <Celda
              valor={`≈ ${n(datos.tokensEstimados)}`}
              etiqueta={t("Tokens, estimado")}
              detalle={t("Estimación: caracteres de lo escrito entre cuatro.")}
            />
            <Celda
              valor={datos.diaMasActivo ? fmtDate(datos.diaMasActivo) : "—"}
              etiqueta={t("Día más activo")}
              detalle={t("{n} mensajes ese día", { n: n(datos.diaMasActivoMensajes) })}
            />
            <Celda
              valor={n(datos.chatMasLargoMensajes)}
              etiqueta={t("Chat más largo")}
              detalle={datos.chatMasLargo ?? undefined}
            />
            <Celda
              valor={dias(datos.rachaActual)}
              etiqueta={t("Racha actual")}
              detalle={t("La más larga: {d}", { d: dias(datos.rachaMasLarga) })}
            />
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
            {t(
              "Los tokens van estimados: el proveedor no devuelve cuántos gastó cada respuesta, así que se cuentan los caracteres del historial y se divide entre cuatro. Los días seguidos cuentan desde hoy hacia atrás, y un día sin mensajes la corta.",
            )}
          </p>
        </>
      )}
    </Bloque>
  );
}
