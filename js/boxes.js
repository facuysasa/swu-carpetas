// Cajas de mazo: se paran sobre la mesa, guardan cartas sin orden de bolsillos y tienen capacidad.
import { html, useState, useMemo } from './vendor/preact-htm.js';
import { A, freeCopies, getState, undo, activeVersion } from './store.js';
import { cls, plural, money, slotPos, resizeImage } from './util.js';
import { Modal, Icon, CardTile, Toggle, ask, toast } from './ui.js';
import { FilterBar } from './filters.js';
import { matches, comparator, emptyFilter, tagFn } from './autofill.js';
import { deriveChars } from './chars.js';
import { boxSize, binderLayout } from './geom.js';
import { infoFor, useBinderDrag } from './table.js';

export const BOX_COLORS = [
  { color: '#1d3b5c', label: 'Azul' },
  { color: '#5a1217', label: 'Rojo' },
  { color: '#1f3d2a', label: 'Verde' },
  { color: '#6b4f12', label: 'Dorado' },
  { color: '#3a3d42', label: 'Gris' },
  { color: '#1c1c1f', label: 'Negro' },
  { color: '#e9e4d8', label: 'Blanco' },
];
export const BOX_CAPS = [60, 80, 100, 120];

export const boxUsed = box => Object.values(box.cards || {}).reduce((n, q) => n + q, 0);

// ---------- Dónde está cada copia (para la colección y la ficha) ----------
export function whereParts(state, d, info) {
  const out = [];
  for (const l of d.locs.get(info.key) || []) {
    if (l.b === 'mesa') out.push({ t: 'mesa', text: 'En la mesa', q: l.q, go: { type: 'mesa', id: l.id } });
    else if (l.b === 'caja') {
      const bx = (state.boxes || []).find(x => x.id === l.box);
      out.push({ t: 'caja', text: `Caja ${bx ? bx.name : ''}`, q: l.q, go: { type: 'caja', box: l.box } });
    } else {
      const b = state.binders.find(x => x.id === l.b);
      if (!b) continue;
      const p = slotPos(b, l.idx);
      out.push({ t: 'carpeta', text: `${b.name} · pág. ${p.face} · bolsillo ${p.n}`, long: `${b.name}, página ${p.face}, bolsillo ${p.n} (fila ${p.row + 1}, columna ${p.col + 1})`, q: l.q, go: { type: 'slot', b: l.b, face: p.face, idx: l.idx } });
    }
  }
  const free = info.count - (d.assigned.get(info.key) || 0);
  if (free > 0) out.push({ t: 'libre', text: 'Sin guardar', q: free });
  return out;
}

export function WhereLine({ parts }) {
  if (!parts.length) return null;
  const p = parts[0];
  return html`<span class=${cls('where', 'w-' + p.t)}><i></i>${p.text}${p.q > 1 ? ` ×${p.q}` : ''}${parts.length > 1 ? ` · +${parts.length - 1}` : ''}</span>`;
}

// Elegir una caja (para guardar desde un bolsillo, la mesa o lo sin guardar)
export async function chooseBox(state, title = 'Guardar en una caja') {
  const boxes = state.boxes || [];
  if (!boxes.length) { toast('Todavía no tenés cajas: creá una desde la mesa.', { kind: 'warn' }); return null; }
  if (boxes.length === 1) return boxes[0].id;
  return ask({
    title,
    body: html`<p>Elegí la caja.</p>`,
    buttons: [...boxes.slice(0, 8).map(b => ({ label: `${b.name} (${boxUsed(b)}/${b.cap})`, value: b.id })), { label: 'Cancelar', value: null, kind: 'ghost' }],
  });
}

export function afterBoxDrop(boxId, added) {
  const b = (getState().boxes || []).find(x => x.id === boxId);
  if (!b) return;
  const used = boxUsed(b);
  toast(`${plural(added, 'carta guardada', 'cartas guardadas')} en la caja ${b.name}${used > b.cap ? ` · se pasó de su capacidad (${used}/${b.cap})` : ''}.`, { kind: used > b.cap ? 'warn' : 'info', action: { label: 'Deshacer', run: undo } });
}

// ---------- Cajas sobre la mesa ----------
export function DeckBoxes({ state, d, t, onOpenBox, onNewBox }) {
  const drag = useBinderDrag(t);
  const layout = binderLayout(state);
  return html`${(state.boxes || []).map(bx => {
    const p = layout.get(bx.id);
    const s = boxSize(bx);
    const live = drag && drag.id === bx.id;
    const x = live ? drag.orig.x + drag.dx : p.x;
    const y = live ? drag.orig.y + drag.dy : p.y;
    const used = d.boxUsed.get(bx.id) || 0;
    const light = bx.color === '#e9e4d8';
    return html`<div key=${bx.id} class=${cls('deckbox', live && 'dragging', used > bx.cap && 'over', light && 'light')} data-box=${bx.id} role="button" tabindex="0"
        aria-label=${`Abrir la caja ${bx.name}`} onClick=${() => onOpenBox(bx.id)} onKeyDown=${e => { if (e.key === 'Enter') onOpenBox(bx.id); }}
        style=${`left:${x}px;top:${y}px;width:${s.w}px;height:${s.h}px;--c:${bx.color};--W:${s.W}px;--H:${s.H}px;--sw:${s.sideW}px;--th:${s.topH}px;--skx:${s.skx.toFixed(2)}deg;--sky:${s.sky.toFixed(2)}deg`}>
      <div class="db-shadow"></div>
      <div class="db-side"></div>
      <div class="db-top"><span class="db-label">${bx.name}</span></div>
      <div class="db-front">
        ${bx.photo ? html`<img src=${bx.photo} alt="" draggable=${false} />` : html`<div class="db-art"></div>`}
        <span class="db-count">${used}/${bx.cap}</span>
      </div>
      <div class="cb-label db-under"><b>${bx.name}</b><span>${plural(used, 'carta', 'cartas')} de ${bx.cap}</span></div>
    </div>`;
  })}
  <div class="deckbox-new" role="button" tabindex="0" aria-label="Nueva caja" onClick=${onNewBox} onKeyDown=${e => { if (e.key === 'Enter') onNewBox(); }}
    style=${`left:${layout.newBox.x}px;top:${layout.newBox.y}px;width:${layout.newBox.w}px;height:${layout.newBox.h}px`}>
    ${Icon('plus', 22)}<span>Nueva caja</span>
  </div>`;
}

// ---------- Contenido de una caja ----------
let boxSort = { id: 'price', dir: 'desc' };

export function BoxModal({ state, d, boxId, onClose, onEdit, onCard }) {
  const box = (state.boxes || []).find(b => b.id === boxId);
  const [filter, setFilter] = useState(emptyFilter());
  const [sort, setSortRaw] = useState(boxSort);
  const [adding, setAdding] = useState(false);
  const setSort = s => { boxSort = s; setSortRaw(s); };
  const lang = state.settings.lang;
  const tagsOf = useMemo(() => tagFn(state, d), [state.tags, state.chars, d]);
  if (!box) return null;
  const used = boxUsed(box);
  const entries = Object.entries(box.cards).map(([k, q]) => ({ info: infoFor(d, k, lang), q }))
    .filter(e => matches(e.info, filter, 1, tagsOf, d.where))
    .sort((a, b) => comparator([sort])(a.info, b.info));
  const value = Object.entries(box.cards).reduce((n, [k, q]) => n + ((d.infos.get(k) || {}).price || 0) * q, 0);
  function toTable(k) {
    const p = binderLayout(getState()).get(box.id);
    const n = Object.keys(getState().table.cards).length;
    A.boxToTable(box.id, k, box.cards[k], p.x + p.w + 50 + (n % 3) * 74, p.y + (Math.floor(n / 3) % 4) * 96);
    toast('Quedó en la mesa, al lado de la caja.', { action: { label: 'Deshacer', run: undo } });
  }
  async function empty() {
    const ok = await ask({ title: 'Vaciar la caja', body: html`<p>Las ${used} cartas de <b>${box.name}</b> pasan a "sin guardar".</p>`, buttons: [{ label: 'Vaciar', value: true, kind: 'danger' }, { label: 'Cancelar', value: false, kind: 'ghost' }] });
    if (ok) A.boxEmpty(box.id);
  }
  if (adding) return html`<${AddToBox} state=${state} d=${d} box=${box} onClose=${() => setAdding(false)} />`;
  return html`<${Modal} title=${`Caja ${box.name}`} size="xl" className="box-modal" onClose=${onClose}
    head=${html`<span class=${cls('picker-where', used > box.cap && 'warn-text')}>${used} de ${box.cap} cartas${state.settings.prices && value ? ` · ${money(value)}` : ''}</span>`}>
    <div class="cap-bar" aria-hidden="true"><i style=${`width:${Math.min(100, (used / box.cap) * 100)}%`} class=${used > box.cap ? 'over' : ''}></i></div>
    <div class="row-btns">
      <button class="btn primary" onClick=${() => setAdding(true)}>${Icon('plus', 18)} Agregar cartas</button>
      <button class="btn" onClick=${onEdit}>${Icon('edit', 18)} Editar caja</button>
      ${used ? html`<button class="btn danger-ghost" onClick=${empty}>Vaciar</button>` : null}
    </div>
    ${used ? html`<${FilterBar} filter=${filter} setFilter=${setFilter} sort=${sort} setSort=${setSort} chars=${deriveChars(state, d).list} showStatus=${false} compact id="caja-contenido" placeholder="Buscar en la caja" />` : null}
    ${entries.length ? html`<div class="grid">
      ${entries.map(({ info, q }) => html`<div key=${info.key} class="box-entry">
        <${CardTile} info=${info} onClick=${() => onCard(info)} badge=${html`<span class="tile-badges">${state.settings.prices && info.price != null ? html`<span class="b-price">${money(info.price)}</span>` : null}<span class="b-count">×${q}</span></span>`} />
        <div class="entry-btns">
          <button class="btn sm" title="Sacar una copia (queda sin guardar)" onClick=${() => A.boxTake(box.id, info.key, 1)}>${Icon('minus', 16)} Sacar</button>
          <button class="btn sm" title="Llevar a la mesa" onClick=${() => toTable(info.key)}>A la mesa</button>
        </div>
      </div>`)}
    </div>` : html`<div class="empty-note">${used ? 'Ninguna carta de la caja coincide con esos filtros.' : 'La caja está vacía. Agregá cartas, arrastralas desde la mesa o desde "Sin guardar", o mandalas desde un bolsillo.'}</div>`}
  <//>`;
}

// ---------- Agregar cartas sin guardar a una caja ----------
export function AddToBox({ state, d, box, onClose }) {
  const [filter, setFilter] = useState(emptyFilter());
  const [sort, setSort] = useState({ id: 'name', dir: 'asc' });
  const [pick, setPick] = useState({});
  const tagsOf = useMemo(() => tagFn(state, d), [state.tags, state.chars, d]);
  const items = useMemo(() => d.list.filter(i => freeCopies(state, d, i.key) > 0 && matches(i, filter, freeCopies(state, d, i.key), tagsOf, d.where)).sort(comparator([sort])), [d, filter, sort, tagsOf]);
  const total = Object.values(pick).reduce((n, q) => n + q, 0);
  const used = boxUsed(box);
  const set = (k, q) => setPick(p => { const n = { ...p }; if (q > 0) n[k] = q; else delete n[k]; return n; });
  function save() {
    const added = A.dropIntoBox(box.id, Object.entries(pick).map(([k, q]) => ({ k, q })));
    afterBoxDrop(box.id, added);
    onClose();
  }
  return html`<${Modal} title=${`Agregar a la caja ${box.name}`} size="xl" className="picker" onClose=${onClose}
    head=${html`<span class=${cls('picker-where', used + total > box.cap && 'warn-text')}>${used + total} de ${box.cap}</span>`}
    footer=${html`<span class="muted small">Tocá una carta para sumar una copia; con − la sacás.</span><span class="grow"></span>
      <button class="btn ghost" onClick=${onClose}>Cancelar</button>
      <button class="btn primary" disabled=${!total} onClick=${save}>Guardar ${plural(total, 'carta', 'cartas')}</button>`}>
    <${FilterBar} filter=${filter} setFilter=${setFilter} sort=${sort} setSort=${setSort} sets=${[...new Set(d.list.map(i => i.set))]} chars=${deriveChars(state, d).list} showStatus=${false} compact id="caja-agregar" placeholder="Buscar entre las cartas sin guardar" />
    <div class="grid">
      ${items.slice(0, 240).map(info => {
        const free = freeCopies(state, d, info.key);
        const q = pick[info.key] || 0;
        return html`<div key=${info.key} class="box-entry">
          <${CardTile} info=${info} selected=${q > 0} onClick=${() => set(info.key, Math.min(free, q + 1))}
            badge=${html`<span class="tile-badges"><span class="b-count">${q ? `${q} de ${free}` : `${free} libre${free === 1 ? '' : 's'}`}</span></span>`} />
          ${q ? html`<div class="entry-btns"><button class="btn sm" onClick=${() => set(info.key, q - 1)}>${Icon('minus', 16)}</button><button class="btn sm" disabled=${q >= free} onClick=${() => set(info.key, q + 1)}>${Icon('plus', 16)}</button></div>` : null}
        </div>`;
      })}
    </div>
    ${!items.length ? html`<div class="empty-note">No hay cartas sin guardar que coincidan.</div>` : null}
  <//>`;
}

// ---------- Crear / editar caja ----------
export function BoxEditor({ state, box, onClose, onCreated }) {
  const isNew = !box;
  const [f, setF] = useState({ name: box ? box.name : `Caja ${(state.boxes || []).length + 1}`, cap: box ? box.cap : 80, color: box ? box.color : BOX_COLORS[0].color, photo: box ? box.photo : null });
  const up = p => setF({ ...f, ...p });
  const used = box ? boxUsed(box) : 0;
  async function onPhoto(e) {
    const file = e.currentTarget.files && e.currentTarget.files[0];
    if (!file) return;
    try { up({ photo: await resizeImage(file, 420, 0.8) }); } catch { toast('No pude leer esa imagen.', { kind: 'warn' }); }
  }
  function save() {
    const spec = { name: f.name.trim() || 'Caja', cap: Math.max(10, Math.min(1000, +f.cap || 80)), color: f.color, photo: f.photo };
    if (isNew) { const id = A.addBox(spec); onCreated && onCreated(id); } else A.updateBox(box.id, spec);
    onClose();
  }
  async function del() {
    const ok = await ask({ title: 'Eliminar caja', body: html`<p>¿Eliminás <b>${box.name}</b>?${used ? ` Sus ${used} cartas pasan a "sin guardar".` : ''}</p>`, buttons: [{ label: 'Eliminar', value: true, kind: 'danger' }, { label: 'Cancelar', value: false, kind: 'ghost' }] });
    if (ok) { A.deleteBox(box.id); onClose(); }
  }
  return html`<${Modal} title=${isNew ? 'Nueva caja' : 'Editar caja'} size="md" onClose=${onClose}
    footer=${html`${!isNew ? html`<button class="btn danger-ghost" onClick=${del}>${Icon('trash', 18)} Eliminar</button>` : null}
      <span class="grow"></span>
      <button class="btn ghost" onClick=${onClose}>Cancelar</button>
      <button class="btn primary" onClick=${save}>${isNew ? 'Crear caja' : 'Guardar cambios'}</button>`}>
    <div class="editor">
      <label class="field"><span>Nombre (lo que escribirías en la etiqueta)</span><input value=${f.name} onInput=${e => up({ name: e.currentTarget.value })} /></label>
      <div class="field"><span>Capacidad (cartas con folio)</span>
        <div class="chips">
          ${BOX_CAPS.map(c => html`<button class=${cls('chip', +f.cap === c && 'on')} onClick=${() => up({ cap: c })}>${c}</button>`)}
          <input type="number" min="10" max="1000" class="cap-in" value=${f.cap} onInput=${e => up({ cap: e.currentTarget.value })} aria-label="Otra capacidad" />
        </div>
      </div>
      ${used > +f.cap ? html`<p class="warn-text small">Ya tiene ${used} cartas: va a quedar pasada de capacidad.</p>` : null}
      <div class="field"><span>Color</span>
        <div class="swatches">${BOX_COLORS.map(c => html`<button class=${cls('swatch', f.color === c.color && 'on')} style=${`--c:${c.color}`} title=${c.label} aria-label=${c.label} onClick=${() => up({ color: c.color })}></button>`)}</div>
      </div>
      <div class="field"><span>Foto del frente (opcional)</span>
        <div class="photo-row">
          ${f.photo ? html`<img class="photo-thumb" src=${f.photo} alt="Frente de la caja" />` : null}
          <label class="btn">${Icon('upload', 18)} ${f.photo ? 'Cambiar foto' : 'Subir una foto de tu caja'}<input type="file" accept="image/*" hidden onChange=${onPhoto} /></label>
          ${f.photo ? html`<button class="btn ghost" onClick=${() => up({ photo: null })}>Quitar</button>` : null}
        </div>
      </div>
    </div>
  <//>`;
}

// Guardar en una caja una carta que está en un bolsillo
export async function pocketToBox(state, binderId, idx) {
  const id = await chooseBox(state);
  if (!id) return;
  const b = state.binders.find(x => x.id === binderId);
  if (!b || !activeVersion(b).slots[idx]) return;
  const added = A.dropIntoBox(id, [{ b: binderId, idx }]);
  afterBoxDrop(id, added);
}
