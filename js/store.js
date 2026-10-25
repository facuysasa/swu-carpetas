// Estado global, persistencia local, deshacer y acciones
import { uid, slotPos, capacityOf, norm } from './util.js';
import { catalog, resolve } from './catalog.js';

const LS_KEY = 'swu-carpetas:estado:v1';
const UI_KEY = 'swu-carpetas:ui:v1';

export const MODELS = [
  { id: 'gg18', label: 'Gamegenic 18 bolsillos · 20 hojas de 3×3 (360)', sheets: 20, rows: 3, cols: 3 },
  { id: 'p9-25', label: '9 bolsillos · 25 hojas de 3×3 (450)', sheets: 25, rows: 3, cols: 3 },
  { id: 'p12-20', label: '12 bolsillos · 20 hojas de 4×3 (480)', sheets: 20, rows: 3, cols: 4 },
  { id: 'p4-20', label: '4 bolsillos · 20 hojas de 2×2 (160)', sheets: 20, rows: 2, cols: 2 },
];

export const COVER_COLORS = [
  { id: 'rojo', color: '#5a1217', label: 'Rojo oscuro' },
  { id: 'negro', color: '#1c1c1f', label: 'Negro' },
  { id: 'azul', color: '#16233d', label: 'Azul noche' },
  { id: 'verde', color: '#163222', label: 'Verde bosque' },
  { id: 'gris', color: '#3a3d42', label: 'Gris' },
  { id: 'arena', color: '#7a6446', label: 'Arena' },
];

export function makeVersion(name = 'Versión 1', slots = {}) {
  const t = Date.now();
  return { id: uid('v'), name, slots, createdAt: t, updatedAt: t };
}

export function makeBinder({ name = 'Carpeta', sheets = 20, rows = 3, cols = 3, color = '#5a1217', strap = true, photo = null } = {}) {
  const v = makeVersion();
  return { id: uid('b'), name, sheets, rows, cols, cover: { color, strap, photo }, versions: [v], active: v.id, createdAt: Date.now() };
}

function initialState() {
  return {
    schema: 1,
    updatedAt: 0,
    settings: { lang: 'es', prices: true, followNext: false },
    stock: {},
    binders: [makeBinder({ name: 'Carpeta 1' })],
    chars: {},
    tags: {},
    table: { cards: {}, pos: {}, z: 1 },
    boxes: [],
  };
}

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return initialState();
    const s = JSON.parse(raw);
    if (!s || !s.binders) return initialState();
    s.settings = { ...initialState().settings, ...(s.settings || {}) };
    s.stock = s.stock || {};
    s.chars = s.chars || {};
    s.tags = s.tags || {};
    s.table = { cards: {}, pos: {}, z: 1, ...(s.table || {}) };
    s.boxes = s.boxes || [];
    return s;
  } catch {
    return initialState();
  }
}

let state = load();
const subs = new Set();
let undoStack = [];
let redoStack = [];
const changeHooks = new Set();

export const getState = () => state;
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
export function onLocalChange(fn) { changeHooks.add(fn); return () => changeHooks.delete(fn); }

let persistTimer = null;
function persistSoon() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persistNow, 250);
}
const persistErr = new Set();
export function onPersistError(fn) { persistErr.add(fn); return () => persistErr.delete(fn); }
let warned = false;
export function persistNow() {
  clearTimeout(persistTimer);
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); warned = false; }
  catch (e) {
    console.warn('No se pudo guardar', e);
    if (!warned) { warned = true; persistErr.forEach(f => f(e)); }
  }
}
addEventListener('pagehide', persistNow);

function emit() { subs.forEach(f => f(state)); }

// Cambio hecho por la persona (deshacible si lleva etiqueta)
export function commit(next, label) {
  if (!next || next === state) return;
  if (label) {
    undoStack.push({ s: state, label });
    if (undoStack.length > 80) undoStack.shift();
    redoStack = [];
  }
  state = { ...next, updatedAt: Date.now() };
  persistSoon();
  emit();
  changeHooks.forEach(h => h(state));
}

// Reemplazo completo (sincronización o backup): no se deshace
export function replaceState(next) {
  state = next;
  undoStack = [];
  redoStack = [];
  persistNow();
  emit();
}

export function resetAll() {
  replaceState({ ...initialState(), updatedAt: Date.now() });
}

export function undo() {
  const u = undoStack.pop();
  if (!u) return null;
  redoStack.push({ s: state, label: u.label });
  state = { ...u.s, updatedAt: Date.now() };
  persistSoon(); emit(); changeHooks.forEach(h => h(state));
  return u.label;
}
export function redo() {
  const r = redoStack.pop();
  if (!r) return null;
  undoStack.push({ s: state, label: r.label });
  state = { ...r.s, updatedAt: Date.now() };
  persistSoon(); emit(); changeHooks.forEach(h => h(state));
  return r.label;
}
export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;
export const undoLabel = () => (undoStack.length ? undoStack[undoStack.length - 1].label : '');

// Preferencias de interfaz que no se sincronizan (última página vista, etc.)
let ui = {};
try { ui = JSON.parse(localStorage.getItem(UI_KEY) || '{}'); } catch { ui = {}; }
export function uiGet(k, def) { return ui[k] ?? def; }
export function uiSet(k, v) { ui[k] = v; try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch { /* sin espacio */ } }

// ---------- Datos derivados ----------
export function activeVersion(b) {
  return b.versions.find(v => v.id === b.active) || b.versions[0];
}

let memo = { stock: null, binders: null, table: null, boxes: null, cat: -1, lang: null, d: null };
export function derive(s) {
  const catV = catalog.version;
  const lang = s.settings.lang;
  if (memo.d && memo.stock === s.stock && memo.binders === s.binders && memo.table === s.table && memo.boxes === s.boxes && memo.cat === catV && memo.lang === lang) return memo.d;
  let infos;
  if (memo.d && memo.stock === s.stock && memo.cat === catV && memo.lang === lang) infos = memo.d.infos;
  else {
    infos = new Map();
    for (const e of Object.values(s.stock)) infos.set(e.key, resolve(e, lang));
  }
  const assigned = new Map();
  const locs = new Map();
  const filled = new Map();
  for (const b of s.binders) {
    const v = activeVersion(b);
    let n = 0;
    for (const [k, slot] of Object.entries(v.slots)) {
      const idx = +k;
      n += 1;
      assigned.set(slot.k, (assigned.get(slot.k) || 0) + slot.q);
      if (!locs.has(slot.k)) locs.set(slot.k, []);
      locs.get(slot.k).push({ b: b.id, idx, face: slotPos(b, idx).face, q: slot.q });
    }
    filled.set(b.id, n);
  }
  let onTable = 0;
  for (const c of Object.values((s.table && s.table.cards) || {})) {
    onTable += c.q;
    assigned.set(c.k, (assigned.get(c.k) || 0) + c.q);
    if (!locs.has(c.k)) locs.set(c.k, []);
    locs.get(c.k).push({ b: 'mesa', id: c.id, q: c.q });
  }
  let inBoxes = 0;
  const boxUsed = new Map();
  for (const bx of s.boxes || []) {
    let used = 0;
    for (const [k, q] of Object.entries(bx.cards || {})) {
      used += q;
      assigned.set(k, (assigned.get(k) || 0) + q);
      if (!locs.has(k)) locs.set(k, []);
      locs.get(k).push({ b: 'caja', box: bx.id, q });
    }
    boxUsed.set(bx.id, used);
    inBoxes += used;
  }
  // Dónde está cada carta (para buscar y filtrar)
  const where = new Map();
  for (const [k, list] of locs) {
    const w = { binders: new Set(), table: false, boxes: new Set() };
    for (const l of list) { if (l.b === 'mesa') w.table = true; else if (l.b === 'caja') w.boxes.add(l.box); else w.binders.add(l.b); }
    where.set(k, w);
  }
  const conflicts = new Set();
  for (const [k, q] of assigned) if (q > ((s.stock[k] && s.stock[k].count) || 0)) conflicts.add(k);
  let copies = 0;
  let value = 0;
  let placed = 0;
  for (const e of Object.values(s.stock)) {
    copies += e.count;
    const inf = infos.get(e.key);
    if (inf && inf.price) value += inf.price * e.count;
    placed += Math.min(e.count, assigned.get(e.key) || 0);
  }
  const d = { infos, list: [...infos.values()], assigned, locs, where, filled, conflicts, copies, value, placed, printings: infos.size, onTable, inBoxes, boxUsed };
  for (const info of d.list) info.placed = (assigned.get(info.key) || 0) > 0;
  memo = { stock: s.stock, binders: s.binders, table: s.table, boxes: s.boxes, cat: catV, lang, d };
  return d;
}

export function freeCopies(s, d, key) {
  return ((s.stock[key] && s.stock[key].count) || 0) - (d.assigned.get(key) || 0);
}

// ---------- Helpers inmutables ----------
function mapBinder(s, id, fn) {
  return { ...s, binders: s.binders.map(b => (b.id === id ? fn(b) : b)) };
}
function mapSlots(s, binderId, fn) {
  return mapBinder(s, binderId, b => ({
    ...b,
    versions: b.versions.map(v => (v.id !== b.active ? v : { ...v, slots: fn({ ...v.slots }, b), updatedAt: Date.now() })),
  }));
}

function mapBox(s, id, fn) {
  return { ...s, boxes: (s.boxes || []).map(b => (b.id === id ? fn({ ...b, cards: { ...b.cards } }) : b)) };
}
function takeFromBox(b, k, q) {
  const cur = b.cards[k] || 0;
  if (cur > q) b.cards[k] = cur - q; else delete b.cards[k];
}
function mapTable(s, fn) {
  return { ...s, table: fn({ ...s.table, cards: { ...s.table.cards }, pos: { ...s.table.pos } }) };
}
function takeFromTable(t, id, q) {
  const c = t.cards[id];
  if (!c) return;
  if (c.q > q) t.cards[id] = { ...c, q: c.q - q }; else delete t.cards[id];
}
const tilt = () => Math.round((Math.random() * 6 - 3) * 10) / 10;

// ---------- Acciones ----------
export const A = {
  place(binderId, idx, key, q = 1) {
    commit(mapSlots(state, binderId, sl => { sl[idx] = { k: key, q }; return sl; }), 'poner una carta');
  },
  clear(binderId, idx) {
    commit(mapSlots(state, binderId, sl => { delete sl[idx]; return sl; }), 'sacar una carta');
  },
  setQty(binderId, idx, q) {
    commit(mapSlots(state, binderId, sl => {
      if (!sl[idx]) return sl;
      if (q <= 0) delete sl[idx]; else sl[idx] = { ...sl[idx], q };
      return sl;
    }), 'cambiar copias del bolsillo');
  },
  move(binderId, from, to) {
    if (from === to) return;
    const b = state.binders.find(x => x.id === binderId);
    const swap = !!activeVersion(b).slots[to];
    commit(mapSlots(state, binderId, sl => {
      const a = sl[from];
      const c = sl[to];
      if (c) sl[from] = c; else delete sl[from];
      if (a) sl[to] = a;
      return sl;
    }), swap ? 'intercambiar cartas' : 'mover una carta');
  },
  // Trae copias desde otro bolsillo (de esta u otra carpeta) y las pone acá
  placeTaking(binderId, idx, key, q, from) {
    let s2 = from.b === 'mesa' ? mapTable(state, t => { takeFromTable(t, from.id, q); return t; })
      : from.b === 'caja' ? mapBox(state, from.box, b => { takeFromBox(b, key, q); return b; })
      : mapSlots(state, from.b, sl => {
      const cur = sl[from.idx];
      if (cur && cur.k === key) {
        if (cur.q > q) sl[from.idx] = { ...cur, q: cur.q - q }; else delete sl[from.idx];
      }
      return sl;
    });
    s2 = mapSlots(s2, binderId, sl => { sl[idx] = { k: key, q }; return sl; });
    commit(s2, 'traer una carta de otro lugar');
  },
  addBinder(spec) {
    const b = makeBinder(spec);
    commit({ ...state, binders: [...state.binders, b] }, 'crear carpeta');
    return b.id;
  },
  updateBinder(id, patch) {
    commit(mapBinder(state, id, b => {
      const nb = { ...b, ...patch, cover: { ...b.cover, ...(patch.cover || {}) } };
      const dims = ['sheets', 'rows', 'cols'].some(k => patch[k] != null && patch[k] !== b[k]);
      if (dims) nb.versions = b.versions.map(v => ({ ...v, slots: remapSlots(v.slots, b, nb) }));
      return nb;
    }), 'editar carpeta');
  },
  deleteBinder(id) {
    commit({ ...state, binders: state.binders.filter(b => b.id !== id) }, 'eliminar carpeta');
  },
  addVersion(binderId, { name, copy = true } = {}) {
    let newId = null;
    commit(mapBinder(state, binderId, b => {
      const cur = activeVersion(b);
      const v = makeVersion(name || `Versión ${b.versions.length + 1}`, copy ? { ...cur.slots } : {});
      newId = v.id;
      return { ...b, versions: [...b.versions, v], active: v.id };
    }), 'crear versión');
    return newId;
  },
  setActiveVersion(binderId, vid) {
    commit(mapBinder(state, binderId, b => ({ ...b, active: vid })), 'cambiar de versión');
  },
  renameVersion(binderId, vid, name) {
    commit(mapBinder(state, binderId, b => ({ ...b, versions: b.versions.map(v => (v.id === vid ? { ...v, name } : v)) })), 'renombrar versión');
  },
  deleteVersion(binderId, vid) {
    commit(mapBinder(state, binderId, b => {
      if (b.versions.length < 2) return b;
      const versions = b.versions.filter(v => v.id !== vid);
      return { ...b, versions, active: b.active === vid ? versions[0].id : b.active };
    }), 'eliminar versión');
  },
  setStock(stock, label = 'importar colección') {
    commit({ ...state, stock }, label);
  },
  setCount(key, count) {
    const stock = { ...state.stock };
    if (count <= 0) delete stock[key];
    else stock[key] = { ...stock[key], count };
    commit({ ...state, stock }, 'cambiar cantidad');
  },
  addPrinting(entry) {
    const prev = state.stock[entry.key];
    const stock = { ...state.stock, [entry.key]: { ...entry, count: (prev ? prev.count : 0) + entry.count, addedAt: prev ? prev.addedAt : Date.now() } };
    commit({ ...state, stock }, 'agregar carta');
  },
  // Saca de las carpetas las copias que ya no están en el stock
  trimConflicts() {
    const d = derive(state);
    let s2 = state;
    for (const key of d.conflicts) {
      let extra = (d.assigned.get(key) || 0) - ((state.stock[key] && state.stock[key].count) || 0);
      const rank = l => (l.b === 'mesa' ? 0 : l.b === 'caja' ? 1 : 2);
      const locs = (d.locs.get(key) || []).slice().sort((a, b) => (rank(a) - rank(b)) || ((b.idx || 0) - (a.idx || 0)));
      for (const l of locs) {
        if (extra <= 0) break;
        const take = Math.min(extra, l.q);
        extra -= take;
        if (l.b === 'mesa') { s2 = mapTable(s2, t => { takeFromTable(t, l.id, take); return t; }); continue; }
        if (l.b === 'caja') { s2 = mapBox(s2, l.box, b => { takeFromBox(b, key, take); return b; }); continue; }
        s2 = mapSlots(s2, l.b, sl => {
          const cur = sl[l.idx];
          if (!cur) return sl;
          if (cur.q > take) sl[l.idx] = { ...cur, q: cur.q - take }; else delete sl[l.idx];
          return sl;
        });
      }
    }
    commit(s2, 'quitar cartas que ya no están');
  },
  applyPlan(plan) {
    let s2 = state;
    for (const r of plan.removals) {
      if (r.b === 'mesa') { s2 = mapTable(s2, t => { takeFromTable(t, r.id, r.q); return t; }); continue; }
      if (r.b === 'caja') { s2 = mapBox(s2, r.box, b => { takeFromBox(b, r.key, r.q); return b; }); continue; }
      s2 = mapSlots(s2, r.b, sl => {
        const cur = sl[r.idx];
        if (!cur) return sl;
        if (cur.q > r.q) sl[r.idx] = { ...cur, q: cur.q - r.q }; else delete sl[r.idx];
        return sl;
      });
    }
    s2 = mapBinder(s2, plan.binderId, b => {
      if (plan.newVersionName) {
        const v = makeVersion(plan.newVersionName, plan.slots);
        return { ...b, versions: [...b.versions, v], active: v.id };
      }
      return { ...b, versions: b.versions.map(v => (v.id === b.active ? { ...v, slots: plan.slots, updatedAt: Date.now() } : v)) };
    });
    commit(s2, 'ordenar automáticamente');
  },
  // ---------- Mesa ----------
  tableAdd(items, label = 'llevar cartas a la mesa') {
    commit(mapTable(state, t => {
      let z = t.z || 1;
      for (const it of items) { const id = uid('t'); t.cards[id] = { id, k: it.k, q: it.q || 1, x: Math.round(it.x), y: Math.round(it.y), r: tilt(), z: ++z }; }
      t.z = z;
      return t;
    }), label);
  },
  tableMove(pos) {
    commit(mapTable(state, t => {
      let z = t.z || 1;
      for (const [id, p] of Object.entries(pos)) if (t.cards[id]) t.cards[id] = { ...t.cards[id], x: Math.round(p.x), y: Math.round(p.y), z: ++z };
      t.z = z;
      return t;
    }), 'mover cartas en la mesa');
  },
  tableRemove(ids) {
    commit(mapTable(state, t => { ids.forEach(id => delete t.cards[id]); return t; }), 'devolver cartas a la caja');
  },
  tableStack(ids) {
    const cards = ids.map(id => state.table.cards[id]).filter(Boolean);
    if (cards.length < 2 || cards.some(c => c.k !== cards[0].k)) return;
    commit(mapTable(state, t => {
      const keep = cards[0];
      t.cards[keep.id] = { ...keep, q: cards.reduce((n, c) => n + c.q, 0), z: (t.z = (t.z || 1) + 1) };
      cards.slice(1).forEach(c => delete t.cards[c.id]);
      return t;
    }), 'apilar cartas');
  },
  tableSplit(id) {
    const c = state.table.cards[id];
    if (!c || c.q < 2) return;
    commit(mapTable(state, t => {
      let z = t.z || 1;
      delete t.cards[id];
      for (let i = 0; i < c.q; i++) { const nid = uid('t'); t.cards[nid] = { id: nid, k: c.k, q: 1, x: c.x + i * 9, y: c.y + i * 6, r: tilt(), z: ++z }; }
      t.z = z;
      return t;
    }), 'separar pila');
  },
  tableArrange(ids, cols = 8) {
    const cards = ids.map(id => state.table.cards[id]).filter(Boolean).sort((a, b) => (Math.round(a.y / 60) - Math.round(b.y / 60)) || (a.x - b.x));
    if (!cards.length) return;
    const x0 = Math.min(...cards.map(c => c.x));
    const y0 = Math.min(...cards.map(c => c.y));
    commit(mapTable(state, t => {
      let z = t.z || 1;
      cards.forEach((c, i) => { t.cards[c.id] = { ...c, x: x0 + (i % cols) * 96, y: y0 + Math.floor(i / cols) * 100, r: 0, z: ++z }; });
      t.z = z;
      return t;
    }), 'ordenar cartas en la mesa');
  },
  pocketToTable(binderId, idx, x, y) {
    const b = state.binders.find(v => v.id === binderId);
    const slot = b && activeVersion(b).slots[idx];
    if (!slot) return;
    let s2 = mapSlots(state, binderId, sl => { delete sl[idx]; return sl; });
    s2 = mapTable(s2, t => { const id = uid('t'); t.z = (t.z || 1) + 1; t.cards[id] = { id, k: slot.k, q: slot.q, x: Math.round(x), y: Math.round(y), r: tilt(), z: t.z }; return t; });
    commit(s2, 'dejar carta en la mesa');
  },
  // pairs: [{ id (carta de la mesa) | k+q (de la caja), idx }]; displaced: cartas que vuelven a la mesa por un intercambio
  dropIntoBinder(binderId, pairs, displaced = [], label = 'guardar cartas en la carpeta') {
    let s2 = state;
    const cards = state.table.cards;
    s2 = mapSlots(s2, binderId, sl => {
      for (const p of pairs) {
        if (p.id) { const c = cards[p.id]; if (c) sl[p.idx] = { k: c.k, q: c.q }; } else sl[p.idx] = { k: p.k, q: p.q || 1 };
      }
      return sl;
    });
    s2 = mapTable(s2, t => {
      for (const p of pairs) if (p.id) delete t.cards[p.id];
      let z = t.z || 1;
      for (const it of displaced) { const id = uid('t'); t.cards[id] = { id, k: it.k, q: it.q, x: Math.round(it.x), y: Math.round(it.y), r: tilt(), z: ++z }; }
      t.z = z;
      return t;
    });
    commit(s2, label);
  },
  // ---------- Cajas ----------
  addBox({ name = 'Caja', cap = 80, color = '#1d3b5c', photo = null } = {}) {
    const id = uid('x');
    commit({ ...state, boxes: [...(state.boxes || []), { id, name, cap, color, photo, cards: {}, createdAt: Date.now() }] }, 'crear caja');
    return id;
  },
  updateBox(id, patch) {
    commit(mapBox(state, id, b => ({ ...b, ...patch })), 'editar caja');
  },
  deleteBox(id) {
    commit(mapTable({ ...state, boxes: (state.boxes || []).filter(b => b.id !== id) }, t => { delete t.pos[id]; return t; }), 'eliminar caja');
  },
  // units: [{ id } carta de la mesa | { k, q } sin guardar | { b, idx } bolsillo]
  dropIntoBox(boxId, units, label = 'guardar en la caja') {
    const tableCards = state.table.cards;
    let s2 = state;
    const add = {};
    const pockets = new Map();
    for (const u of units) {
      if (u.id) { const c = tableCards[u.id]; if (c) add[c.k] = (add[c.k] || 0) + c.q; }
      else if (u.idx != null && u.b) { if (!pockets.has(u.b)) pockets.set(u.b, []); pockets.get(u.b).push(u.idx); }
      else if (u.k) add[u.k] = (add[u.k] || 0) + (u.q || 1);
    }
    for (const [bid, idxs] of pockets) {
      const b = state.binders.find(x => x.id === bid);
      const sl = b ? activeVersion(b).slots : {};
      for (const i of idxs) if (sl[i]) add[sl[i].k] = (add[sl[i].k] || 0) + sl[i].q;
      s2 = mapSlots(s2, bid, sl2 => { idxs.forEach(i => delete sl2[i]); return sl2; });
    }
    s2 = mapTable(s2, t => { units.forEach(u => { if (u.id) delete t.cards[u.id]; }); return t; });
    s2 = mapBox(s2, boxId, b => { for (const [k, q] of Object.entries(add)) b.cards[k] = (b.cards[k] || 0) + q; return b; });
    commit(s2, label);
    return Object.values(add).reduce((n, q) => n + q, 0);
  },
  boxTake(boxId, k, q = 1) {
    commit(mapBox(state, boxId, b => { takeFromBox(b, k, q); return b; }), 'sacar de la caja');
  },
  boxToTable(boxId, k, q, x, y) {
    let s2 = mapBox(state, boxId, b => { takeFromBox(b, k, q); return b; });
    s2 = mapTable(s2, t => { const id = uid('t'); t.z = (t.z || 1) + 1; t.cards[id] = { id, k, q, x: Math.round(x), y: Math.round(y), r: tilt(), z: t.z }; return t; });
    commit(s2, 'llevar de la caja a la mesa');
  },
  boxEmpty(boxId) {
    commit(mapBox(state, boxId, b => ({ ...b, cards: {} })), 'vaciar caja');
  },
  binderPos(id, x, y) {
    commit(mapTable(state, t => { t.pos[id] = { x: Math.round(x), y: Math.round(y) }; return t; }), 'mover carpeta');
  },
  // ---------- Personajes ----------
  confirmTag(ak, id) {
    const t = state.tags[ak] || {};
    const m = [...new Set([...(t.m || []), id])];
    commit({ ...state, tags: { ...state.tags, [ak]: { ...t, m, x: (t.x || []).filter(x => x !== id) } } }, 'confirmar personaje');
  },
  rejectTag(ak, id) {
    const t = state.tags[ak] || {};
    const x = [...new Set([...(t.x || []), id])];
    commit({ ...state, tags: { ...state.tags, [ak]: { ...t, x, m: (t.m || []).filter(v => v !== id) } } }, 'descartar personaje');
  },
  ensureChar(name, cd) {
    const n = norm(name);
    const found = cd && cd.list.find(c => norm(c.name) === n);
    if (found) return { id: found.id, s: state };
    const existing = Object.values(state.chars).find(c => norm(c.name) === n && !c.mergedInto);
    if (existing) return { id: existing.id, s: state };
    const id = 'c:' + uid('');
    return { id, s: { ...state, chars: { ...state.chars, [id]: { id, name: name.trim(), src: 'manual' } } } };
  },
  addTagByName(ak, name, cd) {
    if (!name || !name.trim()) return;
    const { id, s } = A.ensureChar(name, cd);
    const t = s.tags[ak] || {};
    commit({ ...s, tags: { ...s.tags, [ak]: { ...t, m: [...new Set([...(t.m || []), id])], x: (t.x || []).filter(x => x !== id) } } }, 'agregar personaje');
  },
  renameChar(id, name, cd) {
    const cur = state.chars[id] || (cd && cd.base.get(id)) || { id };
    commit({ ...state, chars: { ...state.chars, [id]: { id, src: cur.src || 'manual', ...cur, name: name.trim() } } }, 'renombrar personaje');
  },
  mergeChar(id, intoId, cd) {
    const cur = state.chars[id] || (cd && cd.base.get(id)) || { id };
    commit({ ...state, chars: { ...state.chars, [id]: { ...cur, id, mergedInto: intoId } } }, 'unir personajes');
  },
  hideChar(id, cd) {
    const cur = state.chars[id] || (cd && cd.base.get(id)) || { id };
    commit({ ...state, chars: { ...state.chars, [id]: { ...cur, id, hidden: true } } }, 'quitar personaje');
  },
  // Resultados de la IA: se guardan como sugerencias (no se deshacen una por una)
  setIaTags(results, batch, cd) {
    let chars = state.chars;
    const tags = { ...state.tags };
    const byName = new Map(cd.list.map(c => [norm(c.name), c.id]));
    for (const c of Object.values(chars)) if (!c.mergedInto && !c.hidden) byName.set(norm(c.name), c.id);
    for (const ak of batch) {
      const found = results[ak] || [];
      const a = [];
      for (const f of found) {
        let id = byName.get(norm(f.name));
        if (!id) {
          if (f.p < 0.6) continue;
          id = 'c:' + uid('');
          chars = { ...chars, [id]: { id, name: f.name, src: 'ia' } };
          byName.set(norm(f.name), id);
        }
        a.push({ c: id, p: Math.round(f.p * 100) / 100 });
      }
      tags[ak] = { ...(tags[ak] || {}), a, cv: Date.now() };
    }
    commit({ ...state, chars, tags }, null);
  },
  setSettings(patch) {
    state = { ...state, settings: { ...state.settings, ...patch }, updatedAt: Date.now() };
    persistSoon(); emit(); changeHooks.forEach(h => h(state));
  },
};

function remapSlots(slots, oldB, newB) {
  const out = {};
  const perN = newB.rows * newB.cols;
  const cap = capacityOf(newB);
  for (const [k, v] of Object.entries(slots)) {
    const p = slotPos(oldB, +k);
    if (p.row < newB.rows && p.col < newB.cols) {
      const idx = (p.face - 1) * perN + p.row * newB.cols + p.col;
      if (idx < cap) out[idx] = v;
    }
  }
  return out;
}

export function slotsLostOnResize(b, patch) {
  const nb = { ...b, ...patch };
  let lost = 0;
  for (const v of b.versions) {
    const kept = Object.keys(remapSlots(v.slots, b, nb)).length;
    lost = Math.max(lost, Object.keys(v.slots).length - kept);
  }
  return lost;
}
