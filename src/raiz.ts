/** Si la raíz del proyecto es una carpeta que no es un proyecto.
 *
 *  Con `Documentos` (o cualquier carpeta sincronizada por OneDrive) como raíz, el
 *  agente ve toda la casa: el árbol, la búsqueda y `read_file` llegan a lo que no
 *  tiene nada que ver con lo que se le está pidiendo. No es un error —es una
 *  comodidad peligrosa—, así que se avisa y se ofrece el camino de salida, no se
 *  bloquea.
 */
export type Sospecha = "onedrive" | "documentos" | "casa";

const DOCUMENTOS = ["documentos", "documents", "my documents"];

/** Último tramo de una ruta, con separadores de cualquier lado. */
function ultimoTramo(ruta: string): string {
  const limpio = ruta.replace(/[\\/]+$/, "");
  const trozos = limpio.split(/[\\/]/);
  return (trozos[trozos.length - 1] ?? "").toLowerCase();
}

export function sospechaRaiz(ruta: string | null | undefined): Sospecha | null {
  if (!ruta) return null;
  const minus = ruta.toLowerCase().replace(/\\/g, "/");
  const final = ultimoTramo(ruta);
  // El orden importa: `C:/Users/x/OneDrive` es las dos cosas, y la nube manda
  // porque es el riesgo más concreto (archivos que se bloquean al sincronizar).
  if (minus.includes("onedrive")) return "onedrive";
  // `C:/Users/x` o `/home/x` pelados. La barra inicial es opcional en el patrón
  // porque la ruta de Linux la trae y la de Windows no.
  if (/^\/?(c:\/users|home)\/[^/]+\/?$/.test(minus)) return "casa";
  if (DOCUMENTOS.includes(final)) return "documentos";
  return null;
}
