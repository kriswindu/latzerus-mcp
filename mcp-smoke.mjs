import worker from "./worker.js";

const post = async (body, pfad = "/mcp") => {
  const req = new Request("https://mcp.latzerus.ch" + pfad, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
  const res = await worker.fetch(req);
  const txt = await res.text();
  let json = null;
  try { json = JSON.parse(txt); } catch {}
  return { status: res.status, json, txt };
};
const call = (name, args = {}) => post({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
const kurz = (s, n = 120) => (s || "").replace(/\n/g, " ⏎ ").slice(0, n);

console.log("--- initialize ---");
let r = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
console.log(r.status, r.json.result.protocolVersion, JSON.stringify(r.json.result.serverInfo));

console.log("\n--- Protokoll-Verhandlung ---");
for (const v of ["2025-03-26", "2024-11-05", "1999-01-01", undefined]) {
  const res = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: v } });
  console.log(`  angefragt ${v ?? "(keine)"} → ${res.json.result.protocolVersion}`);
}
{
  const res = await worker.fetch(new Request("https://mcp.latzerus.ch/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) }));
  console.log(`  Header MCP-Protocol-Version: ${res.headers.get("MCP-Protocol-Version")} (erwartet 2025-06-18)`);
}

console.log("\n--- tools/list ---");
r = await post({ jsonrpc: "2.0", id: 2, method: "tools/list" });
for (const t of r.json.result.tools) {
  console.log(`  ${t.name}  inputProps=${Object.keys(t.inputSchema.properties || {}).join(",") || "-"}  outputSchema=${t.outputSchema ? "ja" : "nein"}`);
}

console.log("\n--- Suche: die 5 Audit-Fehlschläge ---");
for (const q of ["Stammkunden", "Einwandbehandlung", "Kaltaquise", "Kunde will billiger", "Lohnverhandlung Gehalt"]) {
  const t0 = Date.now();
  const res = (await call("lernmodule_suchen", { suchbegriff: q })).json.result;
  const sc = res.structuredContent;
  console.log(
    `  «${q}» → ${sc.anzahl} Treffer, isError=${res.isError}, ${Date.now() - t0} ms` +
      (sc.anzahl ? `\n      ${sc.treffer.slice(0, 3).map((x) => `${x.slug}(${x.score})`).join(", ")}` : `\n      ${kurz(res.content[0].text, 100)}`)
  );
}

console.log("\n--- Regression: Suchen, die vorher funktionierten ---");
for (const q of ["Datenschutz Cloud", "Ollama offline", "ChatGPT Follow-up", "Kaltakquise Trigger"]) {
  const sc = (await call("lernmodule_suchen", { suchbegriff: q })).json.result.structuredContent;
  console.log(`  «${q}» → ${sc.anzahl}: ${sc.treffer.slice(0, 2).map((x) => x.slug).join(", ")}`);
}

console.log("\n--- Grenzfälle Suche ---");
for (const args of [{ suchbegriff: "" }, { suchbegriff: "   " }, { suchbegriff: "xyzqvw" }, { suchbegriff: "der die das" }, { suchbegriff: "Preis", maxTreffer: 99 }, {}]) {
  const res = (await call("lernmodule_suchen", args)).json.result;
  console.log(`  ${JSON.stringify(args)} → isError=${res.isError}, anzahl=${res.structuredContent?.anzahl}, «${kurz(res.content[0].text, 70)}»`);
}

console.log("\n--- lernmodul_lesen ---");
for (const s of ["zu-teuer-die-einzige-antwort", "https://www.latzerus.ch/lernen/was-ist-gatekeeper/", "../../etc/passwd", "gibtsnicht", "stammkunde", ""]) {
  const res = (await call("lernmodul_lesen", { slug: s })).json.result;
  console.log(`  «${s}» → isError=${res.isError}, ${res.content[0].text.length} Zeichen: ${kurz(res.content[0].text, 80)}`);
}

console.log("\n--- lernmodule_uebersicht ---");
for (const args of [{}, { cluster: "karriere" }, { cluster: "KI im Arbeitsalltag" }, { cluster: "quatsch" }]) {
  const res = (await call("lernmodule_uebersicht", args)).json.result;
  const t = res.content[0].text;
  console.log(`  ${JSON.stringify(args)} → isError=${res.isError}, ${t.length} Zeichen, ${(t.match(/^- /gm) || []).length} Module: ${kurz(t, 90)}`);
}

console.log("\n--- ueber_latzerus ---");
r = (await call("ueber_latzerus")).json.result;
console.log(`  ${r.content[0].text.length} Zeichen, Coaching erwähnt: ${/Coaching oder Beratung wird nicht/.test(r.content[0].text)}, Tagessatz: ${/Tagessatz/.test(r.content[0].text)}`);

console.log("\n--- Fehlercodes ---");
console.log("  kaputtes JSON      →", (await post("{nope")).json.error.code, "(erwartet -32700)");
console.log("  unbekanntes Tool   →", (await call("gibtsnicht")).json.error.code, "(erwartet -32602)");
console.log("  unbekannte Methode →", (await post({ jsonrpc: "2.0", id: 3, method: "foo/bar" })).json.error.code, "(erwartet -32601)");
console.log("  kein jsonrpc       →", (await post({ id: 4, method: "ping" })).json.error.code, "(erwartet -32600)");
r = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
console.log("  Notification       → HTTP", r.status, "(erwartet 202)");
r = await post([{ jsonrpc: "2.0", id: 5, method: "ping" }, { jsonrpc: "2.0", id: 6, method: "tools/list" }]);
console.log("  Batch              →", Array.isArray(r.json) ? `${r.json.length} Antworten` : "KEIN Array (Fehler)");

console.log("\n--- HTTP-Oberfläche ---");
for (const [m, p] of [["GET", "/"], ["GET", "/.well-known/mcp/server.json"], ["GET", "/mcp"], ["OPTIONS", "/mcp"], ["DELETE", "/mcp"], ["GET", "/quatsch"]]) {
  const res = await worker.fetch(new Request("https://mcp.latzerus.ch" + p, { method: m }));
  const body = await res.text();
  console.log(`  ${m} ${p} → ${res.status} ${res.headers.get("content-type") || ""} ${p.includes("server.json") ? kurz(body, 60) : ""}`);
}

console.log("\n--- CPU: warm vs. kalt ---");
const t1 = Date.now();
for (let i = 0; i < 20; i++) await call("lernmodule_suchen", { suchbegriff: "Preis verhandeln Rabatt" });
console.log(`  20 warme Suchen: ${((Date.now() - t1) / 20).toFixed(1)} ms pro Anfrage (inkl. Fetch aus dem HTTP-Cache)`);
