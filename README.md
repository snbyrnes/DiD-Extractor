# SNOMED Description Extractor (static site)

A zero-backend web app: paste or upload a list of SNOMED concept IDs and get the
**FSN**, **Irish preferred synonym**, and/or **US English preferred synonym**
back — each with its **description ID** — then download the result as CSV.

All lookups run in the browser against a pre-built dataset (`data.json`). There is
no server; GitHub Pages just serves the static files.

## Live site
Published via GitHub Actions to GitHub Pages (see the Actions tab for the URL).

## What's in the dataset
`data.json` contains the **33,672 concepts of the Irish National Medicinal Product
module** (`1601000220105`) from **SNOMED CT Irish Edition, version 20260621** —
for each concept: active flag, effectiveTime, display, and the full language
designations (FSN + preferred/acceptable terms per language refset) including
description IDs.

Concepts outside this module (e.g. international SNOMED, or unpublished authoring
content) are intentionally not included and will report "concept not found".

## Rebuilding `data.json`
The dataset is generated from an Ontoserver Lucene index snapshot (not committed —
it is ~1.15 GB). To regenerate for a newer edition:

```bash
# extract index_x.x.x.zip to ./index first, then:
cd build
javac -cp "lucene-core-8.11.2.jar;lucene-backward-codecs-8.11.2.jar" BuildData.java
java  -cp "lucene-core-8.11.2.jar;lucene-backward-codecs-8.11.2.jar;." \
      BuildData ../index 1601000220105 ../data.json
```

Change the module argument to extract a different SNOMED module. Commit the new
`data.json` and the site redeploys automatically.

## Licensing
This site publishes SNOMED CT Irish Edition content. It is deployed on the basis
that the publisher holds the necessary SNOMED CT / Irish extension distribution
rights.
