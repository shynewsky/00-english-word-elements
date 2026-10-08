import { createReadStream } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const required = ['--oewn-dir', '--ko-wiktionary', '--simple-wiktionary'];
for (const name of required) {
  if (!args.get(name)) throw new Error(`Missing required argument ${name}`);
}

const projectRoot = path.resolve(import.meta.dirname, '..');
const outputPath = path.resolve(args.get('--output') || path.join(projectRoot, 'data', 'imported-words.json'));
const curatedPath = path.join(projectRoot, 'data', 'catalog.json');
const requestedLimit = args.get('--limit');
const limit = requestedLimit ? Number(requestedLimit) : Infinity;
const generatedAt = args.get('--generated-at') || new Date().toISOString().slice(0, 10);
const oewnDir = path.resolve(args.get('--oewn-dir'));
const koWiktionaryPath = path.resolve(args.get('--ko-wiktionary'));
const simpleWiktionaryPath = path.resolve(args.get('--simple-wiktionary'));

const POS = Object.freeze({ noun: 'noun', verb: 'verb', adj: 'adjective', adv: 'adverb' });
const OEWN_POS = Object.freeze({ n: 'noun', v: 'verb', a: 'adjective', s: 'adjective', r: 'adverb' });
const normalize = (value = '') => value.normalize('NFKC').trim();
const keyFor = (lemma, pos) => `${normalize(lemma).toLocaleLowerCase('en')}|${pos}`;
const uniquePush = (array, value, max = Infinity) => {
  if (value && array.length < max && !array.includes(value)) array.push(value);
};
const cleanGloss = (value = '') => String(value).replace(/\s+/g, ' ').trim().slice(0, 300);
const isSingleEnglishWord = (value) => /^[A-Za-z][A-Za-z'’-]*$/.test(value) && value.length <= 40;
const splitSurfaceForms = (value = '') => uniquePushForms(normalize(value).split(/\s*(?:,|;|\bor\b)\s*/i));
const uniquePushForms = (values) => [...new Set(values.filter((value) => isSingleEnglishWord(value) || /^[A-Za-z][A-Za-z'’ -]*$/.test(value)))];

async function eachJsonLine(filePath, callback) {
  const input = createReadStream(filePath, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line || !line.includes('"lang_code": "en"')) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (record.lang_code === 'en') await callback(record);
  }
}

const korean = new Map();
const koreanByLemma = new Map();
await eachJsonLine(koWiktionaryPath, (record) => {
  const pos = POS[record.pos];
  const lemma = normalize(record.word || '');
  if (!isSingleEnglishWord(lemma)) return;
  const ko = [];
  for (const sense of record.senses || []) {
    for (const value of sense.glosses || []) {
      const gloss = cleanGloss(value);
      if (/[가-힣]/.test(gloss)) uniquePush(ko, gloss, 3);
    }
    if (ko.length >= 3) break;
  }
  if (!ko.length) return;
  const lemmaKey = normalize(lemma).toLocaleLowerCase('en');
  const lemmaItem = koreanByLemma.get(lemmaKey) || { lemma, ko: [] };
  for (const gloss of ko) uniquePush(lemmaItem.ko, gloss, 3);
  koreanByLemma.set(lemmaKey, lemmaItem);
  if (!pos) return;
  const key = keyFor(lemma, pos);
  const item = korean.get(key) || { lemma, pos, ko: [] };
  for (const gloss of ko) uniquePush(item.ko, gloss, 3);
  korean.set(key, item);
});

const simple = new Map();
await eachJsonLine(simpleWiktionaryPath, (record) => {
  const pos = POS[record.pos];
  const lemma = normalize(record.word || '');
  const key = keyFor(lemma, pos);
  const lemmaKey = normalize(lemma).toLocaleLowerCase('en');
  if (!pos || (!korean.has(key) && !koreanByLemma.has(lemmaKey))) return;
  const item = simple.get(key) || { en: [], forms: [] };
  for (const sense of record.senses || []) {
    for (const value of sense.glosses || []) uniquePush(item.en, cleanGloss(value), 3);
    if (item.en.length >= 3) break;
  }
  for (const sourceForm of record.forms || []) {
    const tags = new Set(sourceForm.tags || []);
    let type = null;
    if (tags.has('third-person') && tags.has('singular')) type = 'third-person';
    else if (tags.has('past') && tags.has('participle')) type = 'past-participle';
    else if (tags.has('present') && tags.has('participle')) type = 'present-participle';
    else if (tags.has('past')) type = 'past';
    else if (tags.has('plural')) type = 'plural';
    else if (tags.has('comparative')) type = 'comparative';
    else if (tags.has('superlative')) type = 'superlative';
    if (!type) continue;
    for (const form of splitSurfaceForms(sourceForm.form || '')) {
      const normalizedForm = normalize(form).toLocaleLowerCase('en');
      if (!item.forms.some((candidate) => normalize(candidate.form).toLocaleLowerCase('en') === normalizedForm && candidate.type === type)) item.forms.push({ form, type });
    }
  }
  simple.set(key, item);
});

function keyFromSenseReference(reference = '') {
  const separator = reference.indexOf('%');
  if (separator < 1) return null;
  const lemma = reference.slice(0, separator).replaceAll('_', ' ');
  const type = reference[separator + 1];
  const pos = { 1: 'noun', 2: 'verb', 3: 'adjective', 4: 'adverb', 5: 'adjective' }[type];
  return pos && isSingleEnglishWord(lemma) ? keyFor(lemma, pos) : null;
}

const oewn = new Map();
const neededSynsets = new Set();
const synsetOwners = new Map();
const entryFiles = (await readdir(oewnDir)).filter((name) => /^entries-.+\.json$/.test(name)).sort();
for (const fileName of entryFiles) {
  const entries = JSON.parse(await readFile(path.join(oewnDir, fileName), 'utf8'));
  for (const [lemma, byPos] of Object.entries(entries)) {
    if (!isSingleEnglishWord(lemma)) continue;
    for (const [posCode, details] of Object.entries(byPos)) {
      const pos = OEWN_POS[posCode];
      const key = keyFor(lemma, pos);
      const lemmaKey = normalize(lemma).toLocaleLowerCase('en');
      if (!pos || (!korean.has(key) && !koreanByLemma.has(lemmaKey))) continue;
      const item = oewn.get(key) || { lemma, pos, synsets: [], en: [], pronunciations: [], derivationKeys: [] };
      for (const pronunciation of details.pronunciation || []) {
        if (!pronunciation.value || item.pronunciations.some((candidate) => candidate.ipa === pronunciation.value && candidate.variety === (pronunciation.variety || ''))) continue;
        item.pronunciations.push({ ipa: pronunciation.value, variety: pronunciation.variety || '', sourceId: 'src-oewn' });
      }
      for (const sense of details.sense || []) {
        if (sense.synset) {
          uniquePush(item.synsets, sense.synset, 5);
          neededSynsets.add(sense.synset);
          if (!synsetOwners.has(sense.synset)) synsetOwners.set(sense.synset, new Set());
          synsetOwners.get(sense.synset).add(key);
        }
        for (const reference of sense.derivation || []) {
          const targetKey = keyFromSenseReference(reference);
          if (targetKey) uniquePush(item.derivationKeys, targetKey);
        }
      }
      oewn.set(key, item);
    }
  }
}

const synsetFiles = (await readdir(oewnDir))
  .filter((name) => name.endsWith('.json') && !name.startsWith('entries-') && name !== 'frames.json')
  .sort();
for (const fileName of synsetFiles) {
  const synsets = JSON.parse(await readFile(path.join(oewnDir, fileName), 'utf8'));
  for (const [synsetId, synset] of Object.entries(synsets)) {
    if (!neededSynsets.has(synsetId)) continue;
    for (const definition of synset.definition || []) {
      for (const key of synsetOwners.get(synsetId) || []) {
        uniquePush(oewn.get(key).en, cleanGloss(definition), 3);
      }
    }
  }
}

const curated = JSON.parse(await readFile(curatedPath, 'utf8'));
const curatedByKey = new Map(curated.words.map((word) => [keyFor(word.lemma, word.partOfSpeech[0]), word]));
const curatedKeys = new Set(curatedByKey.keys());
const usedIds = new Set(curated.words.map((word) => word.id));
const candidates = [];
for (const [key, oewnItem] of oewn) {
  if (curatedKeys.has(key) || !oewnItem.en.length) continue;
  const koItem = korean.get(key) || koreanByLemma.get(normalize(oewnItem.lemma).toLocaleLowerCase('en'));
  const simpleItem = simple.get(key);
  const lowercase = oewnItem.lemma === oewnItem.lemma.toLocaleLowerCase('en');
  const score = (simpleItem ? 1000 : 0) + (lowercase ? 100 : 0) + Math.max(0, 40 - oewnItem.lemma.length) + koItem.ko.length;
  candidates.push({
    key,
    ...oewnItem,
    ko: koItem.ko,
    en: simpleItem?.en?.length ? simpleItem.en : oewnItem.en,
    forms: simpleItem?.forms || [],
    hasSimple: Boolean(simpleItem),
    score,
  });
}

candidates.sort((left, right) => right.score - left.score || left.lemma.localeCompare(right.lemma, 'en') || left.pos.localeCompare(right.pos));

function createId(lemma, pos) {
  const slug = lemma.toLocaleLowerCase('en').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'word';
  const posCode = { noun: 'n', verb: 'v', adjective: 'adj', adverb: 'adv' }[pos];
  const base = `wd-import-${slug}-${posCode}`;
  let id = base;
  let suffix = 2;
  while (usedIds.has(id)) id = `${base}-${suffix++}`;
  usedIds.add(id);
  return id;
}

const selectedCandidates = Number.isFinite(limit) ? candidates.slice(0, limit) : candidates;
const selected = selectedCandidates.map((item) => ({ ...item, id: createId(item.lemma, item.pos) }));
const wordIdByKey = new Map([...curatedByKey].map(([key, word]) => [key, word.id]));
for (const item of selected) wordIdByKey.set(item.key, item.id);

const words = selected.map((item) => ({
  id: item.id,
  lemma: item.lemma,
  partOfSpeech: [item.pos],
  status: 'draft',
  meanings: [{ id: `${item.id}-sense-1`, ko: item.ko, en: item.en, concepts: [] }],
  forms: item.forms,
  relations: item.derivationKeys
    .map((targetKey) => wordIdByKey.get(targetKey))
    .filter((targetId, index, ids) => targetId && targetId !== item.id && ids.indexOf(targetId) === index)
    .map((targetWordId) => ({ type: 'related-family', targetWordId, transparency: 'semi-transparent', noteKo: 'OEWN 파생 연관 관계' })),
  analyses: [],
  pronunciations: item.pronunciations,
  sources: ['src-oewn', 'src-kowiktionary', ...(item.hasSimple ? ['src-simplewiktionary'] : [])],
}));

const combinedWords = [...curated.words, ...words];
const wordsById = new Map(combinedWords.map((word) => [word.id, word]));
const adjacency = new Map(combinedWords.map((word) => [word.id, new Set()]));
for (const word of combinedWords) {
  for (const relation of word.relations || []) {
    if (!['related-family', 'derived-from'].includes(relation.type) || !wordsById.has(relation.targetWordId)) continue;
    adjacency.get(word.id).add(relation.targetWordId);
    adjacency.get(relation.targetWordId).add(word.id);
  }
}
const seenFamilyIds = new Set();
const posPriority = { verb: 0, noun: 1, adjective: 2, adverb: 3 };
for (const word of combinedWords) {
  if (seenFamilyIds.has(word.id) || !adjacency.get(word.id)?.size) continue;
  const component = [];
  const pending = [word.id];
  while (pending.length) {
    const id = pending.pop();
    if (seenFamilyIds.has(id)) continue;
    seenFamilyIds.add(id);
    component.push(wordsById.get(id));
    for (const neighbor of adjacency.get(id) || []) if (!seenFamilyIds.has(neighbor)) pending.push(neighbor);
  }
  if (component.length < 2) continue;
  const explicitHead = component.find((member) => member.familyHeadwordId === member.id);
  const head = explicitHead || [...component].sort((left, right) =>
    (posPriority[left.partOfSpeech[0]] ?? 9) - (posPriority[right.partOfSpeech[0]] ?? 9)
    || left.lemma.length - right.lemma.length
    || left.lemma.localeCompare(right.lemma, 'en'))[0];
  for (const member of component) if (member.status === 'draft') member.familyHeadwordId = head.id;
}

const output = {
  meta: {
    generatedAt,
    wordCount: words.length,
    requestedLimit: Number.isFinite(limit) ? limit : null,
    candidateCount: candidates.length,
    selectionPolicy: Number.isFinite(limit) ? 'ranked-cap' : 'all-qualified-candidates',
    sources: {
      oewn: '2025',
      koreanWiktionary: 'Kaikki/Wiktextract raw dump',
      simpleWiktionary: 'Kaikki/Wiktextract raw dump',
    },
    noteKo: 'OEWN 영문 정의·IPA 발음·파생 연관 관계와 한국어·Simple Wiktionary 구조화 덤프를 결합한 자동 수집 데이터입니다. 어원의 역사적 방향과 형태소 분석은 검수 데이터에서 별도로 관리합니다.',
  },
  words,
};

await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Wrote ${words.length} imported words from ${candidates.length} candidates to ${outputPath}`);
