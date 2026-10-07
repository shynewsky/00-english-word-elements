const app = document.querySelector('#app');

const state = {
  data: null,
  words: new Map(),
  elements: new Map(),
  elementSenses: new Map(),
  concepts: new Map(),
  sources: new Map(),
};

const normalize = (value = '') => value.normalize('NFKC').trim().toLocaleLowerCase('en');
const loose = (value = '') => normalize(value).replace(/^[-–—]+|[-–—]+$/g, '');
const unique = (items) => [...new Set(items.filter(Boolean))];
const joinGloss = (items = []) => items.join(', ');

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
  for (const element of data.elements) {
    for (const sense of element.senses) {
      state.elementSenses.set(sense.id, { element, sense });
    }
  }
}

function scoreText(query, value, weights) {
  const q = normalize(query);
  const v = normalize(value);
  const qLoose = loose(query);
  const vLoose = loose(value);
  if (!q || !v) return 0;
  if (v === q) return weights.exact;
  if (vLoose && vLoose === qLoose) return weights.looseExact ?? weights.exact - 2;
  if (v.startsWith(q) || vLoose.startsWith(qLoose)) return weights.prefix;
  if (v.includes(q) || vLoose.includes(qLoose)) return weights.includes;
  return 0;
}

function bestWordMatch(word, query, mode) {
  let best = { score: 0, reason: '' };
  const consider = (score, reason) => {
    if (score > best.score) best = { score, reason };
  };

  if (mode !== 'meaning') {
    consider(scoreText(query, word.lemma, { exact: 120, prefix: 92, includes: 65 }), '표제어 일치');
    for (const form of word.forms) {
      consider(scoreText(query, form.form, { exact: 114, prefix: 84, includes: 58 }), `활용형 ${form.form}을 통해 찾음`);
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
    consider(scoreText(query, element.canonicalForm, { exact: 122, looseExact: 120, prefix: 90, includes: 64 }), '형태소 대표형 일치');
    for (const allomorph of element.allomorphs) {
      consider(scoreText(query, allomorph.form, { exact: 118, looseExact: 116, prefix: 88, includes: 62 }), `이형태 ${allomorph.form}와 일치`);
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
    const href = `#/word/${encodeHash(word.id)}?from=${encodeHash(query)}`;
    return `<a class="result-card" href="${href}">
      <div class="result-top">
        <div><p class="eyebrow">Word</p><h2>${escapeHtml(word.lemma)}</h2></div>
        <div class="badges">${word.partOfSpeech.map((pos) => badge(pos)).join('')}</div>
      </div>
      <p>${escapeHtml(word.meanings[0]?.ko?.join(', ') || '')}</p>
      <span class="match-reason">${escapeHtml(result.reason)}</span>
    </a>`;
  }
  const element = result.entity;
  const href = `#/element/${encodeHash(element.id)}?from=${encodeHash(query)}`;
  return `<a class="result-card" href="${href}">
    <div class="result-top">
      <div><p class="eyebrow">Word element</p><h2>${escapeHtml(element.canonicalForm)}</h2></div>
      <div class="badges">${badge(element.kind, element.kind)}${badge(element.originLanguage)}</div>
    </div>
    <p>${escapeHtml(element.senses.flatMap((sense) => sense.glossKo).join(' · '))}</p>
    <span class="match-reason">${escapeHtml(result.reason)}</span>
  </a>`;
}

function renderSearch(route) {
  const query = route.params.get('q') || '';
  const mode = ['all', 'word', 'element', 'meaning'].includes(route.params.get('mode')) ? route.params.get('mode') : 'all';
  const kind = route.params.get('kind') || 'all';
  const results = search(query, mode, kind);
  const kindOptions = ['all', 'prefix', 'suffix', 'root', 'combining-form'];

  app.innerHTML = `<div class="page">
    <section class="hero">
      <div class="hero-content">
        <p class="eyebrow">Morpheme explorer</p>
        <h1>단어를 외우지 말고, 구조를 읽어보세요.</h1>
        <p class="hero-copy">영단어, 활용형, 접두사, 접미사, 그리스·라틴계 어근을 검색하고 같은 형태소 의미를 공유하는 단어를 함께 살펴봅니다.</p>
        <form class="search-form" id="search-form">
          <label class="sr-only" for="search-input">단어, 형태소 또는 뜻 검색</label>
          <input class="search-box" id="search-input" type="search" autocomplete="off" value="${escapeHtml(query)}" placeholder="예: running, in-, 쓰다, life">
          <button class="primary-button" type="submit">검색</button>
        </form>
        <div class="quick-links" aria-label="검색 예시">
          ${['running', 'in-', '쓰다', 'life', 'transport'].map((example) => `<button type="button" data-query="${escapeHtml(example)}">${escapeHtml(example)}</button>`).join('')}
        </div>
      </div>
    </section>

    <section aria-label="검색 결과">
      <div class="search-toolbar">
        <div class="mode-buttons" role="group" aria-label="검색 대상">
          ${[['all','전체'],['word','단어'],['element','형태소'],['meaning','의미']].map(([value,label]) => `<button type="button" data-mode="${value}" aria-pressed="${mode === value}">${label}</button>`).join('')}
        </div>
        <label>형태소 종류
          <select class="filter-select" id="kind-filter" ${mode === 'word' ? 'disabled' : ''}>
            ${kindOptions.map((value) => `<option value="${value}" ${kind === value ? 'selected' : ''}>${value === 'all' ? '전체' : value}</option>`).join('')}
          </select>
        </label>
      </div>
      <p class="result-status" aria-live="polite">${query ? `<strong>${escapeHtml(query)}</strong> 검색 결과 ${results.length}개` : '단어, 형태소 또는 한국어·영어 뜻을 입력하세요.'}</p>
      <div class="results-grid">
        ${query && results.length ? results.map((result) => resultCard(result, query)).join('') : query ? '<div class="empty-state">일치하는 결과가 없습니다. 철자나 검색 대상을 바꿔보세요.</div>' : '<div class="empty-state">위 검색 예시를 눌러 데이터 구조를 살펴볼 수 있습니다.</div>'}
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

function renderAnalysis(analysis) {
  const parts = analysis.parts.map((part, index) => {
    let href = '#/search';
    let label = part.role;
    if (part.elementSenseId) {
      const element = elementForSense(part.elementSenseId);
      const sense = senseById(part.elementSenseId);
      href = `#/element/${encodeHash(element.id)}?sense=${encodeHash(part.elementSenseId)}`;
      label = `${element.kind} · ${sense.glossKo[0]}`;
    } else if (part.wordId) {
      const base = state.words.get(part.wordId);
      href = `#/word/${encodeHash(part.wordId)}`;
      label = `base word · ${base?.lemma || part.wordId}`;
    }
    return `${index ? '<span class="plus" aria-hidden="true">+</span>' : ''}<a class="part-card" href="${href}"><span class="part-surface">${escapeHtml(part.surface)}</span><span class="part-label">${escapeHtml(label)}</span>${part.boundaryChangeNote ? `<span class="part-label">${escapeHtml(part.boundaryChangeNote)}</span>` : ''}</a>`;
  }).join('');
  return `<div class="sense-card">
    <div class="badges">${badge(analysis.mode)}${badge(analysis.transparency)}</div>
    <div class="decomposition">${parts}</div>
    <p>${escapeHtml(analysis.explanationKo)}</p>
  </div>`;
}

function renderWord(route) {
  const word = state.words.get(route.id);
  if (!word) return renderNotFound('단어를 찾을 수 없습니다.');
  const from = route.params.get('from');
  const matchedForm = from && word.forms.find((form) => normalize(form.form) === normalize(from));
  const family = wordFamily(word);
  const usedSenseIds = unique(word.analyses.flatMap((analysis) => analysis.parts.map((part) => part.elementSenseId)));
  const relatedGroups = usedSenseIds.map((senseId) => {
    const sense = senseById(senseId);
    const element = elementForSense(senseId);
    const related = wordsUsingSense(senseId).filter((candidate) => candidate.id !== word.id);
    return { senseId, sense, element, related };
  });

  app.innerHTML = `<div class="page">
    <a class="back-link" href="#/search${from ? `?q=${encodeHash(from)}` : ''}">← 검색으로</a>
    <header class="detail-header">
      <div>
        <p class="eyebrow">Word</p>
        <h1 tabindex="-1" id="view-title">${escapeHtml(word.lemma)}</h1>
        <p class="detail-subtitle">${word.meanings.map((meaning) => escapeHtml(meaning.ko.join(', '))).join(' · ')}</p>
      </div>
      <div class="badges">${word.partOfSpeech.map((pos) => badge(pos)).join('')}${badge(word.status)}</div>
    </header>
    ${matchedForm ? `<p class="from-note"><strong>${escapeHtml(matchedForm.form)}</strong>의 사전형은 <strong>${escapeHtml(word.lemma)}</strong>입니다. <span class="muted">${escapeHtml(matchedForm.type)}</span></p>` : ''}

    <section class="section-card">
      <h2>뜻</h2>
      ${word.meanings.map((meaning) => `<div class="definition-pair"><div><strong>한국어</strong>${escapeHtml(meaning.ko.join(', '))}</div><div><strong>English</strong>${escapeHtml(meaning.en.join('; '))}</div></div>`).join('')}
    </section>

    <section class="section-card">
      <h2>단어 구조</h2>
      ${word.analyses.length ? word.analyses.map(renderAnalysis).join('') : '<p class="muted">이 단어는 현재 더 작은 학습용 요소로 분석하지 않았습니다.</p>'}
    </section>

    <section class="section-card">
      <h2>활용형과 철자 변형</h2>
      ${word.forms.length ? `<div class="chip-list">${word.forms.map((form) => `<a class="chip" href="#/word/${encodeHash(word.id)}?from=${encodeHash(form.form)}">${escapeHtml(form.form)} · ${escapeHtml(form.type)}</a>`).join('')}</div>` : '<p class="muted">등록된 활용형이 없습니다.</p>'}
    </section>

    <section class="section-card">
      <h2>단어 가족</h2>
      <h3>파생 기반</h3>
      ${family.parents.length ? `<div class="chip-list">${family.parents.map(({word: parent, relation}) => `<a class="chip" href="#/word/${encodeHash(parent.id)}">${escapeHtml(parent.lemma)} · ${escapeHtml(relation.type)}</a>`).join('')}</div>` : '<p class="muted">등록된 파생 기반이 없습니다.</p>'}
      <h3>파생어</h3>
      ${family.children.length ? `<div class="chip-list">${family.children.map(({word: child, relation}) => `<a class="chip" href="#/word/${encodeHash(child.id)}">${escapeHtml(child.lemma)} · ${escapeHtml(relation.type)}</a>`).join('')}</div>` : '<p class="muted">등록된 직접 파생어가 없습니다.</p>'}
    </section>

    <section class="section-card">
      <h2>같은 형태소 의미를 쓰는 단어</h2>
      ${relatedGroups.length ? relatedGroups.map(({senseId, sense, element, related}) => `<div class="sense-card"><h3><a href="#/element/${encodeHash(element.id)}?sense=${encodeHash(senseId)}">${escapeHtml(element.canonicalForm)}</a> · ${escapeHtml(sense.glossKo.join(', '))}</h3>${related.length ? `<div class="chip-list">${related.map((candidate) => `<a class="chip" href="#/word/${encodeHash(candidate.id)}">${escapeHtml(candidate.lemma)}</a>`).join('')}</div>` : '<p class="muted">다른 예시가 아직 없습니다.</p>'}</div>`).join('') : '<p class="muted">연결된 형태소 의미가 없습니다.</p>'}
    </section>

    <section class="section-card"><h2>출처</h2>${sourceLinks(word.sources)}</section>
  </div>`;
  document.querySelector('#view-title')?.focus({ preventScroll: true });
}

function renderElement(route) {
  const element = state.elements.get(route.id);
  if (!element) return renderNotFound('형태소를 찾을 수 없습니다.');
  const requestedSense = route.params.get('sense');
  app.innerHTML = `<div class="page">
    <a class="back-link" href="#/search">← 검색으로</a>
    <header class="detail-header">
      <div>
        <p class="eyebrow">Word element</p>
        <h1 tabindex="-1" id="view-title">${escapeHtml(element.canonicalForm)}</h1>
        <p class="detail-subtitle">${escapeHtml(element.senses.flatMap((sense) => sense.glossKo).join(' · '))}</p>
      </div>
      <div class="badges">${badge(element.kind, element.kind)}${badge(element.originLanguage)}${badge(element.bound ? 'bound' : 'free')}</div>
    </header>

    <section class="section-card">
      <h2>대표형과 이형태</h2>
      <div class="chip-list">${element.allomorphs.map((item) => `<span class="chip" title="${escapeHtml(item.conditionKo)}">${escapeHtml(item.form)} · ${escapeHtml(item.conditionKo)}</span>`).join('')}</div>
    </section>

    <section class="section-card">
      <h2>의미별 사용 단어</h2>
      ${element.senses.map((sense) => {
        const examples = wordsUsingSense(sense.id);
        const highlighted = requestedSense === sense.id ? ' style="border-color: var(--forest); box-shadow: 0 0 0 3px rgba(38,116,90,.12)"' : '';
        return `<article class="sense-card" id="${escapeHtml(sense.id)}"${highlighted}>
          <p class="eyebrow">${escapeHtml(sense.function)} · ${escapeHtml(sense.productivity)}</p>
          <h3>${escapeHtml(sense.glossKo.join(', '))}</h3>
          <div class="definition-pair"><div><strong>한국어</strong>${escapeHtml(sense.glossKo.join(', '))}</div><div><strong>English</strong>${escapeHtml(sense.glossEn.join(', '))}</div></div>
          <p>${escapeHtml(sense.usageNoteKo)}</p>
          <p class="muted">${escapeHtml(sense.etymologyNoteKo)}</p>
          <h3>이 의미로 사용된 단어 ${examples.length}개</h3>
          ${examples.length ? `<div class="chip-list">${examples.map((word) => `<a class="chip" href="#/word/${encodeHash(word.id)}">${escapeHtml(word.lemma)}</a>`).join('')}</div>` : '<p class="muted">예시 단어가 아직 없습니다.</p>'}
          ${sourceLinks(sense.sources)}
        </article>`;
      }).join('')}
    </section>
  </div>`;
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
  window.scrollTo({ top: 0, behavior: 'instant' });
}

async function load() {
  try {
    const dataUrl = new URL('data/catalog.json', document.baseURI);
    const response = await fetch(dataUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    initMaps(await response.json());
    if (!location.hash) location.hash = '#/search';
    renderRoute();
  } catch (error) {
    app.innerHTML = `<div class="error-panel"><p class="eyebrow">Data error</p><h1>데이터베이스를 불러오지 못했습니다.</h1><p>${escapeHtml(error.message)}</p></div>`;
  }
}

window.addEventListener('hashchange', renderRoute);
load();
