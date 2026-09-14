/* =============================================================================
 * pescert certification dashboard
 *
 * A single-page, dependency-free view over `index.json` (one row per model, one
 * column per certification probe).  Per-element breakdowns are pulled lazily
 * from each model's `report_full.json` only when a cell is opened.
 *
 * Data root defaults to the page's own directory: `publish.sh` writes index.json and
 * the per-model folders next to this file, so the published tree is self-contained
 * and needs no server config.  Override with `?root=<url>` to point at another run.
 * ========================================================================== */

'use strict';

const QS   = new URLSearchParams(location.search);
const ROOT = (QS.get('root') || '.').replace(/\/$/, '');

/* ---------------------------------------------------------------- utilities */

const $  = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const isNum = (x) => typeof x === 'number' && isFinite(x);

/** HTML-escape for anything interpolated into a template string. */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** 2-significant-digit scientific notation, e.g. 4.6e-6. */
function sci(x, digits = 1) {
  if (!isNum(x)) return '-';
  if (x === 0) return '0';
  let e = Math.floor(Math.log10(Math.abs(x)));
  let m = x / Math.pow(10, e);
  /* the mantissa can round up to 10 (9.99e-12 -> 1.0e-11); carry the exponent */
  if (Math.abs(Number(m.toFixed(digits))) >= 10) { m /= 10; e += 1; }
  return `${m.toFixed(digits)}e${e}`;
}

/** Score in [0,1] -> short string that never rounds a near-perfect score to 1. */
/**
 * Score as a plain 4-decimal number.
 *
 * Truncated rather than rounded, so a score below 1 never prints as "1.0000": at this
 * width almost every symmetry probe would round up, and a cell claiming an exact
 * identity the model does not satisfy is worse than a slightly pessimistic digit.
 * Full precision is in the cell card, and the Defect view shows the raw residual.
 */
function fmtScore(s) {
  if (!isNum(s)) return '-';
  if (s >= 1) return '1.0000';
  if (s <= 0) return '0.0000';
  return (Math.floor(s * 1e4) / 1e4).toFixed(4);
}

/**
 * -log10(1 - score), used only to give bars and colour scales a usable dynamic range:
 * scores cluster against 1, so a linear mapping would put almost every bar at full
 * length. It is never shown as a number.
 */
function nines(s) {
  if (!isNum(s)) return NaN;
  if (s <= 0) return 0;
  const d = 1 - s;
  if (d <= 1e-16) return 16;
  return clamp(-Math.log10(d), 0, 16);
}

function fmtSI(x) {
  if (!isNum(x)) return '-';
  const a = Math.abs(x);
  if (a >= 1e9) return (x / 1e9).toFixed(a >= 1e10 ? 0 : 1) + 'B';
  if (a >= 1e6) return (x / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
  if (a >= 1e3) return (x / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'k';
  return String(x);
}

function fmtDuration(sec) {
  if (!isNum(sec)) return '-';
  if (sec < 90) return sec.toFixed(0) + ' s';
  if (sec < 5400) return (sec / 60).toFixed(1) + ' min';
  return (sec / 3600).toFixed(1) + ' h';
}

/** Combine per-probe scores exactly as pescert.result.combine_scores does. */
function combine(scores, method) {
  const s = scores.filter(isNum);
  if (!s.length) return NaN;
  if (method === 'arithmetic') return s.reduce((a, b) => a + b, 0) / s.length;
  const cl = s.map((x) => clamp(x, 1e-12, 1.0));
  if (method === 'geometric') {
    return Math.exp(cl.reduce((a, b) => a + Math.log(b), 0) / cl.length);
  }
  if (method === 'harmonic') {
    return cl.length / cl.reduce((a, b) => a + 1 / b, 0);
  }
  throw new Error('unknown mean ' + method);
}

/* ------------------------------------------------------------ colour ramps */

/* ----------------------------------------------------------- colour palette */

/*
 * Lifted from `_scripts/plot_heatmap.py` so the page and the paper figure agree.
 *
 * Probe columns are tinted by the colour of the section their probe belongs to, using
 * seaborn's `light_palette` ramp (a pale neutral up to the section colour). Dark mode
 * uses `dark_palette` instead, which keeps the same hue but starts from a dark neutral
 * so the cells do not turn the table into a bright island. Both ramps are a linear RGB
 * blend between their endpoints, which is why two stops reproduce seaborn to within one
 * 8-bit level; the endpoints below came out of seaborn itself.
 *
 * The overall column uses matplotlib's plasma, sampled at 64 anchors and interpolated.
 */
const SECTION_RAMP = {
  "Symmetry & invariance": { base: '#2F6DB0', light: ['#f0f1f2', '#2f6db0'], dark: ['#24262a', '#2f6db0'] },
  "Self-consistency": { base: '#E07B1A', light: ['#f3f0ef', '#e07b1a'], dark: ['#2b2422', '#e07b1a'] },
  "Statistical mechanics": { base: '#2E9E6B', light: ['#ebf3ee', '#2e9e6b'], dark: ['#222724', '#2e9e6b'] },
  "Regularity": { base: '#8158C4', light: ['#f1f0f2', '#8158c4'], dark: ['#27252c', '#8158c4'] }
};

const PLASMA = [
  '#0d0887', '#19068c', '#220690', '#2a0593', '#310597', '#38049a', '#3f049c', '#46039f',
  '#4c02a1', '#5302a3', '#5901a5', '#6100a7', '#6700a8', '#6e00a8', '#7401a8', '#7a02a8',
  '#8004a8', '#8606a6', '#8b0aa5', '#910ea3', '#9613a1', '#9c179e', '#a11b9b', '#a62098',
  '#ab2494', '#b02991', '#b42e8d', '#b83289', '#bd3786', '#c13b82', '#c5407e', '#c9447a',
  '#cd4a76', '#d14e72', '#d5536f', '#d8576b', '#db5c68', '#de6164', '#e26561', '#e56a5d',
  '#e76f5a', '#ea7457', '#ed7953', '#ef7e50', '#f1834c', '#f48849', '#f68d45', '#f79342',
  '#f9983e', '#fa9e3b', '#fca338', '#fca934', '#fdaf31', '#feb72d', '#febd2a', '#fdc328',
  '#fdca26', '#fcd025', '#fbd724', '#f9dd25', '#f7e425', '#f5eb27', '#f2f227', '#f0f921'
];

const DEFAULT_RAMP = { light: ['#eef0f2', '#4b5563'], dark: ['#22262c', '#9aa4b4'] };

const isDark = () => document.documentElement.dataset.theme === 'dark';

function lerp3(a, b, t) {
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t));
}

function hexRGB(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function sectionOf(probeName) {
  return (PROBES.find((p) => p.name === probeName) || {}).section;
}

/** Section ramp for a probe column, theme-aware. */
function rampFor(section) {
  const r = SECTION_RAMP[section] || DEFAULT_RAMP;
  const pair = isDark() ? (r.dark || DEFAULT_RAMP.dark) : (r.light || DEFAULT_RAMP.light);
  return [hexRGB(pair[0]), hexRGB(pair[1])];
}

/** plasma(t), linear between the stored anchors. */
function plasmaAt(t) {
  t = clamp(t, 0, 1) * (PLASMA.length - 1);
  const i = Math.floor(t);
  const a = hexRGB(PLASMA[i]);
  if (i >= PLASMA.length - 1) return a;
  return lerp3(a, hexRGB(PLASMA[i + 1]), t - i);
}

/**
 * Fill for one cell. `key` is a probe name (tinted by its section) or 'overall'
 * (plasma). Returns the rgb string and the text colour that stays readable on it.
 */
function cellColor(t, key) {
  if (!isNum(t)) return null;
  let c;
  if (key === 'overall') {
    c = plasmaAt(t);
  } else {
    const [lo, hi] = rampFor(sectionOf(key));
    c = lerp3(lo, hi, clamp(t, 0, 1));
  }
  const lum = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
  return { bg: `rgb(${c[0]},${c[1]},${c[2]})`, fg: lum > 0.6 ? '#0d1117' : '#f0f3f6' };
}

/** Opaque colour for bars, taking the same ramp as the column it belongs to. */
function barColor(t, key) {
  const c = cellColor(t, key);
  return c ? c.bg : 'var(--border-strong)';
}

/* Categorical palette for architecture families (scatter + chips). */
const FAM_COLORS = [
  '#4c78a8', '#f58518', '#54a24b', '#e45756', '#72b7b2', '#b279a2',
  '#ff9da6', '#9d755d', '#bab0ac', '#8c6bb1', '#2f8f9d', '#d4a017',
  '#6a8f3c', '#c3553b', '#7f7fd5', '#3d9970', '#aa6f73', '#556270',
  '#e07b39', '#4f6d7a', '#8d6a9f'
];
const famColor = (fam) => FAM_COLORS[FAMILIES.indexOf(fam) % FAM_COLORS.length];

/* ------------------------------------------------------------------- state */

/* Every model-detail column starts hidden: the probe columns are the table, and the
   details are one click away on the "Model details" button. */
const DEFAULT_OFF_META = ['family', 'params', 'dataset', 'nstruct', 'precision', 'calls', 'wall'];
/* What the button turns on, rather than everything at once. */
const META_ON_DEFAULT = ['params', 'dataset', 'precision'];

const S = {
  mean: 'geometric',
  value: 'score',
  color: 'score',
  sortKey: 'overall',
  sortDir: -1,               // -1 = best first
  search: '',
  offProbes: new Set(),      // probe names hidden (and excluded from the overall)
  offMeta: new Set(DEFAULT_OFF_META),
  datasets: new Set(),       // selected training sets
  dsMode: 'any',             // any | all | only
  offFamilies: new Set(),
  pinned: new Set(),
  scatter: false,
  chart: 'size'
};

let DATA, LINKS, PROBEDOC;
let PROBES = [], SECTIONS = [], MODELS = [], FAMILIES = [], DATASET_KEYS = [];
let VIEW = [];               // the rows currently rendered, in order

const META_COLS = [
  { key: 'family',    label: 'Family',    type: 'text', title: 'Architecture family',
    get: (m) => m.family },
  { key: 'params',    label: 'Params',    type: 'num',  title: 'Total parameter count of the evaluated checkpoint',
    get: (m) => m.n_parameters, fmt: fmtSI },
  { key: 'dataset',   label: 'Training data', type: 'text', title: 'Training sets the checkpoint saw, curated by hand',
    get: (m) => (m.training_set || []).join('+') },
  { key: 'nstruct',   label: 'Train struct.', type: 'num', title: 'Training structures summed over the listed training sets',
    get: (m) => m.n_training_structures, fmt: fmtSI },
  { key: 'precision', label: 'Prec.',     type: 'text', title: 'Float precision the model returns; sets every finite-difference step',
    get: (m) => m.precision },
  { key: 'calls',     label: 'Calls',     type: 'num',  title: 'Total single-point model calls used by the suite',
    get: (m) => m._calls, fmt: fmtSI },
  { key: 'wall',      label: 'Wall',      type: 'num',  title: 'Wall-clock time for the full suite run (hardware-dependent)',
    get: (m) => m.wall_seconds, fmt: fmtDuration }
];

/* ------------------------------------------------------------- data loading */

/**
 * JSON.parse, tolerating the bare `Infinity` / `-Infinity` / `NaN` literals that
 * Python's json.dump writes by default.  They are not valid JSON, so a browser
 * rejects the whole file over them; a probe that diverged or returned NaN would
 * otherwise take the entire dashboard down.  They become `null`, which every
 * consumer here already reads as "not measured".  The scan tracks string state
 * so the same words inside a crash message are left alone.
 */
function parseLooseJSON(text) {
  try {
    return JSON.parse(text);
  } catch (e) { /* fall through to the tolerant scan */ }
  let out = '', i = 0, inStr = false;
  while (i < text.length) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') { out += c + (text[i + 1] || ''); i += 2; continue; }
      if (c === '"') inStr = false;
      out += c; i++; continue;
    }
    if (c === '"') { inStr = true; out += c; i++; continue; }
    if (c === '-' && text.startsWith('-Infinity', i)) { out += 'null'; i += 9; continue; }
    if (c === 'I' && text.startsWith('Infinity', i))  { out += 'null'; i += 8; continue; }
    if (c === 'N' && text.startsWith('NaN', i))       { out += 'null'; i += 3; continue; }
    out += c; i++;
  }
  return JSON.parse(out);
}

async function loadJSON(url, optional = false) {
  let r;
  try {
    r = await fetch(url, { cache: 'no-cache' });
  } catch (e) {
    if (optional) return null;
    throw new Error(
      `Could not fetch ${url}. If you opened this file directly, the browser blocks ` +
      `local reads. Serve the folder instead: python _dashboard/serve.py`
    );
  }
  if (!r.ok) {
    if (optional) return null;
    throw new Error(`${url}: HTTP ${r.status}`);
  }
  return parseLooseJSON(await r.text());
}

const reportCache = new Map();

/** Lazily fetch (and cache) one model's full report, for per-element numbers. */
function getReport(slug) {
  if (!reportCache.has(slug)) {
    reportCache.set(slug, loadJSON(`${ROOT}/${encodeURIComponent(slug)}/report_full.json`)
      .then((j) => j)
      .catch((e) => ({ _error: e.message })));
  }
  return reportCache.get(slug);
}

function prepare() {
  PROBES  = DATA.proxies || [];
  SECTIONS = DATA.sections || [];
  MODELS  = (DATA.models || []).slice();
  FAMILIES = Array.from(new Set(MODELS.map((m) => m.family))).sort();
  DATASET_KEYS = Object.keys(DATA.datasets || {});

  for (const m of MODELS) {
    m._calls = Object.values(m.calls || {}).reduce((a, b) => a + (b || 0), 0);
    m._ds = new Set(m.training_set || []);
    m._crashed = new Set(Object.keys(m.crashes || {}));
    m._skipped = m.skipped || {};   // {probe: why the probe does not apply}
    m._reference = m.family === 'Analytic';
    m._hay = [m.label, m.slug, m.family, (m.training_set || []).join(' '), m.precision]
      .join(' ').toLowerCase();
  }
}

/** Overall score over the *enabled* probes, with the selected mean. */
function overallOf(m, mean = S.mean) {
  const on = PROBES.filter((p) => !S.offProbes.has(p.name)).map((p) => m.scores[p.name]);
  return combine(on, mean);
}

/** Merge family-level and model-level curated links. */
function linksFor(m) {
  const fam = (LINKS.families || {})[m.family] || {};
  const own = (LINKS.models || {})[m.slug] || {};
  const out = {};
  for (const k of ['code', 'paper', 'weights', 'docs']) {
    const v = own[k] !== undefined ? own[k] : fam[k];
    if (v) out[k] = v;
  }
  out.extra = [].concat(fam.extra || [], own.extra || []);
  return out;
}

/* ============================================================================
 * Filtering, ranking and sorting
 * ========================================================================== */

function passesFilters(m) {
  if (S.offFamilies.has(m.family)) return false;

  if (S.search) {
    const terms = S.search.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.every((t) => m._hay.includes(t))) return false;
  }

  if (S.datasets.size) {
    const want = S.datasets;
    const have = m._ds;
    const inter = [...want].filter((k) => have.has(k)).length;
    if (S.dsMode === 'any'  && inter === 0) return false;
    if (S.dsMode === 'all'  && inter !== want.size) return false;
    if (S.dsMode === 'only' && (inter !== want.size || have.size !== want.size)) return false;
  }
  return true;
}

function buildView() {
  const rows = MODELS.filter(passesFilters).map((m) => {
    const o = {};
    for (const k of ['geometric', 'arithmetic', 'harmonic']) o[k] = overallOf(m, k);
    return { m, overall: o[S.mean], overalls: o };
  });

  /* Rank follows the overall score of the *filtered* set, whatever the table is sorted
     by. Reference rows are not learned models and are left out of the numbering. */
  const byOverall = rows.filter((r) => !r.m._reference)
    .sort((a, b) => (b.overall - a.overall) || a.m.label.localeCompare(b.m.label));
  byOverall.forEach((r, i) => { r.rank = i + 1; });

  /* Column statistics, for the "rank" and "range" colour scales. */
  const stats = {};
  for (const p of PROBES) {
    const vals = rows.map((r) => r.m.scores[p.name]).filter(isNum).slice().sort((a, b) => a - b);
    const ns = vals.map(nines);
    stats[p.name] = { sorted: vals, lo: ns.length ? ns[0] : 0, hi: ns.length ? ns[ns.length - 1] : 1 };
  }
  {
    const vals = rows.map((r) => r.overall).filter(isNum).slice().sort((a, b) => a - b);
    const ns = vals.map(nines);
    stats.__overall = { sorted: vals, lo: ns.length ? ns[0] : 0, hi: ns.length ? ns[ns.length - 1] : 1 };
  }

  const key = S.sortKey, dir = S.sortDir;
  const val = (r) => {
    if (key === 'overall') return r.overall;
    if (key === 'model') return r.m.label.toLowerCase();
    if (key === 'rank') return -r.rank;
    const meta = META_COLS.find((c) => c.key === key);
    if (meta) {
      const v = meta.get(r.m);
      return meta.type === 'num' ? v : String(v == null ? '' : v).toLowerCase();
    }
    return r.m.scores[key];
  };
  rows.sort((a, b) => {
    const x = val(a), y = val(b);
    const xn = x == null || (typeof x === 'number' && !isFinite(x));
    const yn = y == null || (typeof y === 'number' && !isFinite(y));
    if (xn && yn) return a.m.label.localeCompare(b.m.label);
    if (xn) return 1;                       // missing values always sink
    if (yn) return -1;
    if (typeof x === 'string') return dir * x.localeCompare(y);
    return dir * (x - y) || a.m.label.localeCompare(b.m.label);
  });

  /* Pinned models float to the top, keeping their relative order. */
  if (S.pinned.size) {
    rows.sort((a, b) => (S.pinned.has(b.m.slug) ? 1 : 0) - (S.pinned.has(a.m.slug) ? 1 : 0));
  }

  VIEW = rows;
  VIEW.stats = stats;
  return rows;
}

/**
 * Colour weight in [0,1] for one score inside one column.
 *
 * 'score' is the default and matches the paper figure: the ramp spans the full [0,1]
 * score range, so a pale cell means a low score. The ramps run from near-white, and
 * under a per-column normalisation the weakest model in a column would be painted
 * near-white even at 0.9998, which reads as missing data rather than as a rank.
 */
function colorT(score, colKey) {
  if (S.color === 'off' || !isNum(score)) return NaN;
  if (S.color === 'score') return clamp(score, 0, 1);
  const st = VIEW.stats[colKey === 'overall' ? '__overall' : colKey];
  if (!st) return NaN;
  if (S.color === 'range') {
    const n = nines(score);
    return st.hi > st.lo ? clamp((n - st.lo) / (st.hi - st.lo), 0, 1) : 0.75;
  }
  /* rank: fraction of the column this score is at least as good as */
  const arr = st.sorted;
  if (arr.length < 2) return 0.75;
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < score) lo = mid + 1; else hi = mid; }
  return clamp(lo / (arr.length - 1), 0, 1);
}

/* ============================================================================
 * Table rendering
 * ========================================================================== */

function activeProbes() {
  return PROBES.filter((p) => !S.offProbes.has(p.name));
}
function activeMeta() {
  return META_COLS.filter((c) => !S.offMeta.has(c.key));
}
function activeSections() {
  const on = activeProbes();
  return SECTIONS.map((s) => ({ section: s, probes: on.filter((p) => p.section === s) }))
                 .filter((g) => g.probes.length);
}

function sortMark(key) {
  if (S.sortKey !== key) return '<span class="sortmark"></span>';
  return `<span class="sortmark">${S.sortDir === -1 ? '▼' : '▲'}</span>`;
}

function renderTable() {
  const rows = buildView();
  const metas = activeMeta();
  const groups = activeSections();
  const t = $('#table');

  if (!rows.length) {
    t.innerHTML = `<tbody><tr><td class="empty" colspan="99">
      <b>No model matches these filters.</b>
      Loosen the training-set, family or search filter, or hit Reset.</td></tr></tbody>`;
    renderFilterBar();
    return;
  }

  /* --- column widths ------------------------------------------------------
   * `table-layout: fixed` reads its widths from the first row, and that row is the
   * section header, whose cells span several columns each.  A colgroup states the
   * widths directly instead, which is what keeps every probe column identical. */
  let head = '<colgroup>'
    + '<col class="w-rank"><col class="w-model"><col class="w-overall">'
    + metas.map((c) => `<col class="w-meta w-meta-${esc(c.key)}">`).join('')
    + groups.map((g) => g.probes.map(() => '<col class="w-pcol">').join('')).join('')
    + '</colgroup>';

  /* --- header ------------------------------------------------------------ */
  head += '<thead><tr class="groups">';
  head += `<th class="sticky-l c-rank"></th><th class="sticky-l c-model"></th>`;
  head += `<th class="grp"><span>Overall</span></th>`;
  if (metas.length) head += `<th class="grp" colspan="${metas.length}"><span>Model</span></th>`;
  for (const g of groups) {
    const sc = (SECTION_RAMP[g.section] || {}).base;
    head += `<th class="grp" colspan="${g.probes.length}" data-section="${esc(g.section)}"
              title="${esc(g.section)} &mdash; click for what this section covers" style="cursor:pointer">
              <span${sc ? ` style="color:${sc};border-color:${sc}33"` : ''}>${esc(g.section)}</span></th>`;
  }
  head += '</tr><tr class="cols">';
  head += `<th class="sticky-l c-rank" data-sort="rank" tabindex="0" role="button" title="Position by overall score inside the current filter">
             <span class="colname">#<span class="info" data-pop="rank">i</span></span></th>`;
  head += `<th class="sticky-l c-model" data-sort="model" tabindex="0" role="button">Model ${sortMark('model')}</th>`;
  head += `<th class="c-overall" data-sort="overall" tabindex="0" role="button" title="${esc(S.mean)} mean over the ${activeProbes().length} enabled probes">
             <span class="colname">Overall${sortMark('overall')}</span></th>`;
  for (const c of metas) {
    head += `<th class="c-meta c-meta-${esc(c.key)}" data-sort="${c.key}" tabindex="0" role="button" title="${esc(c.title)}">${esc(c.label)} ${sortMark(c.key)}</th>`;
  }
  for (const g of groups) {
    for (const p of g.probes) {
      const doc = (PROBEDOC.probes || {})[p.name] || {};
      /* the header prints `short` -- the same name with soft hyphens, so a 70px column
         breaks it at a syllable instead of mid-word.  The full name is in the tooltip,
         the column menu and every card. */
      head += `<th class="pcol" data-sort="${esc(p.name)}" tabindex="0" role="button" title="${esc(doc.title || p.name)} &mdash; ${esc(doc.catches || '')} Target ${p.target}">
                 <span class="colname">${esc(doc.short || doc.title || p.name)}<span class="info" data-probe="${esc(p.name)}">i</span>${sortMark(p.name)}</span></th>`;
    }
  }
  head += '</tr></thead>';

  /* --- body -------------------------------------------------------------- */
  const body = rows.map((r) => {
    const m = r.m;
    const pinned = S.pinned.has(m.slug);
    let tds = '';

    tds += m._reference
      ? `<td class="sticky-l c-rank pad"><span class="rank ref" title="analytic reference, not a trained model">ref</span></td>`
      : `<td class="sticky-l c-rank pad"><span class="rank${r.rank === 1 ? ' top1' : ''}">${r.rank}</span></td>`;

    const badges = [];
    if (m.precision === 'float32') badges.push('<span class="badge" title="float32 model: finite-difference steps are widened accordingly">f32</span>');
    if (m._crashed.size) badges.push(`<span class="badge warn" title="crashed probes: ${esc([...m._crashed].join(', '))}">crash</span>`);
    if (m.evaluated_head) {
      badges.push(`<span class="badge" title="multi-task checkpoint: this row is the ${esc(m.evaluated_head)} head, not the whole model">${esc(m.evaluated_head)}</span>`);
    }

    tds += `<td class="sticky-l c-model"><div class="mrow">
      <button class="pin${pinned ? ' on' : ''}" data-pin="${esc(m.slug)}" title="${pinned ? 'Unpin' : 'Pin to the top'}">${pinned ? '★' : '☆'}</button>
      <span class="mname" data-model="${esc(m.slug)}">${esc(m.label)}</span>
      ${badges.join('')}
      </div></td>`;

    const oc = cellColor(colorT(r.overall, 'overall'), 'overall');
    tds += `<td class="cell overall c-overall"><span class="v" data-overall="${esc(m.slug)}"
              title="${esc(S.mean)} mean over ${activeProbes().length} probes. Click for the model card"
              style="${oc ? `background:${oc.bg};color:${oc.fg}` : ''}">${fmtScore(r.overall)}</span></td>`;

    for (const c of metas) {
      const v = c.get(m);
      if (c.key === 'dataset') {
        /* a 13-set multi-task model would otherwise push every probe column off
           screen; the rest are one click away in the model card */
        const all = m.training_set || [];
        const MAXC = 3;
        const chips = all.slice(0, MAXC).map((k) =>
          `<span class="chip link" data-dataset="${esc(k)}">${esc((DATA.datasets[k] || {}).label || k)}</span>`)
          .concat(all.length > MAXC
            ? [`<span class="chip link" data-model="${esc(m.slug)}" title="${esc(all.slice(MAXC).join(', '))}">+${all.length - MAXC}</span>`]
            : []).join(' ');
        tds += `<td class="pad c-meta c-meta-${esc(c.key)}" style="text-align:left">${chips || '<span style="color:var(--fg-faint)">-</span>'}</td>`;
      } else if (c.type === 'num') {
        tds += `<td class="pad c-meta c-meta-${esc(c.key)}">${isNum(v) ? esc((c.fmt || String)(v)) : '<span style="color:var(--fg-faint)">-</span>'}</td>`;
      } else {
        tds += `<td class="pad c-meta c-meta-${esc(c.key)}" style="text-align:left;color:var(--fg-muted)">${esc(v || '-')}</td>`;
      }
    }

    for (const g of groups) {
      for (const p of g.probes) {
        const s = m.scores[p.name];
        const crashed = m._crashed.has(p.name);
        const skipped = m._skipped[p.name];
        const cls = ['cell'];
        if (crashed) cls.push('crashed');
        if (skipped) cls.push('skipped');
        let txt = S.value === 'defect' ? sci(m.defects[p.name]) : fmtScore(s);
        if (!isNum(s)) { cls.push('na'); txt = skipped ? 'n/a' : '-'; }
        const tip = crashed ? 'the probe raised inside the model, recorded as 0'
          : skipped ? `not applicable: ${skipped}`
          : !isNum(s) ? 'not measured'
          : `score ${s.toPrecision(8)}, defect ${sci(m.defects[p.name], 2)}`;
        const col = cellColor(colorT(s, p.name), p.name);
        cls.push('pcol');
        tds += `<td class="${cls.join(' ')}"><span class="v" data-cell="${esc(m.slug)}|${esc(p.name)}"
                 title="${esc(tip)}" style="${col ? `background:${col.bg};color:${col.fg}` : ''}">${txt}</span></td>`;
      }
    }
    return `<tr class="${pinned ? 'pinned' : ''}" data-slug="${esc(m.slug)}">${tds}</tr>`;
  }).join('');

  const ncols = 3 + metas.length + groups.reduce((a, g) => a + g.probes.length, 0);
  const foot = `<tfoot><tr><td colspan="${ncols}">
      ${rows.length} of ${MODELS.length} models &middot; ${activeProbes().length} of ${PROBES.length} probes
      &middot; overall = <b>${esc(S.mean)}</b> mean of the enabled probes
      ${S.offProbes.size ? '&middot; <b>recomputed</b> for the reduced probe set' : ''}
    </td></tr></tfoot>`;

  t.innerHTML = head + `<tbody>${body}</tbody>` + foot;
  applyTableWidth();
  renderFilterBar();
}

/* The card is given the exact width of the columns that are switched on, read back from
   the same custom properties the colgroup uses.  Without a definite width the browser is
   free to stretch the table across a wide monitor or squeeze it on a narrow one, and a
   squeezed fixed-layout table shares the shortfall out unevenly -- which is precisely
   what "equally large columns" rules out. */
function applyTableWidth() {
  const wrap = $('#tablewrap');
  if (!wrap) return;
  const cs = getComputedStyle(document.documentElement);
  const px = (n) => parseFloat(cs.getPropertyValue(n)) || 0;
  let w = 2;                                   /* the card's own 1px borders */
  for (const col of $$('colgroup col', wrap)) {
    const c = col.classList;
    w += c.contains('w-rank')         ? px('--w-rank')
       : c.contains('w-model')        ? px('--w-model')
       : c.contains('w-overall')      ? px('--w-overall')
       : c.contains('w-meta-dataset') ? px('--w-meta-dataset')
       : c.contains('w-meta')         ? px('--w-meta')
       :                                px('--w-pcol');
  }
  wrap.style.setProperty('--table-w', `${w}px`);
}

/* ============================================================================
 * Floating mini-windows (popovers).  One element, re-used; anchored to whatever
 * was clicked, flipped and clamped so it always stays on screen.
 * ========================================================================== */

let popEl = null, popAnchor = null;

function closePop() {
  if (popEl) { popEl.remove(); popEl = null; popAnchor = null; }
}

function placePop() {
  if (!popEl || !popAnchor) return;
  const a = popAnchor.getBoundingClientRect();
  if (a.bottom < 0 || a.top > innerHeight || a.right < 0 || a.left > innerWidth) { closePop(); return; }
  /* offsetWidth/Height, not getBoundingClientRect: the entry animation scales the
     card, and the scaled box would under-report its size and defeat the clamp. */
  const pw = popEl.offsetWidth, ph = popEl.offsetHeight;
  const pad = 10;
  let left = a.left;
  let top = a.bottom + 8;
  if (left + pw > innerWidth - pad) left = Math.max(pad, innerWidth - pw - pad);
  if (left < pad) left = pad;
  if (top + ph > innerHeight - pad) {
    const above = a.top - ph - 8;
    top = above > pad ? above : Math.max(pad, innerHeight - ph - pad);
  }
  popEl.style.left = left + 'px';
  popEl.style.top = top + 'px';
}

/**
 * Open a mini-window.  `body` may be an HTML string or a promise resolving to
 * one (a spinner is shown while it settles).
 */
function openPop(anchor, { title, sub, body, wide = false, id = '' }) {
  closePop();
  popEl = document.createElement('div');
  popEl.className = 'pop' + (wide ? ' wide' : '');
  popEl.setAttribute('role', 'dialog');
  popEl.setAttribute('aria-label', String(title).replace(/<[^>]*>/g, ''));
  popEl.innerHTML = `
    <header>
      <div><div class="t">${title}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>
      <button class="x" aria-label="Close">✕</button>
    </header>
    <div class="body">${typeof body === 'string' ? body : '<div class="loading"><span class="spinner"></span>loading per-element results…</div>'}</div>`;
  document.body.appendChild(popEl);
  popAnchor = anchor;
  placePop();
  $('.x', popEl).onclick = closePop;

  if (body && typeof body.then === 'function') {
    const mine = popEl;
    body.then((html) => {
      if (popEl !== mine) return;
      $('.body', mine).innerHTML = html;
      placePop();
    }).catch((e) => {
      if (popEl !== mine) return;
      $('.body', mine).innerHTML = `<p style="color:var(--bad)">${esc(e.message || e)}</p>`;
      placePop();
    });
  }
  return popEl;
}

/* ------------------------------------------------------------ card builders */

/* Inline 14px icons, so there is no icon font and no emoji fallback. */
const _svg = (d) => `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor"
  stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  code:     _svg('<path d="M5.5 11.5L2 8l3.5-3.5M10.5 4.5L14 8l-3.5 3.5"/>'),
  paper:    _svg('<path d="M9 1.5H4a1 1 0 00-1 1v11a1 1 0 001 1h8a1 1 0 001-1V5.5z"/><path d="M9 1.5v4h4M5.5 8.5h5M5.5 11h3"/>'),
  download: _svg('<path d="M8 2v8M4.5 7L8 10.5 11.5 7M2.5 13.5h11"/>'),
  book:     _svg('<path d="M2.5 3.5A1.5 1.5 0 014 2h9.5v10.5H4A1.5 1.5 0 002.5 14z"/><path d="M2.5 12.5A1.5 1.5 0 014 11h9.5"/>'),
  out:      _svg('<path d="M6.5 3.5h-3v9h9v-3M9.5 2.5h4v4M13.5 2.5L7 9"/>'),
  search:   _svg('<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/>'),
  mail:     _svg('<rect x="2" y="3.5" width="12" height="9" rx="1.5"/><path d="M2.5 4.5L8 8.5l5.5-4"/>'),
  plus:     _svg('<path d="M8 3.5v9M3.5 8h9"/>')
};

/**
 * The few lines that reproduce this row's calculator on an ``ase.Atoms``.
 *
 * Everything comes from the run's own spec -- the pinned packages, the modules that
 * have to be imported before the expression can be evaluated, and the expression
 * itself -- so the snippet is what actually produced the numbers, not a paraphrase.
 */
/**
 * Replace absolute filesystem paths inside a calculator expression with just the file
 * name. The run needs the full path on the machine it ran on; a reader does not, and
 * publishing it exposes a directory layout for no benefit. URLs are left alone.
 */
function stripPaths(expr) {
  return String(expr).replace(/(['"])(\/[^'"\s]*\/)([^'"\/\s]+)\1/g, (all, q, dir, file) => q + file + q);
}

/**
 * Split requirement pins into an installable list and notes for the ones that point at a
 * file on the machine the run happened on. A `pkg@file:///abs/path/pkg.whl` pin would
 * otherwise print that path verbatim.
 */
function splitPins(pins) {
  const out = [], notes = [];
  for (const pin of pins) {
    const m = /^([A-Za-z0-9._-]+)\s*@\s*file:\/\/(\S+)$/.exec(pin);
    if (m) {
      notes.push(`# ${m[1]} is installed from a local wheel (${m[2].split('/').pop()})`);
      out.push(m[1]);
      continue;
    }
    if (/(^|[=@\s])\//.test(pin) && !/https?:\/\//.test(pin)) {
      const name = (/^([A-Za-z0-9._-]+)/.exec(pin) || [, pin])[1];
      notes.push(`# ${name} is installed from a local path (${pin.split('/').pop()})`);
      out.push(name);
      continue;
    }
    out.push(pin);
  }
  return { pins: out, notes };
}

function calcSnippet(m) {
  const el = (m.elements || 'Si').split(',')[0].trim();
  const split = splitPins(['ase==3.28.0'].concat(m.packages || []));
  const pins = split.pins;
  /* `import a.b` already binds `a`, so a bare root import would be redundant */
  const imports = (m.imports || []).slice().sort();
  const lines = [`# pip install ${pins.join(' ')}`];
  if (m.python) lines.push(`# python ${m.python}`);
  for (const n of split.notes) lines.push(n);
  lines.push('');
  for (const mod of imports) lines.push(`import ${mod}`);
  lines.push('from ase.build import bulk');
  lines.push('');
  lines.push(`atoms = bulk("${el}")`);
  const expr = stripPaths(m.calculator);
  lines.push(...assignLines('atoms.calc', expr));
  if (expr !== m.calculator) {
    lines.push('');
    lines.push('# point the checkpoint name at wherever you keep the file');
  }
  lines.push('');
  lines.push('energy = atoms.get_potential_energy()');
  lines.push('forces = atoms.get_forces()');
  if (!(m.skipped || {}).stress_consistency) lines.push('stress = atoms.get_stress()');
  return lines.join('\n');
}

/**
 * `lhs = expr`, wrapped over several lines when the call is long.
 * Splits only at top-level commas -- never inside a nested call or a string -- so the
 * result is still the same expression, and still pastes.
 */
function assignLines(lhs, expr) {
  const one = `${lhs} = ${expr}`;
  if (one.length <= 78) return [one];
  const open = expr.indexOf('(');
  if (open < 0 || !expr.endsWith(')')) return [one];
  const head = expr.slice(0, open + 1);
  const inner = expr.slice(open + 1, -1);
  const parts = [];
  let depth = 0, quote = '', buf = '';
  for (const c of inner) {
    if (quote) { buf += c; if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") { quote = c; buf += c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    if (c === ')' || c === ']' || c === '}') depth--;
    if (c === ',' && depth === 0) { parts.push(buf.trim()); buf = ''; continue; }
    buf += c;
  }
  if (buf.trim()) parts.push(buf.trim());
  if (parts.length < 2) return [one];
  return [`${lhs} = ${head}`, ...parts.map((x) => `    ${x},`), ')'];
}

function linkRow(m) {
  const L = linksFor(m);
  const items = [];
  const add = (label, url, icon) => { if (url) items.push(
    `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${ICON[icon]} ${esc(label)}</a>`); };
  add('Code', L.code, 'code');
  add('Paper', L.paper, 'paper');
  add('Weights', L.weights, 'download');
  add('Docs', L.docs, 'book');
  for (const [label, url] of L.extra || []) add(label, url, 'out');
  if (!items.length) {
    items.push(`<a href="https://www.google.com/search?q=${encodeURIComponent(m.label + ' interatomic potential')}"
      target="_blank" rel="noopener noreferrer">${ICON.search} Search the web</a>`);
  }
  return `<div class="linkrow">${items.join('')}</div>`;
}

function elementBars(perElement, perDefect, crashed, barKey = 'overall') {
  const syms = Object.keys(perElement || {});
  if (!syms.length) return '<p>No per-element breakdown recorded.</p>';
  if (!syms.some((k) => isNum(perElement[k])) && !(crashed && Object.keys(crashed).length)) {
    return '<p>Nothing was measured per element: the probe declined for all of them.</p>';
  }
  return `<div class="ebars">` + syms.map((sym) => {
    const s = perElement[sym];
    const crash = crashed && crashed[sym];
    const w = isNum(s) ? clamp(nines(s) / 12, 0.015, 1) * 100 : 0;
    const num = crash ? 'crashed'
      : (S.value === 'defect' && perDefect ? sci(perDefect[sym]) : fmtScore(s));
    return `<span class="sym${crash ? ' crash' : ''}">${esc(sym)}</span>
      <span class="track" title="${esc(sym)}: score ${isNum(s) ? s.toPrecision(6) : '-'}${
        perDefect && isNum(perDefect[sym]) ? `, defect ${sci(perDefect[sym], 2)}` : ''}">
        <i style="width:${w.toFixed(1)}%;background:${barColor(isNum(s) ? clamp(nines(s) / 12, 0, 1) : NaN, barKey)}"></i></span>
      <span class="num">${esc(num)}</span>`;
  }).join('') + `</div>
    <p class="tiny">Bar length is logarithmic in the defect, so near-perfect values stay distinguishable.</p>`;
}

/** Model mini-window. */
function modelCard(anchor, slug) {
  const m = MODELS.find((x) => x.slug === slug);
  if (!m) return;
  const row = VIEW.find((r) => r.m.slug === slug);
  const env = m.environment || {};
  const dsChips = (m.training_set || []).map((k) =>
    `<span class="chip link" data-dataset="${esc(k)}">${esc((DATA.datasets[k] || {}).label || k)}</span>`).join(' ')
    || '<span style="color:var(--fg-faint)">none recorded</span>';

  const meanRows = ['geometric', 'arithmetic', 'harmonic'].map((k) => {
    const v = row ? row.overalls[k] : overallOf(m, k);
    return `<dt>${k}${k === S.mean ? ' <span class="badge">shown</span>' : ''}</dt><dd>${fmtScore(v)}</dd>`;
  }).join('');

  const probeBars = PROBES.map((p) => {
    const s = m.scores[p.name];
    const doc = (PROBEDOC.probes || {})[p.name] || {};
    const off = S.offProbes.has(p.name);
    const w = isNum(s) ? clamp(nines(s) / 12, 0.015, 1) * 100 : 0;
    return `<div class="pbar" data-cell="${esc(m.slug)}|${esc(p.name)}" style="${off ? 'opacity:.4' : ''}"
              title="${esc(doc.catches || '')}">
        <span class="nm">${esc(doc.title || p.name)}</span>
        <span class="track"><i style="width:${w.toFixed(1)}%;background:${barColor(isNum(s) ? clamp(nines(s) / 12, 0, 1) : NaN, p.name)}"></i></span>
        <span class="num">${m._crashed.has(p.name) ? 'x' : fmtScore(s)}</span>
      </div>`;
  }).join('');

  const perElem = getReport(slug).then((rep) => {
    if (!rep || rep._error) return `<p style="color:var(--bad)">${esc(rep ? rep._error : 'not found')}</p>`;
    const pe = (rep.metadata || {}).per_element_overall || {};
    return elementBars(pe, null, null);
  });

  const snippet = calcSnippet(m);
  const staticHtml = `
    <div>${linkRow(m)}</div>
    ${m.notes ? `<p>${esc(m.notes)}</p>` : ''}
    <div>
      <h5>Use it <button class="btn sm copy" data-copy="calc">copy</button></h5>
      <pre class="code" data-snippet="calc">${esc(snippet)}</pre>
      <p style="font-size:11px">Exactly the calculator this row was measured with, pins included.</p>
    </div>
    <div>
      <h5>Overall, ${activeProbes().length} enabled probe${activeProbes().length === 1 ? '' : 's'}</h5>
      <dl class="kv">${meanRows}${row && isNum(row.rank) ? `<dt>rank</dt><dd>${row.rank} / ${VIEW.filter((x) => !x.m._reference).length}</dd>` : ''}</dl>
    </div>
    <div>
      <h5>Training data</h5>
      <div style="margin-bottom:6px">${dsChips}</div>
      <dl class="kv">
        <dt>structures</dt><dd>${isNum(m.n_training_structures) ? m.n_training_structures.toLocaleString('en-US') : '-'}</dd>
        <dt>materials</dt><dd>${isNum(m.n_training_materials) ? m.n_training_materials.toLocaleString('en-US') : '-'}</dd>
        ${m.evaluated_head ? `<dt>evaluated head</dt><dd>${esc(m.evaluated_head)}</dd>` : ''}
      </dl>
      ${m.training_set_note ? `<p style="margin-top:7px">${esc(m.training_set_note)}</p>` : ''}
      ${(m.training_heads || []).length ? `<details class="heads">
        <summary>${m.training_heads.length} multi-task heads in this checkpoint</summary>
        <div class="headlist">${m.training_heads.map((h) =>
          `<span class="chip${h === m.evaluated_head ? ' solid' : ''}">${esc(h)}</span>`).join('')}</div>
      </details>` : ''}
    </div>
    <div>
      <h5>Checkpoint</h5>
      <dl class="kv">
        <dt>family</dt><dd class="txt">${esc(m.family)}</dd>
        <dt>parameters</dt><dd>${isNum(m.n_parameters) ? m.n_parameters.toLocaleString('en-US') : '-'}</dd>
        ${isNum(m.n_parameters_trainable) && m.n_parameters_trainable > 0
          ? `<dt>trainable</dt><dd>${m.n_parameters_trainable.toLocaleString('en-US')}</dd>` : ''}
        <dt>precision</dt><dd>${esc(m.precision || '-')}</dd>
        <dt>seed</dt><dd>${esc(String(m.seed))}</dd>
        <dt>model calls</dt><dd>${m._calls.toLocaleString('en-US')}</dd>
        <dt>wall time</dt><dd>${fmtDuration(m.wall_seconds)}</dd>
        <dt>elements</dt><dd class="txt">${esc(m.elements)}</dd>
      </dl>
    </div>
    ${Object.keys(m._skipped).length ? `<div>
      <h5>Not applicable</h5>
      <p>${Object.entries(m._skipped).map(([k, v]) =>
        `<b>${esc((PROBEDOC.probes[k] || {}).title || k)}</b>: ${esc(v)}`).join('<br>')}</p>
      <p style="font-size:11px">These probes score <span class="mono">null</span>, not zero, and are left out
      of the overall mean rather than counted as failures.</p>
    </div>` : ''}
    ${m._crashed.size ? `<div>
      <h5 style="color:var(--bad)">Crashed probes</h5>
      <p>${[...m._crashed].map((k) => `<b>${esc(k)}</b>: ${esc(String(Object.values(m.crashes[k])[0]).slice(0, 220))}`).join('<br>')}</p>
      <p style="font-size:11px">A crashed probe scores 0 and drags the geometric and harmonic means to the floor.</p>
    </div>` : ''}
    <div><h5>Per-probe score</h5><div class="pbars">${probeBars}</div></div>
    <div><h5>Per-element overall</h5><div data-slot="elements"><div class="loading"><span class="spinner"></span>loading…</div></div></div>

    <div>
      <h5>Run environment</h5>
      <dl class="kv">
        <dt>python</dt><dd>${esc(env.python || '-')}</dd>
        <dt>torch</dt><dd>${esc(env.torch || '-')}</dd>
        <dt>cuda</dt><dd>${esc(env.torch_cuda || '-')}</dd>
        <dt>gpu</dt><dd class="txt">${esc(env.gpu ? env.gpu.name : 'cpu')}</dd>
        <dt>ase</dt><dd>${esc(env.ase || '-')}</dd>
        <dt>pescert</dt><dd>${esc(env.pescert || '-')}</dd>
      </dl>
    </div>`;

  const pop = openPop(anchor, {
    title: esc(m.label),
    sub: `${esc(m.family)} &middot; <span class="mono">${esc(m.slug)}</span>`,
    body: staticHtml, wide: true
  });
  perElem.then((html) => {
    const slot = pop.querySelector('[data-slot="elements"]');
    if (slot && document.body.contains(pop)) { slot.innerHTML = html; placePop(); }
  });
}

/** Single-cell mini-window: one probe, one model, with the per-element split. */
function cellCard(anchor, slug, probeName) {
  const m = MODELS.find((x) => x.slug === slug);
  const p = PROBES.find((x) => x.name === probeName);
  if (!m || !p) return;
  const doc = (PROBEDOC.probes || {})[probeName] || {};
  const s = m.scores[probeName];
  const crashed = m._crashed.has(probeName);
  const skipped = m._skipped[probeName];

  const head = `
    ${crashed ? `<p style="color:var(--bad)"><b>This probe raised inside the model</b> on every element and is recorded as score 0.</p>` : ''}
    ${skipped ? `<p style="color:var(--mid)"><b>Not applicable to this model.</b> ${esc(skipped)}</p>` : ''}
    <dl class="kv">
      <dt>score</dt><dd>${isNum(s) ? s.toPrecision(12) : '-'}</dd>
      <dt>raw defect</dt><dd>${sci(m.defects[probeName], 3)}</dd>
      <dt>exact target</dt><dd>${esc(String(p.target))}</dd>
      <dt>model calls</dt><dd>${(m.calls[probeName] || 0).toLocaleString('en-US')}</dd>
      <dt>rank in column</dt><dd>${(() => {
        if (m._reference) return 'reference';
        const ranked = VIEW.filter((r) => !r.m._reference && isNum(r.m.scores[probeName]))
          .sort((a, b) => b.m.scores[probeName] - a.m.scores[probeName]);
        const i = ranked.findIndex((r) => r.m.slug === slug);
        return i < 0 ? '-' : `${i + 1} / ${ranked.length}`;
      })()}</dd>
    </dl>
    ${doc.identity ? `<p><b style="color:var(--fg)">Identity.</b> ${esc(doc.identity)}</p>` : ''}`;

  const body = getReport(slug).then((rep) => {
    if (!rep || rep._error) {
      return head + `<p style="color:var(--bad)">Per-element data unavailable: ${esc(rep ? rep._error : 'not found')}</p>`;
    }
    const res = (rep.results || []).find((r) => r.name === probeName) || {};
    const det = res.details || {};
    const crashes = det.crashed || {};
    let out = head + `<div><h5>Per element</h5>${
      elementBars(det.per_element, det.per_element_defect, crashes, probeName)}</div>`;
    const cs = Object.entries(crashes);
    if (cs.length) {
      out += `<div><h5 style="color:var(--bad)">Errors</h5><pre>${
        esc(cs.map(([k, v]) => `${k}: ${v}`).join('\n')).slice(0, 1600)}</pre></div>`;
    }
    out += `<p style="font-size:11px">Model-level score is the mean over these elements.
      <a href="#" data-probe="${esc(probeName)}">What does this probe test?</a></p>`;
    return out;
  });

  openPop(anchor, {
    title: `${esc(doc.title || probeName)} <span style="color:var(--fg-faint);font-weight:400">·</span> ${esc(m.label)}`,
    sub: `${esc(p.section)} &middot; exact target ${esc(String(p.target))}`,
    body
  });
}

/** Probe documentation mini-window, with the leaders and laggards. */
function probeCard(anchor, probeName) {
  const p = PROBES.find((x) => x.name === probeName);
  const doc = (PROBEDOC.probes || {})[probeName] || {};
  if (!p) return;
  const ranked = VIEW.slice().filter((r) => isNum(r.m.scores[probeName]))
                     .sort((a, b) => b.m.scores[probeName] - a.m.scores[probeName]);
  const list = (arr) => arr.map((r) =>
    `<div class="pbar" data-cell="${esc(r.m.slug)}|${esc(probeName)}">
       <span class="nm" style="width:auto">${esc(r.m.label)}</span>
       <span class="track"><i style="width:${(clamp(nines(r.m.scores[probeName]) / 12, .015, 1) * 100).toFixed(1)}%;
         background:${barColor(clamp(nines(r.m.scores[probeName]) / 12, 0, 1), probeName)}"></i></span>
       <span class="num">${fmtScore(r.m.scores[probeName])}</span>
     </div>`).join('');

  openPop(anchor, {
    title: esc(doc.title || probeName),
    sub: `${esc(p.section)} &middot; <span class="mono">${esc(probeName)}</span> &middot; exact target ${esc(String(p.target))}`,
    body: `
      ${doc.identity ? `<div><h5>Identity</h5><p class="fg">${esc(doc.identity)}</p></div>` : ''}
      ${doc.catches ? `<div><h5>What it catches</h5><p>${esc(doc.catches)}</p></div>` : ''}
      ${doc.why ? `<div><h5>Notes</h5><p>${esc(doc.why)}</p></div>` : ''}
      ${ranked.length ? `<div><h5>Best in view</h5><div class="pbars">${list(ranked.slice(0, 5))}</div></div>
      <div><h5>Worst in view</h5><div class="pbars">${list(ranked.slice(-5).reverse())}</div></div>` : ''}
      <div class="linkrow">
        <a href="#" data-hide-probe="${esc(probeName)}">Hide this column</a>
        <a href="#" data-only-probe="${esc(probeName)}">Score on this probe only</a>
      </div>`
  });
}

function sectionCard(anchor, section) {
  const txt = (PROBEDOC.sections || {})[section] || '';
  const probes = PROBES.filter((p) => p.section === section);
  openPop(anchor, {
    title: esc(section),
    sub: `${probes.length} probes`,
    body: `<p class="fg">${esc(txt)}</p>
      <div><h5>Probes</h5><div class="pbars">${probes.map((p) => {
        const d = (PROBEDOC.probes || {})[p.name] || {};
        return `<div class="pbar" data-probe="${esc(p.name)}" style="grid-template-columns:120px 1fr">
          <span class="nm">${esc(d.title || p.name)}</span>
          <span class="nm" style="color:var(--fg-faint)">${esc(d.catches || '')}</span></div>`;
      }).join('')}</div></div>
      <div class="linkrow">
        <a href="#" data-toggle-section="${esc(section)}">Toggle this whole family of columns</a>
      </div>`
  });
}

function datasetCard(anchor, key) {
  const d = (DATA.datasets || {})[key];
  if (!d) return;
  const users = MODELS.filter((m) => m._ds.has(key));
  openPop(anchor, {
    title: esc(d.label || key),
    sub: 'Training set',
    body: `
      <dl class="kv">
        <dt>structures</dt><dd>${isNum(d.n_structures) ? d.n_structures.toLocaleString('en-US') : '-'}</dd>
        <dt>materials or systems</dt><dd>${isNum(d.n_materials) ? d.n_materials.toLocaleString('en-US') : '-'}</dd>
        <dt>models here</dt><dd>${users.length}</dd>
      </dl>
      ${d.notes ? `<p>${esc(d.notes)}</p>` : ''}
      ${d.url ? `<div class="linkrow"><a href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">↗ Dataset source</a></div>` : ''}
      <div class="linkrow">
        <a href="#" data-filter-dataset="${esc(key)}">Show only models trained on it</a>
      </div>
      <p class="tiny">Counts are transcribed from the source.</p>`
  });
}

function rankCard(anchor) {
  openPop(anchor, {
    title: 'About the rank column',
    body: `
      <p>Position by overall score within the current filter. It moves when you change the
      averaging method, disable probes, or filter the model set.</p>
      <p>Note: many models share similar scores, so ranking them can suggest a separation
      the numbers do not support. The differences worth reading are the large ones.</p>
      <p>The analytic reference is marked <span class="mono">ref</span> and is not ranked.</p>`
  });
}

function helpCard(anchor) {
  openPop(anchor, {
    title: 'How to read this table', wide: true,
    sub: `${MODELS.length} models, ${PROBES.length} probes`,
    body: `
      <div><h5>The scores</h5>
        <p>Each probe compares the model against a value the exact potential energy surface
        satisfies, and maps the deviation onto a score in [0,1] where 1 is perfect. Cells show
        four decimals; the full precision and the raw defect are in the cell card.</p></div>
      <div><h5>The colours</h5>
        <p>Probe columns are tinted by the colour of the section they belong to; the overall
        column uses the plasma scale. Both come from the figure in the paper, so the table and
        the figure read the same way.</p>
        <p><b>Score</b> spans the full 0 to 1 range, which is what the figure does and what the
        default shows. <b>Rank</b> colours each column by position within it and <b>Range</b>
        spreads it between its own lowest and highest value; both make small differences
        visible, at the cost of a pale cell no longer meaning a low score.</p></div>
      <div><h5>Overall score</h5>
        <p>Recomputed in the browser from the probes you leave enabled, with the mean you pick.
        The geometric mean is the default and responds to a single low axis; the harmonic mean
        is dominated by the lowest one.</p></div>
      <div><h5>Markers</h5>
        <p><span class="badge">f32</span> float32 model. Finite-difference steps are widened to
        match its noise floor, so its values near machine precision are not directly comparable
        with a float64 model's.<br>

        <span class="badge">omat_pbe</span> multi-task checkpoint evaluated on one head. The row
        is that head.<br>
        <span class="mono">n/a</span> the probe does not apply, for example a stress identity on
        a model with no stress head. It is left out of the overall mean.</p></div>
      <div><h5>Reference row</h5>
        <p>Lennard-Jones is not a trained model but an analytic pair potential, included so the
        table has a control: it satisfies the identities by construction, so its row indicates
        the numerical floor of the measurement itself. It carries no rank.</p></div>
      <div><h5>Keyboard</h5>
        <p><kbd>/</kbd> search, <kbd>Esc</kbd> close. Click any cell, model, training-set chip
        or column header for details.</p></div>`
  });
}

/* ============================================================================
 * Dropdown menus
 * ========================================================================== */

let openMenu = null;

function closeMenu() {
  if (openMenu) {
    const btn = openMenu.previousElementSibling;
    if (btn) btn.setAttribute('aria-expanded', 'false');
    openMenu.remove();
    openMenu = null;
  }
}

function toggleMenu(btn, build) {
  const was = openMenu && openMenu.dataset.owner === btn.id;
  closeMenu();
  if (was) return;
  const el = document.createElement('div');
  el.className = 'menu';
  el.dataset.owner = btn.id;
  el.innerHTML = build();
  btn.parentElement.appendChild(el);
  btn.setAttribute('aria-expanded', 'true');
  openMenu = el;
  /* keep the menu inside the viewport */
  const r = el.getBoundingClientRect();
  if (r.right > innerWidth - 8) el.classList.add('right');
}

function rebuildOpenMenu() {
  if (!openMenu) return;
  const id = openMenu.dataset.owner;
  const btn = document.getElementById(id);
  const builders = { 'btn-cols': colsMenu, 'btn-data': dataMenu, 'btn-fam': famMenu };
  if (btn && builders[id]) openMenu.innerHTML = builders[id]();
}

function colsMenu() {
  const secRows = SECTIONS.map((sec) => {
    const ps = PROBES.filter((p) => p.section === sec);
    const on = ps.filter((p) => !S.offProbes.has(p.name)).length;
    let h = `<div class="row head" data-sec-toggle="${esc(sec)}">
        <input type="checkbox" ${on === ps.length ? 'checked' : ''} ${on && on < ps.length ? 'data-ind="1"' : ''}>
        <span>${esc(sec)}</span><span class="tail">${on}/${ps.length}</span></div>`;
    h += ps.map((p) => {
      const d = (PROBEDOC.probes || {})[p.name] || {};
      return `<div class="row sub" data-probe-toggle="${esc(p.name)}" title="${esc(d.catches || '')}">
        <input type="checkbox" ${S.offProbes.has(p.name) ? '' : 'checked'}>
        <span>${esc(d.title || p.name)}</span><span class="tail">→${esc(String(p.target))}</span></div>`;
    }).join('');
    return h;
  }).join('<hr>');

  const metaRows = META_COLS.map((c) => `
    <div class="row" data-meta-toggle="${esc(c.key)}" title="${esc(c.title)}">
      <input type="checkbox" ${S.offMeta.has(c.key) ? '' : 'checked'}>
      <span>${esc(c.label)}</span></div>`).join('');

  return `
    <div class="actions">
      <button class="btn sm" data-act="all-probes">All probes</button>
      <button class="btn sm" data-act="no-probes">None</button>
    </div>
    <h4>Probe columns</h4>${secRows}
    <hr><h4>Model columns</h4>${metaRows}
    <hr><p style="font-size:11px;color:var(--fg-faint);padding:0 7px 4px;margin:0">
      Disabling a probe removes it from the table <b>and</b> from the overall score.</p>`;
}

function dataMenu() {
  const counts = {};
  for (const m of MODELS) for (const k of m._ds) counts[k] = (counts[k] || 0) + 1;
  const rows = DATASET_KEYS.map((k) => {
    const d = DATA.datasets[k];
    return `<div class="row" data-ds-toggle="${esc(k)}" title="${esc((d.notes || '').slice(0, 180))}">
      <input type="checkbox" ${S.datasets.has(k) ? 'checked' : ''}>
      <span>${esc(d.label || k)}</span><span class="tail">${counts[k] || 0}</span></div>`;
  }).join('');
  const mode = (v, label, title) => `<button class="btn sm ${S.dsMode === v ? 'on' : ''}"
      data-ds-mode="${v}" title="${esc(title)}">${label}</button>`;
  return `
    <h4>Trained on</h4>${rows}
    <hr><h4>Match</h4>
    <div class="actions">
      ${mode('any', 'Any', 'Model saw at least one of the selected sets')}
      ${mode('all', 'All', 'Model saw every selected set, and may have seen others')}
      ${mode('only', 'Exactly', 'Model saw the selected sets and nothing else')}
    </div>
    <hr><div class="actions"><button class="btn sm" data-act="clear-ds">Clear</button></div>
    <p style="font-size:11px;color:var(--fg-faint);padding:4px 7px 0;margin:0">
      Training sets are curated by hand. A model with none recorded is hidden by any selection.</p>`;
}

function famMenu() {
  const counts = {};
  for (const m of MODELS) counts[m.family] = (counts[m.family] || 0) + 1;
  const rows = FAMILIES.map((f) => `
    <div class="row" data-fam-toggle="${esc(f)}">
      <input type="checkbox" ${S.offFamilies.has(f) ? '' : 'checked'}>
      <span style="display:inline-flex;align-items:center;gap:6px">
        <i style="width:9px;height:9px;border-radius:50%;background:${famColor(f)};display:inline-block"></i>
        ${esc(f)}</span><span class="tail">${counts[f]}</span></div>`).join('');
  return `<div class="actions">
      <button class="btn sm" data-act="all-fam">All</button>
      <button class="btn sm" data-act="no-fam">None</button>
    </div><h4>Architecture family</h4>${rows}`;
}

/* ============================================================================
 * Active-filter bar
 * ========================================================================== */

function renderFilterBar() {
  const bar = $('#filterbar');
  const chips = [];
  const chip = (label, act, title) =>
    `<span class="chip solid" title="${esc(title || '')}">${esc(label)}<button data-clear="${esc(act)}" aria-label="remove">✕</button></span>`;

  if (S.search) chips.push(chip(`search: ${S.search}`, 'search'));
  if (S.datasets.size) {
    const names = [...S.datasets].map((k) => (DATA.datasets[k] || {}).label || k);
    const verb = { any: 'any of', all: 'all of', only: 'exactly' }[S.dsMode];
    chips.push(chip(`trained on ${verb}: ${names.join(', ')}`, 'ds'));
  }
  if (S.offFamilies.size) chips.push(chip(`${FAMILIES.length - S.offFamilies.size}/${FAMILIES.length} families`, 'fam'));
  if (S.offProbes.size) chips.push(chip(`${PROBES.length - S.offProbes.size}/${PROBES.length} probes, overall recomputed`, 'probes'));
  if (S.pinned.size) chips.push(chip(`${S.pinned.size} pinned`, 'pin'));

  if (chips.length) {
    chips.push(`<button class="btn sm" data-clear="all">Clear all</button>`);
    const link = `<span style="margin-left:auto;color:var(--fg-faint)">this view is in the URL, copy it to share</span>`;
    bar.innerHTML = chips.join('') + link;
  } else {
    bar.innerHTML = '';
  }
}

/* ============================================================================
 * Scatter panel
 * ========================================================================== */

const SC_LABELS = {
  n_parameters: 'parameters',
  n_training_structures: 'training structures',
  wall_seconds: 'wall time (s)'
};

/* Two charts. "size" is score against parameter count; "data" is score against
   training-set size with circle *area* proportional to the parameter count, so the
   two axes of "how big is this model" can be read at once. */
const CHARTS = {
  size: { x: 'n_parameters', r: null },
  data: { x: 'n_training_structures', r: 'n_parameters' },
  /* Call counts are near-constant across the suite (about 35k to 42k per model), so on
     one GPU the wall time is close to a per-call cost. Mixing in the CPU-only runs would
     not compare anything, so they are left out and the count is stated. */
  time: { x: 'wall_seconds', r: 'n_parameters', gpuOnly: true,
          note: 'GPU runs only, all on one RTX A5000. Call counts are near-constant '
              + 'across models, so this reads as cost per model call.' }
};

const onGPU = (m) => !!((m.environment || {}).gpu || {}).name;

function renderScatter() {
  const svg = $('#scatter');
  const W = svg.clientWidth || 900, H = 330;
  const pad = { l: 52, r: 14, t: 12, b: 40 };
  const cfg = CHARTS[S.chart] || CHARTS.size;
  const xf = cfg.x, rf = cfg.r;
  let pts = VIEW.filter((r) => isNum(r.m[xf]) && r.m[xf] > 0 && isNum(r.overall));
  if (cfg.gpuOnly) pts = pts.filter((r) => onGPU(r.m));

  if (pts.length < 2) {
    svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle">not enough models report ${esc(SC_LABELS[xf])}</text>`;
    return;
  }

  const xs = pts.map((p) => Math.log10(p.m[xf]));
  const x0 = Math.min(...xs) - 0.12, x1 = Math.max(...xs) + 0.12;
  const y0 = 0, y1 = 1;
  const X = (v) => pad.l + (Math.log10(v) - x0) / (x1 - x0) * (W - pad.l - pad.r);
  const Y = (v) => H - pad.b - (v - y0) / (y1 - y0) * (H - pad.t - pad.b);

  let g = '<g class="grid">';
  for (let n = 0; n <= 1.0001; n += 0.2) {
    const y = Y(n);
    g += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
    g += `<text x="${pad.l - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end">${n.toFixed(1)}</text>`;
  }
  for (let e = Math.ceil(x0); e <= Math.floor(x1); e++) {
    const x = pad.l + (e - x0) / (x1 - x0) * (W - pad.l - pad.r);
    g += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${pad.t}" y2="${H - pad.b}"/>`;
    g += `<text x="${x.toFixed(1)}" y="${H - pad.b + 15}" text-anchor="middle">${fmtSI(Math.pow(10, e))}</text>`;
  }
  g += '</g>';
  g += `<line class="ax" x1="${pad.l}" x2="${W - pad.r}" y1="${H - pad.b}" y2="${H - pad.b}"/>`;
  g += `<line class="ax" x1="${pad.l}" x2="${pad.l}" y1="${pad.t}" y2="${H - pad.b}"/>`;
  g += `<text class="axlabel" x="${(W + pad.l) / 2}" y="${H - 6}" text-anchor="middle">${esc(SC_LABELS[xf])} (log)</text>`;
  g += `<text class="axlabel" x="${-H / 2}" y="14" transform="rotate(-90)" text-anchor="middle">overall score (${esc(S.mean)})</text>`;

  /* circle area, not radius, carries the parameter count: area is what the eye reads */
  let radius = () => 5.5;
  if (rf) {
    const rs = pts.map((p) => p.m[rf]).filter((v) => isNum(v) && v > 0);
    if (rs.length) {
      const lo = Math.log10(Math.min(...rs)), hi = Math.log10(Math.max(...rs));
      radius = (m) => {
        if (!isNum(m[rf]) || m[rf] <= 0) return 3;
        const t = hi > lo ? (Math.log10(m[rf]) - lo) / (hi - lo) : 0.5;
        return Math.sqrt(16 + t * (380 - 16) / Math.PI);   // area from ~16 to ~380 px^2
      };
    }
  }

  g += pts.slice().sort((a, b) => radius(b.m) - radius(a.m)).map((p) => {
    const pin = S.pinned.has(p.m.slug);
    const rr = radius(p.m) * (pin ? 1.25 : 1);
    return `<circle cx="${X(p.m[xf]).toFixed(1)}" cy="${Y(p.overall).toFixed(1)}"
      r="${rr.toFixed(1)}" fill="${famColor(p.m.family)}"
      fill-opacity="${pin ? .95 : .62}" stroke="${famColor(p.m.family)}" stroke-width="1.2"
      data-model="${esc(p.m.slug)}"><title>${esc(p.m.label)}: ${fmtScore(p.overall)} overall, ${
      esc(fmtSI(p.m[xf]))} ${esc(SC_LABELS[xf])}${
      rf && isNum(p.m[rf]) ? `, ${esc(fmtSI(p.m[rf]))} ${esc(SC_LABELS[rf])}` : ''}</title></circle>`;
  }).join('');

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = g;

  const fams = Array.from(new Set(pts.map((p) => p.m.family))).sort();
  let legend = fams.map((f) => `<span><i style="background:${famColor(f)}"></i>${esc(f)}</span>`).join('');
  if (rf) {
    const rs = pts.map((p) => p.m[rf]).filter((v) => isNum(v) && v > 0);
    if (rs.length) {
      legend = `<span class="sizekey"><i style="width:7px;height:7px"></i><i style="width:15px;height:15px"></i>`
        + `circle area: ${esc(SC_LABELS[rf])} (${esc(fmtSI(Math.min(...rs)))} to ${esc(fmtSI(Math.max(...rs)))})</span>`
        + legend;
    }
  }
  if (cfg.note) {
    legend = `<span class="chartnote">${esc(cfg.note)} ${pts.length} of ${VIEW.length} shown.</span>`
      + legend;
  }
  $('#scatter-legend').innerHTML = legend;
}

/* ============================================================================
 * CSV export
 * ========================================================================== */

function exportCSV() {
  const metas = activeMeta(), probes = activeProbes();
  const head = ['rank', 'model', 'slug', 'family', `overall_${S.mean}`]
    .concat(metas.map((c) => c.key))
    .concat(probes.map((p) => `${p.name}_score`))
    .concat(probes.map((p) => `${p.name}_defect`));
  const q = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [head.join(',')];
  for (const r of VIEW) {
    const m = r.m;
    const row = [r.rank, m.label, m.slug, m.family, isNum(r.overall) ? r.overall.toPrecision(10) : '']
      .concat(metas.map((c) => { const v = c.get(m); return v == null ? '' : v; }))
      .concat(probes.map((p) => isNum(m.scores[p.name]) ? m.scores[p.name].toPrecision(10) : ''))
      .concat(probes.map((p) => isNum(m.defects[p.name]) ? m.defects[p.name].toPrecision(6) : ''));
    lines.push(row.map(q).join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pescert-leaderboard-${S.mean}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(`${VIEW.length} rows exported`);
}

/** clipboard fallback for pages served without a secure context */
function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;left:-9999px;top:0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); done(); } catch (e) { toast('copy failed, select the text instead'); }
  ta.remove();
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

/* ============================================================================
 * URL state: the whole view is shareable
 * ========================================================================== */

let hashLock = false;

function writeHash() {
  if (hashLock) return;
  const p = new URLSearchParams();
  if (S.mean !== 'geometric') p.set('mean', S.mean);
  if (S.value !== 'score') p.set('val', S.value);
  if (S.color !== 'score') p.set('col', S.color);
  if (S.sortKey !== 'overall' || S.sortDir !== -1) p.set('sort', `${S.sortKey}:${S.sortDir}`);
  if (S.search) p.set('q', S.search);
  if (S.offProbes.size) p.set('offp', [...S.offProbes].join(','));
  const metaKey = [...S.offMeta].sort().join(',');
  if (metaKey !== DEFAULT_OFF_META.slice().sort().join(',')) p.set('offm', metaKey);
  if (S.offFamilies.size) p.set('offf', [...S.offFamilies].join(','));
  if (S.datasets.size) { p.set('ds', [...S.datasets].join(',')); p.set('dsm', S.dsMode); }
  if (S.pinned.size) p.set('pin', [...S.pinned].join(','));
  if (S.scatter) { p.set('chart', '1'); p.set('ct', S.chart); }
  const h = p.toString();
  history.replaceState(null, '', h ? '#' + h : location.pathname + location.search);
}

function readHash() {
  const h = location.hash.replace(/^#/, '');
  if (!h) return;
  const p = new URLSearchParams(h);
  const set = (k, fn) => { const v = p.get(k); if (v !== null) fn(v); };
  set('mean', (v) => { if (['geometric', 'arithmetic', 'harmonic'].includes(v)) S.mean = v; });
  set('val',  (v) => { if (['score', 'defect'].includes(v)) S.value = v; });
  set('col',  (v) => { if (['score', 'rank', 'range', 'off'].includes(v)) S.color = v; });
  set('sort', (v) => { const [k, d] = v.split(':'); S.sortKey = k; S.sortDir = d === '1' ? 1 : -1; });
  set('q',    (v) => { S.search = v; });
  set('offp', (v) => { S.offProbes = new Set(v.split(',').filter(Boolean)); });
  set('offm', (v) => { S.offMeta = new Set(v.split(',').filter(Boolean)); });
  set('offf', (v) => { S.offFamilies = new Set(v.split(',').filter(Boolean)); });
  set('ds',   (v) => { S.datasets = new Set(v.split(',').filter(Boolean)); });
  set('dsm',  (v) => { if (['any', 'all', 'only'].includes(v)) S.dsMode = v; });
  set('pin',  (v) => { S.pinned = new Set(v.split(',').filter(Boolean)); });
  set('chart', (v) => { S.scatter = v === '1'; });
  set('ct',   (v) => { if (CHARTS[v]) S.chart = v; });
}

/* ============================================================================
 * Re-render entry point
 * ========================================================================== */

function refresh({ menu = false } = {}) {
  writeHash();
  syncSegs();
  renderTable();
  $('#cols-count').textContent = `${activeProbes().length + activeMeta().length}`;
  $('#btn-scatter').classList.toggle('on', S.scatter);
  $('#scatter-panel').hidden = !S.scatter;
  if (S.scatter) renderScatter();
  if (menu) rebuildOpenMenu();
}

function syncSegs() {
  const pairs = [['#seg-mean', S.mean], ['#seg-value', S.value], ['#seg-color', S.color], ['#seg-chart', S.chart]];
  for (const [sel, val] of pairs) {
    const host = $(sel);
    if (!host) continue;
    for (const b of $$('button', host)) b.setAttribute('aria-pressed', String(b.dataset.v === val));
  }
  const btn = $('#btn-data');
  btn.classList.toggle('on', S.datasets.size > 0);
  $('#btn-fam').classList.toggle('on', S.offFamilies.size > 0);
  $('#btn-cols').classList.toggle('on', S.offProbes.size > 0);
  $('#btn-meta').classList.toggle('on', META_COLS.some((c) => !S.offMeta.has(c.key)));
}

/* ============================================================================
 * Events
 * ========================================================================== */

function setSort(key) {
  if (S.sortKey === key) {
    S.sortDir = -S.sortDir;
  } else {
    S.sortKey = key;
    /* text sorts read best A→Z; numeric ones best-first */
    const meta = META_COLS.find((c) => c.key === key);
    S.sortDir = (key === 'model' || (meta && meta.type === 'text')) ? 1 : -1;
  }
  refresh();
}

function toggleProbe(name, force) {
  const off = force === undefined ? !S.offProbes.has(name) : !force;
  if (off) S.offProbes.add(name); else S.offProbes.delete(name);
  refresh({ menu: true });
}

function wire() {
  /* --- theme ----------------------------------------------------------- */
  const paintTheme = () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    $('#theme').textContent = dark ? '☀' : '☾';
    $('#theme').title = dark ? 'Switch to light mode' : 'Switch to dark mode';
  };
  $('#theme').onclick = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('pescert-theme', next); } catch (e) {}
    paintTheme();
    refresh();            /* the heat ramp alpha differs per theme */
  };
  paintTheme();

  /* --- segmented controls ---------------------------------------------- */
  const seg = (sel, key, after) => $(sel).addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    S[key] = b.dataset.v;
    (after || refresh)();
  });
  seg('#seg-mean', 'mean');
  seg('#seg-value', 'value');
  seg('#seg-color', 'color');
  seg('#seg-chart', 'chart', () => { syncSegs(); writeHash(); renderScatter(); });

  /* --- search ----------------------------------------------------------- */
  let tmr;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(tmr);
    const v = e.target.value;
    tmr = setTimeout(() => { S.search = v.trim(); refresh(); }, 130);
  });

  /* --- toolbar buttons -------------------------------------------------- */
  $('#btn-cols').onclick = (e) => { toggleMenu(e.currentTarget, colsMenu); };
  $('#btn-data').onclick = (e) => { toggleMenu(e.currentTarget, dataMenu); };
  $('#btn-fam').onclick  = (e) => { toggleMenu(e.currentTarget, famMenu); };
  $('#btn-meta').onclick = () => {
    const anyOn = META_COLS.some((c) => !S.offMeta.has(c.key));
    S.offMeta = anyOn
      ? new Set(META_COLS.map((c) => c.key))
      : new Set(META_COLS.map((c) => c.key).filter((k) => !META_ON_DEFAULT.includes(k)));
    refresh({ menu: true });
  };
  $('#btn-csv').onclick  = exportCSV;
  $('#btn-scatter').onclick = () => {
    S.scatter = !S.scatter;
    refresh();
    /* the charts sit below the table -- which is the point of the page and so comes
       first -- so opening them has to take you there */
    if (S.scatter) $('#scatter-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  $('#help').onclick = (e) => helpCard(e.currentTarget);
  $('#btn-reset').onclick = () => {
    S.search = ''; $('#search').value = '';
    S.offProbes = new Set();
    S.offMeta = new Set(DEFAULT_OFF_META);
    S.datasets = new Set(); S.dsMode = 'any';
    S.offFamilies = new Set(); S.pinned = new Set();
    S.mean = 'geometric'; S.value = 'score'; S.color = 'score';
    S.sortKey = 'overall'; S.sortDir = -1;
    closeMenu(); closePop(); refresh();
  };

  /* --- menu interactions (delegated) ------------------------------------ */
  document.addEventListener('click', (e) => {
    const menu = e.target.closest('.menu');
    if (!menu) return;
    const t = e.target;

    const probe = t.closest('[data-probe-toggle]');
    if (probe) { toggleProbe(probe.dataset.probeToggle); return; }

    const sec = t.closest('[data-sec-toggle]');
    if (sec) {
      const name = sec.dataset.secToggle;
      const ps = PROBES.filter((p) => p.section === name);
      const allOn = ps.every((p) => !S.offProbes.has(p.name));
      for (const p of ps) { if (allOn) S.offProbes.add(p.name); else S.offProbes.delete(p.name); }
      refresh({ menu: true });
      return;
    }

    const meta = t.closest('[data-meta-toggle]');
    if (meta) {
      const k = meta.dataset.metaToggle;
      if (S.offMeta.has(k)) S.offMeta.delete(k); else S.offMeta.add(k);
      refresh({ menu: true });
      return;
    }

    const ds = t.closest('[data-ds-toggle]');
    if (ds) {
      const k = ds.dataset.dsToggle;
      if (S.datasets.has(k)) S.datasets.delete(k); else S.datasets.add(k);
      refresh({ menu: true });
      return;
    }

    const dsm = t.closest('[data-ds-mode]');
    if (dsm) { S.dsMode = dsm.dataset.dsMode; refresh({ menu: true }); return; }

    const fam = t.closest('[data-fam-toggle]');
    if (fam) {
      const f = fam.dataset.famToggle;
      if (S.offFamilies.has(f)) S.offFamilies.delete(f); else S.offFamilies.add(f);
      refresh({ menu: true });
      return;
    }

    const act = t.closest('[data-act]');
    if (act) {
      const a = act.dataset.act;
      if (a === 'all-probes') S.offProbes = new Set();
      if (a === 'no-probes') S.offProbes = new Set(PROBES.map((p) => p.name));
      if (a === 'clear-ds') S.datasets = new Set();
      if (a === 'all-fam') S.offFamilies = new Set();
      if (a === 'no-fam') S.offFamilies = new Set(FAMILIES);
      refresh({ menu: true });
    }
  });

  /* --- table interactions (delegated) ----------------------------------- */
  $('#table').addEventListener('click', (e) => {
    const t = e.target;

    const pin = t.closest('[data-pin]');
    if (pin) {
      const s = pin.dataset.pin;
      if (S.pinned.has(s)) S.pinned.delete(s); else S.pinned.add(s);
      refresh();
      return;
    }
    const info = t.closest('[data-pop="rank"]');
    if (info) { rankCard(info); return; }

    const probeInfo = t.closest('.info[data-probe]');
    if (probeInfo) { e.stopPropagation(); probeCard(probeInfo, probeInfo.dataset.probe); return; }

    const dsChip = t.closest('[data-dataset]');
    if (dsChip) { datasetCard(dsChip, dsChip.dataset.dataset); return; }

    const mname = t.closest('[data-model]');
    if (mname) { modelCard(mname, mname.dataset.model); return; }

    const ov = t.closest('[data-overall]');
    if (ov) { modelCard(ov, ov.dataset.overall); return; }

    const cell = t.closest('[data-cell]');
    if (cell) {
      const [slug, probe] = cell.dataset.cell.split('|');
      cellCard(cell, slug, probe);
      return;
    }

    const grp = t.closest('th.grp[data-section]');
    if (grp) { sectionCard(grp, grp.dataset.section); return; }

    const th = t.closest('th[data-sort]');
    if (th) { setSort(th.dataset.sort); return; }
  });

  /* --- links inside popovers -------------------------------------------- */
  document.addEventListener('click', (e) => {
    const pop = e.target.closest('.pop');
    if (!pop) return;
    const t = e.target;

    if (t.closest('#req-send') || t.closest('#req-copy')) {
      e.preventDefault();
      const msg = requestMessage(pop);
      const warn = pop.querySelector('#req-warn');
      if (msg.missing) {
        warn.textContent = `Still needed: ${msg.missing.join(', ')}.`;
        warn.className = 'tiny warn';
        return;
      }
      warn.textContent = '';
      if (t.closest('#req-copy')) {
        const text = `To: ${contactAddress()}\nSubject: ${msg.subject}\n\n${msg.body}`;
        const done = () => toast('request copied');
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
        } else { fallbackCopy(text, done); }
      } else {
        location.href = `mailto:${contactAddress()}?subject=${encodeURIComponent(msg.subject)}`
          + `&body=${encodeURIComponent(msg.body)}`;
      }
      return;
    }

    const copy = t.closest('[data-copy]');
    if (copy) {
      e.preventDefault();
      const src = pop.querySelector(`[data-snippet="${copy.dataset.copy}"]`);
      if (src) {
        const text = src.textContent;
        const done = () => { copy.textContent = 'copied'; setTimeout(() => { copy.textContent = 'copy'; }, 1400); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
        } else {
          fallbackCopy(text, done);
        }
      }
      return;
    }

    const cell = t.closest('[data-cell]');
    if (cell) {
      e.preventDefault();
      const [slug, probe] = cell.dataset.cell.split('|');
      const anchor = popAnchor;
      cellCard(anchor, slug, probe);
      return;
    }
    const pd = t.closest('[data-probe]');
    if (pd) { e.preventDefault(); probeCard(popAnchor, pd.dataset.probe); return; }
    const ds = t.closest('[data-dataset]');
    if (ds) { e.preventDefault(); datasetCard(popAnchor, ds.dataset.dataset); return; }
    const hide = t.closest('[data-hide-probe]');
    if (hide) { e.preventDefault(); closePop(); toggleProbe(hide.dataset.hideProbe, false); return; }
    const only = t.closest('[data-only-probe]');
    if (only) {
      e.preventDefault(); closePop();
      S.offProbes = new Set(PROBES.map((p) => p.name).filter((n) => n !== only.dataset.onlyProbe));
      refresh();
      return;
    }
    const togSec = t.closest('[data-toggle-section]');
    if (togSec) {
      e.preventDefault(); closePop();
      const ps = PROBES.filter((p) => p.section === togSec.dataset.toggleSection);
      const allOn = ps.every((p) => !S.offProbes.has(p.name));
      for (const p of ps) { if (allOn) S.offProbes.add(p.name); else S.offProbes.delete(p.name); }
      refresh();
      return;
    }
    const filt = t.closest('[data-filter-dataset]');
    if (filt) {
      e.preventDefault(); closePop();
      S.datasets = new Set([filt.dataset.filterDataset]);
      S.dsMode = 'any';
      refresh();
    }
  });

  /* --- contact ----------------------------------------------------------- */
  renderContact();
  $('#btn-request').onclick = (e) => requestForm(e.currentTarget);

  /* --- scatter ---------------------------------------------------------- */
  $('#scatter').addEventListener('click', (e) => {
    const c = e.target.closest('[data-model]');
    if (c) modelCard(c, c.dataset.model);
  });

  /* --- filter-bar chips -------------------------------------------------- */
  $('#filterbar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-clear]');
    if (!b) return;
    const k = b.dataset.clear;
    if (k === 'search' || k === 'all') { S.search = ''; $('#search').value = ''; }
    if (k === 'ds' || k === 'all') S.datasets = new Set();
    if (k === 'fam' || k === 'all') S.offFamilies = new Set();
    if (k === 'probes' || k === 'all') S.offProbes = new Set();
    if (k === 'pin' || k === 'all') S.pinned = new Set();
    refresh();
  });

  /* --- global ------------------------------------------------------------ */
  /* Where a click landed has to be recorded on the *capture* pass: the handlers
     below re-render, which detaches e.target from the document, and a detached
     node's .closest() no longer finds the menu or popover it came from. */
  const OPENERS = '[data-cell],[data-model],[data-overall],[data-dataset],[data-probe],[data-pop],th.grp,#help,#btn-request';
  document.addEventListener('click', (e) => {
    e._inMenu = !!(e.target.closest && (e.target.closest('.menu') || e.target.closest('.menu-host')));
    e._inPop  = !!(e.target.closest && (e.target.closest('.pop') || e.target.closest(OPENERS)));
  }, true);
  document.addEventListener('click', (e) => {
    if (!e._inMenu) closeMenu();
    if (!e._inPop) closePop();
  });
  $('#table').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    e.preventDefault();
    setSort(th.dataset.sort);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closePop(); closeMenu(); return; }
    if (e.key === '/' && !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) {
      e.preventDefault(); $('#search').focus(); $('#search').select();
    }
  });
  addEventListener('resize', () => { applyTableWidth(); placePop(); if (S.scatter) renderScatter(); });
  /* The table no longer scrolls inside itself -- the page does -- so the shadow that
     marks the frozen Model column follows the window's horizontal offset. */
  addEventListener('scroll', () => {
    $('#tablewrap').classList.toggle('scrolled', (window.scrollX || 0) > 2);
    placePop();
  }, { passive: true });
  trackToolbarHeight();
}

/* The toolbar is sticky at the top of the page and the table header has to come to rest
   directly under it.  Its height is not a constant: the controls wrap onto a second row
   on a narrow window, so measure it and publish it as --toolbar-h. */
function trackToolbarHeight() {
  const bar = $('.toolbar');
  if (!bar) return;
  const apply = () => document.documentElement.style.setProperty(
    '--toolbar-h', `${Math.round(bar.getBoundingClientRect().height)}px`);
  apply();
  if (window.ResizeObserver) new ResizeObserver(apply).observe(bar);
  else addEventListener('resize', apply);
}

/* ============================================================================
 * Boot
 * ========================================================================== */

/* ============================================================================
 * Contact, and the "benchmark my model" request form
 * ========================================================================== */

/* Edit these two lines to change where requests go. The address is assembled at
   runtime from parts and never appears as a literal mailto: in the served HTML, which
   is enough to defeat the scrapers that read markup but do not run scripts. */
/* Both repositories below are private today, so those two buttons 404 for a visitor.
   Make them public, or drop the entry, before announcing the page -- see
   INSTRUCTION_JONAS.md, "Before you announce the page". */
const CONTACT = {
  user: 'jonas.haenseroth',
  host: 'tu-ilmenau.de',
  github: 'jhaens',
  repo: 'https://github.com/jhaens/pescert',
  benchRepo: 'https://github.com/jhaens/pescert-bench'
};

const contactAddress = () => `${CONTACT.user}@${CONTACT.host}`;

/** Fields the request form asks for. `req` marks the ones needed to submit. */
const REQUEST_FIELDS = [
  { k: 'model', label: 'Model name', req: true, ph: 'MACE-MP-0 (medium)' },
  { k: 'repo', label: 'Code repository', req: true, ph: 'https://github.com/...' },
  { k: 'checkpoint', label: 'Checkpoint / weights', req: false, ph: 'HuggingFace repo, release URL or DOI' },
  { k: 'python', label: 'Python', req: true, ph: '3.11' },
  { k: 'package', label: 'Model package + version', req: true, ph: 'mace-torch==0.3.16' },
  { k: 'torch', label: 'torch (or JAX / TF)', req: true, ph: 'torch==2.7.1' },
  { k: 'ase', label: 'ase', req: true, ph: '3.28.0' },
  { k: 'cuda', label: 'CUDA', req: false, ph: '12.6, or leave empty for CPU' },
  { k: 'calc', label: 'Calculator expression', req: false, ph: 'mace.calculators.mace_mp(model="medium")' },
  { k: 'notes', label: 'Notes', req: false, ph: 'Anything else needed to run it', area: true }
];

function requestForm(anchor) {
  const rows = REQUEST_FIELDS.map((f) => `
    <label class="ff">
      <span>${esc(f.label)}${f.req ? ' <b>*</b>' : ''}</span>
      ${f.area
        ? `<textarea rows="3" data-f="${f.k}" placeholder="${esc(f.ph)}"></textarea>`
        : `<input type="text" data-f="${f.k}" placeholder="${esc(f.ph)}">`}
    </label>`).join('');

  openPop(anchor, {
    title: 'Submit a model',
    sub: 'Opens a pre-filled message in your own mail client',
    wide: true,
    body: `
      <p>Fill this in and the button below opens your mail client with the details laid out.
      Nothing is sent from this page.</p>
      <div class="form">${rows}</div>
      <div class="linkrow">
        <button class="btn" id="req-send">Open in mail client</button>
        <button class="btn" id="req-copy">Copy as text</button>
      </div>
      <p class="tiny" id="req-warn"></p>`
  });
}

/** Collect the form into a subject and body. Returns null when required fields are empty. */
function requestMessage(pop) {
  const val = (k) => {
    const el = pop.querySelector(`[data-f="${k}"]`);
    return el ? el.value.trim() : '';
  };
  const missing = REQUEST_FIELDS.filter((f) => f.req && !val(f.k)).map((f) => f.label);
  if (missing.length) return { missing };
  const lines = REQUEST_FIELDS
    .filter((f) => val(f.k))
    .map((f) => (f.area ? `\n${f.label}:\n${val(f.k)}` : `${f.label}: ${val(f.k)}`));
  return {
    subject: `PESCERT-BENCH Request [${val('model')}]`,
    body: [
      'Please add this model to the pescert benchmark.',
      '',
      ...lines,
      '',
      '(sent from the pescert leaderboard)'
    ].join('\n')
  };
}

function renderContact() {
  const bar = $('#contactbar');
  const mail = contactAddress();
  bar.innerHTML = [
    `<a class="cbtn" id="mail-link" href="#" title="${esc(mail)}">${ICON.mail} Email</a>`,
    `<a class="cbtn" href="https://github.com/${esc(CONTACT.github)}" target="_blank" rel="noopener noreferrer">${ICON.code} @${esc(CONTACT.github)}</a>`,
    `<a class="cbtn" href="${esc(CONTACT.repo)}" target="_blank" rel="noopener noreferrer">${ICON.code} pescert</a>`,
    `<a class="cbtn" href="${esc(CONTACT.benchRepo)}" target="_blank" rel="noopener noreferrer">${ICON.code} pescert-bench</a>`,
    `<button class="cbtn primary" id="btn-request">${ICON.plus} Benchmark my UMLIP</button>`
  ].join('');

  /* href is written on interaction, so the address is not sitting in the markup */
  const link = $('#mail-link');
  link.addEventListener('click', (e) => {
    e.preventDefault();
    location.href = `mailto:${mail}`;
  });

  $('#corrections').textContent =
    'Model metadata here is curated by hand, so parameter counts, training sets and links '
    + 'can be wrong. If you spot something, or want an entry changed, please get in touch.';
}

function renderMeta() {
  const gen = DATA.generated ? new Date(DATA.generated) : null;
  const ok = MODELS.filter((m) => m.status === 'ok').length;
  const crashed = MODELS.filter((m) => m._crashed.size).length;
  $('#runmeta').innerHTML = [
    `<span class="chip">${MODELS.length} models</span>`,
    `<span class="chip">${PROBES.length} probes</span>`,
    `<span class="chip">${FAMILIES.length} families</span>`,
    ok === MODELS.length ? '' : `<span class="chip">${ok} completed</span>`,
    crashed ? `<span class="chip" title="models with at least one probe that raised">${crashed} with a crashed probe</span>` : '',
    gen ? `<span class="chip" title="${esc(DATA.generated)}">run ${gen.toISOString().slice(0, 10)}</span>` : ''
  ].filter(Boolean).join('');

  $('#footer').innerHTML = `
    <p>Scores come from <span class="mono">index.json</span>, generated ${esc(DATA.generated || '')}.
    Per-element values are read on demand from each model's <span class="mono">report_full.json</span>.
    Averaged over ${esc(MODELS[0] ? MODELS[0].elements : '')} on small in-domain substrates, one seed.</p>
`;
}

async function main() {
  try {
    const [idx, links, probedoc] = await Promise.all([
      loadJSON(`${ROOT}/index.json`),
      loadJSON('links.json', true),
      loadJSON('probes.json', true)
    ]);
    DATA = idx;
    LINKS = links || { families: {}, models: {} };
    PROBEDOC = probedoc || { probes: {}, sections: {} };
  } catch (e) {
    document.querySelector('.wrap').innerHTML =
      `<div class="empty"><b>Could not load the data.</b>${esc(e.message)}</div>`;
    return;
  }
  prepare();
  readHash();
  $('#search').value = S.search;
  renderMeta();
  wire();
  refresh();
}

main();
