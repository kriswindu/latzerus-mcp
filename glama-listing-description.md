**Swiss B2B sales and everyday-AI know-how — inside your AI assistant.**

113 free 5-minute learning modules from [latzerus.ch](https://www.latzerus.ch), served over one endpoint: `https://mcp.latzerus.ch/mcp`

Streamable HTTP · protocol 2025-06-18 · stateless · no account, no API key, no cookies.

Latzerus is the knowledge project of Christoph Latzer (St. Gallen / Zurich, Switzerland): short, field-tested lessons on B2B selling, on using AI at work without handing your data away, and on career positioning. *Smart not hard — help people help themselves.*

Ask your assistant *"how do I answer «too expensive»?"* and it reads the actual module instead of guessing.

*The modules are written in German, and so are the tool names — your assistant handles that.*

---

**FOUR TOOLS**

**`lernmodule_suchen`** — keyword search across all modules. Returns title, theme, URL, summary and a relevance score as `structuredContent`. It understands paraphrases, synonyms, singular/plural and typos, so you don't need the exact wording of a title.

**`lernmodul_lesen`** — one module in full: key points, main part, practical steps, typical mistakes, FAQ. Takes the slug or the URL.

**`lernmodule_uebersicht`** — all modules grouped by theme. Optional `cluster` parameter to fetch just one theme and save tokens.

**`ueber_latzerus`** — background on the project, the four themes, the tools used, and contact details.

*Themes: Vertrieb & Kommunikation (43) · KI im Arbeitsalltag (42) · Karriere-Werkstatt (21) · Wilde Themen (7)*

---

**WHAT PEOPLE USE IT FOR**

**Cold calling and closing** — argumentation frameworks, objection handling («too expensive», «we already have a supplier», «I'll get back to you»), and how to ask for the order without begging for it.

**AI without the data leak** — what belongs in a cloud model and what doesn't, GDPR/DSG-aware workflows, and local models with Ollama, from «which machine do I need» to a RAG chatbot on your own handbook.

**Career positioning** — honest self-assessment, reading job ads the way HR means them, and a USP that survives contact with reality. No buzzwords.

---

**HOW TO CONNECT**

**Claude Desktop** — Settings → Connectors → Add custom connector, paste the URL above, leave the OAuth fields empty.

**Cursor / VS Code** — one `url` entry in `mcp.json`.

**Everything else** — copy-paste snippets for ChatGPT, AnythingLLM, Open WebUI, LM Studio, Cursor and VS Code: [latzerus.ch/mcp](https://www.latzerus.ch/mcp/). AnythingLLM needs `"type": "streamable"`. The paths `/sse` and `/see` do not exist — the endpoint is `/mcp`.

---

**HOW IT WORKS**

A single Cloudflare Worker reads the site's public `llms.txt` and `llms-full.txt` and parses them on the fly, so a new module is searchable the moment it goes online. No database, no duplicated index, nothing that goes stale. Typical search: 70–115 ms.

Read-only by design — the four tools return text, nothing else. Nothing is logged, nothing is tracked, and every byte served is public on latzerus.ch anyway.

---

**SOURCE & LICENSE**

Worker source, test suite and changelog: [github.com/kriswindu/latzerus-mcp](https://github.com/kriswindu/latzerus-mcp) (MIT). In the official MCP Registry as `ch.latzerus/lernbereich`.

Quoting and summarising the modules is explicitly welcome — please name the source: *Christoph Latzer, Latzerus — https://www.latzerus.ch/*
