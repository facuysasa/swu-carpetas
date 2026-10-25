// Cartas sueltas sobre la mesa: arrastrar desde la caja, desde y hacia los bolsillos,
// mover, agrupar, seleccionar varias y guardarlas de una en una página.
import { html, useState, useEffect, useMemo, useRef } from './vendor/preact-htm.js';
import { A, getState, activeVersion, freeCopies, derive, undo } from './store.js';
import { cls, plural, normNum } from './util.js';
import { resolve } from './catalog.js';
import { Icon, CardImage, CardTile, useLandscape, toast, modalOpen } from './ui.js';
import { FilterBar } from './filters.js';
import { matches, comparator, emptyFilter, tagFn } from './autofill.js';
import { deriveChars } from './chars.js';
import { CARD_W, CARD_H, emptyOnFace, emptyInBinder, binderLayout } from './geom.js';
import { chooseBox, afterBoxDrop } from './boxes.js';

export function infoFor(d, key, lang) {
  const known = d.infos.get(key);
  if (known) return known;
  const [set, num, ...rest] = key.split('-');
  return { ...resolve({ key, set, num: normNum(num), foil: rest.includes('F'), count: 0 }, lang), missing: true };
}

function makeCtl() {
  const subs = new Set();
  return { drag: null, sub(f) { subs.add(f); return () => subs.delete(f); }, emit() { subs.forEach(f => f()); } };
}
function useCtl(ctl) {
  const [, force] = useState(0);
  useEffect(() => ctl.sub(() => force(x => x + 1)), [ctl]);
  return ctl.drag;
}
const reading = (a, b) => (Math.round(a.y / 70) - Math.round(b.y / 70)) || (a.x - b.x);

// ---------- Cartas en la mesa ----------
function TableCard({ c, x, y, info, sel, found, dragging, onClick, onDbl }) {
  const [land, setLand] = useLandscape(info);
  const w = land ? CARD_H : CARD_W;
  const h = land ? CARD_W : CARD_H;
  return html`<div class=${cls('tcard', land && 'land', sel && 'sel', found && 'found', dragging && 'dragging', c.q > 1 && 'pile', info.foil && 'foil')} data-tcard=${c.id}
      style=${`left:${x}px;top:${y}px;width:${w}px;height:${h}px;z-index:${dragging ? 99999 : c.z};transform:rotate(${dragging ? 0 : c.r || 0}deg)`}
      title=${`${info.displayName}${c.q > 1 ? ` ×${c.q}` : ''}`} onClick=${onClick} onDblClick=${onDbl}>
    <div class="tcard-face"><${CardImage} info=${info} onOrient=${setLand} />${info.foil ? html`<i class="foil-sheen"></i>` : null}</div>
    ${c.q > 1 ? html`<span class="stack-badge">×${c.q}</span>` : null}
  </div>`;
}

function TableLayer({ t, state, d }) {
  const drag = useCtl(t.ctl);
  const lang = state.settings.lang;
  const cards = Object.values(state.table.cards).sort((a, b) => a.z - b.z);
  return html`${cards.map(c => {
    const live = drag && drag.kind === 'table' && drag.ids.includes(c.id);
    return html`<${TableCard} key=${c.id} c=${c} x=${live ? c.x + drag.dx : c.x} y=${live ? c.y + drag.dy : c.y} info=${infoFor(d, c.k, lang)}
      sel=${t.selection.has(c.id)} found=${t.found === c.id} dragging=${live} onClick=${e => t.onCardClick(c.id, e)} onDbl=${() => t.onOpenCard(infoFor(d, c.k, lang))} />`;
  })}`;
}

function GhostLayer({ t, state, d }) {
  const g = useCtl(t.ctl);
  if (!g || !g.pt || (g.kind !== 'pocket' && g.kind !== 'loose')) return null;
  const lang = state.settings.lang;
  return html`<div class="drag-ghost" style=${`left:${g.pt.x - CARD_W / 2}px;top:${g.pt.y - CARD_H / 2}px`}>
    ${g.items.slice(0, 4).map((it, i) => html`<div class="ghost-card" style=${`transform:translate(${i * 6}px,${i * 4}px) rotate(${i * 2.5 - 2}deg)`}><${CardImage} info=${infoFor(d, it.k, lang)} eager /></div>`)}
    ${g.count > 1 ? html`<span class="stack-badge">${g.count}</span>` : null}
  </div>`;
}

// Cartas que se mueven arrastrando una carpeta cerrada en la mesa
export function useBinderDrag(t) {
  const g = useCtl(t.ctl);
  return g && g.kind === 'binder' ? g : null;
}

// ---------- Lógica compartida ----------
export function useTable({ view, state, d, binder, apiRef, onOpenCard, flip, spot }) {
  const ctl = useMemo(makeCtl, []);
  const [selection, setSelection] = useState(new Set());
  const [boxSel, setBoxSel] = useState(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [boxOpen, setBoxOpen] = useState(false);
  const [found, setFoundRaw] = useState(null);
  const foundT = useRef(null);
  const setFound = id => { setFoundRaw(id); clearTimeout(foundT.current); foundT.current = setTimeout(() => setFoundRaw(null), 2800); };
  const marks = useRef([]);
  const flipTimer = useRef(null);
  const boxOrder = useRef([]);

  // La selección se limpia si las cartas dejan de estar en la mesa
  useEffect(() => {
    const ids = [...selection].filter(id => state.table.cards[id]);
    if (ids.length !== selection.size) setSelection(new Set(ids));
  }, [state.table]);

  const clearMarks = () => { marks.current.forEach(([el, c]) => el.classList.remove(c)); marks.current = []; };
  const mark = (el, c) => { if (el) { el.classList.add(c); marks.current.push([el, c]); } };

  function targetAt(e) {
    const els = document.elementsFromPoint(e.clientX, e.clientY);
    for (const el of els) {
      if (el.closest('.drag-ghost') || el.closest('.tcard.dragging') || el.closest('.closed-binder.dragging')) continue;
      const turn = el.closest('.turn');
      if (turn) return { type: 'turn', dir: turn.classList.contains('next') ? 'next' : 'prev' };
      if (el.closest('.ui-layer') || el.closest('.topbar') || el.closest('.pager')) return { type: 'ui' };
      const pk = el.closest('.pocket[data-pocket]');
      if (pk) return { type: 'pocket', idx: +pk.dataset.pocket, face: +pk.dataset.face, el: pk, sheet: pk.closest('.sheet') };
      const sh = el.closest('.sheet[data-face]');
      if (sh) return { type: 'face', face: +sh.dataset.face, el: sh };
      if (el.closest('.book')) return { type: 'book' };
      const cb = el.closest('.closed-binder[data-binder]');
      if (cb) return { type: 'binder', id: cb.dataset.binder, el: cb };
      const db = el.closest('.deckbox[data-box]');
      if (db) return { type: 'box', id: db.dataset.box, el: db };
      if (el.closest('.table-view')) return { type: 'table' };
    }
    return { type: 'none' };
  }

  // Qué se está llevando: cada unidad ocupa un bolsillo
  function unitsOf(g) {
    const s = getState();
    if (g.kind === 'table') return g.ids.map(id => s.table.cards[id]).filter(Boolean).sort(reading).map(c => ({ id: c.id, k: c.k, q: c.q }));
    if (g.kind === 'pocket') return g.items;
    if (g.kind === 'loose') {
      const dd = derive(s);
      const out = [];
      for (const k of g.keys) { const free = freeCopies(s, dd, k); for (let i = 0; i < free; i++) out.push({ k, q: 1 }); }
      return out;
    }
    return [];
  }

  function resolveDrag(target) {
    const tc = target.closest('.tcard[data-tcard]');
    if (tc) { const id = tc.dataset.tcard; return { kind: 'table', anchor: id, ids: selection.has(id) ? [...selection] : [id] }; }
    if (view === 'binder') {
      const pk = target.closest('.pocket.filled[data-pocket]');
      if (pk && !target.closest('.leaf')) return { kind: 'pocket', idx: +pk.dataset.pocket };
    }
    if (view === 'mesa') {
      const cb = target.closest('.closed-binder[data-binder]');
      if (cb) return { kind: 'binder', id: cb.dataset.binder };
      const db = target.closest('.deckbox[data-box]');
      if (db) return { kind: 'binder', id: db.dataset.box };
    }
    const bt = target.closest('.loose-tile[data-loosekey]');
    if (bt) { const k = bt.dataset.loosekey; return { kind: 'loose', keys: boxSel.has(k) ? boxOrder.current.filter(x => boxSel.has(x)) : [k] }; }
    return null;
  }

  function onDragStart(drag, w) {
    const s = getState();
    if (drag.kind === 'table') {
      let ids = drag.ids;
      if (!selection.has(drag.anchor)) { ids = [drag.anchor]; setSelection(new Set(ids)); }
      ctl.drag = { kind: 'table', ids, start: w, dx: 0, dy: 0 };
    } else if (drag.kind === 'pocket') {
      const slot = activeVersion(s.binders.find(b => b.id === binder.id)).slots[drag.idx];
      if (!slot) return;
      ctl.drag = { kind: 'pocket', idx: drag.idx, items: [{ k: slot.k, q: slot.q }], count: slot.q, pt: w };
      const el = document.querySelector(`.pocket[data-pocket="${drag.idx}"]`);
      if (el) { el.classList.add('lifting'); ctl.drag.srcEl = el; }
    } else if (drag.kind === 'loose') {
      const dd = derive(s);
      const items = drag.keys.map(k => ({ k, q: Math.max(0, freeCopies(s, dd, k)) })).filter(x => x.q > 0);
      if (!items.length) return;
      ctl.drag = { kind: 'loose', keys: items.map(x => x.k), items, count: items.reduce((n, x) => n + x.q, 0), pt: w };
    } else if (drag.kind === 'binder') {
      const p = binderLayout(s).get(drag.id);
      ctl.drag = { kind: 'binder', id: drag.id, start: w, orig: { x: p.x, y: p.y }, dx: 0, dy: 0 };
    }
    ctl.emit();
  }

  function onDragMove(w, e) {
    const g = ctl.drag;
    if (!g) return;
    if (g.kind === 'table' || g.kind === 'binder') { g.dx = w.x - g.start.x; g.dy = w.y - g.start.y; } else g.pt = w;
    clearMarks();
    if (g.kind !== 'binder') {
      const t = targetAt(e);
      if (view === 'binder' && (t.type === 'pocket' || t.type === 'face')) {
        const n = unitsOf(g).length;
        const b = getState().binders.find(x => x.id === binder.id);
        const sheet = t.type === 'pocket' ? t.sheet : t.el;
        if (n === 1 && t.type === 'pocket' && !(g.kind === 'pocket' && t.idx === g.idx)) mark(t.el, 'drop-target');
        else if (g.kind !== 'pocket') {
          mark(sheet, 'drop-face');
          emptyOnFace(b, t.face, t.type === 'pocket' ? t.idx : null).slice(0, n).forEach(idx => mark(sheet.querySelector(`.pocket[data-pocket="${idx}"]`), 'will-fill'));
        }
      }
      if (view === 'mesa' && (t.type === 'binder' || t.type === 'box')) mark(t.el, 'drop-target');
      if (t.type === 'turn' && flip) {
        if (!flipTimer.current) flipTimer.current = setTimeout(() => { flipTimer.current = null; flip(t.dir); }, 550);
      } else { clearTimeout(flipTimer.current); flipTimer.current = null; }
    }
    ctl.emit();
  }

  function fillFace(b, t, units, from) {
    const order = emptyOnFace(b, t.face, t.type === 'pocket' ? t.idx : null);
    const pairs = units.slice(0, order.length).map((u, i) => (u.id ? { id: u.id, idx: order[i] } : { k: u.k, q: u.q, idx: order[i] }));
    if (!pairs.length) { toast('No quedan bolsillos vacíos en esa página.', { kind: 'warn' }); return; }
    A.dropIntoBinder(b.id, pairs);
    const left = units.length - pairs.length;
    const where = from === 'loose' ? 'sin guardar' : 'en la mesa';
    toast(left ? `Entraron ${pairs.length} en la página ${t.face}; ${left === 1 ? `quedó 1 ${where}` : `quedaron ${left} ${where}`}.` : `${plural(pairs.length, 'carta guardada', 'cartas guardadas')} en la página ${t.face}.`, { action: { label: 'Deshacer', run: undo } });
  }

  function fillClosed(id, units, from) {
    const b = getState().binders.find(x => x.id === id);
    const order = emptyInBinder(b, units.length);
    const pairs = units.slice(0, order.length).map((u, i) => (u.id ? { id: u.id, idx: order[i] } : { k: u.k, q: u.q, idx: order[i] }));
    if (!pairs.length) { toast(`${b.name} no tiene bolsillos vacíos.`, { kind: 'warn' }); return; }
    A.dropIntoBinder(id, pairs);
    const per = b.rows * b.cols;
    const f0 = Math.floor(pairs[0].idx / per) + 1;
    const f1 = Math.floor(pairs[pairs.length - 1].idx / per) + 1;
    const left = units.length - pairs.length;
    toast(`${plural(pairs.length, 'carta guardada', 'cartas guardadas')} en ${b.name} (${f0 === f1 ? `página ${f0}` : `páginas ${f0} a ${f1}`})${left ? `; ${left} sin lugar` : ''}.`, { action: { label: 'Deshacer', run: undo } });
    void from;
  }

  function placeOnTable(keys, at) {
    const s = getState();
    const dd = derive(s);
    const items = [];
    keys.forEach((k, i) => {
      const free = freeCopies(s, dd, k);
      const x = at.x - CARD_W / 2 + (i % 8) * 84;
      const y = at.y - CARD_H / 2 + Math.floor(i / 8) * 108;
      for (let j = 0; j < free; j++) items.push({ k, q: 1, x: x + j * 8, y: y + j * 5 });
    });
    if (!items.length) { toast('Esas cartas no tienen copias libres.', { kind: 'warn' }); return; }
    A.tableAdd(items);
    setBoxSel(new Set());
  }

  function onDragEnd(w, e) {
    const g = ctl.drag;
    ctl.drag = null;
    clearMarks();
    clearTimeout(flipTimer.current);
    flipTimer.current = null;
    if (g && g.srcEl) g.srcEl.classList.remove('lifting');
    ctl.emit();
    if (!g || !w) return;
    const t = targetAt(e);
    const s = getState();
    if (g.kind === 'binder') { if (Math.hypot(g.dx, g.dy) > 2) A.binderPos(g.id, g.orig.x + g.dx, g.orig.y + g.dy); return; }
    if (g.kind === 'table') {
      const units = unitsOf(g);
      if (view === 'binder' && (t.type === 'pocket' || t.type === 'face')) {
        const b = s.binders.find(x => x.id === binder.id);
        const slots = activeVersion(b).slots;
        if (units.length === 1 && t.type === 'pocket' && slots[t.idx]) {
          const occ = slots[t.idx];
          const src = s.table.cards[units[0].id];
          A.dropIntoBinder(b.id, [{ id: units[0].id, idx: t.idx }], [{ k: occ.k, q: occ.q, x: src.x, y: src.y }], 'intercambiar con la mesa');
          return;
        }
        fillFace(b, t, units, 'table');
        return;
      }
      if (view === 'mesa' && t.type === 'binder') { fillClosed(t.id, units, 'table'); return; }
      if (view === 'mesa' && t.type === 'box') { const added = A.dropIntoBox(t.id, units.map(u => ({ id: u.id }))); afterBoxDrop(t.id, added); return; }
      if (t.type !== 'table') return; // vuelve a su lugar
      const pos = {};
      for (const id of g.ids) { const c = s.table.cards[id]; if (c) pos[id] = { x: c.x + g.dx, y: c.y + g.dy }; }
      A.tableMove(pos);
      return;
    }
    if (g.kind === 'pocket') {
      if (t.type === 'pocket') { if (t.idx !== g.idx) A.move(binder.id, g.idx, t.idx); return; }
      if (t.type === 'table') A.pocketToTable(binder.id, g.idx, w.x - CARD_W / 2, w.y - CARD_H / 2);
      return;
    }
    if (g.kind === 'loose') {
      if (view === 'mesa' && t.type === 'box') { const added = A.dropIntoBox(t.id, unitsOf(g).reduce((acc, u) => { const e = acc.find(x => x.k === u.k); if (e) e.q += u.q; else acc.push({ k: u.k, q: u.q }); return acc; }, [])); afterBoxDrop(t.id, added); setBoxSel(new Set()); return; }
      if (view === 'binder' && (t.type === 'pocket' || t.type === 'face')) { fillFace(s.binders.find(x => x.id === binder.id), t, unitsOf(g), 'loose'); setBoxSel(new Set()); return; }
      if (view === 'mesa' && t.type === 'binder') { fillClosed(t.id, unitsOf(g), 'loose'); setBoxSel(new Set()); return; }
      if (t.type === 'table') placeOnTable(g.keys, w);
    }
  }

  function onCardClick(id, e) {
    const toggle = e.shiftKey || e.ctrlKey || e.metaKey || selectMode;
    setSelection(prev => {
      if (!toggle) return new Set([id]);
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }
  function onMarquee(r, additive) {
    const s = getState();
    const hit = Object.values(s.table.cards).filter(c => c.x < r.x + r.w && c.x + CARD_W > r.x && c.y < r.y + r.h && c.y + CARD_H > r.y).map(c => c.id);
    setSelection(prev => new Set(additive ? [...prev, ...hit] : hit));
  }
  function onBackgroundTap() { if (selection.size) setSelection(new Set()); }

  // Teclado: borrar devuelve a la caja, Esc deselecciona, Ctrl+A selecciona todo
  useEffect(() => {
    const k = e => {
      if (modalOpen() || /input|textarea|select/i.test((e.target && e.target.tagName) || '')) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selection.size) { e.preventDefault(); A.tableRemove([...selection]); setSelection(new Set()); }
      else if (e.key === 'Escape' && (selection.size || selectMode)) { setSelection(new Set()); setSelectMode(false); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); setSelection(new Set(Object.keys(getState().table.cards))); }
      else if (e.key === '+' || e.key === '=') apiRef.current && apiRef.current.zoomBy(1.25);
      else if (e.key === '-') apiRef.current && apiRef.current.zoomBy(0.8);
      else if (e.key === '0') apiRef.current && apiRef.current.fit(true);
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  });

  // Centro visible de la mesa (para dejar cartas sin arrastrar)
  function viewCenter() {
    const api = apiRef.current;
    if (!api) return { x: 0, y: 0 };
    const el = api.el().getBoundingClientRect();
    return api.toWorld(el.left + el.width * 0.5, el.top + el.height * 0.5);
  }

  const where = () => (spot ? spot() : viewCenter());
  const t = {
    where, view, ctl, selection, found, setFound, setSelection, boxSel, setBoxSel, boxOpen, setBoxOpen, selectMode, setSelectMode, boxOrder,
    resolveDrag, onDragStart, onDragMove, onDragEnd, onCardClick, onMarquee, onBackgroundTap, onOpenCard, viewCenter,
    placeOnTable, fillFace, fillClosed,
  };
  t.layer = html`<${TableLayer} t=${t} state=${state} d=${d} /><${GhostLayer} t=${t} state=${state} d=${d} />`;
  return t;
}

// ---------- Controles flotantes ----------
export function Controls({ t, apiRef, centerLabel }) {
  return html`<div class="tv-controls ui-layer" role="toolbar" aria-label="Vista de la mesa">
    <button class="icon-btn" title="Acercar (rueda o +)" aria-label="Acercar" onClick=${() => apiRef.current.zoomBy(1.25)}>${Icon('plus')}</button>
    <button class="icon-btn" title="Alejar (rueda o -)" aria-label="Alejar" onClick=${() => apiRef.current.zoomBy(0.8)}>${Icon('minus')}</button>
    <button class="icon-btn" title=${centerLabel} aria-label=${centerLabel} onClick=${() => apiRef.current.fit(true)}>${Icon('focus')}</button>
    <span class="tv-sep"></span>
    <button class=${cls('icon-btn', t.selectMode && 'on')} title="Seleccionar con un recuadro (o Shift + arrastrar)" aria-label="Modo selección" aria-pressed=${t.selectMode} onClick=${() => t.setSelectMode(!t.selectMode)}>${Icon('grid')}</button>
    <button class=${cls('icon-btn', t.boxOpen && 'on')} title="Sin guardar: cartas que no están en carpetas, cajas ni en la mesa" aria-label="Cartas sin guardar" aria-pressed=${t.boxOpen} onClick=${() => t.setBoxOpen(!t.boxOpen)}>${Icon('cards')}</button>
  </div>`;
}

export function SelectionBar({ t, state, d, faces }) {
  const ids = [...t.selection].filter(id => state.table.cards[id]);
  if (!ids.length) return null;
  const cards = ids.map(id => state.table.cards[id]);
  const copies = cards.reduce((n, c) => n + c.q, 0);
  const sameKey = cards.every(c => c.k === cards[0].k);
  const one = ids.length === 1 ? cards[0] : null;
  const toFace = f => {
    const b = faces.binder;
    const units = cards.slice().sort(reading).map(c => ({ id: c.id, k: c.k, q: c.q }));
    t.fillFace(state.binders.find(x => x.id === b.id), { type: 'face', face: f }, units, 'table');
  };
  return html`<div class="sel-bar ui-layer" role="toolbar" aria-label="Cartas seleccionadas">
    <b>${ids.length === 1 ? (one.q > 1 ? `Pila de ${one.q}` : '1 carta') : `${ids.length} en la mesa${copies !== ids.length ? ` (${copies} cartas)` : ''}`}</b>
    ${faces && faces.list.map(f => html`<button class="btn sm primary" onClick=${() => toFace(f)}>A la página ${f}</button>`)}
    ${ids.length > 1 && sameKey ? html`<button class="btn sm" onClick=${() => A.tableStack(ids)}>Apilar</button>` : null}
    ${one && one.q > 1 ? html`<button class="btn sm" onClick=${() => A.tableSplit(one.id)}>Separar</button>` : null}
    ${ids.length > 1 ? html`<button class="btn sm" onClick=${() => A.tableArrange(ids)}>Ordenar en filas</button>` : null}
    ${one ? html`<button class="btn sm" onClick=${() => t.onOpenCard(infoFor(d, one.k, state.settings.lang))}>Ver ficha</button>` : null}
    ${(state.boxes || []).length ? html`<button class="btn sm" onClick=${async () => { const id = await chooseBox(state); if (id) { const added = A.dropIntoBox(id, ids.map(x => ({ id: x }))); afterBoxDrop(id, added); t.setSelection(new Set()); } }}>A una caja</button>` : null}
    <button class="btn sm" title="Vuelven a sin guardar" onClick=${() => { A.tableRemove(ids); t.setSelection(new Set()); }}>Quitar de la mesa</button>
    <button class="icon-btn" aria-label="Deseleccionar" title="Deseleccionar (Esc)" onClick=${() => t.setSelection(new Set())}>${Icon('close', 18)}</button>
  </div>`;
}

// ---------- Caja: cartas con copias sin ubicar ----------
let looseFilter = emptyFilter();
let looseSort = { id: 'price', dir: 'desc' };

export function LooseDrawer({ t, state, d, faces }) {
  const [filter, setF] = useState(looseFilter);
  const [sort, setSo] = useState(looseSort);
  const setFilter = f => { looseFilter = f; setF(f); };
  const setSort = x => { looseSort = x; setSo(x); };
  const tagsOf = useMemo(() => tagFn(state, d), [state.tags, state.chars, d]);
  const charList = deriveChars(state, d).list;
  const items = useMemo(() => d.list
    .filter(i => freeCopies(state, d, i.key) > 0 && matches(i, filter, freeCopies(state, d, i.key), tagsOf, d.where))
    .sort(comparator([sort])), [d, filter, sort, tagsOf]);
  const sets = useMemo(() => [...new Set(d.list.map(i => i.set))], [d]);
  t.boxOrder.current = items.map(i => i.key);
  const [shown, setShown] = useState(80);
  if (!t.boxOpen) return null;
  const sel = [...t.boxSel].filter(k => items.some(i => i.key === k));
  const toggle = k => t.setBoxSel(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const toFace = f => {
    const b = state.binders.find(x => x.id === faces.binder.id);
    const units = [];
    for (const k of t.boxOrder.current.filter(x => t.boxSel.has(x))) { const free = freeCopies(state, d, k); for (let i = 0; i < free; i++) units.push({ k, q: 1 }); }
    t.fillFace(b, { type: 'face', face: f }, units, 'loose');
    t.setBoxSel(new Set());
  };
  return html`<aside class="loose-drawer ui-layer" aria-label="Cartas sin guardar">
    <header class="loose-head">
      <h2>Sin guardar</h2>
      <span class="muted small">${plural(items.length, 'carta con copias libres', 'cartas con copias libres')}</span>
      <span class="grow"></span>
      <button class="icon-btn" aria-label="Cerrar sin guardar" onClick=${() => t.setBoxOpen(false)}>${Icon('close')}</button>
    </header>
    <div class="loose-filters"><${FilterBar} filter=${filter} setFilter=${setFilter} sort=${sort} setSort=${setSort} sets=${sets} chars=${charList} showStatus=${false} compact id="sin-guardar" placeholder="Buscar entre las cartas sin guardar" /></div>
    <div class="loose-list" onScroll=${e => { const el = e.currentTarget; if (el.scrollTop + el.clientHeight > el.scrollHeight - 300) setShown(n => Math.min(items.length, n + 60)); }}>
      <div class="grid small">
        ${items.slice(0, shown).map(info => {
          const free = freeCopies(state, d, info.key);
          return html`<div key=${info.key} class=${cls('loose-tile', t.boxSel.has(info.key) && 'picked')} data-loosekey=${info.key}>
            <${CardTile} info=${info} selected=${t.boxSel.has(info.key)} onClick=${() => toggle(info.key)}
              badge=${html`<span class="tile-badges"><span class="b-count">${free} libre${free === 1 ? '' : 's'}</span></span>`} />
          </div>`;
        })}
      </div>
      ${!items.length ? html`<p class="empty-note">${d.list.length ? 'Todas las cartas que coinciden ya están guardadas en carpetas, cajas o en la mesa.' : 'Tu colección está vacía.'}</p>` : null}
    </div>
    <footer class="loose-foot">
      ${sel.length ? html`
        <span class="small">${plural(sel.length, 'elegida', 'elegidas')}</span>
        <button class="btn sm primary" onClick=${() => t.placeOnTable(sel, t.where())}>A la mesa</button>
        ${faces && faces.list.map(f => html`<button class="btn sm" onClick=${() => toFace(f)}>A la página ${f}</button>`)}
        ${(state.boxes || []).length ? html`<button class="btn sm" onClick=${async () => { const id = await chooseBox(state); if (id) { const added = A.dropIntoBox(id, sel.map(k => ({ k, q: freeCopies(state, d, k) }))); afterBoxDrop(id, added); t.setBoxSel(new Set()); } }}>A una caja</button>` : null}
        <button class="link-btn" onClick=${() => t.setBoxSel(new Set())}>Limpiar</button>`
        : html`<span class="muted small">Arrastrá una carta a la mesa, a una página o a una caja, o tocá varias y elegí adónde llevarlas.</span>`}
    </footer>
  </aside>`;
}
