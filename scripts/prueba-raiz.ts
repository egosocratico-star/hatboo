/**
 * Prueba de la heurística de «esta raíz no es un proyecto». Se corre con
 * `npm run prueba-raiz`: la regla vive en `src/raiz.ts`, pura y sin React, justo
 * para comprobarla sin abrir la app.
 */
import { sospechaRaiz } from "../src/raiz.ts";

let fallos = 0;
let casos = 0;

function espera(descripcion: string, ruta: string, querida: string | null) {
  casos += 1;
  const obtenida = sospechaRaiz(ruta);
  if (obtenida === querida) {
    console.log(`  ok    ${descripcion}`);
    return;
  }
  fallos += 1;
  console.log(
    `  FALLA ${descripcion}: se quería ${JSON.stringify(querida)}, salió ${JSON.stringify(obtenida)}`,
  );
}

console.log("raíz del proyecto — cuándo hay que avisar");

espera("Documentos en español", "C:\\Users\\User\\Documents", "documentos");
espera("Documents en inglés", "C:\\Users\\User\\Documents", "documentos");
espera("Documentos con barra final", "C:/Users/User/Documents/", "documentos");
espera(
  "Documentos de OneDrive gana la nube",
  "C:\\Users\\User\\OneDrive\\Documentos",
  "onedrive",
);
espera("una carpeta de OneDrive cualquiera", "D:\\OneDrive\\Papeles", "onedrive");
// `C:\\Users\\x\\OneDrive` es a la vez «una carpeta del usuario» y la nube; gana
// la nube porque es el aviso que aporta algo.
espera("el OneDrive del usuario", "C:\\Users\\User\\OneDrive", "onedrive");
espera("la carpeta del usuario pelada", "C:\\Users\\User", "casa");
espera("la home en Linux", "/home/azrael", "casa");
// Lo que NO es un aviso: un proyecto de verdad, aunque esté dentro de Documentos.
espera("un repo dentro de Documentos", "C:\\Users\\User\\Documents\\hatboo", null);
espera("la Downloads de alguien", "C:\\Users\\User\\Downloads", null);
espera("una ruta de Linux que no es home", "/var/www/mi-sitio", null);
espera("una carpeta con 'documentos' dentro del nombre", "D:\\mis-documentos\\app", null);
espera("vacío, sin raíz", "", null);
// `C:\Users\x\AppData\Local`: dos tramos por debajo del usuario, no es la casa.
espera("algo hundido en AppData", "C:\\Users\\User\\AppData\\Local\\hatboo", null);

console.log(`\n${casos - fallos}/${casos} casos bien.`);
if (fallos > 0) process.exit(1);
