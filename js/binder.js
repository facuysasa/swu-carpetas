// La mesa y la carpeta abierta
import { html, useState, useEffect, useRef } from './vendor/preact-htm.js';
import { A, activeVersion, uiGet, uiSet, undo, redo, canUndo, canRedo } from './store.js';
import { cls, facesOf, capacityOf, slotPos } from './util.js';
import { Icon, CardImage, useLandscape, modalOpen, toast } from './ui.js';
import { CardPicker } from './picker.js';
import { SlotMenu, VersionsModal, OverviewModal, AutofillModal } from './panels.js';
import { TableView } from './camera.js';
import { useTable, Controls, SelectionBar, LooseDrawer, infoFor, useBinderDrag } from './table.js';
import { binderSize, binderLayout, geometry } from './geom.js';
import { pocketToBox } from './boxes.js';
export { geometry, infoFor };

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');
const FLIP_MS = 560;

// ---------- Tapa ----------
export function Cover({ binder, back = false }) {
  const c = binder.cover || {};
  const photo = !back && c.photo;
  return html`<div class=${cls('cover', back && 'cover-back')} style=${`--cover:${c.color || '#1c1c1f'}`}>
    ${photo ? html`<img class="cover-photo" src=${photo} alt="" />` : html`<div class="cover-grain"></div>`}
    ${!photo && !back ? html`<div class="cover-title">${binder.name}</div>` : null}
    ${c.strap !== false ? html`<div class="strap"></div>` : null}
    <div class="cover-light"></div>
  </div>`;
}

// ---------- Bolsillo ----------
function Pocket({ ctx, idx, slot, interactive, face }) {
  const info = slot ? infoFor(ctx.d, slot.k, ctx.lang) : null;
  const [land, setLand] = useLandscape(info);
  const conflict = !!(info && ctx.d.conflicts.has(info.key));
  return html`<div
    class=${cls('pocket', slot && 'filled', ctx.found === idx && 'found', ctx.moveFrom === idx && 'lifted', interactive && ctx.moveFrom != null && ctx.moveFrom !== idx && 'target', ctx.justPlaced === idx && 'drop-in', conflict && 'conflict')}
    data-pocket=${interactive ? idx : null} data-face=${interactive ? face : null}
    role=${interactive ? 'button' : null}
    tabindex=${interactive ? 0 : -1}
    title=${info ? `${info.displayName}${info.displaySub ? ', ' + info.displaySub : ''}` : null}
    aria-label=${info ? `${info.displayName}${slot.q > 1 ? `, ${slot.q} copias` : ''}` : 'Bolsillo vacío'}
    onClick=${interactive ? () => ctx.onPocket(idx) : null}
    onKeyDown=${interactive ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ctx.onPocket(idx); } } : null}>
    ${info ? html`<div class=${cls('pcard', land && 'land', info.foil && 'foil', info.missing && 'missing')}>
      <${CardImage} info=${info} onOrient=${setLand} />
      ${info.foil ? html`<i class="foil-sheen"></i>` : null}
    </div>` : null}
    ${slot && slot.q > 1 ? html`<span class="stack-badge">×${slot.q}</span>` : null}
    ${conflict ? html`<span class="conflict-badge" title="Está ubicada más veces de las copias que tenés">!</span>` : null}
    <i class="film"></i>
  </div>`;
}

function Sheet({ ctx, face, interactive, className }) {
  const per = ctx.binder.rows * ctx.binder.cols;
  const start = (face - 1) * per;
  const cells = [];
  for (let p = 0; p < per; p++) {
    const idx = start + p;
    cells.push(html`<${Pocket} key=${idx} ctx=${ctx} idx=${idx} slot=${ctx.slots[idx]} interactive=${interactive} face=${face} />`);
  }
  return html`<div class=${cls('sheet', className)} data-face=${interactive ? face : null}>
    <div class="pockets">${cells}</div>
    <span class=${cls('folio', face % 2 ? 'odd' : 'even')}>${face}</span>
  </div>`;
}

function HalfContent({ ctx, content, side, interactive }) {
  if (content === 'cover' || content === 'back-cover') return html`<${Cover} binder=${ctx.binder} back=${content === 'back-cover'} />`;
  if (content === 'in-front' || content === 'in-back') return html`<div class=${cls('board', side)}><div class="inside-cover"></div></div>`;
  return html`<div class=${cls('board', side)}></div><${Sheet} ctx=${ctx} face=${content} interactive=${interactive} />`;
}

function Half({ ctx, content, side, interactive, stack }) {
  if (content == null) return html`<div class=${cls('half', side, 'empty')}></div>`;
  const kind = typeof content === 'number' ? 'page' : content.includes('cover') && !content.startsWith('in') ? 'is-cover' : 'is-inside';
  return html`<div class=${cls('half', side, kind)} style=${stack ? `--stack:${stack}px` : null}>
    <${HalfContent} ctx=${ctx} content=${content} side=${side} interactive=${interactive} />
  </div>`;
}

function Leaf({ ctx, flip, onEnd }) {
  const side0 = flip.dir === 'next' ? 'right' : 'left';
  const side1 = flip.dir === 'next' ? 'left' : 'right';
  const face = (content, side) => (flip.kind === 'sheet'
    ? html`<${Sheet} ctx=${ctx} face=${content} interactive=${false} className="in-leaf" />`
    : html`<div class=${cls('leaf-half', side)}><${HalfContent} ctx=${ctx} content=${content} side=${side} interactive=${false} /></div>`);
  return html`<div class=${cls('leaf', flip.dir, flip.kind, flip.go && 'go')}
      onTransitionEnd=${e => { if (e.target === e.currentTarget && e.propertyName === 'transform') onEnd(); }}>
    <div class="leaf-face leaf-front">${face(flip.front, side0)}</div>
    <div class="leaf-face leaf-back">${face(flip.back, side1)}</div>
  </div>`;
}

// ---------- Carpetas cerradas sobre la mesa ----------
export function ClosedBinders({ state, d, t, onOpen, onNew }) {
  const drag = useBinderDrag(t);
  const layout = binderLayout(state);
  return html`${state.binders.map((b, i) => {
    const p = layout.get(b.id);
    const sz = binderSize(b);
    const live = drag && drag.id === b.id;
    const x = live ? drag.orig.x + drag.dx : p.x;
    const y = live ? drag.orig.y + drag.dy : p.y;
    const filled = d.filled.get(b.id) || 0;
    return html`<div key=${b.id} class=${cls('closed-binder', live && 'dragging')} data-binder=${b.id} role="button" tabindex="0"
        aria-label=${`Abrir ${b.name}`} style=${`left:${x}px;top:${y}px;width:${sz.halfW}px;height:${sz.h}px;--fw:${sz.fw}px;--tilt:${[-1.4, 1.1, -0.6, 1.6, -1][i % 5]}deg`}
        onClick=${() => onOpen(b.id)} onKeyDown=${e => { if (e.key === 'Enter') onOpen(b.id); }}>
      <div class="cb-book"><${Cover} binder=${b} /><div class="cb-spine"></div></div>
      <div class="cb-label"><b>${b.name}</b><span>${filled} de ${capacityOf(b)} bolsillos${b.versions.length > 1 ? ` · ${activeVersion(b).name}` : ''}</span></div>
    </div>`;
  })}
  <div class="closed-binder new" role="button" tabindex="0" aria-label="Nueva carpeta" style=${`left:${layout.newSlot.x}px;top:${layout.newSlot.y}px;width:${layout.newSlot.w}px;height:${layout.newSlot.h}px`}
      onClick=${onNew} onKeyDown=${e => { if (e.key === 'Enter') onNew(); }}>
    <div class="cb-book ghost">${Icon('plus', 30)}<span>Nueva carpeta</span></div>
  </div>`;
}

// ---------- Carpeta abierta sobre la mesa ----------
export function BinderView({ state, d, binder, onBack, onSwitch, onCard, gotoSlot, clearGoto, onEditBinder }) {
  const S = binder.sheets;
  const faces = facesOf(binder);
  const slots = activeVersion(binder).slots;
  const L = s => (s <= -1 ? null : s === 0 ? 'in-front' : s >= S + 1 ? 'back-cover' : 2 * s);
  const R = s => (s <= -1 ? 'cover' : s > S ? null : s === S ? 'in-back' : 2 * s + 1);

  const saved = uiGet('pos:' + binder.id, null);
  const [spread, setSpread] = useState(-1);
  const [side, setSide] = useState('R');
  const [flip, setFlip] = useState(null);
  const flipRef = useRef(null);
  flipRef.current = flip;
  const [fadeKey, setFadeKey] = useState(0);
  const [focusPrefs, setFocusPrefs] = useState({ portrait: uiGet('focus:portrait', null), landscape: uiGet('focus:landscape', null) });
  const [moveFrom, setMoveFrom] = useState(null);
  const [justPlaced, setJustPlaced] = useState(null);
  const [picker, setPicker] = useState(null);
  const [menu, setMenu] = useState(null);
  const [panel, setPanel] = useState(null);
  const [vp, setVp] = useState({ w: 0, h: 0 });
  const apiRef = useRef(null);

  const portrait = vp.w > 0 && vp.w < vp.h * 1.1;
  const orient = portrait ? 'portrait' : 'landscape';
  const focus = focusPrefs[orient] ?? portrait;
  const open = spread >= 0 && spread <= S;

  useEffect(() => { setSpread(-1); setSide('R'); setFlip(null); setMoveFrom(null); setPicker(null); setMenu(null); }, [binder.id]);
  useEffect(() => { if (open) uiSet('pos:' + binder.id, { spread, side }); }, [spread, side, binder.id]);
  const [found, setFound] = useState(null);
  // Ir a un bolsillo pedido desde la colección: se abre en esa página y el bolsillo titila
  useEffect(() => {
    if (!gotoSlot) return undefined;
    jumpToFace(gotoSlot.face);
    setFound(gotoSlot.idx);
    clearGoto && clearGoto();
    const tm = setTimeout(() => setFound(null), 3200);
    return () => clearTimeout(tm);
  }, [gotoSlot]);
  useEffect(() => { if (justPlaced == null) return undefined; const tm = setTimeout(() => setJustPlaced(null), 450); return () => clearTimeout(tm); }, [justPlaced]);

  function jumpToFace(f) {
    const ff = Math.max(1, Math.min(faces, f));
    setFlip(null);
    setSpread(Math.floor(ff / 2));
    setSide(ff % 2 ? 'R' : 'L');
    setFadeKey(k => k + 1);
  }
  function jumpToSpread(s) {
    setFlip(null);
    setSpread(s);
    setSide(s === 0 ? 'R' : 'L');
    setFadeKey(k => k + 1);
  }
  function startFlip(dir) {
    const from = spread;
    const to = dir === 'next' ? spread + 1 : spread - 1;
    if (to < -1 || to > S + 1) return;
    if (REDUCED.matches) { setSpread(to); setSide(dir === 'next' ? 'L' : 'R'); return; }
    const front = dir === 'next' ? R(from) : L(from);
    const back = dir === 'next' ? L(to) : R(to);
    const kind = typeof front === 'number' && typeof back === 'number' ? 'sheet' : 'board';
    setFlip({ dir, from, to, front, back, kind, go: false });
  }
  useEffect(() => {
    if (!flip || flip.go) return undefined;
    let r2;
    const r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => setFlip(f => (f ? { ...f, go: true } : f))); });
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); };
  }, [flip && flip.go, flip && flip.to]);
  useEffect(() => {
    if (!flip || !flip.go) return undefined;
    const tm = setTimeout(endFlip, FLIP_MS + 120);
    return () => clearTimeout(tm);
  }, [flip && flip.go]);
  function endFlip() {
    const f = flipRef.current;
    if (!f) return;
    flipRef.current = null;
    setSpread(f.to);
    setSide(f.dir === 'next' ? 'L' : 'R');
    setFlip(null);
  }

  const focusFace = () => {
    if (spread <= -1 || spread >= S + 1) return null;
    const l = L(spread);
    const r = R(spread);
    if (typeof l !== 'number') return r;
    if (typeof r !== 'number') return l;
    return side === 'L' ? l : r;
  };
  function next() {
    if (flipRef.current) return;
    if (!focus || spread === -1) { startFlip('next'); return; }
    const f = focusFace();
    if (f == null) return;
    if (f % 2 === 0 && f < faces) { setSide('R'); return; } // de la página izquierda a la derecha, sin girar
    startFlip('next');
  }
  function prev() {
    if (flipRef.current) return;
    if (!focus || spread === S + 1) { startFlip('prev'); return; }
    const f = focusFace();
    if (f == null) return;
    if (f % 2 === 1 && f > 1) { setSide('L'); return; }
    startFlip('prev');
  }

  function onPocket(idx) {
    if (moveFrom != null) {
      if (idx !== moveFrom) { A.move(binder.id, moveFrom, idx); setJustPlaced(idx); }
      setMoveFrom(null);
      return;
    }
    if (slots[idx]) setMenu(idx); else setPicker(idx);
  }

  const t = useTable({
    view: 'binder', state, d, binder, apiRef, onOpenCard: onCard, flip: dir => (dir === 'next' ? next() : prev()),
    spot: () => { const sz = binderSize(binder); const p = binderLayout(state).get(binder.id); return { x: p.x + sz.halfW + 90, y: p.y + 70 }; },
  });

  useEffect(() => {
    const k = e => {
      if (modalOpen() || picker != null || menu != null || panel) return;
      if (/input|select|textarea/i.test((e.target && e.target.tagName) || '')) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
      else if (e.key === 'Escape' && moveFrom != null) setMoveFrom(null);
      else if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey) toggleFocus();
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  });

  function toggleFocus() {
    const nf = !focus;
    setFocusPrefs(p => ({ ...p, [orient]: nf }));
    uiSet('focus:' + orient, nf);
  }

  // Ubicación de la carpeta en la mesa y qué encuadrar
  const size = binderSize(binder);
  const pos = binderLayout(state).get(binder.id);
  const bookX = pos.x - size.halfW;
  const bookY = pos.y;
  const half = sd => ({ x: sd === 'L' ? bookX : pos.x, y: bookY, w: size.halfW, h: size.h });
  const shownSpread = flip ? flip.to : spread;
  let fitRect;
  let fitToken;
  if (shownSpread <= -1) { fitRect = half('R'); fitToken = 'cerrada'; }
  else if (shownSpread >= S + 1) { fitRect = half('L'); fitToken = 'contratapa'; }
  else if (focus) {
    const f = flip ? (flip.dir === 'next' ? (typeof L(flip.to) === 'number' ? L(flip.to) : R(flip.to)) : R(flip.to)) : focusFace();
    const sd = f != null && f % 2 === 0 ? 'L' : 'R';
    fitRect = half(sd);
    fitToken = 'foco' + f;
  } else { fitRect = { x: bookX, y: bookY, w: size.halfW * 2, h: size.h }; fitToken = 'abierta'; }
  fitToken = `${binder.id}|${binder.sheets}x${binder.rows}x${binder.cols}|${fitToken}`;

  const ctx = { binder, slots, d, lang: state.settings.lang, moveFrom, justPlaced, onPocket, found };

  let leftC;
  let rightC;
  if (flip) {
    if (flip.dir === 'next') { leftC = L(flip.from); rightC = R(flip.to); } else { leftC = L(flip.to); rightC = R(flip.from); }
  } else { leftC = L(spread); rightC = R(spread); }
  const turned = Math.max(0, Math.min(S, flip ? Math.min(flip.from, flip.to) : spread));
  const stackL = Math.round((turned / S) * 7);
  const stackR = Math.round(((S - turned) / S) * 7);
  const closedFront = !flip && spread === -1;
  const closedBack = !flip && spread === S + 1;

  const label = (() => {
    if (focus) { const f = focusFace(); if (f == null) return spread <= -1 ? 'Tapa' : 'Contratapa'; return `Página ${f} de ${faces}`; }
    if (spread <= -1) return 'Tapa';
    if (spread >= S + 1) return 'Contratapa';
    const l = L(spread);
    const r = R(spread);
    if (typeof l !== 'number') return `Página ${r} de ${faces}`;
    if (typeof r !== 'number') return `Página ${l} de ${faces}`;
    return `Páginas ${l} y ${r} de ${faces}`;
  })();
  const visible = flip ? [] : focus ? [focusFace()].filter(x => typeof x === 'number') : [L(spread), R(spread)].filter(x => typeof x === 'number');
  const sliderVal = focus ? (focusFace() || (spread <= -1 ? 1 : faces)) : Math.max(0, Math.min(S, spread));
  const moving = moveFrom != null && slots[moveFrom] ? infoFor(d, slots[moveFrom].k, state.settings.lang) : null;
  const version = activeVersion(binder);
  const filled = d.filled.get(binder.id) || 0;

  function toTable(idx) {
    const n = Object.keys(state.table.cards).length;
    A.pocketToTable(binder.id, idx, bookX + size.halfW * 2 + 40 + (n % 3) * 74, bookY + 20 + (Math.floor(n / 3) % 4) * 96);
    toast('La carta quedó en la mesa, a la derecha de la carpeta.', { action: { label: 'Deshacer', run: undo } });
  }

  const overlay = html`
    ${moving ? html`<div class="move-banner ui-layer" role="status">
      <span>Tocá el bolsillo de destino para <b>${moving.displayName}</b>. Si está ocupado, se intercambian.</span>
      <button class="btn sm" onClick=${() => setMoveFrom(null)}>Cancelar</button>
    </div>` : null}
    ${closedFront ? html`<div class="open-hint ui-layer">
      ${saved && saved.spread > 0 ? html`<button class="btn sm" onClick=${() => jumpToSpread(Math.min(saved.spread, S))}>Seguir donde estabas</button>` : null}
      <button class="btn sm primary" onClick=${next}>Abrir la carpeta</button>
    </div>` : null}
    <${Controls} t=${t} apiRef=${apiRef} centerLabel="Centrar en la carpeta" />
    <${SelectionBar} t=${t} state=${state} d=${d} faces=${{ binder, list: visible }} />
    <${LooseDrawer} t=${t} state=${state} d=${d} faces=${{ binder, list: visible }} />`;

  return html`<div class="binder-screen">
    <header class="topbar">
      <button class="btn ghost back" onClick=${onBack} aria-label="Volver a la mesa">${Icon('back', 20)}<span class="hide-sm">Mesa</span></button>
      <div class="binder-switch">
        <select aria-label="Carpeta" value=${binder.id} onChange=${e => onSwitch(e.currentTarget.value)}>
          ${state.binders.map(b => html`<option value=${b.id}>${b.name}</option>`)}
        </select>
        <span class="muted hide-sm">${filled} de ${capacityOf(binder)}</span>
      </div>
      <button class="btn ghost version-btn" onClick=${() => setPanel('versions')} title="Versiones de esta carpeta">${Icon('layers', 18)}<span>${version.name}</span></button>
      <div class="grow"></div>
      <div class="tools">
        <button class="icon-btn" title="Vista general" aria-label="Vista general" onClick=${() => setPanel('overview')}>${Icon('map')}</button>
        <button class="btn ghost" title="Ordenar automáticamente" onClick=${() => setPanel('autofill')}>${Icon('wand', 18)}<span class="hide-sm">Ordenar</span></button>
        <button class=${cls('icon-btn', focus && 'on')} title=${focus ? 'Ver las dos páginas' : 'Ver una sola página'} aria-label="Modo foco" onClick=${toggleFocus}>${Icon(focus ? 'spread' : 'focus')}</button>
        <button class="icon-btn" title="Deshacer" aria-label="Deshacer" disabled=${!canUndo()} onClick=${() => { const l = undo(); if (l) toast(`Deshiciste: ${l}`); }}>${Icon('undo')}</button>
        <button class="icon-btn hide-xs" title="Rehacer" aria-label="Rehacer" disabled=${!canRedo()} onClick=${() => { const l = redo(); if (l) toast(`Rehiciste: ${l}`); }}>${Icon('redo')}</button>
        <button class="icon-btn" title="Editar carpeta" aria-label="Editar carpeta" onClick=${onEditBinder}>${Icon('edit')}</button>
      </div>
    </header>

    <${TableView} className="stage" camKey=${'carpeta:' + binder.id} fitRect=${fitRect} fitToken=${fitToken} apiRef=${apiRef} onSize=${setVp}
      selectMode=${t.selectMode} resolveDrag=${t.resolveDrag} onDragStart=${t.onDragStart} onDragMove=${t.onDragMove} onDragEnd=${t.onDragEnd}
      onMarquee=${t.onMarquee} onBackgroundTap=${t.onBackgroundTap} overlay=${overlay}>
      <div class="book-anchor" style=${`left:${bookX}px;top:${bookY}px;${size.vars}`}>
        <div key=${fadeKey} class=${cls('book', flip && 'flipping', !flip && 'fade-in')}>
          <${Half} ctx=${ctx} content=${leftC} side="left" interactive=${!flip && typeof leftC === 'number'} stack=${typeof leftC === 'number' ? stackL : 0} />
          <${Half} ctx=${ctx} content=${rightC} side="right" interactive=${!flip && typeof rightC === 'number'} stack=${typeof rightC === 'number' ? stackR : 0} />
          ${flip ? html`<${Leaf} ctx=${ctx} flip=${flip} onEnd=${endFlip} />` : null}
          ${closedFront ? html`<button class="cover-hit right" aria-label="Abrir la carpeta" onClick=${next}></button>` : null}
          ${closedBack ? html`<button class="cover-hit left" aria-label="Volver a abrir" onClick=${prev}></button>` : null}
        </div>
      </div>
      ${t.layer}
    <//>

    <footer class="pager">
      <button class="turn prev" aria-label="Página anterior" disabled=${spread <= -1 && !flip} onClick=${prev}>${Icon('prev', 26)}</button>
      <div class="pager-mid">
        <input type="range" aria-label="Ir a la página" min=${focus ? 1 : 0} max=${focus ? faces : S} value=${sliderVal}
          onInput=${e => { const v = +e.currentTarget.value; if (focus) jumpToFace(v); else jumpToSpread(v); }} />
        <button class="page-label" onClick=${() => setPanel('overview')}>${label}</button>
      </div>
      <button class="turn next" aria-label="Página siguiente" disabled=${spread >= S + 1 && !flip} onClick=${next}>${Icon('next', 26)}</button>
    </footer>

    ${picker != null ? html`<${CardPicker} state=${state} d=${d} binder=${binder} idx=${picker}
      onClose=${() => setPicker(null)} onPlaced=${i => setJustPlaced(i)} onTarget=${i => { setPicker(i); const f = slotPos(binder, i).face; if (!visible.includes(f)) jumpToFace(f); }} />` : null}
    ${menu != null && slots[menu] ? html`<${SlotMenu} state=${state} d=${d} binder=${binder} idx=${menu} onClose=${() => setMenu(null)}
      onMove=${() => { setMoveFrom(menu); setMenu(null); }}
      onReplace=${() => { setPicker(menu); setMenu(null); }}
      onToTable=${() => { const i = menu; setMenu(null); toTable(i); }}
      onToBox=${() => { const i = menu; setMenu(null); pocketToBox(state, binder.id, i); }}
      onDetail=${info => { setMenu(null); onCard(info); }} />` : null}
    ${panel === 'versions' ? html`<${VersionsModal} state=${state} d=${d} binder=${binder} onClose=${() => setPanel(null)} />` : null}
    ${panel === 'overview' ? html`<${OverviewModal} state=${state} d=${d} binder=${binder} current=${focus ? Math.floor((focusFace() || 1) / 2) : spread}
      onPick=${s => { setPanel(null); jumpToSpread(s); }} onClose=${() => setPanel(null)} />` : null}
    ${panel === 'autofill' ? html`<${AutofillModal} state=${state} d=${d} binder=${binder} onClose=${() => setPanel(null)}
      onApplied=${() => { setPanel(null); if (spread < 0) jumpToSpread(0); }} />` : null}
  </div>`;
}
