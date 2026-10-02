# Fase 0 — medición de la línea base

Fase 0 de HATBOO BRAIN (§11 del plan maestro: «Bench, línea base, RAM real por modelo, pesos de Efficiency, umbral 5 %»).

Las citas de secciones son de **`HATBOO-BRAIN-PLAN.md` v1.1** (30-09-2026), que renumeró el documento anterior de §I–§XXV a §0–§14 y cerró los nueve puntos abiertos. Los datos crudos están en `benchmarks/resultados/`.

## 0. Con qué se midió

| | |
|---|---|
| Máquina | 8,45 GB de RAM, 8 núcleos, **sin GPU** (`vram_mb: 0` en todas las corridas), Windows 10 26200 |
| Backend | Ollama **0.35.0** (lo pide §9: misma máquina y misma Ollama) |
| Arnés | `scripts/fase0-bench.mjs` — Node puro, sin dependencias ni crate nuevo |
| Suite | `benchmarks/base.json` — 60 prompts reales, 42 dev / 18 de validación, ES+EN; §8 ya pedía ese nombre de archivo |
| Fijos | `temperature 0`, `seed 42`, `num_ctx 2048`, `keep_alive "300s"` |
| Piloto | 2 prompts por categoría = 12, **1 repetición**, en `gemma3:1b` (el que cabe con ~1,8 GB libres) |
| Guardas | no carga si quedan menos de `--min-libre` (1,2 GB) + 0,4 de margen; corta la corrida si la RAM libre baja de `--min-uso` (0,25 GB) |

Reproducir:

```
npm run fase0 describe
npm run fase0 pilot   --model gemma3:1b
npm run fase0 pilot   --model gemma3:1b --toks 512
npm run fase0 recarga --model gemma3:1b
npm run fase0 rama
npm run fase0 suite   --model gemma3:1b --reps 3
```

## 1. Línea base del proveedor (12 prompts sin tope, modelo residente)

| Métrica | Medido |
|---|---|
| Muro total | 379,5 s |
| TTFT | mediana **474 ms** (min 380 · max 873) |
| Total por corrida | mediana **34 587 ms** · media 31 623 ms |
| Velocidad | **17,45 tok/s** |
| Tokens de salida | 6515 (mediana 604) |
| Tokens de entrada | 232 en total (mediana 19 por corrida) |
| Errores | 0 |
| Residente | 878 MB, ctx 2048, VRAM 0 |

Desglose del tiempo de las 12 corridas: **decodificación 373 s · prefill 6 s · TTFT acumulado 6 s**. El 98,3 % del coste es generar tokens de salida.

Por categoría (mediana del total): saludo 1673 ms · ambigüedad 1934 ms · riesgo 34 587 ms · código 47 527 ms · archivo 48 453 ms · tool 55 561 ms.

Consecuencia directa para los tres presupuestos de §5: **el presupuesto que manda es `max_output_tokens`, no `context_budget_tokens`.** Con 19 tokens de entrada de media, gobernar el contexto no toca el 98 % del coste.

## 2. RAM residente por modelo

| modelo | disco | params | cuant. | ctx máx. declarado | residente 2048 | residente 8192 | caída real del SO (8192) | carga |
|---|---|---|---|---|---|---|---|---|
| gemma3:1b | 815 MB | 1,00 B | Q4_K_M | 32 768 | **878 MB** | no cupo | — | 7324 ms frío / 2393 ms tibio |
| qwen2.5-coder:1.5b | 986 MB | 1,54 B | Q4_K_M | 32 768 | **1109 MB** | no cupo | — | 6144 ms |
| qwen3.5:0.8b | 1036 MB | 0,87 B | Q8_0 | 262 144 | **1063 MB** | **1197 MB** | 1,27 GB | 5955 ms |
| deepseek-r1:1.5b | 1117 MB | 1,78 B | Q4_K_M | 131 072 | **1240 MB** | **1499 MB** | 1,34 GB | 6627 ms |
| llama3.2:1b | 1321 MB | 1,24 B | Q8_0 | 131 072 | **1450 MB** | no cupo | — | 6131 ms |
| qwen2.5:1.5b | 986 MB | 1,54 B | Q4_K_M | 32 768 | no llegó (0,32 GB libres) | no cupo | — | — |
| qwen3:1.7b | 1359 MB | 2,03 B | Q4_K_M | 40 960 | **1645 MB** | **2419 MB** | 1,92 GB | 7145 ms |

La fila de `gemma3:1b` viene de los pilotos (§4), no del barrido: cuando corría `rama` ya quedaban 0,79 GB libres y el guard lo rechazó; sus 878 MB son los que midió `/api/ps` con el piloto residente. `qwen2.5:1.5b` no llegó a medirse (0,32 GB libres al pasar por él).

Cuatro cosas medidas aquí:

1. **El tamaño en disco no predice la RAM.** `llama3.2:1b` con 1,24 B de parámetros ocupa 1321 MB (Q8_0) y `qwen2.5:1.5b` con 1,54 B ocupa 986 MB (Q4_K_M). La `ram_estimate_mb` del registry tiene que ser medida, no derivada del nombre ni de los parámetros.
2. **Ningún Modelfile fija `num_ctx`** (`ctx_en_modelfile: "no"` en los 7). El contexto que hoy usa Hatboo es el default de Ollama, no una decisión de Hatboo.
3. **El KV es caro y desigual**: de 2048 a 8192, qwen3:1.7b pasa de 1645 a 2419 MB (+774) mientras qwen3.5:0.8b solo suma 134 MB. La escalera de §1 («N2 → 4096 si aguanta, N3 → 8192 si cabe») necesita un dato por modelo, no un umbral global.
4. **El Governor debe mirar la RAM libre del sistema, no el `size` que declara Ollama, y no hay conversión fija entre los dos.** qwen3:1.7b a 8192 declaró **2419 MB** residentes pero al sistema le bajaron **1,92 GB** (los pesos salen del page cache y son recuperables); qwen3.5:0.8b a 8192 declaró **1197 MB** y al sistema le bajaron **1,27 GB**. La primera sobreestima y la segunda subestima: ningún coeficiente vale, hay que leer el sistema. Fiarse del `size` daría falsos «no cabe» justo en los modelos grandes.

El margen de 1,5 GB que fija §5 es correcto y en esta máquina se incumple a diario: al empezar el barrido quedaban **0,79 GB libres** y el guard rechazó las cuatro primeras cargas. «`preferred_model` se respeta si el Governor dice que cabe; si no, siguiente viable + `reason`» (§1) no es la excepción: es la ruta frecuente de este equipo.

## 3. Recarga al cambiar `num_ctx`

Mismo prompt (20 tokens de entrada), mismo modelo, misma semilla:

| paso | carga | TTFT | prefill |
|---|---|---|---|
| 2048 (residente) | 5 ms | 415 ms | 350 ms |
| 2048 repetido | 11 ms | 234 ms | 198 ms |
| **2048 → 4096** | **3746 ms** | 4126 ms | 371 ms |
| 4096 repetido | 18 ms | 250 ms | 208 ms |
| **4096 → 8192** | **3771 ms** | 4201 ms | 421 ms |
| 8192 repetido | 11 ms | 151 ms | 125 ms |
| **8192 → 2048** | **3723 ms** | 4183 ms | 449 ms |

Ollama **recarga en cada cambio de `num_ctx`**, cuesta 3,7 s, y no es cómputo (el prefill no se mueve): es rehacer el grafo y el KV. Bajar de 8192 a 2048 también recarga.

§1 cerró «no cambiar ctx entre turnos de la misma sesión si eso recarga el modelo» y lo dejaba por medir para la Fase 2: **recarga, y son 3,7 s**. Lo que eso le cuesta a la escalera de niveles: pasar de N1 a N2 dentro de una sesión, manteniendo el modelo, son 3,7 s extra por el puro cambio de contexto. Escalar de *tier* cambia de modelo y la recarga se paga igual, así que ahí no es coste adicional. Conclusión práctica: el `num_ctx` se elige **una vez por sesión y modelo**, y subir de nivel no lo toca a menos que toque también el modelo.

## 4. Efecto de topar la salida (`max_output_tokens`)

Mismos 12 prompts, misma semilla, único cambio `num_predict: 512`:

| prompt | sin tope | con tope 512 | tokens | delta tiempo |
|---|---|---|---|---|
| saludo-01 | 1174 ms / 12 tok | 1086 ms / 12 tok | 0 | −7 % |
| saludo-06 | 2173 / 26 | 1939 / 26 | 0 | −11 % |
| codigo-01 | 22 382 / 374 | 22 040 / 374 | 0 | −2 % |
| codigo-06 | 72 672 / 1227 | 28 600 / 512 | −715 | −61 % |
| archivo-01 | 54 219 / 927 | 31 149 / 512 | −415 | −43 % |
| archivo-06 | 42 688 / 741 | 30 539 / 512 | −229 | −28 % |
| riesgo-01 | 31 872 / 550 | 38 244 / 512 | −38 | **+20 %** |
| riesgo-06 | 37 301 / 658 | 38 399 / 512 | −146 | +3 % |
| tool-01 | 43 946 / 802 | 42 386 / 512 | −290 | −4 % |
| tool-06 | 67 177 / 1140 | 45 258 / 512 | −628 | −33 % |
| ambiguedad-01 | 1803 / 26 | 2414 / 26 | 0 | +34 % |
| ambiguedad-06 | 2066 / 32 | 2680 / 32 | 0 | +30 % |
| **suma** | **379,5 s / 6515 tok** | **284,7 s / 4054 tok** | **−38 %** | **−25 %** |

El recorte de tokens es exacto y reproducible: **−38 %**. El tiempo solo baja 25 % porque en esa pasada el rendimiento cayó de 17,45 a 15,1 tok/s y tocó fondo en `tool-06` (11,5 tok/s) con la RAM libre en **0,46 GB**. Que `riesgo-01` vaya *más lento* generando 38 tokens menos es contención de la máquina, no efecto del tope: el −25 % es un **suelo medido bajo contención** y el efecto limpio andará más cerca del −38 %.

Verificado en el repo: **hoy Hatboo no manda ningún tope de salida a Ollama.** `providers/anthropic.rs:89` sí pone `max_tokens` (la API lo exige), pero `providers/local.rs` va por la puerta OpenAI-compatible y `providers/openai.rs` no escribe `max_tokens` ni `num_predict` nunca. Ese 38 % es ganancia medible sin crate nuevo, y `max_output_tokens` (§4) ya tiene campo donde vivir.

## 5. Ruido medido y el umbral del 5 % (§1 Regresión, §9, §14.7)

Las 5 corridas que no tocaron el tope son **la misma petición, la misma semilla, en dos pasadas distintas**. Su desviación es ruido puro de la máquina:

| | total | TTFT | tokens |
|---|---|---|---|
| saludo-01 | −7 % | −26 % | 12 = 12 |
| saludo-06 | −11 % | −4 % | 26 = 26 |
| codigo-01 | −2 % | −15 % | 374 = 374 |
| ambiguedad-01 | +34 % | +44 % | 26 = 26 |
| ambiguedad-06 | +30 % | +27 % | 32 = 32 |
| **suma de las 5** | **29 598 ms vs 30 159 ms = +1,9 %** | | |

- **Tokens: ruido cero.** Con `temperature 0` y `seed 42`, 5 de 5 reprodujeron exactamente el mismo recuento. El bench es reproducible en lo que manda el coste; lo ruidoso es el tiempo.
- **Corrida individual: nada por debajo del ±35 %** (peor desvío observado +34 %, y ±44 % en TTFT). Un «va más rápido» de una sola corrida N0/N1 no es un resultado.
- **Agregado de suite: el 5 % de §1 se sostiene** — el ruido agregado medido con n=5 fue 1,9 %, y con las 180 corridas de la suite será menor.
- **Cómo se aplica el umbral:** sobre la mediana de ≥3 repes (§9) y, en N0/N1, con un conjunto de ≥20 corridas, porque con 1–2 s por corrida el ruido individual se come la señal. Comparar una corrida suelta contra otra es ruido, no medición.

## 6. Los pesos de Brain Efficiency (§11 Fase 0)

El plan maestro usa la métrica pero **no define `s` ni los `w_*`**, y §11 se los asigna a la Fase 0. Aquí quedan fijados:

`costo = w_r·(ram_gb × s) + w_c·(tokens/1000) + w_t·reintentos`

- **`s` = segundos de reloj** (wall-clock) entre `RequestReceived` y `Completed`/`Failed`, con `Instant`. **Incluye la carga del modelo**: si el usuario esperó 7,3 s porque hay que traerlo de disco, eso es coste, y §2 dice «RAM real > estimación».
- **Todo se normaliza contra la línea base del mismo modelo**, así «coste 1,00» significa «lo que cuesta hoy, sin Brain, en este modelo», comparable entre niveles y entre máquinas. Para `gemma3:1b`: `s_ref` = 31,6 s, `ram` = 0,878 GB → `ram·s` = 27,7 GB-s.
- **`w_r = 1 / 27,7 = 0,0361`**, y su equivalente por modelo con los números de §2.
- **`w_c = 0` en modelos locales.** Medido: la correlación entre tokens de salida y `decode_ms` es **r = 0,999**. En local los tokens *son* el tiempo; sumar las dos cosas es contar lo mismo dos veces. `w_c` solo tiene sentido en API, donde el token es dinero y el tiempo no.
- **`w_t = 0` hasta la Fase 5.** El coste de un reintento ya está dentro de `s` y de los tokens de esa corrida extra; lo único que no captura es lo que cuesta correr el verificador, y eso no es medible hasta que exista. Queda como obligación de Fase 5, no como olvido.
- Ejemplo con lo medido: la corrida media topeada costó 0,878 × 23,7 × 0,0361 = **0,75 de la línea base** (con la coletilla de §4: bajo contención).

## 7. Lo que esto NO mide — y el hueco real de §9

§9 dice «línea base = **Hatboo desktop sin Brain**, misma máquina y misma Ollama». Esto no es eso: es el proveedor pelado. El hueco hay que cerrarlo antes de dar la Fase 0 por hecha.

- Habla con `/api/generate`, y la app habla con Ollama por la puerta OpenAI-compatible (`providers/local.rs` → `OpenAiProvider::with_base_url`). El decodificador y la RAM son los mismos; la cabecera y el template no.
- **Sin system prompt de Hatboo.** Las capas estables de §5 (identidad, contrato, `HATBOO.md`, modo, tools) y el `memoria_prompt()` que se inyecta en cada system prompt añaden prefill. Con 19 tokens de entrada medidos, esta línea base es un suelo, no el coste de la app.
- Sin tools, sin historial de sesión, sin verificación, sin recuperación, sin base de datos ni UI.
- Un solo modelo y una sola repetición.

Tres rutas para cerrarlo, con su coste. **El 02-10 eligió la 1** y abajo está lo que salió; la 2 sigue abierta y la 3 sigue sin puente:

1. **Emular la ruta de la app** desde el mismo arnés: `/v1/chat/completions` + el system prompt real de Hatboo copiado a un archivo, con su fecha y el aviso de que es una copia que puede derivar. Barato (~15 min), sigue sin ser la app.
2. **Leer la traza de la propia app**: §7 pide latencia, TTFT, tok/s y RAM por corrida, y hoy Hatboo persiste `provider`, `thinking_ms` y `created_at` por mensaje, pero **no la duración total de la generación**. Añadir una columna `duration_ms` al mensaje (el hueco entre su mensaje y el de Hatboo solo es aproximado) convertiría su uso real en línea base sin simular nada. Es tocar el backend.
3. **Conducir la app desde fuera** para correr los 180 prompts por su camino real: no hay puente — su ventana no es un destino CDP medible.

### 7.1 La ruta 1, corrida (02-10)

`npm run fase0 -- suite --model gemma3:1b --reps 3 --ruta app` → **180 corridas en 60,4 min**, 176 válidas y 4 timeouts de 600 s (`archivo-08` rep 1 y `riesgo-10` las tres repes: la respuesta colgó del todo). Crudo en `resultados/suite-app-gemma3_1b-sintope-2026-10-02.json`.

El system prompt no se transcribió: lo vuelca el propio código con `HATBOO_VOLCAR_PROMPT=1 cargo test --lib volcar_system_prompt` (`commands.rs::volcar_system_prompt_para_el_arnes`), y `benchmarks/system-prompt-app.md` lleva su fecha y el aviso de que es copia. Saludo y ambigüedad van por el prompt de chat; código, archivo, riesgo y tool por el del agente, con la misma regla que `modo_de` en el arnés del crate.

| | proveedor pelado (§1) | **puerta de la app (§7.1)** |
|---|---|---|
| tokens de entrada | 19 | **1019** de chat · **1345** de agente |
| TTFT mediana | 474 ms | **154 ms** |
| total mediano | — (mediana 31,6 s/corrida) | **1164 ms** (p25 637 · p75 4009 · p95 38254 · máx 114907) |
| tokens de salida (mediana) | 604 | **18** (p95 498 · máx 1190) |
| tok/s | 17,45 | **16,8** |
| residente | 878 MB a ctx 2048 | **1009 MB a ctx 32768** |

Por categoría (mediana de `total_ms` / tokens de salida): saludo 583 / 6 · ambigüedad 672 / 6 · tool 1227 / 18 · riesgo 1454 / 22 · archivo 2891 / 48 · **código 12880 / 128**.

Lo que se puede afirmar y lo que no:

- **La diferencia de salida no es comparable limpia.** §1 fueron 12 prompts × 1 rep; esto, 60 × 3. Aun así el salto de 604 a 18 tokens de mediana es de otra escala, y el mecanismo está a la vista: el prompt de Hatboo pide «Breve por defecto» y «sin preámbulos», y el modelo obedece. Como el 98 % del coste lo mandan los tokens de salida, **la línea base de la app es más barata que el proveedor pelado, no más cara** — 60,4 min por 180 corridas frente a los 94,9 min que proyectaba la suite por la puerta cruda.
- **El coste real de la capa de identidad es el prefill**: +998 tokens de entrada por turno (1019 frente a 19). Prefill es lo barato en esta máquina (§1: 6 s de 379), así que se paga en TTFT y no en decode.
- **`num_ctx` no lo puede fijar la app por esta puerta.** Probado: `options:{num_ctx:2048}` se ignora y el modelo se queda en 32768 (gemma3) / 40960 (qwen3:1.7b, **6437 MB**). El contexto lo decide Ollama.
- **`temperature` y `seed` sí se honran** (dos llamadas idénticas, 285 tokens las dos en la sonda). La app no los manda; el protocolo de §0 los exige y la emulación los manda: la app real es más ruidosa que lo medido aquí.
- El stream de `/v1` no trae `usage` sin `stream_options:{include_usage:true}`, y no declara `load/prompt_eval/eval_duration`: prefill, decode y carga quedan `null` y el tok/s se deriva de `usage` contra el reloj del arnés.
- **gemma3:1b no razona por esta puerta** (0 caracteres de `reasoning` de mediana). qwen3:1.7b sí: en la sonda soltó razonamiento y 285 tokens para un «di solo: listo». Ese es el coste de elegir un modelo que piensa por defecto, y lo mide la corrida de ese modelo, no esta.
- RAM: libre mínima **0,50 GB** durante la corrida, sin esperas (3 ms acumulados en 180 comprobaciones) y sin corte. El modelo ya estaba residente; el guard de carga (1,6 GB libres) solo se exige al cargar.
- Sigue sin ser la app: sin tools del modo trabajo (el prompt las describe, pero nadie las ejecuta), sin historial de sesión, sin verificación, sin UI. La ruta 2 (`duration_ms` por mensaje) es la única que cerraría eso.


## 8. Coste de correr la suite entera

Proyección con la **media medida** (31,6 s/corrida), no con cuentas a ojo — la estimación del papel de decisiones (85 min para los 7 modelos) se quedó corta por **8 veces**, porque suponía ~4 s por respuesta y estos modelos sacan 600–1200 tokens a 17 tok/s.

| corrida | coste |
|---|---|
| 60 × 3 de **un** modelo, sin tope | **94,9 min** |
| 60 × 3 de un modelo, tope 512 | 71,2 min (medido bajo contención) |
| 60 × 3 de los 7 locales | **≈ 11,1 h** |
| 60 × 3 de 3 modelos | ≈ 4,7 h |

Añadidos obligatorios, por §2 y §3: cada modelo necesita su propia carga (~7 s; 2,4 s con el page cache tibio), y a `num_ctx` 8192 **solo 3 de los 7 locales llegaron a caber** (qwen3.5:0.8b, deepseek-r1:1.5b y qwen3:1.7b; el guard rechazó gemma3:1b, qwen2.5:1.5b, qwen2.5-coder:1.5b y llama3.2:1b por RAM). La suite a 8192 no son 7 modelos × 95 min: son menos modelos corriendo, más recargas, y los rechazos hay que registrarlos como dato del Governor, no como fallo del arnés.

Y una condición del protocolo: **con la máquina en calma**. El ruido de §5 es contención; si se corre con el navegador y `tauri dev` abiertos, la mediana no vale.

## 9. Cómo le sienta a las decisiones que cerró el plan nuevo

| §1 del plan | qué dice la medición |
|---|---|
| `num_ctx` solo 2048/4096/8192, sin cambiarlo entre turnos si recarga | Recarga siempre: **3,7 s por cambio**. La decisión se sostiene; sale gratis si al subir de nivel también cambia el modelo, y cuesta 3,7 s si solo sube el contexto. |
| N2 → 4096 «si el modelo aguanta», N3 → 8192 «si cabe» | Hay que decidirlo **por modelo**: el KV de 2048→8192 suma 134 MB en qwen3.5:0.8b y 774 MB en qwen3:1.7b. Ningún umbral global vale. |
| Governor con margen de 1,5 GB | Correcto y restrictivo en esta máquina: con 0,79 GB libres el guard rechazó 4 de las 7 cargas intentadas. |
| `preferred_model` o siguiente viable con `reason` | En este equipo es la ruta **frecuente**, no la excepcional. |
| Regresión: coste no sube > 5 % y errores bajan | El 5 % queda justificado (ruido agregado medido: 1,9 %). **Pero** solo es evaluable sobre medianas de ≥3 repes; a nivel de corrida el ruido es ±35 %. |
| `level` vs `thinking`, default `off` en N0/N1 | 3 de los 7 locales declaran `thinking` (qwen3, deepseek-r1, qwen3.5); en los otros 4 el campo no existe. Y ojo: la verborrea medida no viene del pensamiento — gemma3:1b, que no declara `thinking`, sacó 1227 tokens para preguntar por ordenar un array. |
| Confianza ≥0,85 / 0,55–0,85 / <0,55, «Fase 0 los ajusta» | **No se pueden ajustar con lo de aquí.** No hay decisiones etiquetadas que contrastar hasta la Fase 3. Quedan como están y se calibran con el log. |
| Meta de §9: latencia N0/N1 ≤ 50 % | La línea base de N0/N1 es 1,1–2,2 s. Recortar la mitad es medio segundo, dentro del ruido de una corrida: la meta solo se verifica agregada, y la ganancia gorda de N0 no es la latencia sino no retener 878 MB ni pagar la recarga. |

## 10. Estado del criterio de salida de §11

| pide la Fase 0 | estado |
|---|---|
| Bench | **arnés y suite hechos** (`scripts/fase0-bench.mjs` + `benchmarks/base.json`, 60 prompts 42/18), ahora con **dos puertas**: `--ruta proveedor` y `--ruta app` |
| Línea base | **hecha por las dos rutas**: proveedor (§1, 12 prompts) y app (§7.1, 60 × 3 = 180 corridas en 60,4 min, 4 timeouts). La ruta 2 de §7 (`duration_ms` por mensaje) sigue abierta: es la única que mide SU uso real |
| Suite corrida | **1 de los 7 modelos** (gemma3:1b, el que cupo por la puerta de la app). Faltan los otros 6; la proyección por modelo se puede hacer ya con la media medida: 60,4 min |
| RAM real por modelo | **hecha** (§2), con 4 combinaciones que no cupieron registradas como tales |
| Pesos de Efficiency | **fijados** (§6); `w_c` en API y `w_t` dependen de la Fase 5 y del bench de API |
| Umbral 5 % | **confirmado y acotado** (§5): 5 % al agregado, ±35 % por corrida |

Tres cosas que añade la corrida por la puerta de la app, y ninguna es decorativa:

- **`num_ctx` no lo puede fijar la app con Ollama por `/v1`.** Probado: `options:{num_ctx}` se ignora; gemma3 carga a 32768 y qwen3:1.7b a 40960 (**6437 MB**, que en 8,45 GB no es un piloto, es un atasco). La escalera de §1 (2048/4096/8192 por nivel) **hoy no es aplicable desde Hatboo**: para mandarle un contexto al modelo local hay que volver a `/api/generate` o escribir un `Modelfile`. Es trabajo de la tanda del adaptador, no del Brain.
- **La capa de identidad cuesta prefill y ahorra salida.** +998 tokens de entrada por turno (1019 frente a 19) y **18 tokens de salida de mediana frente a 604** del piloto del proveedor. Por categoría, app frente a §1: saludo 0,58 s / 1,7 s · ambigüedad 0,67 / 1,9 · tool 1,23 / 55,6 · riesgo 1,45 / 34,6 · archivo 2,89 / 48,5 · código 12,9 / 47,5. Como el 98 % del coste lo mandan los tokens de salida, **la línea base real de la app es más barata que el proveedor pelado**, no más cara. Cuidado con leerlo como mérito: §1 fueron 12 prompts × 1 rep y esto 60 × 3; la forma no es idéntica, y el mecanismo es que el prompt de Hatboo pide brevedad y el modelo obedece.
- **La meta de §9 «latencia N0/N1 ≤ 50 %» no se puede cumplir llamando al modelo.** La línea base de N0/N1 por la puerta de la app es 583 ms (saludo) y 672 ms (ambigüedad) de mediana, y la mitad son 292 y 336 ms. Con TTFT medido en 168 ms y 6 tokens de salida a ~14 tok/s, el suelo de un turno que contesta el modelo está en el orden de esos 583 ms: recortarlo a la mitad significa **no llamarlo**, que es la opción (b) del saludo (letra fija en el crate) y sigue sin elegir. Lo que sí puede bajar el Brain es el resto: no retener 1009 MB y no pagar los 3,7 s de recarga.

