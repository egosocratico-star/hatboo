/**
 * Formateo de magnitudes. `gigabytes` vivía en el Centro de modelos; se quedó
 * aquí cuando la tienda se fue, porque lo que mide es la barra de recursos de
 * Ajustes → Sistema.
 */

/** GB «de los grandes», los que usa Ollama: no hay que mezclar las dos bases. */
export function gigabytes(bytes: number) {
  if (bytes <= 0) return "—";
  const gb = bytes / 1_000_000_000;
  return gb < 10 ? `${gb.toFixed(1)} GB` : `${Math.round(gb)} GB`;
}
