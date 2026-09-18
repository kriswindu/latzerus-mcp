# Changelog

The server reports its version in `initialize` and in `server.json`; that version is what the
MCP Registry lists. Dates are the deploy dates.

## Search overhaul — 2026-09-18 (server version stays 1.0.1)

The old search was a plain word match: «Stammkunden» found nothing because the title says
«Stammkunde», «Einwandbehandlung» found nothing because no title uses that word, and a typo
found nothing at all.

- Normalisation on both sides — lower case, umlauts to `ae`/`oe`/`ue`, `ß` to `ss`, punctuation out.
- Stemming, so singular and plural collapse to the same stem.
- Prefix matching in both directions, which catches German compounds.
- Typo tolerance: Levenshtein distance 1 for terms of six characters or more.
- 45 hand-kept synonym classes as query expansion — the index on the website stays untouched.
- Field weighting (title 6, tags 4, slug 2, summary 2, cluster 1.5, full text 0.5), a coverage
  factor for multi-word queries and a relevance threshold, so weak matches disappear under clear ones.
- Full texts from `llms-full.txt` are pulled in only when the keyword pass finds fewer than three
  modules; matches without a keyword basis must contain every search term.
- The parsed index is cached per isolate for 10 minutes — warm requests need about 1 ms CPU.
- «Nothing found» now returns `isError: true`, so a client can tell a miss from a hit.
- `lernmodule_suchen` gained `outputSchema` and returns `structuredContent`.
- `lernmodule_uebersicht` gained an optional `cluster` parameter.

Regression suite: `mcp-eval.mjs` with 34 cases, plus two documented limits of a word-based search.

## 1.0.1 — 2026-09-11

- Latzerus is a knowledge project, not a consultancy: server instructions, `ueber_latzerus`,
  the info page and `server.json` no longer mention coaching, appointments or strategy calls.
- `parseIndex` counted the four theme links from the «## Themen» section of `llms.txt` as modules,
  which produced an empty cluster in the overview. Only entries under a `###` cluster heading count now.

## 1.0.0 — 2026-09-01

First public release, listed in the MCP Registry as `ch.latzerus/lernbereich`.

Two bugs found and fixed the same week:

- `lernmodul_lesen` returned the wrong module for 15 of 107 slugs, because a module was located by
  the first block that mentioned its URL anywhere — including «related modules» links. Modules are
  now anchored on their own `URL:` line.
- Index entries using `:` instead of `—` as a separator were ignored, so the newest module was
  missing from search and overview.
