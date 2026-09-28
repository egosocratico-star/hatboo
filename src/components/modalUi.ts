/**
 * Medidas compartidas de los modales. Cada uno iba a su manera —«Crear proyecto»
 * con botones de `text-sm py-2` y la confirmación de borrado con `text-xs
 * py-1.5`— y la app se leía como dos interfaces distintas. Un modal nuevo tiene
 * que salirle de aquí, no inventarlas otra vez.
 */
const BOTON =
  "inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-medium transition-colors";

export const BOTON_PRIMARIO = `${BOTON} bg-accent text-white hover:bg-accent-dim disabled:opacity-40`;
export const BOTON_SECUNDARIO = `${BOTON} border border-base-border text-zinc-300 hover:border-zinc-500 hover:text-layer`;
/** Solo para lo que destruye algo: mismo tamaño, color de advertencia. */
export const BOTON_PELIGRO = `${BOTON} bg-red-600 text-white hover:bg-red-500`;

/**
 * Campo de texto de la app entera, no solo de modales: estaba unificado dentro
 * de los modales y fuera cada pantalla con su receta (`bg-base`, `bg-base/40`,
 * `bg-base/60`, sin fondo, `py-1.5`…). El anillo de foco es el mismo en todos.
 */
export const CAMPO =
  "w-full rounded-lg border border-base-border bg-base px-3 py-2 text-sm text-zinc-100 outline-none transition-[border-color,box-shadow] placeholder:text-zinc-600 focus:border-accent focus:ring-2 focus:ring-accent/25";
