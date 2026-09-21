import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

/** Cada imagen se pide una sola vez por archivo; al subir y bajar por el chat no
 *  se vuelve a leer el disco. La cadena vacía significa "no se pudo leer". */
const cache = new Map<string, string>();

interface Props {
  /** Ruta guardada en el adjunto; se valida en el backend contra attachments/. */
  file: string;
  name: string;
  /** Anillo más marcado para las burbujas del usuario (fondo morado). */
  onAccent?: boolean;
}

export default function AttachmentImage({ file, name, onAccent = false }: Props) {
  const [src, setSrc] = useState<string | null>(() => cache.get(file) ?? null);
  const [zoom, setZoom] = useState(false);

  useEffect(() => {
    const hit = cache.get(file);
    if (hit !== undefined) {
      setSrc(hit);
      return;
    }
    let alive = true;
    invoke<string>("attachment_image", { file })
      .then((uri) => {
        cache.set(file, uri);
        if (alive) setSrc(uri);
      })
      .catch(() => {
        cache.set(file, "");
        if (alive) setSrc("");
      });
    return () => {
      alive = false;
    };
  }, [file]);

  if (src === null) {
    return (
      <span
        className={`h-11 w-11 shrink-0 animate-pulse rounded-lg ${
          onAccent ? "bg-white/15" : "bg-white/5"
        }`}
      />
    );
  }
  if (src === "") {
    return (
      <span
        title="La imagen ya no está en disco"
        className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[9px] ${
          onAccent ? "bg-white/15 text-white/80" : "bg-white/5 text-zinc-500"
        }`}
      >
        ?
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setZoom(true)}
        title={`Ver ${name}`}
        className={`shrink-0 rounded-lg outline-offset-2 transition-opacity hover:opacity-90 ${
          onAccent ? "outline outline-1 outline-white/30" : "outline outline-1 outline-white/10"
        }`}
      >
        <img src={src} alt={name} className="h-11 w-11 rounded-lg object-cover" />
      </button>
      {zoom && <Lightbox src={src} name={name} onClose={() => setZoom(false)} />}
    </>
  );
}

function Lightbox({ src, name, onClose }: { src: string; name: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Que Esc no cierre además lo que haya detrás (Ajustes, un popover).
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm"
    >
      <img
        src={src}
        alt={name}
        onClick={(e) => e.stopPropagation()}
        className="max-h-full max-w-full rounded-xl shadow-2xl shadow-black"
      />
      <button
        onClick={onClose}
        aria-label="Cerrar imagen"
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
