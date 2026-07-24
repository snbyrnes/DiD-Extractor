# DiD Extractor

Bulk lookup of **description IDs (DiDs)** and their terms for a list of concept
IDs, taken from a terminology code system release you already hold.

Paste or upload your concept IDs, choose which descriptions you want — fully
specified name, preferred synonyms, acceptable synonyms — and export the result
to Excel, with every ID written as text so long identifiers keep all their
digits.

## How it works

The site ships no terminology content and has no server. On first use you point
it at your own extracted release folder; it reads the RF2 snapshot files, builds
the lookup index **in the browser**, and caches it so later visits open straight
to the lookup screen.

Nothing you select ever leaves your machine.

Chrome and Edge remember the folder, so refreshing to a newer release is one
click. Other browsers work too, but ask for the folder each time it is rebuilt.

## Using it

Full step-by-step instructions — from downloading a release package through to
extracting descriptions — are built into the app: click **?** in the header, or
**How do I get these files?** on the start screen.

In short: download and extract a release, click **Choose release folder…**,
select the extracted folder, and wait a few seconds while the index builds.

## Files

| | |
| --- | --- |
| `index.html` | the whole UI and app logic |
| `rf2.js` | release discovery, streaming parser, index cache |
| `xlsx.js` | minimal dependency-free Excel writer |

No build step and no dependencies — it is a static site, deployed to GitHub
Pages by the workflow in `.github/workflows/`.

## Licensing

Because the release is supplied by the user at runtime, this repository
distributes no licensed terminology content. Users are responsible for holding a
valid licence for the release they load.
