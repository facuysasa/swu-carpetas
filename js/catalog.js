// Catálogo de cartas (lo arma la GitHub Action en data/catalog.json)
import {
  norm, normNum, normType, normRarity, variantFamily, ASPECT, TYPE,
} from './util.js';

// Códigos de SWUDB que en swu-db cambiaron de nombre
const ALIASES = {
  JTLP: 'JTLOP', LOFP: 'LOFOP', LAWP: 'LAWOP', SECP: 'SECOP', SHDP: 'SHDOP',
  SORP: 'SOROP', TWIP: 'TWIOP', ASHP: 'ASHOP', HMWP: 'HMWOP',
};
const KNOWN_ORDER = ['SOR', 'SHD', 'TWI', 'JTL', 'LOF', 'IBH', 'SEC', 'LAW', 'ASH', 'HMW'];

export const catalog = {
  status: 'idle', // idle | loading | ready | missing
  error: null,
  builtAt: null,
  count: 0,
  sources: {},
  byKey: new Map(),
  byName: new Map(),
  all: [],
  sets: [],
  setIdx: new Map(),
  version: 0,
};

export async function loadCatalog() {
  if (typeof window !== 'undefined' && window.SWU_STANDALONE) {
    const emb = window.SWU_EMBEDDED_CATALOG;
    if (emb && emb.cards && emb.cards.length) {
      indexCatalog(emb);
      catalog.status = 'ready';
      catalog.embedded = true;
    } else {
      catalog.status = 'missing';
      catalog.error = 'versión de prueba sin catálogo semanal';
    }
    catalog.version++;
    return;
  }
  catalog.status = 'loading';
  try {
    const res = await fetch('data/catalog.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    indexCatalog(await res.json());
    catalog.status = catalog.count ? 'ready' : 'missing';
    if (!catalog.count) catalog.error = 'El catálogo está vacío';
  } catch (e) {
    catalog.status = 'missing';
    catalog.error = String(e && e.message || e);
  }
  catalog.version++;
}

const LIVE_KEY = 'swu-carpetas:catalogo-vivo:v1';
const liveTried = new Set();
let liveCacheLoaded = false;

function addCards(cards) {
  for (const c of cards) {
    c.s = String(c.s || '').toUpperCase();
    c.n = normNum(c.n);
    const k = c.s + '-' + c.n;
    if (catalog.byKey.has(k)) continue;
    catalog.byKey.set(k, c);
    catalog.all.push(c);
    for (const nm of [c.nm, c.ne]) {
      if (!nm) continue;
      const nk = norm(nm);
      if (!catalog.byName.has(nk)) catalog.byName.set(nk, []);
      catalog.byName.get(nk).push(c);
    }
  }
  catalog.count = catalog.all.length;
}

const toNum = x => { const v = parseFloat(String(x ?? '').replace(/[^0-9.\-]/g, '')); return Number.isFinite(v) ? v : null; };
function compactSwu(c) {
  return {
    s: String(c.Set || '').toUpperCase(), n: normNum(c.Number), nm: c.Name, st: c.Subtitle || '', t: c.Type,
    a: c.Aspects || [], tr: c.Traits || [], ar: c.Arenas || [], c: toNum(c.Cost), p: toNum(c.Power), h: toNum(c.HP),
    r: c.Rarity, u: c.Unique ? 1 : 0, ds: c.DoubleSided ? 1 : 0, art: c.Artist || '', vt: c.VariantType || '',
    mp: toNum(c.MarketPrice), fp: toNum(c.FoilPrice), i: c.FrontArt || '', ib: c.BackArt || '',
  };
}

// Sin catálogo semanal (por ejemplo, abriendo el HTML suelto): pide a swu-db los sets de tu colección
export async function loadLive(setCodes) {
  if (catalog.status === 'ready' || catalog.liveBlocked) return false;
  let changed = false;
  if (!liveCacheLoaded) {
    liveCacheLoaded = true;
    try {
      const c = JSON.parse(localStorage.getItem(LIVE_KEY) || 'null');
      if (c && c.cards && c.cards.length) {
        addCards(c.cards);
        (c.sets || []).forEach(s => liveTried.add(s));
        changed = true;
      }
    } catch { /* sin caché */ }
  }
  const todo = [...new Set(setCodes.map(swuSetCode))].filter(s => s && !liveTried.has(s));
  const fetched = [];
  for (const code of todo) {
    liveTried.add(code);
    try {
      const res = await fetch(`https://api.swu-db.com/cards/search?q=${encodeURIComponent('set:' + code.toLowerCase())}&variants=true`);
      if (!res.ok) continue;
      const j = await res.json();
      const cards = (Array.isArray(j) ? j : (j.data || [])).map(compactSwu).filter(x => x.s && x.n);
      addCards(cards);
      fetched.push(...cards);
    } catch {
      catalog.liveBlocked = true;
      break; // el navegador no deja consultar swu-db desde acá: no insistir
    }
  }
  if (fetched.length) {
    changed = true;
    try {
      const prev = JSON.parse(localStorage.getItem(LIVE_KEY) || 'null') || { cards: [], sets: [] };
      localStorage.setItem(LIVE_KEY, JSON.stringify({ cards: [...prev.cards, ...fetched], sets: [...new Set([...prev.sets, ...liveTried])] }));
    } catch { /* sin espacio: se vuelve a pedir la próxima vez */ }
  }
  if (changed) { catalog.status = 'live'; catalog.version++; }
  return changed;
}

function indexCatalog(j) {
  const byKey = new Map();
  const byName = new Map();
  const all = [];
  for (const c of j.cards || []) {
    c.s = String(c.s || '').toUpperCase();
    c.n = normNum(c.n);
    const k = c.s + '-' + c.n;
    if (byKey.has(k)) continue;
    byKey.set(k, c);
    all.push(c);
    for (const nm of [c.nm, c.ne]) {
      if (!nm) continue;
      const nk = norm(nm);
      if (!byName.has(nk)) byName.set(nk, []);
      byName.get(nk).push(c);
    }
  }
  catalog.byKey = byKey;
  catalog.byName = byName;
  catalog.all = all;
  catalog.count = all.length;
  catalog.builtAt = j.builtAt || null;
  catalog.sources = j.sources || {};
  catalog.sets = (j.sets || []).slice().sort((a, b) => String(a.d || '').localeCompare(String(b.d || '')));
  catalog.setIdx = new Map(catalog.sets.map((s, i) => [String(s.c).toUpperCase(), i]));
}

export function swuSetCode(set) {
  const S = String(set || '').toUpperCase();
  return ALIASES[S] || S;
}

export function lookup(set, num) {
  const S = String(set || '').toUpperCase();
  const n = normNum(num);
  return catalog.byKey.get(S + '-' + n)
    || (ALIASES[S] && catalog.byKey.get(ALIASES[S] + '-' + n))
    || (/[^O]P$/.test(S) && catalog.byKey.get(S.slice(0, -1) + 'OP-' + n))
    || null;
}

function baseSet(set) {
  return String(set || '').toUpperCase().replace(/OPJ?$|P$/, '');
}

export function findByName(name, sub, set) {
  const list = catalog.byName.get(norm(name));
  if (!list || !list.length) return null;
  const ns = norm(sub);
  let c = ns ? list.filter(x => norm(x.st) === ns || norm(x.se) === ns) : list;
  if (!c.length) c = list;
  const b = baseSet(set);
  const std = x => variantFamily(x.vt, x.s) === 'standard';
  return c.find(x => x.s === b && std(x)) || c.find(x => x.s === b) || c.find(std) || c[0];
}

export function setOrder(code) {
  const S = String(code || '').toUpperCase();
  const i = catalog.setIdx.get(S) ?? catalog.setIdx.get(swuSetCode(S));
  if (i != null) return i;
  const b = baseSet(S);
  const k = KNOWN_ORDER.indexOf(b);
  return k >= 0 ? 100 + k + (S !== b ? 0.5 : 0) : 999;
}

export function setLabel(code) {
  const S = String(code || '').toUpperCase();
  const s = catalog.sets.find(x => String(x.c).toUpperCase() === S);
  return s && s.n ? `${s.n} (${S})` : S;
}

function pad3(n) {
  const s = normNum(n);
  return /^\d+$/.test(s) ? s.padStart(3, '0') : s;
}
// Imagen en SWUDB: usa el mismo código y número que tus archivos exportados
function swudbImage(set, num, back) {
  return `https://swudb.com/images/cards/${String(set || '').toUpperCase()}/${pad3(num)}${back ? '-portrait' : ''}.png`;
}
export function publicImageUrl(info) {
  const c = lookup(info.set, info.num);
  return (c && c.i) || swudbImage(info.set, info.num, false);
}

function swuImage(set, num, back) {
  return `https://api.swu-db.com/cards/${swuSetCode(set).toLowerCase()}/${normNum(num)}?format=image${back ? '&face=back' : ''}`;
}

function uniq(a) {
  return [...new Set(a.filter(Boolean))];
}

// Une los datos del archivo importado con los del catálogo
export function resolve(e, lang = 'es') {
  const exact = lookup(e.set, e.num);
  const near = exact ? null : (e.name ? findByName(e.name, e.sub, e.set) : null);
  const c = exact || near;
  const type = normType(c && c.t);
  const aspects = (c && c.a) || [];
  const name = (c && c.nm) || e.name || `${e.set} ${e.num}`;
  const sub = (c && c.st) || e.sub || '';
  const nameEs = (c && c.ne) || null;
  const subEs = (c && c.se) || null;
  const es = lang === 'es';
  const catPrice = c ? (e.foil ? (c.fp ?? c.mp) : (c.mp ?? null)) : null;
  const price = (catPrice != null && catPrice > 0) ? catPrice : (e.price ?? catPrice ?? null);
  const variantLabel = e.variant || (c && c.vt) || (e.foil ? 'Foil' : 'Normal');
  const fam = variantFamily(e.variant || (c && c.vt) || '', e.set);
  const swu = swuImage(e.set, e.num, false);
  const swuB = swuImage(e.set, e.num, true);
  const sdb = swudbImage(e.set, e.num, false);
  const sdbB = swudbImage(e.set, e.num, true);
  const nearSdb = near ? swudbImage(near.s, near.n, false) : null;
  const front = es
    ? uniq([exact && exact.ie, sdb, exact && exact.i, swu, near && near.ie, near && near.i, nearSdb])
    : uniq([sdb, exact && exact.i, swu, exact && exact.ie, near && near.i, nearSdb]);
  const dbl = !!(c && c.ds);
  const back = dbl ? (es ? uniq([exact && exact.ieb, sdbB, exact && exact.ib, swuB]) : uniq([sdbB, exact && exact.ib, swuB, exact && exact.ieb])) : [];
  const displayName = es && nameEs ? nameEs : name;
  const displaySub = es && nameEs ? (subEs || '') : sub;
  const traits = (c && c.tr) || [];
  return {
    key: e.key, set: e.set, num: e.num, foil: !!e.foil, count: e.count || 0, entry: e,
    name, sub, nameEs, subEs, displayName, displaySub,
    type, typeEs: type ? (TYPE[type] ? TYPE[type].es : type) : null,
    aspects, traits, arenas: (c && c.ar) || [], keywords: (c && c.kw) || [],
    cost: c ? c.c ?? null : null, power: c ? c.p ?? null : null, hp: c ? c.h ?? null : null,
    rarity: normRarity(e.rarity || (c && c.r)),
    unique: !!(c && c.u), doubleSided: dbl,
    family: fam, variantLabel,
    price, priceFrom: (catPrice != null && catPrice > 0) ? 'catalog' : (e.price != null ? 'file' : null),
    artist: (c && c.art) || '',
    landscape: type ? (type === 'Leader' || type === 'Base') : null,
    setIdx: setOrder(e.set),
    front, back,
    match: exact ? 'exact' : near ? 'name' : 'none',
    search: norm([name, sub, nameEs, subEs, e.set, e.num, traits.join(' '), c && c.art].filter(Boolean).join(' ')),
    mainColor: mainColor(aspects),
  };
}

// Para cartas del catálogo que todavía no están en la colección
export function resolveCatalogCard(c, lang = 'es', foil = false) {
  return resolve({ key: 'cat:' + c.s + '-' + c.n, set: c.s, num: c.n, foil, count: 0 }, lang);
}

export function mainColor(aspects) {
  const colorAspect = (aspects || []).find(a => ['Vigilance', 'Command', 'Aggression', 'Cunning'].includes(a));
  const a = colorAspect || (aspects || [])[0];
  return a && ASPECT[a] ? ASPECT[a].color : null;
}

export function searchCatalog(q, limit = 60) {
  const nq = norm(q);
  if (nq.length < 2) return [];
  const out = [];
  for (const c of catalog.all) {
    const hay = norm(`${c.nm} ${c.st || ''} ${c.ne || ''} ${c.se || ''} ${c.s} ${c.n}`);
    if (hay.includes(nq)) {
      out.push(c);
      if (out.length >= limit) break;
    }
  }
  return out;
}
