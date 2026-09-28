/**
 * La regla de cuándo la cola suelta la siguiente tarea. Vive aparte del store
 * porque dentro de `workStore` no se puede probar sin un Tauri delante: aquí es
 * una función y sus casos se comprueban con `node`.
 */
export interface EstadoCola {
  agentStatus: string;
  cola: string[];
  /** Puesta por un fallo o un cancelar: sin quitarla, la cola no arranca. */
  colaEnPausa: boolean;
  /** Acción esperando aprobación. La sesión no está libre aunque el estado lo parezca. */
  approval: unknown;
  /** Plan esperando que se revise antes de ejecutarse. */
  planReview: unknown;
}

/** La tarea que toca lanzar, o `null` si no toca nada todavía. */
export function proximaDeCola(tab: EstadoCola | null): string | null {
  if (!tab) return null;
  if (tab.colaEnPausa || tab.cola.length === 0) return null;
  if (tab.agentStatus !== "idle") return null;
  if (tab.approval || tab.planReview) return null;
  return tab.cola[0];
}
