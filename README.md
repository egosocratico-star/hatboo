# Hatboo

[![CI](https://github.com/egosocratico-star/hatboo/actions/workflows/ci.yml/badge.svg)](https://github.com/egosocratico-star/hatboo/actions/workflows/ci.yml)

Chat de IA de escritorio con un modo agente que trabaja dentro de tus proyectos.
Local-first: todo el histórico vive en tu máquina y las claves se guardan en el
llavero del sistema operativo.

Escrito con **Tauri 2** (Rust) + **React 18** + **TypeScript** + **Tailwind** +
**Zustand** + **SQLite** (`rusqlite`).

> Estado: app personal en desarrollo, versión **0.3.0** para Windows. Funciona,
> no hay autoactualización. Los binarios se publican como release de GitHub al
> empujar una etiqueta `v*` — el flujo ya está probado y funcionando, ver
> [`v0.3.0`](https://github.com/egosocratico-star/hatboo/releases/tag/v0.3.0).

---

## Chat normal

- **Proveedores**: Anthropic (Claude), OpenAI y local (Ollama o cualquier
  servidor compatible con `/v1/chat/completions`). Un proveedor activo a la vez,
  con selector de modelo y prueba de conexión.
- **Streaming de verdad**: el botón de detener corta la generación en el servidor
  (no solo en la interfaz) y lo ya generado se guarda como respuesta parcial.
- **Razonamiento extendido** (`off` / `low` / `medium` / `high`) por proveedor:
  Anthropic usa `thinking`, OpenAI y Ollama `reasoning_effort`. El tiempo que el
  modelo pasó pensando queda guardado y se puede desplegar bajo la respuesta.
- **Búsqueda web sin API key**: con el chip 🌐 activo, antes de responder se
  consulta DuckDuckGo (scrapeo directo, sin cuenta ni clave) y las fuentes citadas
  se guardan con el mensaje.
- **Modo código** (`<>`): cambia el prompt de sistema a uno orientado a programar.
- **Editar un mensaje enviado** trunca todo lo posterior y vuelve a responder, como
  en ChatGPT. También copiar, regenerar y valorar con 👍 / 👎.
- **Ramificar**: el icono de rama en una respuesta crea una conversación nueva con
  todo el hilo hasta ese punto y deja la original intacta, para probar otro camino
  sin perder este. Las imágenes adjuntas se copian a archivos nuevos, así que borrar
  una de las dos no deja ciega a la otra.
- **Imágenes y archivos**: adjunta texto (se antepone al contenido para el modelo,
  la burbuja queda limpia) o imágenes cuando el modelo tiene visión. Las imágenes
  viven en disco, no dentro de la base de datos.
- **Desde GitHub**: pega la URL de un archivo (`…/blob/main/ruta`) o la raíz de un
  repo y entra como contexto de lectura, sin clonar nada. Solo se aceptan
  `github.com`, `raw.githubusercontent.com` y `gist.githubusercontent.com`, y no se
  siguen redirecciones — sin eso sería un `fetch` arbitrario desde tu máquina.
- **Tomar captura**: fotografía la pantalla entera y la adjunta, para enseñar un
  error sin guardarlo antes. Pide un modelo con visión; sin él sale apagado.
- **Buscar dentro de la conversación** con `Ctrl+F`.
- **Indicador de contexto**: en la barra del compositor se ve cuánto ocuparía el
  prompt del próximo turno (`Contexto ≈ 7,2 mil`). Lo calcula el backend con el
  mismo historial que se envía, así que los archivos adjuntos cuentan; los tokens
  son una estimación (~4 caracteres por token), no el contador del proveedor, y
  las imágenes van aparte porque en base64 dominan el costo real. Se oculta en
  conversaciones cortas.
- **Plantillas (skills)**: fragmentos de instrucciones escritos por ti. Si una está
  activada, viaja en el *system prompt* de cada respuesta; si no, puedes insertarla
  en un mensaje concreto desde el menú `+`.
- **Exportar** la conversación a Markdown o JSON (incluye razonamiento y fuentes).
- **Barra lateral**: clic derecho para fijar arriba, archivar o borrar. Lo fijado
  manda sobre la recencia y lo archivado se esconde sin borrarse; las horas se
  enseñan relativas («ahora», «hace 12 min», «ayer») y la fecha exacta queda en el
  aviso al pasar por encima. Se puede reducir a un riel de iconos con `Ctrl+B`.

## Modo trabajo (agente)

Abre una carpeta como proyecto y el agente planifica, ejecuta y reporta.

- **Herramientas**: `read_file`, `list_dir`, `search_files`, `write_file`,
  `git_status`, `git_diff`, `git_log`, `git_commit`, y dos opcionales:
  `run_command` (desactivada por defecto) y `web_search` (detrás del mismo chip 🌐
  del chat).
- **Sandbox de rutas**: toda ruta que recibe una herramienta se canonicaliza y se
  valida contra la raíz del proyecto antes de tocar disco. Si cae fuera, se rechaza
  sin ejecutar nada.
- **Cuatro niveles de aprobación**, por proyecto: *Preguntar siempre*, *Aprobar por
  mí* (default), *Automático en sandbox* y *Acceso total*. El nivel se cruza con el
  riesgo de cada herramienta; **Acceso total no relaja el sandbox**.
- `write_file` siempre muestra el diff antes de aplicarse, y el agente nunca
  propone un commit si no se lo pides.
- **Reglas por proyecto**: un `HATBOO.md` en la raíz del proyecto se añade al prompt
  del agente en cada sesión de trabajo de esa carpeta. Se edita desde la cabecera
  de la vista (*Reglas*). Son contexto sobre el proyecto: no amplían el sandbox ni
  saltan aprobaciones.
- Sesiones anidadas por proyecto, árbol de archivos con buscador, lista de tareas en
  vivo y pestañas para varios proyectos a la vez. Los proyectos también se fijan con
  clic derecho, y abrir dos veces la misma carpeta no crea un segundo proyecto.

## Privacidad y dónde están los datos

| Dato | Dónde vive |
| --- | --- |
| Conversaciones, mensajes, proyectos, tareas, llamadas a herramientas, ajustes, plantillas | SQLite en `%APPDATA%\com.hatboo.app\hatboo.db` |
| Imágenes adjuntas | `%APPDATA%\com.hatboo.app\attachments\` |
| Claves de API | **Llavero del sistema operativo** (nunca en SQLite ni en un JSON) |

Nada sale de tu máquina salvo lo que recibe el proveedor que hayas elegido. La
búsqueda web consulta DuckDuckGo directamente, sin intermediarios ni cuenta.

Cuando el agente lee archivos del proyecto, las formas habituales de secreto
(API keys, tokens de GitHub/Slack/Stripe/AWS, JWT, contraseñas en `clave = valor`,
bloques de clave privada) se sustituyen por `[REDACTED:…]` antes de salir hacia un
proveedor en la nube y antes de guardarse en el historial. Con un modelo local no
se altera nada. Es un filtro de patrones —reduce el daño de un `read_file` sobre un
`.env`, no sustituye a un gestor de secretos— y se desactiva en **Ajustes → General**.

En **Ajustes → Datos** puedes exportar todo a un único JSON, importar una copia
(idempotente: importar dos veces no duplica nada) y restablecer de fábrica, que
borra la base de datos, los adjuntos y las claves del llavero — pidiéndote escribir
`BORRAR TODO` antes.

## Apariencia

Tema **oscuro**, **claro** o **Sistema** (sigue el de Windows mientras la app está
abierta), y tamaño del texto del chat. Los colores están tokenizados en variables
CSS, así que cambiar de tema no toca ningún componente.

**Movimiento**: con **Reducido** se quitan animaciones y transiciones solo dentro
de Hatboo, sin tocar el ajuste del sistema operativo. Con **Sistema** manda
`prefers-reduced-motion`.

**Fondo translúcido** (solo Windows 11, apagado por defecto): pide a Windows que
componga Mica detrás de la ventana en vez de pintar un fondo opaco. Está detrás
de un interruptor a propósito —el propio crate avisa de que va fino al arrastrar
o redimensionar la ventana—, así que pruébalo antes de dejarlo fijo.

## Atajos

| Tecla | Acción |
| --- | --- |
| `Enter` / `Shift+Enter` | Enviar / salto de línea |
| `Ctrl+N` | Nueva conversación |
| `Ctrl+,` | Ajustes |
| `Ctrl+F` | Buscar en la conversación |
| `Ctrl+K` | Buscar en todos los chats y sesiones |
| `Ctrl+B` | Plegar la barra lateral |
| `Ctrl+.` | Modo foco en el modo trabajo (solo el chat) |
| `Esc` | Volver al chat / cerrar menú |

## Compilar y ejecutar

Requisitos: **Rust** (estable), **Node 18+**, y en Windows el runtime **WebView2**
(viene con Windows 11). Para el proveedor local hace falta **Ollama** u otro
servidor compatible.

```bash
npm install
npm run tauri dev      # desarrollo, con recarga en caliente
npm run tauri build    # instaladores en src-tauri/target/release/bundle/
```

Pruebas:

```bash
npm run check          # tipos + los tests que no dependen de servicios
npx tsc --noEmit       # solo tipos
cd src-tauri && cargo test
```

`cargo test` entero incluye tres pruebas de integración que **necesitan algo de
la máquina**: `agent_flow` y `local_provider` hablan con un Ollama en marcha, y
`keyring` usa el llavero real. Por eso el CI (`npm ci` + `npm run build` + los
tests sin dependencias externas) corre solo ese subconjunto, marcado en
`.github/workflows/ci.yml`.

Al empujar una etiqueta `v*` se activa `.github/workflows/release.yml`, que
compila el instalador de Windows y lo adjunta a una release. **Ya probado**: la
`v0.3.0` se construyó y publicó sola en 8m32s. La versión hay que subirla a la
vez en `package.json`, `src-tauri/Cargo.toml` y `src-tauri/tauri.conf.json`.

## Estructura

```
src/                 React: componentes, store (Zustand), hooks de eventos
src-tauri/src/
  commands.rs        comandos Tauri y streaming del chat
  db/                esquema y acceso a SQLite
  providers/         Anthropic, OpenAI, local + lectura de SSE
  agent/             loop del agente y herramientas
  backup.rs          copia de seguridad completa en un JSON
  web.rs             búsqueda DuckDuckGo sin clave
  state.rs           ajustes y construcción de proveedores
```

## Límites conocidos

- El razonamiento extendido no se aplica en el modo agente: Anthropic exige
  reenviar los bloques `thinking` en el historial cuando hay herramientas, y eso
  todavía no está hecho.
- Los avisos de Windows salen **atribuidos a PowerShell mientras se ejecuta con
  `tauri dev`**: el complemento de notificaciones solo declara el identificador
  de aplicación cuando el ejecutable no vive en `target/`. Instalado desde el MSI
  o el NSIS ya aparece como Hatboo. En **Ajustes → General** hay un *Probar aviso*
  que lanza uno sin mirar si la ventana está delante.
- Sin cuentas, sin sincronización entre dispositivos y sin autoactualización.
- Los instaladores publicados en `bundle/` no se regeneran en cada cambio; la
  versión actual es la del manifiesto (`tauri.conf.json`).
- Probado a fondo en Windows; macOS y Linux no tienen pases de CI.

## Licencia

MIT — ver [LICENSE](LICENSE).
