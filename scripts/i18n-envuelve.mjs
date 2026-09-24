// Envuelve en t() las cadenas visibles de la interfaz. Pasos:
//  1. atributos title / placeholder / aria-label con literal;
//  2. literales sueltos en ternarios, `label:` y arrays de opciones;
//  3. nodos de texto JSX (en la misma línea o en la suya propia).
// Idempotente: una línea que ya tenga t() se deja como está.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";

const RAIZ = process.cwd();
const DIRECTORIOS = ["src/components", "src/components/work", "src/components/mascot"];
const FICHEROS = [
  "src/App.tsx",
  ...new Set(
    DIRECTORIOS.flatMap((d) =>
      readdirSync(join(RAIZ, d))
        .filter((f) => f.endsWith(".tsx") && !f.includes("i18n"))
        .map((f) => join(d, f)),
    ),
  ),
];

/**
 * Prosa de interfaz: mayoria de tokens son palabras. Con esto quedan fuera las
 * listas de clases de Tailwind (`bg-accent/10`), los operadores (`0 &&`) y los
 * identificadores, que tambien llevan huecos.
 */
const esProsa = (s) => {
  const tokens = s.trim().split(/\s+/);
  if (tokens.length < 2) return false;
  const palabras = tokens.filter((t) => /^[a-záéíóúñüA-ZÁÉÍÓÚÑÜ]{2,}[.!]?$/.test(t));
  return palabras.length / tokens.length >= 0.6;
};

const UNICO_TRADUCIBLE = new Set([
  "Guardar", "Crear", "Añadir", "Cancelar", "Enviar", "Cerrar", "Abrir", "Detener",
  "Eliminar", "Renombrar", "Exportar", "Continuar", "Reintentar", "Quitar", "Listo",
  "Pensando", "Leyendo", "Cargando", "Descargando", "Probando", "Guardando",
  "Esperando", "Buscando", "Pensó", "escribiendo",
]);

// Posiciones de CSS: dos palabras sueltas que no son prosa de la interfaz.
const NO_TRADUCIBLE = new Set([
  "top left", "top right", "bottom left", "bottom right", "center center",
]);

const ES_TEXTUAL = (s) => {
  const limpio = s.trim();
  if (NO_TRADUCIBLE.has(limpio)) return false;
  if (UNICO_TRADUCIBLE.has(limpio.replace(/[.…]+$/, ""))) return true;
  // Una palabra suelta con tilde es prosa casi siempre (`Código`, `sesión`);
  // un identificador o una clase no llevan acentos.
  if (limpio.split(/\s+/).length === 1) return /[áéíóúñ¿¡ÁÉÍÓÚÑ]/.test(limpio);
  return esProsa(limpio);
};

const traducible = (crudo) => {
  const s = crudo.trim();
  if (s.length < 4) return null;
  if (s.includes("{") || s.includes("}") || s.includes("`") || s.includes("$")) return null;
  // Corchetes: `text-[11px]` es una clase de Tailwind, no prosa.
  if (s.includes("[") || s.includes("]") || s.includes('"') || s.includes("\\")) return null;
  return ES_TEXTUAL(s) ? s : null;
};

const enComentario = (linea) => {
  const s = linea.trimStart();
  return s.startsWith("//") || s.startsWith("*") || s.startsWith("/*");
};

// Atributos que nunca son texto que vea el usuario, aunque lo parezcan.
const ATRIBUTOS_PROHIBIDOS = new Set([
  "className", "class", "style", "id", "key", "ref", "type", "value", "defaultValue",
  "lang", "href", "src", "to", "from", "for", "viewBox", "d", "fill", "stroke",
  "width", "height", "x", "y", "rx", "role", "htmlFor", "sandbox", "media",
]);

let total = 0;
for (const rel of FICHEROS) {
  const ruta = join(RAIZ, rel);
  let lineas = readFileSync(ruta, "utf8").split("\n");
  let cambios = 0;

  const toca = (linea) => {
    if (enComentario(linea) || linea.includes("t(\"") || linea.includes("t(`")) return linea;
    let salida = linea;

    // 1. cualquier atributo JSX con literal de prosa (`title`, `subtitle`,…).
    salida = salida.replace(/\b([a-zA-Z][\w-]*)="([^"]+)"/g, (todo, attr, valor) => {
      if (ATRIBUTOS_PROHIBIDOS.has(attr)) return todo;
      const v = traducible(valor);
      return v ? `${attr}={t(${JSON.stringify(v)})}` : todo;
    });
    // Si el paso 1 ya tocó la línea, el 2 volvería a envolver lo envuelto.
    if (salida !== linea) {
      cambios++;
      return salida;
    }
    // 2. literales en ternarios, `label:` y elementos de array. El lookbehind
    // deja fuera `attr="…"`, que necesita llaves y lo trata el paso 1.
    salida = salida.replace(
      /([\s:?=(,[])(?<!=)"([^"\n]{4,})"(?=[\s,;)\]}:])/g,
      (todo, antes, valor) => {
        const v = traducible(valor);
        return v ? `${antes}t(${JSON.stringify(v)})` : todo;
      },
    );
    // 3. nodo de texto JSX en la misma línea.
    salida = salida.replace(/>([^<>{}\n]+)</g, (todo, texto) => {
      const v = traducible(texto);
      if (!v) return todo;
      const delante = texto.match(/^\s*/)[0];
      const detras = texto.match(/\s*$/)[0];
      return `>${delante}{t(${JSON.stringify(v)})}${detras}<`;
    });
    if (salida !== linea) cambios++;
    return salida;
  };

  lineas = lineas.map(toca);

  // 4. texto JSX que ocupa su propia línea entre etiquetas.
  lineas = lineas.map((linea, i) => {
    if (enComentario(linea) || linea.includes("t(\"")) return linea;
    const m = linea.match(/^(\s*)([A-Za-zÁÉÍÓÚÑáéíóúñ¿¡][^<>{}"'`]*[a-záéíóúñ?.!])\s*$/);
    if (!m) return linea;
    const v = traducible(m[2]);
    if (!v) return linea;
    const anterior = lineas[i - 1] ?? "";
    const siguiente = lineas[i + 1] ?? "";
    if (!/>\s*$/.test(anterior) || !/^\s*<\//.test(siguiente)) return linea;
    cambios++;
    return `${m[1]}{t(${JSON.stringify(v)})}`;
  });

  if (!cambios) continue;
  let cuerpo = lineas.join("\n");
  if (!/^\s*import \{[^}]*\bt\b[^}]*\} from "[^"]*i18n"/m.test(cuerpo)) {
    const desde = dirname(join(RAIZ, rel));
    let r = relative(desde, join(RAIZ, "src/i18n.ts")).replace(/\\/g, "/").replace(/\.ts$/, "");
    if (!r.startsWith(".")) r = "./" + r;
    cuerpo = `import { t } from "${r}";\n` + cuerpo;
  }
  writeFileSync(ruta, cuerpo);
  total += cambios;
  console.log(String(cambios).padStart(4), rel);
}
console.log("líneas cambiadas:", total);
