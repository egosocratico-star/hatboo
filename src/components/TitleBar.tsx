import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, PanelLeftClose, PanelLeftOpen, Search, Square, X } from "lucide-react";
import mascotaLogo from "./mascot/states/idle.png";
import { t } from "../i18n";
import { useChatStore } from "../store/chatStore";

const CUADRO =
  "grid h-7 w-7 shrink-0 place-items-center rounded-lg text-zinc-400 transition-colors hover:bg-base-hover hover:text-zinc-100";

/** Los tres de ventana. Iban a tamaños distintos —el de maximizar hasta 12 px
 *  mientras los otros dos eran de 16— y se leía como tres botones de casas
 *  distintas. Mismo cuadro, mismo glifo; solo el cerrar cambia de color. */
const VENTANA =
  "grid h-9 w-11 shrink-0 place-items-center rounded-md text-zinc-400 transition-colors hover:bg-base-hover hover:text-zinc-100";
const GLIFO = "h-3.5 w-3.5";

export default function TitleBar() {
  const compact = useChatStore((s) => s.settings?.sidebarCompact ?? false);
  const patchSettings = useChatStore((s) => s.patchSettings);
  const setSearchOpen = useChatStore((s) => s.setSearchOpen);
  const [maximizada, setMaximizada] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let vivo = true;
    const lee = () => {
      void win.isMaximized().then((m) => {
        if (vivo) setMaximizada(m);
      });
    };
    lee();
    // Maximizar también redimensiona, así que con un solo listener basta.
    const off = win.onResized(lee);
    return () => {
      vivo = false;
      void off.then((f) => f());
    };
  }, []);

  return (
    <header
      data-tauri-drag-region
      className="flex h-10 shrink-0 select-none items-center gap-1 border-b border-base-border bg-base-raised pl-3 pr-1.5"
    >
      <img
        src={mascotaLogo}
        alt=""
        className="h-[18px] w-[18px] shrink-0 object-contain"
        draggable={false}
      />
      <span className="text-[13px] font-semibold tracking-tight">Hatboo</span>
      <span data-tauri-drag-region className="min-w-0 flex-1" />
      <button
        onClick={() => setSearchOpen(true)}
        className={CUADRO}
        title={t("Buscar en todos los chats (Ctrl+K)")}
      >
        <Search className="h-4 w-4" />
      </button>
      <button
        onClick={() => patchSettings({ sidebarCompact: !compact })}
        className={CUADRO}
        title={compact ? t("Desplegar la barra lateral (Ctrl+B)") : t("Plegar la barra lateral (Ctrl+B)")}
        aria-expanded={!compact}
      >
        {compact ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
      </button>
      <span className="mx-1.5 h-4 w-px shrink-0 bg-base-border" />
      <button
        onClick={() => void getCurrentWindow().minimize()}
        className={VENTANA}
        title={t("Minimizar")}
      >
        <Minus className={GLIFO} />
      </button>
      <button
        onClick={() => void getCurrentWindow().toggleMaximize()}
        className={VENTANA}
        title={maximizada ? t("Restaurar") : t("Maximizar")}
      >
        {maximizada ? <Copy className={GLIFO} /> : <Square className={GLIFO} />}
      </button>
      <button
        onClick={() => void getCurrentWindow().close()}
        className={`${VENTANA} hover:bg-red-500 hover:text-white`}
        title={t("Cerrar Hatboo")}
      >
        <X className={GLIFO} />
      </button>
    </header>
  );
}
