import { readFile } from 'node:fs/promises';

const catalogUrl = new URL('../data/catalog.json', import.meta.url);
const importedUrl = new URL('../data/imported-words.json', import.meta.url);
const catalog = JSON.parse(await readFile(catalogUrl, 'utf8'));
const imported = JSON.parse(await readFile(importedUrl, 'utf8'));
const curatedLemmaPosKeys = new Set(catalog.words.map((word) => `${word.lemma.toLocaleLowerCase('en')}|${[...word.partOfSpeech].sort().join(',')}`));
const importedWithoutCuratedDuplicates = imported.words.filter((word) => !curatedLemmaPosKeys.has(`${word.lemma.toLocaleLowerCase('en')}|${[...word.partOfSpeech].sort().join(',')}`));
const data = { ...catalog, words: [...catalog.words, ...importedWithoutCuratedDuplicates] };
const errors = [];
const warnings = [];
const fail = (message) => errors.push(message);
const warn = (message) => warnings.push(message);
const idPattern = /^[a-z][a-z0-9]*(?:[-._][a-z0-9]+)*$/;
const statuses = new Set(['draft', 'reviewed', 'published']);
const relationTypes = new Set(['derived-from', 'compound', 'variant-of', 'related-family']);
const ids = new Map();
if (imported.meta.wordCount !== imported.words.length) fail(`Imported metadata says ${imported.meta.wordCount} words, found ${imported.words.length}`);

function register(id, type) {
  if (!idPattern.test(id)) fail(`${type} has an invalid id: ${id}`);
  if (ids.has(id)) fail(`Duplicate id ${id} (${ids.get(id)} and ${type})`);
  ids.set(id, type);
}

for (const source of data.sources) register(source.id, 'source');
for (const concept of data.concepts) register(concept.id, 'concept');
for (const element of data.elements) {
  register(element.id, 'element');
  for (const sense of element.senses) register(sense.id, 'element-sense');
}
for (const word of data.words) {
  register(word.id, 'word');
  for (const sense of word.meanings) register(sense.id, 'word-sense');
  for (const analysis of word.analyses) register(analysis.id, 'analysis');
}

const sourceIds = new Set(data.sources.map((item) => item.id));
const conceptIds = new Set(data.concepts.map((item) => item.id));
const wordIds = new Set(data.words.map((item) => item.id));
const wordSenseIds = new Set(data.words.flatMap((word) => word.meanings.map((sense) => sense.id)));
const elementSenseToElement = new Map();

for (const concept of data.concepts) {
  if (!concept.labels?.ko?.length || !concept.labels?.en?.length) fail(`Concept ${concept.id} needs Korean and English labels`);
}

for (const element of data.elements) {
  if (!statuses.has(element.status)) fail(`Element ${element.id} has invalid status ${element.status}`);
  if (!element.canonicalForm || !element.kind || !element.originLanguage) fail(`Element ${element.id} is missing core fields`);
  if (!element.allomorphs?.length) fail(`Element ${element.id} has no allomorphs`);
  if (!element.senses?.length) fail(`Element ${element.id} has no senses`);
  for (const sense of element.senses) {
    elementSenseToElement.set(sense.id, element.id);
    if (!sense.glossKo?.length || !sense.glossEn?.length) fail(`Element sense ${sense.id} needs bilingual glosses`);
    for (const conceptId of sense.concepts || []) if (!conceptIds.has(conceptId)) fail(`${sense.id} references missing concept ${conceptId}`);
    for (const sourceId of sense.sources || []) if (!sourceIds.has(sourceId)) fail(`${sense.id} references missing source ${sourceId}`);
    if (element.status !== 'draft' && !(sense.sources || []).length) fail(`Reviewed element sense ${sense.id} needs a source`);
    const exampleWordIds = new Set();
    for (const example of sense.examples || []) {
      if (!wordIds.has(example.wordId)) fail(`${sense.id} example references missing word ${example.wordId}`);
      if (exampleWordIds.has(example.wordId)) fail(`${sense.id} repeats example word ${example.wordId}`);
      exampleWordIds.add(example.wordId);
      if (!['synchronic', 'etymological'].includes(example.mode)) fail(`${sense.id} example ${example.wordId} has invalid mode ${example.mode}`);
      if (!example.noteKo?.trim()) fail(`${sense.id} example ${example.wordId} needs a Korean review note`);
    }
  }
}

const lemmaPosKeys = new Set();
const formIndex = new Map();
for (const word of data.words) {
  if (!statuses.has(word.status)) fail(`Word ${word.id} has invalid status ${word.status}`);
  if (!word.lemma || !word.partOfSpeech?.length || !word.meanings?.length) fail(`Word ${word.id} is missing core fields`);
  const lemmaPosKey = `${word.lemma.toLocaleLowerCase('en')}|${[...word.partOfSpeech].sort().join(',')}`;
  if (lemmaPosKeys.has(lemmaPosKey)) warn(`Possible duplicate lemma/POS record: ${lemmaPosKey}`);
  lemmaPosKeys.add(lemmaPosKey);
  for (const sourceId of word.sources || []) if (!sourceIds.has(sourceId)) fail(`${word.id} references missing source ${sourceId}`);
  if (word.status !== 'draft' && !(word.sources || []).length) fail(`Reviewed word ${word.id} needs a source`);
  if (word.familyHeadwordId && !wordIds.has(word.familyHeadwordId)) fail(`${word.id} references missing family headword ${word.familyHeadwordId}`);
  if (word.etymology) {
    if (!word.etymology.summaryKo?.trim()) fail(`${word.id} has an empty etymology summary`);
    for (const sourceId of word.etymology.sourceIds || []) if (!sourceIds.has(sourceId)) fail(`${word.id} etymology references missing source ${sourceId}`);
  }
  for (const pronunciation of word.pronunciations || []) {
    if (!pronunciation.ipa?.trim()) fail(`${word.id} has an empty pronunciation`);
    if (pronunciation.sourceId && !sourceIds.has(pronunciation.sourceId)) fail(`${word.id} pronunciation references missing source ${pronunciation.sourceId}`);
  }

  for (const meaning of word.meanings) {
    if (!meaning.ko?.length || !meaning.en?.length) fail(`Word sense ${meaning.id} needs bilingual glosses`);
    for (const conceptId of meaning.concepts || []) if (!conceptIds.has(conceptId)) fail(`${meaning.id} references missing concept ${conceptId}`);
  }

  for (const form of word.forms || []) {
    const key = form.form.normalize('NFKC').toLocaleLowerCase('en');
    if (!formIndex.has(key)) formIndex.set(key, []);
    formIndex.get(key).push(word.id);
  }

  for (const relation of word.relations || []) {
    if (!relationTypes.has(relation.type)) fail(`${word.id} has unsupported relation type ${relation.type}`);
    if (!wordIds.has(relation.targetWordId)) fail(`${word.id} references missing related word ${relation.targetWordId}`);
    if (relation.targetWordId === word.id) fail(`${word.id} has a self relation`);
    if (relation.type === 'inflection') fail(`${word.id} models an inflection as a relation; use forms instead`);
  }

  for (const analysis of word.analyses || []) {
    if (!wordSenseIds.has(analysis.wordSenseId)) fail(`${analysis.id} references missing word sense ${analysis.wordSenseId}`);
    if (!word.meanings.some((sense) => sense.id === analysis.wordSenseId)) fail(`${analysis.id} targets a sense outside ${word.id}`);
    if (!analysis.parts?.length) fail(`${analysis.id} has no parts`);
    const orders = analysis.parts.map((part) => part.order);
    const expected = analysis.parts.map((_, index) => index + 1);
    if (JSON.stringify(orders) !== JSON.stringify(expected)) fail(`${analysis.id} part order must be 1..n`);
    for (const part of analysis.parts) {
      const referenceCount = Number(Boolean(part.elementSenseId)) + Number(Boolean(part.wordId));
      if (referenceCount !== 1) fail(`${analysis.id} part ${part.order} must reference exactly one element sense or word`);
      if (part.elementSenseId && !elementSenseToElement.has(part.elementSenseId)) fail(`${analysis.id} references missing element sense ${part.elementSenseId}`);
      if (part.wordId && !wordIds.has(part.wordId)) fail(`${analysis.id} references missing base word ${part.wordId}`);
      if (part.parentOrder !== null && part.parentOrder !== undefined && !orders.includes(part.parentOrder)) fail(`${analysis.id} part ${part.order} has missing parent ${part.parentOrder}`);
      if (!part.surface) fail(`${analysis.id} part ${part.order} has no surface text`);
    }
    const combined = analysis.parts.map((part) => part.surface).join('').normalize('NFKC').toLocaleLowerCase('en').replaceAll('-', '');
    const lemma = word.lemma.normalize('NFKC').toLocaleLowerCase('en').replaceAll('-', '');
    if (combined !== lemma) fail(`${analysis.id} surfaces produce '${combined}', expected '${lemma}'`);
  }
}

const graph = new Map(data.words.map((word) => [word.id, (word.relations || []).filter((rel) => rel.type === 'derived-from').map((rel) => rel.targetWordId)]));
const visiting = new Set();
const visited = new Set();
function visit(node) {
  if (visiting.has(node)) return fail(`Derivation cycle detected at ${node}`);
  if (visited.has(node)) return;
  visiting.add(node);
  for (const parent of graph.get(node) || []) visit(parent);
  visiting.delete(node);
  visited.add(node);
}
for (const wordId of wordIds) visit(wordId);

for (const element of data.elements) {
  for (const sense of element.senses) {
    const linkedWordIds = new Set((sense.examples || []).map((example) => example.wordId));
    for (const word of data.words) {
      if (word.analyses.some((analysis) => analysis.parts.some((part) => part.elementSenseId === sense.id))) linkedWordIds.add(word.id);
    }
    if (!linkedWordIds.size) fail(`Reviewed element sense ${sense.id} has no verified word connection`);
    if (linkedWordIds.size < 2 && !sense.coverageWaiverKo?.trim()) fail(`Element sense ${sense.id} has only ${linkedWordIds.size} verified word; add coverage or a waiver`);
    if (sense.coverageWaiverKo && linkedWordIds.size > 1) warn(`Element sense ${sense.id} still has a coverage waiver despite ${linkedWordIds.size} verified words`);
  }
}

if (warnings.length) {
  console.warn(`Warnings (${warnings.length}):`);
  for (const message of warnings) console.warn(`- ${message}`);
}
if (errors.length) {
  console.error(`Validation failed (${errors.length} errors):`);
  for (const message of errors) console.error(`- ${message}`);
  process.exit(1);
}
console.log(`Validated ${data.words.length} words (${catalog.words.length} curated + ${imported.words.length} imported), ${data.elements.length} elements, ${elementSenseToElement.size} element senses, ${data.concepts.length} concepts and ${data.sources.length} sources.`);
