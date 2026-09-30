import { t } from "../i18n";
import Mascot from "./mascot/Mascot";
import { saleDelEquipo } from "../modelo";
import type { MascotState } from "../types";

/** Cuatro franjas; la madrugada tiene la suya porque esta app se usa a deshoras.
 *  Va seguida de "Soy <nombre>", así que es un saludo al usuario, no a la app. */
function saludo(hora: number): string {
  if (hora < 6) return t("Aún despiertos");
  if (hora < 13) return t("Buenos días");
  if (hora < 20) return t("Buenas tardes");
  return t("Buenas noches");
}

/**
 * La primera pantalla del chat, antes del primer mensaje. Lo que dice la nota de
 * abajo es verdad o no está: `saleDelEquipo` decide con proveedor y modelo
 * actuales, porque prometer «nada sale de tu equipo» con un modelo de nube
 * puesto sería mentira.
 */
export default function SaludoChat({
  pose,
  nombre,
  proveedor,
  modelo,
}: {
  pose: MascotState;
  nombre: string;
  proveedor: string;
  modelo: string;
}) {
  const fuera = saleDelEquipo(proveedor, modelo);
  return (
    <div className="flex flex-col items-center gap-3">
      <Mascot state={pose} size={108} />
      <div className="flex flex-col items-center gap-1.5">
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight">
          {nombre ? (
            <>
              {saludo(new Date().getHours())},{" "}
              <span className="text-accent-soft">{nombre}</span>
            </>
          ) : (
            <>
              {saludo(new Date().getHours())}. {t("Soy")}{" "}
              <span className="text-accent-soft">Hatboo</span>
            </>
          )}
        </h1>
        <p className="text-sm text-zinc-400">
          {fuera
            ? t("El historial se queda aquí. Esta respuesta la genera {m} fuera de tu equipo.", {
                m: modelo || t("el proveedor elegido"),
              })
            : t("Local-first: nada sale de tu equipo salvo lo que mandes al proveedor que elijas.")}
        </p>
      </div>
    </div>
  );
}
