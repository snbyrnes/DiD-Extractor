# DiD Extractor

A zero-backend web app: paste or upload a list of concept IDs and get the
matching terms back — **FSN**, **Irish preferred synonym**, **Irish acceptable
synonyms**, and/or **US English preferred synonym** — each with its
**description ID (DiD)**. Download the result as CSV, plain Excel, or a
prefilled **MS translations template**.

All lookups run in the browser against a pre-built dataset (`data.json`). There
is no server; GitHub Pages just serves the static files.

## Live site
Published via GitHub Actions to GitHub Pages (see the Actions tab for the URL).

## MS translations template export
Pick one or more work-type tabs in step 3 and the export fills them from the
extracted concepts, keeping the template's formatting, dropdowns and Reference
sheet intact (`ms-template.xlsx`, v2.21):

- **Description Additions** / **Bookmark Concepts** — one row per concept
  (not-found IDs are included with a note).
- **Description Changes / Inactivations / Replacements** — one row per
  description selected in step 2 (not-found IDs are skipped).

The workflow columns (language reference set, acceptability, language code,
case significance) are prefilled from configurable defaults
(`21000220103`, `PREFERRED`, `en`, blank).

## What's in the dataset
`data.json` contains 33,672 concepts from a single terminology module — for
each concept: active flag, effectiveTime, display term, and the full language
designations (FSN + preferred/acceptable terms per language reference set)
including description IDs.

Concepts outside that module are intentionally not included and will report
"concept not found".

## Rebuilding `data.json`
The dataset is generated from a Lucene index snapshot (not committed — it is
~1.15 GB). To regenerate for a newer release:

```bash
# extract index_x.x.x.zip to ./index first, then:
cd build
javac -cp "lucene-core-8.11.2.jar;lucene-backward-codecs-8.11.2.jar" BuildData.java
java  -cp "lucene-core-8.11.2.jar;lucene-backward-codecs-8.11.2.jar;." \
      BuildData ../index 1601000220105 ../data.json
```

Change the module argument to extract a different module. Commit the new
`data.json` and the site redeploys automatically.

## Licensing
The published dataset is derived from licensed terminology content. It is
deployed on the basis that the publisher holds the necessary distribution
rights for that content.
