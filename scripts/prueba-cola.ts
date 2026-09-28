/**
 * Prueba de la regla de la cola de tareas. Se corre con `npm run prueba-cola`
 * (o `node scripts/prueba-cola.ts`): la lógica vive en `src/cola.ts`, que es
 * pura, justamente para poder comprobarla sin abrir la app.
 */
import { proximaDeCola, type EstadoCola } from "../src/cola.ts";

let fallos = 0;
let casos = 0;

function espera(descripcion: string, tab: EstadoCola | null, querida: string | null) {
  casos += 1;
  const obtenida = proximaDeCola(tab);
  if (obtenida === querida) {
    console.log(`  ok    ${descripcion}`);
    return;
  }
  fallos += 1;
  console.log(`  FALLA ${descripcion}: se quería ${JSON.stringify(querida)}, salió ${JSON.stringify(obtenida)}`);
}

const base: EstadoCola = {
  agentStatus: "idle",
  cola: [],
  colaEnPausa: false,
  approval: null,
  planReview: null,
};
const con = (p: Partial<EstadoCola>): EstadoCola => ({ ...base, ...p });

console.log("cola de tareas — cuándo salta la siguiente");

espera("sin cola, nada que lanzar", con({}), null);
espera("con la pestaña cerrada, nada", null, null);
espera("en curso: no se lanza encima de otra tarea", con({ cola: ["a", "b"], agentStatus: "running" }), null);
espera("esperando aprobación: tampoco", con({ cola: ["a"], agentStatus: "awaiting" }), null);
espera("con error: no se encadena", con({ cola: ["a"], agentStatus: "error" }), null);
espera("en pausa por un fallo o un cancelar", con({ cola: ["a"], colaEnPausa: true }), null);
espera(
  "libre pero con una acción esperando aprobación",
  con({ cola: ["a"], approval: { conversationId: "s-1", toolName: "write_file" } }),
  null,
);
espera(
  "libre pero con un plan esperando revisión",
  con({ cola: ["a"], planReview: { conversationId: "s-1", planId: "p-1", pasos: ["x"] } }),
  null,
);
espera("libre de verdad: sale la primera, no otra", con({ cola: ["primera", "segunda"] }), "primera");

// La cadena completa: es lo que él deja montado y quiere ver correr solo.
const cola = ["redactar el informe", "revisar los nombres", "comitear"];
let estado: EstadoCola = con({ cola: [...cola] });
const orden: string[] = [];
for (let i = 0; i < 10; i += 1) {
  const siguiente = proximaDeCola(estado);
  if (siguiente === null) break;
  orden.push(siguiente);
  estado = { ...estado, cola: estado.cola.slice(1), agentStatus: "running" };
  // Termina la tarea: la sesión vuelve a estar libre y la cola sigue sola.
  estado = { ...estado, agentStatus: "idle" };
}
casos += 1;
if (orden.join("|") === cola.join("|")) {
  console.log("  ok    la cadena sale entera, en el orden en que se escribió");
} else {
  fallos += 1;
  console.log(`  FALLA la cadena salió ${JSON.stringify(orden)}, se quería ${JSON.stringify(cola)}`);
}
casos += 1;
if (estado.cola.length === 0 && proximaDeCola(estado) === null) {
  console.log("  ok    al vaciarse ya no se lanza nada más");
} else {
  fallos += 1;
  console.log("  FALLA quedó algo pendiente después de la última tarea");
}

// Y si se corta por el camino, no se reanuda solo.
const cortada: EstadoCola = con({ cola: ["una", "dos"], colaEnPausa: true });
casos += 1;
if (proximaDeCola(cortada) === null && cortada.cola.length === 2) {
  console.log("  ok    en pausa la cola se conserva entera, no se pierde");
} else {
  fallos += 1;
  console.log("  FALLA en pausa se lanzó algo o se perdió la cola");
}

console.log(`\n${casos - fallos}/${casos} casos correctos`);
process.exit(fallos === 0 ? 0 : 1);
