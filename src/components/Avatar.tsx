import { Ghost } from "lucide-react";
import { AVATAR_COLORS, type AvatarStyle } from "../types";

interface Props {
  style: AvatarStyle;
  colorId: string;
  emoji: string;
  /** Nombre del que se toma la inicial cuando `style` es `inicial`. */
  name: string;
  size?: number;
}

/**
 * Identidad de la tarjeta de perfil sin pedirle al usuario que suba un archivo:
 * color de la paleta fija + mascota, inicial del nombre o un emoji.
 */
export default function Avatar({ style, colorId, emoji, name, size = 32 }: Props) {
  const color = AVATAR_COLORS.find((c) => c.id === colorId) ?? AVATAR_COLORS[0];
  return (
    <span
      className="grid place-items-center shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: color.bg,
        color: color.fg,
        fontSize: size * 0.5,
        lineHeight: 1,
      }}
    >
      {style === "inicial" ? (
        <span className="font-semibold">{(name.trim()[0] ?? "H").toUpperCase()}</span>
      ) : style === "emoji" ? (
        <span>{emoji || "🎩"}</span>
      ) : (
        <Ghost style={{ width: size * 0.5, height: size * 0.5 }} />
      )}
    </span>
  );
}
