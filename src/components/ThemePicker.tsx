import { Monitor, Moon, Sun } from "lucide-react";
import type { ThemeChoice } from "../theme";

const ICONOS: Record<ThemeChoice, { Icon: typeof Sun; label: string }> = {
  system: { Icon: Monitor, label: "Sistema" },
  light: { Icon: Sun, label: "Claro" },
  dark: { Icon: Moon, label: "Oscuro" },
};

// El orden es el de la propia etiqueta de Windows: sistema primero.
const ORDEN: ThemeChoice[] = ["system", "light", "dark"];

interface Props {
  value: ThemeChoice;
  onChange: (v: ThemeChoice) => void;
  /** Los tres reparten el ancho del contenedor, para los popovers. */
  grow?: boolean;
}

export default function ThemePicker({ value, onChange, grow = false }: Props) {
  return (
    <div className="flex gap-1">
      {ORDEN.map((id) => {
        const { Icon, label } = ICONOS[id];
        const activo = value === id;
        return (
          <button
            key={id}
            onClick={() => onChange(id)}
            title={label}
            aria-label={label}
            aria-pressed={activo}
            className={`${grow ? "flex-1" : ""} grid place-items-center rounded-md px-2.5 py-1.5 transition-colors ${
              activo
                ? "bg-accent/15 text-accent-soft"
                : "text-zinc-400 hover:bg-base-hover hover:text-zinc-200"
            }`}
          >
            <Icon className="w-4 h-4" />
          </button>
        );
      })}
    </div>
  );
}
