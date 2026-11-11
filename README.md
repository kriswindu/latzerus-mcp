<div align="center">

<img src="https://www.latzerus.ch/images/logo-header.png" alt="Latzerus" width="260">

# Latzerus MCP Server

**Swiss B2B sales and everyday-AI know-how — inside your AI assistant.**
150+ free 5-minute learning modules from [latzerus.ch](https://www.latzerus.ch), one endpoint, no account.

[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-ch.latzerus%2Flernbereich-e0a93a?style=flat-square)](https://registry.modelcontextprotocol.io/v0/servers?search=ch.latzerus)
[![Protocol](https://img.shields.io/badge/MCP-2025--06--18-0d1117?style=flat-square)](https://modelcontextprotocol.io)
[![Transport](https://img.shields.io/badge/transport-streamable%20HTTP-0d1117?style=flat-square)](https://modelcontextprotocol.io/docs/concepts/transports)
[![Auth](https://img.shields.io/badge/auth-none%20needed-22B566?style=flat-square)](#-privacy--safety)
[![Version](https://img.shields.io/badge/version-1.1.0-e0a93a?style=flat-square)](CHANGELOG.md)
[![Modules](https://img.shields.io/badge/modules-150%2B-3B82F6?style=flat-square)](https://www.latzerus.ch/lernen/)
[![Smithery](https://img.shields.io/badge/Smithery-cllatzi%2Flatzerus--mcp-8b5cf6?style=flat-square)](https://smithery.ai/servers/cllatzi/latzerus-mcp)
[![Glama](https://glama.ai/mcp/connectors/ch.latzerus/lernbereich/badges/score.svg)](https://glama.ai/mcp/connectors/ch.latzerus/lernbereich)
<!-- Offizielles Smithery-Badge — einsetzen, sobald smithery.ai/badge wieder ausliefert (liefert Stand 2026-09-18 HTTP 500):
[![smithery badge](https://smithery.ai/badge/cllatzi/latzerus-mcp)](https://smithery.ai/servers/cllatzi/latzerus-mcp) -->

```
https://mcp.latzerus.ch/mcp
```

</div>

---

## What this is

Latzerus is the knowledge project of **Christoph Latzer** (St. Gallen / Zurich, Switzerland): over
150 short, field-tested lessons on B2B selling, on using AI at work without handing your data away,
and on career positioning. *Smart not hard — help people help themselves.*

This server puts that library one question away. Ask your assistant *"how do I answer «too expensive»?"*
and it reads the actual module instead of guessing.

> 🇩🇪 The modules are written in German. The tools are named in German too — your assistant handles that.

**Free, read-only, no sign-up, no API key, no cookies.** It runs as a single Cloudflare Worker that reads
the site's public `llms.txt` and `llms-full.txt` — there is no database and no user data anywhere in it.

## 🛠 Tools

| Tool | What it does |
|---|---|
| `lernmodule_suchen` | Keyword search across all modules → title, cluster, URL, summary, relevance score. Understands synonyms, singular/plural and typos — you don't need the exact wording of a title. Returns `structuredContent`, so clients don't have to parse prose. |
| `lernmodul_lesen` | One module in full: key points, main part, practical steps, typical mistakes, FAQ. Takes the slug or the URL. |
| `lernmodule_uebersicht` | All modules grouped by theme. Optional `cluster` parameter to fetch just one theme and save tokens. |
| `ueber_latzerus` | Background on the project, the four themes, the tools used, and contact details. |

All four tools carry the annotations `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true` and
`openWorldHint: false`, so clients can run them without asking for confirmation each time. A search without
hits is a normal result (`isError: false`, `anzahl: 0`, plus a `hinweis` field), not an error.

The four themes: **Vertrieb & Kommunikation** · **KI im Arbeitsalltag** · **Karriere-Werkstatt** ·
**Wilde Themen** — 152 modules as of November 2026, one new module almost every day.

## 🎯 What people use it for

- **Cold calling & closing** — argumentation frameworks, objection handling («too expensive», «we already
  have a supplier», «I'll get back to you»), and how to ask for the order without begging for it.
- **AI without the data leak** — what belongs in a cloud model and what doesn't, GDPR/DSG-aware workflows,
  and setting up local models with Ollama, from «which machine do I need» to a RAG chatbot on your own handbook.
- **Career positioning** — honest self-assessment, reading job ads the way HR means them, and a USP that
  survives contact with reality. No buzzwords.

## 💬 Example prompts

Once connected, just ask. Mentioning «Latzerus» helps the assistant pick this server.

1. *«Ein Kunde sagt, wir sind zu teuer. Was rät Latzerus dazu? Nenn mir die Praxis-Schritte und die Quelle.»*
   → `lernmodule_suchen` finds the pricing modules, `lernmodul_lesen` reads the best one, the answer links it.
2. *«Welche Latzerus-Module gibt es zu lokaler KI mit Ollama? Liste sie mit Links auf.»*
   → `lernmodule_suchen`, or `lernmodule_uebersicht` with `cluster: "KI"` for the whole theme.
3. *«Lies das Latzerus-Modul zur Erstkontakt-Mail und mach mir aus den Praxis-Schritten eine Checkliste.»*
   → `lernmodul_lesen` on `die-erstkontakt-mail-auf-die-schweizer-ceos-antworten`.

You can ask in any language. The search itself works on German words; the tool description tells the
assistant to search in German (*«Rabatt»* finds three modules, *"discount"* none).

## 🚀 Connect it

### Claude Desktop / Claude.ai
Settings → **Connectors** → **Add custom connector** → Name `Latzerus`, URL `https://mcp.latzerus.ch/mcp`.
Leave OAuth client ID and secret empty.

### Claude Code
```bash
claude mcp add --transport http latzerus https://mcp.latzerus.ch/mcp
```

### Cursor — `.cursor/mcp.json`
```json
{
  "mcpServers": {
    "latzerus": {
      "url": "https://mcp.latzerus.ch/mcp"
    }
  }
}
```

### VS Code — `.vscode/mcp.json`
```json
{
  "servers": {
    "latzerus": {
      "type": "http",
      "url": "https://mcp.latzerus.ch/mcp"
    }
  }
}
```

### Smithery
```bash
npx -y smithery mcp add cllatzi/latzerus-mcp
```
The server is also listed on [Smithery](https://smithery.ai/servers/cllatzi/latzerus-mcp), which offers a
proxied endpoint (`https://latzerus-mcp--cllatzi.run.tools`) and a CLI to browse the tools:
`npx -y smithery tool list cllatzi/latzerus-mcp`.

### AnythingLLM, Open WebUI, LM Studio, ChatGPT
Step-by-step with copy-paste snippets: **[latzerus.ch/mcp](https://www.latzerus.ch/mcp/)**.
(AnythingLLM needs `"type": "streamable"`. The paths `/sse` and `/see` do not exist — the endpoint is `/mcp`.)

### Try it without a client
```bash
curl -s https://mcp.latzerus.ch/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"lernmodule_suchen","arguments":{"suchbegriff":"Kunde will billiger"}}}'
```

## ⚙️ How it works

```mermaid
flowchart LR
  A["AI client<br/>(Claude, ChatGPT, Cursor …)"] -->|JSON-RPC / HTTP POST| B["Cloudflare Worker<br/>stateless, no auth"]
  B -->|cached 1 h| C["latzerus.ch/llms.txt<br/>index"]
  B -->|cached 1 h| D["latzerus.ch/llms-full.txt<br/>full texts"]
```

The site publishes its own content as `llms.txt` and `llms-full.txt`; the worker parses those on the fly,
so a new module is searchable within about an hour (edge cache 1 h, isolate cache 10 min). Nothing is duplicated, nothing gets stale.

**Search, in short:** queries and index are normalised the same way (umlauts, stemming), matched by exact
token, prefix and a one-edit typo tolerance, expanded through 49 hand-kept synonym classes, then scored by
field — title counts six times as much as body text — damped by how many titles share a word (a word in
12 titles counts 0.38, a word in one title 0.91), with a coverage factor and a relevance threshold, so a weak
match disappears under a clear one. Full texts are only pulled in when the keyword pass finds too little,
and add at most three modules of their own. Typical search: **70–115 ms**.

Icons: `https://mcp.latzerus.ch/icons/latzerus-{96,256}-{light,dark}.png`, served by the worker itself
(same origin as the server, as the MCP spec recommends) and listed in `serverInfo.icons` and `server.json`.

Discovery: [`/.well-known/mcp/server.json`](https://mcp.latzerus.ch/.well-known/mcp/server.json) ·
listed in the official MCP Registry as **`ch.latzerus/lernbereich`**.

## 📦 This repository

| File | |
|---|---|
| `worker.js` | the whole server — one file, no dependencies, no build step. Paste it into the Cloudflare dashboard and deploy. |
| `mcp-eval.mjs` + `mcp-eval-set.json` | 40 search cases with expected results (`--live` runs them against the deployed server). Run before every deploy. |
| `mcp-smoke.mjs` | handshake, protocol negotiation, all four tools, error codes and edge cases — offline, against the worker file. |
| `mcp-volltext-check.mjs` | does every module have its anchor in `llms-full.txt`? |
| `mcp-lesen-check.mjs` | calls `lernmodul_lesen` for every slug and verifies it returns the right module. |
| `icons/` | the server icons as PNG files (the worker embeds the same files). |
| `CHANGELOG.md` | what changed and when. |

```bash
node mcp-eval.mjs          # search quality, local logic against the live index
node mcp-smoke.mjs         # protocol, tools, error handling
node mcp-eval.mjs --live   # same 40 cases against https://mcp.latzerus.ch/mcp
```

Requires Node 22+. No install, no dependencies.

## 🔒 Privacy Policy

Full policy (German): **[latzerus.ch/datenschutz/#mcp-server](https://www.latzerus.ch/datenschutz/#mcp-server)**. In short:

- **Data collection:** each call carries the tool name and its arguments (a search term, a slug). Nothing
  else. The server never sees your conversation, only what your assistant puts into a tool call.
- **Usage and storage:** the arguments are used to compute the answer and then discarded. No accounts,
  no cookies, no user profiles, no IP addresses, no logging of what you ask.
- **Third parties:** the worker runs on Cloudflare, Inc. (USA, certified under the Swiss-U.S. Data Privacy
  Framework), which processes technical connection data to operate the network. Nothing is sold or shared.
- **Retention:** none on my side. Cloudflare's technical logs follow Cloudflare's own retention.
- **Contact:** [latzerus.ch/contact](https://www.latzerus.ch/contact/) · kontakt@latzerus.ch

## 🛟 Support

Questions, bugs, a module you miss: [contact form](https://www.latzerus.ch/contact/) or
kontakt@latzerus.ch. Issues on this repository work too.

## 🛡 Safety

Read-only by design: the four tools return text, nothing else. No authentication, because there is nothing
to authenticate — every byte it serves is public on latzerus.ch anyway. It cannot touch anything on your
machine.

## 📜 License & attribution

The **content** of the learning modules belongs to Christoph Latzer. Reading, quoting and summarising it is
explicitly welcome — please name the source:

> Christoph Latzer, Latzerus — https://www.latzerus.ch/

The **code** in this repository is MIT licensed (see `LICENSE`). *Latzerus* is a registered Swiss trademark
(Swissreg CH 817140); the licence covers the code, not the name or the logo.

---

<div align="center">

**[latzerus.ch](https://www.latzerus.ch)** · [All modules](https://www.latzerus.ch/lernen/) ·
[Setup guide](https://www.latzerus.ch/mcp/) · [Contact](https://www.latzerus.ch/contact/)

<sub>A knowledge project from Eastern Switzerland. Smart not hard · Pareto · Help people help themselves · the 5-minute rule.</sub>

</div>
