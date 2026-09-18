/**
 * End-to-End-Test: ruft lernmodul_lesen des Workers für JEDEN Slug aus llms.txt auf und prüft,
 * ob der zurückgegebene Volltext auch wirklich das richtige Modul ist (eigene URL + genug Text).
 * fetch wird umgebogen: /llms-full.txt kommt aus einer lokalen Datei, wenn eine angegeben ist.
 *   node mcp-lesen-check.mjs                      → gegen live
 *   node mcp-lesen-check.mjs ~/neu-llms-full.txt  → gegen den Patch-Kandidaten
 */
import fs from "node:fs";
const lokal = process.argv[2] ? fs.readFileSync(process.argv[2].replace(/^~/, process.env.HOME), "utf8") : null;
const echt = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const s = String(url);
  if (lokal && s.endsWith("/llms-full.txt")) return new Response(lokal, { status: 200 });
  return echt(s, init);
};
const worker = (await import(new URL("./worker.js", "file://" + process.cwd() + "/"))).default;
const W = await import(new URL("./worker.js", "file://" + process.cwd() + "/"));
const call = async (name, args) => {
  const res = await worker.fetch(new Request("https://mcp.latzerus.ch/mcp", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })
  }));
  return (await res.json()).result;
};
const module = W.parseIndex(await (await echt("https://www.latzerus.ch/llms.txt")).text());
console.log(`Quelle Volltext: ${lokal ? process.argv[2] : "live"} · ${module.length} Module\n`);
let ok = 0; const fehler = [];
for (const m of module) {
  const r = await call("lernmodul_lesen", { slug: m.slug });
  const t = r.content[0].text;
  if (r.isError) { fehler.push(`${m.slug}: kein Volltext gefunden`); continue; }
  if (!t.includes(`/lernen/${m.slug}/`)) { fehler.push(`${m.slug}: Text enthält die eigene URL nicht → falsches Modul?`); continue; }
  const fremd = [...t.matchAll(/^URL:\s*https:\/\/www\.latzerus\.ch\/lernen\/([^\/\s]+)\//gm)].map(x => x[1]).filter(s => s !== m.slug);
  if (fremd.length) { fehler.push(`${m.slug}: enthält fremde Modul-URL (${fremd.join(", ")})`); continue; }
  if (t.length < 1500) { fehler.push(`${m.slug}: nur ${t.length} Zeichen`); continue; }
  ok++;
}
console.log(`lernmodul_lesen korrekt: ${ok}/${module.length}`);
if (fehler.length) console.log("  Problemfälle:\n   - " + fehler.join("\n   - "));
