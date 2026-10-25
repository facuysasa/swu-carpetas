// Personajes: base de personajes, etiquetas automáticas (por nombre, por texto y por IA)
// y aprendizaje a partir de lo que confirmás o descartás.
import { norm, uid } from './util.js';
import { catalog, publicImageUrl } from './catalog.js';

export const AUTO_OK = 0.8; // a partir de esta confianza la etiqueta cuenta para filtrar

const TITLES = new Set(['darth', 'general', 'captain', 'capitan', 'admiral', 'grand', 'moff', 'commander', 'count', 'master', 'lord', 'queen',
  'king', 'prince', 'princess', 'jedi', 'sith', 'the', 'and', 'of', 'de', 'la', 'el', 'los', 'las', 'del', 'young', 'old', 'agent', 'lieutenant',
  'sergeant', 'senator', 'chancellor', 'emperor', 'supreme', 'leader', 'doctor', 'baron', 'duchess', 'governor', 'chief', 'major', 'colonel',
  'officer', 'trooper', 'squadron', 'first', 'order', 'imperial', 'rebel', 'republic', 'separatist', 'mandalorian', 'bounty', 'hunter']);

// Las variantes Normal, Foil e Hyperspace comparten ilustración; Showcase, Prestige y promos tienen otra
export function artKey(info) {
  const fam = ['showcase', 'prestige', 'promo'].includes(info.family) ? info.family : 'base';
  return `${norm(info.name)}|${norm(info.sub)}|${fam}`;
}
const nameId = name => 'n:' + norm(name);

function isCharacterCard(info) {
  if (info.type === 'Unit' || info.type === 'Leader') return !!(info.unique || info.sub);
  return !info.type && !!info.sub; // sin datos del catálogo: si tiene subtítulo suele ser un personaje
}

function tokensOf(name) {
  return norm(name).split(/[\s\-–,.'’()]+/).filter(t => t.length >= 4 && !TITLES.has(t));
}

let memo = { stock: null, chars: null, tags: null, cat: -1, r: null };

// Une personajes guardados con los que salen de los nombres de tus cartas
export function deriveChars(state, d) {
  const chars = state.chars || {};
  const tags = state.tags || {};
  if (memo.r && memo.stock === state.stock && memo.chars === chars && memo.tags === tags && memo.cat === catalog.version) return memo.r;

  const base = new Map();
  const add = (id, name, src) => { if (!base.has(id)) base.set(id, { id, name, src }); };
  for (const info of d.list) if (isCharacterCard(info)) add(nameId(info.name), info.name, 'nombre');
  for (const c of Object.values(chars)) {
    base.set(c.id, { ...(base.get(c.id) || { id: c.id, name: c.name, src: c.src || 'manual' }), ...c });
  }
  const resolveId = id => {
    let cur = id;
    for (let k = 0; k < 6; k++) { const c = base.get(cur); if (c && c.mergedInto && base.has(c.mergedInto)) cur = c.mergedInto; else break; }
    return cur;
  };
  const visible = [...base.values()].filter(c => !c.hidden && !c.mergedInto);
  const tokenIndex = visible.map(c => ({ id: c.id, toks: tokensOf(c.name) })).filter(x => x.toks.length);

  const byArt = new Map();
  const byKey = new Map();
  const byChar = new Map(visible.map(c => [c.id, { conf: new Set(), auto: new Set(), sug: new Set() }]));
  for (const info of d.list) {
    const ak = artKey(info);
    let r = byArt.get(ak);
    if (!r) {
      const t = tags[ak] || {};
      const m = new Set((t.m || []).map(resolveId));
      const x = new Set((t.x || []).map(resolveId));
      const auto = new Map();
      const put = (id, p, s) => { id = resolveId(id); const c = base.get(id); if (!c || c.hidden || x.has(id) || m.has(id)) return; const prev = auto.get(id); if (!prev || prev.p < p) auto.set(id, { id, p, s }); };
      if (isCharacterCard(info)) put(nameId(info.name), 0.95, 'nombre');
      const hay = ' ' + norm(info.name + ' ' + info.sub + ' ' + (info.nameEs || '')) + ' ';
      for (const { id, toks } of tokenIndex) if (toks.some(tk => hay.includes(' ' + tk + ' ') || hay.includes(' ' + tk + "'"))) put(id, 0.55, 'texto');
      for (const a of t.a || []) put(a.c, a.p, 'ia');
      const autoList = [...auto.values()].sort((a, b) => b.p - a.p);
      const eff = [...m, ...autoList.filter(a => a.p >= AUTO_OK).map(a => a.id)];
      const sug = autoList.filter(a => a.p < AUTO_OK || a.s === 'ia');
      r = { ak, conf: [...m], auto: autoList, eff: [...new Set(eff)], sug, rejected: [...x], cv: t.cv || 0 };
      byArt.set(ak, r);
    }
    byKey.set(info.key, r);
    for (const id of r.conf) byChar.get(id) && byChar.get(id).conf.add(ak);
    for (const a of r.auto) {
      const bc = byChar.get(a.id);
      if (!bc) continue;
      if (a.p >= AUTO_OK && a.s !== 'ia') bc.auto.add(ak); else bc.sug.add(ak);
    }
  }
  const list = visible.map(c => {
    const bc = byChar.get(c.id);
    return { ...c, conf: bc.conf.size, auto: bc.auto.size, sug: bc.sug.size, total: new Set([...bc.conf, ...bc.auto]).size };
  }).filter(c => c.total || c.sug || c.src !== 'nombre')
    .sort((a, b) => (b.total - a.total) || a.name.localeCompare(b.name, 'es'));
  const r = { list, base, byArt, byKey, byChar, resolveId, nameOf: id => (base.get(resolveId(id)) || {}).name || id };
  memo = { stock: state.stock, chars, tags, cat: catalog.version, r };
  return r;
}

// Nombres de personajes de una carta (para buscar y filtrar)
export function charNamesFor(cd, key) {
  const r = cd.byKey.get(key);
  return r ? r.eff.map(cd.nameOf) : [];
}

export function newCharId() { return 'c:' + uid(''); }
export { nameId };

// ---------- Detección con Gemini (plan gratuito) ----------
const CFG_KEY = 'swu-carpetas:gemini:v1';
export function geminiConfig() {
  try { return { model: 'gemini-flash-latest', key: '', ...(JSON.parse(localStorage.getItem(CFG_KEY) || '{}')) }; } catch { return { model: 'gemini-flash-latest', key: '' }; }
}
export function saveGeminiConfig(cfg) {
  try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch { /* sin espacio */ }
}

async function callGemini(cfg, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`;
  let res;
  try {
    res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.key },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], tools: [{ url_context: {} }], generationConfig: { temperature: 0.1 } }),
    });
  } catch {
    throw new Error(window.SWU_STANDALONE && !location.protocol.startsWith('file')
      ? 'Desde acá no se puede llegar a Gemini: claude.ai bloquea las conexiones a otros sitios. Probalo con el archivo descargado o con la versión publicada.'
      : 'No se pudo conectar con Gemini. Revisá tu conexión.');
  }
  if (res.status === 429) { const e = new Error('Se alcanzó el límite gratuito de Gemini por ahora.'); e.code = 429; throw e; }
  if (res.status === 400 || res.status === 403) {
    const t = await res.text();
    const e = new Error(/API key|API_KEY|permission/i.test(t) ? 'La API key de Gemini no es válida.' : `Gemini rechazó el pedido (${res.status}).`);
    e.code = res.status; e.detail = t.slice(0, 300); throw e;
  }
  if (!res.ok) throw new Error(`Gemini respondió ${res.status}.`);
  const j = await res.json();
  return ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []).map(p => p.text || '').join('');
}

function parseJson(text) {
  const m = /\{[\s\S]*\}/.exec(text || '');
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

export async function testGemini(cfg) {
  const t = await callGemini(cfg, 'Respond with exactly this JSON: {"ok":true}');
  const j = parseJson(t);
  if (!j || !j.ok) throw new Error('Gemini respondió, pero no en el formato esperado.');
  return true;
}

// Elige ejemplos que vos confirmaste para "enseñarle" a reconocer a cada personaje
function pickReferences(cd, infosByArt, focusIds, max) {
  const refs = [];
  const used = new Set();
  const order = [...(focusIds || []), ...cd.list.filter(c => c.conf).sort((a, b) => b.conf - a.conf).map(c => c.id)];
  for (const id of order) {
    if (refs.length >= max) break;
    if (used.has(id)) continue;
    const arts = cd.byChar.get(id);
    if (!arts) continue;
    const ak = [...arts.conf][0];
    const info = ak && infosByArt.get(ak);
    if (!info) continue;
    used.add(id);
    const names = cd.byArt.get(ak).conf.map(cd.nameOf);
    refs.push({ url: publicImageUrl(info), names });
  }
  return refs;
}

// artKeys: ilustraciones a revisar. focus: id de personaje para una búsqueda dirigida (opcional)
export async function detectCharacters({ state, d, cd, artKeys, focus, onBatch, onProgress, shouldStop }) {
  const cfg = geminiConfig();
  if (!cfg.key) throw new Error('Falta tu API key de Gemini (Ajustes).');
  const infosByArt = new Map();
  for (const info of d.list) { const ak = artKey(info); if (!infosByArt.has(ak) || (info.match === 'exact' && infosByArt.get(ak).match !== 'exact')) infosByArt.set(ak, info); }
  const todo = artKeys.filter(ak => infosByArt.has(ak));
  const known = cd.list.map(c => c.name).slice(0, 350);
  const BATCH = 8;
  let done = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    if (shouldStop && shouldStop()) break;
    const batch = todo.slice(i, i + BATCH);
    const refs = pickReferences(cd, infosByArt, focus ? [focus] : null, 6);
    const corrections = [];
    batch.forEach((ak, n) => { const r = cd.byArt.get(ak); if (r && r.rejected.length) corrections.push(`card ${n + 1}: NOT ${r.rejected.map(cd.nameOf).join(', ')}`); });
    const focusName = focus ? cd.nameOf(focus) : null;
    const prompt = [
      'You identify Star Wars characters shown in the ARTWORK of Star Wars: Unlimited trading cards.',
      'Open each image URL and look at the illustration. A character counts only if it is visibly depicted (not just named in the text box).',
      focusName ? `Pay special attention to whether "${focusName}" appears in each card.` : '',
      `Known characters (reuse these exact names when they match): ${known.join('; ')}`,
      refs.length ? 'Reference cards confirmed by the collector (use them to recognize these characters):' : '',
      ...refs.map(r => `- ${r.url} shows: ${r.names.join(', ')}`),
      corrections.length ? `Corrections from the collector: ${corrections.join(' | ')}` : '',
      'Cards to analyze:',
      ...batch.map((ak, n) => `card ${n + 1}: ${publicImageUrl(infosByArt.get(ak))}`),
      'Return ONLY JSON like {"cards":[{"card":1,"characters":[{"name":"Darth Vader","confidence":0.9}]}]}.',
      'Include every recognizable character with confidence from 0 to 1. For characters not in the list use their most common English name. Use an empty list when no character is recognizable.',
    ].filter(Boolean).join('\n');
    let text;
    for (let attempt = 0; ; attempt++) {
      try { text = await callGemini(cfg, prompt); break; } catch (e) {
        if (e.code === 429 && attempt < 2) { onProgress && onProgress({ done, total: todo.length, waiting: true }); await new Promise(r => setTimeout(r, 35000)); continue; }
        throw e;
      }
    }
    const j = parseJson(text);
    const results = {};
    for (const row of (j && j.cards) || []) {
      const n = parseInt(row.card ?? row.id, 10);
      const ak = batch[n - 1];
      if (!ak) continue;
      results[ak] = (row.characters || []).filter(c => c && c.name).map(c => ({ name: String(c.name).trim(), p: Math.max(0, Math.min(1, Number(c.confidence ?? 0.7))) }));
    }
    done += batch.length;
    onBatch && onBatch(results, batch);
    onProgress && onProgress({ done, total: todo.length });
    if (i + BATCH < todo.length) await new Promise(r => setTimeout(r, 4500));
  }
  return done;
}
