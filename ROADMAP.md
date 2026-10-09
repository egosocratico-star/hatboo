# Roadmap de Hatboo

Esto es un plan con puertas, no una lista de deseos. Cada bloque tiene un **gate**:
lo que hay que ver para poder decir «cerrado». Un bloque no empieza con el
anterior sin cerrar. Lo que se hizo ya está en `CHANGELOG.md`; cómo está organizado
el código hoy está en `ARCHITECTURE.md`.

## Estado del corte: **0.7.0 compilada el 07-10, sin publicar**

`package.json`, `tauri.conf.json`, `Cargo.toml` y el bloque generado del README dicen
`0.7.0`, y el `CHANGELOG.md` tiene su entrada (es lo que comprueba
`npm run version:comprobar`). El `npm run tauri build` de esta máquina salió bien en
**14 m 19 s** y dejó dos instaladores:

```text
src-tauri/target/release/bundle/msi/Hatboo_0.7.0_x64_en-US.msi    8,56 MB
src-tauri/target/release/bundle/nsis/Hatboo_0.7.0_x64-setup.exe   5,41 MB
```

**Los dos ficheros son de las 10:50 del 09-10 y son los primeros reproducibles**: el
`src-tauri/Cargo.lock` resuelve `hatboo-brain` contra `main#48d3dee` publicado en GitHub,
no contra un directorio del portátil — el `[patch]` local se apartó, el lock se
regeneró, se verificó que el exe lleva las cadenas de este corte (crate: «Este turno se
responde con texto», «apagado por el nivel», «Turno: una pregunta»; app: «es una
conversación», y el `dist/` con «No declara visión» del selector nuevo) y los paquetes
npm de Tauri se alinearon con los crates (api 2.12 · opener 2.7 · dialog 2.8, que el
regen del lock había dejado por detrás). En el ACL generado sigue
`core:window:allow-destroy` —el permiso que faltaba y por el que la X no cerraba la
app—. Cerrado el binario con una petición de cierre normal, el proceso **termina** con la
ventana a la vista; con ella minimizada no llega el aviso y queda anotado (tarea #48).

Verificado sobre el binario, no sobre la esperanza: el `Cargo.lock` resuelve
`hatboo-brain` **sin `source`**, o sea por el `[patch]` local, así que el instalador
lleva dentro el Governor del 06-10 (comprobado buscando en el ejecutable las cadenas
`Se corre a` y `ventana corta`, que solo existen ahí). Y en el `dist/` que se
empaquetó está el tooltip nuevo del buscador y **no** está la línea del pie que se
borró. El binario arranca y se queda en pie (log `C:\tmp\hatboo-release-070.log`).

**Lo que falta para que sea una release de verdad**, en este orden y cada uno con su
riesgo dicho: (1) commitear los dos repos, (2) empujar el crate y sacar su primera
etiqueta, (3) regenerar `src-tauri/Cargo.lock` contra el rev publicado **sin** el
`[patch]` y reconstruir —si no, el instalador que se suba a GitHub no es
reproducible: lleva un crate que está en un directorio de mi portátil—, (4) la
etiqueta `v0.7.0` de Hatboo y la publicación. **No se hizo ninguna de las cuatro**:
empujar y publicar es acción sobre lo compartido, y no se hace sin que él lo diga
explícitamente. Tampoco se instaló nada: se ejecutó el binario, no el `.msi`.

**Y una nota sobre «añadir cosas»**, porque el 05-10 se tomó la decisión contraria y
está escrita arriba: «**0.7 no añade funciones**… No hace falta más Hatboo: hace
falta menos Hatboo, mejor organizado». En esta tanda se hicieron mejoras y quites
(honestidad de la previa de Apariencia, allowlist del T7, un solo dueño de la curva,
Ajustes en dos tramos, el compositor más corto, el nivel por defecto recuperado) y
**ninguna función nueva**. Si ahora toca añadir, eso es reabrir esa decisión —o
moverlo a 0.8—, y las candidatas que ya están en los papeles son: página de Seguridad
y página de Diagnósticos propias, partir `Api` (seis temas en una pantalla), FTS5
para el `Ctrl+K` con su comparación medida, y volver a montar el medidor de contexto
con la puerta de G.5.

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
| **C** | servicios de verdad | **cerrado el 2026-10-05**: ocho servicios, y la capa IPC sin disco, HTTP ni SQL en producción |
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

## C. Servicios de verdad — **cerrado el 2026-10-05**

Sacar del comando lo que no es IPC: el ensamblado del system prompt
(`ContextService`), la resolución de proveedor + modelo (`ModelService`), el
arranque del agente (`AgentService`). Cada uno con prueba propia, sin pantalla.

**Gate:** ningún módulo de `commands/` hace `fs`, SQL o HTTP directamente, y cada
comportamiento sacado del comando tiene su prueba en el servicio. **Cumplido y
medido con `grep` sobre `src-tauri/src/commands/`: 0 líneas de producción tocando el
disco** (las 39 que aparecen están todas dentro de `#[cfg(test)]`: el escenario que
cada prueba se monta), **0 `reqwest`** y **0 SQL crudo**. Antes: 70 de disco, 5 de
HTTP y 2 de SQL. `npm run check` sube de 175 a **214 verdes** (181 del lib) con las
pruebas de los servicios.

Ocho módulos en `src-tauri/src/servicios/`: `contexto.rs` (352), `modelo.rs` (336),
`archivo.rs` (643), `agente.rs` (368), `adjuntos.rs` (284), `proyecto.rs` (141),
`captura.rs` (132) y `plantillas.rs` (104). La capa IPC pasa a 2655 líneas de puro
contrato.

Dos arreglos de fondo que trae este bloque, y son los que valen:

- **La recolección del prompt tenía cuatro escrituras a mano** (el visor del system
  prompt, el medidor de contexto, el streaming del chat y el bucle del agente), cada
  una con su forma de tomar el mutex. Ahora es `ContextService`, con el lock tomado
  **una sola vez**, y `load_settings` se lee antes de cogerlo: comparten mutex, y
  leerlo dentro es un deadlock silencioso.
- **El Trust Gate tenía dos caminos.** La lectura que inyecta `HATBOO.md` estaba
  escrita en la capa IPC y el bucle del agente decides otra vez qué entraba. Ahora
  hay una sola (`crate::rules::para_prompt`), a la que llaman el servicio y la
  pantalla de reglas: la interfaz ya no puede declarar «aprobadas» sobre un texto
  que el modelo no está recibiendo.

Se fue **todo** el disco de la capa IPC, incluido el explorador de archivos:
`commands/files.rs` es ahora un adaptador fino sobre `servicios/archivo.rs`, y lo
mismo `plantillas.rs` sobre `servicios/plantillas.rs`. Lo que se llevó cada mudanza
fue su validación intacta — la sandbox de rutas contra la raíz del proyecto, el tope
de 4 MB y el formato no soportado de `guardar_imagen`, el truncado/binario de
`read_attachment`, el `../` — y tres de esas validaciones **no estaban atadas a ninguna
prueba**: ahora sí lo están (`list_project_dir`, `preview_project_file` y
`search_project_files` con su `../`, además del tope y del adjunto grande).

Quedan apuntados, sin hacer a propósito porque serían *cambiar* y no *mover*: partir
`servicios/archivo.rs` (643 líneas) en adjuntos y árbol, y unificar `audio_data_uri`
con `image_data_uri`, que son el mismo cuerpo con dos nombres.

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

**Sin cerrar de E (actualizado el 06-10):** el crate ya tiene `CHANGELOG.md` —escrito
desde su `git log`, agrupado por lo que nota el consumidor, y enlazado desde su
README— y su `docs/decision-log.md`. Lo que sigue sin haber es **etiqueta**:
`Cargo.toml` dice `0.1.0` sin ningún `v*`, así que lo que Hatboo clava sigue siendo un
rev de `main` en su `Cargo.lock`. Publicar la primera versión del crate es decisión
suya (empuja con los commits pendientes), no trabajo pendiente de arquitectura.

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

**Addendum del 05-10, cerrado el gate.** La tarea de recarga se atacó el mismo día, y
por el lado que él pidió: la RAM dejó de ser una puerta. La escalera bajó a cinco
peldaños con los dos nuevos medidos (`num_ctx_suelo` por debajo de lo que el nivel
pide), el Governor aprieta la ventana o gasta el margen en vez de negar el turno, y
con el modelo residente a una ventana que cumple el nivel no se le mueve —que es lo
que producía las 24 recargas, 3,7 s cada una—. Medido en un pase corto sobre este
mismo modelo (8 saludos, `--reps 2`, 1936 MB libres): **1 carga, 0 rechazos**, 1237 ms
de mediana [776–1704]. Eso **no** es un delta contra las 72 corridas de arriba —otras
condiciones, otra categoría y menos repeticiones—; el `--comparar` al mismo nivel
sigue pendiente, y con él la decisión de encender. `Verificado` 0 → 9 no se toca: la
verificación nunca dependió de la puerta. Entrada 26 del `decision-log` del crate.

Y el otro freno que él señaló —«el modelo está cargando y después continúa el brain»—
no era el modelo: era la app reconociendo la máquina en cada mensaje. Medido con su
propio config: **4414 ms** por turno (1386 de `/api/tags` + 3028 de las once fichas
pedidas de una en una). Las fichas van en paralelo (306 ms) y el listado se guarda en
caché 90 s; la sonda del adaptador lo comprueba: frío 1237 ms, caliente 0 ms, decidir
0 ms. Entrada 27 del mismo registro.

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
