// Motor de fechas y recurrencias.
// Todas las fechas se manejan como texto 'YYYY-MM-DD' y la aritmética se hace en UTC
// para evitar problemas de zona horaria y horario de verano.

export const pad = n => String(n).padStart(2, '0');

export function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toISO(d) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDays(s, n) {
  const d = parseISO(s);
  d.setUTCDate(d.getUTCDate() + n);
  return toISO(d);
}

export function daysInMonth(y, m0) {
  return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const monthKey = s => s.slice(0, 7);

export function monthRange(key) {
  const [y, m] = key.split('-').map(Number);
  return [`${key}-01`, `${key}-${pad(daysInMonth(y, m - 1))}`];
}

export function addMonths(key, n) {
  const [y, m] = key.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${pad((t % 12 + 12) % 12 + 1)}`;
}

export const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const WEEKDAYS_PL = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'];
export const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const NTH = { 1: 'primer', 2: 'segundo', 3: 'tercer', 4: 'cuarto', '-1': 'último' };

// Día del mes del n-ésimo día de la semana (nth = 1..4, o -1 para el último).
function nthWeekdayOfMonth(y, m0, nth, wd) {
  const dim = daysInMonth(y, m0);
  if (nth > 0) {
    const first = new Date(Date.UTC(y, m0, 1)).getUTCDay();
    const day = 1 + ((wd - first + 7) % 7) + (nth - 1) * 7;
    return day <= dim ? day : null;
  }
  const last = new Date(Date.UTC(y, m0, dim)).getUTCDay();
  return dim - ((last - wd + 7) % 7);
}

// Genera, en orden, todas las fechas de la regla a partir de rule.start.
function* generate(rule) {
  const start = rule.start;
  const sd = parseISO(start);
  const n = Math.max(1, Number(rule.interval) || 1);

  switch (rule.freq) {
    case 'daily': {
      for (let cur = start; ; cur = addDays(cur, n)) yield cur;
    }
    case 'weekly': {
      const mon = d => (d + 6) % 7; // lunes = 0
      const days = (rule.weekdays && rule.weekdays.length ? [...rule.weekdays] : [sd.getUTCDay()])
        .map(Number).sort((a, b) => mon(a) - mon(b));
      let weekStart = addDays(start, -mon(sd.getUTCDay()));
      for (;;) {
        for (const wd of days) {
          const dt = addDays(weekStart, mon(wd));
          if (dt >= start) yield dt;
        }
        weekStart = addDays(weekStart, 7 * n);
      }
    }
    case 'monthly': {
      let y = sd.getUTCFullYear(), m = sd.getUTCMonth();
      for (;;) {
        const dim = daysInMonth(y, m);
        let days;
        if (rule.monthMode === 'nth') {
          const d = nthWeekdayOfMonth(y, m, Number(rule.nth) || 1, Number(rule.nthWeekday) || 0);
          days = d ? [d] : [];
        } else {
          const src = rule.monthDays && rule.monthDays.length ? rule.monthDays : [sd.getUTCDate()];
          // -1 = último día; días que no existen (ej. 31 en abril) se ajustan al último día.
          days = [...new Set(src.map(Number).map(d => (d === -1 || d > dim ? dim : d)))].sort((a, b) => a - b);
        }
        for (const d of days) {
          const dt = `${y}-${pad(m + 1)}-${pad(d)}`;
          if (dt >= start) yield dt;
        }
        m += n;
        y += Math.floor(m / 12);
        m %= 12;
      }
    }
    case 'yearly': {
      const m = sd.getUTCMonth(), d = sd.getUTCDate();
      for (let y = sd.getUTCFullYear(); ; y += n) yield `${y}-${pad(m + 1)}-${pad(Math.min(d, daysInMonth(y, m)))}`;
    }
    default:
      yield start; // 'once'
  }
}

// Fechas de la regla dentro de [from, to] (inclusive), respetando fin por fecha o por número de veces.
export function occurrences(rule, from, to, limit = Infinity) {
  const out = [];
  if (!rule.start) return out;
  const end = rule.endType === 'date' && rule.endDate && rule.endDate < to ? rule.endDate : to;
  const max = rule.endType === 'count' ? Math.max(1, Number(rule.count) || 1) : Infinity;
  let i = 0, guard = 0;
  for (const dt of generate(rule)) {
    if (dt > end || i >= max || ++guard > 200000) break;
    i++;
    if (dt >= from) {
      out.push(dt);
      if (out.length >= limit) break;
    }
  }
  return out;
}

export function nextOccurrence(rule, from) {
  return occurrences(rule, from, addDays(from, 366 * 10), 1)[0] || null;
}

const joinList = a => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} y ${a[a.length - 1]}`);

// Texto legible de la regla, ej. "Cada 2 meses (bimestral) el día 5".
export function describeRule(r) {
  if (r.freq === 'once') return 'Una sola vez';
  const n = Math.max(1, Number(r.interval) || 1);
  const sd = r.start ? parseISO(r.start) : new Date();
  const units = { daily: ['Diario', 'días'], weekly: ['Cada semana', 'semanas'], monthly: ['Cada mes', 'meses'], yearly: ['Cada año', 'años'] }[r.freq];
  const nick = { 'weekly-2': 'catorcenal', 'monthly-2': 'bimestral', 'monthly-3': 'trimestral', 'monthly-4': 'cuatrimestral', 'monthly-6': 'semestral' }[`${r.freq}-${n}`];
  let text = n === 1 ? units[0] : `Cada ${n} ${units[1]}${nick ? ` (${nick})` : ''}`;

  if (r.freq === 'weekly') {
    const days = (r.weekdays && r.weekdays.length ? r.weekdays : [sd.getUTCDay()]).map(Number).sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    text += ` los ${joinList(days.map(d => WEEKDAYS_PL[d]))}`;
  } else if (r.freq === 'monthly') {
    if (r.monthMode === 'nth') {
      text += ` el ${NTH[r.nth] || 'primer'} ${WEEKDAYS[Number(r.nthWeekday) || 0]}`;
    } else {
      const days = (r.monthDays && r.monthDays.length ? r.monthDays : [sd.getUTCDate()]).map(Number);
      const sorted = [...days.filter(d => d > 0).sort((a, b) => a - b), ...(days.includes(-1) ? ['último'] : [])];
      text += sorted.length === 1 ? ` el día ${sorted[0]}` : ` los días ${joinList(sorted.map(String))}`;
    }
  } else if (r.freq === 'yearly') {
    text += ` el ${sd.getUTCDate()} de ${MONTHS[sd.getUTCMonth()]}`;
  }
  if (r.endType === 'date' && r.endDate) text += `, hasta ${r.endDate.split('-').reverse().join('/')}`;
  if (r.endType === 'count') text += `, ${r.count} veces`;
  return text;
}

// Convierte "5", "15, último", "1 y 15" en [5], [15, -1], [1, 15].
export function parseMonthDays(s) {
  return [...new Set(String(s || '').toLowerCase().replace(/\by\b/g, ' ').split(/[\s,;]+/).filter(Boolean)
    .map(t => (/^[uú]lt/.test(t) || t === 'u' ? -1 : parseInt(t, 10)))
    .filter(d => d === -1 || (d >= 1 && d <= 31)))];
}

export const formatMonthDays = days => (days || []).map(d => (Number(d) === -1 ? 'último' : d)).join(', ');
