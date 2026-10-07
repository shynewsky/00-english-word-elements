# Contributing

## Suggest a word or correction

Use the repository Issue forms. Include the spelling, intended meaning, proposed decomposition and at least one reliable source.

## Data editing rules

- Do not change a published ID just because a label changes.
- Keep inflections in `forms`; keep derived words as separate Word records with `relations`.
- Link every Analysis part to an exact Element sense or base Word.
- Use the surface letters that actually appear in the word.
- Explain spelling changes such as `happy → happi` before `-ness`.
- Distinguish synchronic and etymological analyses.
- Add Korean and English glosses.
- Add source IDs. AI output is not a source.
- Run `npm run validate` before opening a pull request.

## Review states

- `draft`: incomplete and not ready for normal results
- `reviewed`: checked against at least one source
- `published`: reviewed to the project’s highest standard

## Pull request checklist

- [ ] IDs are unique and stable
- [ ] All references exist
- [ ] Word forms and derivations are separated
- [ ] Meanings are bilingual
- [ ] Analysis surfaces reproduce the lemma
- [ ] Sources and licenses are recorded
- [ ] Validation passes
