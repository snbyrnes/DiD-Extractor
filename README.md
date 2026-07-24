# DiD Extractor

A zero-backend web app: paste or upload a list of concept IDs and get the
matching terms back — **FSN**, **Irish preferred synonym**, **Irish acceptable
synonyms**, and/or **US English preferred synonym** — each with its
**description ID (DiD)**. Download the result as Excel.

**No terminology content ships with this site.** On first use you point the app
at your own SNOMED CT RF2 release folder; it builds the lookup index in your
browser and caches it. Nothing is uploaded — there is no server, and GitHub
Pages only serves the static files.

## Live site
Published via GitHub Actions to GitHub Pages (see the Actions tab for the URL).

## First run
1. Download your release and extract the zip anywhere on your PC.
2. Open the site and click **Choose release folder…**, then select the
   extracted folder — the one containing `Snapshot`, or any folder above it.
3. Grant read access when the browser asks.

Building takes a few seconds, after which the dataset is cached in the browser
and the app opens straight to the lookup screen. In Chrome and Edge the folder
itself is remembered, so a **rebuild** for a newer release is one click. Firefox
and Safari work too, but ask for the folder again whenever you rebuild.

Footer controls: **rebuild** (re-read the same folder), **change folder**
(switch releases) and **forget** (clear the cached dataset from the browser).

## What it reads
Three Snapshot files, found by name anywhere under the folder you pick
(`Full/` and `Delta/` are ignored):

| File | Used for |
| --- | --- |
| `sct2_Concept_Snapshot…txt` | concept list, active flag, effectiveTime |
| `sct2_Description_Snapshot…txt` | terms, description IDs, description type |
| `der2_cRefset_LanguageSnapshot…txt` | FSN / preferred / acceptable per language reference set |

The language reference set is large (~158 MB, 1.6M rows in the IE release), so
every file is streamed and parsed a chunk at a time rather than read into memory
whole.

Concepts are indexed for one module at a time, defaulting to `1601000220105`.
If the release contains other modules a selector appears in the footer; IDs
outside the selected module report "concept not found".

## Licensing
Because the app reads a release supplied by the user at runtime, this repository
distributes no licensed terminology content. Users are responsible for holding a
valid licence for the release files they load.

## Legacy build tooling
`build/BuildData.java` predates the local-folder approach — it generated the
`data.json` the site used to ship. It is no longer used by the app and is kept
only for reference.
