/**
 * Latzerus MCP Server — Cloudflare Worker
 * =======================================
 * Serves the free learning modules of latzerus.ch to AI assistants over the
 * Model Context Protocol (Streamable HTTP, stateless, no authentication).
 *
 *   Endpoint     https://mcp.latzerus.ch/mcp
 *   Discovery    https://mcp.latzerus.ch/.well-known/mcp/server.json
 *   Registry     ch.latzerus/lernbereich
 *   Setup guide  https://www.latzerus.ch/mcp/
 *
 * Tools: lernmodule_suchen · lernmodul_lesen · lernmodule_uebersicht · ueber_latzerus
 *
 * Data sources, read live and cached 1 h at the edge:
 *   /llms.txt       index — title, URL, summary and cluster per module
 *   /llms-full.txt  the full texts
 * No database, no build step, no dependencies: paste this file into the
 * Cloudflare dashboard and hit Deploy.
 *
 * Search: query and index are normalised the same way (umlauts, stemming), matched by
 * exact token, prefix and one-edit typo tolerance, expanded through 49 synonym classes,
 * then scored per field (title 6 / tags 4 / slug 2 / summary 2 / cluster 1.5 / full text 0.5),
 * damped by title document frequency (a word in 12 titles counts 0.38, a word in one title 0.91),
 * with a coverage factor and a relevance threshold. Full texts join in only when the
 * keyword pass finds fewer than three modules, and add at most three modules of their own —
 * Cloudflare's free plan allows 10 ms CPU per request, and the parsed index is cached per
 * isolate for 10 minutes.
 *
 * Before deploying (Node 22+, from this folder):
 *   node mcp-eval.mjs           40 search cases against the live index
 *   node mcp-smoke.mjs          handshake, protocol negotiation, all four tools, error codes, edge cases
 *   node mcp-eval.mjs --live    the same 40 cases against the deployed server
 *
 * Version history: CHANGELOG.md · MIT licensed, see LICENSE.
 * Code comments are in German, like the content this server serves.
 * Content © Christoph Latzer — https://www.latzerus.ch/
 */

const SITE = "https://www.latzerus.ch";
const ICON_BASE = "https://mcp.latzerus.ch/icons/";
const ICONS = [
  { src: ICON_BASE + "latzerus-96-light.png", mimeType: "image/png", sizes: ["96x96"], theme: "light" },
  { src: ICON_BASE + "latzerus-256-light.png", mimeType: "image/png", sizes: ["256x256"], theme: "light" },
  { src: ICON_BASE + "latzerus-96-dark.png", mimeType: "image/png", sizes: ["96x96"], theme: "dark" },
  { src: ICON_BASE + "latzerus-256-dark.png", mimeType: "image/png", sizes: ["256x256"], theme: "dark" }
];
const SERVER_INFO = {
  name: "latzerus-mcp",
  title: "Latzerus Lernbereich",
  version: "1.1.0",
  websiteUrl: "https://www.latzerus.ch/mcp/",
  icons: ICONS
};
const INSTRUCTIONS =
  "MCP-Server von Latzerus (Christoph Latzer, latzerus.ch) — Wissensprojekt aus der Ostschweiz, Hilfe zur Selbsthilfe. " +
  "Über 150 kostenlose 5-Minuten-Lernmodule zu Vertrieb & Kommunikation, KI im Arbeitsalltag, Karriere-Werkstatt und Wilde Themen. " +
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
    },
    hinweis: { type: "string", description: "Nur bei 0 Treffern: was der Lernbereich abdeckt und wie es weitergeht" }
  },
  required: ["suchbegriff", "anzahl", "treffer"]
};

/* Alle vier Tools lesen nur öffentliche Inhalte von latzerus.ch: nichts wird verändert,
 * ein wiederholter Aufruf hat keine Nebenwirkung, und es gibt keine Verbindung nach aussen. */
const NUR_LESEN = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const TOOLS = [
  {
    name: "lernmodule_suchen",
    title: "Lernmodule durchsuchen",
    annotations: { title: "Lernmodule durchsuchen", ...NUR_LESEN },
    description:
      "Durchsucht alle kostenlosen Lernmodule von latzerus.ch (Vertrieb, Kommunikation, KI im Arbeitsalltag, Karriere) " +
      "nach Stichworten. Versteht Umschreibungen, Synonyme, Ein- und Mehrzahl sowie Tippfehler — es braucht nicht das " +
      "exakte Titel-Vokabular; «Kunde will billiger» oder «Einwandbehandlung» funktionieren. " +
      "Liefert Titel, Cluster, URL und Kurzbeschreibung der besten Treffer. Die Module sind auf Deutsch: " +
      "Suchbegriffe auf Deutsch angeben, auch wenn die Frage in einer anderen Sprache gestellt wurde.",
    inputSchema: {
      type: "object",
      properties: {
        suchbegriff: { type: "string", description: "Stichworte oder eine Frage auf Deutsch, z.B. 'Kunde will billiger' oder 'ChatGPT Follow-up'" },
        maxTreffer: { type: "number", description: "Maximale Trefferzahl (Standard 8, max. 20)" }
      },
      required: ["suchbegriff"]
    },
    outputSchema: TREFFER_SCHEMA
  },
  {
    name: "lernmodul_lesen",
    title: "Lernmodul im Volltext lesen",
    annotations: { title: "Lernmodul im Volltext lesen", ...NUR_LESEN },
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
    annotations: { title: "Alle Lernmodule nach Cluster", ...NUR_LESEN },
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
    annotations: { title: "Über Latzerus", ...NUR_LESEN },
    description:
      "Infos über Latzerus: das Wissensprojekt von Christoph Latzer, die vier Themen, Herkunft, eingesetzte KI-Tools und Kontakt.",
    inputSchema: { type: "object", properties: {} }
  }
];

/* ---------------- Datenquellen ---------------- */

async function fetchText(path) {
  const res = await fetch(SITE + path, {
    cf: { cacheTtlByStatus: { "200-299": 3600, "400-599": 0 }, cacheEverything: true }, // Fehler nie cachen (2026-09-25: 403 hing 1 h im Edge-Cache)
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
 * Volltext (llms-full.txt) kommt nur dazu, wenn die Keyword-Stufe zu wenig findet.
 * Search tuning (2026-09-18, gleicher Tag): Dokumentfrequenz-Dämpfung über die Titel («Kunde» steht
 * in 12 Titeln und hob allein Module über die Schwelle), vier Synonym-Klassen für Satz-Fragen,
 * Volltext-Auffangnetz enger (Schwelle 1.5, höchstens 3 reine Volltext-Treffer),
 * Präfix vorwärts erst ab 6 Zeichen. */

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
  ["followup", "nachfassen", "dranbleiben", "wiedervorlage", "nachfrage", "erinnerung",
   "zurueckrufen", "zurueckruft", "rueckruf", "melden", "meldet", "antwort"],
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
  ["widerspruch", "kritik", "gegenargument", "gegenposition", "devilsadvocate"],
  // Search tuning 2026-09-18: Klassen für Satz-Fragen, die am Titel-Vokabular vorbeigehen
  ["cross", "selling", "crossselling", "upselling", "upsell", "zusatzverkauf", "drei"], // → «aus einem Kunden drei»
  ["leitfaden", "gespraechsleitfaden", "skript", "script"],
  ["kundendaten", "personendaten", "datenschutz", "cloud", "daten"],
  ["firma", "unternehmen", "betrieb", "zielfirma", "organisation"]
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
const MIN_VOLL = 2.0, MIN_TEIL = 3.0, MIN_VOLLTEXT = 1.5, MIN_TEIL_VOLLTEXT = 1.5, REL_SCORE = 0.22;
// Treffer, die nur aus der Volltext-Stufe stammen (kein Keyword-Treffer), höchstens so viele:
const MAX_NUR_VOLLTEXT = 3;

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
  // Präfix vorwärts erst ab 6 Zeichen: «berei» (aus «bereite») darf nicht «bereinigst» treffen.
  // Rückwärts (Kompositum in der Frage, Grundwort im Titel: «Preisgespräch» → «Preis») ab 4.
  if (q.length >= 6) {
    for (const t of feld.arr) if (t.length >= 4 && t.startsWith(q)) return Q_PRAEFIX;
  }
  if (q.length >= 4) {
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

/* --- Dokumentfrequenz-Dämpfung: in wie vielen Modul-TITELN kommt ein Stamm vor? ---
 * «Kunde» steht in 12 Titeln und darf allein kein Modul über die Schwelle heben, «Kaufsignal»
 * (1 Titel) bleibt praktisch ungedämpft. Nur Titel zählen, nicht der Volltext.
 * Gecacht pro Feldindex (WeakMap) — holeIndex und das Eval-Skript bauen den Index selbst. */
const DF_CACHE = new WeakMap();

function titelDf(idx) {
  let df = DF_CACHE.get(idx);
  if (df) return df;
  df = new Map();
  for (const felder of idx) {
    for (const t of felder.titel.set) df.set(t, (df.get(t) || 0) + 1);
  }
  DF_CACHE.set(idx, df);
  return df;
}

/** Dämpfungsfaktor eines Query-Stamms: 1 / ln(2 + df); df 1 → 0.91, df 12 → 0.38; df 0 → 1 (nie über 1). */
function dfFaktor(stamm, df) {
  return Math.min(1, 1 / Math.log(2 + (df.get(stamm) || 0)));
}

function sucheKeyword(module, gruppen, idx) {
  const ergebnisse = new Map();
  const df = titelDf(idx);
  const faktor = gruppen.map((g) => dfFaktor(g.stem, df));
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
      if (termScore > 0) { summe += termScore * faktor[gi]; getroffen.add(gi); }
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
    keyword: e.keyword,
    voll: e.getroffen.size >= gruppenAnzahl,
    score: e.roh * (0.4 + 0.6 * (e.getroffen.size / gruppenAnzahl))
  }));
  if (!liste.length) return [];
  liste.sort((a, b) => b.score - a.score);
  const relativ = liste[0].score * REL_SCORE;
  // Reine Volltext-Treffer (ohne Keyword-Basis) sind Auffangnetz, kein Ranking — höchstens MAX_NUR_VOLLTEXT
  let nurVolltext = 0;
  return liste
    .filter((e) => e.score >= Math.max(e.voll ? minVoll : minTeil, relativ))
    .filter((e) => e.keyword || ++nurVolltext <= MAX_NUR_VOLLTEXT)
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
  titelDf(INDEX_CACHE.felder); // Dokumentfrequenz gleich mitbauen, nicht erst in der ersten Suche
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
    // 0 Treffer ist ein gültiges Ergebnis, kein Fehler (seit 1.1.0)
    structured.hinweis =
      `Keine Module zu «${begriff}» gefunden. Latzerus deckt Vertrieb & Kommunikation, KI im Arbeitsalltag, ` +
      `Karriere-Werkstatt und Wilde Themen ab — lernmodule_uebersicht zeigt alle Themen.`;
    return { text: structured.hinweis, structured };
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

// Protokoll-Verhandlung: kennt der Server die angefragte Version, antwortet er mit ihr — sonst mit der neuesten.
const PROTOKOLL_VERSIONEN = ["2025-06-18", "2025-03-26", "2024-11-05"];
const PROTOKOLL_STANDARD = PROTOKOLL_VERSIONEN[0];

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
    case "initialize": {
      const gewuenscht = params && params.protocolVersion;
      return rpcResult(id, {
        protocolVersion: PROTOKOLL_VERSIONEN.includes(gewuenscht) ? gewuenscht : PROTOKOLL_STANDARD,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS
      });
    }
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
<a href="https://www.latzerus.ch/contact/">Kontakt</a> ·
<a href="https://www.latzerus.ch/datenschutz/#mcp-server">Datenschutz</a></p>
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
    "Latzerus (CH): 150+ kostenlose 5-Minuten-Lernmodule zu Vertrieb, KI und Karriere.",
  "version": SERVER_INFO.version,
  "websiteUrl": "https://www.latzerus.ch",
  "icons": ICONS,
  "remotes": [
    {
      "type": "streamable-http",
      "url": "https://mcp.latzerus.ch/mcp"
    }
  ]
};

/* Icons (PNG, Base64) — gleiche Domain wie der Server, wie es die MCP-Spezifikation empfiehlt */
const ICON_DATEIEN = {
  "latzerus-96-light.png": "iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAMAAADVRocKAAAAwFBMVEX+/v4Bel4DfGABgWTxqTgji3PX6uYdiXF2uKmUx7vvqDkVhmu52tOJwrXr9PJVppOp0sn+tDxirZw7mYPG4dv2zYxLoo5ssqLxsU0qkXlDnYgzlH2cy8DO5uDj8O386tDwrUSDvrCx1s6hzsTg7uv99utPpJBmsJ6Ava/B3tf2t1b86c3urkv30JQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA2RzWxAAADk0lEQVR42u1XaXOjMAwFqzZ2zVVgoUCSbdN7j///91a2DCQTdgpZ+mXHb9qSIaAn6elwg8DDw8PDw8PD479GnnFg0Wv+VfYzxkIEY9nX2H8EZhjwD8gvIejABoAUUJp87Ve9/fLtHL8vHylgSBFgjp7DkMsVHD/vznH7cvGIiMBYD0OIRBDEJlUsE0sJvt/cnuLmfuaZQxMZgujt2cXDQlgsBxLcTLi9eZh/TMQx+ZzqkBSBUmxJMEIaxTECzZiuNiYQKK2wgjNIuJGi2pRA1ocg6Ml+UeEVYxDbEShdpkZh1w62Nxj0SwjOMU+gIijw8g7Gb+iCmHoPU7WgD87s3z28zJjnoM2gS6hCm7G5MUnppxH8uJ/w6/7+x5x51qRUQGg+QqoDuFplsPvXQWTMF8JNDOwvSxWzcTqtG7Cq5hGv1am0oKU1f+gAzRNVoKbx160wX3EgEVvXtAmHzC2ZI0DYyqEqW2CwPoJUWw1NA3Frs2mO1nf8KRhv4unR/ceutVli8LRiLw5xI4cxRu7G/QFDSU46KhXVLjMqG1fKFRmKYZSODTMglUMOhCq6niMijWJY6+h/na6RuAbzminFwt3ZoSrW97hjqA/+EugDK1ecAioqdAvtRv2uRydtnUvSJuSZTJRBkiQqFyucPzKbTPEk32R+sB+xhDBZatz6eKaoru4mswbbkyoRuxrLMgS6V1Fx2bGzz9WjlE3TSERiwlnSyoI87GX+UVV5UvTMFBToZNDG6Plq2zocdRixgKAdjj3UZ3YkszZxFSKYKUk42kK+BP/cvnQN4NrMWNPFlLAn+lqcHJAm4FHg8wQxNr1n48jy9JIfCTi7iiCb/LJKqOeZ71mIJRRdRSCmt7DFynjeATs9rovg3QbgZFYzDzQjQXkVAb1F8s62vqLa2Z8lcwWBpqLE0mf1fA65qfba7bTVBPYoiGNR1Awe/9boSsXBtQROORwE6T5dlM21BOQWg0gexVSgJT9FFNnLhfllZQrUvXbg697tXe12wxnCqwiCqqUFRf+IAW1ZPjN1riXAlVtCaAOgcVQFsz01i0UEds7H+WNnxqY7iWxKsGsl7aod9TPflkDgPgGmO6NuZzIUmgPtdgRKUxUBFzSZ8eOGBKKmExRQFzeWQG+XIjWUTi3GybyhBqKz7uPhIT+ZBbhyNiJIBveb8VZvb5QbEYS26s/OQ1aDlRHwwMPDw8PDw8PD4wJ/AOJWLbhlYoAHAAAAAElFTkSuQmCC",
  "latzerus-256-light.png": "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",
  "latzerus-96-dark.png": "iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAMAAADVRocKAAAAwFBMVEUMERcAd1wAgWMAfWACa1TxqTgKJiUEV0YGRjsHOzMUFhjspTcDYk3ZmDQJMi3+tDyOZygFTkALHiBENR+SaSksJhw9MR5INyDIizEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADBm6GYAAACzUlEQVR42u1X2ZLiMAyMLeGDyXiGLHv8/5eubPkKhBo75XnZdT9AKLBaZ8ssy8TExMTExMTEPw2nUQjU7rvsawBBANBnTl8f8PwLI0WENN8UQCKA1edLdZ3+ef+scL9/PodwKxH4HFE1TDPHdfn9scfbM8GGkUEKMuwoECm0aiX4cXnb4f16lCSkClMblXikMO0El4K3yyHBsigCP+V0oRpJcNBSINRggo0MqtSvCE0MPQTGl2AF7iYFbTG0ExiBvtpc4TU9YHcXvSCwPAIm2VeycbSJ4ONS42gOFkuD4Ip9XQ/3lwS/3vf4cz0wD7fcQEwlcrPaLrHznw6857H1aZciUCnYiUc7rEZEbXe5F1F4VimyQlh5ikChlNTdkGfUoEhLxpH1onF4jkDIrAK8xm6uKDbeVC0cFptrUNKR3RLgjW1sy68Au9PnTVmdXFl7MvRAEKUn5oCM+gIRvF0uMnSWWMvHxPoWClxKC6oPyAh+EGtHfhTLAR80yTyVPNgwwNKD2hgb4N97VqcL23bZrLkZdkuZ0Cq2SDTovmW8859crfeHr6LMO4XHCkJcypHzhtxg+GBa7POtZzWO9pYztCB9FXOqQm1CXag5cx0SRAMBpqbgOZOBDpNQblx4mgkns0QU4Nf2yxZMXbq7NcT5ULWGdhGoZ+v2gF/lSHsJdB0AVcIef3+aYBeAXN0LB+A0wa4CRz13ywTrKQI+xS/2tQh6Ai3PELDuUuuLF9d/vyZkGINzBFHe1Pr6iqCMVctpAsxCoNqy2UsQ3ZJo6n8WKx5AiHNtWglF3rskpfCEcwS+iFDPsS2lb0GDFvnbQwwg70uEkQR8TzBRy0JHDiWwKfG2HBlIsGna4SC0KXo8lMCK1KZb1qWBBCpNAa9HJhiYoug+pAtDoINhBNl9dLUWhBvMCILkfvWXeixB+oF72C3DCCYmJiYmJiYm/mP8Bf5RHMSowhP6AAAAAElFTkSuQmCC",
  "latzerus-256-dark.png": "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"
};

/* Security-Header für jede Antwort (2026-11-01) — CORS bleibt unverändert */
const SECURITY_HEADERS = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=(), payment=(), usb=()",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
};

export default {
  async fetch(request) {
    const res = await antwort(request);
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }
};

async function antwort(request) {
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

    // Server-Icons
    if (url.pathname.startsWith("/icons/")) {
      const b64 = ICON_DATEIEN[url.pathname.slice(7)];
      if (!b64) return new Response("Not found", { status: 404, headers: CORS });
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      return new Response(bytes, {
        headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=604800", ...CORS }
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

    // Jede POST-Antwort trägt die Protokoll-Version, die der Server spricht (Streamable HTTP)
    const MCP_HEADER = { "MCP-Protocol-Version": PROTOKOLL_STANDARD, ...CORS };

    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json(rpcError(null, -32700, "Ungültiges JSON"), { status: 400, headers: MCP_HEADER });
    }

    const messages = Array.isArray(body) ? body : [body];
    const antworten = (await Promise.all(messages.map(handleMessage))).filter((a) => a !== null);

    if (!antworten.length) return new Response(null, { status: 202, headers: MCP_HEADER }); // nur Notifications

    const payload = Array.isArray(body) ? antworten : antworten[0];
    return Response.json(payload, { headers: { "Content-Type": "application/json", ...MCP_HEADER } });
}

/* Nur für das lokale Eval-Skript (mcp-eval.mjs) — im Worker ohne Wirkung. */
export { parseIndex, feldIndex, queryGruppen, sucheDurchfuehren, norm, stem };
