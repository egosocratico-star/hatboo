// Saca las claves de t() de todo src/ y escribe el esqueleto de i18n-en.ts.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dirs = ["src", "src/components", "src/components/work", "src/components/mascot"];
const files = [
  ...new Set(
    dirs.flatMap((d) =>
      readdirSync(join(process.cwd(), d))
        .filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"))
        .map((f) => join(d, f)),
    ),
  ),
].filter((f) => !f.includes("i18n"));

const RE = /\bt\(\s*"((?:[^"\\]|\\.)*)"\s*[,)]/g;
const claves = new Set();
for (const f of files) {
  const src = readFileSync(join(process.cwd(), f), "utf8");
  for (const m of src.matchAll(RE)) claves.add(JSON.parse(`"${m[1]}"`));
}

const orden = [...claves].sort((a, b) => a.localeCompare(b, "es"));
writeFileSync("scripts/claves.json", JSON.stringify(orden, null, 1));
console.log("claves unicas:", orden.length);
console.log("con variables {x}:", orden.filter((k) => k.includes("{")).length);
console.log("larguisimas (>160):", orden.filter((k) => k.length > 160).length);
