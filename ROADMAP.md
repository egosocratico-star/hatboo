# Roadmap de Hatboo

Esto es un plan con puertas, no una lista de deseos. Cada bloque tiene un **gate**:
lo que hay que ver para poder decir «cerrado». Un bloque no empieza con el
anterior sin cerrar. Lo que se hizo ya está en `CHANGELOG.md`; cómo está organizado
el código hoy está en `ARCHITECTURE.md`.

La decisión de fondo, tomada el 2026-10-05: **0.7 no añade funciones**. Hatboo ya
tiene chat multi-proveedor, streaming, razonamiento, web, imágenes, GitHub,
plantillas, proyectos, sandbox, aprobaciones, plan editable, `HATBOO.md`, cambios
de sesión, tareas, exportación, copias, diagnósticos y hardware. El problema dejó
de ser la lista de funciones y pasó a ser la estructura y la UX que esa lista
produjo. **No hace falta más Hatboo: hace falta menos Hatboo, mejor organizado.**

```
0.6.0 (publicada) ──► 0.7 = REFACTOR ──► 0.8 = Brain ──► 0.9 = Workspace ──► 1.0
                       A B C D E F         sin funciones     Shell/Browser    —
                       G no entra en 0.7
```

## Estado ahora mismo

| Bloque | Qué es | Estado |
| --- | --- | --- |
| **A** | cerrar lo que estaba a medias | cerrado menos **A.2.4** (el campo `contexto_producto` del `BrainRequest`) |
| **B** | partir `commands.rs` por dominio | sin empezar |
| **C** | servicios de verdad | sin empezar |
| **D** | design system y UI | sin empezar |
| **E** | una sola fuente de verdad | **cerrado hoy** (ver abajo) |
| **F** | el gate M0: benchmark baseline vs Brain | **en curso**, corrida limpia lanzada el 2026-10-05 |
| **G** | Engine, Policy, Process, Browser, esquema | **fuera de 0.7** por decisión |

El orden de ejecución detallado, con el triage de los planes que llegaron de fuera
y el diseño cerrado de A.2.4, está en `HATBOO-0.7-ORDEN.md` (fichero de trabajo del
espacio de desarrollo, no del repo).

## A. Cerrar lo que está a medias

1. `respetar_modelo` en la app: el modelo que el usuario elige no lo sustituye el
   Brain a sus espaldas. Hecho y commiteado.
2. Las cuatro costuras que midió la auditoría: el `ProjectContext` que Hatboo
   mandaba falso, el modo trabajo que no pasaba historial/skills/memoria/reglas, el
   ejecutor de verificación inalcanzable y `src/project/` del crate sin
   consumidor. Hechas.
3. La frontera del modelo escrita como decisión cerrada (entrada 23 del
   `decision-log` del crate).
4. **A.2.4** — queda esto: skills y memoria viajan hoy como mensaje `system` en la
   cabecera del historial, así que son lo primero que se cae cuando aprieta la
   ventana, y `providers/anthropic.rs` filtra los `system` del historial y los
   hace desaparecer sin decir nada. Se arregla con un campo propio en
   `BrainRequest` (`contexto_producto: Vec<Message>`), no recortable por el
   presupuesto de contexto y contabilizado en el Plan.

**Gate:** los dos árboles limpios, las puertas de los dos repos verdes y ninguna
mentira de la UI pendiente de la auditoría. A.2.4 añade: conduct idéntica con el
campo vacío (golden sin mover), la batería `--decisiones` intacta y el bloque que
no aparece en `historial_recortado` cuando aprieta la ventana.

## B. Bajar `commands.rs` a tierra

Dividir por dominio en `src-tauri/src/commands/` (chat, projects, agent, models,
files, settings, data, system, git) **sin cambiar ninguna firma pública**: el
`invoke_handler` registra los mismos 85 comandos y el frontend no se entera.

**Gate:** `commands.rs` desaparecido o por debajo de 400 líneas, los 85 comandos
siguen registrados, todas las pruebas de la app pasan y `tsc` limpio.

## C. Servicios de verdad

Sacar del comando lo que no es IPC: el ensamblado del system prompt
(`ContextService`), la resolución de proveedor + modelo (`ModelService`), el
arranque del agente (`AgentService`). Cada uno con prueba propia, sin pantalla.

**Gate:** ningún módulo de `commands/` hace `fs`, SQL o HTTP directamente, y cada
comportamiento sacado del comando tiene su prueba en el servicio.

## D. Design system y UI

En este orden, porque el anterior es prerrequisito del siguiente: **tokens →
movimiento → barra lateral → centro → compositor → Ajustes partido en
Básico/Avanzado**.

La lección del movimiento está escrita y es la razón de empezar por ahí: el ajuste
*Reducido* se quitó en 0.6.0 porque dejaba las transiciones en 0,01 ms sin quitar
las iteraciones, lo que convertía cualquier `animate-pulse` en un estroboscopio. No
«cada componente con su animación», sino **tokens, presets y preferencias**.

Reducir, no añadir: los controles permanentes que sobran salen de verdad. La
dirección visual es la que se probó en 0.6.0 y se dejó a medias — espacio, una
escala, el respiradero del centro y un compositor que sea la firma de la app, con
los detalles (adjuntos, plantillas, herramientas, razonamiento, proveedor,
contexto) apareciendo cuando hacen falta.

**Gate:** una sola escala tipográfica y una sola curva de movimiento; gente que no
conoce la app la usa sin ayuda; axe sin críticos; y ninguna pantalla afirma algo
que no esté pasando.

## E. Una sola fuente de verdad — cerrado 2026-10-05

- `CHANGELOG.md`, `ARCHITECTURE.md` y este fichero.
- La versión se teclea **una vez**, en `package.json`. `npm run version:escribir`
  la reparte a `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` y al bloque
  generado del README; `npm run version:comprobar` corta la CI si divergen o si el
  CHANGELOG no conoce la versión.
- El README ya no puede decir «última release v0.5.0»: enlaza a
  `releases/latest` y el número de su estado lo genera el script.
- Queda escrito por qué no se usa `"version": "../package.json"` en el manifiesto de
  Tauri (`scripts/version.mjs`, comentario de cabecera): el deserializador de
  `tauri-utils` resuelve la ruta contra el **directorio de trabajo del proceso**, no
  contra el fichero, y desde la raíz del repo el string se intentaría parsear como
  semver.

**Sin cerrar de E:** el crate (`hatboo-brain`) no tiene etiquetas ni `CHANGELOG.md`;
lo que Hatboo clava es un rev de `main` en su `Cargo.lock`. Se necesita una sola
publicación del crate para poder decir «la dependencia tiene versión».

## F. El gate M0

La corrida limpia baseline-vs-Brain con dos modelos que **sí** sostienen la suite
(`qwen3.5:0.8b` y `qwen2.5-coder:1.5b`), tres repeticiones, máquina tranquila, e
informe publicado en `benchmarks/`. Es el número que decide si la Fase 6/7 se
enciende y si el Brain se conecta del todo.

**Gate:** informe con medianas y rango, y un veredicto que diga «mejora»,
«regresión» o «no se puede afirmar».

**Regla de esta máquina, que ya costó tres corridas tiradas:** no se compila ni se
ejecuta nada pesado mientras se mide. En 8,45 GB sin GPU, un `cargo` dentro de la
ventana de medición cambia el veredicto — y un veredicto cambiado por haber
medido sucio es peor que no medir.

## G. Después de A-F, y no antes

Engine unificado, Policy Engine, Process Engine (lo que compartiría Hatboo Shell),
Browser Runtime y la limpieza de esquema (índices, FTS5, transacciones,
checkpoints). Cada uno abre su propio plan con su gate. **Ninguno es de 0.7.**

Regla que se añade aquí: el crate no debe conocer a Hatboo. Si una pieza de
`hatboo-brain` necesita saber que su consumidor es Hatboo, va mal — el crate tiene
que seguir siendo consumible por más de un producto.

## Lo que no va en ningún bloque (decisiones cerradas)

- **Memoria mágica entre conversaciones**: descartado a propósito y documentado.
  Primero memoria de sesión/proyecto/tarea; después, si hace falta, de usuario.
- **Autoactualización, cuentas, sincronización entre dispositivos**: fuera.
- **Que el Brain elija el modelo**: cerrado en la dirección contraria. El producto
  elige; el Brain escala solo tras un fallo real, dejando evento, linaje y motivo.
