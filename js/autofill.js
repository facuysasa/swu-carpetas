// Filtros y ordenamientos compartidos + planificador del "Ordenar automáticamente"
import { ASPECTS, ASPECT, TYPES, RARITIES, FAMILIES, FAMILY, TYPE, RARITY, norm, capacityOf, slotPos } from './util.js';
import { activeVersion } from './store.js';
import { setLabel } from './catalog.js';
import { deriveChars } from './chars.js';

export const SORTS = [
  { id: 'price', es: 'Precio' },
  { id: 'aspect', es: 'Color (aspecto)' },
  { id: 'set', es: 'Expansión y número' },
  { id: 'name', es: 'Nombre' },
  { id: 'type', es: 'Tipo' },
  { id: 'cost', es: 'Coste' },
  { id: 'rarity', es: 'Rareza' },
  { id: 'family', es: 'Variante' },
  { id: 'copies', es: 'Copias' },
];
export const GROUPS = [
  { id: '', es: 'Sin separar' },
  { id: 'aspect', es: 'Color' },
  { id: 'set', es: 'Expansión' },
  { id: 'type', es: 'Tipo' },
  { id: 'rarity', es: 'Rareza' },
  { id: 'family', es: 'Variante' },
  { id: 'char', es: 'Personaje' },
];

const COLOR_ORDER = ['Vigilance', 'Command', 'Aggression', 'Cunning'];
const MORAL_ORDER = ['Heroism', 'Villainy'];
const TYPE_ORDER = TYPES.map(t => t.id);
const RARITY_ORDER = RARITIES.map(r => r.id);
const FAMILY_ORDER = FAMILIES.map(f => f.id);

function aspectRank(a) {
  const c = a.find(x => COLOR_ORDER.includes(x));
  const m = a.find(x => MORAL_ORDER.includes(x));
  const ci = c ? COLOR_ORDER.indexOf(c) : 4;
  const mi = m ? MORAL_ORDER.indexOf(m) : 2;
  return ci * 10 + mi;
}

export function aspectGroupLabel(a) {
  const c = a.find(x => COLOR_ORDER.includes(x));
  const m = a.find(x => MORAL_ORDER.includes(x));
  if (!c && !m) return 'Sin aspecto';
  return [c, m].filter(Boolean).map(x => ASPECT[x].es).join(' + ');
}

function numPart(n) {
  const v = parseInt(String(n).replace(/\D/g, ''), 10);
  return isFinite(v) ? v : 99999;
}

export function sortValue(info, id) {
  switch (id) {
    case 'price': return info.price ?? -1;
    case 'aspect': return aspectRank(info.aspects);
    case 'set': return info.setIdx * 100000 + numPart(info.num);
    case 'name': return norm(info.displayName + ' ' + info.displaySub);
    case 'type': { const i = TYPE_ORDER.indexOf(info.type); return i < 0 ? 99 : i; }
    case 'cost': return info.cost ?? 99;
    case 'rarity': { const i = RARITY_ORDER.indexOf(info.rarity); return i < 0 ? 99 : i; }
    case 'family': return FAMILY_ORDER.indexOf(info.family) * 2 + (info.foil ? 0 : 1);
    case 'copies': return info.count;
    default: return 0;
  }
}

// Dirección "natural" de cada criterio (precio: de mayor a menor)
export const DEFAULT_DIR = { price: 'desc', copies: 'desc' };

export function comparator(specs) {
  const list = specs.filter(s => s && s.id);
  return (a, b) => {
    for (const s of list) {
      const va = sortValue(a, s.id);
      const vb = sortValue(b, s.id);
      if (va === vb) continue;
      const r = typeof va === 'string' ? va.localeCompare(vb, 'es') : va - vb;
      return s.dir === 'desc' ? -r : r;
    }
    return sortValue(a, 'set') - sortValue(b, 'set');
  };
}

export function groupKey(info, id) {
  switch (id) {
    case 'aspect': return aspectGroupLabel(info.aspects);
    case 'set': return setLabel(info.set);
    case 'type': return info.typeEs || 'Sin tipo';
    case 'rarity': return (RARITY[info.rarity] && RARITY[info.rarity].es) || info.rarity || 'Sin rareza';
    case 'family': return FAMILY[info.family].es;
    default: return '';
  }
}

export function groupRank(info, id) {
  switch (id) {
    case 'aspect': return aspectRank(info.aspects);
    case 'set': return info.setIdx;
    case 'type': return sortValue(info, 'type');
    case 'rarity': return sortValue(info, 'rarity');
    case 'family': return FAMILY_ORDER.indexOf(info.family);
    default: return 0;
  }
}

export const emptyFilter = () => ({ q: '', aspects: [], types: [], sets: [], rarities: [], families: [], chars: [], foil: 'any', minPrice: '', status: 'all' });

export function filterActive(f) {
  return !!(f.q || f.aspects.length || f.types.length || f.sets.length || f.rarities.length || f.families.length || (f.chars && f.chars.length) || f.foil !== 'any' || f.minPrice || f.status !== 'all');
}

// Personajes de cada carta, para buscar y filtrar
export function tagFn(state, d) {
  const cd = deriveChars(state, d);
  return key => {
    const r = cd.byKey.get(key);
    return r ? { ids: r.eff, names: r.eff.map(cd.nameOf) } : { ids: [], names: [] };
  };
}

// where: mapa clave → { binders, table, boxes } (de derive)
export function matches(info, f, free, tagsOf, where) {
  const tg = tagsOf ? tagsOf(info.key) : null;
  if (f.q) {
    const parts = norm(f.q).split(' ');
    const hay = info.search + (tg && tg.names.length ? ' ' + norm(tg.names.join(' ')) : '');
    if (!parts.every(p => hay.includes(p))) return false;
  }
  if (f.chars && f.chars.length && !(tg && f.chars.some(id => tg.ids.includes(id)))) return false;
  if (f.aspects.length) {
    const a = info.aspects.length ? info.aspects : ['none'];
    if (!f.aspects.some(x => a.includes(x))) return false;
  }
  if (f.types.length && !f.types.includes(info.type || 'none')) return false;
  if (f.sets.length && !f.sets.includes(info.set)) return false;
  if (f.rarities.length && !f.rarities.includes(info.rarity)) return false;
  if (f.families.length && !f.families.includes(info.family)) return false;
  if (f.foil === 'foil' && !info.foil) return false;
  if (f.foil === 'nonfoil' && info.foil) return false;
  if (f.minPrice !== '' && f.minPrice != null && (info.price ?? 0) < Number(f.minPrice)) return false;
  if (f.status && f.status !== 'all') {
    const w = (where && where.get(info.key)) || { binders: new Set(), table: false, boxes: new Set() };
    if (f.status === 'free' && !(free > 0)) return false;
    if (f.status === 'placed' && !w.binders.size) return false;
    if (f.status === 'table' && !w.table) return false;
    if (f.status === 'boxes' && !w.boxes.size) return false;
    if (f.status === 'conflict' && !(free < 0)) return false;
    if (f.status.startsWith('b:') && !w.binders.has(f.status.slice(2))) return false;
    if (f.status.startsWith('x:') && !w.boxes.has(f.status.slice(2))) return false;
  }
  return true;
}

// ---------- Planificador ----------
// opts: { binderId, target: 'new'|'current', newName, faceFrom, faceTo, filter, includeElsewhere,
//         copies: 'each'|'stack'|'single', sort: [{id,dir}], groupBy, groupNewPage, occupied: 'clear'|'keep' }
export function planFill(state, d, opts) {
  const b = state.binders.find(x => x.id === opts.binderId);
  const per = b.rows * b.cols;
  const cap = capacityOf(b);
  const base = { ...activeVersion(b).slots };
  const from = (opts.faceFrom - 1) * per;
  const to = Math.min(cap, opts.faceTo * per);
  const inRange = i => i >= from && i < to;

  if (opts.occupied === 'clear') for (const k of Object.keys(base)) if (inRange(+k)) delete base[k];

  // Copias que quedan en esta carpeta (fuera del rango o respetadas)
  const keepHere = new Map();
  for (const v of Object.values(base)) keepHere.set(v.k, (keepHere.get(v.k) || 0) + v.q);

  // Copias en otras carpetas (versiones activas)
  const elsewhere = new Map();
  const elsewhereLocs = new Map();
  for (const o of state.binders) {
    if (o.id === b.id) continue;
    for (const [k, v] of Object.entries(activeVersion(o).slots)) {
      elsewhere.set(v.k, (elsewhere.get(v.k) || 0) + v.q);
      if (!elsewhereLocs.has(v.k)) elsewhereLocs.set(v.k, []);
      elsewhereLocs.get(v.k).push({ b: o.id, idx: +k, q: v.q, face: slotPos(o, +k).face });
    }
  }

  const tagsOf = tagFn(state, d);
  for (const c of Object.values((state.table && state.table.cards) || {})) {
    elsewhere.set(c.k, (elsewhere.get(c.k) || 0) + c.q);
    if (!elsewhereLocs.has(c.k)) elsewhereLocs.set(c.k, []);
    elsewhereLocs.get(c.k).unshift({ b: 'mesa', id: c.id, q: c.q, face: 0 });
  }
  for (const bx of state.boxes || []) {
    for (const [k, q] of Object.entries(bx.cards || {})) {
      elsewhere.set(k, (elsewhere.get(k) || 0) + q);
      if (!elsewhereLocs.has(k)) elsewhereLocs.set(k, []);
      elsewhereLocs.get(k).push({ b: 'caja', box: bx.id, q, face: 0 });
    }
  }
  const units = [];
  for (const info of d.list) {
    const total = info.count;
    const other = opts.includeElsewhere ? 0 : (elsewhere.get(info.key) || 0);
    const avail = total - other - (keepHere.get(info.key) || 0);
    if (avail <= 0) continue;
    if (!matches(info, opts.filter, avail, tagsOf, d.where)) continue;
    if (opts.copies === 'each') for (let i = 0; i < avail; i++) units.push({ info, q: 1 });
    else if (opts.copies === 'stack') units.push({ info, q: avail });
    else units.push({ info, q: 1 });
  }
  const charOf = info => { const n = tagsOf(info.key).names.slice().sort((a, b) => a.localeCompare(b, 'es')); return n[0] || '~'; };
  const charCmp = (a, b) => { const x = charOf(a); const y = charOf(b); if (x === y) return 0; if (x === '~') return 1; if (y === '~') return -1; return x.localeCompare(y, 'es'); };
  const sortSpecs = opts.sort.filter(s => s && s.id && s.id !== 'char');
  const baseCmp = comparator(sortSpecs);
  const charDir = (opts.sort.find(s => s && s.id === 'char') || {}).dir;
  const cmp = charDir ? (a, b) => (charDir === 'desc' ? -1 : 1) * charCmp(a, b) || baseCmp(a, b) : baseCmp;
  const gr = info => (opts.groupBy === 'char' ? 0 : groupRank(info, opts.groupBy));
  units.sort((x, y) => (opts.groupBy === 'char' ? charCmp(x.info, y.info) : opts.groupBy ? gr(x.info) - gr(y.info) : 0) || cmp(x.info, y.info));

  const targets = [];
  for (let i = from; i < to; i++) if (!base[i]) targets.push(i);
  const slots = { ...base };
  const placedUnits = [];
  const leftovers = [];
  let t = 0;
  let lastGroup = null;
  const groups = [];
  for (const u of units) {
    const g = opts.groupBy === 'char' ? (charOf(u.info) === '~' ? 'Sin personaje' : charOf(u.info)) : opts.groupBy ? groupKey(u.info, opts.groupBy) : '';
    if (opts.groupBy && g !== lastGroup) {
      if (lastGroup !== null && opts.groupNewPage && t < targets.length) {
        const curFace = Math.floor(targets[t] / per);
        const prevFace = t > 0 ? Math.floor(targets[t - 1] / per) : -1;
        if (curFace === prevFace) {
          while (t < targets.length && Math.floor(targets[t] / per) === curFace) t++;
        }
      }
      if (t < targets.length) groups.push({ label: g, face: Math.floor(targets[t] / per) + 1 });
      lastGroup = g;
    }
    if (t >= targets.length) { leftovers.push(u); continue; }
    slots[targets[t]] = { k: u.info.key, q: u.q };
    placedUnits.push(u);
    t++;
  }

  // Si se permite traer cartas de otras carpetas, calcular de dónde salen
  const removals = [];
  if (opts.includeElsewhere) {
    const need = new Map();
    for (const u of placedUnits) need.set(u.info.key, (need.get(u.info.key) || 0) + u.q);
    for (const [key, q] of need) {
      const free = (state.stock[key] ? state.stock[key].count : 0) - (keepHere.get(key) || 0) - (elsewhere.get(key) || 0);
      let take = q - Math.max(0, free);
      for (const l of elsewhereLocs.get(key) || []) {
        if (take <= 0) break;
        const n = Math.min(take, l.q);
        removals.push({ b: l.b, idx: l.idx, id: l.id, box: l.box, q: n, face: l.face, key });
        take -= n;
      }
    }
  }
  const cards = placedUnits.reduce((s, u) => s + u.q, 0);
  const lastIdx = Object.keys(slots).filter(k => inRange(+k)).reduce((m, k) => Math.max(m, +k), -1);
  return {
    binderId: b.id,
    newVersionName: opts.target === 'new' ? (opts.newName || 'Ordenada') : null,
    slots,
    removals,
    pockets: placedUnits.length,
    cards,
    candidates: units.length,
    leftovers,
    freeTargets: targets.length - placedUnits.length,
    lastFace: lastIdx >= 0 ? Math.floor(lastIdx / per) + 1 : 0,
    groups,
  };
}

export { ASPECTS, TYPES, RARITIES, FAMILIES, TYPE };
