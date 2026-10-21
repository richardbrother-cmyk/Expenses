import {
  occurrences, nextOccurrence, describeRule, parseMonthDays, formatMonthDays,
  todayISO, addDays, monthKey, monthRange, addMonths, parseISO, MONTHS, WEEKDAYS, NTH,
} from './recurrence.js';

// =====================================================================
// Estado y almacenamiento (todo se guarda en el dispositivo)
// =====================================================================
const KEY = 'finanzas-data-v1';
const PALETTE = ['#0f766e', '#e11d48', '#2563eb', '#d97706', '#7c3aed', '#059669', '#db2777', '#0891b2', '#65a30d', '#ea580c', '#4f46e5', '#64748b'];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function defaults() {
  const exp = [['Vivienda', '🏠'], ['Supermercado', '🛒'], ['Comida fuera', '🍽️'], ['Transporte', '🚗'], ['Servicios', '💡'], ['Salud', '💊'],
    ['Educación', '🎓'], ['Entretenimiento', '🎬'], ['Ropa', '👕'], ['Suscripciones', '📺'], ['Deudas', '💳'], ['Otros gastos', '📦']];
  const inc = [['Salario', '💼'], ['Freelance', '💻'], ['Inversiones', '📈'], ['Regalos', '🎁'], ['Otros ingresos', '💰']];
  let i = 0;
  const mk = type => ([name, icon]) => ({ id: uid(), name, icon, type, color: PALETTE[i++ % PALETTE.length], budget: 0 });
  return {
    version: 1,
    settings: { currency: 'MXN', locale: 'es-MX', startBalance: 0, theme: 'auto' },
    categories: [...exp.map(mk('expense')), ...inc.map(mk('income'))],
    transactions: [],
    recurring: [],
  };
}

function normalize(d) {
  const base = defaults();
  return {
    version: 1,
    settings: { ...base.settings, ...(d.settings || {}) },
    categories: (Array.isArray(d.categories) && d.categories.length ? d.categories : base.categories)
      .map(c => ({ ...c, color: /^#[0-9a-f]{3,8}$/i.test(c.color) ? c.color : '#64748b', budget: Number(c.budget) || 0 })),
    transactions: Array.isArray(d.transactions) ? d.transactions : [],
    recurring: (Array.isArray(d.recurring) ? d.recurring : []).map(r => ({ skipped: [], active: true, ...r })),
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) { console.error(e); }
  return defaults();
}

let S = load();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(S));
  } catch (e) {
    toast('No se pudo guardar: ' + e.message);
  }
}

// Estado de la interfaz (no se guarda)
const ui = {
  txMonth: monthKey(todayISO()),
  txFilter: 'all',
  txSearch: '',
  repMonth: monthKey(todayISO()),
  repTab: 'resumen',
  projMonths: 6,
};

// =====================================================================
// Utilidades de formato
// =====================================================================
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let _fmt, _fmtKey;
function fmt(n) {
  const k = S.settings.locale + S.settings.currency;
  if (_fmtKey !== k) {
    try {
      _fmt = new Intl.NumberFormat(S.settings.locale, { style: 'currency', currency: S.settings.currency });
    } catch {
      _fmt = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
    }
    _fmtKey = k;
  }
  return _fmt.format(n || 0);
}

// Sin centavos, para tablas angostas.
const fmt0 = n => new Intl.NumberFormat(S.settings.locale, { style: 'currency', currency: S.settings.currency, maximumFractionDigits: 0 }).format(n || 0);

const fmtCompact = n => new Intl.NumberFormat(S.settings.locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n);

const SHORT_M = MONTHS.map(m => m.slice(0, 3));
const monthLabel = key => `${MONTHS[+key.slice(5) - 1]} ${key.slice(0, 4)}`;
const shortMonth = key => SHORT_M[+key.slice(5) - 1];

function dateLabel(iso) {
  const t = todayISO();
  if (iso === t) return 'Hoy';
  if (iso === addDays(t, 1)) return 'Mañana';
  if (iso === addDays(t, -1)) return 'Ayer';
  const [y, m, d] = iso.split('-');
  return `${+d} ${SHORT_M[+m - 1]}${y !== t.slice(0, 4) ? ' ' + y : ''}`;
}

function longDate(iso) {
  const d = parseISO(iso);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]}`;
}

const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
const round2 = n => Math.round(n * 100) / 100;

// =====================================================================
// Lógica financiera
// =====================================================================
const cat = id => S.categories.find(c => c.id === id) || { name: 'Sin categoría', icon: '❔', color: '#94a3b8', type: 'expense' };
const ruleById = id => S.recurring.find(r => r.id === id);
const txInRange = (from, to) => S.transactions.filter(t => t.date >= from && t.date <= to);
const sumBy = (list, type) => list.filter(t => t.type === type).reduce((a, t) => a + t.amount, 0);
const byDateDesc = (a, b) => b.date.localeCompare(a.date) || (b.created || 0) - (a.created || 0);

function balanceAt(date) {
  return S.transactions.reduce((a, t) => (t.date <= date ? a + (t.type === 'income' ? t.amount : -t.amount) : a), Number(S.settings.startBalance) || 0);
}

function registeredSet() {
  return new Set(S.transactions.filter(t => t.recurringId).map(t => `${t.recurringId}|${t.occurrence}`));
}

const isSkipped = (r, d) => (r.skipped || []).includes(d);

// Desde cuándo se rastrean pendientes de una regla: su inicio o el mes en que se creó (lo que sea posterior).
function trackFrom(r) {
  const created = (r.createdAt || r.start).slice(0, 7) + '-01';
  return r.start > created ? r.start : created;
}

// Ocurrencias de recurrentes no registradas ni omitidas en [from, to].
function openOccurrences(from, to) {
  const reg = registeredSet();
  const out = [];
  for (const r of S.recurring) {
    if (!r.active) continue;
    const f = from < trackFrom(r) ? trackFrom(r) : from;
    for (const d of occurrences(r, f, to)) {
      if (!reg.has(`${r.id}|${d}`) && !isSkipped(r, d)) out.push({ r, d });
    }
  }
  return out.sort((a, b) => a.d.localeCompare(b.d));
}

const pendingList = () => openOccurrences('0000-01-01', todayISO());
const upcomingList = days => openOccurrences(addDays(todayISO(), 1), addDays(todayISO(), days));

// Registra automáticamente las recurrentes marcadas como "auto" cuya fecha ya llegó.
function processAuto() {
  let n = 0;
  for (const { r, d } of pendingList()) {
    if (!r.auto) continue;
    S.transactions.push({ id: uid(), type: r.type, amount: r.amount, categoryId: r.categoryId, date: d, note: r.name, recurringId: r.id, occurrence: d, created: Date.now() });
    n++;
  }
  if (n) {
    save();
    setTimeout(() => toast(`${n} movimiento(s) recurrente(s) registrado(s) automáticamente`), 400);
  }
}

// Proyectado vs real por categoría para un mes.
// Proyectado = recurrentes del mes + presupuesto variable de la categoría.
function planVsReal(key) {
  const [from, to] = monthRange(key);
  const rows = new Map();
  const get = (id, type) => {
    if (!rows.has(id)) rows.set(id, { categoryId: id, type, planned: 0, actual: 0 });
    return rows.get(id);
  };
  for (const r of S.recurring) {
    if (!r.active) continue;
    for (const d of occurrences(r, from, to)) if (!isSkipped(r, d)) get(r.categoryId, r.type).planned += r.amount;
  }
  for (const c of S.categories) if (c.budget > 0) get(c.id, c.type).planned += Number(c.budget);
  for (const t of txInRange(from, to)) get(t.categoryId, t.type).actual += t.amount;
  const list = [...rows.values()].sort((a, b) => Math.max(b.planned, b.actual) - Math.max(a.planned, a.actual));
  const tot = type => list.filter(x => x.type === type).reduce((a, x) => ({ planned: a.planned + x.planned, actual: a.actual + x.actual }), { planned: 0, actual: 0 });
  return { list, inc: tot('income'), exp: tot('expense') };
}

// Proyección de saldo mes a mes, a partir del saldo real de hoy.
function projection(n) {
  const today = todayISO();
  const cur = monthKey(today);
  const reg = registeredSet();
  let bal = balanceAt(today);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const key = addMonths(cur, i);
    const [from, to] = monthRange(key);
    let inc = 0, exp = 0;
    const add = (type, amt) => { if (type === 'income') inc += amt; else exp += amt; };

    for (const r of S.recurring) {
      if (!r.active) continue;
      // En el mes actual también se suman los pendientes vencidos.
      const f = i === 0 ? trackFrom(r) : from;
      for (const d of occurrences(r, f, to)) if (!reg.has(`${r.id}|${d}`) && !isSkipped(r, d)) add(r.type, r.amount);
    }
    for (const c of S.categories) {
      if (!(c.budget > 0)) continue;
      let rem = Number(c.budget);
      if (i === 0) {
        const used = S.transactions.filter(t => t.categoryId === c.id && !t.recurringId && t.date >= from && t.date <= to).reduce((a, t) => a + t.amount, 0);
        rem = Math.max(0, rem - used);
      }
      add(c.type, rem);
    }
    for (const t of S.transactions) if (t.date > today && t.date >= from && t.date <= to) add(t.type, t.amount);

    const realInc = i === 0 ? sumBy(txInRange(from, today), 'income') : 0;
    const realExp = i === 0 ? sumBy(txInRange(from, today), 'expense') : 0;
    bal += inc - exp;
    rows.push({ key, inc: inc + realInc, exp: exp + realExp, pendInc: inc, pendExp: exp, realInc, realExp, bal });
  }
  return rows;
}

const monthlyEquivalent = r => (occurrences(r, todayISO(), addDays(todayISO(), 364)).length * r.amount) / 12;

// =====================================================================
// Gráficas SVG (sin librerías)
// =====================================================================
function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  return [1, 2, 2.5, 5, 10].map(m => m * p).find(x => x >= v);
}

function legend(series) {
  return `<div class="legend">${series.map(s => `<span><i style="background:${s.color}${s.dashed ? ';opacity:.6' : ''}"></i>${esc(s.name)}</span>`).join('')}</div>`;
}

function barChart({ labels, series, height = 180 }) {
  const W = 340, H = height, L = 40, B = 20, T = 8;
  const max = niceMax(Math.max(0, ...series.flatMap(s => s.values)));
  const ih = H - T - B;
  const cw = (W - L - 4) / labels.length;
  const bw = Math.min(16, (cw - 8) / series.length);
  let g = '';
  for (let k = 0; k <= 4; k++) {
    const y = T + ih - (ih * k) / 4;
    g += `<line class="grid" x1="${L}" x2="${W}" y1="${y}" y2="${y}"/><text x="${L - 5}" y="${y + 3}" text-anchor="end">${fmtCompact((max * k) / 4)}</text>`;
  }
  labels.forEach((lab, i) => {
    const x0 = L + i * cw + (cw - bw * series.length) / 2;
    series.forEach((s, j) => {
      const v = s.values[i] || 0;
      const h = (v / max) * ih;
      g += `<rect x="${x0 + j * bw + 1}" y="${T + ih - h}" width="${bw - 2}" height="${Math.max(0, h)}" rx="3" fill="${s.color}" ${s.dashed ? 'opacity=".45"' : ''}><title>${esc(s.name)}: ${fmt(v)}</title></rect>`;
    });
    g += `<text x="${L + i * cw + cw / 2}" y="${H - 5}" text-anchor="middle">${esc(lab)}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${g}</svg>${legend(series)}`;
}

function lineChart({ labels, series, height = 190 }) {
  const W = 340, H = height, L = 44, B = 20, T = 10, R = 8;
  const vals = series.flatMap(s => s.values).filter(v => v != null);
  let max = Math.max(0, ...vals), min = Math.min(0, ...vals);
  if (max === min) max = min + 1;
  const span = niceMax(max - min);
  if (min < 0) min = -Math.ceil(-min / (span / 4)) * (span / 4);
  max = min + span;
  while (max < Math.max(...vals, 0)) max += span / 4;
  const ih = H - T - B, iw = W - L - R;
  const X = i => L + (labels.length === 1 ? iw / 2 : (iw * i) / (labels.length - 1));
  const Y = v => T + ih - ((v - min) / (max - min)) * ih;
  let g = '';
  for (let k = 0; k <= 4; k++) {
    const v = min + ((max - min) * k) / 4;
    g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 5}" y="${Y(v) + 3}" text-anchor="end">${fmtCompact(v)}</text>`;
  }
  if (min < 0) g += `<line class="zero" x1="${L}" x2="${W - R}" y1="${Y(0)}" y2="${Y(0)}"/>`;
  const every = Math.ceil(labels.length / 7);
  labels.forEach((lab, i) => { if (i % every === 0 || i === labels.length - 1) g += `<text x="${X(i)}" y="${H - 5}" text-anchor="middle">${esc(lab)}</text>`; });
  for (const s of series) {
    const pts = s.values.map((v, i) => (v == null ? null : [X(i), Y(v), v, i])).filter(Boolean);
    if (!pts.length) continue;
    g += `<polyline fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round" ${s.dashed ? 'stroke-dasharray="5 4"' : ''} points="${pts.map(p => `${p[0]},${p[1]}`).join(' ')}"/>`;
    for (const p of pts) g += `<circle cx="${p[0]}" cy="${p[1]}" r="3.2" fill="${s.color}"><title>${esc(labels[p[3]])} · ${esc(s.name)}: ${fmt(p[2])}</title></circle>`;
  }
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${g}</svg>${legend(series)}`;
}

function donut(items) {
  const total = items.reduce((a, x) => a + x.value, 0);
  const R = 52, C = 2 * Math.PI * R;
  let off = 0, arcs = '';
  for (const it of items) {
    const len = (it.value / total) * C;
    arcs += `<circle r="${R}" cx="70" cy="70" fill="none" stroke="${it.color}" stroke-width="22" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 70 70)"><title>${esc(it.label)}: ${fmt(it.value)}</title></circle>`;
    off += len;
  }
  return `<div class="donut-wrap">
    <svg class="chart" viewBox="0 0 140 140" role="img">${arcs}
      <text x="70" y="66" text-anchor="middle" style="font-size:10px">Total</text>
      <text x="70" y="82" text-anchor="middle" style="font-size:13px;font-weight:700;fill:var(--text)">${fmtCompact(total)}</text>
    </svg>
    <div class="donut-legend">${items.map(it => `<div><span><i class="dot" style="background:${it.color}"></i>${esc(it.label)}</span><b>${pct(it.value, total)}%</b></div>`).join('')}</div>
  </div>`;
}

// =====================================================================
// Componentes de interfaz
// =====================================================================
function txItem(t) {
  const c = cat(t.categoryId);
  return `<button class="item" data-act="edit-tx" data-id="${t.id}">
    <span class="ico" style="background:${c.color}22">${esc(c.icon)}</span>
    <div class="grow"><div>${esc(t.note || c.name)}</div>
      <div class="muted small">${esc(c.name)} · ${dateLabel(t.date)}${t.recurringId ? ' · ↻' : ''}</div></div>
    <span class="amt ${t.type}">${t.type === 'income' ? '+' : '−'}${fmt(t.amount)}</span>
  </button>`;
}

function occItem({ r, d }, actions = true) {
  const c = cat(r.categoryId);
  const late = d < todayISO();
  return `<div class="item" style="cursor:default">
    <span class="ico" style="background:${c.color}22">${esc(c.icon)}</span>
    <div class="grow"><div>${esc(r.name)}</div>
      <div class="muted small">${dateLabel(d)}${late ? '<span class="tag late">vencido</span>' : ''} · <span class="amt ${r.type}">${r.type === 'income' ? '+' : '−'}${fmt(r.amount)}</span></div></div>
    ${actions ? `<div class="occ-actions">
      <button class="icon-btn" title="Omitir" aria-label="Omitir" data-act="occ-skip" data-id="${r.id}" data-date="${d}">✕</button>
      <button class="icon-btn" title="Editar monto" aria-label="Registrar con otro monto" data-act="occ-edit" data-id="${r.id}" data-date="${d}">✎</button>
      <button class="icon-btn ok" title="Registrar" aria-label="Registrar" data-act="occ-ok" data-id="${r.id}" data-date="${d}">✓</button>
    </div>` : ''}
  </div>`;
}

function progress(label, actual, planned, cls) {
  const p = pct(actual, planned);
  const over = planned > 0 && actual > planned && cls === 'exp';
  return `<div class="prog">
    <div class="prog-l"><span>${label}</span><span class="muted">${fmt(actual)} de ${fmt(planned)}${planned ? ` · ${p}%` : ''}</span></div>
    <div class="bar"><i class="${over ? 'over' : cls}" style="width:${Math.min(100, planned ? p : actual ? 100 : 0)}%"></i></div>
  </div>`;
}

function monthNav(field) {
  return `<div class="monthnav">
    <button data-act="month" data-field="${field}" data-dir="-1" aria-label="Mes anterior">‹</button>
    <b>${monthLabel(ui[field])}</b>
    <button data-act="month" data-field="${field}" data-dir="1" aria-label="Mes siguiente">›</button>
  </div>`;
}

const emptyState = (em, title, text, btn) => `<div class="card empty"><div class="em">${em}</div><h3>${title}</h3><p>${text}</p>${btn || ''}</div>`;

// =====================================================================
// Vistas
// =====================================================================
function renderHome() {
  const today = todayISO(), key = monthKey(today);
  const [from] = monthRange(key);
  const mtx = txInRange(from, today);
  const inc = sumBy(mtx, 'income'), exp = sumBy(mtx, 'expense');
  const bal = balanceAt(today);
  const proj = projection(1)[0];
  const pvr = planVsReal(key);
  const pend = pendingList();
  const up = upcomingList(30);
  const recent = [...S.transactions].filter(t => t.date <= today).sort(byDateDesc).slice(0, 5);
  const empty = !S.transactions.length && !S.recurring.length;

  return `
  <section class="card hero">
    <div class="muted small">Saldo actual</div>
    <div class="big ${bal < 0 ? 'neg' : ''}">${fmt(bal)}</div>
    <div class="hero-row">
      <div><span class="dot inc"></span>Ingresos del mes<b>${fmt(inc)}</b></div>
      <div><span class="dot exp"></span>Gastos del mes<b>${fmt(exp)}</b></div>
    </div>
  </section>

  ${empty ? `<section class="card empty">
    <div class="em">👋</div><h3>¡Bienvenido!</h3>
    <p>Registra tus movimientos con el botón <b>+</b>, crea tus gastos e ingresos recurrentes y define presupuestos en Ajustes para ver tu proyección.</p>
    <div class="btn-col">
      <button class="btn primary" data-act="new-rule">Crear un recurrente</button>
      <button class="btn" data-act="sample">Probar con datos de ejemplo</button>
    </div></section>` : ''}

  <section class="card">
    <div class="card-h"><h3>Cierre proyectado de ${MONTHS[+key.slice(5) - 1]}</h3><a href="#/reportes" data-rep="plan">Plan vs real</a></div>
    <div class="big2 ${proj.bal < 0 ? 'neg' : ''}">${fmt(proj.bal)}</div>
    ${progress('Gastos', pvr.exp.actual, pvr.exp.planned, 'exp')}
    ${progress('Ingresos', pvr.inc.actual, pvr.inc.planned, 'inc')}
    <p class="hint" style="margin-top:10px">Faltan por entrar ${fmt(proj.pendInc)} y por salir ${fmt(proj.pendExp)} este mes según tus recurrentes y presupuestos.</p>
  </section>

  ${pend.length ? `<section class="card">
    <div class="card-h"><h3>Por confirmar <span class="badge">${pend.length}</span></h3></div>
    <p class="hint">Recurrentes cuya fecha ya llegó. Confírmalos (✓), ajusta el monto real (✎) u omítelos (✕).</p>
    ${pend.map(o => occItem(o)).join('')}
  </section>` : ''}

  <section class="card">
    <div class="card-h"><h3>Próximos 30 días</h3><a href="#/recurrentes">Recurrentes</a></div>
    ${up.length ? up.slice(0, 8).map(o => occItem(o, false)).join('') + (up.length > 8 ? `<p class="hint">y ${up.length - 8} más…</p>` : '') : '<p class="muted small">No hay recurrentes en los próximos 30 días.</p>'}
  </section>

  <section class="card">
    <div class="card-h"><h3>Últimos movimientos</h3><a href="#/movimientos">Ver todos</a></div>
    ${recent.length ? recent.map(txItem).join('') : '<p class="muted small">Aún no hay movimientos.</p>'}
  </section>`;
}

function renderTx() {
  return `${monthNav('txMonth')}
  <div class="filters">
    <div class="chips">${[['all', 'Todos'], ['expense', 'Gastos'], ['income', 'Ingresos']].map(([v, l]) => `<button class="chip ${ui.txFilter === v ? 'on' : ''}" data-act="tx-filter" data-v="${v}">${l}</button>`).join('')}</div>
    <input type="search" id="tx-search" placeholder="Buscar por nota o categoría" value="${esc(ui.txSearch)}">
  </div>
  <div id="tx-list"></div>`;
}

function fillTxList() {
  const el = document.getElementById('tx-list');
  if (!el) return;
  const [from, to] = monthRange(ui.txMonth);
  const q = ui.txSearch.trim().toLowerCase();
  const all = txInRange(from, to);
  const list = all.filter(t => (ui.txFilter === 'all' || t.type === ui.txFilter) &&
    (!q || (t.note || '').toLowerCase().includes(q) || cat(t.categoryId).name.toLowerCase().includes(q))).sort(byDateDesc);
  const inc = sumBy(all, 'income'), exp = sumBy(all, 'expense');
  let html = `<div class="stats">
    <div class="stat"><span>Ingresos</span><b class="pos">${fmt(inc)}</b></div>
    <div class="stat"><span>Gastos</span><b class="neg">${fmt(exp)}</b></div>
    <div class="stat"><span>Neto</span><b>${fmt(inc - exp)}</b></div>
  </div>`;
  if (!list.length) {
    el.innerHTML = html + emptyState('🧾', 'Sin movimientos', q ? 'No hay resultados para tu búsqueda.' : 'No hay movimientos en este mes.', '<button class="btn primary" data-act="new-tx">Agregar movimiento</button>');
    return;
  }
  const groups = {};
  for (const t of list) (groups[t.date] ||= []).push(t);
  for (const [d, items] of Object.entries(groups)) {
    const net = items.reduce((a, t) => a + (t.type === 'income' ? t.amount : -t.amount), 0);
    html += `<div class="day-h"><span>${longDate(d)}</span><span>${net >= 0 ? '+' : '−'}${fmt(Math.abs(net))}</span></div>
      <div class="card" style="padding:4px 14px">${items.map(txItem).join('')}</div>`;
  }
  el.innerHTML = html;
}

function renderRecurring() {
  if (!S.recurring.length) {
    return emptyState('↻', 'Sin recurrentes', 'Agrega pagos o ingresos que se repiten: renta el día 5 de cada mes, el seguro cada bimestre, la clase de natación cada jueves…',
      '<button class="btn primary" data-act="new-rule">Nuevo recurrente</button>');
  }
  const today = todayISO();
  const section = (type, title) => {
    const rules = S.recurring.filter(r => r.type === type).sort((a, b) => (b.active - a.active) || (nextOccurrence(a, today) || '9').localeCompare(nextOccurrence(b, today) || '9'));
    if (!rules.length) return '';
    const total = rules.filter(r => r.active).reduce((a, r) => a + monthlyEquivalent(r), 0);
    return `<section class="card">
      <div class="card-h"><h3>${title}</h3><span class="muted small">≈ ${fmt(total)}/mes</span></div>
      ${rules.map(r => {
        const c = cat(r.categoryId);
        const next = nextOccurrence(r, today);
        return `<button class="item" data-act="edit-rule" data-id="${r.id}" ${r.active ? '' : 'style="opacity:.55"'}>
          <span class="ico" style="background:${c.color}22">${esc(c.icon)}</span>
          <div class="grow"><div>${esc(r.name)}${r.active ? '' : '<span class="tag">pausado</span>'}${r.auto ? '<span class="tag">auto</span>' : ''}</div>
            <div class="muted small">${esc(describeRule(r))}</div>
            <div class="muted small">${next ? `Próximo: ${dateLabel(next)}` : 'Finalizado'}</div></div>
          <span class="amt ${r.type}">${fmt(r.amount)}</span>
        </button>`;
      }).join('')}
    </section>`;
  };
  return `<button class="btn primary block" data-act="new-rule" style="margin-bottom:14px">+ Nuevo recurrente</button>
    ${section('income', 'Ingresos recurrentes')}${section('expense', 'Gastos recurrentes')}`;
}

function renderReports() {
  const tabs = [['resumen', 'Resumen'], ['plan', 'Plan vs real'], ['proy', 'Proyección']];
  let body = '';
  if (ui.repTab === 'resumen') body = reportSummary();
  else if (ui.repTab === 'plan') body = reportPlan();
  else body = reportProjection();
  return `<div class="seg-tabs">${tabs.map(([v, l]) => `<button class="${ui.repTab === v ? 'on' : ''}" data-act="rep-tab" data-v="${v}">${l}</button>`).join('')}</div>${body}`;
}

function lastMonths(n, endKey) {
  return Array.from({ length: n }, (_, i) => addMonths(endKey, i - n + 1));
}

function reportSummary() {
  const key = ui.repMonth;
  const [from, to] = monthRange(key);
  const list = txInRange(from, to);
  const inc = sumBy(list, 'income'), exp = sumBy(list, 'expense');
  const byCat = {};
  for (const t of list.filter(t => t.type === 'expense')) byCat[t.categoryId] = (byCat[t.categoryId] || 0) + t.amount;
  const items = Object.entries(byCat).map(([id, value]) => ({ label: cat(id).name, color: cat(id).color, value, icon: cat(id).icon })).sort((a, b) => b.value - a.value);
  const top = items.slice(0, 7);
  if (items.length > 7) top.push({ label: 'Otros', color: '#94a3b8', value: items.slice(7).reduce((a, x) => a + x.value, 0) });
  const months = lastMonths(6, key);
  const series = months.map(k => { const [f, t] = monthRange(k); const l = txInRange(f, t); return [sumBy(l, 'income'), sumBy(l, 'expense')]; });
  const biggest = list.filter(t => t.type === 'expense').sort((a, b) => b.amount - a.amount).slice(0, 5);

  return `${monthNav('repMonth')}
  <div class="stats">
    <div class="stat"><span>Ingresos</span><b class="pos">${fmt(inc)}</b></div>
    <div class="stat"><span>Gastos</span><b class="neg">${fmt(exp)}</b></div>
    <div class="stat"><span>Ahorro</span><b>${inc > 0 ? pct(inc - exp, inc) + '%' : '—'}</b></div>
  </div>
  <section class="card"><h3 style="margin-bottom:10px">Gastos por categoría</h3>
    ${top.length ? donut(top) : '<p class="muted small">Sin gastos este mes.</p>'}
  </section>
  <section class="card"><h3 style="margin-bottom:10px">Ingresos vs gastos (6 meses)</h3>
    ${barChart({ labels: months.map(shortMonth), series: [
      { name: 'Ingresos', color: 'var(--inc)', values: series.map(s => s[0]) },
      { name: 'Gastos', color: 'var(--exp)', values: series.map(s => s[1]) },
    ] })}
  </section>
  ${biggest.length ? `<section class="card"><h3 style="margin-bottom:6px">Gastos más grandes</h3>${biggest.map(txItem).join('')}</section>` : ''}
  <button class="btn block" data-act="export-csv">Exportar movimientos (CSV)</button>`;
}

function reportPlan() {
  const key = ui.repMonth;
  const pvr = planVsReal(key);
  const isCur = key === monthKey(todayISO());
  const row = x => {
    const c = cat(x.categoryId);
    const diff = x.actual - x.planned;
    const good = x.type === 'income' ? diff >= 0 : diff <= 0;
    return `<div class="pvr-row">
      <div class="pvr-top"><span>${esc(c.icon)} ${esc(c.name)}</span><b class="${good ? 'pos' : 'neg'}">${diff > 0 ? '+' : diff < 0 ? '−' : ''}${fmt(Math.abs(diff))}</b></div>
      <div class="bar" style="margin-top:6px"><i class="${!good && x.type === 'expense' ? 'over' : x.type === 'income' ? 'inc' : 'exp'}" style="width:${Math.min(100, x.planned ? pct(x.actual, x.planned) : 100)}%"></i></div>
      <div class="pvr-sub"><span>Real ${fmt(x.actual)}</span><span>Proyectado ${fmt(x.planned)}${x.planned ? ` · ${pct(x.actual, x.planned)}%` : ''}</span></div>
    </div>`;
  };
  const block = (type, title, t) => {
    const l = pvr.list.filter(x => x.type === type);
    return `<section class="card">
      <div class="card-h"><h3>${title}</h3><span class="small muted">${pct(t.actual, t.planned)}%</span></div>
      ${progress('Total', t.actual, t.planned, type === 'income' ? 'inc' : 'exp')}
      <div style="margin-top:8px">${l.length ? l.map(row).join('') : '<p class="muted small">Sin datos. Agrega recurrentes o presupuestos.</p>'}</div>
    </section>`;
  };
  const months = lastMonths(6, key);
  const hist = months.map(planVsReal);
  return `${monthNav('repMonth')}
  ${isCur ? '<p class="hint" style="margin:-4px 0 12px">Mes en curso: lo real seguirá cambiando conforme registres movimientos.</p>' : ''}
  <div class="stats">
    <div class="stat"><span>Neto proyectado</span><b>${fmt(pvr.inc.planned - pvr.exp.planned)}</b></div>
    <div class="stat"><span>Neto real</span><b>${fmt(pvr.inc.actual - pvr.exp.actual)}</b></div>
    <div class="stat"><span>Diferencia</span><b class="${(pvr.inc.actual - pvr.exp.actual) - (pvr.inc.planned - pvr.exp.planned) >= 0 ? 'pos' : 'neg'}">${fmt((pvr.inc.actual - pvr.exp.actual) - (pvr.inc.planned - pvr.exp.planned))}</b></div>
  </div>
  ${block('expense', 'Gastos', pvr.exp)}
  ${block('income', 'Ingresos', pvr.inc)}
  <section class="card"><h3 style="margin-bottom:10px">Gastos: proyectado vs real</h3>
    ${barChart({ labels: months.map(shortMonth), series: [
      { name: 'Proyectado', color: 'var(--plan)', values: hist.map(h => h.exp.planned) },
      { name: 'Real', color: 'var(--exp)', values: hist.map(h => h.exp.actual) },
    ] })}
  </section>
  <section class="card"><h3 style="margin-bottom:10px">Ingresos: proyectado vs real</h3>
    ${barChart({ labels: months.map(shortMonth), series: [
      { name: 'Proyectado', color: 'var(--plan)', values: hist.map(h => h.inc.planned) },
      { name: 'Real', color: 'var(--inc)', values: hist.map(h => h.inc.actual) },
    ] })}
  </section>
  <p class="hint">Proyectado = recurrentes programados en el mes + presupuesto variable de cada categoría (Ajustes → Categorías).</p>`;
}

function reportProjection() {
  const n = ui.projMonths;
  const rows = projection(n);
  const cur = monthKey(todayISO());
  const past = lastMonths(6, addMonths(cur, -1));
  const labels = [...past, ...rows.map(r => r.key)].map(shortMonth);
  const realVals = [...past.map(k => balanceAt(monthRange(k)[1])), balanceAt(todayISO()), ...Array(n - 1).fill(null)];
  const projVals = [...Array(past.length - 1).fill(null), balanceAt(monthRange(past[past.length - 1])[1]), ...rows.map(r => r.bal)];
  const minRow = rows.reduce((a, r) => (r.bal < a.bal ? r : a), rows[0]);

  return `<div class="chips" style="margin-bottom:12px">${[3, 6, 12, 24].map(m => `<button class="chip ${n === m ? 'on' : ''}" data-act="proj-n" data-v="${m}">${m} meses</button>`).join('')}</div>
  <div class="stats">
    <div class="stat"><span>Saldo hoy</span><b>${fmt(balanceAt(todayISO()))}</b></div>
    <div class="stat"><span>En ${n} meses</span><b class="${rows[n - 1].bal < 0 ? 'neg' : ''}">${fmt(rows[n - 1].bal)}</b></div>
    <div class="stat"><span>Saldo más bajo</span><b class="${minRow.bal < 0 ? 'neg' : ''}">${fmt(minRow.bal)}</b></div>
  </div>
  ${minRow.bal < 0 ? `<div class="card" style="border-color:var(--exp)"><b class="neg">⚠ Atención:</b> tu saldo proyectado queda en negativo en ${monthLabel(minRow.key)}.</div>` : ''}
  <section class="card"><h3 style="margin-bottom:10px">Saldo: real y proyectado</h3>
    ${lineChart({ labels, series: [
      { name: 'Real', color: 'var(--primary)', values: realVals },
      { name: 'Proyectado', color: 'var(--warn)', values: projVals, dashed: true },
    ] })}
  </section>
  <section class="card"><h3 style="margin-bottom:10px">Flujo mensual proyectado</h3>
    ${barChart({ labels: rows.map(r => shortMonth(r.key)), series: [
      { name: 'Ingresos', color: 'var(--inc)', values: rows.map(r => r.inc) },
      { name: 'Gastos', color: 'var(--exp)', values: rows.map(r => r.exp) },
    ] })}
  </section>
  <section class="card scroll-x">
    <table class="tbl">
      <thead><tr><th>Mes</th><th>Ingresos</th><th>Gastos</th><th>Neto</th><th>Saldo</th></tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td class="cap">${shortMonth(r.key)} ${r.key.slice(2, 4)}${r.key === cur ? '*' : ''}</td>
        <td class="pos">${fmt0(r.inc)}</td><td class="neg">${fmt0(r.exp)}</td>
        <td>${fmt0(r.inc - r.exp)}</td><td class="${r.bal < 0 ? 'neg' : ''}"><b>${fmt0(r.bal)}</b></td></tr>`).join('')}</tbody>
    </table>
    <p class="hint" style="margin-top:8px">* El mes actual combina lo real registrado (${fmt(rows[0].realInc)} ingresos, ${fmt(rows[0].realExp)} gastos) con lo pendiente.</p>
  </section>
  <p class="hint">La proyección usa tus recurrentes activos, los presupuestos variables por categoría y los movimientos con fecha futura.</p>`;
}

const CURRENCIES = [['MXN', 'es-MX', 'Peso mexicano'], ['USD', 'en-US', 'Dólar'], ['EUR', 'es-ES', 'Euro'], ['COP', 'es-CO', 'Peso colombiano'], ['ARS', 'es-AR', 'Peso argentino'],
  ['CLP', 'es-CL', 'Peso chileno'], ['PEN', 'es-PE', 'Sol peruano'], ['GTQ', 'es-GT', 'Quetzal'], ['DOP', 'es-DO', 'Peso dominicano'], ['UYU', 'es-UY', 'Peso uruguayo'],
  ['BOB', 'es-BO', 'Boliviano'], ['CRC', 'es-CR', 'Colón'], ['HNL', 'es-HN', 'Lempira'], ['PYG', 'es-PY', 'Guaraní']];

let installPrompt = null;

function renderSettings() {
  const st = S.settings;
  const catRows = type => S.categories.filter(c => c.type === type).map(c => `<button class="item" data-act="edit-cat" data-id="${c.id}">
      <span class="ico" style="background:${c.color}22">${esc(c.icon)}</span>
      <div class="grow"><div>${esc(c.name)}</div><div class="muted small">${c.budget > 0 ? `Presupuesto ${fmt(c.budget)}/mes` : 'Sin presupuesto'}</div></div>
      <span class="muted">›</span></button>`).join('');
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;

  return `
  ${!standalone ? `<section class="card">
    <h3>Instalar en tu celular</h3>
    ${installPrompt ? '<p class="hint">Instala la app para usarla como cualquier otra, incluso sin internet.</p><button class="btn primary block" data-act="install" style="margin-top:8px">Instalar app</button>'
      : isIOS ? '<p class="hint">En Safari toca <b>Compartir</b> ⬆️ y luego <b>Agregar a inicio</b>.</p>'
        : '<p class="hint">En Chrome abre el menú ⋮ y elige <b>Instalar app</b> o <b>Agregar a pantalla de inicio</b>.</p>'}
  </section>` : ''}

  <section class="card">
    <h3 style="margin-bottom:6px">General</h3>
    <div class="settings-row"><span>Moneda</span>
      <select id="set-currency">${CURRENCIES.map(([c, , n]) => `<option value="${c}" ${st.currency === c ? 'selected' : ''}>${c} · ${n}</option>`).join('')}</select></div>
    <div class="settings-row"><span>Saldo inicial<br><small class="muted">Lo que tenías antes de tu primer registro</small></span>
      <input id="set-start" type="number" inputmode="decimal" step="0.01" value="${st.startBalance}"></div>
    <div class="settings-row"><span>Tema</span>
      <select id="set-theme">${[['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Oscuro']].map(([v, l]) => `<option value="${v}" ${st.theme === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
  </section>

  <section class="card">
    <div class="card-h"><h3>Categorías de gasto</h3><button class="link" data-act="new-cat" data-type="expense">+ Agregar</button></div>
    <p class="hint">Define un presupuesto mensual para gastos variables (súper, gasolina…) y se sumará a tu proyección.</p>
    ${catRows('expense')}
  </section>
  <section class="card">
    <div class="card-h"><h3>Categorías de ingreso</h3><button class="link" data-act="new-cat" data-type="income">+ Agregar</button></div>
    ${catRows('income')}
  </section>

  <section class="card">
    <h3 style="margin-bottom:6px">Respaldo de datos</h3>
    <p class="hint">Tus datos se guardan solo en este dispositivo. Descarga un respaldo de vez en cuando para no perderlos o para pasarlos a otro teléfono.</p>
    <div class="btn-col" style="margin-top:10px">
      <button class="btn" data-act="export-json">Descargar respaldo (JSON)</button>
      <button class="btn" data-act="import-json">Restaurar respaldo</button>
      <button class="btn" data-act="export-csv">Exportar movimientos (CSV / Excel)</button>
      <button class="btn danger" data-act="reset">Borrar todos los datos</button>
    </div>
    <input type="file" id="import-file" accept="application/json,.json" hidden>
  </section>
  <p class="hint" style="text-align:center">Mis Finanzas · ${S.transactions.length} movimientos · ${S.recurring.length} recurrentes</p>`;
}

// =====================================================================
// Hoja inferior (formularios)
// =====================================================================
const sheet = document.getElementById('sheet');
const sheetBody = document.getElementById('sheet-body');

function openSheet(html) {
  sheetBody.innerHTML = html;
  sheet.hidden = false;
  document.body.style.overflow = 'hidden';
  return sheetBody;
}

function closeSheet() {
  sheet.hidden = true;
  sheetBody.innerHTML = '';
  document.body.style.overflow = '';
}

const catOptions = (type, sel) => S.categories.filter(c => c.type === type).map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.icon)} ${esc(c.name)}</option>`).join('');

const typeSeg = type => `<div class="seg" role="radiogroup" aria-label="Tipo">
  <label><input type="radio" name="type" value="expense" ${type === 'expense' ? 'checked' : ''}><span>Gasto</span></label>
  <label><input type="radio" name="type" value="income" ${type === 'income' ? 'checked' : ''}><span>Ingreso</span></label>
</div>`;

function bindTypeToCategories(form, getSel) {
  form.querySelectorAll('[name=type]').forEach(el => el.addEventListener('change', () => {
    form.categoryId.innerHTML = catOptions(form.type.value, getSel());
  }));
}

function txForm(tx = null, preset = {}) {
  const t = { type: 'expense', amount: '', date: todayISO(), categoryId: '', note: '', ...preset, ...(tx || {}) };
  if (!t.categoryId) t.categoryId = (S.categories.find(c => c.type === t.type) || {}).id;
  const rule = t.recurringId && ruleById(t.recurringId);
  const f = openSheet(`<form id="f-tx" class="form" novalidate>
    <h2>${tx ? 'Editar movimiento' : 'Nuevo movimiento'}</h2>
    ${typeSeg(t.type)}
    <label class="field amount"><span>Monto</span><input name="amount" type="number" inputmode="decimal" step="0.01" min="0.01" required value="${t.amount}" placeholder="0.00"></label>
    <label class="field"><span>Categoría</span><select name="categoryId" required>${catOptions(t.type, t.categoryId)}</select></label>
    <label class="field"><span>Fecha</span><input name="date" type="date" required value="${t.date}"></label>
    <label class="field"><span>Nota</span><input name="note" maxlength="80" value="${esc(t.note)}" placeholder="Ej. Despensa de la semana"></label>
    ${rule ? `<p class="hint">↻ Vinculado a «${esc(rule.name)}» (${dateLabel(t.occurrence)})</p>` : ''}
    <div class="actions">
      ${tx ? '<button type="button" class="btn danger" data-act="del-tx">Eliminar</button>' : ''}
      <button class="btn primary">Guardar</button>
    </div>
    ${!tx && !t.recurringId ? '<button type="button" class="link" data-act="tx-to-rule">↻ ¿Se repite? Conviértelo en recurrente</button>' : ''}
  </form>`).querySelector('form');
  bindTypeToCategories(f, () => t.categoryId);
  if (!tx) setTimeout(() => f.amount.focus(), 250);

  f.addEventListener('submit', e => {
    e.preventDefault();
    const amount = round2(parseFloat(f.amount.value));
    if (!(amount > 0)) return toast('Escribe un monto válido');
    if (!f.date.value) return toast('Elige una fecha');
    const data = { type: f.type.value, amount, categoryId: f.categoryId.value, date: f.date.value, note: f.note.value.trim() };
    if (tx) Object.assign(S.transactions.find(x => x.id === tx.id), data);
    else S.transactions.push({ id: uid(), ...data, recurringId: t.recurringId, occurrence: t.occurrence, created: Date.now() });
    save();
    closeSheet();
    render();
    toast(tx ? 'Movimiento actualizado' : 'Movimiento guardado');
  });

  f.querySelector('[data-act=del-tx]')?.addEventListener('click', () => {
    if (!confirm('¿Eliminar este movimiento?')) return;
    S.transactions = S.transactions.filter(x => x.id !== tx.id);
    save();
    closeSheet();
    render();
    toast('Movimiento eliminado');
  });

  f.querySelector('[data-act=tx-to-rule]')?.addEventListener('click', () => {
    ruleForm(null, { type: f.type.value, amount: f.amount.value, categoryId: f.categoryId.value, name: f.note.value.trim(), start: f.date.value || todayISO() });
  });
}

const PRESETS = [
  ['custom', 'Personalizada'], ['weekly-1', 'Cada semana'], ['weekly-2', 'Cada 2 semanas'], ['monthly-1', 'Cada mes'], ['monthly-2', 'Cada bimestre (2 meses)'],
  ['monthly-3', 'Cada trimestre (3 meses)'], ['monthly-4', 'Cada cuatrimestre (4 meses)'], ['monthly-6', 'Cada semestre (6 meses)'], ['yearly-1', 'Cada año'], ['daily-1', 'Cada día'],
];

function ruleForm(rule = null, preset = {}) {
  const today = todayISO();
  const r = {
    type: 'expense', name: '', amount: '', categoryId: '', freq: 'monthly', interval: 1, weekdays: [], monthMode: 'day', monthDays: [],
    nth: 1, nthWeekday: 1, start: today, endType: 'never', endDate: '', count: 12, auto: false, active: true, ...preset, ...(rule || {}),
  };
  if (!r.categoryId) r.categoryId = (S.categories.find(c => c.type === r.type) || {}).id;
  if (!r.monthDays.length) r.monthDays = [parseISO(r.start).getUTCDate()];
  if (!r.weekdays.length) r.weekdays = [parseISO(r.start).getUTCDay()];
  const presetKey = PRESETS.some(p => p[0] === `${r.freq}-${r.interval}`) ? `${r.freq}-${r.interval}` : 'custom';

  const f = openSheet(`<form id="f-rule" class="form" novalidate>
    <h2>${rule ? 'Editar recurrente' : 'Nuevo recurrente'}</h2>
    ${typeSeg(r.type)}
    <label class="field"><span>Concepto</span><input name="name" maxlength="60" required value="${esc(r.name)}" placeholder="Ej. Renta, Netflix, Sueldo"></label>
    <label class="field amount"><span>Monto</span><input name="amount" type="number" inputmode="decimal" step="0.01" min="0.01" required value="${r.amount}" placeholder="0.00"></label>
    <label class="field"><span>Categoría</span><select name="categoryId">${catOptions(r.type, r.categoryId)}</select></label>

    <fieldset class="box"><legend>¿Cuándo se repite?</legend>
      <label class="field"><span>Frecuencia</span><select name="preset">${PRESETS.map(([v, l]) => `<option value="${v}" ${v === presetKey ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <div class="inline"><span>Cada</span><input name="interval" type="number" min="1" max="99" value="${r.interval}">
        <select name="freq">${[['daily', 'día(s)'], ['weekly', 'semana(s)'], ['monthly', 'mes(es)'], ['yearly', 'año(s)']].map(([v, l]) => `<option value="${v}" ${r.freq === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>

      <div data-show="weekly"><span class="lbl">Días de la semana</span>
        <div class="wdays" style="margin-top:6px">${[1, 2, 3, 4, 5, 6, 0].map(d => `<label title="${WEEKDAYS[d]}"><input type="checkbox" name="wd" value="${d}" ${r.weekdays.map(Number).includes(d) ? 'checked' : ''}><span>${'DLMMJVS'[d]}</span></label>`).join('')}</div></div>

      <div data-show="monthly" class="form" style="gap:8px">
        <label class="radio"><input type="radio" name="monthMode" value="day" ${r.monthMode !== 'nth' ? 'checked' : ''}> El día del mes…</label>
        <div class="inline" data-mode="day"><input name="monthDays" value="${esc(formatMonthDays(r.monthDays))}" placeholder="Ej. 5  ·  15, último"></div>
        <p class="hint" data-mode="day">Puedes poner varios días separados por coma, o «último» para el último día del mes.</p>
        <label class="radio"><input type="radio" name="monthMode" value="nth" ${r.monthMode === 'nth' ? 'checked' : ''}> Un día de la semana específico…</label>
        <div class="inline" data-mode="nth"><span>El</span>
          <select name="nth">${[1, 2, 3, 4, -1].map(n => `<option value="${n}" ${+r.nth === n ? 'selected' : ''}>${NTH[n]}</option>`).join('')}</select>
          <select name="nthWeekday">${[1, 2, 3, 4, 5, 6, 0].map(d => `<option value="${d}" ${+r.nthWeekday === d ? 'selected' : ''}>${WEEKDAYS[d]}</option>`).join('')}</select></div>
      </div>

      <label class="field"><span>Empieza el</span><input name="start" type="date" required value="${r.start}"></label>
      <div class="inline"><span>Termina</span>
        <select name="endType"><option value="never" ${r.endType === 'never' ? 'selected' : ''}>Nunca</option><option value="date" ${r.endType === 'date' ? 'selected' : ''}>En una fecha</option><option value="count" ${r.endType === 'count' ? 'selected' : ''}>Después de…</option></select></div>
      <div class="inline" data-end="date"><input name="endDate" type="date" value="${r.endDate || ''}"></div>
      <div class="inline" data-end="count"><input name="count" type="number" min="1" value="${r.count || 12}"><span>veces</span></div>

      <div class="preview" id="rule-preview"></div>
    </fieldset>

    <label class="check"><input type="checkbox" name="auto" ${r.auto ? 'checked' : ''}>
      <span>Registrar automáticamente al llegar la fecha<small>Ideal para montos fijos (sueldo, domiciliaciones). Si no, aparecerá en «Por confirmar».</small></span></label>
    ${rule ? `<label class="check"><input type="checkbox" name="active" ${r.active ? 'checked' : ''}><span>Activo<small>Desactívalo para pausarlo sin borrarlo.</small></span></label>` : ''}

    <div class="actions">
      ${rule ? '<button type="button" class="btn danger" data-act="del-rule">Eliminar</button>' : ''}
      <button class="btn primary">Guardar</button>
    </div>
  </form>`).querySelector('form');

  bindTypeToCategories(f, () => r.categoryId);

  const read = () => ({
    freq: f.freq.value,
    interval: Math.max(1, parseInt(f.interval.value, 10) || 1),
    weekdays: [...f.querySelectorAll('[name=wd]:checked')].map(x => +x.value),
    monthMode: f.monthMode.value,
    monthDays: parseMonthDays(f.monthDays.value),
    nth: +f.nth.value,
    nthWeekday: +f.nthWeekday.value,
    start: f.start.value,
    endType: f.endType.value,
    endDate: f.endDate.value,
    count: Math.max(1, parseInt(f.count.value, 10) || 1),
  });

  const sync = e => {
    const v = read();
    f.querySelectorAll('[data-show]').forEach(el => { el.hidden = el.dataset.show !== v.freq; });
    f.querySelectorAll('[data-mode]').forEach(el => { el.hidden = el.dataset.mode !== v.monthMode; });
    f.querySelectorAll('[data-end]').forEach(el => { el.hidden = el.dataset.end !== v.endType; });
    // El selector de frecuencia refleja lo elegido en "Cada N …" (salvo cuando se está cambiando él mismo).
    if (e?.target !== f.preset) {
      const key = `${v.freq}-${v.interval}`;
      f.preset.value = PRESETS.some(p => p[0] === key) ? key : 'custom';
    }
    const prev = document.getElementById('rule-preview');
    if (!v.start) { prev.innerHTML = 'Elige la fecha de inicio.'; return; }
    const from = v.start > today ? v.start : today;
    const next = occurrences(v, from, addDays(from, 366 * 5), 6);
    prev.innerHTML = `<b>${esc(describeRule(v))}</b>${next.length ? `Próximas fechas:<ul>${next.map(d => `<li>${longDate(d)}${d.slice(0, 4) !== today.slice(0, 4) ? ' ' + d.slice(0, 4) : ''}</li>`).join('')}</ul>` : '<span class="muted">No hay fechas futuras.</span>'}`;
  };

  f.preset.addEventListener('change', () => {
    if (f.preset.value === 'custom') return;
    const [freq, n] = f.preset.value.split('-');
    f.freq.value = freq;
    f.interval.value = n;
    sync();
  });
  f.start.addEventListener('change', () => {
    // Si el usuario no ha tocado los días, sigue la fecha de inicio.
    if (!f.start.value) return;
    const d = parseISO(f.start.value);
    if (f.querySelectorAll('[name=wd]:checked').length <= 1) f.querySelectorAll('[name=wd]').forEach(x => { x.checked = +x.value === d.getUTCDay(); });
    if (parseMonthDays(f.monthDays.value).length <= 1) f.monthDays.value = d.getUTCDate();
  });
  f.addEventListener('input', sync);
  f.addEventListener('change', sync);
  sync();

  f.addEventListener('submit', e => {
    e.preventDefault();
    const v = read();
    const amount = round2(parseFloat(f.amount.value));
    const name = f.name.value.trim();
    if (!name) return toast('Escribe un concepto');
    if (!(amount > 0)) return toast('Escribe un monto válido');
    if (!v.start) return toast('Elige la fecha de inicio');
    if (v.freq === 'weekly' && !v.weekdays.length) return toast('Elige al menos un día de la semana');
    if (v.freq === 'monthly' && v.monthMode === 'day' && !v.monthDays.length) return toast('Escribe el día del mes (1–31 o «último»)');
    if (v.endType === 'date' && !v.endDate) return toast('Elige la fecha de término');
    const data = { ...v, type: f.type.value, name, amount, categoryId: f.categoryId.value, auto: f.auto.checked };
    if (rule) {
      Object.assign(ruleById(rule.id), data, { active: f.active.checked });
    } else {
      S.recurring.push({ id: uid(), ...data, active: true, skipped: [], createdAt: today });
    }
    save();
    processAuto();
    closeSheet();
    render();
    toast(rule ? 'Recurrente actualizado' : 'Recurrente creado');
  });

  f.querySelector('[data-act=del-rule]')?.addEventListener('click', () => {
    const linked = S.transactions.filter(t => t.recurringId === rule.id).length;
    if (!confirm(`¿Eliminar «${rule.name}»?${linked ? `\nLos ${linked} movimientos ya registrados se conservarán.` : ''}`)) return;
    S.recurring = S.recurring.filter(x => x.id !== rule.id);
    S.transactions.forEach(t => { if (t.recurringId === rule.id) { delete t.recurringId; delete t.occurrence; } });
    save();
    closeSheet();
    render();
    toast('Recurrente eliminado');
  });
}

function catForm(c = null, type = 'expense') {
  const v = { name: '', icon: '📦', type, color: PALETTE[S.categories.length % PALETTE.length], budget: 0, ...(c || {}) };
  const f = openSheet(`<form class="form" novalidate>
    <h2>${c ? 'Editar categoría' : 'Nueva categoría'}</h2>
    ${c ? '' : typeSeg(v.type)}
    <div class="inline">
      <label class="field" style="width:80px"><span>Ícono</span><input name="icon" maxlength="4" value="${esc(v.icon)}" style="text-align:center;font-size:1.3rem"></label>
      <label class="field grow"><span>Nombre</span><input name="name" maxlength="30" required value="${esc(v.name)}"></label>
    </div>
    <label class="field"><span>Color</span><input name="color" type="color" value="${v.color}" style="padding:4px;height:46px"></label>
    <label class="field"><span>Presupuesto mensual variable (opcional)</span>
      <input name="budget" type="number" inputmode="decimal" step="0.01" min="0" value="${v.budget || ''}" placeholder="0.00"></label>
    <p class="hint">Úsalo para gastos que no tienen fecha fija (súper, gasolina, salidas). Se suma a lo proyectado además de los recurrentes de esta categoría.</p>
    <div class="actions">
      ${c ? '<button type="button" class="btn danger" data-act="del-cat">Eliminar</button>' : ''}
      <button class="btn primary">Guardar</button>
    </div>
  </form>`).querySelector('form');

  f.addEventListener('submit', e => {
    e.preventDefault();
    const name = f.name.value.trim();
    if (!name) return toast('Escribe un nombre');
    const data = { name, icon: f.icon.value.trim() || '📦', color: f.color.value, budget: Math.max(0, round2(parseFloat(f.budget.value) || 0)) };
    if (c) Object.assign(S.categories.find(x => x.id === c.id), data);
    else S.categories.push({ id: uid(), type: f.type.value, ...data });
    save();
    closeSheet();
    render();
  });

  f.querySelector('[data-act=del-cat]')?.addEventListener('click', () => {
    const used = S.transactions.some(t => t.categoryId === c.id) || S.recurring.some(r => r.categoryId === c.id);
    if (S.categories.filter(x => x.type === c.type).length <= 1) return toast('Debe quedar al menos una categoría');
    if (!confirm(used ? `«${c.name}» tiene movimientos o recurrentes. Se moverán a otra categoría del mismo tipo. ¿Continuar?` : `¿Eliminar «${c.name}»?`)) return;
    const fallback = S.categories.find(x => x.type === c.type && x.id !== c.id);
    S.transactions.forEach(t => { if (t.categoryId === c.id) t.categoryId = fallback.id; });
    S.recurring.forEach(r => { if (r.categoryId === c.id) r.categoryId = fallback.id; });
    S.categories = S.categories.filter(x => x.id !== c.id);
    save();
    closeSheet();
    render();
  });
}

// =====================================================================
// Respaldo, exportación y datos de ejemplo
// =====================================================================
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCSV() {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Fecha', 'Tipo', 'Categoría', 'Monto', 'Nota', 'Recurrente'].map(q).join(',')];
  for (const t of [...S.transactions].sort((a, b) => a.date.localeCompare(b.date))) {
    rows.push([t.date, t.type === 'income' ? 'Ingreso' : 'Gasto', cat(t.categoryId).name, t.amount, t.note, t.recurringId ? (ruleById(t.recurringId)?.name || 'Sí') : ''].map(q).join(','));
  }
  download(`movimientos-${todayISO()}.csv`, '﻿' + rows.join('\r\n'), 'text/csv;charset=utf-8');
}

function loadSample() {
  const today = todayISO();
  const created = addMonths(monthKey(today), -3) + '-01';
  const byName = n => S.categories.find(c => c.name === n)?.id || S.categories[0].id;
  const rules = [
    { name: 'Sueldo', type: 'income', amount: 14000, categoryId: byName('Salario'), freq: 'monthly', interval: 1, monthDays: [15, -1], auto: true },
    { name: 'Renta', type: 'expense', amount: 9500, categoryId: byName('Vivienda'), freq: 'monthly', interval: 1, monthDays: [5] },
    { name: 'Internet y TV', type: 'expense', amount: 599, categoryId: byName('Servicios'), freq: 'monthly', interval: 1, monthDays: [10], auto: true },
    { name: 'Luz', type: 'expense', amount: 650, categoryId: byName('Servicios'), freq: 'monthly', interval: 2, monthDays: [20] },
    { name: 'Netflix', type: 'expense', amount: 299, categoryId: byName('Suscripciones'), freq: 'monthly', interval: 1, monthDays: [12], auto: true },
    { name: 'Clase de natación', type: 'expense', amount: 250, categoryId: byName('Salud'), freq: 'weekly', interval: 1, weekdays: [4] },
    { name: 'Seguro del auto', type: 'expense', amount: 3200, categoryId: byName('Transporte'), freq: 'monthly', interval: 3, monthDays: [1] },
  ].map(r => ({ id: uid(), monthMode: 'day', weekdays: [], nth: 1, nthWeekday: 1, endType: 'never', count: 12, endDate: '', auto: false, active: true, skipped: [], createdAt: created, start: created, ...r }));
  S.recurring.push(...rules);
  // Registra el historial de recurrentes (con variaciones) dejando lo más reciente por confirmar.
  for (const r of rules) {
    for (const d of occurrences(r, created, addDays(today, -4))) {
      const amt = r.name === 'Luz' ? round2(r.amount * (0.85 + Math.random() * 0.4)) : r.amount;
      S.transactions.push({ id: uid(), type: r.type, amount: amt, categoryId: r.categoryId, date: d, note: r.name, recurringId: r.id, occurrence: d, created: Date.now() });
    }
  }
  const budgets = { Supermercado: 4500, 'Comida fuera': 1800, Transporte: 1500, Entretenimiento: 800 };
  S.categories.forEach(c => { if (budgets[c.name]) c.budget = budgets[c.name]; });
  const variable = [['Supermercado', ['Súper', 'Despensa', 'Mercado'], 450, 1300, 9], ['Comida fuera', ['Tacos', 'Café', 'Comida con amigos'], 90, 600, 8],
    ['Transporte', ['Gasolina', 'Uber'], 120, 700, 6], ['Entretenimiento', ['Cine', 'Concierto'], 150, 900, 2], ['Ropa', ['Tenis', 'Playera'], 300, 1200, 0.7]];
  for (let d = created; d <= today; d = addDays(d, 1)) {
    for (const [cn, notes, min, max, perMonth] of variable) {
      if (Math.random() < perMonth / 30) {
        S.transactions.push({ id: uid(), type: 'expense', amount: Math.round(min + Math.random() * (max - min)), categoryId: byName(cn), date: d, note: notes[Math.floor(Math.random() * notes.length)], created: Date.now() });
      }
    }
  }
  S.transactions.push({ id: uid(), type: 'income', amount: 3500, categoryId: byName('Freelance'), date: addDays(today, -12), note: 'Proyecto de diseño', created: Date.now() });
  S.settings.startBalance = 8000;
  processAuto();
  save();
  render();
  toast('Datos de ejemplo cargados. Puedes borrarlos en Ajustes.');
}

// =====================================================================
// Navegación y eventos
// =====================================================================
const VIEWS = {
  inicio: ['Inicio', renderHome],
  movimientos: ['Movimientos', renderTx],
  recurrentes: ['Recurrentes', renderRecurring],
  reportes: ['Reportes', renderReports],
  ajustes: ['Ajustes', renderSettings],
};

const currentView = () => {
  const v = location.hash.replace(/^#\/?/, '');
  return VIEWS[v] ? v : 'inicio';
};

function render() {
  const v = currentView();
  const [title, fn] = VIEWS[v];
  document.getElementById('title').textContent = title;
  document.querySelectorAll('.tabbar a').forEach(a => a.classList.toggle('on', a.dataset.tab === v));
  document.getElementById('view').innerHTML = fn();
  document.getElementById('fab').hidden = v === 'ajustes';
  if (v === 'movimientos') {
    fillTxList();
    document.getElementById('tx-search').addEventListener('input', e => { ui.txSearch = e.target.value; fillTxList(); });
  }
  if (v === 'ajustes') bindSettings();
}

function bindSettings() {
  document.getElementById('set-currency').addEventListener('change', e => {
    const c = CURRENCIES.find(x => x[0] === e.target.value);
    S.settings.currency = c[0];
    S.settings.locale = c[1];
    save();
    render();
  });
  document.getElementById('set-start').addEventListener('change', e => {
    S.settings.startBalance = round2(parseFloat(e.target.value) || 0);
    save();
    toast('Saldo inicial actualizado');
  });
  document.getElementById('set-theme').addEventListener('change', e => {
    S.settings.theme = e.target.value;
    applyTheme();
    save();
  });
  document.getElementById('import-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || !Array.isArray(data.transactions) || !Array.isArray(data.categories)) throw new Error('Formato no reconocido');
      if (!confirm(`Se reemplazarán tus datos actuales con el respaldo (${data.transactions.length} movimientos). ¿Continuar?`)) return;
      S = normalize(data);
      save();
      applyTheme();
      render();
      toast('Respaldo restaurado');
    } catch (err) {
      toast('No se pudo leer el archivo: ' + err.message);
    }
  });
}

function applyTheme() {
  const t = S.settings.theme;
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name=theme-color]').content = dark ? '#0d1412' : '#0f766e';
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function registerOccurrence(r, d, amount = r.amount) {
  S.transactions.push({ id: uid(), type: r.type, amount, categoryId: r.categoryId, date: d, note: r.name, recurringId: r.id, occurrence: d, created: Date.now() });
  save();
  render();
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act], a[data-rep]');
  if (!el) return;
  if (el.dataset.rep) { ui.repTab = el.dataset.rep; return; }
  const { act, id } = el.dataset;
  switch (act) {
    case 'close-sheet': closeSheet(); break;
    case 'new-tx': txForm(); break;
    case 'edit-tx': txForm(S.transactions.find(t => t.id === id)); break;
    case 'new-rule': ruleForm(); break;
    case 'edit-rule': ruleForm(ruleById(id)); break;
    case 'occ-ok': {
      const r = ruleById(id);
      registerOccurrence(r, el.dataset.date);
      toast(`«${r.name}» registrado`);
      break;
    }
    case 'occ-edit': {
      const r = ruleById(id);
      txForm(null, { type: r.type, amount: r.amount, categoryId: r.categoryId, date: el.dataset.date, note: r.name, recurringId: r.id, occurrence: el.dataset.date });
      break;
    }
    case 'occ-skip': {
      const r = ruleById(id);
      r.skipped = [...(r.skipped || []), el.dataset.date];
      save();
      render();
      toast(`«${r.name}» del ${dateLabel(el.dataset.date)} omitido`);
      break;
    }
    case 'month': ui[el.dataset.field] = addMonths(ui[el.dataset.field], +el.dataset.dir); render(); break;
    case 'tx-filter': ui.txFilter = el.dataset.v; render(); break;
    case 'rep-tab': ui.repTab = el.dataset.v; render(); break;
    case 'proj-n': ui.projMonths = +el.dataset.v; render(); break;
    case 'new-cat': catForm(null, el.dataset.type); break;
    case 'edit-cat': catForm(S.categories.find(c => c.id === id)); break;
    case 'export-json': download(`finanzas-respaldo-${todayISO()}.json`, JSON.stringify(S, null, 2), 'application/json'); break;
    case 'import-json': document.getElementById('import-file').click(); break;
    case 'export-csv': exportCSV(); break;
    case 'sample': loadSample(); break;
    case 'install':
      installPrompt?.prompt();
      installPrompt?.userChoice.finally(() => { installPrompt = null; render(); });
      break;
    case 'reset':
      if (confirm('¿Borrar TODOS tus datos? Esta acción no se puede deshacer. Te recomendamos descargar un respaldo antes.')) {
        S = defaults();
        save();
        render();
        toast('Datos borrados');
      }
      break;
  }
});

document.getElementById('fab').addEventListener('click', () => (currentView() === 'recurrentes' ? ruleForm() : txForm()));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !sheet.hidden) closeSheet(); });
window.addEventListener('hashchange', () => { closeSheet(); render(); scrollTo(0, 0); });
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installPrompt = e;
  if (currentView() === 'ajustes') render();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

// Al volver a la app (por ejemplo, otro día) se recalculan pendientes y automáticos.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && sheet.hidden) { processAuto(); render(); }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(console.error));
}
navigator.storage?.persist?.();

applyTheme();
processAuto();
render();
