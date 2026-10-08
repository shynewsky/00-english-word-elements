const app = document.querySelector('#app');

const state = {
  data: null,
  words: new Map(),
  elements: new Map(),
  elementSenses: new Map(),
  concepts: new Map(),
  sources: new Map(),
  familyMembers: new Map(),
};

const normalize = (value = '') => value.normalize('NFKC').trim().toLocaleLowerCase('en');
const loose = (value = '') => normalize(value).replace(/^[-–—]+|[-–—]+$/g, '');
const unique = (items) => [...new Set(items.filter(Boolean))];
const joinGloss = (items = []) => items.join(', ');

const POS_LABELS = Object.freeze({
  verb: '동사',
  noun: '명사',
  adjective: '형용사',
  adverb: '부사',
});

const ELEMENT_KIND_LABELS = Object.freeze({
  prefix: '접두사',
  suffix: '접미사',
  root: '어근',
  'combining-form': '결합형',
  infix: '접요사',
  circumfix: '환접사',
});

const FORM_LABELS = Object.freeze({
  'base-form': '기본형',
  singular: '단수형',
  'third-person': '3인칭 단수 현재',
  past: '과거형',
  'past-participle': '과거분사',
  'present-participle': '현재분사',
  plural: '복수형',
  comparative: '비교급',
  superlative: '최상급',
});

const RELATION_LABELS = Object.freeze({
  'derived-from': '파생 관계',
  compound: '합성 관계',
  'variant-of': '변이 관계',
  'related-family': '어원 가족',
});

function posLabel(value = '') {
  return POS_LABELS[value] || value;
}

function formLabel(value = '') {
  return FORM_LABELS[value] || value;
}

function elementKindLabel(value = '') {
  return ELEMENT_KIND_LABELS[value] || value;
}

function relationLabel(value = '') {
  return RELATION_LABELS[value] || value;
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function encodeHash(value) {
  return encodeURIComponent(value);
}

function badge(label, className = '') {
  return `<span class="badge ${escapeHtml(className)}">${escapeHtml(label)}</span>`;
}

function conceptText(ids = [], lang = 'ko') {
  return unique(ids.flatMap((id) => state.concepts.get(id)?.labels?.[lang] || []));
}

function elementForSense(senseId) {
  const record = state.elementSenses.get(senseId);
  return record?.element || null;
}

function senseById(senseId) {
  return state.elementSenses.get(senseId)?.sense || null;
}

function wordMeaningText(word) {
  return unique(word.meanings.flatMap((meaning) => [...meaning.ko, ...meaning.en])).join(' · ');
}

function sourceLinks(sourceIds = []) {
  const links = unique(sourceIds).map((id) => state.sources.get(id)).filter(Boolean);
  if (!links.length) return '<p class="muted">등록된 출처가 없습니다.</p>';
  return `<div class="chip-list">${links.map((source) => `<a class="chip" href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.name)} · ${escapeHtml(source.license)}</a>`).join('')}</div>`;
}

function initMaps(data) {
  state.data = data;
  state.words = new Map(data.words.map((word) => [word.id, word]));
  state.elements = new Map(data.elements.map((element) => [element.id, element]));
  state.concepts = new Map(data.concepts.map((concept) => [concept.id, concept]));
  state.sources = new Map(data.sources.map((source) => [source.id, source]));
  state.elementSenses = new Map();
  state.familyMembers = new Map();
  for (const word of data.words) {
    if (!word.familyHeadwordId) continue;
    if (!state.familyMembers.has(word.familyHeadwordId)) state.familyMembers.set(word.familyHeadwordId, []);
    state.familyMembers.get(word.familyHeadwordId).push(word);
  }
  for (const members of state.familyMembers.values()) members.sort((left, right) => left.lemma.localeCompare(right.lemma, 'en'));
  for (const element of data.elements) {
    for (const sense of element.senses) {
      state.elementSenses.set(sense.id, { element, sense });
    }
  }
}

function scoreText(query, value, weights) {
  const q = normalize(query);
  const v = normalize(value);
  if (!q || !v) return 0;
  if (v === q) return weights.exact;
  if (weights.useLoose) {
    const qLoose = loose(query);
    const vLoose = loose(value);
    if (vLoose && vLoose === qLoose) return weights.looseExact ?? weights.exact - 2;
    if (vLoose.startsWith(qLoose)) return weights.prefix;
    if (vLoose.includes(qLoose)) return weights.includes;
  }
  if (v.startsWith(q)) return weights.prefix;
  if (v.includes(q)) return weights.includes;
  return 0;
}

function bestWordMatch(word, query, mode) {
  let best = { score: 0, reason: '', familyMember: null };
  const consider = (score, reason, familyMember = null) => {
    if (score > best.score) best = { score, reason, familyMember };
  };

  if (mode !== 'meaning') {
    consider(scoreText(query, word.lemma, { exact: 140, prefix: 100, includes: 65 }), '표제어 일치');
    for (const form of word.forms) {
      consider(scoreText(query, form.form, { exact: 134, prefix: 94, includes: 58 }), `활용형 ${form.form}을 통해 찾음`);
    }
    if (word.familyHeadwordId === word.id) {
      for (const member of state.familyMembers.get(word.id) || []) {
        if (member.id === word.id) continue;
        const memberScore = scoreText(query, member.lemma, { exact: 128, prefix: 96, includes: 67 });
        consider(memberScore, `${member.lemma}가 속한 어원 가족`, memberScore ? member : null);
        for (const form of member.forms || []) {
          const formScore = scoreText(query, form.form, { exact: 124, prefix: 90, includes: 62 });
          consider(formScore, `${form.form}가 속한 어원 가족`, formScore ? member : null);
        }
      }
    }
  }

  for (const meaning of word.meanings) {
    for (const text of [...meaning.ko, ...meaning.en]) {
      consider(scoreText(query, text, { exact: 98, prefix: 84, includes: 72 }), `단어 뜻 '${text}'와 일치`);
    }
    for (const text of conceptText(meaning.concepts, 'ko').concat(conceptText(meaning.concepts, 'en'))) {
      consider(scoreText(query, text, { exact: 94, prefix: 78, includes: 68 }), `의미 개념 '${text}'와 일치`);
    }
  }
  return best;
}

function bestElementMatch(element, query, mode) {
  let best = { score: 0, reason: '' };
  const consider = (score, reason) => {
    if (score > best.score) best = { score, reason };
  };

  if (mode !== 'meaning') {
    consider(scoreText(query, element.canonicalForm, { exact: 122, looseExact: 120, prefix: 90, includes: 64, useLoose: true }), '형태소 대표형 일치');
    for (const allomorph of element.allomorphs) {
      consider(scoreText(query, allomorph.form, { exact: 118, looseExact: 116, prefix: 88, includes: 62, useLoose: true }), `이형태 ${allomorph.form}와 일치`);
    }
  }

  for (const sense of element.senses) {
    for (const text of [...sense.glossKo, ...sense.glossEn]) {
      consider(scoreText(query, text, { exact: 102, prefix: 86, includes: 74 }), `형태소 뜻 '${text}'와 일치`);
    }
    for (const text of conceptText(sense.concepts, 'ko').concat(conceptText(sense.concepts, 'en'))) {
      consider(scoreText(query, text, { exact: 100, prefix: 82, includes: 70 }), `의미 개념 '${text}'와 일치`);
    }
  }
  return best;
}

function search(query, mode = 'all', elementKind = 'all') {
  if (!query.trim()) return [];
  const results = [];
  if (mode === 'all' || mode === 'word' || mode === 'meaning') {
    for (const word of state.data.words) {
      const match = bestWordMatch(word, query, mode);
      if (match.score > 0) results.push({ type: 'word', entity: word, ...match });
    }
  }
  if (mode === 'all' || mode === 'element' || mode === 'meaning') {
    for (const element of state.data.elements) {
      if (elementKind !== 'all' && element.kind !== elementKind) continue;
      const match = bestElementMatch(element, query, mode);
      if (match.score > 0) results.push({ type: 'element', entity: element, ...match });
    }
  }
  return results.sort((a, b) => b.score - a.score || a.entity.id.localeCompare(b.entity.id)).slice(0, 80);
}

function spellingKey(value = '') {
  return loose(value).replace(/[^a-z]/g, '');
}

function editDistance(leftValue, rightValue) {
  const left = spellingKey(leftValue);
  const right = spellingKey(rightValue);
  const rows = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
  for (let index = 0; index <= left.length; index += 1) rows[index][0] = index;
  for (let index = 0; index <= right.length; index += 1) rows[0][index] = index;
  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      rows[row][column] = Math.min(
        rows[row - 1][column] + 1,
        rows[row][column - 1] + 1,
        rows[row - 1][column - 1] + cost,
      );
      if (row > 1 && column > 1 && left[row - 1] === right[column - 2] && left[row - 2] === right[column - 1]) {
        rows[row][column] = Math.min(rows[row][column], rows[row - 2][column - 2] + 1);
      }
    }
  }
  return rows[left.length][right.length];
}

function spellingSuggestions(query, mode = 'all', elementKind = 'all') {
  const queryKey = spellingKey(query);
  if (queryKey.length < 3) return { words: [], elements: [] };
  const maxDistance = queryKey.length <= 4 ? 1 : queryKey.length <= 7 ? 2 : 3;
  const wordSuggestions = [];
  if (mode === 'all' || mode === 'word') {
    for (const word of state.data.words) {
      const aliases = [word.lemma, ...(word.forms || []).map((form) => form.form)].filter((value) => /^[A-Za-z'-]+$/.test(value));
      const distance = Math.min(...aliases.map((value) => editDistance(queryKey, value)));
      if (distance <= maxDistance) wordSuggestions.push({ entity: word, distance, lengthGap: Math.abs(spellingKey(word.lemma).length - queryKey.length) });
    }
  }
  wordSuggestions.sort((left, right) => left.distance - right.distance || left.lengthGap - right.lengthGap || left.entity.lemma.localeCompare(right.entity.lemma, 'en'));
  const words = wordSuggestions.slice(0, 5);

  const elementSuggestions = [];
  const suggestedElementIds = new Set();
  const addElement = (element, distance, reason) => {
    if (!element || suggestedElementIds.has(element.id) || (elementKind !== 'all' && element.kind !== elementKind)) return;
    suggestedElementIds.add(element.id);
    elementSuggestions.push({ entity: element, distance, reason });
  };
  if (mode === 'all' || mode === 'element') {
    for (const element of state.data.elements) {
      const aliases = [element.canonicalForm, ...element.allomorphs.map((allomorph) => allomorph.form)];
      let bestDistance = Infinity;
      let hasExactBoundary = false;
      let longestAlias = 0;
      for (const alias of aliases) {
        const aliasKey = spellingKey(alias);
        if (!aliasKey) continue;
        longestAlias = Math.max(longestAlias, aliasKey.length);
        hasExactBoundary ||= queryKey.startsWith(aliasKey) || queryKey.endsWith(aliasKey);
        bestDistance = Math.min(bestDistance, editDistance(queryKey, aliasKey));
        for (const delta of [-1, 0, 1]) {
          const length = aliasKey.length + delta;
          if (length >= 2 && queryKey.length >= length) bestDistance = Math.min(bestDistance, editDistance(queryKey.slice(-length), aliasKey));
        }
      }
      if ((hasExactBoundary && bestDistance === 0) || (longestAlias >= 4 && bestDistance <= 1)) addElement(element, bestDistance, '철자 끝부분과 비슷한 형태소');
    }
    for (const suggestion of words.slice(0, 3)) {
      for (const analysis of suggestion.entity.analyses || []) {
        for (const part of analysis.parts || []) {
          if (part.elementSenseId) addElement(elementForSense(part.elementSenseId), suggestion.distance, `${suggestion.entity.lemma}의 구성 형태소`);
        }
      }
    }
  }
  elementSuggestions.sort((left, right) => left.distance - right.distance || left.entity.canonicalForm.localeCompare(right.entity.canonicalForm, 'en'));
  return { words, elements: elementSuggestions.slice(0, 5) };
}

function renderSpellingSuggestions(query, suggestions) {
  if (!suggestions.words.length && !suggestions.elements.length) return '';
  return `<section class="suggestion-panel" aria-label="철자 추천">
    <div class="suggestion-heading"><strong>혹시 이 항목을 찾으셨나요?</strong><span>‘${escapeHtml(query)}’과 철자가 가까운 결과입니다.</span></div>
    ${suggestions.words.length ? `<div class="suggestion-group"><span>비슷한 단어</span><div class="suggestion-links">${suggestions.words.map(({ entity, distance }) => `<a href="#/word/${encodeHash(entity.id)}?from=${encodeHash(query)}"><strong>${escapeHtml(entity.lemma)}</strong><small>${entity.partOfSpeech.map(posLabel).join(' · ')} · ${distance}글자 차이</small></a>`).join('')}</div></div>` : ''}
    ${suggestions.elements.length ? `<div class="suggestion-group"><span>관련 형태소</span><div class="suggestion-links">${suggestions.elements.map(({ entity, reason }) => `<a href="#/element/${encodeHash(entity.id)}?from=${encodeHash(query)}"><strong>${escapeHtml(entity.canonicalForm)}</strong><small>${escapeHtml(entity.kind)} · ${escapeHtml(reason)}</small></a>`).join('')}</div></div>` : ''}
  </section>`;
}

function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [pathPart = 'search', queryString = ''] = raw.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  return {
    view: segments[0] || 'search',
    id: segments[1] ? decodeURIComponent(segments[1]) : null,
    params: new URLSearchParams(queryString),
  };
}

function setSearchRoute(query, mode = 'all', kind = 'all') {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (mode !== 'all') params.set('mode', mode);
  if (kind !== 'all') params.set('kind', kind);
  location.hash = `#/search${params.toString() ? `?${params}` : ''}`;
}

function resultCard(result, query) {
  if (result.type === 'word') {
    const word = result.entity;
    const isFamilyResult = Boolean(result.familyMember);
    const familyMembers = state.familyMembers.get(word.id) || [];
    const href = `#/word/${encodeHash(word.id)}?from=${encodeHash(query)}`;
    return `<a class="result-row${isFamilyResult ? ' family-result' : ''}" href="${href}">
      <span class="result-kind${isFamilyResult ? ' family' : ''}">${isFamilyResult ? '단어 가족' : '단어'}</span>
      <span class="result-entry">
        <span class="result-title-line"><strong>${escapeHtml(word.lemma)}</strong>${word.partOfSpeech.map((pos) => `<span class="pos-label">${escapeHtml(posLabel(pos))}</span>`).join('')}</span>
        <span class="result-gloss">${isFamilyResult ? escapeHtml(familyMembers.map((member) => member.lemma).join(' · ')) : escapeHtml(word.meanings[0]?.ko?.join(', ') || '')}</span>
        <span class="match-reason">${escapeHtml(result.reason)}</span>
      </span>
      <span class="result-arrow" aria-hidden="true">›</span>
    </a>`;
  }
  const element = result.entity;
  const href = `#/element/${encodeHash(element.id)}?from=${encodeHash(query)}`;
  return `<a class="result-row" href="${href}">
    <span class="result-kind element">형태소</span>
    <span class="result-entry">
      <span class="result-title-line"><strong>${escapeHtml(element.canonicalForm)}</strong><span class="pos-label">${escapeHtml(element.kind)}</span><span class="pos-label">${escapeHtml(element.originLanguage)}</span></span>
      <span class="result-gloss">${escapeHtml(element.senses.flatMap((sense) => sense.glossKo).join(' · '))}</span>
      <span class="match-reason">${escapeHtml(result.reason)}</span>
    </span>
    <span class="result-arrow" aria-hidden="true">›</span>
  </a>`;
}

function renderSearch(route) {
  const query = route.params.get('q') || '';
  const mode = ['all', 'word', 'element', 'meaning'].includes(route.params.get('mode')) ? route.params.get('mode') : 'all';
  const kind = route.params.get('kind') || 'all';
  const results = search(query, mode, kind);
  const hasStrongResult = results.some((result) => result.score >= 84);
  const suggestions = query && !hasStrongResult ? spellingSuggestions(query, mode, kind) : { words: [], elements: [] };
  const suggestionsHtml = renderSpellingSuggestions(query, suggestions);
  const kindOptions = ['all', 'prefix', 'suffix', 'root', 'combining-form'];
  const examples = ['running', 'availability', 'in-', '쓰다', 'life'];
  const reviewedWordCount = state.data.words.filter((word) => word.status !== 'draft').length;
  const importedWordCount = state.data.words.length - reviewedWordCount;

  app.innerHTML = `<div class="page search-page">
    <section class="dictionary-masthead">
      <p class="masthead-kicker">WORD ELEMENTS DICTIONARY</p>
      <h1>영어 단어 구조 사전</h1>
      <p>단어의 뜻에서 멈추지 않고 활용형, 파생어, 접사와 어근까지 연결해서 살펴보세요.</p>
      <form class="dictionary-search" id="search-form">
        <label class="sr-only" for="search-input">단어, 형태소 또는 뜻 검색</label>
        <input id="search-input" type="search" autocomplete="off" value="${escapeHtml(query)}" placeholder="영단어, 활용형, 형태소 또는 뜻을 입력하세요">
        <button type="submit">검색</button>
      </form>
      <div class="quick-links" aria-label="검색 예시">
        <span>추천 검색</span>
        ${examples.map((example) => `<button type="button" data-query="${escapeHtml(example)}">${escapeHtml(example)}</button>`).join('')}
      </div>
      <div class="sample-banner"><strong>확장 사전 데이터</strong><span>${state.data.words.length.toLocaleString('ko-KR')}개 단어 · ${state.data.elements.length}개 형태소 · 검수 ${reviewedWordCount.toLocaleString('ko-KR')}개 · 자동 수집 ${importedWordCount.toLocaleString('ko-KR')}개</span></div>
    </section>

    <section class="search-results-panel" aria-label="검색 결과">
      <div class="search-toolbar">
        <div class="mode-buttons" role="group" aria-label="검색 대상">
          ${[['all','통합'],['word','단어'],['element','형태소'],['meaning','뜻']].map(([value,label]) => `<button type="button" data-mode="${value}" aria-pressed="${mode === value}">${label}</button>`).join('')}
        </div>
        <label class="kind-filter-label">형태소 종류
          <select class="filter-select" id="kind-filter" ${mode === 'word' ? 'disabled' : ''}>
            ${kindOptions.map((value) => `<option value="${value}" ${kind === value ? 'selected' : ''}>${value === 'all' ? '전체' : value}</option>`).join('')}
          </select>
        </label>
      </div>
      <p class="result-status" aria-live="polite">${query ? `<strong>‘${escapeHtml(query)}’</strong> 검색 결과 <b>${results.length}</b>개` : '검색어를 입력하거나 아래 사용 예시를 선택하세요.'}</p>
      <div class="results-list">
        ${suggestionsHtml}
        ${query && results.length ? results.map((result) => resultCard(result, query)).join('') : query && suggestionsHtml ? '' : query ? `<div class="empty-state"><strong>‘${escapeHtml(query)}’을 현재 데이터에서 찾지 못했습니다.</strong><span>추천 결과도 없다면 GitHub 데이터에 새 단어를 제안할 수 있습니다.</span></div>` : `<div class="search-help-grid">
          <button type="button" data-query="running"><strong>활용형으로 찾기</strong><span>running을 검색하면 사전형 run과 변화형을 확인합니다.</span></button>
          <button type="button" data-query="availability"><strong>파생어 살펴보기</strong><span>available → availability의 품사 변화를 확인합니다.</span></button>
          <button type="button" data-query="in-"><strong>형태소로 모아보기</strong><span>in-, im-, il-, ir-가 쓰인 단어를 의미별로 봅니다.</span></button>
        </div>`}
      </div>
    </section>
  </div>`;

  document.querySelector('#search-form').addEventListener('submit', (event) => {
    event.preventDefault();
    setSearchRoute(document.querySelector('#search-input').value, mode, kind);
  });
  document.querySelectorAll('[data-query]').forEach((button) => button.addEventListener('click', () => setSearchRoute(button.dataset.query, mode, kind)));
  document.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => setSearchRoute(query, button.dataset.mode, kind)));
  document.querySelector('#kind-filter').addEventListener('change', (event) => setSearchRoute(query, mode, event.target.value));
}

function wordsUsingSense(senseId) {
  return state.data.words.filter((word) => word.analyses.some((analysis) => analysis.parts.some((part) => part.elementSenseId === senseId)));
}

function wordFamily(word) {
  const parents = word.relations.map((relation) => ({ word: state.words.get(relation.targetWordId), relation })).filter((item) => item.word);
  const children = [];
  for (const candidate of state.data.words) {
    for (const relation of candidate.relations) {
      if (relation.targetWordId === word.id) children.push({ word: candidate, relation });
    }
  }
  return { parents, children };
}

function familyOverview(word) {
  const headwordId = word.familyHeadwordId || word.id;
  const headword = state.words.get(headwordId) || word;
  const members = state.familyMembers.get(headwordId) || [word];
  return { headword, members };
}

function pronunciationText(word) {
  const pronunciations = word.pronunciations || [];
  if (!pronunciations.length) return '발음 정보 미등록';
  return pronunciations.map((item) => `${item.variety ? `${item.variety} ` : ''}${item.ipa}`).join(' · ');
}

function renderFamilyMemberCard(member, currentWord) {
  const etymology = member.etymology?.summaryKo || '개별 어원 설명은 아직 등록되지 않았습니다.';
  return `<article class="family-comparison-card${member.id === currentWord.id ? ' is-current' : ''}">
    <div class="family-comparison-heading">
      <a href="#/word/${encodeHash(member.id)}"><strong>${escapeHtml(member.lemma)}</strong></a>
      <span>${member.partOfSpeech.map(posLabel).map(escapeHtml).join(' · ')}</span>
    </div>
    <dl class="family-comparison-meta">
      <div><dt>발음</dt><dd>${escapeHtml(pronunciationText(member))}</dd></div>
      <div><dt>의미</dt><dd>${escapeHtml(member.meanings[0]?.ko?.join(', ') || '')}</dd></div>
      <div><dt>어원</dt><dd>${escapeHtml(etymology)}</dd></div>
    </dl>
  </article>`;
}

function compactSearch(value = '') {
  return `<form class="compact-search" data-compact-search>
    <label class="sr-only" for="compact-search-input">새 검색어</label>
    <input id="compact-search-input" data-compact-search-input type="search" autocomplete="off" value="${escapeHtml(value)}" placeholder="다른 단어 또는 형태소 검색">
    <button type="submit">검색</button>
  </form>`;
}

function bindCompactSearch() {
  const form = document.querySelector('[data-compact-search]');
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    setSearchRoute(form.querySelector('[data-compact-search-input]').value);
  });
  document.querySelectorAll('[data-scroll-target]').forEach((button) => {
    button.addEventListener('click', () => document.getElementById(button.dataset.scrollTarget)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  });
}

function verbPrincipalParts(word) {
  if (!word.partOfSpeech.includes('verb')) return null;
  const past = word.forms.find((form) => form.type === 'past');
  const participle = word.forms.find((form) => form.type === 'past-participle');
  if (!past || !participle) return null;
  return [word.lemma, past.form, participle.form];
}

function verbTenseAspectRows(word) {
  if (!word.partOfSpeech.includes('verb')) return [];
  const form = (type, fallback = '') => word.forms.find((item) => item.type === type)?.form || fallback;
  const base = word.lemma;
  const third = form('third-person');
  const past = form('past');
  const participle = form('past-participle');
  const presentParticiple = form('present-participle');
  if (![third, past, participle, presentParticiple].every(Boolean)) return [];
  return [
    ['현재 단순', base, third],
    ['현재 진행', `am ${presentParticiple}`, `is ${presentParticiple}`],
    ['현재 완료', `have ${participle}`, `has ${participle}`],
    ['현재 완료 진행', `have been ${presentParticiple}`, `has been ${presentParticiple}`],
    ['과거 단순', past, past],
    ['과거 진행', `was ${presentParticiple}`, `was ${presentParticiple}`],
    ['과거 완료', `had ${participle}`, `had ${participle}`],
    ['과거 완료 진행', `had been ${presentParticiple}`, `had been ${presentParticiple}`],
    ['미래 단순', `will ${base}`, `will ${base}`],
    ['미래 진행', `will be ${presentParticiple}`, `will be ${presentParticiple}`],
    ['미래 완료', `will have ${participle}`, `will have ${participle}`],
    ['미래 완료 진행', `will have been ${presentParticiple}`, `will have been ${presentParticiple}`],
  ];
}

function renderVerbTenseAspectTable(word) {
  const rows = verbTenseAspectRows(word);
  if (!rows.length) return '';
  return `<div class="tense-aspect-block">
    <div class="form-group-heading"><h3>I / It 시제 활용</h3><span>주어에 따른 조동사와 동사 형태 비교</span></div>
    <div class="tense-table-scroll"><table class="tense-aspect-table">
      <thead><tr><th scope="col">시제·상</th><th scope="col">I</th><th scope="col">It</th></tr></thead>
      <tbody>${rows.map(([label, iForm, itForm]) => `<tr><th scope="row">${escapeHtml(label)}</th><td><span>I</span> <strong>${escapeHtml(iForm)}</strong></td><td><span>It</span> <strong>${escapeHtml(itForm)}</strong></td></tr>`).join('')}</tbody>
    </table></div>
  </div>`;
}

function wordFormGroups(word, { includeVerb = true } = {}) {
  const groups = [];
  const usedTypes = new Set();
  const forms = word.forms || [];
  const verbTypes = new Set(['third-person', 'past', 'past-participle', 'present-participle']);
  const byTypes = (types) => forms.filter((form) => types.includes(form.type));

  if (word.partOfSpeech.includes('noun')) {
    const numberForms = byTypes(['plural']);
    if (numberForms.length) {
      usedTypes.add('plural');
      groups.push({
        title: '단수·복수형',
        description: '명사의 수에 따른 형태',
        entries: [{ form: word.lemma, type: 'singular' }, ...numberForms],
      });
    }
  }

  if (includeVerb && word.partOfSpeech.includes('verb')) {
    const tenseForms = byTypes(['third-person', 'past']);
    if (tenseForms.length) {
      tenseForms.forEach((form) => usedTypes.add(form.type));
      groups.push({
        title: '시제형',
        description: '기본형과 현재·과거 시제 형태',
        entries: [{ form: word.lemma, type: 'base-form' }, ...tenseForms],
      });
    }
    const participles = byTypes(['past-participle', 'present-participle']);
    if (participles.length) {
      participles.forEach((form) => usedTypes.add(form.type));
      groups.push({
        title: '분사형',
        description: '완료·수동 및 진행에 쓰이는 형태',
        entries: participles,
      });
    }
  }

  if (word.partOfSpeech.some((pos) => pos === 'adjective' || pos === 'adverb')) {
    const degrees = byTypes(['comparative', 'superlative']);
    if (degrees.length) {
      degrees.forEach((form) => usedTypes.add(form.type));
      groups.push({
        title: '비교 형태',
        description: '원급·비교급·최상급',
        entries: [{ form: word.lemma, type: 'base-form' }, ...degrees],
      });
    }
  }

  const remaining = forms.filter((form) => !usedTypes.has(form.type) && (includeVerb || !verbTypes.has(form.type)));
  if (remaining.length) groups.push({ title: '기타 형태', description: '그 밖의 문법적·철자 형태', entries: remaining });
  return groups;
}

function renderFormGroups(word, groups) {
  if (!groups.length) return '';
  return `<div class="form-groups">${groups.map((group) => `<div class="form-group">
    <div class="form-group-heading"><h3>${escapeHtml(group.title)}</h3><span>${escapeHtml(group.description)}</span></div>
    <div class="inflection-grid">${group.entries.map((form) => `<a href="#/word/${encodeHash(word.id)}?from=${encodeHash(form.form)}" class="inflection-card"><strong>${escapeHtml(form.form)}</strong><span>${escapeHtml(formLabel(form.type))}</span></a>`).join('')}</div>
  </div>`).join('')}</div>`;
}

function renderPrincipalParts(word) {
  const parts = verbPrincipalParts(word);
  if (!parts) return '';
  return `<div class="principal-strip">
    <span class="principal-heading">주요 동사 변화</span>
    <span class="principal-line"><strong>${escapeHtml(parts[0])}</strong><i>–</i><strong>${escapeHtml(parts[1])}</strong><i>–</i><strong>${escapeHtml(parts[2])}</strong></span>
    <span class="principal-caption">기본형 · 과거형 · 과거분사</span>
  </div>`;
}

function renderGrammarContent(word) {
  const isVerb = word.partOfSpeech.includes('verb');
  const rows = verbTenseAspectRows(word);
  const nonVerbGroups = wordFormGroups(word, { includeVerb: !isVerb });
  const verbForms = isVerb ? [{ form: word.lemma, type: 'base-form' }, ...(word.forms || []).filter((form) => ['third-person', 'past', 'past-participle', 'present-participle'].includes(form.type))] : [];
  const verbBlock = isVerb ? `${renderPrincipalParts(word)}
    ${rows.length ? renderVerbTenseAspectTable(word) : '<div class="grammar-notice"><strong>시제표 준비 중</strong><span>12시제 표에 필요한 동사 변화형이 모두 등록되면 같은 형식으로 표시됩니다.</span></div>'}
    ${verbForms.length > 1 ? `<details class="verb-forms-details"><summary>기본형 포함 동사 변화 ${verbForms.length}개 보기</summary><div class="inflection-grid">${verbForms.map((form) => `<a href="#/word/${encodeHash(word.id)}?from=${encodeHash(form.form)}" class="inflection-card"><strong>${escapeHtml(form.form)}</strong><span>${escapeHtml(formLabel(form.type))}</span></a>`).join('')}</div></details>` : ''}` : '';
  const otherBlock = renderFormGroups(word, nonVerbGroups);
  return verbBlock || otherBlock ? `${verbBlock}${otherBlock}` : '<div class="consistent-empty"><strong>별도 활용형이 없습니다.</strong><span>현재 표제어 외에 등록된 문법적 변화가 없는 항목입니다.</span></div>'; 
}

function categoryChangeText(fromWord, toWord) {
  const from = fromWord.partOfSpeech.map(posLabel).join('·');
  const to = toWord.partOfSpeech.map(posLabel).join('·');
  return from === to ? `${from} 파생` : `${from} → ${to}`;
}

function familyRelationCard(fromWord, toWord, relation, linkedWord) {
  return `<a class="family-relation-card" href="#/word/${encodeHash(linkedWord.id)}">
    <span class="family-words"><strong>${escapeHtml(fromWord.lemma)}</strong><i aria-hidden="true">→</i><strong>${escapeHtml(toWord.lemma)}</strong></span>
    <span class="family-meta">${escapeHtml(categoryChangeText(fromWord, toWord))} · ${escapeHtml(relationLabel(relation.type))}</span>
    ${relation.noteKo ? `<span class="family-note">${escapeHtml(relation.noteKo)}</span>` : ''}
  </a>`;
}

function renderAnalysis(analysis) {
  const parts = analysis.parts.map((part, index) => {
    let href = '#/search';
    let displayForm = part.surface;
    let kind = part.role === 'base' ? '기본 단어' : part.role;
    let meaning = '';
    if (part.elementSenseId) {
      const element = elementForSense(part.elementSenseId);
      const sense = senseById(part.elementSenseId);
      href = `#/element/${encodeHash(element.id)}?sense=${encodeHash(part.elementSenseId)}`;
      displayForm = element.canonicalForm;
      kind = elementKindLabel(element.kind);
      meaning = sense.glossKo[0];
    } else if (part.wordId) {
      const base = state.words.get(part.wordId);
      href = `#/word/${encodeHash(part.wordId)}`;
      displayForm = base?.lemma || part.surface;
      meaning = base?.meanings?.[0]?.ko?.[0] || '';
    }
    return `${index ? '<span class="plus" aria-hidden="true">+</span>' : ''}<a class="part-card" href="${href}">
      <span class="part-kind">${escapeHtml(kind)}</span>
      <span class="part-surface">${escapeHtml(displayForm)}</span>
      ${displayForm !== part.surface || part.elementSenseId ? `<span class="part-form">단어 속 형태 ${escapeHtml(part.surface)}</span>` : ''}
      ${meaning ? `<span class="part-label">${escapeHtml(meaning)}</span>` : ''}
      ${part.boundaryChangeNote ? `<span class="part-label">${escapeHtml(part.boundaryChangeNote)}</span>` : ''}
    </a>`;
  }).join('');
  return `<article class="analysis-card">
    <div class="analysis-heading"><span>구조 분석</span><div class="badges">${badge(analysis.mode)}${badge(analysis.transparency)}</div></div>
    <div class="decomposition">${parts}</div>
    <p>${escapeHtml(analysis.explanationKo)}</p>
  </article>`;
}

function renderWord(route) {
  const word = state.words.get(route.id);
  if (!word) return renderNotFound('단어를 찾을 수 없습니다.');
  const from = route.params.get('from');
  const matchedForm = from && normalize(from) !== normalize(word.lemma) && word.forms.find((form) => normalize(form.form) === normalize(from));
  const family = wordFamily(word);
  const familyGroup = familyOverview(word);
  const formCount = (word.forms || []).length;
  const grammarContent = renderGrammarContent(word);
  const usedSenseIds = unique(word.analyses.flatMap((analysis) => analysis.parts.map((part) => part.elementSenseId)));
  const relatedGroups = usedSenseIds.map((senseId) => {
    const sense = senseById(senseId);
    const element = elementForSense(senseId);
    const related = wordsUsingSense(senseId).filter((candidate) => candidate.id !== word.id);
    return { senseId, sense, element, related };
  });
  const isImported = word.status === 'draft';

  app.innerHTML = `<div class="page detail-page">
    ${compactSearch(from || word.lemma)}
    <div class="detail-crumb"><a class="back-link" href="#/search${from ? `?q=${encodeHash(from)}` : ''}">검색 결과</a><span>/</span><strong>${escapeHtml(word.lemma)}</strong></div>

    <article class="entry-card">
      <header class="entry-header">
        <div>
          <p class="entry-type">WORD</p>
          <div class="entry-title-line"><h1 tabindex="-1" id="view-title">${escapeHtml(word.lemma)}</h1>${word.partOfSpeech.map((pos) => `<span class="pos-label strong">${escapeHtml(posLabel(pos))}</span>`).join('')}</div>
          <p class="entry-summary">${word.meanings.map((meaning) => escapeHtml(meaning.ko.join(', '))).join(' · ')}</p>
          <p class="entry-pronunciation"><span>발음</span>${escapeHtml(pronunciationText(word))}</p>
        </div>
        <span class="review-status${isImported ? ' auto' : ''}">${isImported ? '자동 수집' : '검수됨'}</span>
      </header>
      ${isImported ? '<p class="import-note">공개 사전 덤프를 표제어와 품사 기준으로 결합한 항목입니다. 형태소 분석과 뜻의 세부 대응은 아직 개별 검수 전입니다.</p>' : ''}
      ${matchedForm ? `<p class="from-note"><strong>${escapeHtml(matchedForm.form)}</strong>은 <strong>${escapeHtml(word.lemma)}</strong>의 ${escapeHtml(formLabel(matchedForm.type))}입니다.</p>` : ''}

      <nav class="entry-nav" aria-label="상세 항목">
        <button type="button" data-scroll-target="meaning">뜻</button><button type="button" data-scroll-target="structure">단어 구조</button><button type="button" data-scroll-target="etymology">어원</button><button type="button" data-scroll-target="forms">문법·활용</button><button type="button" data-scroll-target="family">단어 가족</button>
      </nav>

      <section class="entry-section" id="meaning">
        <h2>뜻</h2>
        <ol class="definition-list">${word.meanings.map((meaning) => `<li><span class="definition-ko">${escapeHtml(meaning.ko.join(', '))}</span><span class="definition-en">${escapeHtml(meaning.en.join('; '))}</span></li>`).join('')}</ol>
      </section>

      <section class="entry-section structure-section" id="structure">
        <div class="section-heading"><h2>단어 구조</h2><span>형태소와 기본 단어</span></div>
        ${word.analyses.length ? word.analyses.map(renderAnalysis).join('') : `<div class="consistent-empty"><strong>검수된 구조 분석이 아직 없습니다.</strong><span>${isImported ? '자동 수집 단어는 잘못된 분해를 피하기 위해 검수 전에는 구조를 추측하지 않습니다.' : '더 작은 학습용 요소로 나누지 않는 기본 단어입니다.'}</span></div>`}
      </section>

      <section class="entry-section etymology-section" id="etymology">
        <div class="section-heading"><h2>어원</h2><span>${word.etymology?.originLanguages?.map(escapeHtml).join(' → ') || '개별 검수 전'}</span></div>
        ${word.etymology ? `<p class="etymology-ko">${escapeHtml(word.etymology.summaryKo)}</p>${word.etymology.summaryEn ? `<p class="etymology-en">${escapeHtml(word.etymology.summaryEn)}</p>` : ''}` : '<div class="consistent-empty"><strong>검수된 어원 설명이 아직 없습니다.</strong><span>자동 수집된 정의와 활용형은 제공하지만 어원 방향은 검수 후 연결합니다.</span></div>'}
      </section>

      <section class="entry-section forms-section" id="forms">
        <div class="section-heading"><h2>문법·활용</h2><span>등록 변화형 ${formCount}개</span></div>
        ${grammarContent}
      </section>

      <section class="entry-section" id="family">
        <div class="section-heading"><h2>단어 가족</h2><span>${familyGroup.members.length > 1 ? `${familyGroup.members.length}개 단어 가족` : '파생 관계'}</span></div>
        ${familyGroup.members.length > 1 ? `<div class="family-root-nav"><span>가족 대표 표제어</span><a href="#/word/${encodeHash(familyGroup.headword.id)}"><strong>${escapeHtml(familyGroup.headword.lemma)}</strong></a></div>
          ${familyGroup.headword.familySummaryKo ? `<p class="family-summary">${escapeHtml(familyGroup.headword.familySummaryKo)}</p>` : ''}
          <div class="family-member-grid">${familyGroup.members.map((member) => renderFamilyMemberCard(member, word)).join('')}</div>` : family.parents.length || family.children.length ? `<div class="family-relations">
            ${family.parents.map(({ word: parent, relation }) => familyRelationCard(parent, word, relation, parent)).join('')}
            ${family.children.map(({ word: child, relation }) => familyRelationCard(word, child, relation, child)).join('')}
          </div>` : '<div class="consistent-empty"><strong>연결된 단어 가족이 아직 없습니다.</strong><span>검수된 파생 관계가 추가되면 같은 위치에 표시됩니다.</span></div>'}
      </section>

      <section class="entry-section">
        <div class="section-heading"><h2>형태소 연결</h2><span>같은 의미 요소를 쓰는 단어</span></div>
        ${relatedGroups.length ? relatedGroups.map(({senseId, sense, element, related}) => `<div class="sense-card"><h3><a href="#/element/${encodeHash(element.id)}?sense=${encodeHash(senseId)}">${escapeHtml(element.canonicalForm)}</a> · ${escapeHtml(sense.glossKo.join(', '))}</h3>${related.length ? `<div class="chip-list">${related.map((candidate) => `<a class="chip" href="#/word/${encodeHash(candidate.id)}">${escapeHtml(candidate.lemma)}</a>`).join('')}</div>` : '<p class="muted">다른 예시가 아직 없습니다.</p>'}</div>`).join('') : '<div class="consistent-empty"><strong>연결된 형태소가 아직 없습니다.</strong><span>구조 분석이 등록되면 관련 접사와 어근을 이곳에서 탐색할 수 있습니다.</span></div>'}
      </section>

      <section class="entry-section source-section"><h2>출처</h2>${sourceLinks(word.sources)}</section>
    </article>
  </div>`;
  bindCompactSearch();
  document.querySelector('#view-title')?.focus({ preventScroll: true });
}

function renderElement(route) {
  const element = state.elements.get(route.id);
  if (!element) return renderNotFound('형태소를 찾을 수 없습니다.');
  const requestedSense = route.params.get('sense');
  app.innerHTML = `<div class="page detail-page">
    ${compactSearch(element.canonicalForm)}
    <div class="detail-crumb"><a class="back-link" href="#/search">검색</a><span>/</span><strong>${escapeHtml(element.canonicalForm)}</strong></div>
    <article class="entry-card">
      <header class="entry-header">
        <div>
          <p class="entry-type">WORD ELEMENT</p>
          <div class="entry-title-line"><h1 tabindex="-1" id="view-title">${escapeHtml(element.canonicalForm)}</h1><span class="pos-label strong">${escapeHtml(element.kind)}</span></div>
          <p class="entry-summary">${escapeHtml(element.senses.flatMap((sense) => sense.glossKo).join(' · '))}</p>
        </div>
        <div class="badges">${badge(element.originLanguage)}${badge(element.bound ? 'bound' : 'free')}</div>
      </header>

      <section class="entry-section">
        <div class="section-heading"><h2>대표형과 이형태</h2><span>발음 환경에 따라 달라지는 꼴</span></div>
        <div class="allomorph-grid">${element.allomorphs.map((item) => `<div><strong>${escapeHtml(item.form)}</strong><span>${escapeHtml(item.conditionKo)}</span></div>`).join('')}</div>
      </section>

      <section class="entry-section">
        <h2>의미별 사용 단어</h2>
        ${element.senses.map((sense) => {
          const examples = wordsUsingSense(sense.id);
          const highlighted = requestedSense === sense.id ? ' is-highlighted' : '';
          return `<article class="sense-card${highlighted}" id="${escapeHtml(sense.id)}">
            <p class="entry-type">${escapeHtml(sense.function)} · ${escapeHtml(sense.productivity)}</p>
            <h3>${escapeHtml(sense.glossKo.join(', '))}</h3>
            <div class="definition-pair"><div><strong>한국어</strong>${escapeHtml(sense.glossKo.join(', '))}</div><div><strong>English</strong>${escapeHtml(sense.glossEn.join(', '))}</div></div>
            <p>${escapeHtml(sense.usageNoteKo)}</p>
            <p class="muted">${escapeHtml(sense.etymologyNoteKo)}</p>
            <div class="section-heading sub"><h3>이 의미로 사용된 단어</h3><span>${examples.length}개</span></div>
            ${examples.length ? `<div class="chip-list">${examples.map((word) => `<a class="chip" href="#/word/${encodeHash(word.id)}">${escapeHtml(word.lemma)}</a>`).join('')}</div>` : '<p class="muted">예시 단어가 아직 없습니다.</p>'}
            ${sourceLinks(sense.sources)}
          </article>`;
        }).join('')}
      </section>
    </article>
  </div>`;
  bindCompactSearch();
  document.querySelector('#view-title')?.focus({ preventScroll: true });
  if (requestedSense) document.querySelector(`#${CSS.escape(requestedSense)}`)?.scrollIntoView({ block: 'center' });
}

function renderNotFound(message) {
  app.innerHTML = `<div class="page"><div class="error-panel"><p class="eyebrow">Not found</p><h1>${escapeHtml(message)}</h1><p><a href="#/search">검색 페이지로 돌아가기</a></p></div></div>`;
}

function renderRoute() {
  if (!state.data) return;
  const route = parseRoute();
  if (route.view === 'word') renderWord(route);
  else if (route.view === 'element') renderElement(route);
  else renderSearch(route);
  if (!(route.view === 'element' && route.params.get('sense'))) window.scrollTo({ top: 0, behavior: 'instant' });
}

async function load() {
  try {
    const catalogUrl = new URL('data/catalog.json?v=0.5.2', document.baseURI);
    const importedUrl = new URL('data/imported-words.json?v=0.5.2', document.baseURI);
    const [catalogResponse, importedResponse] = await Promise.all([fetch(catalogUrl), fetch(importedUrl)]);
    if (!catalogResponse.ok) throw new Error(`catalog HTTP ${catalogResponse.status}`);
    if (!importedResponse.ok) throw new Error(`imported words HTTP ${importedResponse.status}`);
    const [data, imported] = await Promise.all([catalogResponse.json(), importedResponse.json()]);
    const curatedKeys = new Set(data.words.map((word) => `${normalize(word.lemma)}|${[...word.partOfSpeech].sort().join(',')}`));
    const importedWords = imported.words.filter((word) => !curatedKeys.has(`${normalize(word.lemma)}|${[...word.partOfSpeech].sort().join(',')}`));
    data.words = [...data.words, ...importedWords];
    data.meta.imported = { ...imported.meta, loadedWordCount: importedWords.length };
    initMaps(data);
    if (!location.hash) location.hash = '#/search';
    renderRoute();
  } catch (error) {
    app.innerHTML = `<div class="error-panel"><p class="eyebrow">Data error</p><h1>데이터베이스를 불러오지 못했습니다.</h1><p>${escapeHtml(error.message)}</p></div>`;
  }
}

window.addEventListener('hashchange', renderRoute);
load();
