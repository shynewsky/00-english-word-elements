# Data Sources and Import Policy

## Principles

1. Prefer official downloads, dumps and structured APIs.
2. Do not use HTML scraping as the primary collection method.
3. Never present automatically imported records as human-reviewed; keep them visibly marked as `draft` until editorial review.
4. Keep stable source IDs, access dates and license information.
5. Do not commit multi-gigabyte raw dumps to Git.
6. AI output may assist drafting but is never a source.

## Open English WordNet

- Website: https://en-word.net/
- Purpose: lemmas, parts of speech, English glosses and lexical relations
- License: CC BY 4.0 plus attribution to Princeton WordNet where applicable
- Recommended method: versioned JSON download for bulk import; API only for development lookups

## English Wiktionary

- Website: https://en.wiktionary.org/
- Dumps: https://dumps.wikimedia.org/enwiktionary/
- Structured extraction: https://kaikki.org/ and https://github.com/tatuylonen/wiktextract
- Purpose: inflections, affix entries, etymologies, derived terms and alternative forms
- License: CC BY-SA 4.0 and GFDL

Use Wiktextract or Kaikki JSONL rather than scraping rendered HTML. Wiktionary structure is not uniform, so imported analyses remain staging data until reviewed.

## Korean glosses

Reviewed Korean glosses are concise editorial explanations based on cited English-language sources. The expanded draft lexicon uses Korean Wiktionary entries extracted by Wiktextract as source-linked staging data. Automatically collected entries are labelled `자동 수집` in the interface and are not treated as reviewed morphological analyses.

## Implemented import workflow

```text
OEWN 2025 JSON + Korean Wiktionary JSONL + Simple Wiktionary JSONL
        ↓ scripts/import-lexicon.mjs
normalize lemma + part of speech, with lemma fallback for unknown Korean POS
        ↓
collect definitions, forms, IPA pronunciations and OEWN derivational links
        ↓
select 5,000 source-linked entries and build connected word-family groups
        ↓
data/imported-words.json
        ↓ npm run validate
GitHub pull request and Pages deployment
```

The monthly `Refresh public lexicon data` workflow downloads about 45 MB of compressed source data, never commits raw dumps, regenerates only the compact imported output, validates all IDs and relationships, and opens a pull request for review. Exact source URLs, versions, sizes and selection rules are recorded in `imports/source-manifest.json`.

OEWN derivation links are symmetric lexical-family evidence, not guaranteed historical direction. They are imported as `related-family`; reviewed `derived-from` edges and word-level etymology remain editorial claims. High-value reviewed families can additionally use per-entry English Wiktionary/Wiktextract JSONL records for `etymology_text`, `sounds`, `derived` and `related` fields without downloading the multi-gigabyte full English dump.
