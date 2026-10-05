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
| **A** | cerrar lo que estaba a medias | **cerrado el 2026-10-05**, incluido **A.2.4** (el campo `contexto_producto` del `BrainRequest`) |
| **B** | partir `commands.rs` por dominio | **cerrado el 2026-10-05**: `commands.rs` desaparecido, 85 comandos en 11 módulos + `_comunes` |
| **C** | servicios de verdad | sin empezar |
| **D** | design system y UI | sin empezar |
| **E** | una sola fuente de verdad | **cerrado hoy** (ver abajo) |
| **F** | el gate M0: benchmark baseline vs Brain | **cerrado el 2026-10-05**: mejora en el modelo divagador, **regresión medida** (+344 %) en el que sostiene la suite |
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
4. **A.2.4 — cerrado el 2026-10-05.** Skills y memoria viajaban como mensaje
   `system` en la cabecera del historial, así que eran lo primero que se caía al
   apretar la ventana, y `providers/anthropic.rs` filtraba los `system` del
   historial y los hacía desaparecer sin decir nada. Ahora hay campo propio en
   `BrainRequest` (`contexto_producto: Vec<Message>`): el crate lo pone en su capa
   `producto` del system, `Presupuesto.fijo` lo cuenta **una sola vez** y no se
   recorta nunca — si con todo dentro no cabe, el Plan lo dice en su `reason`. El
   Plan no sube de número (sigue en schema 7); entrada 25 del `decision-log` del
   crate.

**Gate:** los dos árboles limpios, las puertas de los dos repos verdes y ninguna
mentira de la UI pendiente de la auditoría. A.2.4 añadió, y está medido: conducta
idéntica con el campo vacío (el golden sin mover, 5 verdes), la batería
`--decisiones` intacta (24/24 nivel, 24/24 riesgo, bandas 14 / 3 / 7) y la prueba de
que con la ventana apretada se corta el historial **y el bloque sigue llegando** al
proveedor dentro del system.

## B. Bajar `commands.rs` a tierra — **cerrado el 2026-10-05**

Dividir por dominio en `src-tauri/src/commands/` (chat, projects, agent, models,
files, settings, data, system, git) **sin cambiar ninguna firma pública**: el
`invoke_handler` registra los mismos 85 comandos y el frontend no se entera.

**Gate:** `commands.rs` desaparecido o por debajo de 400 líneas, los 85 comandos
siguen registrados, todas las pruebas de la app pasan y `tsc` limpio. **Cumplido:**
el archivo desapareció, `grep -c "#\[tauri::command\]"` sobre `commands/` suma 85 y
`lib.rs` registra 85 rutas, las 175 pruebas siguen verdes, clippy `--all-targets
-D warnings` a cero y `tsc` limpio. Las 21 pruebas del `mod tests` que había al final
se repartieron en cinco módulos sin borrar ninguna, y el volcado regenerable del
prompt (`HATBOO_VOLCAR_PROMPT`) sale byte a byte igual: la mudanza no cambió lo que
ve el modelo.

Tres cosas que el reparto del plan no preveía, y que están hechas con su motivo
escrito:

- **Los nueve comandos de plantillas y memoria no tenían casa.** El plan proponía
  nueve módulos; meterlos en `settings` o `data` habría sido una mentira de dominio.
  Salen como `plantillas.rs` (6) y `memoria.rs` (3). A propósito **no** se llaman
  `cerebro.rs`: `crate::cerebro` es el puente al crate `hatboo-brain`, y las
  plantillas no pasan por ahí.
- **Hacía falta un sitio común**: `commands/_comunes.rs` (250 líneas) lleva
  `chat_system_prompt`, `CODE_MODE_PROMPT`, `titulo_breve`, `remove_image_files` y
  `ATTACHMENT_MAX_BYTES`. Sin eso el reparto no compila, porque `chat/stream.rs` y
  `agent/loop_runner.rs` llaman a esas funciones por la ruta de `commands`.
- **`commands/mod.rs` reexporta cinco símbolos** (`project_rules_for_prompt`,
  `rules_status`, `approve_rules`, `revoke_rules`, `RESET_TOKEN`): `tests/db.rs`
  los llama por fuera del binario con la ruta vieja. Partir el archivo sin
  reexportarlos rompía 24 llamadas de la batería del Trust Gate.

Queda para C: `files.rs` (869 líneas) tiene un corte natural entre adjuntos y árbol
del proyecto que no se tomó aquí porque sería *cambiar*, no *mover*; y la duplicación
`audio_data_uri` / `image_data_uri`, que se dejó intacta por el mismo motivo.

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

## F. El gate M0 — **cerrado el 2026-10-05, con regresión medida**

Cuatro pasadas limpias del split `dev` (24 entradas), tres repeticiones,
`temperature 0` con semilla, margen del Governor en 250 MB y nada compilando dentro
de la ventana (11:32 → 14:06). Los informes están en el crate:
`benchmarks/m0-qwen3.5_0.8b.md` y `benchmarks/m0-qwen2.5-coder_1.5b.md`, con los
volcados crudos en `benchmarks/volcados/`.

Lo que dice el número, en las tres palabras del gate:

| Modelo | Coste por respuesta | Veredicto |
| --- | --- | --- |
| `qwen3.5:0.8b` | 84,2 s → 17,7 s · 1024 → 192 tokens de salida | **mejora** |
| `qwen2.5-coder:1.5b` | 3,0 s → 13,5 s (+344 %) · 14 → 31 tokens | **REGRESIÓN** |

Y las dos lecturas que importan, porque el número solo no las dice:

- La «mejora» del 0,8b es **el tope de salida del Plan**, no un modelo más listo: el
  baseline no tenía tope y se iba a los 1024 tokens divagando. `Verificado` salió
  **0 → 0**: no hay evidencia de que las respuestas fueran mejores.
- La regresión del coder tiene nombre y coste: **24 recargas de contexto y 16
  reintentos** en la pasada (3,7 s medidos por recarga en esta máquina). Es el precio
  de administrar, y hasta hoy no estaba medido. En ese mismo modelo es donde la
  verificación determinista aterriza por primera vez: `Verificado` 0 → **9**.

**Consecuencia para el plan:** con este número **no se enciende el Brain por defecto**
ni se abre la Fase 7. Lo que abre es una tarea concreta antes de eso: bajar el coste
de recarga (el `keep_alive` y el vaivén de `num_ctx`) en el camino de coste bajo, y
añadir entradas a la suite — el 100 % de la batería `--decisiones` es saturación, no
virtud.

Para llegar aquí hubo que arreglar el instrumento: el `--comparar` metía los rechazos
de 2 ms y 0 tokens en la mediana de coste y sacaba «-99,9 % de mejora» de un modelo que
no se encendió, y promediaba las recargas por entrada (una en tres repeticiones promedia
a cero) de modo que el informe decía «0 recargas» en un pase que había contado 24.
Reglas nuevas, con sus pruebas: se comparan **solo las entradas que generaron en los dos
bandos**, las medianas de coste se calculan **solo sobre lo que generó**, los
contadores de eventos van **en suma**, y ningún coste sale **sin su rango**. Entrada 24
del `decision-log` del crate.

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
