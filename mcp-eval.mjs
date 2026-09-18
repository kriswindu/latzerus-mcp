#!/usr/bin/env node
/**
 * Eval für die Latzerus-MCP-Suche. Vor JEDEM Worker-Deploy laufen lassen.
 *
 *   node mcp-eval.mjs                      # lokal: Logik aus worker.js gegen live llms.txt
 *   node mcp-eval.mjs --worker worker-next.js
 *   node mcp-eval.mjs --live               # gegen https://mcp.latzerus.ch/mcp (echter MCP-Call)
 *
 * Bestanden = einer der erwarteten Slugs steht in den Top 3. erwartet: [] = es darf nichts kommen.
 * «offen» im Eval-Set = bekannte Grenzen der Wort-Suche, werden berichtet aber zaehlen nicht als Fehler.
 * Eval-Set: mcp-eval-set.json
 */

import fs from "node:fs";

const args = process.argv.slice(2);
const live = args.includes("--live");
const workerDatei = (() => {
  const i = args.indexOf("--worker");
  return i >= 0 && args[i + 1] ? args[i + 1] : "worker.js";
})();
const ENDPOINT = "https://mcp.latzerus.ch/mcp";
// Pfade als URL relativ zu dieser Datei — sonst bricht ein Leerzeichen im Ordnernamen alles
const set = JSON.parse(fs.readFileSync(new URL("./mcp-eval-set.json", import.meta.url), "utf8"));

async function ladeQuellen() {
  const hol = async (p) => {
    const r = await fetch("https://www.latzerus.ch" + p);
    if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`);
    return r.text();
  };
  return { llms: await hol("/llms.txt"), full: await hol("/llms-full.txt") };
}

async function sucherLokal() {
  const w = await import(new URL("./" + workerDatei, import.meta.url));
  const { llms, full } = await ladeQuellen();
  const module = w.parseIndex(llms);
  const t0 = process.hrtime.bigint();
  const felder = module.map(w.feldIndex);
  const indexMs = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`Quelle: ${workerDatei} · ${module.length} Module · Index-Bau ${indexMs.toFixed(1)} ms`);
  return {
    info: `${module.length} Module`,
    async suche(frage) {
      const { treffer } = await w.sucheDurchfuehren(module, felder, frage, 8, () => full);
      return treffer.map((t) => ({ slug: t.mod.slug, score: Math.round(t.score * 10) / 10 }));
    }
  };
}

function sucherLive() {
  let id = 0;
  const call = async (name, args) => {
    const r = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } })
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    return j.result;
  };
  console.log(`Quelle: ${ENDPOINT} (live)`);
  return {
    info: ENDPOINT,
    async suche(frage) {
      const res = await call("lernmodule_suchen", { suchbegriff: frage, maxTreffer: 8 });
      if (res.structuredContent) {
        return res.structuredContent.treffer.map((t) => ({ slug: t.slug, score: t.score }));
      }
      // Fallback für alte Worker-Version ohne structuredContent: Slugs aus dem Text lesen
      if (res.isError) return [];
      const text = (res.content || []).map((c) => c.text).join("\n");
      return [...text.matchAll(/Slug:\s*([a-z0-9-]+)/g)].map((m) => ({ slug: m[1], score: 0 }));
    }
  };
}

const sucher = live ? sucherLive() : await sucherLokal();
let ok = 0;
const fehler = [];
const t0 = Date.now();

for (const f of set.faelle) {
  let tr = [];
  try { tr = await sucher.suche(f.frage); } catch (e) { tr = []; console.log(`ERR  «${f.frage}»: ${e.message}`); }
  const top3 = tr.slice(0, 3).map((x) => x.slug);
  const bestanden = f.erwartet.length === 0 ? tr.length === 0 : f.erwartet.some((s) => top3.includes(s));
  if (bestanden) { ok++; console.log(`OK   «${f.frage}» → ${top3[0] || "(kein Treffer)"}`); }
  else {
    fehler.push(f.frage);
    console.log(`FAIL «${f.frage}»`);
    console.log(`     erwartet: ${f.erwartet.join(" | ") || "(kein Treffer)"}`);
    console.log(`     bekommen: ${tr.slice(0, 5).map((x) => `${x.slug}(${x.score})`).join(", ") || "(nichts)"}`);
  }
}

if (set.offen && set.offen.length) {
  console.log("\nBekannte Grenzen der Wort-Suche (kein Fehler, nur Bericht):");
  for (const f of set.offen) {
    const tr = await sucher.suche(f.frage);
    const top3 = tr.slice(0, 3).map((x) => x.slug);
    const getroffen = f.erwartet.length === 0 ? tr.length === 0 : f.erwartet.some((s) => top3.includes(s));
    console.log(`  ${getroffen ? "jetzt ok" : "offen  "} «${f.frage}» → ${top3.join(", ") || "(kein Treffer)"}`);
    if (!getroffen) console.log(`           ${f.hinweis}`);
  }
}

console.log(`\n${ok}/${set.faelle.length} Pflichtfaelle bestanden in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (fehler.length) { console.log("Durchgefallen: " + fehler.join(" · ")); process.exit(1); }
