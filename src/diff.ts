/**
 * Lectura de un diff unificado. Está aparte del componente porque es la única
 * parte de los diffs inline que puede estar equivocada sin que se note en la
 * pantalla: un número de línea mal puesto se ve perfecto y miente. Se comprueba
 * con `npm run prueba-diff`, sin abrir la app.
 */

export type Fila =
  | { kind: "archivo"; texto: string }
  | { kind: "hunk"; texto: string }
  | {
      kind: "add" | "del" | "ctx";
      /** Número de línea en la versión antigua; `null` en una línea nueva. */
      viejo: number | null;
      /** Número de línea en la versión nueva; `null` en una borrada. */
      nuevo: number | null;
      texto: string;
    };

/** Cabeceras que `git diff` y `write_file` ponen antes del primer hunk. Solo
 *  valen mientras no se entró en un hunk: dentro, una línea borrada puede
 *  empezar perfectamente por «--- ». */
const CABECERA = ["--- ", "+++ ", "diff ", "index ", "similarity ", "new file", "deleted file", "rename "];

export function parseaDiff(diff: string): Fila[] {
  const filas: Fila[] = [];
  let viejo = 0;
  let nuevo = 0;
  let enHunk = false;
  for (const linea of diff.split("\n")) {
    if (!enHunk && CABECERA.some((p) => linea.startsWith(p))) {
      filas.push({ kind: "archivo", texto: linea });
      continue;
    }
    if (linea.startsWith("@@")) {
      enHunk = true;
      // «@@ -12,7 +15,9 @@» del git, y «@@ -12 +15 @@» que saca `similar`.
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(linea);
      viejo = m ? Number(m[1]) : viejo + 1;
      nuevo = m ? Number(m[2]) : nuevo + 1;
      filas.push({ kind: "hunk", texto: linea });
      continue;
    }
    // Lo que no es cabecera ni hunk antes del primer hunk es texto suelto: un
    // diff recortado o vacío se pinta tal cual en vez de inventarse líneas.
    if (!enHunk) {
      if (linea !== "") filas.push({ kind: "archivo", texto: linea });
      continue;
    }
    const marca = linea[0];
    const texto = marca === "+" || marca === "-" || marca === " " ? linea.slice(1) : linea;
    if (marca === "+") filas.push({ kind: "add", viejo: null, nuevo: nuevo++, texto });
    else if (marca === "-") filas.push({ kind: "del", viejo: viejo++, nuevo: null, texto });
    else filas.push({ kind: "ctx", viejo: viejo++, nuevo: nuevo++, texto });
  }
  return filas;
}

export function cuentaDiff(filas: Fila[]) {
  let mas = 0;
  let menos = 0;
  for (const f of filas) {
    if (f.kind === "add") mas += 1;
    else if (f.kind === "del") menos += 1;
  }
  return { mas, menos };
}
