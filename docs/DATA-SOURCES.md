# Data Sources and Import Policy

## Principles

1. Prefer official downloads, dumps and structured APIs.
2. Do not use HTML scraping as the primary collection method.
3. Never publish imported records without human review.
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

Korean glosses are concise editorial explanations based on cited English-language sources. Korean Wiktionary may be consulted as a secondary source. ChatGPT or Claude may draft a translation, but a human must compare it with the cited source before publication.

## Planned import workflow

```text
imports/seed-words.txt
        ↓ manual GitHub Action
versioned external data download
        ↓
small staging JSON for selected entries
        ↓
pull request and human review
        ↓
data/catalog.json
```

The import workflow must never commit raw full dumps. It should record source version and date in catalog metadata or a future `source-manifest.json`.
