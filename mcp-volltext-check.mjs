/**
 * Prüft llms-full.txt gegen llms.txt: Hat jedes Modul eine eigene «URL:»-Zeile?
 * Diese Zeile ist der Anker für lernmodul_lesen UND für die Volltext-Stufe der Suche —
 * ein Modul ohne Anker ist im MCP-Volltext unsichtbar. Zeigt zusätzlich die H1/H2-Formate.
 * Aufruf: node mcp-volltext-check.mjs   (braucht worker.js im gleichen Ordner)
 */
import { parseIndex } from "./worker.js";
const hol = async (p) => (await fetch("https://www.latzerus.ch" + p)).text();
const [llms, full] = [await hol("/llms.txt"), await hol("/llms-full.txt")];
const module = parseIndex(llms);
// 1. Wie viele Module haben eine eigene URL:-Zeile? (Anker für lernmodul_lesen + Volltext-Suche)
const urlZeilen = new Set([...full.matchAll(/^URL:\s*https:\/\/www\.latzerus\.ch\/lernen\/([^\/\s]+)\/?\s*$/gm)].map(m => m[1].toLowerCase()));
const ohne = module.filter(m => !urlZeilen.has(m.slug));
console.log(`Module in llms.txt: ${module.length} · mit URL:-Zeile in llms-full.txt: ${urlZeilen.size}`);
console.log(`Ohne URL:-Anker (${ohne.length}):`); ohne.forEach(m => console.log("   -", m.slug));
// 2. Fremde Anker (URL-Zeilen ohne Modul im Index)
const slugs = new Set(module.map(m => m.slug));
const fremd = [...urlZeilen].filter(s => !slugs.has(s));
console.log(`URL:-Anker ohne Index-Eintrag (${fremd.length}):`, fremd.join(", ") || "-");
// 3. Formate im Volltext: Kopfzeilen-Varianten
const h1 = [...full.matchAll(/^#\s+(.+)$/gm)].map(m => m[1]);
console.log(`\nH1-Zeilen (# ...) im Volltext: ${h1.length}`); h1.slice(0,8).forEach(h=>console.log("   #", h.slice(0,70)));
