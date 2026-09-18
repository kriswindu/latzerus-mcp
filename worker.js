/**
 * Latzerus MCP Server — Cloudflare Worker
 * ----------------------------------------
 * Stellt die Lernmodule von latzerus.ch als MCP-Server bereit (Streamable HTTP, stateless, ohne Auth).
 * Endpoint: https://mcp.latzerus.ch/mcp
 * Datenquellen (live, 1h gecacht): /llms.txt (Index) und /llms-full.txt (Volltexte).
 * Kein Build-Schritt, keine Abhängigkeiten — Code direkt ins Cloudflare-Dashboard einfügen.
 *
 * Änderungen 2026-09-11 (Bugfix, Version bleibt 1.0.0 = synchron mit MCP Registry):
 * - lernmodul_lesen lieferte bei 15 von 107 Slugs das FALSCHE Modul (Treffer über «Verwandte Module»-Links
 *   bzw. fehlende ----Trenner in llms-full.txt). Neu: Zerlegung nach eigener URL:-Zeile / Titel-Überschrift.
 * - llms.txt-Einträge mit «:» statt «—» als Trenner wurden ignoriert (neuestes Modul fehlte in Suche/Übersicht).
 * - INSTRUCTIONS: «Über 99» → «Über 100».
 *
 * Änderungen 2026-09-11 abends (Datei worker-v1.0.2.js, Version 1.0.1 = neuer Registry-Eintrag):
 * - Latzerus ist jetzt ein Wissensprojekt ohne Coaching/Beratung: INSTRUCTIONS, ueber_latzerus,
 *   Info-Seite und server.json ohne Coaching, Termin und Strategie-Call.
 *
 * Änderung Datei worker-v1.0.3.js (Version bleibt 1.0.1):
 * - parseIndex zählte die 4 Themen-Links aus «## Themen» in llms.txt als Module (112 statt 108,
 *   leerer Cluster in der Übersicht). Neu: nur Einträge unter einer ###-Cluster-Überschrift.
 *
 * Änderungen Datei worker-v1.0.4.js, 2026-09-18 (SERVER_INFO bleibt 1.0.1 — server.json unverändert,
 * also KEIN neuer Registry-Eintrag nötig):
 * - SUCHE NEU (war reiner Wort-Match, «Stammkunden» oder «Einwandbehandlung» fanden nichts):
 *   Normalisierung (Umlaute → ae/oe/ue), Stemming, Präfix-Match, Tippfehler-Toleranz (Levenshtein 1),
 *   45 Synonym-Klassen als Query-Expansion, Feld-Gewichtung (Titel 6 / Tags 4 / Beschreibung 2 /
 *   Slug 2 / Cluster 1.5 / Volltext 0.5), Deckungsfaktor und Score-Schwelle.
 * - Volltext-Stufe: findet die Keyword-Stufe weniger als 3 Module, wird llms-full.txt dazugenommen
 *   (bewusst nur dann — Cloudflare Free hat 10 ms CPU pro Request).
 * - Index wird pro Isolate gecacht (INDEX_CACHE, 10 min) — warme Anfragen brauchen ~1 ms CPU.
 * - «Nichts gefunden» liefert jetzt isError: true (Client kann Treffer und Nicht-Treffer unterscheiden).
 * - lernmodule_suchen hat outputSchema + structuredContent (Clients müssen keinen Fliesstext parsen).
 * - lernmodule_uebersicht hat optionalen Parameter «cluster».
 * Pruefen vor dem Deploy (im gleichen Ordner, node 22+):
 *   node mcp-eval.mjs    → 34 Suchfaelle gegen die echte llms.txt
 *   node mcp-smoke.mjs   → Handshake, alle 4 Tools, Fehlercodes, Grenzfaelle gegen diese Datei
 */

const SITE = "https://www.latzerus.ch";
const SERVER_INFO = { name: "latzerus-mcp", title: "Latzerus Lernbereich", version: "1.0.1" };
const INSTRUCTIONS =
  "MCP-Server von Latzerus (Christoph Latzer, latzerus.ch) — Wissensprojekt aus der Ostschweiz, Hilfe zur Selbsthilfe. " +
  "Über 100 kostenlose 5-Minuten-Lernmodule zu Vertrieb & Kommunikation, KI im Arbeitsalltag, Karriere-Werkstatt und Wilde Themen. " +
  "Nutze lernmodule_suchen für die Stichwortsuche (versteht Umschreibungen, Synonyme, Plural und Tippfehler — " +
  "es braucht nicht das exakte Titel-Vokabular), lernmodul_lesen für den Volltext eines Moduls, " +
  "lernmodule_uebersicht für alle Module nach Thema, ueber_latzerus für Infos zum Projekt. " +
  "Coaching oder Beratung wird nicht angeboten. Kontakt: https://www.latzerus.ch/contact/";

/* ---------------- Tools ---------------- */

const TREFFER_SCHEMA = {
  type: "object",
  properties: {
    suchbegriff: { type: "string" },
    anzahl: { type: "number" },
    treffer: {
      type: "array",
      items: {
        type: "object",
        properties: {
          slug: { type: "string" },
          titel: { type: "string" },
          cluster: { type: "string" },
          url: { type: "string" },
          score: { type: "number" },
          beschreibung: { type: "string" }
        },
        required: ["slug", "titel", "cluster", "url", "score"]
      }
    }
  },
  required: ["suchbegriff", "anzahl", "treffer"]
};

const TOOLS = [
  {
    name: "lernmodule_suchen",
    title: "Lernmodule durchsuchen",
    description:
      "Durchsucht alle kostenlosen Lernmodule von latzerus.ch (Vertrieb, Kommunikation, KI im Arbeitsalltag, Karriere) " +
      "nach Stichworten. Versteht Umschreibungen, Synonyme, Ein- und Mehrzahl sowie Tippfehler — es braucht nicht das " +
      "exakte Titel-Vokabular; «Kunde will billiger» oder «Einwandbehandlung» funktionieren. " +
      "Liefert Titel, Cluster, URL und Kurzbeschreibung der besten Treffer.",
    inputSchema: {
      type: "object",
      properties: {
        suchbegriff: { type: "string", description: "Stichworte oder eine Frage, z.B. 'Kunde will billiger' oder 'ChatGPT Follow-up'" },
        maxTreffer: { type: "number", description: "Maximale Trefferzahl (Standard 8, max. 20)" }
      },
      required: ["suchbegriff"]
    },
    outputSchema: TREFFER_SCHEMA
  },
  {
    name: "lernmodul_lesen",
    title: "Lernmodul im Volltext lesen",
    description:
      "Liefert den kompletten Inhalt eines Lernmoduls (Kernpunkte, Hauptteil, Praxis-Schritte, typische Fehler, FAQ). " +
      "Als Parameter den Slug oder die URL des Moduls angeben, z.B. 'preis-anker-ohne-zittern'.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Slug oder vollständige URL des Moduls, z.B. 'warum-trigger-events-wichtiger-sind-als-telefonlisten'" }
      },
      required: ["slug"]
    }
  },
  {
    name: "lernmodule_uebersicht",
    title: "Alle Lernmodule nach Cluster",
    description:
      "Listet alle verfügbaren Lernmodule von latzerus.ch, gruppiert nach Themen-Cluster, mit Titel und URL. " +
      "Optional auf einen Cluster einschränken, um Tokens zu sparen.",
    inputSchema: {
      type: "object",
      properties: {
        cluster: {
          type: "string",
          description:
            "Optional: nur ein Thema listen — 'Vertrieb & Kommunikation', 'KI im Arbeitsalltag', " +
            "'Karriere-Werkstatt' oder 'Wilde Themen' (Teilwort genügt, z.B. 'karriere')"
        }
      }
    }
  },
  {
    name: "ueber_latzerus",
    title: "Über Latzerus",
    description:
      "Infos über Latzerus: das Wissensprojekt von Christoph Latzer, die vier Themen, Herkunft, eingesetzte KI-Tools und Kontakt.",
    inputSchema: { type: "object", properties: {} }
  }
];

/* ---------------- Datenquellen ---------------- */

async function fetchText(path) {
  const res = await fetch(SITE + path, {
    cf: { cacheTtl: 3600, cacheEverything: true },
    headers: { "User-Agent": "latzerus-mcp-worker/1.0" }
  });
  if (!res.ok) throw new Error(`Konnte ${path} nicht laden (HTTP ${res.status})`);
  return res.text();
}

/** Parst llms.txt zu [{titel, url, slug, beschreibung, cluster}] — nur /lernen/-Einträge. */
function parseIndex(llmsTxt) {
  const module = [];
  const gesehen = new Set();
  let cluster = "";
  for (const line of llmsTxt.split("\n")) {
    const h = line.match(/^###\s+(.+)$/);
    if (h) { cluster = h[1].trim(); continue; }
    // Trenner nach dem Link: «—», «–», «:» oder «-» (llms.txt ist nicht einheitlich)
    const m = line.match(/^-\s+\[(.+?)\]\((https:\/\/www\.latzerus\.ch\/lernen\/[^)]+?)\/?\)\s*(?:(?:—|–|:|-)\s*(.*))?$/);
    // Nur Einträge unter einer ###-Cluster-Überschrift sind Module (sonst z.B. Themen-Links aus «## Themen»)
    if (m && cluster) {
      const url = m[2].replace(/\/?$/, "/");
      const slug = url.replace(/\/$/, "").split("/").pop();
      if (gesehen.has(slug)) continue;
      gesehen.add(slug);
      module.push({
        titel: m[1].trim(),
        url,
        slug,
        beschreibung: (m[3] || "").trim(),
        cluster,
        tags: []
      });
    }
  }
  return module;
}

/** Normalisiert Titel für den Vergleich (Umlaute, Satzzeichen, Gross/Klein egal). */
function normTitel(s) {
  return String(s)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Zerlegt llms-full.txt in Map(slug → Volltext).
 * Anker pro Modul: eigene «URL: …/lernen/<slug>/»-Zeile (bzw. die Überschrift direkt davor, Altformat).
 * Module ohne URL-Zeile: Überschrift mit exakt dem Titel aus llms.txt.
 * Ende eines Moduls: nächster «---»-Trenner, nächster Anker oder Datei-Kopf/Fussblock.
 * (Früher: erster Block, der die URL IRGENDWO enthielt → Verlinkungen lieferten falsche Module.)
 */
function zerlegeVolltext(full, module) {
  const lines = full.split("\n");
  const urlZeile = new Map();
  const titelZeile = new Map();
  lines.forEach((l, i) => {
    const u = l.match(/^URL:\s*https:\/\/www\.latzerus\.ch\/lernen\/([^\/\s]+)\/?\s*$/);
    if (u && !urlZeile.has(u[1].toLowerCase())) urlZeile.set(u[1].toLowerCase(), i);
    const t = l.match(/^#{1,2}\s+(?:Modul\s+\d+:\s+)?(.+?)\s*$/);
    if (t) {
      const k = normTitel(t[1]);
      if (!titelZeile.has(k)) titelZeile.set(k, i);
    }
  });

  const anker = [];
  for (const mod of module) {
    let start = urlZeile.get(mod.slug);
    if (start !== undefined) {
      for (let j = start - 1; j >= Math.max(0, start - 3); j--) {
        if (/^---\s*$/.test(lines[j])) break;
        if (/^#{1,2}\s/.test(lines[j])) { start = j; break; }
      }
    } else {
      start = titelZeile.get(normTitel(mod.titel));
    }
    if (start !== undefined) anker.push({ slug: mod.slug, start });
  }

  const starts = new Set(anker.map((a) => a.start));
  const istGrenze = (l, i) =>
    /^---\s*$/.test(l) || starts.has(i) || /^#\s+Latzerus\b/.test(l) || /^##\s+Über Latzerus/.test(l);
  const texte = new Map();
  for (const a of anker) {
    let ende = a.start + 1;
    while (ende < lines.length && !istGrenze(lines[ende], ende)) ende++;
    texte.set(a.slug, lines.slice(a.start, ende).join("\n").trim());
  }
  return texte;
}

/* ================= Suche ================= */
/* Stufe 1 (2026-09-18): Wort-Match ersetzt durch Normalisierung + Stemming + Präfix +
 * Tippfehler-Toleranz + Synonym-Klassen + Feld-Gewichtung + Score-Schwelle.
 * Volltext (llms-full.txt) kommt nur dazu, wenn die Keyword-Stufe zu wenig findet. */

const UMLAUT = { "ä": "ae", "ö": "oe", "ü": "ue", "Ä": "ae", "Ö": "oe", "Ü": "ue", "ß": "ss" };

function norm(s) {
  return String(s)
    .replace(/[äöüÄÖÜß]/g, (c) => UMLAUT[c])
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const ENDUNGEN = ["innen", "ungen", "ung", "nen", "ten", "en", "er", "es", "em", "et", "te", "st", "e", "n", "s"];
function stem(w) {
  for (const e of ENDUNGEN) {
    if (w.length - e.length >= 4 && w.endsWith(e)) return w.slice(0, w.length - e.length);
  }
  return w;
}

const STOPP = new Set(
  ("der die das dem den des ein eine einen einem eines und oder aber wie was wann wer wo warum wenn ich du er sie es wir ihr man mir mich dir dich" +
   " ist sind war bin bist sein haben hat habe hatte werden wird wurde kann koennen soll sollte will wollen muss muessen darf duerfen mag" +
   " nicht kein keine nur auch noch schon mal sehr mehr am im in bei auf zu zur zum aus von vom mit ohne fuer ueber unter vor nach bis an als" +
   " so dass da denn doch etwas viel viele alle jeder jede jedes dieser diese dieses mein meine dein deine ihre seine")
    .split(" ")
);

/** Synonym-Klassen: gleichwertige Begriffe. Reine Query-Expansion — llms.txt bleibt unberührt.
 *  Neues Modul mit eigenem Vokabular? Hier eine Klasse ergänzen, nicht die Website anfassen. */
const SYNONYM_KLASSEN = [
  ["einwand", "einwandbehandlung", "widerstand", "vorwand", "ausrede", "bedenken", "teuer", "preiseinwand", "abwehr"],
  ["preis", "kosten", "teuer", "billiger", "guenstiger", "rabatt", "nachlass", "preisnachlass", "marge", "skonto", "anker"],
  ["lohn", "gehalt", "salaer", "lohnverhandlung", "gehaltsverhandlung", "lohnerhoehung", "bezahlung", "verdienst"],
  ["bewerbung", "bewerben", "lebenslauf", "cv", "dossier", "motivationsschreiben", "anschreiben", "bewerbungsdossier"],
  ["kaltakquise", "akquise", "neukunden", "neukundengewinnung", "kaltanruf", "coldcall", "erstkontakt", "erstansprache"],
  ["telefon", "anruf", "telefonat", "telefonieren", "call", "hoerer", "telefonliste"],
  ["mail", "email", "mails", "nachricht", "betreff", "betreffzeile", "anschreiben", "inbox"],
  ["linkedin", "xing", "social", "netzwerk", "profil", "personalbranding"],
  ["kunde", "kunden", "stammkunde", "bestandskunde", "kundschaft", "klient", "auftraggeber"],
  ["abschluss", "closing", "abschlussquote", "abschliessen", "zusage", "unterschrift", "deal", "auftrag"],
  ["angebot", "offerte", "ausschreibung", "submission", "tender", "kalkulation"],
  ["entscheider", "entscheidungstraeger", "chef", "ceo", "geschaeftsfuehrer", "inhaber", "einkaeufer", "vorgesetzter"],
  ["recherche", "research", "finden", "informationen", "quellen", "vorbereitung", "geschaeftsbericht"],
  ["ki", "kuenstliche", "intelligenz", "ai", "llm", "sprachmodell", "generative"],
  ["chatgpt", "gpt", "openai"],
  ["claude", "anthropic"],
  ["mistral", "llama", "qwen", "gemma", "deepseek"],
  ["ollama", "lokal", "offline", "selbstgehostet", "eigenerechner", "lmstudio"],
  ["rag", "wissensdatenbank", "vektordatenbank", "embedding", "retrieval", "chatbot", "handbuch"],
  ["prompt", "prompting", "systemprompt", "anweisung", "promptvorlage"],
  ["datenschutz", "dsgvo", "dsg", "privacy", "vertraulich", "cloudact", "compliance", "geheimnis"],
  ["sicherheit", "security", "schutz", "risiko", "gefahr"],
  ["automatisierung", "automatisieren", "workflow", "prozess", "pipeline", "n8n"],
  ["zeit", "effizienz", "produktivitaet", "schneller", "sparen", "zeitgewinn", "aufwand"],
  ["followup", "nachfassen", "dranbleiben", "wiedervorlage", "nachfrage", "erinnerung"],
  ["gespraech", "gespraechsfuehrung", "dialog", "kommunikation", "frage", "fragetechnik", "zuhoeren"],
  ["praesentation", "pitch", "vortrag", "demo", "folien", "slides"],
  ["karriere", "beruf", "job", "stelle", "stellensuche", "arbeitgeber", "anstellung", "arbeitsmarkt"],
  ["standortbestimmung", "bestandsaufnahme", "selbstbild", "staerke", "schwaeche", "potenzial", "profil"],
  ["vertrag", "arbeitsvertrag", "klausel", "konkurrenzverbot", "agb", "vertragspruefung", "kleingedruckte"],
  ["zeugnis", "arbeitszeugnis", "referenz", "qualifikation", "codes"],
  ["vorstellungsgespraech", "interview", "bewerbungsgespraech", "jobinterview"],
  ["verhandlung", "verhandeln", "kompromiss", "zugestaendnis", "poker"],
  ["vertrieb", "sales", "verkauf", "verkaufen", "verkaeufer", "aussendienst"],
  ["crm", "salesforce", "hubspot", "kundendatenbank", "pipeline"],
  ["website", "webseite", "homepage", "internetseite", "firmenseite"],
  ["seo", "sichtbarkeit", "google", "suchmaschine", "geo", "auffindbarkeit"],
  ["text", "texten", "schreiben", "formulierung", "stil", "sprache", "ton", "tonalitaet", "wording"],
  ["fehler", "problem", "schmerz", "engpass", "hindernis", "stolperstein"],
  ["video", "youtube", "aufnahme", "screencast", "tutorial"],
  ["schweiz", "schweizer", "deutschschweiz", "ostschweiz", "kmu", "swiss"],
  ["motivation", "antreiber", "haltung", "mindset", "disziplin", "gewohnheit"],
  ["team", "mitarbeiter", "fuehrung", "mitarbeitende", "kollege"],
  ["excel", "tabelle", "liste", "daten", "auswertung"],
  ["widerspruch", "kritik", "gegenargument", "gegenposition", "devilsadvocate"]
];

const SYNONYME = (() => {
  const map = new Map();
  for (const klasse of SYNONYM_KLASSEN) {
    const stems = klasse.map((w) => stem(norm(w)));
    for (const s of stems) {
      if (!map.has(s)) map.set(s, new Set());
      for (const anderer of stems) if (anderer !== s) map.get(s).add(anderer);
    }
  }
  return map;
})();

function tokens(s) {
  const out = [];
  for (const w of norm(s).split(" ")) {
    if (w.length < 2) continue;
    out.push(stem(w));
  }
  return out;
}

/** true, wenn die Levenshtein-Distanz <= 1 ist (Tippfehler-Toleranz). */
function distanz1(a, b) {
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0, j = 0, fehler = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++fehler > 1) return false;
    if (la === lb) { i++; j++; }
    else if (la > lb) i++;
    else j++;
  }
  if (i < la || j < lb) fehler++;
  return fehler <= 1;
}

const GEWICHT = { titel: 6, tags: 4, slug: 2, beschreibung: 2, cluster: 1.5, volltext: 0.5 };
const FUZZY_FELDER = { titel: true, tags: true, beschreibung: true, slug: false, cluster: false };
const Q_EXAKT = 1, Q_PRAEFIX = 0.7, Q_REV = 0.6, Q_FUZZY = 0.5, SYN_FAKTOR = 0.7;
// Schwellen: MIN_VOLL = alle Suchbegriffe getroffen, MIN_TEIL = nur ein Teil (braucht dann Titel-Niveau),
// MIN_VOLLTEXT = Treffer, die erst über llms-full.txt dazukommen. REL = relativ zum Bestwert.
const MIN_VOLL = 2.0, MIN_TEIL = 3.0, MIN_VOLLTEXT = 0.5, MIN_TEIL_VOLLTEXT = 1.5, REL_SCORE = 0.22;

function feldIndex(mod) {
  const mk = (s) => {
    const arr = [...new Set(tokens(s))];
    return { set: new Set(arr), arr };
  };
  return {
    titel: mk(mod.titel),
    tags: mk((mod.tags || []).join(" ")),
    slug: mk(mod.slug.replace(/-/g, " ")),
    beschreibung: mk(mod.beschreibung),
    cluster: mk(mod.cluster)
  };
}

/** Beste Trefferqualität einer Term-Gruppe in einem Feld (0 = kein Treffer). */
function feldQualitaet(feld, gruppe, fuzzyErlaubt) {
  if (feld.set.has(gruppe.stem)) return Q_EXAKT;
  for (const syn of gruppe.syn) if (feld.set.has(syn)) return Q_EXAKT * SYN_FAKTOR;
  if (!feld.arr.length) return 0;
  const q = gruppe.stem;
  if (q.length >= 4) {
    for (const t of feld.arr) if (t.length >= 4 && t.startsWith(q)) return Q_PRAEFIX;
    for (const t of feld.arr) if (t.length >= 4 && q.startsWith(t)) return Q_REV;
  }
  if (fuzzyErlaubt && q.length >= 6) {
    for (const t of feld.arr) if (t.length >= 5 && distanz1(q, t)) return Q_FUZZY;
  }
  return 0;
}

/** Suchbegriff → Term-Gruppen (Primärstamm + Synonymstämme), Stoppwörter raus. */
function queryGruppen(suchbegriff) {
  // Nur Stoppwörter («wie geht das?») ergeben keine Suche — toolSuchen meldet das als Fehler
  const basis = tokens(suchbegriff).filter((t) => !STOPP.has(t));
  const gesehen = new Set();
  const gruppen = [];
  for (const t of basis) {
    if (gesehen.has(t)) continue;
    gesehen.add(t);
    gruppen.push({ stem: t, syn: [...(SYNONYME.get(t) || [])] });
  }
  return gruppen;
}

const FELD_REIHE = ["titel", "tags", "slug", "beschreibung", "cluster"];

function sucheKeyword(module, gruppen, idx) {
  const ergebnisse = new Map();
  for (let i = 0; i < module.length; i++) {
    const felder = idx[i];
    let summe = 0;
    const getroffen = new Set();
    for (let gi = 0; gi < gruppen.length; gi++) {
      let termScore = 0;
      for (const feldName of FELD_REIHE) {
        const q = feldQualitaet(felder[feldName], gruppen[gi], FUZZY_FELDER[feldName]);
        if (q > 0) termScore += GEWICHT[feldName] * q;
      }
      if (termScore > 0) { summe += termScore; getroffen.add(gi); }
    }
    if (!getroffen.size) continue;
    ergebnisse.set(module[i].slug, { mod: module[i], roh: summe, getroffen, keyword: true });
  }
  return ergebnisse;
}

/* --- Volltext-Stufe: nur als Auffangnetz, wenn die Keyword-Stufe zu wenig findet. --- */

const ANKER = "URL: https://www.latzerus.ch/lernen/";

/** Zeichen-Positionen der Modul-Anker in llms-full.txt, aufsteigend. Billig (nur indexOf). */
function volltextAnker(full) {
  const anker = [];
  let p = full.indexOf(ANKER);
  while (p >= 0) {
    const schluss = full.indexOf("/", p + ANKER.length);
    if (schluss > 0 && schluss - p - ANKER.length <= 120) {
      anker.push({ pos: p, slug: full.slice(p + ANKER.length, schluss).toLowerCase() });
    }
    p = full.indexOf(ANKER, p + ANKER.length);
  }
  return anker;
}

function ankerFuer(anker, pos) {
  let lo = 0, hi = anker.length - 1, gefunden = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (anker[mid].pos <= pos) { gefunden = anker[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  return gefunden;
}

/** Oberflächenformen eines ASCII-Stamms (ae/oe/ue zurück zu Umlauten, erster Buchstabe gross). */
function suchformen(stamm) {
  const formen = new Set([stamm]);
  const umlaut = stamm.replace(/ae/g, "ä").replace(/oe/g, "ö").replace(/ue/g, "ü");
  if (umlaut !== stamm) formen.add(umlaut);
  for (const f of [...formen]) formen.add(f.charAt(0).toUpperCase() + f.slice(1));
  return [...formen];
}

const WORTZEICHEN = /[a-zäöüßA-ZÄÖÜ0-9]/;

function sucheVolltext(full, gruppen, ergebnisse, module) {
  const anker = volltextAnker(full);
  if (!anker.length) return;
  const bekannt = new Map(module.map((m) => [m.slug, m]));
  for (let gi = 0; gi < gruppen.length; gi++) {
    const stamm = gruppen[gi].stem;
    if (stamm.length < 4) continue;
    const slugs = new Set();
    for (const form of suchformen(stamm)) {
      let p = full.indexOf(form), zaehler = 0;
      while (p >= 0 && zaehler < 60) {
        // nur Wortanfänge zählen («kund» soll nicht in «Sekunde» treffen)
        if (p === 0 || !WORTZEICHEN.test(full[p - 1])) {
          const a = ankerFuer(anker, p);
          if (a) slugs.add(a.slug);
          zaehler++;
        }
        p = full.indexOf(form, p + form.length);
      }
    }
    for (const slug of slugs) {
      const mod = bekannt.get(slug);
      if (!mod) continue;
      const e = ergebnisse.get(slug);
      if (e) { e.roh += GEWICHT.volltext; e.getroffen.add(gi); }
      else ergebnisse.set(slug, { mod, roh: GEWICHT.volltext, getroffen: new Set([gi]), keyword: false });
    }
  }
  // Volltext-Treffer ohne Keyword-Basis müssen ALLE Suchbegriffe enthalten, sonst Rauschen
  if (gruppen.length > 1) {
    for (const [slug, e] of ergebnisse) {
      if (!e.keyword && e.getroffen.size < gruppen.length) ergebnisse.delete(slug);
    }
  }
}

/**
 * Score = Summe der Feldtreffer × Deckungsfaktor (wie viele Suchbegriffe getroffen haben).
 * Schwelle: minTeil, oder minVoll wenn ALLE Suchbegriffe im Modul vorkommen — plus relative
 * Schwelle gegen den Bestwert, damit der schwache Rest unter einem klaren Treffer wegfällt.
 */
function bewerten(ergebnisse, gruppenAnzahl, limit, minTeil, minVoll) {
  const liste = [...ergebnisse.values()].map((e) => ({
    mod: e.mod,
    voll: e.getroffen.size >= gruppenAnzahl,
    score: e.roh * (0.4 + 0.6 * (e.getroffen.size / gruppenAnzahl))
  }));
  if (!liste.length) return [];
  liste.sort((a, b) => b.score - a.score);
  const relativ = liste[0].score * REL_SCORE;
  return liste
    .filter((e) => e.score >= Math.max(e.voll ? minVoll : minTeil, relativ))
    .slice(0, limit);
}

/** Vollständige Suche — von toolSuchen und vom Eval-Skript benutzt. */
async function sucheDurchfuehren(module, felder, frage, limit, vollLader) {
  const gruppen = queryGruppen(frage);
  if (!gruppen.length) return { gruppen, treffer: [] };
  const ergebnisse = sucheKeyword(module, gruppen, felder);
  let treffer = bewerten(ergebnisse, gruppen.length, limit, MIN_TEIL, MIN_VOLL);
  if (treffer.length < 3 && vollLader) {
    try {
      const full = await vollLader();
      if (full) {
        sucheVolltext(full, gruppen, ergebnisse, module);
        // in der Auffang-Stufe bewusst lockerer — sonst fällt der einzige halbe Treffer raus
        treffer = bewerten(ergebnisse, gruppen.length, limit, MIN_TEIL_VOLLTEXT, MIN_VOLLTEXT);
      }
    } catch (e) {
      /* Volltext ist Kür — das Keyword-Ergebnis bleibt gültig */
    }
  }
  return { gruppen, treffer };
}

/* ---------------- Index-Cache pro Isolate ---------------- */

const INDEX_CACHE = { stand: 0, quelle: "", module: null, felder: null };
const CACHE_MS = 10 * 60 * 1000;

async function holeIndex() {
  const roh = await fetchText("/llms.txt");
  const schluessel = roh.length + "|" + roh.slice(0, 80);
  const jetzt = Date.now();
  if (INDEX_CACHE.module && INDEX_CACHE.quelle === schluessel && jetzt - INDEX_CACHE.stand < CACHE_MS) {
    return INDEX_CACHE;
  }
  const module = parseIndex(roh);
  INDEX_CACHE.module = module;
  INDEX_CACHE.felder = module.map(feldIndex);
  INDEX_CACHE.quelle = schluessel;
  INDEX_CACHE.stand = jetzt;
  return INDEX_CACHE;
}

/* ---------------- Tool-Implementierungen ---------------- */

async function toolSuchen({ suchbegriff, maxTreffer }) {
  const limit = Math.min(Math.max(Number(maxTreffer) || 8, 1), 20);
  const begriff = String(suchbegriff || "").trim();
  const gruppen = queryGruppen(begriff);
  if (!gruppen.length) {
    return {
      text: "Bitte einen Suchbegriff angeben, z.B. «Kunde will billiger» oder «Ollama offline».",
      isError: true,
      structured: { suchbegriff: begriff, anzahl: 0, treffer: [] }
    };
  }

  const { module, felder } = await holeIndex();
  // Auffangnetz bei zu wenig Treffern: Volltext (llms-full.txt) mit Gewicht 0.5 dazunehmen
  const { treffer } = await sucheDurchfuehren(module, felder, begriff, limit, () => fetchText("/llms-full.txt"));

  const structured = {
    suchbegriff: begriff,
    anzahl: treffer.length,
    treffer: treffer.map((t) => ({
      slug: t.mod.slug,
      titel: t.mod.titel,
      cluster: t.mod.cluster,
      url: t.mod.url,
      score: Math.round(t.score * 10) / 10,
      beschreibung: t.mod.beschreibung.length > 300 ? t.mod.beschreibung.slice(0, 300) + "…" : t.mod.beschreibung
    }))
  };

  if (!treffer.length) {
    return {
      text:
        `Keine Module zu «${begriff}» gefunden. Latzerus deckt Vertrieb & Kommunikation, KI im Arbeitsalltag, ` +
        `Karriere-Werkstatt und Wilde Themen ab — lernmodule_uebersicht zeigt alle Themen.`,
      isError: true,
      structured
    };
  }

  const text = structured.treffer
    .map((t, i) => `${i + 1}. ${t.titel}\n   Cluster: ${t.cluster} | Slug: ${t.slug}\n   ${t.url}\n   ${t.beschreibung}`)
    .join("\n\n");
  return { text, structured };
}

async function toolLesen({ slug }) {
  const clean = String(slug || "")
    .trim()
    .replace(/^https?:\/\/(www\.)?latzerus\.ch/, "")
    .replace(/^\/?lernen\//, "")
    .replace(/\/+$/, "")
    .toLowerCase();
  if (!clean) return { text: "Bitte einen Slug angeben, z.B. 'preis-anker-ohne-zittern'.", isError: true };
  const [full, { module }] = await Promise.all([fetchText("/llms-full.txt"), holeIndex()]);
  const text = zerlegeVolltext(full, module).get(clean);
  if (text) return text;
  // Fallback: Index nach ähnlichem Slug durchsuchen
  const aehnlich = module.filter((m) => m.slug.includes(clean) || clean.includes(m.slug)).slice(0, 5);
  if (aehnlich.length) {
    return {
      text:
        `Kein Modul mit Slug «${clean}» gefunden. Meintest du:\n` +
        aehnlich.map((m) => `- ${m.titel} (Slug: ${m.slug})`).join("\n"),
      isError: true
    };
  }
  return {
    text: `Kein Modul mit Slug «${clean}» gefunden. Nutze lernmodule_suchen oder lernmodule_uebersicht.`,
    isError: true
  };
}

async function toolUebersicht({ cluster } = {}) {
  const { module } = await holeIndex();
  const gruppen = new Map();
  for (const mod of module) {
    if (!gruppen.has(mod.cluster)) gruppen.set(mod.cluster, []);
    gruppen.get(mod.cluster).push(mod);
  }
  const wunsch = norm(String(cluster || ""));
  let ausgewaehlt = [...gruppen.keys()];
  if (wunsch) {
    const passend = ausgewaehlt.filter((c) => norm(c).includes(wunsch) || wunsch.includes(norm(c)));
    if (!passend.length) {
      return {
        text:
          `Kein Cluster «${cluster}». Verfügbar: ${ausgewaehlt.join(" · ")}. ` +
          `Ohne Parameter listet das Tool alle Module.`,
        isError: true
      };
    }
    ausgewaehlt = passend;
  }
  const anzahl = ausgewaehlt.reduce((s, c) => s + gruppen.get(c).length, 0);
  const teile = [
    wunsch
      ? `Lernbereich latzerus.ch — ${anzahl} Module in ${ausgewaehlt.join(" · ")} (von ${module.length} insgesamt):\n`
      : `Lernbereich latzerus.ch — ${module.length} kostenlose 5-Minuten-Module:\n`
  ];
  for (const c of ausgewaehlt) {
    const mods = gruppen.get(c);
    teile.push(`## ${c} (${mods.length} Module)`);
    teile.push(mods.map((m) => `- ${m.titel} — ${m.url}`).join("\n"));
    teile.push("");
  }
  if (!wunsch) {
    teile.push("Nur ein Thema nötig? lernmodule_uebersicht mit Parameter «cluster» spart Tokens.");
  }
  teile.push("Volltext eines Moduls: Tool lernmodul_lesen mit dem Slug aus der URL.");
  return teile.join("\n");
}

async function toolUeber() {
  const llms = await fetchText("/llms.txt");
  const kopf = llms.split(/^##\s+Lernbereich/m)[0].trim();
  return (
    kopf +
    "\n\nLernbereich mit allen Modulen: https://www.latzerus.ch/lernen/\n" +
    "Kontakt: https://www.latzerus.ch/contact/"
  );
}

const TOOL_HANDLERS = {
  lernmodule_suchen: toolSuchen,
  lernmodul_lesen: toolLesen,
  lernmodule_uebersicht: toolUebersicht,
  ueber_latzerus: toolUeber
};

/* ---------------- JSON-RPC / MCP ---------------- */

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}
function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function handleMessage(msg) {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return rpcError(msg && msg.id !== undefined ? msg.id : null, -32600, "Ungültige JSON-RPC-Anfrage");
  }
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;

  switch (method) {
    case "initialize":
      return rpcResult(id, {
        protocolVersion: (params && params.protocolVersion) || "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS
      });
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: TOOLS });
    case "tools/call": {
      const name = params && params.name;
      const handler = TOOL_HANDLERS[name];
      if (!handler) return rpcError(id, -32602, `Unbekanntes Tool: ${name}`);
      try {
        const roh = await handler((params && params.arguments) || {});
        const antwort = typeof roh === "string" ? { text: roh } : roh;
        const result = { content: [{ type: "text", text: antwort.text }], isError: !!antwort.isError };
        if (antwort.structured) result.structuredContent = antwort.structured;
        return rpcResult(id, result);
      } catch (e) {
        return rpcResult(id, { content: [{ type: "text", text: `Fehler: ${e.message}` }], isError: true });
      }
    }
    default:
      if (isNotification || method.startsWith("notifications/")) return null; // Notifications: keine Antwort
      return rpcError(id, -32601, `Methode nicht unterstützt: ${method}`);
  }
}

/* ---------------- HTTP ---------------- */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id"
};

const INFO_HTML = `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Latzerus MCP-Server</title>
<style>body{background:#0d1117;color:#e6edf3;font-family:system-ui,sans-serif;max-width:640px;margin:8vh auto;padding:0 20px;line-height:1.6}
h1{color:#e0a93a}code{background:#161b22;padding:2px 6px;border-radius:4px}a{color:#e0a93a}</style></head><body>
<h1>Latzerus MCP-Server</h1>
<p>Dieser Server macht die kostenlosen Lernmodule von <a href="https://www.latzerus.ch">latzerus.ch</a>
für KI-Assistenten wie Claude oder ChatGPT direkt durchsuchbar.</p>
<p><strong>So verbindest du dich:</strong> Füge in deinem KI-Client einen Custom Connector / MCP-Server hinzu mit der URL:</p>
<p><code>https://mcp.latzerus.ch/mcp</code></p>
<p>Verfügbare Werkzeuge: Modul-Suche, Volltext-Lesen, Themen-Übersicht, Infos zum Projekt.</p>
<p>Ein Wissensprojekt von Christoph Latzer — Sales &amp; KI-Strategien, die in 5 Minuten verstanden werden.
<a href="https://www.latzerus.ch/contact/">Kontakt</a></p>
</body></html>`;

/* ---------------- MCP-Discovery (server.json, SEP-1649) ----------------
 * Offizieller Discovery-Weg: /.well-known/mcp/server.json
 * Die MCP Registry (modelcontextprotocol.io/registry) kann den Server
 * darüber automatisch finden. Format nach server.json-Schema 2025-12-11.
 */
const SERVER_JSON = {
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "ch.latzerus/lernbereich",
  "title": "Latzerus Lernbereich",
  "description":
    "Latzerus (CH): 100+ kostenlose 5-Minuten-Lernmodule zu Vertrieb, KI und Karriere.",
  "version": SERVER_INFO.version,
  "websiteUrl": "https://www.latzerus.ch",
  "remotes": [
    {
      "type": "streamable-http",
      "url": "https://mcp.latzerus.ch/mcp"
    }
  ]
};

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    // Info-Seite für Menschen
    if (url.pathname === "/" || url.pathname === "") {
      return new Response(INFO_HTML, { headers: { "Content-Type": "text/html; charset=utf-8", ...CORS } });
    }

    // MCP-Discovery für Registry & Clients
    if (url.pathname === "/.well-known/mcp/server.json") {
      return new Response(JSON.stringify(SERVER_JSON, null, 2), {
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=3600", ...CORS }
      });
    }

    if (url.pathname !== "/mcp") {
      return new Response("Not found. MCP-Endpoint: /mcp", { status: 404, headers: CORS });
    }

    if (request.method === "DELETE") return new Response(null, { status: 200, headers: CORS }); // stateless
    if (request.method === "GET") {
      return new Response("Method not allowed (stateless MCP-Server, nur POST).", {
        status: 405,
        headers: { Allow: "POST, DELETE, OPTIONS", ...CORS }
      });
    }
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "POST", ...CORS } });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json(rpcError(null, -32700, "Ungültiges JSON"), { status: 400, headers: CORS });
    }

    const messages = Array.isArray(body) ? body : [body];
    const antworten = (await Promise.all(messages.map(handleMessage))).filter((a) => a !== null);

    if (!antworten.length) return new Response(null, { status: 202, headers: CORS }); // nur Notifications

    const payload = Array.isArray(body) ? antworten : antworten[0];
    return Response.json(payload, { headers: { "Content-Type": "application/json", ...CORS } });
  }
};

/* Nur für das lokale Eval-Skript (mcp-eval.mjs) — im Worker ohne Wirkung. */
export { parseIndex, feldIndex, queryGruppen, sucheDurchfuehren, norm, stem };
