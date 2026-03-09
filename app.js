
/* ═══════════════════════════════════════════════════════════
   STATE
══════════════════════════════════════════════════════════════ */
let plugins = [];

const CAT_META = {
  execution:   { name: 'Execution' },
  fixtures:    { name: 'Fixtures' },
  mocking:     { name: 'Mocking' },
  coverage:    { name: 'Coverage' },
  reporting:   { name: 'Reporting' },
  web:         { name: 'Web & Browser' },
  db:          { name: 'Database' },
  async:       { name: 'Async' },
  performance: { name: 'Performance' },
  quality:     { name: 'Quality' },
  io:          { name: 'Data & Files' },
  devex:       { name: 'Dev Tools' },
  other:       { name: 'Other' },
};

const CAT_COLORS = {
  execution:   '#8fbe5a',
  fixtures:    '#e0d44a',
  mocking:     '#4ab8e0',
  coverage:    '#e0724a',
  reporting:   '#e04a9b',
  web:         '#4ae072',
  db:          '#7a65e6',
  async:       '#4ae0a0',
  performance: '#d4a853',
  quality:     '#4ae0d4',
  io:          '#9b7ee6',
  devex:       '#e0874a',
  other:       '#8a887f',
};

// ML globals
let pluginEmbeddings = {};  // name → Float32Array (64 dims)
let pcaComponents = null;   // Float32Array[64][384]
let pcaMean = null;         // Float32Array[384]
let transformersPipeline = null;
let transformersLoading = false;
let transformersReady = false;
let searchDebounceTimer = null;

const PAGE_SIZE = 20;

const state = {
  search: '',
  sort: 'rank',
  cats: new Set(),          // selected category IDs
  queryEmbedding: null,     // Float32Array(64) during semantic search
  scores: new Map(),        // plugin name → 0–1
  page: 1,
  minStars: 5,
  minDate: '',              // ISO date string or ''
};

const CACHE_KEY = 'pytest-plugins-data';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function getCachedPlugins() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { plugins: cached, fetchedAt } = JSON.parse(raw);
    if (!Array.isArray(cached) || !cached.length || !fetchedAt) return null;
    if (Date.now() - fetchedAt > CACHE_TTL_MS) return null;
    return cached;
  } catch (e) {
    return null;
  }
}

function setCachedPlugins(list) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      plugins: list,
      fetchedAt: Date.now(),
    }));
  } catch (e) { /* quota or disabled */ }
}

const LOCAL_CACHE_FILE = 'plugins-data.json';

async function loadLocalCacheFile() {
  try {
    const r = await fetch(LOCAL_CACHE_FILE);
    if (!r.ok) return null;
    const data = await r.json();
    const list = Array.isArray(data) ? data : (data.plugins);
    if (!Array.isArray(list) || !list.length) return null;
    return list;
  } catch (e) {
    return null;
  }
}

function applyPluginsAndRender(list, labelSuffix = '') {
  plugins = list;
  const el = document.getElementById('statusLabel');
  if (el) el.textContent = `${plugins.length} plugins${labelSuffix}`;
  document.getElementById('loadingState')?.remove();
  buildChips();
  buildFilters();
  render();
}

async function loadAllPlugins() {
  const cached = getCachedPlugins();
  if (cached) {
    applyPluginsAndRender(cached, ' (cached)');
    return;
  }
  const local = await loadLocalCacheFile();
  if (local) {
    applyPluginsAndRender(local);
    return;
  }
  applyPluginsAndRender([], ' (no data)');
}

/* ═══════════════════════════════════════════════════════════
   CHIPS
══════════════════════════════════════════════════════════════ */
function buildChips() {
  // Category chips in horizontal scroll bar
  const catC = document.getElementById('catChips');
  catC.innerHTML = '';
  const sortedCats = Object.entries(CAT_META).sort((a, b) => a[1].name.localeCompare(b[1].name));
  sortedCats.forEach(([id, m]) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.dataset.val = id;
    b.textContent = m.name;
    b.style.setProperty('--chip-active-bg', CAT_COLORS[id] || '#888');
    catC.appendChild(b);
  });

  // Wrap catC in .cat-scroll-wrap if not already wrapped
  if (!catC.parentElement.classList.contains('cat-scroll-wrap')) {
    const wrap = document.createElement('div');
    wrap.className = 'cat-scroll-wrap';
    catC.parentElement.insertBefore(wrap, catC);
    wrap.appendChild(catC);
  }

  // Scroll indicator logic
  const wrap = catC.parentElement;
  function updateScrollIndicators() {
    wrap.classList.toggle('scroll-left', catC.scrollLeft > 2);
    wrap.classList.toggle('scroll-right', catC.scrollLeft + catC.clientWidth < catC.scrollWidth - 2);
  }
  catC.removeEventListener('scroll', catC._scrollIndicatorHandler);
  catC._scrollIndicatorHandler = updateScrollIndicators;
  catC.addEventListener('scroll', updateScrollIndicators);
  updateScrollIndicators();

}

function bindChipListeners() {
  document.getElementById('catChips').addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    const v = b.dataset.val;
    if (currentView === 'graph') {
      // In graph view: chip click highlights only that category's nodes
      if (state.cats.has(v)) {
        // Deselect: restore all nodes to full opacity
        state.cats.delete(v);
        b.classList.remove('active');
        // Sync legend
        document.querySelectorAll('#graphLegend .gl-item').forEach(el => {
          if (el.textContent.trim() === (CAT_META[v]?.name || v)) el.classList.remove('active');
        });
      } else {
        // Select: clear other cats, set only this one
        state.cats.clear();
        document.querySelectorAll('#catChips .chip.active').forEach(c => c.classList.remove('active'));
        document.querySelectorAll('#graphLegend .gl-item.active').forEach(c => c.classList.remove('active'));
        state.cats.add(v);
        b.classList.add('active');
        const chip = document.querySelector(`#catChips .chip[data-val="${v}"]`);
        if (chip) chip.classList.add('active');
        // Sync legend
        document.querySelectorAll('#graphLegend .gl-item').forEach(el => {
          const dotEl = el.querySelector('.gl-dot');
          const dotColor = dotEl ? dotEl.style.background : null;
          if (dotColor === (CAT_COLORS[v] || '') || el.textContent.trim().includes(CAT_META[v]?.name || v)) {
            el.classList.add('active');
          }
        });
      }
      computeScores();
      updateGraphColors();
      return;
    }
    state.cats.has(v) ? state.cats.delete(v) : state.cats.add(v);
    b.classList.toggle('active', state.cats.has(v));
    state.page = 1;
    computeScores();
    render();
  });

}

/* ═══════════════════════════════════════════════════════════
   FILTER + SORT
══════════════════════════════════════════════════════════════ */
function visible(p) {
  // During semantic search show all (coloring conveys relevance)
  if (state.queryEmbedding !== null) return true;
  if (state.cats.size > 0 && !state.cats.has(p.cat)) return false;
  if (state.search) {
    const q = state.search;
    if (!p.name.toLowerCase().includes(q) && !p.summary.toLowerCase().includes(q)) return false;
  }
  if (state.minStars > 0 && (p.stars || 0) < state.minStars) return false;
  if (state.minDate && p.latestDate && p.latestDate < state.minDate) return false;
  return true;
}

function sorted(list) {
  if (state.queryEmbedding !== null) {
    return [...list].sort((a, b) => (state.scores.get(b.name) ?? 0) - (state.scores.get(a.name) ?? 0));
  }
  const s = state.sort;
  return [...list].sort((a, b) => {
    if (s === 'rank') {
      // sort by stars descending
      return (b.stars || 0) - (a.stars || 0);
    }
    if (s === 'name') return a.name.localeCompare(b.name);
    if (s === 'updated') {
      if (!a.latestDate && !b.latestDate) return 0;
      if (!a.latestDate) return 1;
      if (!b.latestDate) return -1;
      return new Date(b.latestDate) - new Date(a.latestDate);
    }
    // category: alphabetical by category name, then stars descending within cat
    const catCmp = (CAT_META[a.cat]?.name || a.cat || '').localeCompare(CAT_META[b.cat]?.name || b.cat || '');
    if (catCmp !== 0) return catCmp;
    return (b.stars || 0) - (a.stars || 0);
  });
}

/* ═══════════════════════════════════════════════════════════
   RENDER
══════════════════════════════════════════════════════════════ */
function makeCard(p, showCat = false) {
  const card = document.createElement('a');
  card.href = p.ghUrl || p.homepage || `https://pypi.org/project/${p.name}/`;
  card.target = '_blank';
  card.rel = 'noopener';
  card.className = 'plugin-card';

  const catLabelText = showCat ? (CAT_META[p.cat]?.name || p.cat || '') : '';
  const catColor = CAT_COLORS[p.cat] || 'var(--border2)';
  const catLabel = catLabelText
    ? `<span class="cat-chip" style="--chip-active-bg:${catColor};background:${catColor}18;color:${catColor};border-color:${catColor}40">${catLabelText}</span>`
    : '';

  const dateStr = p.latestDate
    ? `<span class="badge version">${p.latestDate.slice(0,10)}</span>`
    : '';

  const pypiLink = p.pypiUrl
    ? `<a class="pypi-link" href="${p.pypiUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation()">pypi ↗</a>`
    : '';

  const starsStr = p.stars > 0
    ? `<span class="rank-badge">★ ${p.stars >= 1000 ? (p.stars/1000).toFixed(1)+'k' : p.stars}</span>`
    : '';

  card.innerHTML = `
    <div class="card-top">
      <span class="plugin-name">${p.name}</span>
      ${starsStr}
    </div>
    <div class="plugin-desc">${p.summary}</div>
    <div class="card-meta">
      ${catLabel}
      ${dateStr}
      ${pypiLink}
    </div>
  `;
  return card;
}

function renderPagination(main, totalCount) {
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  if (totalPages <= 1) return;
  const pg = document.createElement('div');
  pg.className = 'pagination';
  pg.innerHTML = `
    <button class="pg-btn" id="pgPrev" ${state.page <= 1 ? 'disabled' : ''}>← prev</button>
    <span class="pg-info">page ${state.page} of ${totalPages}</span>
    <button class="pg-btn" id="pgNext" ${state.page >= totalPages ? 'disabled' : ''}>next →</button>
  `;
  main.appendChild(pg);
  pg.querySelector('#pgPrev').addEventListener('click', () => {
    if (state.page > 1) { state.page--; render(); }
  });
  pg.querySelector('#pgNext').addEventListener('click', () => {
    if (state.page < totalPages) { state.page++; render(); }
  });
}

function render() {
  if (!plugins.length) return;
  // Route to graph view when active so all filter/search changes flow through
  if (currentView === 'graph') {
    computeScores();
    if (graphD3Ready) {
      renderGraphView();      // rebuild nodes/edges based on current filters
      updateGraphColors();    // apply semantic-search coloring if active
    }
    return;
  }
  const main = document.getElementById('main');
  main.innerHTML = '';

  const vis = sorted(plugins.filter(visible));
  const hasFilters = state.search || state.cats.size > 0 || state.queryEmbedding !== null;

  // Clamp page to valid range
  const totalPages = Math.max(1, Math.ceil(vis.length / PAGE_SIZE));
  if (state.page > totalPages) state.page = totalPages;
  if (state.page < 1) state.page = 1;

  const pageSlice = vis.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);

  if (pageSlice.length) {
    const sec = document.createElement('div');
    sec.className = 'cat-section';
    sec.innerHTML = `<div class="plugin-grid" id="flat-g"></div>`;
    main.appendChild(sec);
    const grid = sec.querySelector('#flat-g');
    pageSlice.forEach(p => grid.appendChild(makeCard(p, true)));
  }

  if (!vis.length) {
    main.innerHTML = '<div class="empty">no plugins match</div>';
  }

  renderPagination(main, vis.length);

  document.getElementById('resCount').textContent =
    `${vis.length} plugin${vis.length !== 1 ? 's' : ''}`;
  document.getElementById('clearBtn').classList.toggle('hidden', !hasFilters);
}

/* ═══════════════════════════════════════════════════════════
   CONTROLS
══════════════════════════════════════════════════════════════ */
document.getElementById('search').addEventListener('input', e => {
  const q = e.target.value.trim();
  state.search = q.toLowerCase();
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(async () => {
    if (q.length > 2 && Object.keys(pluginEmbeddings).length > 0) {
      state.queryEmbedding = await getQueryEmbedding(q);
    } else {
      state.queryEmbedding = null;
    }
    state.page = 1;
    computeScores();
    render();
  }, 300);
});
document.getElementById('sortSel').addEventListener('change', e => {
  state.sort = e.target.value;
  state.page = 1;
  render();
});
document.getElementById('clearBtn').addEventListener('click', () => {
  state.search = ''; state.cats.clear(); state.sort = 'rank';
  state.queryEmbedding = null;
  state.scores.clear();
  state.page = 1;
  state.minStars = 5;
  state.minDate = '';
  document.getElementById('search').value = '';
  document.getElementById('sortSel').value = 'rank';
  document.querySelectorAll('.chip.active').forEach(c => c.classList.remove('active'));
  const starsSlider = document.getElementById('starsSlider');
  if (starsSlider) {
    const idx = STARS_EDGES.indexOf(state.minStars);
    starsSlider.value = String(idx >= 0 ? idx : 0);
  }
  const dateSlider = document.getElementById('dateSlider');
  if (dateSlider) { dateSlider.value = dateSlider.min; }
  updateFilterHistograms();
  render();
});

/* ─── theme ──────────────────────────────────────────────── */
let dark = true;
document.getElementById('themeBtn').addEventListener('click', () => {
  dark = !dark;
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  document.getElementById('themeBtn').textContent = dark ? '☽' : '○';
});

/* ═══════════════════════════════════════════════════════════
   ML INFRASTRUCTURE
══════════════════════════════════════════════════════════════ */
async function loadMLData() {
  try {
    const resp = await fetch('data/embeddings.json');
    if (!resp.ok) throw new Error('embeddings not found');
    const embJson = await resp.json();
    pcaComponents = embJson.pca_components.map(row => new Float32Array(row));
    pcaMean = new Float32Array(embJson.pca_mean);
    for (const [name, vec] of Object.entries(embJson.embeddings))
      pluginEmbeddings[name] = new Float32Array(vec);
  } catch (e) {
    console.warn('ML embeddings unavailable, using text search only:', e.message);
  }
}

function getCatColor(pluginName) {
  const p = plugins.find(pl => pl.name === pluginName);
  return CAT_COLORS[p?.cat] || CAT_COLORS.other;
}

// Colormap: score 0 → near-bg (dark/light theme), score 1 → accent gold
function scoreToColor(score) {
  const dark = document.documentElement.dataset.theme !== 'light';
  const lo = dark ? [28, 28, 26] : [230, 228, 224];
  const hi = dark ? [212, 168, 83] : [181, 137, 42]; // --accent
  return `rgb(${Math.round(lo[0]+(hi[0]-lo[0])*score)},${Math.round(lo[1]+(hi[1]-lo[1])*score)},${Math.round(lo[2]+(hi[2]-lo[2])*score)})`;
}

function updateColorbarGradient() {
  const canvas = document.getElementById('colorbarCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dark = document.documentElement.dataset.theme !== 'light';
  const loColor = dark ? 'rgb(28,28,26)' : 'rgb(230,228,224)';
  const hiColor = dark ? 'rgb(212,168,83)' : 'rgb(181,137,42)';
  const grad = ctx.createLinearGradient(0, 0, canvas.width, 0);
  grad.addColorStop(0, loColor);
  grad.addColorStop(1, hiColor);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function updateGraphColors() {
  if (!graphNodeSel) return;
  const hasSearch = state.queryEmbedding !== null;
  const hasCatFilter = state.cats.size > 0;
  graphNodeSel.select('circle')
    .attr('fill', d => hasSearch
      ? scoreToColor(state.scores.get(d.plugin.name) ?? 0)
      : getCatColor(d.plugin.name))
    .attr('fill-opacity', d => {
      if (hasCatFilter && !hasSearch) {
        return state.cats.has(d.plugin.cat) ? 0.9 : 0.12;
      }
      return 0.85;
    })
    .attr('stroke', d => hasSearch
      ? scoreToColor(state.scores.get(d.plugin.name) ?? 0)
      : getCatColor(d.plugin.name))
    .attr('stroke-opacity', d => {
      if (hasCatFilter && !hasSearch) {
        return state.cats.has(d.plugin.cat) ? 0.5 : 0.05;
      }
      return 0.4;
    });
  const cb = document.getElementById('graphColorbar');
  if (cb) {
    cb.classList.toggle('colorbar-visible', hasSearch);
    if (hasSearch) updateColorbarGradient();
  }
}

function dotProduct(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

function computeScores() {
  state.scores.clear();
  const hasSearch = state.queryEmbedding !== null;
  for (const p of plugins) {
    let score = 1;
    if (hasSearch) {
      const emb = pluginEmbeddings[p.name];
      score = emb ? Math.max(0, dotProduct(emb, state.queryEmbedding)) : 0;
    }
    state.scores.set(p.name, score);
  }
}

async function loadTransformers() {
  if (transformersReady || transformersLoading) return;
  transformersLoading = true;

  const statusEl = document.getElementById('searchStatus');
  if (statusEl) statusEl.textContent = 'loading semantic search…';

  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.type = 'module';
    s.textContent = `
      import { pipeline } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2/dist/transformers.min.js';
      try {
        const pipe = await pipeline('feature-extraction', 'Xenova/multi-qa-MiniLM-L6-cos-v1', { quantized: true });
        window.__transformersPipeline = pipe;
        window.dispatchEvent(new Event('transformers-ready'));
      } catch(e) {
        window.dispatchEvent(new CustomEvent('transformers-error', { detail: e }));
      }
    `;
    window.addEventListener('transformers-ready', () => {
      transformersPipeline = window.__transformersPipeline;
      transformersReady = true;
      transformersLoading = false;
      if (statusEl) statusEl.textContent = '';
      resolve();
    }, { once: true });
    window.addEventListener('transformers-error', (e) => {
      transformersLoading = false;
      if (statusEl) statusEl.textContent = '';
      console.warn('transformers.js load failed:', e.detail);
      reject(e.detail);
    }, { once: true });
    document.head.appendChild(s);
  });
}

async function getQueryEmbedding(query) {
  if (!transformersReady) {
    try { await loadTransformers(); } catch(e) { return null; }
  }
  if (!transformersPipeline || !pcaComponents || !pcaMean) return null;

  const output = await transformersPipeline(query, { pooling: 'mean', normalize: true });
  const fullEmb = output.data; // Float32Array(384)

  // Project to PCA space: reduced[j] = dot(pca_components[j], fullEmb - pca_mean)
  const reduced = new Float32Array(64);
  for (let j = 0; j < 64; j++) {
    let dot = 0;
    const comp = pcaComponents[j];
    for (let i = 0; i < 384; i++) dot += comp[i] * (fullEmb[i] - pcaMean[i]);
    reduced[j] = dot;
  }

  // Normalize
  let norm = 0;
  for (let i = 0; i < 64; i++) norm += reduced[i] * reduced[i];
  norm = Math.sqrt(norm);
  if (norm > 1e-8) for (let i = 0; i < 64; i++) reduced[i] /= norm;

  return reduced;
}

/* ═══════════════════════════════════════════════════════════
   FILTER PANEL (stars + date histosliders)
══════════════════════════════════════════════════════════════ */

// Stars: log-scale bin edges
const STARS_EDGES = [0, 1, 5, 10, 25, 50, 100, 250, 500, 1000, Infinity];

function starsLabel(v) {
  if (v === 0) return '0';
  if (v >= 1000) return (v / 1000).toFixed(1) + 'k';
  return String(v);
}

function buildFilters() {
  const panel = document.getElementById('filterPanel');
  if (!panel || !plugins.length) return;
  panel.innerHTML = '';

  // ── Stars widget ──
  const allStars = plugins.map(p => p.stars || 0);

  // Bin counts using STARS_EDGES (last bin edge capped at maxStars)
  const starsBins = STARS_EDGES.slice(0, -1).map((lo, i) => {
    const hi = STARS_EDGES[i + 1];
    return { lo, hi, count: allStars.filter(s => s >= lo && s < hi).length };
  }).filter(b => b.count > 0 || b.lo === 0);

  // slider: index into STARS_EDGES (0 = min 0 stars)
  const starsSliderMax = STARS_EDGES.length - 2; // last real edge index
  const initialStarsIdx = Math.max(0, STARS_EDGES.indexOf(state.minStars));

  const starsWidget = document.createElement('div');
  starsWidget.className = 'filter-widget';
  starsWidget.id = 'starsWidget';
  starsWidget.innerHTML = `
    <div class="filter-label">★ min stars</div>
    <svg class="filter-hist" id="starsHist" width="140" height="28"></svg>
    <div class="filter-slider-row">
      <input type="range" id="starsSlider" min="0" max="${starsSliderMax}" value="${initialStarsIdx}" step="1">
      <span class="filter-val" id="starsVal">${state.minStars === 0 ? 'any' : starsLabel(state.minStars) + '+'}</span>
    </div>
  `;
  panel.appendChild(starsWidget);

  // ── Date widget ──
  const dateStrings = plugins.map(p => p.latestDate).filter(Boolean);
  const years = dateStrings.map(d => parseInt(d.slice(0, 4), 10));
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);

  // Bin by year
  const dateBins = [];
  for (let y = minYear; y <= maxYear; y++) {
    dateBins.push({ year: y, count: years.filter(yr => yr === y).length });
  }

  const dateWidget = document.createElement('div');
  dateWidget.className = 'filter-widget';
  dateWidget.id = 'dateWidget';
  dateWidget.innerHTML = `
    <div class="filter-label">released after</div>
    <svg class="filter-hist" id="dateHist" width="140" height="28"></svg>
    <div class="filter-slider-row">
      <input type="range" id="dateSlider" min="${minYear}" max="${maxYear}" value="${minYear}" step="1">
      <span class="filter-val" id="dateVal">any</span>
    </div>
  `;
  panel.appendChild(dateWidget);

  // Draw histograms initially
  _drawStarsHist(starsBins, 0);
  _drawDateHist(dateBins, minYear);

  // ── Stars slider events ──
  document.getElementById('starsSlider').addEventListener('input', e => {
    const idx = +e.target.value;
    state.minStars = STARS_EDGES[idx];
    const valEl = document.getElementById('starsVal');
    valEl.textContent = state.minStars === 0 ? 'any' : starsLabel(state.minStars) + '+';
    _drawStarsHist(starsBins, idx);
    state.page = 1;
    render();
  });

  // ── Date slider events ──
  document.getElementById('dateSlider').addEventListener('input', e => {
    const yr = +e.target.value;
    state.minDate = yr === minYear ? '' : `${yr}-01-01`;
    const valEl = document.getElementById('dateVal');
    valEl.textContent = yr === minYear ? 'any' : String(yr);
    _drawDateHist(dateBins, yr);
    state.page = 1;
    render();
  });
}

function _drawStarsHist(bins, activeIdx) {
  const svg = document.getElementById('starsHist');
  if (!svg) return;
  const W = 140, H = 28, gap = 1;
  const barW = Math.max(1, Math.floor((W - gap * (bins.length - 1)) / bins.length));
  const maxCount = Math.max(...bins.map(b => b.count), 1);
  svg.innerHTML = '';
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  bins.forEach((b, i) => {
    const barH = Math.max(2, Math.round((b.count / maxCount) * (H - 2)));
    const x = i * (barW + gap);
    const y = H - barH;
    const included = i >= activeIdx;
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', x);
    rect.setAttribute('y', y);
    rect.setAttribute('width', barW);
    rect.setAttribute('height', barH);
    rect.setAttribute('fill', included ? 'var(--accent)' : 'var(--border2)');
    rect.setAttribute('rx', '1');
    svg.appendChild(rect);
  });
}

function _drawDateHist(bins, activeYear) {
  const svg = document.getElementById('dateHist');
  if (!svg) return;
  const W = 140, H = 28, gap = 1;
  const barW = Math.max(1, Math.floor((W - gap * (bins.length - 1)) / bins.length));
  const maxCount = Math.max(...bins.map(b => b.count), 1);
  svg.innerHTML = '';
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  bins.forEach((b, i) => {
    const barH = Math.max(2, Math.round((b.count / maxCount) * (H - 2)));
    const x = i * (barW + gap);
    const y = H - barH;
    const included = b.year >= activeYear;
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', x);
    rect.setAttribute('y', y);
    rect.setAttribute('width', barW);
    rect.setAttribute('height', barH);
    rect.setAttribute('fill', included ? 'var(--accent)' : 'var(--border2)');
    rect.setAttribute('rx', '1');
    svg.appendChild(rect);
  });
}

function updateFilterHistograms() {
  // Redraw based on current state — called after clear
  const starsSlider = document.getElementById('starsSlider');
  const dateSlider = document.getElementById('dateSlider');
  if (!starsSlider || !dateSlider) return;

  const starsIdx = +starsSlider.value;
  const dateStrings = plugins.map(p => p.latestDate).filter(Boolean);
  const years = dateStrings.map(d => parseInt(d.slice(0, 4), 10));
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);

  const allStars = plugins.map(p => p.stars || 0);
  const starsBins = STARS_EDGES.slice(0, -1).map((lo, i) => {
    const hi = STARS_EDGES[i + 1];
    return { lo, hi, count: allStars.filter(s => s >= lo && s < hi).length };
  }).filter(b => b.count > 0 || b.lo === 0);

  const dateBins = [];
  for (let y = minYear; y <= maxYear; y++) {
    dateBins.push({ year: y, count: years.filter(yr => yr === y).length });
  }

  _drawStarsHist(starsBins, starsIdx);
  _drawDateHist(dateBins, +dateSlider.value);

  const starsValEl = document.getElementById('starsVal');
  if (starsValEl) starsValEl.textContent = state.minStars === 0 ? 'any' : starsLabel(state.minStars) + '+';
  const dateValEl = document.getElementById('dateVal');
  if (dateValEl) dateValEl.textContent = !state.minDate ? 'any' : state.minDate.slice(0, 4);
}

/* ═══════════════════════════════════════════════════════════
   GRAPH BROWSER
   Force-directed graph browsing plugins by similarity & topic.
   Similarity = category match (0.5) + keyword Jaccard (0–0.5).
   Top-K nearest neighbors per node become graph edges.
══════════════════════════════════════════════════════════════ */
const GRAPH_STOP_WORDS = new Set([
  'a','an','the','for','in','on','with','and','or','to','of','that','is','are',
  'it','its','be','not','by','from','as','at','this','which','plugin','pytest',
  'test','tests','testing','py','python','use','using','your','you','can','will',
  'support','supports','simple','easy','provides','provide','add','adds',
  'run','running','based','via','per','new','get','set','data','run','make',
]);

let currentView = 'list';
let graphTopK = 5;
let graphShowLabels = true;
let graphFocusId = null;
let graphData = null;
let graphSim = null;
let graphNodeSel = null;
let graphLinkSel = null;
let graphD3Ready = false;

function extractKeywords(text) {
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !GRAPH_STOP_WORDS.has(w))
  );
}

function pluginSimilarity(kwA, kwB, catA, catB) {
  const catScore = catA === catB ? 0.5 : 0;
  let inter = 0;
  for (const k of kwA) if (kwB.has(k)) inter++;
  const union = kwA.size + kwB.size - inter;
  return catScore + (union > 0 ? inter / union : 0) * 0.5;
}

function buildGraphData(list, topK) {
  const kws = list.map(p => extractKeywords(p.name + ' ' + (p.summary || '')));
  const edgeMap = new Map();
  for (let i = 0; i < list.length; i++) {
    const sims = [];
    for (let j = 0; j < list.length; j++) {
      if (i === j) continue;
      sims.push({j, sim: pluginSimilarity(kws[i], kws[j], list[i].cat, list[j].cat)});
    }
    sims.sort((a, b) => b.sim - a.sim);
    for (const {j, sim} of sims.slice(0, topK)) {
      const key = Math.min(i,j) + '-' + Math.max(i,j);
      if ((edgeMap.get(key) || 0) < sim) edgeMap.set(key, sim);
    }
  }
  const nodes = list.map((p, i) => ({id: i, plugin: p}));
  const edges = [];
  for (const [key, weight] of edgeMap) {
    const [s, t] = key.split('-').map(Number);
    edges.push({source: s, target: t, weight});
  }
  return {nodes, edges};
}

function loadD3() {
  if (window.d3) return Promise.resolve(true);
  return new Promise(res => {
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/d3@7/dist/d3.min.js';
    s.onload  = () => res(true);
    s.onerror = () => res(false);
    document.head.appendChild(s);
  });
}

async function initGraph() {
  const panel = document.getElementById('graphPanel');
  const loading = document.createElement('div');
  loading.className = 'graph-loading';
  loading.innerHTML = '<div class="loading-spinner"></div><div class="loading-label">loading graph…</div>';
  panel.appendChild(loading);
  const ok = await loadD3();
  loading.remove();
  if (!ok) {
    const err = document.createElement('div');
    err.className = 'graph-loading';
    err.innerHTML = '<div class="loading-label" style="color:var(--win-n)">could not load D3.js — check connection</div>';
    panel.appendChild(err);
    return;
  }
  graphD3Ready = true;
  renderGraphView();
}

function renderGraphView() {
  if (!window.d3 || !plugins.length) return;
  const vis = plugins.filter(visible);

  // Update shared results bar
  const hasFilters = state.search || state.cats.size > 0 || state.queryEmbedding !== null;
  document.getElementById('resCount').textContent = `${vis.length} plugin${vis.length !== 1 ? 's' : ''}`;
  document.getElementById('clearBtn').classList.toggle('hidden', !hasFilters);

  const svgEl = document.getElementById('graphSvg');
  svgEl.innerHTML = '';
  document.getElementById('nodeDetail').classList.add('hidden');
  graphFocusId = null;
  graphNodeSel = null;
  graphLinkSel = null;

  if (!vis.length) {
    document.getElementById('graphStat').textContent = '—';
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', '50%');
    text.setAttribute('y', '50%');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('fill', 'var(--text3)');
    text.setAttribute('font-size', '12');
    text.setAttribute('dy', '.3em');
    text.textContent = 'no plugins match';
    svgEl.appendChild(text);
    buildGraphLegend([]);
    return;
  }

  graphData = buildGraphData(vis, graphTopK);
  const {nodes, edges} = graphData;
  document.getElementById('graphStat').textContent = `${nodes.length} nodes · ${edges.length} edges`;

  const d3 = window.d3;
  const W = svgEl.clientWidth || 800;
  const H = svgEl.clientHeight || 480;

  // Seed nodes near their category centroid for natural clustering
  const catPos = buildCatPositions(W, H);
  nodes.forEach(n => {
    const seed = catPos[n.plugin.cat];
    n.x = seed ? seed.x + (Math.random()-0.5)*40 : W/2;
    n.y = seed ? seed.y + (Math.random()-0.5)*40 : H/2;
  });

  const svg = d3.select(svgEl);
  const g   = svg.append('g');

  svg.call(
    d3.zoom().scaleExtent([0.1, 6])
      .on('zoom', e => g.attr('transform', e.transform))
  );

  // Edges
  graphLinkSel = g.append('g').selectAll('line')
    .data(edges).join('line')
    .attr('class', 'g-link')
    .attr('stroke-width', d => 0.4 + d.weight * 2);

  // Nodes
  const nodeR = n => 4 + Math.min(Math.sqrt(n.plugin.stars || 0) * 0.35, 10);

  graphNodeSel = g.append('g').selectAll('g')
    .data(nodes).join('g')
    .attr('class', 'g-node')
    .call(
      d3.drag()
        .on('start', (e, d) => { if (!e.active) graphSim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on('drag',  (e, d) => { d.fx = e.x; d.fy = e.y; })
        .on('end',   (e, d) => { if (!e.active) graphSim.alphaTarget(0); d.fx = null; d.fy = null; })
    );

  graphNodeSel.append('circle')
    .attr('r', nodeR)
    .attr('fill', d => getCatColor(d.plugin.name))
    .attr('fill-opacity', 0.85)
    .attr('stroke', d => getCatColor(d.plugin.name))
    .attr('stroke-opacity', 0.4);

  graphNodeSel.append('text')
    .attr('dx', d => nodeR(d) + 3)
    .attr('dy', '0.35em')
    .text(d => d.plugin.name.replace(/^pytest-/, ''))
    .style('display', graphShowLabels ? '' : 'none');

  graphNodeSel
    .on('mouseenter', (e, d) => { if (graphFocusId === null) doHighlight(d); })
    .on('mouseleave', ()      => { if (graphFocusId === null) doClearHighlight(); })
    .on('click', (e, d) => {
      e.stopPropagation();
      if (graphFocusId === d.id) {
        graphFocusId = null;
        doClearHighlight();
        document.getElementById('nodeDetail').classList.add('hidden');
      } else {
        graphFocusId = d.id;
        doHighlight(d);
        showDetail(d);
      }
    });

  // Click on background to deselect
  svg.on('click', () => {
    if (graphFocusId === null) return;
    graphFocusId = null;
    doClearHighlight();
    document.getElementById('nodeDetail').classList.add('hidden');
  });

  if (graphSim) graphSim.stop();
  graphSim = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(edges).id(d => d.id)
      .distance(d => 50 - d.weight * 20)
      .strength(d => d.weight * 0.3))
    .force('charge', d3.forceManyBody().strength(d => -60 - nodeR(d) * 4))
    .force('collide', d3.forceCollide(d => nodeR(d) + 3))
    .force('catX', d3.forceX(d => catPos[d.plugin.cat]?.x ?? W/2).strength(0.04))
    .force('catY', d3.forceY(d => catPos[d.plugin.cat]?.y ?? H/2).strength(0.04))
    .on('tick', () => {
      graphLinkSel
        .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
      graphNodeSel.attr('transform', d => `translate(${d.x},${d.y})`);
    });

  buildGraphLegend(vis);
}

function neighborSet(nodeId) {
  const s = new Set([nodeId]);
  if (!graphData) return s;
  for (const e of graphData.edges) {
    const src = typeof e.source === 'object' ? e.source.id : e.source;
    const tgt = typeof e.target === 'object' ? e.target.id : e.target;
    if (src === nodeId) s.add(tgt);
    if (tgt === nodeId) s.add(src);
  }
  return s;
}

function doHighlight(d) {
  if (!graphNodeSel || !graphLinkSel) return;
  const hovEmb = pluginEmbeddings[d.plugin.name];
  if (hovEmb) {
    // Color all nodes by cosine similarity to the hovered node
    graphNodeSel.select('circle')
      .attr('fill', n => {
        const emb = pluginEmbeddings[n.plugin.name];
        const sim = emb ? Math.max(0, dotProduct(hovEmb, emb)) : 0;
        return scoreToColor(sim);
      })
      .attr('fill-opacity', 0.92)
      .attr('stroke-opacity', 0.5);
    const cb = document.getElementById('graphColorbar');
    if (cb) { cb.classList.add('colorbar-visible'); updateColorbarGradient(); }
  } else {
    const nb = neighborSet(d.id);
    graphNodeSel.select('circle')
      .attr('fill-opacity', n => nb.has(n.id) ? 0.95 : 0.12)
      .attr('stroke-opacity', n => nb.has(n.id) ? 0.8 : 0.05);
  }
  // Always show hovered node label; dim others
  graphNodeSel.select('text')
    .style('display', n => (n.id === d.id || graphShowLabels) ? '' : 'none')
    .style('opacity', n => n.id === d.id ? 1 : (graphShowLabels ? 0.5 : 0.06));
  graphLinkSel.attr('stroke-opacity', e => {
    const s = typeof e.source === 'object' ? e.source.id : e.source;
    const t = typeof e.target === 'object' ? e.target.id : e.target;
    return (s === d.id || t === d.id) ? 0.6 : 0.03;
  });
}

function doClearHighlight() {
  if (!graphNodeSel || !graphLinkSel) return;
  updateGraphColors(); // handles colorbar show/hide for semantic search state
  graphNodeSel.select('text')
    .style('display', graphShowLabels ? '' : 'none')
    .style('opacity', graphShowLabels ? 1 : 0);
  graphLinkSel.attr('stroke-opacity', 0.35);
  // If no semantic search active, hide colorbar (was shown by hover highlight)
  if (state.queryEmbedding === null) {
    const cb = document.getElementById('graphColorbar');
    if (cb) cb.classList.remove('colorbar-visible');
  }
}

function showDetail(d) {
  const panel = document.getElementById('nodeDetail');
  const p     = d.plugin;

  // Collect neighboring edges sorted by weight desc
  const nbEdges = graphData.edges
    .filter(e => {
      const s = typeof e.source === 'object' ? e.source.id : e.source;
      const t = typeof e.target === 'object' ? e.target.id : e.target;
      return s === d.id || t === d.id;
    })
    .map(e => {
      const s   = typeof e.source === 'object' ? e.source.id : e.source;
      const t   = typeof e.target === 'object' ? e.target.id : e.target;
      const nid = s === d.id ? t : s;
      return {node: graphData.nodes.find(n => n.id === nid), w: e.weight};
    })
    .filter(x => x.node)
    .sort((a, b) => b.w - a.w)
    .slice(0, 6);

  const starsStr = p.stars > 0
    ? `<span class="rank-badge">★ ${p.stars >= 1000 ? (p.stars/1000).toFixed(1)+'k' : p.stars}</span>`
    : '';

  panel.innerHTML = `
    <button class="nd-close" id="ndClose">×</button>
    <div class="nd-name">${p.name}</div>
    <div class="nd-cat">${CAT_META[p.cat]?.name || p.cat || ''}</div>
    <div class="nd-desc">${p.summary || ''}</div>
    <div class="nd-meta">${starsStr}</div>
    <div class="nd-links">
      ${p.ghUrl   ? `<a class="nd-link" href="${p.ghUrl}"   target="_blank" rel="noopener">GitHub ↗</a>` : ''}
      ${p.pypiUrl ? `<a class="nd-link" href="${p.pypiUrl}" target="_blank" rel="noopener">PyPI ↗</a>`   : ''}
    </div>
    ${nbEdges.length ? `
      <div class="nd-similar-hdr">Similar plugins</div>
      <div class="nd-similar">
        ${nbEdges.map(({node: n, w}) => `
          <div class="nd-sim-item" data-nid="${n.id}">
            <span class="nd-sim-name">${n.plugin.name}</span>
            <span class="nd-sim-pct">${Math.round(w * 100)}%</span>
          </div>`).join('')}
      </div>` : ''}
  `;
  panel.classList.remove('hidden');

  document.getElementById('ndClose').onclick = e => {
    e.stopPropagation();
    graphFocusId = null;
    doClearHighlight();
    panel.classList.add('hidden');
  };

  panel.querySelectorAll('.nd-sim-item').forEach(el => {
    el.onclick = e => {
      e.stopPropagation();
      const n = graphData.nodes.find(n => n.id === +el.dataset.nid);
      if (n) { graphFocusId = n.id; doHighlight(n); showDetail(n); }
    };
  });
}

function buildGraphLegend(vis) {
  const el = document.getElementById('graphLegend');
  if (!el) return;
  el.innerHTML = '';
  const presentCats = new Set(vis.map(p => p.cat));
  Object.entries(CAT_META).forEach(([id, m]) => {
    if (!presentCats.has(id)) return;
    const item = document.createElement('div');
    item.className = 'gl-item' + (state.cats.has(id) ? ' active' : '');
    item.innerHTML = `<div class="gl-dot" style="background:${CAT_COLORS[id]}"></div>${m.name}`;
    item.onclick = () => {
      state.cats.has(id) ? state.cats.delete(id) : state.cats.add(id);
      item.classList.toggle('active', state.cats.has(id));
      const chip = document.querySelector(`#catChips .chip[data-val="${id}"]`);
      if (chip) chip.classList.toggle('active', state.cats.has(id));
      computeScores();
      updateGraphColors();
    };
    el.appendChild(item);
  });

  // Ensure colorbar exists in the legend row
  if (!document.getElementById('graphColorbar')) {
    const cb = document.createElement('div');
    cb.id = 'graphColorbar';
    cb.className = 'colorbar';
    cb.innerHTML = `
      <span class="colorbar-label">similarity</span>
      <div class="colorbar-track">
        <span class="colorbar-tick">low</span>
        <canvas class="colorbar-bar" id="colorbarCanvas" width="100" height="8"></canvas>
        <span class="colorbar-tick">high</span>
      </div>
    `;
    el.appendChild(cb);
  }
  updateColorbarGradient();
}

function buildCatPositions(W, H) {
  const cats = Object.keys(CAT_META);
  const pos = {};
  cats.forEach((cat, i) => {
    const angle = (i / cats.length) * 2 * Math.PI - Math.PI / 2;
    pos[cat] = {
      x: W / 2 + Math.cos(angle) * W * 0.3,
      y: H / 2 + Math.sin(angle) * H * 0.33,
    };
  });
  return pos;
}

/* ─── view switch ─────────────────────────────────────────── */
function setView(v) {
  currentView = v;
  const isGraph = v === 'graph';
  document.getElementById('main').classList.toggle('hidden', isGraph);
  document.getElementById('graphPanel').classList.toggle('hidden', !isGraph);
  document.getElementById('listViewBtn').classList.toggle('active', !isGraph);
  document.getElementById('graphViewBtn').classList.toggle('active',  isGraph);
  if (isGraph) {
    if (!graphD3Ready) initGraph();
    else renderGraphView();
  }
}

document.getElementById('listViewBtn').addEventListener('click', () => setView('list'));
document.getElementById('graphViewBtn').addEventListener('click', () => setView('graph'));

document.getElementById('topKSlider').addEventListener('input', e => {
  graphTopK = +e.target.value;
  document.getElementById('topKVal').textContent = graphTopK;
  if (currentView === 'graph' && graphD3Ready) renderGraphView();
});

document.getElementById('showLabels').addEventListener('change', e => {
  graphShowLabels = e.target.checked;
  if (graphNodeSel)
    graphNodeSel.select('text').style('display', graphShowLabels ? '' : 'none');
});

document.getElementById('expandGraph').addEventListener('click', () => {
  const panel = document.getElementById('graphPanel');
  panel.classList.toggle('expanded');
  setTimeout(() => {
    if (graphSim) {
      const svg = document.getElementById('graphSvg');
      const W = svg.clientWidth || 800, H = svg.clientHeight || 480;
      graphSim.force('center', d3.forceCenter(W/2, H/2))
               .alpha(0.3).restart();
    }
  }, 60);
});

/* ─── init ───────────────────────────────────────────────── */
bindChipListeners();
loadAllPlugins();
loadMLData(); // non-blocking, runs in parallel
