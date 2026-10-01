// Fase 0 de HATBOO BRAIN (§XVIII y §XV de Downloads/HATBOO-BRAIN.md): medir la
// línea base antes de escribir el crate. Node puro, sin dependencias: habla con
// el HTTP de Ollama y no toca la app.
//
//   node scripts/fase0-bench.mjs describe
//   node scripts/fase0-bench.mjs pilot   --model gemma3:1b
//   node scripts/fase0-bench.mjs suite   --model gemma3:1b --reps 3
//   node scripts/fase0-bench.mjs recarga --model gemma3:1b
//
// temperature 0 y seed 42 fijos, como pide el protocolo; lo que se guarda en
// resultados/ es crudo (cada corrida) para poder recalcular la mediana sin
// volver a la máquina.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

const OLLAMA = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SALIDA = path.join(RAIZ, "benchmarks", "resultados");

const args = process.argv.slice(2);
const modo = args[0];
const bander = (nombre, porDefecto) => {
  const i = args.indexOf(`--${nombre}`);
  if (i < 0) return porDefecto;
  const v = args[i + 1];
  return v === undefined || v.startsWith("--") ? true : v;
};

const CFG = {
  modelo: bander("model", null),
  reps: Number(bander("reps", 1)),
  ctx: Number(bander("ctx", 2048)),
  porCat: Number(bander("por-cat", 2)),
  limite: Number(bander("limite", 0)),
  minLibre: Number(bander("min-libre", 1.2)),
  // El umbral de 1,2 GB es para DECIDIR CARGAR (es lo que mide el Governor).
  // Con el modelo ya residente esa RAM la ocupa él: exigir 1,2 libres otra vez
  // bloquearía cada prompt. Aquí se espera solo si queda menos de un cuarto.
  minUso: Number(bander("min-uso", 0.25)),
  // num_predict: el `max_output_tokens` del Plan (§VIII). El piloto midió que el
  // coste lo manda la longitud de la respuesta, no la latencia.
  toks: Number(bander("toks", 0)),
  temperatura: 0,
  seed: 42,
};

const libreGB = () => os.freemem() / 1e9;
const mediana = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r1 = (x) => (x === null ? null : Math.round(x * 10) / 10);
const r2 = (x) => (x === null ? null : Math.round(x * 100) / 100);
const hoy = () => new Date().toISOString().slice(0, 10);

async function json(url, cuerpo) {
  const res = await fetch(url, {
    method: cuerpo ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    signal: AbortSignal.timeout(cuerpo ? 600_000 : 15_000),
  });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

/** El Governor del doc no deja cargar con menos de 1,5 GB de margen. Aquí ese
 *  umbral protege el equipo de él mientras mide. */
async function esperarLibre(minGB, maxMs = 90_000) {
  const t0 = Date.now();
  for (;;) {
    const l = libreGB();
    if (l >= minGB) return { libre: l, espero_ms: Date.now() - t0 };
    if (Date.now() - t0 > maxMs) return { libre: l, espero_ms: Date.now() - t0 };
    await new Promise((r) => setTimeout(r, 2000));
  }
}

/** Una generación con streaming: TTFT medido, y el resto del coste lo declara
 *  Ollama en su última línea (nanosegundos). */
async function corrida(modelo, texto, cfg) {
  const t0 = performance.now();
  const res = await fetch(`${OLLAMA}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: modelo,
      prompt: texto,
      stream: true,
      keep_alive: cfg.keepAlive || "300s",
      options: {
        temperature: cfg.temperatura,
        seed: cfg.seed,
        num_ctx: cfg.ctx,
        // Campo del Plan (§VIII `max_output_tokens`): 0 = sin tope, que es lo que
        // hace hoy Hatboo sin Brain, o sea la línea base.
        ...(cfg.toks > 0 ? { num_predict: cfg.toks } : {}),
      },
    }),
    signal: AbortSignal.timeout(600_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

  const lector = res.body.getReader();
  const dec = new TextDecoder();
  let colchon = "";
  let final = null;
  let ttft = null;
  let salida = "";
  for (;;) {
    const { value, done } = await lector.read();
    if (done) break;
    colchon += dec.decode(value, { stream: true });
    let corte;
    while ((corte = colchon.indexOf("\n")) >= 0) {
      const linea = colchon.slice(0, corte).trim();
      colchon = colchon.slice(corte + 1);
      if (!linea) continue;
      const o = JSON.parse(linea);
      if (ttft === null && o.response) ttft = performance.now() - t0;
      if (o.response) salida += o.response;
      if (o.done) final = o;
    }
  }
  const total = performance.now() - t0;
  const ns = (x) => (typeof x === "number" ? x / 1e6 : null);
  return {
    ttft_ms: r1(ttft),
    total_ms: r1(total),
    carga_ms: ns(final?.load_duration),
    prefill_ms: ns(final?.prompt_eval_duration),
    decode_ms: ns(final?.eval_duration),
    prompt_tok: final?.prompt_eval_count ?? null,
    gen_tok: final?.eval_count ?? null,
    tok_s: final?.eval_count && final?.eval_duration
      ? r1(final.eval_count / (final.eval_duration / 1e9))
      : null,
    salida: salida.length,
  };
}

async function version() {
  try {
    const t = await (await fetch(`${OLLAMA}/api/version`, { signal: AbortSignal.timeout(5000) })).text();
    return JSON.parse(t).version || null;
  } catch {
    return null;
  }
}

async function expulsar(modelo) {
  await json(`${OLLAMA}/api/generate`, { model: modelo, keep_alive: 0 });
}

// ---- describe: ficha medida de cada modelo local (ram_estimate_mb de §X). ----
async function describe() {
  const { models } = await json(`${OLLAMA}/api/tags`);
  const fila = [];
  for (const m of models) {
    const nube = /(^|[:_-])cloud\b/i.test(m.name);
    if (nube) {
      fila.push({ id: m.name, nube: true, disco_mb: Math.round(m.size / 1e6) });
      console.log(`  ${m.name.padEnd(30)} nube: no se mide aquí`);
      continue;
    }
    const f = await json(`${OLLAMA}/api/show`, { name: m.name });
    const info = f.model_info || {};
    const arch = info["general.architecture"] || null;
    const ctx = arch ? info[`${arch}.context_length`] ?? null : null;
    const params = info["general.parameter_count"] ?? null;
    fila.push({
      id: m.name,
      nube: false,
      disco_mb: Math.round(m.size / 1e6),
      arquitectura: arch,
      cuantizacion: f.details?.quantization_level ?? null,
      parametros_B: params ? r2(params / 1e9) : null,
      ctx_max_declarado: ctx,
      ctx_en_modelfile: (f.parameters || "").includes("num_ctx") ? "sí" : "no",
      capabilities: f.capabilities || [],
      // Ollama 0.35 ya no devuelve `messages` en /api/show: el template vive en
      // el Modelfile. Mirar `f.messages` daba "generate" para todos los modelos,
      // que era falso.
      template_en_modelfile: /(^|\n)TEMPLATE\b/.test(f.modelfile || ""),
    });
    const d = fila.at(-1);
    console.log(`  ${m.name.padEnd(28)} ${String(d.disco_mb).padStart(6)} MB  ctx ${String(d.ctx_max_declarado).padStart(6)}  ${d.parametros_B}B  ${d.cuantizacion}  vis:${d.capabilities.includes("vision") ? "si" : "no"}`);
  }
  const locales = fila.filter((f) => !f.nube);
  mkdirSync(SALIDA, { recursive: true });
  const ruta = path.join(SALIDA, `describe-${hoy()}.json`);
  writeFileSync(ruta, JSON.stringify({ ollama: await version(), libre_gb: r2(libreGB()), modelos: fila }, null, 2));
  console.log(`\n${locales.length} locales medidos, ${fila.length - locales.length} en la nube → ${path.relative(RAIZ, ruta)}`);
}

function suite() {
  const j = JSON.parse(readFileSync(path.join(RAIZ, "benchmarks", "base.json"), "utf8"));
  return j.prompts;
}

function muestreo(prompts, porCat) {
  const salida = [];
  for (const c of new Set(prompts.map((p) => p.categoria))) {
    const del = prompts.filter((p) => p.categoria === c);
    for (let i = 0; i < porCat; i++) salida.push(del[(i * Math.floor(del.length / porCat)) % del.length]);
  }
  return salida;
}

// ---- pilot / suite: la misma ruta de código, distinto volumen. ----
async function correSuite({ piloto }) {
  const todas = suite();
  const lista = piloto ? muestreo(todas, CFG.porCat) : CFG.limite > 0 ? todas.slice(0, CFG.limite) : todas;
  console.log(`modelo ${CFG.modelo} · ${lista.length} prompts × ${CFG.reps} repes · ctx ${CFG.ctx} temp ${CFG.temperatura} seed ${CFG.seed}${CFG.toks > 0 ? ` · tope ${CFG.toks} tok de salida` : " · sin tope de salida"}`);
  console.log(`umbral de RAM ${CFG.minLibre} GB libres · libre ahora ${r2(libreGB())} GB`);

  const cargados = await json(`${OLLAMA}/api/ps`);
  if (!cargados.models.some((m) => m.name === CFG.modelo)) {
    const g = await esperarLibre(CFG.minLibre + 0.4);
    if (g.libre < CFG.minLibre + 0.4) {
      console.log(`ABORT: ${r2(g.libre)} GB libres, hacen falta ${CFG.minLibre + 0.4} para cargar. No se corre nada.`);
      process.exitCode = 3;
      return;
    }
    console.log("cargando (no se cuenta: es el calentamiento)…");
    const w = await corrida(CFG.modelo, "di solo: listo", { ...CFG, keepAlive: "300s" });
    console.log(`  carga ${Math.round(w.carga_ms || 0)} ms · TTFT ${Math.round(w.ttft_ms || 0)} ms`);
  }

  const filas = [];
  let corte = null;
  const t0 = Date.now();
  fuera: for (const p of lista) {
    for (let rep = 1; rep <= CFG.reps; rep++) {
      const g = await esperarLibre(CFG.minUso, 30_000);
      if (g.libre < CFG.minUso) {
        corte = { en: p.id, libre_gb: r2(g.libre), espero_ms: g.espero_ms };
        console.log(`  CORTE por RAM: ${r2(g.libre)} GB libres tras esperar ${Math.round(g.espero_ms / 1000)} s. Se guarda lo medido hasta aquí.`);
        break fuera;
      }
      const antes = r2(libreGB());
      let r;
      try {
        r = await corrida(CFG.modelo, p.texto, CFG);
      } catch (e) {
        r = { error: String(e).slice(0, 200) };
      }
      filas.push({ id: p.id, categoria: p.categoria, idioma: p.idioma, conjunto: p.conjunto, rep, libre_antes: antes, libre_despues: r2(libreGB()), espero_ms: g.espero_ms, ...r });
      const hechas = filas.length;
      const medio = (Date.now() - t0) / hechas;
      console.log(
        `  ${String(hechas).padStart(3)} ${p.id.padEnd(13)} ttft ${String(Math.round(r.ttft_ms ?? -1)).padStart(5)} ms  total ${String(Math.round(r.total_ms ?? -1)).padStart(6)} ms  ${String(r.gen_tok ?? "-").padStart(4)} tok  ${String(r.tok_s ?? "-").padStart(5)} tok/s  libre ${antes}${r.error ? "  ERROR " + r.error.slice(0, 60) : ""}  | media ${r1(medio / 1000)} s`,
      );
    }
  }

  const ps = (await json(`${OLLAMA}/api/ps`)).models.find((m) => m.name === CFG.modelo);
  mkdirSync(SALIDA, { recursive: true });
  const marca = `${piloto ? "piloto" : "suite"}-${CFG.modelo.replace(/[^\w.]+/g, "_")}-${CFG.toks > 0 ? `top${CFG.toks}-` : "sintope-"}${hoy()}`;
  const ruta = path.join(SALIDA, `${marca}.json`);
  const ok = filas.filter((f) => !f.error);
  const resumen = {
    marca,
    modelo: CFG.modelo,
    ollama: await version(),
    duracion_s: r1((Date.now() - t0) / 1000),
    sesion: { ctx: CFG.ctx, temperatura: CFG.temperatura, seed: CFG.seed, reps: CFG.reps, tope_salida: CFG.toks, min_libre: CFG.minLibre, min_uso: CFG.minUso },
    maquina: { ram_total_gb: r2(os.totalmem() / 1e9), ncleos: os.cpus().length, libre_al_terminar: r2(libreGB()) },
    en_memoria: ps ? { ram_mb: Math.round(ps.size / 1e6), vram_mb: Math.round(ps.size_vram / 1e6), ctx: ps.context_length } : null,
    errores: filas.length - ok.length,
    corte_por_ram: corte,
    nota: "Línea base del proveedor: /api/generate directo, sin prompt de sistema, sin tools y sin pasar por la app. Es el suelo de coste; el camino de Hatboo añade su system prompt encima.",
    por_categoria: Object.fromEntries(
      [...new Set(filas.map((f) => f.categoria))].map((c) => {
        const f = ok.filter((x) => x.categoria === c);
        return [c, { n: f.length, ttft_med_ms: Math.round(mediana(f.map((x) => x.ttft_ms)) ?? -1), total_med_ms: Math.round(mediana(f.map((x) => x.total_ms)) ?? -1), tok_s_med: mediana(f.map((x) => x.tok_s)), tok_salida_med: mediana(f.map((x) => x.gen_tok)) }];
      }),
    ),
    global: {
      ttft_med_ms: Math.round(mediana(ok.map((x) => x.ttft_ms)) ?? -1),
      total_med_ms: Math.round(mediana(ok.map((x) => x.total_ms)) ?? -1),
      tok_s_med: mediana(ok.map((x) => x.tok_s)),
      prompt_tok_med: mediana(ok.map((x) => x.prompt_tok)),
      gen_tok_med: mediana(ok.map((x) => x.gen_tok)),
    },
    validacion: (() => {
      const v = ok.filter((x) => x.conjunto === "validacion");
      if (!v.length) return { n: 0 };
      return {
        n: v.length,
        total_min_ms: Math.min(...v.map((x) => x.total_ms)),
        total_max_ms: Math.max(...v.map((x) => x.total_ms)),
        ttft_min_ms: Math.min(...v.map((x) => x.ttft_ms)),
        ttft_max_ms: Math.max(...v.map((x) => x.ttft_ms)),
      };
    })(),
    filas,
  };
  writeFileSync(ruta, JSON.stringify(resumen, null, 2));
  console.log(`\nmediana TTFT ${resumen.global.ttft_med_ms} ms · total ${resumen.global.total_med_ms} ms · ${resumen.global.tok_s_med} tok/s · errores ${resumen.errores}`);
  console.log(`en RAM: ${resumen.en_memoria ? resumen.en_memoria.ram_mb + " MB" : "ya descargado"} · duración ${resumen.duracion_s} s`);
  console.log(`crudo → ${path.relative(RAIZ, ruta)}`);
  const proyeccion = (filas.length ? (Date.now() - t0) / filas.length : 0) * 60 * 3;
  if (piloto) console.log(`proyección suite completa (60 × 3): ${r1(proyeccion / 60000)} min`);
}

// §XXIV.6: num_ctx fijo o por modelo. Recarga medida: mismo prompt, ctx distinto.
async function recarga() {
  const secuencia = [2048, 2048, 4096, 4096, 8192, 8192, 2048];
  const texto = "muéstrame el contenido de package.json";
  console.log(`recarga de ${CFG.modelo} al cambiar num_ctx · temperatura ${CFG.temperatura} seed ${CFG.seed}`);
  const filas = [];
  for (const ctx of secuencia) {
    await esperarLibre(CFG.minLibre);
    const r = await corrida(CFG.modelo, texto, { ...CFG, ctx });
    filas.push({ ctx, ...r });
    console.log(`  ctx ${String(ctx).padStart(5)}  carga ${String(Math.round(r.carga_ms ?? 0)).padStart(6)} ms  TTFT ${String(Math.round(r.ttft_ms ?? 0)).padStart(6)} ms  prefill ${String(Math.round(r.prefill_ms ?? 0)).padStart(6)} ms  ${r.prompt_tok} tok de entrada`);
  }
  mkdirSync(SALIDA, { recursive: true });
  const ruta = path.join(SALIDA, `recarga-${CFG.modelo.replace(/[^\w.]+/g, "_")}-${hoy()}.json`);
  writeFileSync(ruta, JSON.stringify({ modelo: CFG.modelo, ollama: await version(), filas }, null, 2));
  console.log(`crudo → ${path.relative(RAIZ, ruta)}`);
  await expulsar(CFG.modelo);
  console.log("modelo expulsado.");
}

/** §X pide `ram_estimate_mb` MEDIDO por modelo. Se carga cada uno con un prompt
 *  de dos tokens, se lee /api/ps y se expulsa. La cuota de 8192 mide cuánto
 *  añade el KV: si un modelo no cabe, eso también es un dato del Governor. */
async function rama() {
  const { models } = await json(`${OLLAMA}/api/tags`);
  const locales = models
    .filter((m) => m.size > 0 && !/(^|[:_-])cloud\b/i.test(m.name))
    .sort((a, b) => a.size - b.size);
  const fila = [];
  for (const m of locales) {
    for (const ctx of [2048, 8192]) {
      // Margen: lo que pesa en disco + holgura. El KV de 8192 vale lo que el de
      // 2048 multiplicado por cuatro, y eso hay que pagarlo antes de cargar.
      const falta = m.size / 1e9 + (ctx >= 8192 ? 0.9 : 0.5);
      const g = await esperarLibre(falta, 20_000);
      if (g.libre < falta) {
        fila.push({ id: m.name, ctx, no_cabe: true, libre_gb: r2(g.libre), falta_gb: r2(falta) });
        console.log(`  ${m.name.padEnd(22)} ctx ${ctx}  NO CABE (libre ${r2(g.libre)} GB, hacen falta ${r2(falta)})`);
        continue;
      }
      const antes = r2(libreGB());
      let r;
      try {
        r = await corrida(m.name, "responde solo: ok", { ...CFG, ctx, keepAlive: "60s" });
      } catch (e) {
        fila.push({ id: m.name, ctx, error: String(e).slice(0, 160) });
        console.log(`  ${m.name.padEnd(22)} ctx ${ctx}  ERROR ${String(e).slice(0, 70)}`);
        continue;
      }
      const ps = (await json(`${OLLAMA}/api/ps`)).models.find((x) => x.name === m.name);
      fila.push({
        id: m.name,
        ctx,
        disco_mb: Math.round(m.size / 1e6),
        ram_ollama_mb: ps ? Math.round(ps.size / 1e6) : null,
        vram_mb: ps ? Math.round(ps.size_vram / 1e6) : null,
        ctx_asignado: ps?.context_length ?? null,
        carga_ms: Math.round(r.carga_ms ?? 0),
        ttft_ms: Math.round(r.ttft_ms ?? 0),
        libre_antes: antes,
        libre_despues: r2(libreGB()),
        caida_gb: r2(antes - libreGB()),
      });
      const d = fila.at(-1);
      console.log(`  ${m.name.padEnd(22)} ctx ${ctx}  residente ${d.ram_ollama_mb} MB  carga ${d.carga_ms} ms  RAM cay ${d.caida_gb} GB  libre ${d.libre_despues}`);
      await expulsar(m.name);
    }
  }
  mkdirSync(SALIDA, { recursive: true });
  const ruta = path.join(SALIDA, `rama-${hoy()}.json`);
  writeFileSync(ruta, JSON.stringify({ ollama: await version(), maquina_gb: r2(os.totalmem() / 1e9), modelos: fila }, null, 2));
  console.log(`\ncrudo → ${path.relative(RAIZ, ruta)}`);
}

if (!modo || !["describe", "pilot", "suite", "recarga", "rama"].includes(modo)) {
  console.log("uso: node scripts/fase0-bench.mjs describe|pilot|suite|recarga|rama [--model <id>] [--reps 3] [--ctx 2048] [--toks 512] [--min-libre 1.2]");
  process.exitCode = modo ? 2 : 0;
} else if (modo === "describe") {
  await describe();
} else if (modo === "rama") {
  await rama();
} else if (!CFG.modelo) {
  console.log("Falta --model (un id de `ollama list`).");
  process.exitCode = 2;
} else if (modo === "recarga") {
  await recarga();
} else {
  await correSuite({ piloto: modo === "pilot" });
}
