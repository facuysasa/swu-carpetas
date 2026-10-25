#!/usr/bin/env node
// Arma data/catalog.json con todas las cartas: datos y precios de swu-db,
// imágenes y nombres en español de la base oficial. Si una fuente falla,
// conserva lo que había en el catálogo publicado anteriormente.
import { writeFile, readFile, mkdir } from 'node:fs/promises';

const OUT = process.env.OUT || 'data/catalog.json';
const SWUDB = process.env.SWUDB_API || 'https://api.swu-db.com';
const OFFICIAL = process.env.OFFICIAL_API || 'https://admin.starwarsunlimited.com/api/card-list';
const PREV = process.env.PREV_CATALOG_URL || '';
const PAUSE = Number(process.env.PAUSE_MS ?? 250);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(...a);

async function getJson(url, headers = {}, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'carpetas-swu/1.0 (catalogo personal)', ...headers },
        signal: AbortSignal.timeout(30000),
      });
      if (res.status === 404) { const e = new Error('HTTP 404'); e.code = 404; throw e; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      last = e;
      if (e.code === 404) break;
      await sleep(1500 * (i + 1));
    }
  }
  throw last;
}

const normNum = n => {
  const s = String(n ?? '').trim().toUpperCase();
  return /^\d+$/.test(s) ? String(parseInt(s, 10)) : s;
};
const num = x => {
  if (x == null || x === '') return null;
  const v = parseFloat(String(x).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(v) ? v : null;
};
const money = x => { const v = num(x); return v == null ? null : Math.round(v * 100) / 100; };
const parseDate = s => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(String(s || '').trim());
  if (!m) return String(s || '');
  const y = m[3].length === 2 ? '20' + m[3] : m[3];
  return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
};
const arr = x => (Array.isArray(x) ? x : x ? [x] : []);

function clean(o) {
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) delete o[k];
  }
  return o;
}

// ---------- Catálogo anterior ----------
async function loadPrevious() {
  try {
    const j = JSON.parse(await readFile(OUT, 'utf8'));
    if (j && j.cards && j.cards.length) { log(`Catálogo local previo: ${j.cards.length} cartas`); return j; }
  } catch { /* no hay */ }
  if (PREV) {
    try {
      const j = await getJson(PREV, {}, 2);
      if (j && j.cards && j.cards.length) { log(`Catálogo publicado previo: ${j.cards.length} cartas`); return j; }
    } catch (e) { log(`Sin catálogo previo publicado (${e.message})`); }
  }
  return null;
}

// ---------- swu-db ----------
function fromSwu(c) {
  return clean({
    s: String(c.Set || '').toUpperCase(),
    n: normNum(c.Number),
    nm: c.Name,
    st: c.Subtitle || '',
    t: c.Type,
    a: arr(c.Aspects),
    tr: arr(c.Traits),
    ar: arr(c.Arenas),
    kw: arr(c.Keywords),
    c: num(c.Cost),
    p: num(c.Power),
    h: num(c.HP),
    r: c.Rarity,
    u: c.Unique ? 1 : 0,
    ds: c.DoubleSided ? 1 : 0,
    art: c.Artist,
    vt: c.VariantType,
    mp: money(c.MarketPrice),
    fp: money(c.FoilPrice),
    i: c.FrontArt,
    ib: c.BackArt,
  });
}

async function loadSwuDb(map, setsOut, report) {
  let sets;
  try {
    const j = await getJson(`${SWUDB}/sets`);
    sets = Array.isArray(j) ? j : (j.data || []);
  } catch (e) {
    report.error = `No pude leer /sets: ${e.message}`;
    log(report.error);
    return;
  }
  for (const s of sets) {
    const code = String(s.setId || s.SetId || s.code || '').toUpperCase();
    if (!code) continue;
    setsOut.set(code, clean({ c: code, n: s.fullName || s.FullName || s.name, d: parseDate(s.releaseDate || s.ReleaseDate) }));
    let cards = null;
    const urls = [
      `${SWUDB}/cards/search?q=${encodeURIComponent('set:' + code.toLowerCase())}&variants=true`,
      `${SWUDB}/cards/${code.toLowerCase()}`,
    ];
    for (const url of urls) {
      try {
        const j = await getJson(url);
        const list = Array.isArray(j) ? j : (j.data || j.cards || []);
        if (list.length && (!cards || list.length > cards.length)) cards = list;
      } catch (e) { log(`  ${code}: ${url.includes('search') ? 'búsqueda' : 'listado'} falló (${e.message})`); }
      await sleep(PAUSE);
    }
    if (!cards) { report.failedSets.push(code); continue; }
    let added = 0;
    for (const raw of cards) {
      const c = fromSwu(raw);
      if (!c.s || !c.n) continue;
      const k = `${c.s}-${c.n}`;
      const prev = map.get(k) || {};
      map.set(k, { ...prev, ...c });
      added++;
    }
    report.sets++;
    report.cards += added;
    log(`  ${code}: ${added} cartas`);
  }
}

// ---------- Respaldo en GitHub (datos de swu-db mantenidos por la comunidad, licencia MIT) ----------
const GH_BASE = process.env.GH_BASE || 'https://raw.githubusercontent.com/nmpeterson/swu-card-db/main/data';
async function loadGithubBase(map, setsOut, report) {
  try {
    const cards = await getJson(`${GH_BASE}/all_cards.json`);
    let fixes = {};
    try { fixes = await getJson(`${GH_BASE}/corrections.json`); } catch { /* opcional */ }
    try {
      const sets = await getJson(`${GH_BASE}/sets.json`);
      for (const s of sets || []) if (s.id && !setsOut.has(String(s.id).toUpperCase())) setsOut.set(String(s.id).toUpperCase(), clean({ c: String(s.id).toUpperCase(), n: s.name, d: '' }));
    } catch { /* opcional */ }
    let n = 0;
    for (const raw of cards || []) {
      const fix = fixes[`${raw.Set}-${raw.Number}`] || {};
      const c = fromSwu({ ...raw, ...fix });
      if (!c.s || !c.n) continue;
      const k = `${c.s}-${c.n}`;
      map.set(k, { ...c, ...(map.get(k) || {}) });
      n++;
    }
    report.cards = n;
    log(`  respaldo GitHub: ${n} cartas`);
  } catch (e) {
    report.error = e.message;
    log(`  respaldo GitHub falló: ${e.message}`);
  }
}

// ---------- Base oficial (Strapi) ----------
function rel(x) {
  if (x == null) return null;
  if (typeof x === 'object' && 'data' in x) {
    const d = x.data;
    if (Array.isArray(d)) return d.map(e => (e && e.attributes) ? { id: e.id, ...e.attributes } : e);
    return d ? (d.attributes ? { id: d.id, ...d.attributes } : d) : null;
  }
  return x;
}
function mediaUrl(m) {
  const a = rel(m);
  if (!a) return '';
  const f = a.formats || {};
  const u = (f.card && f.card.url) || a.url || (f.large && f.large.url) || '';
  if (!u) return '';
  return /^https?:/.test(u) ? u : `https://admin.starwarsunlimited.com${u.startsWith('/') ? '' : '/'}${u}`;
}
const names = x => arr(rel(x)).map(e => (e && (e.name || e.title)) || '').filter(Boolean);

async function loadOfficial(map, locale, report, { budgetMs = 9 * 60000 } = {}) {
  const headers = { Origin: 'https://starwarsunlimited.com', Referer: 'https://starwarsunlimited.com/' };
  const es = locale.startsWith('es');
  // Solo las relaciones necesarias: con todo incluido cada página es muy pesada
  const populate = es ? 'expansion,artFront,artBack,variantOf' : 'expansion,artFront,artBack,variantOf,type,aspects,traits,arenas,keywords,rarity,variantTypes';
  const url = page => `${OFFICIAL}?${new URLSearchParams({ locale, 'pagination[page]': String(page), 'pagination[pageSize]': '100', 'sort[0]': 'id:asc', populate })}`;
  const t0 = Date.now();
  let seen = 0;
  let matched = 0;
  let created = 0;
  const handle = data => {
    for (const item of data || []) {
      const a = item.attributes || item;
      const exp = rel(a.expansion);
      const code = String((exp && exp.code) || '').toUpperCase();
      const n = normNum(a.cardNumber);
      if (!code || !n) continue;
      seen++;
      const base = rel(a.variantOf);
      if (base && base.cardNumber != null && normNum(base.cardNumber) === n) continue; // variante sin número propio
      const k = `${code}-${n}`;
      const front = mediaUrl(a.artFront);
      const back = mediaUrl(a.artBack);
      const cur = map.get(k);
      if (es) {
        if (!cur) continue;
        map.set(k, clean({ ...cur, ie: front, ieb: back, ne: a.title, se: a.subtitle }));
        matched++;
      } else if (!cur) {
        map.set(k, clean({
          s: code, n, nm: a.title, st: a.subtitle || '',
          t: names(a.type)[0], a: names(a.aspects), tr: names(a.traits), ar: names(a.arenas), kw: names(a.keywords),
          c: num(a.cost), p: num(a.power), h: num(a.hp), r: names(a.rarity)[0],
          u: a.unique ? 1 : 0, ds: back ? 1 : 0, art: typeof a.artist === 'string' ? a.artist : '',
          vt: names(a.variantTypes)[0] || '', i: front, ib: back,
        }));
        created++;
      } else if (!cur.i && front) {
        map.set(k, { ...cur, i: front, ...(back && !cur.ib ? { ib: back } : {}) });
      }
    }
  };
  const first = await getJson(url(1), headers, 2);
  const pages = (first.meta && first.meta.pagination && first.meta.pagination.pageCount) || 1;
  log(`  oficial ${locale}: ${(first.meta && first.meta.pagination && first.meta.pagination.total) ?? '?'} cartas en ${pages} páginas`);
  handle(first.data);
  const todo = [];
  for (let p = 2; p <= pages; p++) todo.push(p);
  let done = 1;
  let failed = 0;
  let cut = false;
  // De a cuatro páginas a la vez y con tiempo máximo: si se pasa, se guarda lo que se llegó a traer
  const worker = async () => {
    while (todo.length) {
      if (Date.now() - t0 > budgetMs) { cut = true; return; }
      const p = todo.shift();
      try { handle((await getJson(url(p), headers, 2)).data); } catch { failed++; }
      done++;
      if (done % 10 === 0) log(`    ${locale}: ${done} de ${pages} páginas (${Math.round((Date.now() - t0) / 1000)} s)`);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (cut) log(`    ${locale}: se cortó por tiempo en ${done} de ${pages} páginas; lo que falta se completa en la próxima corrida`);
  report[locale] = { seen, matched, created, pages, done, failed, cut };
  return seen;
}

// ---------- Principal ----------
async function main() {
  const t0 = Date.now();
  const prev = await loadPrevious();
  const fresh = prev && prev.builtAt && Date.now() - Date.parse(prev.builtAt) < 6 * 864e5;
  if (process.env.EVENT === 'push' && fresh && !process.env.FORCE) {
    await mkdir(OUT.split('/').slice(0, -1).join('/') || '.', { recursive: true });
    await writeFile(OUT, JSON.stringify(prev));
    log(`Reuso el catálogo del ${prev.builtAt} (se renueva el lunes o al correr la acción a mano).`);
    return;
  }
  const map = new Map();
  const sets = new Map();
  if (prev) {
    for (const c of prev.cards || []) map.set(`${c.s}-${c.n}`, c);
    for (const s of prev.sets || []) sets.set(s.c, s);
  }
  const report = { swudb: { sets: 0, cards: 0, failedSets: [] }, oficial: {}, github: {} };

  log('Respaldo en GitHub…');
  await loadGithubBase(map, sets, report.github);

  log('swu-db…');
  await loadSwuDb(map, sets, report.swudb);

  log('Base oficial…');
  // En inglés solo hace falta si swu-db no respondió (los datos ya están)
  if (!report.swudb.sets) {
    try { await loadOfficial(map, 'en', report.oficial); } catch (e) { report.oficial.errorEn = e.message; log(`  oficial en falló: ${e.message}`); }
  }
  let esOk = false;
  for (const loc of ['es', 'es-ES']) {
    try {
      const seen = await loadOfficial(map, loc, report.oficial);
      if (seen) { esOk = true; break; }
    } catch (e) { report.oficial['error_' + loc] = e.message; log(`  oficial ${loc} falló: ${e.message}`); }
  }

  const cards = [...map.values()].sort((a, b) => (a.s === b.s ? (parseInt(a.n, 10) || 0) - (parseInt(b.n, 10) || 0) : a.s.localeCompare(b.s)));
  const out = {
    v: 1,
    builtAt: new Date().toISOString(),
    sources: { swudb: report.swudb.sets > 0, oficialEs: esOk, detalle: report },
    sets: [...sets.values()],
    cards,
  };
  await mkdir(OUT.split('/').slice(0, -1).join('/') || '.', { recursive: true });
  await writeFile(OUT, JSON.stringify(out));
  const withEs = cards.filter(c => c.ie).length;
  log(`Listo: ${cards.length} cartas (${withEs} con imagen en español) en ${Math.round((Date.now() - t0) / 1000)} s`);
  if (!cards.length) log('Atención: el catálogo quedó vacío; la app va a usar los datos de tus archivos y las imágenes de swu-db carta por carta.');
}

main().catch(e => {
  console.error('Error inesperado armando el catálogo:', e);
  process.exitCode = 0; // nunca frenar la publicación de la app por el catálogo
});
