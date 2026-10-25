// Sincronización entre dispositivos con un Gist secreto de la cuenta de GitHub.
// Todo se guarda primero en el dispositivo; cuando hay conexión se sube y se baja lo del otro.
// Si hubo cambios en los dos (por ejemplo, uno sin conexión), se unen solos, carta por carta y bolsillo por bolsillo.
import { getState, replaceState, onLocalChange, persistNow } from './store.js';
import { debounce } from './util.js';

const CFG_KEY = 'swu-carpetas:sync:v1';
const BASE_KEY = 'swu-carpetas:sync-base:v1';
const FILE = 'carpetas-swu.json';
const DESC = 'Carpetas SWU · datos de la app (no borrar)';
const API = 'https://api.github.com';

let cfg = null;
try { cfg = JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); } catch { cfg = null; }

export const sync = { status: cfg ? 'idle' : 'off', message: '', lastAt: cfg && cfg.lastAt, merged: 0 };
const listeners = new Set();
export function onSync(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function set(patch) { Object.assign(sync, patch); listeners.forEach(f => f({ ...sync })); }
function save() { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch { /* nada */ } }
function loadBase() { try { return JSON.parse(localStorage.getItem(BASE_KEY) || 'null'); } catch { return null; } }
function saveBase(s) { try { localStorage.setItem(BASE_KEY, JSON.stringify(s)); } catch { /* sin espacio: se une sin base */ } }

export const syncEnabled = () => !!(cfg && cfg.token && cfg.gistId);

// ---------- Unión de cambios (tres vías: lo último sincronizado, este dispositivo y el otro) ----------
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);

function mergeSet(b, l, r) {
  const B = new Set(b || []);
  const L = new Set(l);
  const R = new Set(r);
  return [...new Set([...l, ...r])].filter(e => (L.has(e) && R.has(e)) || (L.has(e) && !B.has(e)) || (R.has(e) && !B.has(e)));
}
function mergeById(b, l, r) {
  const B = new Map((b || []).map(x => [x.id, x]));
  const L = new Map(l.map(x => [x.id, x]));
  const R = new Map(r.map(x => [x.id, x]));
  const ids = [...l.map(x => x.id), ...r.map(x => x.id).filter(id => !L.has(id))];
  const out = [];
  for (const id of ids) {
    if (!L.has(id)) { if (B.has(id) && same(B.get(id), R.get(id))) continue; out.push(R.get(id)); continue; }
    if (!R.has(id)) { if (B.has(id) && same(B.get(id), L.get(id))) continue; out.push(L.get(id)); continue; }
    out.push(merge3(B.get(id), L.get(id), R.get(id)));
  }
  return out;
}
export function merge3(b, l, r) {
  if (same(l, r)) return l;
  if (b !== undefined && same(l, b)) return r;
  if (b !== undefined && same(r, b)) return l;
  if (Array.isArray(l) && Array.isArray(r)) {
    const byId = a => a.every(x => isObj(x) && 'id' in x);
    if (byId(l) && byId(r)) return mergeById(Array.isArray(b) ? b : [], l, r);
    const simple = a => a.every(x => x === null || typeof x !== 'object');
    if (simple(l) && simple(r)) return mergeSet(Array.isArray(b) ? b : [], l, r);
    return l;
  }
  if (isObj(l) && isObj(r)) {
    const bb = isObj(b) ? b : {};
    const out = {};
    for (const k of new Set([...Object.keys(l), ...Object.keys(r)])) {
      const hasL = k in l;
      const hasR = k in r;
      if (!hasL) { if (k in bb && same(bb[k], r[k])) continue; out[k] = r[k]; continue; }
      if (!hasR) { if (k in bb && same(bb[k], l[k])) continue; out[k] = l[k]; continue; }
      out[k] = merge3(bb[k], l[k], r[k]);
    }
    return out;
  }
  return l; // el mismo dato cambió distinto en los dos: queda el de este dispositivo
}

// ---------- GitHub ----------
async function gh(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${cfg.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (res.status === 401) throw new Error('El token de GitHub no es válido o venció.');
  if (res.status === 404) throw new Error('No encontré el Gist (¿se borró?).');
  if (!res.ok) throw new Error(`GitHub respondió ${res.status}.`);
  return res.status === 204 ? null : res.json();
}
async function readRemote() {
  const g = await gh(`/gists/${cfg.gistId}`);
  const f = g.files && g.files[FILE];
  if (!f) return null;
  let text = f.content;
  if (f.truncated && f.raw_url) text = await (await fetch(f.raw_url)).text();
  try { return JSON.parse(text); } catch { return null; }
}
async function writeRemote(s) {
  await gh(`/gists/${cfg.gistId}`, { method: 'PATCH', body: JSON.stringify({ files: { [FILE]: { content: JSON.stringify(s) } } }) });
}

export async function connect(token) {
  cfg = { token: token.trim(), gistId: null, lastAt: null };
  set({ status: 'syncing', message: 'Conectando con GitHub…' });
  try {
    await gh('/user');
    const list = await gh('/gists?per_page=100');
    const found = (list || []).find(g => g.description === DESC && g.files && g.files[FILE]);
    if (found) {
      cfg.gistId = found.id;
      save();
      localStorage.removeItem(BASE_KEY);
      await syncNow({ first: true });
    } else {
      const s = getState();
      const g = await gh('/gists', { method: 'POST', body: JSON.stringify({ description: DESC, public: false, files: { [FILE]: { content: JSON.stringify(s) } } }) });
      cfg.gistId = g.id;
      cfg.lastAt = Date.now();
      save();
      saveBase(s);
      set({ status: 'idle', message: 'Conectado. Tus datos se guardan en tu GitHub.', lastAt: cfg.lastAt });
    }
    return true;
  } catch (e) {
    cfg = null;
    localStorage.removeItem(CFG_KEY);
    set({ status: 'off', message: e.message });
    return false;
  }
}

export function disconnect() {
  cfg = null;
  localStorage.removeItem(CFG_KEY);
  localStorage.removeItem(BASE_KEY);
  set({ status: 'off', message: 'Sincronización desactivada en este dispositivo.' });
}

let running = false;
let again = false;
export async function syncNow({ first = false } = {}) {
  if (!syncEnabled()) return;
  if (running) { again = true; return; }
  if (!navigator.onLine) { set({ status: 'offline', message: 'Sin conexión: tus cambios quedan en este dispositivo y se suben al volver.' }); return; }
  running = true;
  set({ status: 'syncing', message: '' });
  try {
    const local = getState();
    const remote = await readRemote();
    const base = loadBase();
    let result = null; // estado final de este dispositivo
    let push = false;
    let merged = false;
    const isEmpty = s => !Object.keys(s.stock || {}).length && !Object.keys((s.table && s.table.cards) || {}).length;
    if (!remote) { result = local; push = true; }
    else if (remote.updatedAt === local.updatedAt) result = local;
    else if (first && isEmpty(local)) result = remote;
    else if (base && local.updatedAt === base.updatedAt) result = remote; // solo cambió el otro
    else if (base && remote.updatedAt === base.updatedAt) { result = local; push = true; } // solo cambió este
    else { result = { ...merge3(base || undefined, local, remote), updatedAt: Date.now() }; push = true; merged = true; } // cambiaron los dos
    // Si mientras tanto se hicieron más cambios acá, también se suman
    const now = getState();
    if (now !== local && result !== local) { result = { ...merge3(local, now, result), updatedAt: Date.now() }; push = true; }
    else if (now !== local) { result = now; push = true; }
    if (result !== getState()) replaceState(result);
    if (push) await writeRemote(result);
    saveBase(result);
    cfg.lastAt = Date.now();
    save();
    set({ status: 'idle', message: merged ? 'Se unieron cambios hechos en otro dispositivo.' : '', lastAt: cfg.lastAt, merged: sync.merged + (merged ? 1 : 0) });
  } catch (e) {
    set({ status: navigator.onLine ? 'error' : 'offline', message: navigator.onLine ? e.message : 'Sin conexión: tus cambios quedan en este dispositivo y se suben al volver.' });
  }
  running = false;
  if (again) { again = false; setTimeout(() => syncNow(), 300); }
}

// Compatibilidad: ya no hace falta elegir entre versiones, se unen solas
export async function resolveConflict() { await syncNow(); }

const pushSoon = debounce(() => syncNow(), 2000);
onLocalChange(() => { if (syncEnabled()) { set({ status: navigator.onLine ? 'pending' : 'offline' }); pushSoon(); } });

let lastPull = 0;
const pull = () => { if (syncEnabled() && document.visibilityState === 'visible' && Date.now() - lastPull > 15000) { lastPull = Date.now(); syncNow(); } };
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { persistNow(); if (syncEnabled() && sync.status === 'pending') pushSoon.flush(); }
  else pull();
});
addEventListener('focus', pull);
addEventListener('online', () => { if (syncEnabled()) syncNow(); });
addEventListener('offline', () => { if (syncEnabled()) set({ status: 'offline', message: 'Sin conexión: tus cambios quedan en este dispositivo y se suben al volver.' }); });
// Con la app abierta en los dos, cada 30 segundos se trae lo del otro
setInterval(pull, 30000);
