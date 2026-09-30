/**
 * Prueba de la regla del `/` de las plantillas. Se corre con `npm run prueba-slash`:
 * la lógica vive en `src/slash.ts`, pura, para comprobarla sin abrir la app —y sobre
 * todo para comprobar los casos que no se ven: las rutas con barras.
 */
import { aplicarSlash, filtraSkills, opciones, raizSlash, MAX_SLASH } from "../src/slash.ts";

let fallos = 0;
let casos = 0;

function espera<T>(descripcion: string, obtenida: T, querida: T) {
  casos += 1;
  const ok = JSON.stringify(obtenida) === JSON.stringify(querida);
  if (ok) {
    console.log(`  ok    ${descripcion}`);
    return;
  }
  fallos += 1;
  console.log(`  FALLA ${descripcion}`);
  console.log(`        quería ${JSON.stringify(querida)}`);
  console.log(`        salió  ${JSON.stringify(obtenida)}`);
}

const skill = (n: string) => ({ name: n, prompt: `plantilla de ${n}`, id: n, enabled: true });
const SURTIDO = [skill("Resumen"), skill("resumir reunión"), skill("Traducir"), skill("Corregir")];

console.log("slash — cuándo abre la lista de plantillas");

espera("barra al principio", raizSlash("/re", 3), { desde: 0, consulta: "re" });
espera("barra sola, todavía sin consulta", raizSlash("/", 1), { desde: 0, consulta: "" });
espera("texto vacío", raizSlash("", 0), null);
espera("sin barra", raizSlash("hola qué tal", 13), null);
espera("barra en medio de la frase", raizSlash("hola /re", 8), { desde: 5, consulta: "re" });
// Los falsos positivos que había que evitar: una URL y una ruta.
espera("una URL no abre la lista", raizSlash("https://x.com", 13), null);
espera("una ruta con barras no abre", raizSlash("/etc/hosts", 10), null);
espera("una ruta de Windows al principio tampoco", raizSlash("C:/Users/x", 10), null);
espera(
  "la barra suelta de una división no abre",
  raizSlash("3 / 2", 5),
  null,
);
// Y lo que sí: la consulta puede llevar espacios (los nombres los llevan).
espera("consulta con espacio", raizSlash("/resum ir", 9), { desde: 0, consulta: "resum ir" });
espera("salto de línea dentro de la consulta, se cierra", raizSlash("/a\nb", 4), null);
espera("otra línea, barra nueva: sí", raizSlash("texto\n/res", 10), { desde: 6, consulta: "res" });
espera("caret por delante de la barra", raizSlash("/res", 1), { desde: 0, consulta: "" });

console.log("\nslash — qué se filtra y qué se sustituye");

espera("sin consulta, todas", filtraSkills(SURTIDO, "").length, 4);
espera("filtra sin distinguir mayúsculas", filtraSkills(SURTIDO, "RESU").map((s) => s.name), [
  "Resumen",
  "resumir reunión",
]);
espera("vacío si no casan", filtraSkills(SURTIDO, "zzz"), []);
espera("con la raiz nula no hay lista", opciones(SURTIDO, null), []);
espera(
  "la lista se corta en 6",
  opciones(Array.from({ length: 40 }, (_, i) => skill(`p${i}`)), { desde: 0, consulta: "" }).length,
  MAX_SLASH,
);

// «escribe /re aquí»: la barra cae en 8 y el caret, tras la «e», en 11.
espera(
  "se sustituye solo la orden, no el texto entero",
  aplicarSlash("escribe /re aquí", 11, { desde: 8, consulta: "re" }, "Resumen"),
  { texto: "escribe Resumen aquí", caret: 15 },
);
espera(
  "la orden del principio desaparece",
  aplicarSlash("/tra", 4, { desde: 0, consulta: "tra" }, "Traducir el texto"),
  { texto: "Traducir el texto", caret: 17 },
);

console.log(`\n${casos - fallos}/${casos} casos correctos`);
if (fallos > 0) process.exit(1);
