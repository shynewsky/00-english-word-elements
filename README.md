# English Word Elements

English Word Elements is a static vocabulary explorer for learning how English words are built from prefixes, suffixes, roots and combining forms.

## Live site

https://shynewsky.github.io/00-english-word-elements/

## What it does

- Resolves inflected forms such as `running` to the lemma `run`
- Shows verb principal parts such as `run–ran–run`
- Shows clickable word decompositions
- Separates inflectional forms from derived word-family relations such as `run → runner`
- Labels category-changing derivations such as `available` (adjective) → `availability` (noun)
- Searches canonical morphemes and allomorphs such as `in-`, `im-`, `il-`, `ir-`
- Groups example words by the exact sense of a word element
- Searches Korean and English meanings
- Distinguishes synchronic and etymological analyses
- Displays source and license information

Version 0.3 combines 27 curated entries and 16 reviewed word elements with 5,000 automatically collected, source-linked dictionary entries. Imported entries are clearly labelled `자동 수집`; detailed morpheme analyses remain review-only.

## Architecture

```text
OEWN and Wiktextract public dumps
             ↓
scripts/import-lexicon.mjs
             ↓
data/imported-words.json
             +
data/catalog.json (reviewed editorial data)
             ↓
scripts/validate-data.mjs
             ↓
static HTML, CSS and JavaScript
             ↓
GitHub Pages
```

There is no server database. Reviewable JSON remains in Git. GitHub Actions validates referential integrity, deploys the static artifact, and can refresh the imported lexicon monthly through a review pull request.

## Repository structure

```text
data/catalog.json              reviewed editorial data
data/imported-words.json        generated 5,000-word draft lexicon
imports/source-manifest.json    source versions, sizes and selection rules
schemas/catalog.schema.json     structural schema
scripts/import-lexicon.mjs      public dump normalizer and importer
scripts/validate-data.mjs       semantic and relation validation
scripts/prepare-pages.mjs       deployment artifact builder
docs/DATABASE-DESIGN.md         logical database specification
docs/DATA-SOURCES.md            import and licensing policy
index.html / app.js / styles.css
.github/workflows               validation, refresh and Pages deployment
```

## Data entities

- `Word`: lemma-level dictionary entry
- `Word sense`: bilingual meaning of a word
- `Word form`: inflection or spelling variant resolving to a word
- `Element`: prefix, suffix, root or combining form
- `Allomorph`: surface spelling of an element
- `Element sense`: one specific meaning of an element
- `Analysis`: ordered decomposition of one word sense
- `Word relation`: derivational or compound relationship between lemmas
- `Concept`: bilingual meaning label used for meaning search
- `Source`: attribution and licensing record

See [Database Design](docs/DATABASE-DESIGN.md) for the complete relationship model and validation rules.

## Validation

The project has no runtime dependencies. With Node.js 20 or newer:

```bash
npm run validate
npm run build
```

The `Refresh public lexicon data` workflow downloads the configured public dumps, runs `scripts/import-lexicon.mjs`, validates the regenerated data and opens a pull request when records change.

The validator checks:

- globally unique and stable IDs
- missing references
- bilingual meanings
- element-sense links
- ordered analysis parts
- surface spelling coverage
- inflection versus derivation separation
- derivational cycles
- source references

## Contributing

Use a GitHub Issue to suggest a word or report a correction. Data changes should be reviewed through pull requests. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Licenses

- Source code: MIT
- Original editorial data: CC BY-SA 4.0
- Third-party lexical data: retains its original license

See [ATTRIBUTION.md](ATTRIBUTION.md) and [LICENSE-DATA.md](LICENSE-DATA.md).
