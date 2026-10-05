# Arquitectura de Hatboo

Foto de cómo está organizado hoy, no de cómo debería estar. Las cifras están
**medidas el 2026-10-05** (`wc -l` sobre el árbol, no de memoria); si tocas el
código y cambian, este fichero miente y hay que actualizarlo — es lo que se
intenta evitar con el `CHANGELOG.md` y con `npm run version:comprobar`.

Hay **dos repos**, y así se leen los nombres de pila abajo:

| Repo | Qué es | Tamaño |
| --- | --- | --- |
| [`hatboo`](https://github.com/egosocratico-star/hatboo) | la app: Tauri 2 (Rust) + React 18 (TS) + SQLite | 16.075 líneas de Rust en `src-tauri/src`, 20.178 de TS/TSX en `src` |
| [`hatboo-brain`](https://github.com/egosocratico-star/hatboo-brain) | el cerebro que administra el trabajo alrededor de un modelo: crate Rust, lib + bin | 17.534 líneas en `src` + 3.818 en `tests`, 16 módulos, dos pruebas de integración propias (`--decisiones` y `brain-bench`) |

El crate **no conoce Hatboo**. Lo consume quien lo mete, por git dependency. Si una
pieza del crate necesita saber que su consumidor es Hatboo, está mal puesta.

---

## 1. Las capas, con sus nombres reales

```
React (src/)
   │  invoke(nombre, args)      ← 85 comandos registrados en src-tauri/src/lib.rs
   │  escucha chat:* / agent:*   ← 15 eventos
   ▼
commands/  (3336 líneas en 12 módulos)   ← la capa IPC. Sigue haciendo SQL, fs y HTTP.
   │  chat 441 · agent 458 · files 869 · projects 344 · models 288 · _comunes 250
   │  plantillas 223 · data 217 · system 97 · git 46 · settings 37 · memoria 33
   │  (y 33 de `mod.rs`: la documentación del reparto y las reexportaciones)
   │
   ├─ state.rs        AppState: conexión SQLite, data_dir, ajustes, builders de proveedor
   ├─ db/             esquema (schema.sql) y acceso a datos          (2507)
   ├─ providers/      Anthropic, OpenAI, local (Ollama), imagen, audio, SSE (2378)
   ├─ chat/           streaming del chat: tarea, cancelación, guardado (534)
   ├─ agent/          loop del modo trabajo y sus herramientas       (3255)
   ├─ cerebro/        la costura con hatboo-brain                    (2057)
   ├─ rules.rs        Trust Gate del HATBOO.md (SHA-256)             (131)
   ├─ redact.rs       tapado de secretos antes de salir              (175)
   ├─ web.rs          DuckDuckGo sin clave                           (365)
   ├─ machine.rs      qué hay en esta máquina: RAM, núcleos, GPU     (101)
   ├─ behavior.rs     conductas de la sesión                         (228)
   └─ backup.rs       export/import/fábrica en un JSON               (411)
```

`commands/_comunes.rs` no es un dominio: son los helpers que usan varios a la vez
(`chat_system_prompt`, `CODE_MODE_PROMPT`, `titulo_breve`, `remove_image_files`,
`ATTACHMENT_MAX_BYTES`). Y `commands/mod.rs` reexporta `project_rules_for_prompt`,
`rules_status`, `approve_rules`, `revoke_rules` y `RESET_TOKEN` porque fuera del
binario se llaman por la ruta vieja —`tests/db.rs` sobre todo—: partir el archivo no
podía romper ese camino.

`hatboo-brain` por dentro, en el orden que recorre una petición:

```
BrainRequest → Fast Path → Decision Engine → Planner + Governor → Plan firmado
              → Context (recorte) → Tool Gate → Selector de modelo → Provider
              → Verificación → Recovery
```

Cinco contratos estables entre los dos repos: **Request · Decision · Plan ·
Provider · Verification**. Lo demás es interno del crate. `Plan` sale con
`SCHEMA_VERSION = 7`, y subir ese número exige entrada nueva en
`hatboo-brain/docs/decision-log.md` y tocar la prueba que ata el registro al
código — no es un detalle de formato, es el contrato.

## 2. El contrato IPC

- **Hacia abajo**: `invoke("nombre", { args })`. El frontend no importa tipos de
  Rust; los espejos viven en `src/types.ts` (520 líneas). Los nombres de comando
  son la API pública: el bloque B del plan los parte por dominio **sin cambiar
  ninguno**, así que el frontend no se entera.
- **Hacia arriba**: eventos. `chat:chunk`, `chat:reasoning`, `chat:status`,
  `chat:done`, `chat:error`, `chat:stopped`, `chat:brain`, `agent:plan`,
  `agent:plan_review`, `agent:step_result`, `agent:approval_needed`,
  `agent:reasoning`, `agent:done`, `agent:error`, `agent:cancelled`. Los emiten
  cuatro ficheros: `chat/stream.rs`, `agent/loop_runner.rs`, `cerebro/real.rs`,
  `cerebro/trabajo.rs`.
- **Estado del frontend**: dos stores de Zustand, `chatStore.ts` (675) y
  `workStore.ts` (715). Los hooks `useStreaming`, `useAgentEvents`, `useSoltados`
  y `useSlashSkills` son la única parte que habla Tauri; el resto de componentes
  recibe props.

## 3. Los dos flujos

**Chat normal.** `send_message` levanta una tarea en Tokio, `chat/stream.rs` abre
el SSE del proveedor, va emitiendo `chat:chunk`/`chat:reasoning` y guarda lo
generado al terminar. **Si el usuario pulsa detener, se corta en el servidor**, no
solo en la interfaz, y lo ya escrito queda guardado como respuesta parcial.

**Modo trabajo.** `start_work_task` → `agent/loop_runner.rs`: planifica (con
`agent:plan`, y `agent:plan_review` si *Revisar el plan* está activo: el usuario
reescribe la lista y se ejecuta **esa**), luego vueltas de herramienta hasta
terminar. Cada herramienta pasa por el sandbox de rutas y por el nivel de
aprobación del proyecto; `write_file` siempre enseña diff antes de aplicarse.

**Con el cerebro encendido** (interruptor en Ajustes → Agente; la feature de Rust
`cerebro` está compilada, el flag está off en ejecución): el turno pasa por
`cerebro/real.rs` en el chat y `cerebro/trabajo.rs` en el modo trabajo. El crate
decide nivel de esfuerzo, recorta contexto, filtra herramientas y verifica la
salida; emite `chat:brain` con la ficha de la decisión y el porqué. Hay una
frontera cerrada a propósito: **el producto elige el modelo**
(`respetar_modelo`), y el Brain solo lo escala tras un fallo real, dejando evento,
linaje y motivo. La decisión 23 del `decision-log` del crate lo explica con el
número que la motivó.

## 4. Cómo entra el crate en la compilación

`hatboo-brain` por **git** (`branch = "main"`), no por `path`: un path relativo
nunca vale a la vez en el portátil y en el runner, y Cargo no expande variables
ahí. El rev queda clavado en `src-tauri/Cargo.lock`, que **sí** se comparte.

Para iterar sobre el crate sin empujarlo existe el parche local:
`.cargo/config.toml` **en la raíz del repo** (no en `src-tauri/`: Cargo busca
`.cargo/` subiendo desde el directorio en el que se ejecuta, y así lo recoge también
`npm run tauri dev`; está explicado en `.gitignore:10`). El directorio `.cargo/` está
fuera del repo a propósito, y dentro hay dos ficheros **idénticos** —
`config.toml` y `config.toml.parche`—, así que el interruptor no es renombrar uno a
otro nombre: es **que `config.toml` exista o no**. Con él activo,
`cargo check` resuelve el crate contra la copia de al lado y reescribe
`src-tauri/Cargo.lock` dejando `hatboo-brain` **sin línea `source`** (modo `path`); en
ese estado el lock **no se commitea**. Para compartir: borrar o renombrar
`.cargo/config.toml`, correr `cargo check` para que el lock vuelva a escribirse contra
`git+…?branch=main#<rev>`, y commitear ese lock. El `Cargo.lock` sí se comparte; el
parche no.

## 5. Dónde vive cada dato

| Dato | Sitio |
| --- | --- |
| Conversaciones, mensajes, proyectos, sesiones, tareas, llamadas de herramienta, ajustes, plantillas, notas de memoria | SQLite: `%APPDATA%\com.hatboo.app\hatboo.db` (`src-tauri/src/db/schema.sql`) |
| Imágenes adjuntas | `%APPDATA%\com.hatboo.app\attachments\` — en disco, nunca como blob |
| Claves de API | **llavero del sistema operativo**; ni en SQLite ni en un JSON |
| Reglas del proyecto | `HATBOO.md` en la raíz del proyecto; Hatboo guarda su SHA-256 en la fila del proyecto |
| Configuración del cerebro | cuatro ficheros en el crate: `brain-rules.json`, `tools.json`, `models.example.json`, `tuning.example.json`. `Reglas` y `Herramientas` tienen versión y fallback embebido; los otros dos no existen en disco y el crate arranca igual |

`redact.rs` sustituye las formas habituales de secreto por `[REDACTED:…]` antes de
salir hacia un proveedor en la nube y antes de guardar en el historial. Con modelo
local no altera nada. Es un filtro de patrones: reduce el daño de un `read_file`
sobre un `.env`, no sustituye a un gestor de secretos.

## 6. Seguridad, y hasta dónde llega

- **Sandbox de rutas**: toda ruta que recibe una herramienta se canonicaliza y se
  valida contra la raíz del proyecto antes de tocar disco. Fuera → se rechaza sin
  ejecutar. *No* es aislamiento de red ni de procesos.
- **Cuatro niveles de aprobación** por proyecto (*Preguntar siempre*, *Aprobar por
  mí*, *Automático en sandbox*, *Acceso total*), cruzados con el riesgo de cada
  herramienta. **Acceso total no relaja el sandbox.**
- **Trust Gate**: el `HATBOO.md` solo entra al prompt si el SHA-256 del contenido
  que hay en disco coincide con el aprobado. Son contexto sobre el proyecto: no
  amplían el sandbox ni saltan aprobaciones.
- `run_command` está **desactivada por defecto**.

## 7. Las puertas

| Comando | Qué corre | Nota |
| --- | --- | --- |
| `npm run check` | `tsc --noEmit` + `cargo test --lib --test db --test backup --test git_tools --test tools` | **174 verdes** medidas en `ec8b549` (141 del lib + 3 backup + 24 db + 3 git_tools + 3 tools) |
| `npm run i18n` | claves usadas con `t()` que faltan en `src/i18n-en.ts` | la clave es su propio texto en español |
| `npm run version:comprobar` | que `package.json`, `tauri.conf.json`, `Cargo.toml`, el bloque del README y el CHANGELOG digan la misma versión | falla la CI si divergen |
| CI (`windows-latest`) | `npm ci` → `npm run build` → `cargo clippy --all-targets -D warnings` → los cuatro targets de prueba | `--all-targets` **compila** las tres pruebas que no se corren aquí |
| Fuera de CI a propósito | `agent_flow` y `local_provider` (piden un Ollama en marcha) y `keyring` (llavero real) | son de integración local; sin el paso de clippy podrían dejar de compilar y la CI seguir verde — ya pasó |
| El crate | `cargo test --all-features` (374 verdes; 356 con el default `ollama`) + batería `--decisiones` + su CI con clippy | la batería es informativa: siempre sale 0, el número se lee |

## 8. Deuda que este fichero reconoce

- **Hecho el 2026-10-05 (bloque B):** `commands.rs` —3175 líneas y 85 comandos en un
  solo archivo— está repartido en `commands/` por dominio, sin cambiar una firma ni un
  nombre IPC. Lo que eso **no** arregla es lo que sigue abierto en el bloque **C**:
  la capa IPC sigue siendo lógica de negocio, solo que ahora repartida en doce
  archivos. Un comando arma el system prompt cruzando ajustes, skills, memoria,
  proyecto y reglas (`_comunes::chat_system_prompt`, llamada desde tres sitios con la
  recolección escrita a mano en cada uno), dos comandos montan su propio cliente HTTP
  (`models::unload_local_model`, `files::fetch_github`), `system::capture_screen`
  codifica el PNG y escribe disco desde el comando, y hay **70 líneas de la capa IPC
  que tocan el disco directamente** (`grep -rE "std::fs::|fs::(write|read_|remove|
  create_dir|rename|copy|metadata)" commands/`). `ContextService`, `ModelService` y
  `AgentService` son el bloque C.
- El reparto trajo una palabra nueva que hay que conocer para leer el árbol:
  `commands/plantillas.rs` y `commands/memoria.rs` son los dominios de Ajustes, y
  **no** son `crate::cerebro`, que es el puente al crate `hatboo-brain`. Los nombres
  se separaron a propósito porque compartir la palabra era mentir.
- El contexto del producto **ya viaja en su propio sitio** (A.2.4, cerrado el
  2026-10-05): `BrainRequest.contexto_producto` es la capa `producto` del system
  prompt del crate, dentro de `Presupuesto.fijo`, y por tanto no la recorta el Plan.
  Antes cabalgaba en un mensaje `system` de la cabecera de `req.history`, donde era
  lo primero que se caía al apretar la ventana y donde `providers/anthropic.rs` lo
  filtraba sin decir nada. Lo que sigue abierto es el hueco de abajo, no este.
- `machine.rs` y el Governor del crate miden la máquina para decidir cuánto cargar.
  En este portátil (8,45 GB, sin GPU, 17,45 tok/s medidos) el margen se expone como
  `brain_margen_mb` y la regla de que **el benchmark no vale si la máquina estaba
  ocupada mientras se medía** es de aplicación general.

El orden de trabajo está en `ROADMAP.md`; lo que cambió en cada versión, en
`CHANGELOG.md`.
