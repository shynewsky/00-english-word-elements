# English Word Elements

English Word Elements is a static vocabulary explorer for learning how English words are built from prefixes, suffixes, roots and combining forms.

## Live site

https://shynewsky.github.io/english-word-elements/

## What it does

- Resolves inflected forms such as `running` to the lemma `run`
- Shows verb principal parts such as `run–ran–run`
- Expands verbs into a 12-row I/It tense-aspect comparison such as `I run / It runs`
- Finds a family headword when a derived member is searched, such as `intuitive → intuit`
- Compares each family member's pronunciation, part of speech, meaning and etymology
- Shows clickable word decompositions
- Separates inflectional forms from derived word-family relations such as `run → runner`
- Labels category-changing derivations such as `available` (adjective) → `availability` (noun)
- Searches canonical morphemes and allomorphs such as `in-`, `im-`, `il-`, `ir-`
- Groups verified word connections by the exact sense of a word element
- Separates reviewed morphology from collapsed spelling-only candidates
- Merges same-lemma part-of-speech records in search results
- Treats an English single-word query as a headword/form lookup instead of silently substituting definition-sentence matches
- Keeps English definition search in the explicit `뜻` mode while Korean queries continue to search meanings directly
- Suggests nearby words and their morphemes when a query is misspelled
- Uses the same meaning → structure → etymology → grammar → family layout for every word
- Distinguishes synchronic and etymological analyses
- Displays source and license information

Version 0.7 reports unique headwords separately from part-of-speech records. The regenerated snapshot contains 11,837 visible headwords across 15,618 POS-specific records: 38 curated records, 15,580 automatic records and 24 reviewed word elements. The refresh pipeline no longer truncates a ranked top-N subset; it retains every entry that satisfies the documented source rule. Imported entries remain clearly labelled `자동 수집`.

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

There is no server database or parameterized REST/GraphQL API. The two deployed JSON files are the public read assets; browser JavaScript performs search and joins locally. Reviewable JSON remains in Git, and GitHub Actions validates referential integrity, deploys the static artifact, and can refresh the imported lexicon through a review pull request.

## Repository structure

```text
data/catalog.json              reviewed editorial data
data/imported-words.json        generated draft lexicon with no arbitrary top-N cap
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
- element-sense links and verified reverse examples
- minimum reviewed coverage per element sense or an explicit waiver
- ordered analysis parts
- surface spelling coverage
- inflection versus derivation separation
- derivational cycles
- source references
- individual form records and allowed form types
- analysis modes, transparency, roles and parent references
- absence of comma-joined multi-surface forms

## Contributing

Use a GitHub Issue to suggest a word or report a correction. Data changes should be reviewed through pull requests. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Licenses

- Source code: MIT
- Original editorial data: CC BY-SA 4.0
- Third-party lexical data: retains its original license

See [ATTRIBUTION.md](ATTRIBUTION.md) and [LICENSE-DATA.md](LICENSE-DATA.md).
