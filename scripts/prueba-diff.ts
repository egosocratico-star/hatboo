/**
 * Prueba del lector de diffs. Se corre con `npm run prueba-diff` (o
 * `node scripts/prueba-diff.ts`): la lógica vive en `src/diff.ts`, que es pura
 * y no necesita la app ni el agente para comprobarla.
 *
 * Los casos están escritos con la forma exacta que saca `unified_diff` de
 * `src-tauri/src/agent/tools/write_file.rs`, que es lo que se va a pintar.
 */
import { cuentaDiff, parseaDiff, type Fila } from "../src/diff.ts";

let fallos = 0;
let casos = 0;

function espera(descripcion: string, obtenido: unknown, querido: unknown) {
  casos += 1;
  const a = JSON.stringify(obtenido);
  const b = JSON.stringify(querido);
  if (a === b) {
    console.log(`  ok    ${descripcion}`);
    return;
  }
  fallos += 1;
  console.log(`  FALLA ${descripcion}\n          salió  ${a}\n          quería ${b}`);
}

/** Resumen compacto de cada fila: tipo, números y texto. */
function resumen(filas: Fila[]) {
  return filas.map((f) =>
    f.kind === "archivo" || f.kind === "hunk"
      ? `${f.kind}:${f.texto}`
      : `${f.kind}:${f.viejo ?? ""},${f.nuevo ?? ""}:${f.texto}`,
  );
}

// 1. Archivo nuevo: cabecera /dev/null, un hunk, todo añadido.
const nuevo = `--- /dev/null
+++ b/hola.txt
@@ -0,0 +1,3 @@
+uno
+dos
+tres`;
espera("archivo nuevo: tres añadidas numeradas del 1 al 3", resumen(parseaDiff(nuevo)), [
  "archivo:--- /dev/null",
  "archivo:+++ b/hola.txt",
  "hunk:@@ -0,0 +1,3 @@",
  "add:,1:uno",
  "add:,2:dos",
  "add:,3:tres",
]);
espera("archivo nuevo: el recuento", cuentaDiff(parseaDiff(nuevo)), { mas: 3, menos: 0 });

// 2. Modificado con contexto: es el caso normal del agente.
const modificado = `--- a/app.rs
+++ b/app.rs
@@ -1 +1,2 @@
 uno
-dos viejo
+dos nuevo`;
espera("modificado: contexto, borrada y añadida con sus dos números", resumen(parseaDiff(modificado)), [
  "archivo:--- a/app.rs",
  "archivo:+++ b/app.rs",
  "hunk:@@ -1 +1,2 @@",
  "ctx:1,1:uno",
  "del:2,:dos viejo",
  "add:,2:dos nuevo",
]);
espera("modificado: el recuento", cuentaDiff(parseaDiff(modificado)), { mas: 1, menos: 1 });

// 3. Dos hunks: cada uno reanuda sus números desde su cabecera.
const dosHunks = `--- a/x
+++ b/x
@@ -1 +1 @@
-una
+otra
@@ -40 +40 @@
-cuarenta
+cuarenta B`;
espera("dos hunks: el segundo arranca en la línea 40", resumen(parseaDiff(dosHunks)).slice(-2), [
  "del:40,:cuarenta",
  "add:,40:cuarenta B",
]);

// 4. Contenido que imita a una cabecera, dentro del hunk.
const trampa = `--- a/notas.md
+++ b/notas.md
@@ -1 +1,2 @@
 + esto no es una añadida
---- y esto tampoco es una cabecera
+--- ahora sí es añadida`;
espera("una línea de contexto que empieza por «+» no cuenta como añadida", resumen(parseaDiff(trampa))[3], "ctx:1,1:+ esto no es una añadida");
espera("una borrada que empieza por «---» se lee dentro del hunk", resumen(parseaDiff(trampa))[4], "del:2,:--- y esto tampoco es una cabecera");
espera("recuento con trampas incluidas", cuentaDiff(parseaDiff(trampa)), { mas: 1, menos: 1 });

// 5. Líneas vacías: en el diff van con la marca y nada detrás.
const vacias = `--- a/v.py
+++ b/v.py
@@ -1 +1,2 @@
 
+nueva`;
espera("una contexto vacía queda en texto vacío, no en «undefined»", resumen(parseaDiff(vacias))[3], "ctx:1,1:");
espera("una añadida marcada con «+» suelto", resumen(parseaDiff(vacias))[4], "add:,2:nueva");

// 6. Diff vacío y basura: no hay que inventarse líneas.
espera("diff vacío", parseaDiff(""), []);
espera("diff sin hunks (solo cabeceras)", resumen(parseaDiff("--- a/x\n+++ b/x\n")), [
  "archivo:--- a/x",
  "archivo:+++ b/x",
]);
const rara = parseaDiff("--- a/x\n+++ b/x\n@@ algo @@\n+z");
espera("cabecera de hunk sin números: no se traga la línea, la deja como hunk", resumen(rara)[2], "hunk:@@ algo @@");
espera("tras esa cabecera rara, la numeración sigue desde donde estaba", resumen(rara)[3], "add:,1:z");

// 7. Un fichero borrado entero: solo menos.
const borrado = `--- a/antes.txt
+++ b/antes.txt
@@ -1,2 +0,0 @@
-uno
-dos`;
espera("fichero borrado: dos menos y ninguna añadida", resumen(parseaDiff(borrado)).slice(3), [
  "del:1,:uno",
  "del:2,:dos",
]);
espera("fichero borrado: recuento", cuentaDiff(parseaDiff(borrado)), { mas: 0, menos: 2 });

console.log(`\n${casos} casos, ${fallos} fallos.`);
process.exit(fallos > 0 ? 1 : 0);
