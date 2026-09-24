import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Usage {
  chars: number;
  estTokens: number;
  messages: number;
  images: number;
}

function miles(n: number): string {
  if (n < 1000) return String(n);
  return (n / 1000).toFixed(1).replace(".", ",") + " mil";
}

/**
 * Cuánto ocupa el prompt del próximo turno. El número lo calcula el backend con
 * el mismo `history()` que se envía, así que los archivos adjuntos ya cuentan
 * antepuestos. Los tokens son una estimación (~4 por token), no el contador del
 * proveedor, y las imágenes van aparte porque en base64 dominan el costo real.
 */
export default function ContextMeter({
  conversationId,
  tick,
}: {
  conversationId: string | null;
  tick: number;
}) {
  const [uso, setUso] = useState<Usage | null>(null);

  useEffect(() => {
    if (!conversationId) {
      setUso(null);
      return;
    }
    let vivo = true;
    void invoke<Usage>("context_usage", { conversationId }).then(
      (u) => vivo && setUso(u),
      () => vivo && setUso(null)
    );
    return () => {
      vivo = false;
    };
  }, [conversationId, tick]);

  if (!uso || uso.chars < 400) return null;
  return (
    <span
      className="text-[11px] text-zinc-500 tabular-nums shrink-0"
      title={`${uso.chars.toLocaleString("es")} caracteres · ${uso.messages} mensajes${
        uso.images ? ` · ${uso.images} imagen(es) en base64, no contadas aquí` : ""
      }. Los tokens son una estimación, no el contador del proveedor.`}
    >
      Contexto ≈ {miles(uso.estTokens)}
    </span>
  );
}
