// Pruebas del mecanismo de versión, sin tocar la app ni la pantalla. Se corre con
// `npm run prueba-version`.
//
// Son las cuatro cosas que este mecanismo puede romper en silencio:
//   1. sustituir la línea equivocada (o más de una) en un manifiesto,
//   2. dejar el fichero con otra clase de final de línea,
//   3. llevarse texto por delante fuera del bloque generado del README,
//   4. que el repo real no pase su propia puerta.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { bloque_readme, objetivos, reemplaza_unica, regenera_readme, SEMVER } from "./version.mjs";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
let feitas = 0;
let rotas = 0;

function prueba(nombre, fn) {
  try {
    fn();
    feitas++;
    console.log(`  ✓ ${nombre}`);
  } catch (e) {
    rotas++;
    console.log(`  ✗ ${nombre}\n      ${e.message ?? e}`);
  }
}

function eq(obtenido, esperado, que) {
  if (obtenido !== esperado) {
    throw new Error(`${que}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(obtenido)}`);
  }
}

function lanza(fn, que) {
  let tiro = false;
  try {
    fn();
  } catch {
    tiro = true;
  }
  if (!tiro) throw new Error(`${que}: debía fallar y no falló`);
}

const PatronJson = /^\s*"version":\s*"[^"]*",?\s*$/;
const PatronToml = /^version\s*=\s*"[^"]*"\s*$/;

// Los marcadores se leen del propio generador: si alguien cambia uno aquí y no
// allá, la prueba pilla la costura en vez de fingir que coincide.
const BLOQUE = bloque_readme("0.0.0");
const INICIO = BLOQUE.split("\n")[0];
const FIN = BLOQUE.split("\n").pop();
const unREADME = (eol) =>
  ["# Hatboo", "", INICIO, "> texto viejo escrito a mano", FIN, "", "## Chat normal", ""].join(eol);

console.log("reemplaza_unica");

prueba("sustituye la línea de la versión y no otras", () => {
  const texto = ['{', '  "name": "hatboo",', '  "version": "0.6.0",', '  "private": true', '}'].join("\n");
  const nuevo = reemplaza_unica(texto, PatronJson, '  "version": "0.7.0",', "tauri.conf.json");
  eq(nuevo, ['{', '  "name": "hatboo",', '  "version": "0.7.0",', '  "private": true', '}'].join("\n"), "contenido");
});

prueba("falla si no hay ninguna línea de versión", () => {
  lanza(
    () => reemplaza_unica('{"name":"hatboo"}\n', PatronJson, '  "version": "1.0.0",', "sin versión"),
    "sin versión",
  );
});

prueba("falla si hay dos: no se adivina cuál es la del paquete", () => {
  const texto = ['  "version": "0.6.0",', '  "version": "0.5.0",'].join("\n");
  lanza(() => reemplaza_unica(texto, PatronJson, '  "version": "0.7.0",', "x"), "dos versiones");
});

prueba("en Cargo.toml no cuela la versión de una dependencia", () => {
  const toml = ['[package]', 'name = "hatboo"', 'version = "0.6.0"', '', '[dependencies]', 'tauri = { version = "2" }', ''].join("\n");
  const nuevo = reemplaza_unica(toml, PatronToml, 'version = "0.7.0"', "Cargo.toml");
  eq(nuevo.split("\n")[2], 'version = "0.7.0"', "la del [package]");
  eq(nuevo.split("\n")[5], 'tauri = { version = "2" }', "la dependencia intacta");
});

prueba("conserva CRLF: un cambio de número no reescribe el fichero entero", () => {
  const texto = '{\r\n  "version": "0.6.0",\r\n  "private": true\r\n}\r\n';
  const nuevo = reemplaza_unica(texto, PatronJson, '  "version": "0.7.0",', "x");
  eq(nuevo, '{\r\n  "version": "0.7.0",\r\n  "private": true\r\n}\r\n', "CRLF intacto");
});

prueba("el ancla sobre el texto entero no encuentra nada: así nació el verde falso", () => {
  // El bug del primer día: `^…$` sin bandera `m` solo ancla al principio y al
  // final del fichero, la sustitución no toca nada y `--comprobar` sale ✓ con el
  // manifiesto desfasado. Queda como caso para que no vuelva a colar.
  const texto = '{\n  "version": "0.6.0"\n}\n';
  eq(texto.replace(PatronJson, '  "version": "0.7.0"'), texto, "sin trabajar por líneas no hay cambio");
});

console.log("regenera_readme");

prueba("reescribe solo el bloque y deja el resto byte a byte", () => {
  const nuevo = regenera_readme(unREADME("\n"), "0.7.0");
  if (!nuevo.startsWith("# Hatboo\n\n")) throw new Error("se llevó la cabecera");
  if (!nuevo.endsWith("\n## Chat normal\n")) throw new Error("se llevó el resto del fichero");
  if (!nuevo.includes("versión **0.7.0**")) throw new Error("no actualizó el número");
  if (nuevo.includes("> texto viejo escrito a mano")) throw new Error("quedó texto del bloque anterior");
});

prueba("es idempotente: escribir dos veces no cambia nada", () => {
  const una = regenera_readme(unREADME("\n"), "0.7.0");
  eq(regenera_readme(una, "0.7.0"), una, "segunda pasada");
});

prueba("respeta el CRLF del README y no mete LF sueltos", () => {
  const nuevo = regenera_readme(unREADME("\r\n"), "0.7.0");
  if (!nuevo.includes("\r\n")) throw new Error("perdió el CRLF");
  if (/(^|[^\r])\n/.test(nuevo)) throw new Error("hay un LF sin su \\r delante");
});

prueba("falla sin marcadores, y con dos bloques", () => {
  lanza(() => regenera_readme("# Hatboo\nsin bloque\n", "0.7.0"), "sin marcadores");
  lanza(() => regenera_readme(unREADME("\n") + unREADME("\n"), "0.7.0"), "dos bloques");
});

console.log("el repo de verdad");

prueba("package.json dice semver", () => {
  const p = JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf8"));
  if (!SEMVER.test(p.version)) throw new Error(`version = ${JSON.stringify(p.version)}`);
});

prueba("los tres lectores generan lo mismo que ya está escrito", () => {
  const p = JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf8"));
  const desfasados = objetivos(p.version)
    .filter((o) => {
      const actual = readFileSync(join(RAIZ, o.rel), "utf8");
      return actual !== o.aplica(actual);
    })
    .map((o) => o.rel);
  eq(desfasados.join(", "), "", "manifiestos y README");
});

prueba("el CHANGELOG conoce la versión del paquete", () => {
  const p = JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf8"));
  const c = readFileSync(join(RAIZ, "CHANGELOG.md"), "utf8");
  if (!c.includes(`## [${p.version}]`)) throw new Error(`falta ## [${p.version}]`);
});

console.log(`\n${feitas} pruebas · ${rotas} rotas`);
process.exit(rotas ? 1 : 0);
