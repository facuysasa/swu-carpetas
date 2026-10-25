// Lectura de los archivos de colección (TXT y CSV exportados de SWUDB)
import { normNum, parsePrice, vtagOf, printingKey } from './util.js';
import { lookup, findByName } from './catalog.js';

const COLS = {
  count: ['count', 'quantity', 'qty', 'cantidad', 'copies', 'amount'],
  name: ['name', 'nombre', 'card name', 'cardname'],
  sub: ['subtitle', 'subtitulo', 'subtítulo', 'title'],
  set: ['set', 'setcode', 'set code', 'expansion', 'edition'],
  num: ['number', 'cardnumber', 'card number', 'collector number', 'numero', 'número', 'nro'],
  variant: ['variant', 'variante', 'variant type', 'varianttype'],
  rarity: ['rarity', 'rareza'],
  foil: ['is_foil', 'isfoil', 'foil', 'is foil'],
  price: ['price_each', 'price each', 'price', 'unit price', 'precio'],
};

function splitRows(text, delim) {
  const rows = [];
  let row = [];
  let f = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { f += '"'; i++; } else q = false;
      } else f += ch;
      continue;
    }
    if (ch === '"' && f === '') { q = true; continue; }
    if (ch === delim) { row.push(f); f = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(f); rows.push(row); row = []; f = ''; continue; }
    f += ch;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}

function findHeader(lines) {
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const l = lines[i].replace(/^\uFEFF/, '').replace(/^#\s*/, '').trim().toLowerCase();
    if (/(^|[,;\t])\s*(set|setcode)\s*([,;\t]|$)/.test(l) && /(number|cardnumber)/.test(l)) return i;
  }
  return -1;
}

export function parseCollection(fileName, rawText) {
  const text = rawText.replace(/^\uFEFF/, '');
  const lines = text.split(/\n/);
  const hi = findHeader(lines);
  if (hi < 0) return { name: fileName, format: 'desconocido', rows: [], errors: ['No encontré la fila de encabezados (Set, CardNumber/number…).'] };
  const headerLine = lines[hi].replace(/^#\s*/, '');
  const delim = [',', ';', '\t'].sort((a, b) => headerLine.split(b).length - headerLine.split(a).length)[0];
  const header = splitRows(headerLine, delim)[0].map(h => h.trim().toLowerCase());
  const col = {};
  for (const [k, names] of Object.entries(COLS)) col[k] = header.findIndex(h => names.includes(h));
  const format = col.name >= 0 ? 'txt' : 'csv';
  const body = lines.slice(hi + 1).filter(l => l.trim() && !l.trim().startsWith('#')).join('\n');
  const rows = splitRows(body, delim);
  const out = new Map();
  const errors = [];
  for (let r of rows) {
    if (!r.some(x => x.trim())) continue;
    if (r.length > header.length && col.name >= 0) {
      // Comas sin comillas dentro del nombre o subtítulo
      const extra = r.length - header.length;
      const at = col.sub >= 0 ? col.sub : col.name;
      r = [...r.slice(0, at), r.slice(at, at + extra + 1).join(','), ...r.slice(at + extra + 1)];
    }
    const get = k => (col[k] >= 0 ? (r[col[k]] || '').trim() : '');
    const set = get('set').toUpperCase();
    const num = normNum(get('num'));
    if (!set || !num) { errors.push(`Fila ignorada: ${r.join(delim).slice(0, 60)}`); continue; }
    const count = parseInt(get('count') || '1', 10) || 0;
    if (count <= 0) continue;
    const foil = /^(true|1|yes|si|sí|foil|y)$/i.test(get('foil'));
    const variant = get('variant') || null;
    const vtag = vtagOf(variant);
    const key = printingKey(set, num, foil, vtag);
    const prev = out.get(key);
    if (prev) { prev.count += count; continue; }
    out.set(key, {
      key, set, num, foil, vtag, count,
      name: get('name') || null,
      sub: get('sub') || null,
      variant: format === 'txt' ? variant : (variant ? `${variant}` : null),
      rarity: get('rarity') || null,
      price: parsePrice(get('price')),
    });
  }
  return { name: fileName, format, rows: [...out.values()], errors };
}

// Calcula cómo queda la colección según el modo elegido
export function planImport(state, d, files, mode) {
  const names = new Set(files.map(f => f.name));
  const stock = mode === 'replace' ? {} : { ...state.stock };
  const touched = new Set();
  let added = 0;
  let changed = 0;
  let same = 0;
  let copies = 0;
  let unmatched = 0;
  for (const f of files) {
    for (const r of f.rows) {
      copies += r.count;
      const prev = state.stock[r.key];
      const already = touched.has(r.key);
      const base = mode === 'add' || already ? ((stock[r.key] && stock[r.key].count) || 0) : 0;
      const count = base + r.count;
      if (!prev) added += already ? 0 : 1;
      else if (!already && prev.count !== count) changed++;
      else if (!already) same++;
      touched.add(r.key);
      stock[r.key] = {
        ...(prev || {}),
        key: r.key, set: r.set, num: r.num, foil: r.foil, vtag: r.vtag,
        name: r.name || (prev && prev.name) || null,
        sub: r.sub || (prev && prev.sub) || null,
        variant: r.variant || (prev && prev.variant) || null,
        rarity: r.rarity || (prev && prev.rarity) || null,
        price: r.price != null ? r.price : (prev ? prev.price ?? null : null),
        count,
        src: f.name,
        addedAt: (prev && prev.addedAt) || Date.now(),
      };
      if (!lookup(r.set, r.num) && !(r.name && findByName(r.name, r.sub, r.set))) unmatched++;
    }
  }
  const removed = [];
  if (mode === 'update') {
    for (const e of Object.values(state.stock)) {
      if (names.has(e.src) && !touched.has(e.key)) { removed.push(e); delete stock[e.key]; }
    }
  }
  if (mode === 'replace') for (const e of Object.values(state.stock)) if (!touched.has(e.key)) removed.push(e);
  const overAssigned = [];
  for (const [k, q] of d.assigned) {
    const c = (stock[k] && stock[k].count) || 0;
    if (q > c) overAssigned.push({ key: k, extra: q - c });
  }
  return { stock, added, changed, same, removed, copies, unmatched, overAssigned, printings: touched.size };
}
