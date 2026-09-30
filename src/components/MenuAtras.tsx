import { t } from "../i18n";
import { ChevronLeft } from "lucide-react";

/** La fila de vuelta de una cara del `+`. Va arriba, donde estaba la fila que se
 *  pulsó: si estuviera abajo habría que recorrer la cara entera para retroceder. */
export default function MenuAtras({ hacia, onClick }: { hacia: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="mb-1 flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs text-zinc-400 transition-colors hover:bg-base-raised hover:text-zinc-100"
    >
      <ChevronLeft className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{t("Volver a {n}", { n: hacia })}</span>
    </button>
  );
}
