import { t } from "./i18n";

export const fmtDate = (ms: number) =>
  new Intl.DateTimeFormat("es", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(ms);

/** "ahora" / "hace 12 min" / "ayer" en vez de la fecha exacta: lo que importa
 *  es la cercanía. La fecha completa se queda en el `title`. */
export function haceRelativo(ms: number): string {
  const minutos = Math.floor((Date.now() - ms) / 60_000);
  if (minutos < 1) return t("ahora");
  if (minutos < 60) return t("hace {n} min", { n: minutos });
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return t("hace {n} h", { n: horas });
  const dias = Math.floor(horas / 24);
  if (dias === 1) return t("ayer");
  if (dias < 7) return t("hace {n} días", { n: dias });
  const semanas = Math.floor(dias / 7);
  if (semanas < 5) return t("hace {n} sem", { n: semanas });
  return fmtDate(ms);
}

/** En qué cajón del calendario cae un momento: «Hoy», «Ayer», «Últimos 7
 *  días»… Compara días de calendario, no ventanas de 24 h, porque «ayer» a las
 *  9 de la mañana sigue siendo ayer. El `round` es por el cambio de horario:
 *  entre dos medianoches pueden haber 23 o 25 horas. */
export function grupoDeFecha(ms: number): string {
  const medianoche = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dias = Math.round((medianoche(new Date()) - medianoche(new Date(ms))) / 86_400_000);
  if (dias <= 0) return t("Hoy");
  if (dias === 1) return t("Ayer");
  if (dias < 7) return t("Últimos 7 días");
  if (dias < 30) return t("Últimos 30 días");
  return t("Más antiguos");
}
