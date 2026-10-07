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
const limit = Number(args.get('--limit') || 5000);
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
const isSingleEnglishWord = (value) => /^[A-Za-z][A-Za-z'-]*$/.test(value) && value.length <= 40;

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
await eachJsonLine(koWiktionaryPath, (record) => {
  const pos = POS[record.pos];
  const lemma = normalize(record.word || '');
  if (!pos || !isSingleEnglishWord(lemma)) return;
  const ko = [];
  for (const sense of record.senses || []) {
    for (const value of sense.glosses || []) {
      const gloss = cleanGloss(value);
      if (/[가-힣]/.test(gloss)) uniquePush(ko, gloss, 3);
    }
    if (ko.length >= 3) break;
  }
  if (!ko.length) return;
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
  if (!pos || !korean.has(key)) return;
  const item = simple.get(key) || { en: [], forms: [] };
  for (const sense of record.senses || []) {
    for (const value of sense.glosses || []) uniquePush(item.en, cleanGloss(value), 3);
    if (item.en.length >= 3) break;
  }
  for (const sourceForm of record.forms || []) {
    const form = normalize(sourceForm.form || '');
    const tags = new Set(sourceForm.tags || []);
    let type = null;
    if (tags.has('third-person') && tags.has('singular')) type = 'third-person';
    else if (tags.has('past') && tags.has('participle')) type = 'past-participle';
    else if (tags.has('present') && tags.has('participle')) type = 'present-participle';
    else if (tags.has('past')) type = 'past';
    else if (tags.has('plural')) type = 'plural';
    else if (tags.has('comparative')) type = 'comparative';
    else if (tags.has('superlative')) type = 'superlative';
    if (type && form && !item.forms.some((candidate) => candidate.form === form && candidate.type === type)) {
      item.forms.push({ form, type });
    }
  }
  simple.set(key, item);
});

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
      if (!pos || !korean.has(key)) continue;
      const item = oewn.get(key) || { lemma, pos, synsets: [], en: [] };
      for (const sense of details.sense || []) {
        if (sense.synset) {
          uniquePush(item.synsets, sense.synset, 5);
          neededSynsets.add(sense.synset);
          if (!synsetOwners.has(sense.synset)) synsetOwners.set(sense.synset, new Set());
          synsetOwners.get(sense.synset).add(key);
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
const curatedKeys = new Set(curated.words.map((word) => keyFor(word.lemma, word.partOfSpeech[0])));
const usedIds = new Set(curated.words.map((word) => word.id));
const candidates = [];
for (const [key, oewnItem] of oewn) {
  if (curatedKeys.has(key) || !oewnItem.en.length) continue;
  const koItem = korean.get(key);
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

const words = candidates.slice(0, limit).map((item) => {
  const id = createId(item.lemma, item.pos);
  return {
    id,
    lemma: item.lemma,
    partOfSpeech: [item.pos],
    status: 'draft',
    meanings: [{ id: `${id}-sense-1`, ko: item.ko, en: item.en, concepts: [] }],
    forms: item.forms,
    relations: [],
    analyses: [],
    sources: ['src-oewn', 'src-kowiktionary', ...(item.hasSimple ? ['src-simplewiktionary'] : [])],
  };
});

const output = {
  meta: {
    generatedAt,
    wordCount: words.length,
    requestedLimit: limit,
    candidateCount: candidates.length,
    sources: {
      oewn: '2025',
      koreanWiktionary: 'Kaikki/Wiktextract raw dump',
      simpleWiktionary: 'Kaikki/Wiktextract raw dump',
    },
    noteKo: 'OEWN 영문 정의와 한국어·Simple Wiktionary 구조화 덤프를 표제어와 품사 기준으로 결합한 자동 수집 데이터입니다.',
  },
  words,
};

await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Wrote ${words.length} imported words from ${candidates.length} candidates to ${outputPath}`);
