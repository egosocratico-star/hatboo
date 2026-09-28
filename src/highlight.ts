/**
 * Resaltado de sintaxis propio, sin dependencias. Una app local-first no va a
 * arrastrar 30 KB de Prism para pintar lo que contesta un modelo: con comentarios,
 * cadenas, números, palabras clave y tipos está cubierto el 95% de lo que sale.
 *
 * Los colores salen de las variables de `index.css` (`violet-400`, `emerald-400`…),
 * que ya se invierten en el tema claro, así que aquí no hay variante `dark:`.
 */

export interface Pieza {
  texto: string;
  clase: string | null;
}

const CLAVE = new Set(
  (
    "if else elif for while return def fn func let const var mut static class struct enum impl trait interface type " +
    "public private protected virtual override final abstract sealed static void new delete this self super " +
    "async await yield import from export package require use mod pub crate dyn as in is of on not and or where " +
    "match case switch default try catch except finally throw raises with do loop begin end goto break continue " +
    "lambda global nonlocal pass assert unsafe extern operator template typename using sizeof namespace defer go chan select receive val data print echo raise"
  ).split(" "),
);

const CONSTANTE = new Set([
  "true",
  "false",
  "True",
  "False",
  "None",
  "null",
  "nil",
  "undefined",
  "NaN",
  "Ok",
  "Err",
  "Some",
  "self",
  "this",
  "super",
]);

/** El `#` abre comentario en unos lenguajes y es otra cosa en otros (Rust, C#). */
const LENGUAJES_ALMOHADILLA = new Set([
  "py",
  "python",
  "sh",
  "bash",
  "zsh",
  "shell",
  "yaml",
  "yml",
  "toml",
  "rb",
  "ruby",
  "r",
  "conf",
  "ini",
  "dockerfile",
  "makefile",
  "graphql",
]);

const TOKEN =
  /(\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d[\w.]*\b)|([A-Za-z_][\w$]*)|([^\sA-Za-z0-9_$]+)/g;

export function resaltar(codigo: string, lang: string): Pieza[][] {
  const admiteAlmohadilla = LENGUAJES_ALMOHADILLA.has(lang.toLowerCase());
  const lineas: Pieza[][] = [[]];
  const linea = () => lineas[lineas.length - 1];

  const empujar = (texto: string, clase: string | null) => {
    if (!texto) return;
    const ultima = linea()[linea().length - 1];
    if (ultima && ultima.clase === clase) ultima.texto += texto;
    else linea().push({ texto, clase });
  };

  /** Un comentario de bloque o una cadena con saltos ocupa varias líneas: si se
   *  empuja entero, la numeración se desalinea con lo que se pinta. */
  const empujarVarias = (texto: string, clase: string | null) => {
    texto.split("\n").forEach((p, i) => {
      if (i > 0) lineas.push([]);
      empujar(p, clase);
    });
  };

  /** El hueco entre dos tokens: aquí están los saltos de línea. */
  const espacio = (texto: string) => {
    const partes = texto.split("\n");
    partes.forEach((p, i) => {
      if (i > 0) lineas.push([]);
      empujar(p, null);
    });
  };

  let ultimaPos = 0;
  for (const m of codigo.matchAll(TOKEN)) {
    const desde = m.index ?? 0;
    if (desde > ultimaPos) espacio(codigo.slice(ultimaPos, desde));
    ultimaPos = desde + m[0].length;
    if (m[1]) {
      const esComentario = !m[1].startsWith("#") || admiteAlmohadilla;
      if (esComentario) empujarVarias(m[0], "text-zinc-500 italic");
      else empujarVarias(m[0], null);
      continue;
    }
    if (m[2]) {
      empujarVarias(m[0], "text-emerald-400");
      continue;
    }
    if (m[3]) {
      empujar(m[0], "text-amber-300");
      continue;
    }
    if (m[4]) {
      const palabra = m[0];
      if (CONSTANTE.has(palabra)) empujar(palabra, "text-orange-400");
      else if (CLAVE.has(palabra)) empujar(palabra, "text-violet-400");
      else if (/^[A-Z][A-Za-z0-9_]*$/.test(palabra)) empujar(palabra, "text-sky-400");
      else empujar(palabra, null);
      continue;
    }
    // La puntuación hereda el color del texto: teñirla hacía que `print("x")`
    // se leyera partido en tres tonos.
    empujar(m[0], null);
  }
  if (ultimaPos < codigo.length) espacio(codigo.slice(ultimaPos));

  // Una línea vacía no necesita ni un token: el arreglo vacío pinta la línea.
  return lineas;
}
