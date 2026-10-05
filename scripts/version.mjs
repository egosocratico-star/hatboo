// La versión se teclea en un solo sitio: `package.json`. Todo lo demás la lee.
//
// `npm run version:escribir`  → pone al día tauri.conf.json, Cargo.toml y el
//                               bloque generado del README.
// `npm run version:comprobar` → corta si están desfasados. Eso es lo que corre la
//                               CI, y es la razón por la que el README ya no puede
//                               volver a decir «último release v0.5.0» a mano: ese
//                               número no lo escribe nadie, se genera o falla.
//
// Por qué no `"version": "../package.json"` en tauri.conf.json: el deserializador
// de `tauri-utils` (2.9.3, `PackageVersion::visit_str`) comprueba
// `PathBuf::from(value).exists()` relativo al **directorio de trabajo del
// proceso**, no al fichero de configuración. Desde `src-tauri` (donde corre
// `tauri-build`) funciona; desde la raíz del repo, donde corre `npm run tauri dev`,
// `../package.json` no existe y el string se intenta parsear como semver — error
// duro. Queda escrito para que nadie lo pruebe sin medirlo.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/** Marcadores del único bloque del README que se escribe solo. */
const INICIO = "<!-- VERSION:START -->";
const FIN = "<!-- VERSION:END -->";

const leer = (rel) => readFileSync(join(RAIZ, rel), "utf8");

/** Sustituye una sola línea. Se trabaja por líneas a propósito: un `^…$` sobre el
 *  texto entero solo ancla al principio y al final del fichero, y entonces la
 *  sustitución no encuentra nada y devuelve el original — verde falso. Si el
 *  patrón aparece más de una vez, eso ya no es «la versión del paquete» y el
 *  fichero se queda como está: mejor fallar. */
function reemplaza_unica(texto, patron, nuevo, donde) {
  const lineas = texto.split("\n");
  const donde_esta = lineas
    .map((l, i) => (patron.test(l) ? i : -1))
    .filter((i) => i >= 0);
  if (donde_esta.length !== 1) {
    throw new Error(
      `${donde}: esperaba exactamente 1 línea por ${patron} y hay ${donde_esta.length}`,
    );
  }
  const i = donde_esta[0];
  // Se preserva el fin de línea: el repo tiene ficheros con CRLF y meter LF aquí
  // convertiría un cambio de número en un cambio de las 200 líneas del fichero.
  const crlf = lineas[i].endsWith("\r") ? "\r" : "";
  lineas[i] = nuevo + crlf;
  return lineas.join("\n");
}

function version_del_paquete() {
  const p = JSON.parse(leer("package.json"));
  if (!SEMVER.test(p.version ?? "")) {
    throw new Error(`package.json: "version" no es semver (${JSON.stringify(p.version)})`);
  }
  return p.version;
}

function bloque_readme(v) {
  return [
    INICIO,
    `> Estado: app personal en desarrollo, versión **${v}** para Windows. Funciona,`,
    "> no hay autoactualización. Los binarios se publican como release de GitHub al",
    "> empujar una etiqueta `v*` — el flujo está probado (v0.3.0 en 8m32s, v0.4.0 en",
    "> 10m50s) y la release publicada más reciente es siempre",
    "> [`releases/latest`](https://github.com/egosocratico-star/hatboo/releases/latest);",
    "> el número de esta línea lo genera `package.json` con `npm run version:escribir`.",
    FIN,
  ].join("\n");
}

/** Reescribe solo lo que hay entre los dos marcadores, y comprueba después que el
 *  antes y el desués son byte a byte los mismos. Un splice que se lleva dos
 *  párrafos por delante no es un bug de formato: es código perdido.
 *
 *  Conserva el fin de línea del fichero: el README está en CRLF, y escribir el
 *  bloque con LF lo dejaría con las dos clases de final de línea conviviendo — el
 *  diff saldría con las ocho líneas del bloque como si alguien las hubiera leído. */
function regenera_readme(texto, v) {
  const eol = texto.includes("\r\n") ? "\r\n" : "\n";
  const bloque = bloque_readme(v).split("\n").join(eol);
  const i = texto.indexOf(INICIO);
  const j = texto.indexOf(FIN);
  if (i < 0 || j < 0 || j < i) throw new Error("README.md: faltan los marcadores de versión");
  if (texto.slice(i + INICIO.length).includes(INICIO)) {
    throw new Error("README.md: hay más de un bloque de versión");
  }
  const fin = j + FIN.length;
  const antes = texto.slice(0, i);
  const despues = texto.slice(fin);
  const nuevo = antes + bloque + despues;
  if (!nuevo.startsWith(antes) || !nuevo.endsWith(despues)) {
    throw new Error("README.md: la regeneración tocó texto fuera del bloque");
  }
  return nuevo;
}

const objetivos = (v) => [
  {
    rel: "src-tauri/tauri.conf.json",
    aplica: (t) => reemplaza_unica(t, /^\s*"version":\s*"[^"]*",?\s*$/, `  "version": "${v}",`, "tauri.conf.json"),
  },
  {
    rel: "src-tauri/Cargo.toml",
    aplica: (t) => reemplaza_unica(t, /^version\s*=\s*"[^"]*"\s*$/, `version = "${v}"`, "Cargo.toml"),
  },
  { rel: "README.md", aplica: (t) => regenera_readme(t, v) },
];

/** El CHANGELOG tiene que conocer la versión que se está publicando; si no, la
 *  puerta de abajo pasa con un README nuevo y un historial mudo. */
function comprueba_changelog(v) {
  const c = leer("CHANGELOG.md");
  if (!c.includes(`## [${v}]`)) {
    throw new Error(`CHANGELOG.md: no hay entrada para ## [${v}]`);
  }
}

/** Solo se corre como programa cuando alguien lo invoca; `scripts/prueba-version.mjs`
 *  importa las funciones puras y no quiere que cambiarles el disco mientras se
 *  las prueba. */
function main() {
  const modo = process.argv.includes("--escribir") ? "escribir" : "comprobar";
  const fallos = [];
  let v;
  try {
    v = version_del_paquete();
  } catch (e) {
    console.error(String(e.message ?? e));
    process.exit(1);
  }

  for (const o of objetivos(v)) {
    let actual, esperado;
    try {
      actual = leer(o.rel);
      esperado = o.aplica(actual);
    } catch (e) {
      console.error(`✗ ${o.rel}: ${e.message ?? e}`);
      process.exit(1);
    }
    if (actual === esperado) {
      console.log(`✓ ${o.rel}`);
      continue;
    }
    if (modo === "escribir") {
      writeFileSync(join(RAIZ, o.rel), esperado, "utf8");
      console.log(`→ ${o.rel}: escrito`);
    } else {
      fallos.push(o.rel);
      console.log(`✗ ${o.rel}: desfasado (package.json dice ${v})`);
    }
  }

  try {
    comprueba_changelog(v);
    console.log("✓ CHANGELOG.md");
  } catch (e) {
    if (modo === "comprobar") fallos.push("CHANGELOG.md");
    console.log(`✗ ${e.message ?? e}`);
  }

  if (fallos.length && modo === "comprobar") {
    console.error(
      `\nLa versión se escribe una sola vez, en package.json. Corre ` +
        `npm run version:escribir y commitea el resultado. Desfasados: ${fallos.join(", ")}`,
    );
    process.exit(1);
  }
  console.log(`\n${v} · modo ${modo}`);
}

export { SEMVER, bloque_readme, comprueba_changelog, objetivos, reemplaza_unica, regenera_readme };

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
