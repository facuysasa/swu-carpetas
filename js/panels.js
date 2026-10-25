// Paneles de la carpeta: menú del bolsillo, versiones, vista general, ordenador y editor
import { html, useState, useMemo } from './vendor/preact-htm.js';
import { A, activeVersion, freeCopies, MODELS, COVER_COLORS, slotsLostOnResize } from './store.js';
import { cls, money, slotPos, facesOf, capacityOf, ASPECT, NEUTRAL_COLOR, plural, resizeImage } from './util.js';
import { Modal, Icon, CardImage, useLandscape, Segmented, Toggle, toast, ask } from './ui.js';
import { FilterBar } from './filters.js';
import { planFill, emptyFilter, SORTS, GROUPS, DEFAULT_DIR } from './autofill.js';
import { deriveChars } from './chars.js';
import { undo } from './store.js';

// ---------- Menú de un bolsillo ocupado ----------
export function SlotMenu({ state, d, binder, idx, onClose, onMove, onReplace, onDetail, onToTable, onToBox }) {
  const slot = activeVersion(binder).slots[idx];
  const info = d.infos.get(slot.k);
  const [land, setLand] = useLandscape(info);
  const pos = slotPos(binder, idx);
  const free = info ? freeCopies(state, d, info.key) : 0;
  const othersMap = new Map();
  for (const l of d.locs.get(slot.k) || []) {
    if (l.b === binder.id && l.idx === idx) continue;
    const k = l.b + ':' + l.face;
    othersMap.set(k, { ...l, q: (othersMap.has(k) ? othersMap.get(k).q : 0) + l.q });
  }
  const others = [...othersMap.values()].map(l => (l.b === 'mesa' ? `la mesa${l.q > 1 ? ` (×${l.q})` : ''}` : `${l.b === binder.id ? 'esta carpeta' : (state.binders.find(b => b.id === l.b) || {}).name}, página ${l.face}${l.q > 1 ? ` (×${l.q})` : ''}`));
  return html`<${Modal} title=${info ? info.displayName : slot.k} size="sm" className="slot-menu" onClose=${onClose}
    head=${html`<span class="picker-where">Página ${pos.face} · bolsillo ${pos.n}</span>`}>
    <div class="slot-menu-body">
      ${info ? html`<button class=${cls('sm-card', land && 'land', info.foil && 'foil')} onClick=${() => onDetail(info)} aria-label="Ver la ficha">
        <${CardImage} info=${info} eager onOrient=${setLand} />${info.foil ? html`<i class="foil-sheen"></i>` : null}
      </button>` : html`<div class="sm-card missing">Esta carta ya no está en tu colección</div>`}
      <div class="sm-actions">
        ${info ? html`<p class="muted">${info.displaySub || info.typeEs || ''}${state.settings.prices && info.price != null ? ` · ${money(info.price)}` : ''}</p>` : null}
        <button class="btn" onClick=${onMove}>${Icon('move', 18)} Mover o intercambiar</button>
        <button class="btn" onClick=${onReplace}>${Icon('swap', 18)} Reemplazar por otra</button>
        ${onToTable ? html`<button class="btn" onClick=${onToTable}>${Icon('cards', 18)} Dejar en la mesa</button>` : null}
        ${onToBox && (state.boxes || []).length ? html`<button class="btn" onClick=${onToBox}>${Icon('book', 18)} Guardar en una caja</button>` : null}
        <button class="btn danger-ghost" onClick=${() => { A.clear(binder.id, idx); onClose(); toast('Carta sacada de la carpeta', { action: { label: 'Deshacer', run: undo } }); }}>${Icon('trash', 18)} Sacar de la carpeta</button>
        ${info ? html`<div class="stepper">
          <span>Copias en este bolsillo</span>
          <button class="icon-btn" aria-label="Una menos" disabled=${slot.q <= 1} onClick=${() => A.setQty(binder.id, idx, slot.q - 1)}>${Icon('minus', 18)}</button>
          <b>${slot.q}</b>
          <button class="icon-btn" aria-label="Una más" disabled=${free <= 0} onClick=${() => A.setQty(binder.id, idx, slot.q + 1)}>${Icon('plus', 18)}</button>
        </div>
        <p class="muted small">${free > 0 ? `Te ${free === 1 ? 'queda 1 copia libre' : `quedan ${free} copias libres`} para apilar acá.` : 'No te quedan copias libres para apilar.'}
          ${others.length ? ` Otras copias: ${others.join('; ')}.` : ''}</p>` : null}
      </div>
    </div>
  <//>`;
}

// ---------- Minicarpeta (vista general y vista previa) ----------
function cellStyle(info) {
  if (!info) return '';
  const a = info.aspects || [];
  const c1 = a[0] && ASPECT[a[0]] ? ASPECT[a[0]].color : NEUTRAL_COLOR;
  const c2 = a[1] && ASPECT[a[1]] ? ASPECT[a[1]].color : c1;
  return `background:linear-gradient(135deg, ${c1} 0 50%, ${c2} 50% 100%)`;
}

export function MiniBinder({ binder, slots, d, current, onPick, maxSpreads }) {
  const S = binder.sheets;
  const per = binder.rows * binder.cols;
  const faceCells = f => {
    const out = [];
    for (let p = 0; p < per; p++) {
      const idx = (f - 1) * per + p;
      const sl = slots[idx];
      const info = sl ? d.infos.get(sl.k) : null;
      out.push(html`<i key=${p} class=${cls('mc', sl && 'on', info && info.foil && 'foil', sl && !info && 'gone', info && d.conflicts.has(info.key) && 'bad')}
        style=${cellStyle(info)} title=${info ? `${info.displayName}${sl.q > 1 ? ` ×${sl.q}` : ''}` : ''}></i>`);
    }
    return out;
  };
  const spreads = [];
  const last = maxSpreads ? Math.min(S, maxSpreads) : S;
  for (let s = 0; s <= last; s++) {
    const lf = s === 0 ? null : 2 * s;
    const rf = s === S ? null : 2 * s + 1;
    spreads.push(html`<button key=${s} class=${cls('mini-spread', current === s && 'cur')} onClick=${onPick ? () => onPick(s) : null} disabled=${!onPick}
      aria-label=${`Ir a ${lf ? `páginas ${lf} y ${rf ?? ''}` : `página ${rf}`}`}>
      <span class="mini-face" style=${`--cols:${binder.cols}`}>${lf ? faceCells(lf) : html`<b class="mini-inside"></b>`}</span>
      <span class="mini-face" style=${`--cols:${binder.cols}`}>${rf ? faceCells(rf) : html`<b class="mini-inside"></b>`}</span>
      <small>${lf ? lf : ''}${lf && rf ? '–' : ''}${rf || ''}</small>
    </button>`);
  }
  return html`<div class="mini-binder">${spreads}</div>`;
}

export function OverviewModal({ state, d, binder, current, onPick, onClose }) {
  const v = activeVersion(binder);
  const filled = Object.keys(v.slots).length;
  return html`<${Modal} title=${`Vista general de ${binder.name}`} size="xl" onClose=${onClose}
    head=${html`<span class="picker-where">${v.name} · ${filled} de ${capacityOf(binder)} bolsillos</span>`}>
    <p class="muted">Cada cuadradito es un bolsillo pintado con el color de la carta. Tocá una doble página para ir ahí.</p>
    <${MiniBinder} binder=${binder} slots=${v.slots} d=${d} current=${current} onPick=${onPick} />
  <//>`;
}

// ---------- Versiones ----------
export function VersionsModal({ state, d, binder, onClose }) {
  const [sel, setSel] = useState(binder.active);
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState('');
  const selected = binder.versions.find(v => v.id === sel) || activeVersion(binder);
  async function remove(v) {
    const ok = await ask({ title: 'Eliminar versión', body: html`<p>¿Eliminás <b>${v.name}</b>? Las cartas no se pierden: solo se borra esta forma de ordenarlas.</p>`, buttons: [{ label: 'Eliminar', value: true, kind: 'danger' }, { label: 'Cancelar', value: false, kind: 'ghost' }] });
    if (ok) { A.deleteVersion(binder.id, v.id); setSel(binder.active === v.id ? null : binder.active); }
  }
  return html`<${Modal} title="Versiones de la carpeta" size="lg" onClose=${onClose}
    footer=${html`
      <button class="btn" onClick=${() => { const id = A.addVersion(binder.id, { copy: true, name: `Copia de ${activeVersion(binder).name}` }); setSel(id); toast('Creaste una copia: ahora estás trabajando sobre ella'); }}>${Icon('copy', 18)} Duplicar la actual</button>
      <button class="btn" onClick=${() => { const id = A.addVersion(binder.id, { copy: false }); setSel(id); toast('Creaste una versión vacía'); }}>${Icon('plus', 18)} Nueva vacía</button>`}>
    <p class="muted">Cada versión es una forma distinta de ordenar esta carpeta. La activa es la que ves en la mesa y la que cuenta para saber qué cartas están ocupadas.</p>
    <div class="versions">
      ${binder.versions.map(v => html`<div key=${v.id} class=${cls('version-row', v.id === binder.active && 'active', v.id === sel && 'sel')} onClick=${() => setSel(v.id)}>
        <span class="v-dot" aria-hidden="true"></span>
        ${editing === v.id
          ? html`<input class="v-name-in" value=${name} onInput=${e => setName(e.currentTarget.value)} onClick=${e => e.stopPropagation()}
              onKeyDown=${e => { if (e.key === 'Enter') { A.renameVersion(binder.id, v.id, name.trim() || v.name); setEditing(null); } }} autofocus />`
          : html`<span class="v-name">${v.name}</span>`}
        <span class="muted">${plural(Object.keys(v.slots).length, 'bolsillo', 'bolsillos')}</span>
        <span class="v-actions" onClick=${e => e.stopPropagation()}>
          ${editing === v.id
            ? html`<button class="btn sm" onClick=${() => { A.renameVersion(binder.id, v.id, name.trim() || v.name); setEditing(null); }}>Guardar</button>`
            : html`<button class="icon-btn" title="Renombrar" aria-label="Renombrar" onClick=${() => { setEditing(v.id); setName(v.name); }}>${Icon('edit', 18)}</button>`}
          ${binder.versions.length > 1 ? html`<button class="icon-btn" title="Eliminar" aria-label="Eliminar" onClick=${() => remove(v)}>${Icon('trash', 18)}</button>` : null}
          ${v.id === binder.active ? html`<span class="tag">Activa</span>` : html`<button class="btn sm primary" onClick=${() => { A.setActiveVersion(binder.id, v.id); toast(`Ahora ves ${v.name}`); }}>Usar esta</button>`}
        </span>
      </div>`)}
    </div>
    <h3 class="sub-h">Vista previa: ${selected.name}</h3>
    <${MiniBinder} binder=${binder} slots=${selected.slots} d=${d} />
  <//>`;
}

// ---------- Ordenar automáticamente ----------
const PRESETS = [
  { label: 'Más caras primero', name: 'Por precio', sort: [{ id: 'price', dir: 'desc' }], group: '' },
  { label: 'Por color', name: 'Por color', sort: [{ id: 'aspect', dir: 'asc' }, { id: 'type', dir: 'asc' }, { id: 'cost', dir: 'asc' }], group: 'aspect' },
  { label: 'Por expansión', name: 'Por expansión', sort: [{ id: 'set', dir: 'asc' }], group: 'set' },
  { label: 'Por tipo', name: 'Por tipo', sort: [{ id: 'type', dir: 'asc' }, { id: 'aspect', dir: 'asc' }, { id: 'cost', dir: 'asc' }], group: 'type' },
  { label: 'Variantes especiales', name: 'Especiales', sort: [{ id: 'family', dir: 'asc' }, { id: 'price', dir: 'desc' }], group: 'family' },
];

export function AutofillModal({ state, d, binder, onClose, onApplied }) {
  const faces = facesOf(binder);
  const [o, setO] = useState({
    binderId: binder.id, target: 'new', newName: 'Por precio', faceFrom: 1, faceTo: faces,
    filter: emptyFilter(), includeElsewhere: false, copies: 'each',
    sort: [{ id: 'price', dir: 'desc' }, { id: '', dir: 'asc' }, { id: '', dir: 'asc' }], groupBy: '', groupNewPage: true, occupied: 'clear',
  });
  const [range, setRange] = useState('all');
  const up = patch => setO({ ...o, ...patch });
  const opts = { ...o, faceFrom: range === 'all' ? 1 : Math.max(1, Math.min(faces, +o.faceFrom || 1)), faceTo: range === 'all' ? faces : Math.max(1, Math.min(faces, +o.faceTo || faces)) };
  if (opts.faceTo < opts.faceFrom) opts.faceTo = opts.faceFrom;
  const plan = useMemo(() => planFill(state, d, opts), [state, d, JSON.stringify(opts)]);
  const sets = useMemo(() => [...new Set(d.list.map(i => i.set))], [d]);
  const setSortAt = (i, patch) => { const sort = o.sort.slice(); sort[i] = { ...sort[i], ...patch }; up({ sort }); };

  function apply() {
    A.applyPlan(plan);
    toast(`Listo: ${plural(plan.cards, 'carta ubicada', 'cartas ubicadas')}${plan.newVersionName ? ` en la versión “${plan.newVersionName}”` : ''}`, { action: { label: 'Deshacer', run: undo }, ms: 6000 });
    onApplied && onApplied();
  }

  const leftover = plan.leftovers.reduce((n, u) => n + u.q, 0);
  const firstOut = plan.leftovers.length ? plan.leftovers[0].info : null;
  const removalsCount = plan.removals.reduce((s, r) => s + r.q, 0);
  return html`<${Modal} title="Ordenar automáticamente" size="xl" className="autofill" onClose=${onClose}
    footer=${html`<span class="af-summary">
        ${plan.pockets ? html`Se ${plan.cards === 1 ? 'ubica' : 'ubican'} <b>${plural(plan.cards, 'carta', 'cartas')}</b> en ${plural(plan.pockets, 'bolsillo', 'bolsillos')}${plan.lastFace ? `, hasta la página ${plan.lastFace}` : ''}.` : 'Ninguna carta disponible coincide con lo elegido.'}
        ${leftover ? html` <span class="warn-text">${leftover === 1 ? 'Queda afuera 1 carta' : `Quedan afuera ${leftover.toLocaleString('es-AR')} cartas`} por falta de lugar (la primera es ${firstOut.displayName}).</span>` : plan.freeTargets > 0 && plan.pockets ? ` Quedan ${plural(plan.freeTargets, 'bolsillo libre', 'bolsillos libres')}.` : ''}
        ${removalsCount ? html` <span class="warn-text">Se sacan ${plural(removalsCount, 'carta', 'cartas')} de otras carpetas.</span>` : ''}
      </span>
      <button class="btn ghost" onClick=${onClose}>Cancelar</button>
      <button class="btn primary" disabled=${!plan.pockets} onClick=${apply}>${o.target === 'new' ? 'Crear versión ordenada' : 'Ordenar esta versión'}</button>`}>
    <div class="af-grid">
      <section class="af-col">
        <h3 class="sub-h">Atajos</h3>
        <div class="chips">${PRESETS.map(p => html`<button class="chip" onClick=${() => up({ sort: [...p.sort, { id: '', dir: 'asc' }, { id: '', dir: 'asc' }].slice(0, 3), groupBy: p.group, newName: p.name })}>${p.label}</button>`)}</div>

        <h3 class="sub-h">Qué cartas</h3>
        <${FilterBar} filter=${o.filter} setFilter=${f => up({ filter: f })} sets=${sets} chars=${deriveChars(state, d).list} showStatus=${false} placeholder="Ej.: Vader, Jedi, LOF" compact id="ordenar" />
        <${Segmented} value=${o.copies} onChange=${v => up({ copies: v })} options=${[
          { value: 'each', label: 'Una por bolsillo' }, { value: 'stack', label: 'Apilar copias iguales' }, { value: 'single', label: 'Solo una copia de cada' },
        ]} />
        <${Toggle} checked=${o.includeElsewhere} onChange=${v => up({ includeElsewhere: v })} label="Usar también cartas que están en otras carpetas (se mueven acá)" />

        <h3 class="sub-h">Cómo ordenarlas</h3>
        ${o.sort.map((s, i) => html`<div class="af-sort">
          <span class="muted">${i === 0 ? 'Primero por' : 'Después por'}</span>
          <select value=${s.id} onChange=${e => { const id = e.currentTarget.value; setSortAt(i, { id, dir: DEFAULT_DIR[id] || 'asc' }); }}>
            ${i > 0 ? html`<option value="">—</option>` : null}
            ${SORTS.map(x => html`<option value=${x.id}>${x.es}</option>`)}
          </select>
          ${s.id ? html`<button class="icon-btn" aria-label="Invertir" title=${s.dir === 'asc' ? 'Ascendente' : 'Descendente'} onClick=${() => setSortAt(i, { dir: s.dir === 'asc' ? 'desc' : 'asc' })}><span class=${cls('dir', s.dir)}>${Icon('down', 18)}</span></button>` : null}
        </div>`)}
        <div class="af-sort">
          <span class="muted">Separar por</span>
          <select value=${o.groupBy} onChange=${e => up({ groupBy: e.currentTarget.value })}>${GROUPS.map(g => html`<option value=${g.id}>${g.es}</option>`)}</select>
          ${o.groupBy ? html`<${Toggle} checked=${o.groupNewPage} onChange=${v => up({ groupNewPage: v })} label="Cada grupo en página nueva" />` : null}
        </div>

        <h3 class="sub-h">Dónde</h3>
        <${Segmented} value=${o.target} onChange=${v => up({ target: v })} options=${[{ value: 'new', label: 'En una versión nueva' }, { value: 'current', label: `En “${activeVersion(binder).name}”` }]} />
        ${o.target === 'new' ? html`<label class="field"><span>Nombre de la versión</span><input value=${o.newName} onInput=${e => up({ newName: e.currentTarget.value })} /></label>` : null}
        <${Segmented} value=${range} onChange=${setRange} options=${[{ value: 'all', label: 'Toda la carpeta' }, { value: 'range', label: 'Algunas páginas' }]} />
        ${range === 'range' ? html`<div class="af-range">Desde la página <input type="number" min="1" max=${faces} value=${o.faceFrom} onInput=${e => up({ faceFrom: e.currentTarget.value })} /> hasta la <input type="number" min="1" max=${faces} value=${o.faceTo} onInput=${e => up({ faceTo: e.currentTarget.value })} /></div>` : null}
        <${Segmented} value=${o.occupied} onChange=${v => up({ occupied: v })} options=${[{ value: 'clear', label: 'Vaciar antes' }, { value: 'keep', label: 'Respetar lo que ya está' }]} />
      </section>
      <section class="af-col af-preview">
        <h3 class="sub-h">Así quedaría</h3>
        ${plan.groups.length ? html`<div class="af-groups">${plan.groups.slice(0, 12).map(g => html`<span class="chip static">${g.label} · pág. ${g.face}</span>`)}</div>` : null}
        <${MiniBinder} binder=${binder} slots=${plan.slots} d=${d} />
      </section>
    </div>
  <//>`;
}

// ---------- Crear / editar carpeta ----------
export function BinderEditor({ state, binder, onClose, onDeleted, onCreated }) {
  const isNew = !binder;
  const base = binder || { name: `Carpeta ${state.binders.length + 1}`, sheets: 20, rows: 3, cols: 3, cover: { color: COVER_COLORS[1].color, strap: true, photo: null } };
  const [f, setF] = useState({ name: base.name, sheets: base.sheets, rows: base.rows, cols: base.cols, color: base.cover.color, strap: base.cover.strap !== false, photo: base.cover.photo || null });
  const model = MODELS.find(m => m.sheets === +f.sheets && m.rows === +f.rows && m.cols === +f.cols);
  const [custom, setCustom] = useState(!model);
  const up = p => setF({ ...f, ...p });
  const lost = binder ? slotsLostOnResize(binder, { sheets: +f.sheets, rows: +f.rows, cols: +f.cols }) : 0;

  async function onPhoto(e) {
    const file = e.currentTarget.files && e.currentTarget.files[0];
    if (!file) return;
    try { up({ photo: await resizeImage(file, 720, 0.8) }); } catch { toast('No pude leer esa imagen.', { kind: 'warn' }); }
  }
  function save() {
    const spec = { name: f.name.trim() || base.name, sheets: Math.max(1, Math.min(60, +f.sheets || 20)), rows: Math.max(1, Math.min(5, +f.rows || 3)), cols: Math.max(1, Math.min(5, +f.cols || 3)) };
    if (isNew) {
      const id = A.addBinder({ ...spec, color: f.color, strap: f.strap, photo: f.photo });
      onCreated && onCreated(id);
    } else {
      A.updateBinder(binder.id, { ...spec, cover: { color: f.color, strap: f.strap, photo: f.photo } });
    }
    onClose();
  }
  async function del() {
    const ok = await ask({ title: 'Eliminar carpeta', body: html`<p>¿Eliminás <b>${binder.name}</b> con todas sus versiones? Las cartas siguen en tu colección.</p>`, buttons: [{ label: 'Eliminar', value: true, kind: 'danger' }, { label: 'Cancelar', value: false, kind: 'ghost' }] });
    if (ok) { A.deleteBinder(binder.id); onDeleted && onDeleted(); onClose(); }
  }
  return html`<${Modal} title=${isNew ? 'Nueva carpeta' : 'Editar carpeta'} size="md" onClose=${onClose}
    footer=${html`${!isNew && state.binders.length > 1 ? html`<button class="btn danger-ghost" onClick=${del}>${Icon('trash', 18)} Eliminar</button>` : null}
      <span class="grow"></span>
      <button class="btn ghost" onClick=${onClose}>Cancelar</button>
      <button class="btn primary" onClick=${save}>${isNew ? 'Crear carpeta' : 'Guardar cambios'}</button>`}>
    <div class="editor">
      <label class="field"><span>Nombre</span><input value=${f.name} onInput=${e => up({ name: e.currentTarget.value })} /></label>
      <label class="field"><span>Modelo</span>
        <select value=${custom ? 'custom' : model ? model.id : 'custom'} onChange=${e => {
          const m = MODELS.find(x => x.id === e.currentTarget.value);
          if (m) { setCustom(false); up({ sheets: m.sheets, rows: m.rows, cols: m.cols }); } else setCustom(true);
        }}>
          ${MODELS.map(m => html`<option value=${m.id}>${m.label}</option>`)}
          <option value="custom">Otra medida…</option>
        </select>
      </label>
      ${custom ? html`<div class="dims">
        <label class="field"><span>Hojas</span><input type="number" min="1" max="60" value=${f.sheets} onInput=${e => up({ sheets: e.currentTarget.value })} /></label>
        <label class="field"><span>Filas por página</span><input type="number" min="1" max="5" value=${f.rows} onInput=${e => up({ rows: e.currentTarget.value })} /></label>
        <label class="field"><span>Columnas</span><input type="number" min="1" max="5" value=${f.cols} onInput=${e => up({ cols: e.currentTarget.value })} /></label>
      </div>` : null}
      <p class="muted small">Cada hoja tiene dos páginas: ${plural((+f.sheets || 0) * 2, 'página', 'páginas')} y ${plural((+f.sheets || 0) * 2 * (+f.rows || 0) * (+f.cols || 0), 'bolsillo', 'bolsillos')} en total.</p>
      ${lost ? html`<p class="warn-text">Con esta medida quedan afuera ${plural(lost, 'bolsillo ocupado', 'bolsillos ocupados')} (esas cartas vuelven a estar libres).</p>` : null}
      <div class="field"><span>Color de la tapa</span>
        <div class="swatches">${COVER_COLORS.map(c => html`<button class=${cls('swatch', f.color === c.color && 'on')} style=${`--c:${c.color}`} title=${c.label} aria-label=${c.label} onClick=${() => up({ color: c.color })}></button>`)}</div>
      </div>
      <${Toggle} checked=${f.strap} onChange=${v => up({ strap: v })} label="Tiene elástico" />
      <div class="field"><span>Foto de portada (opcional)</span>
        <div class="photo-row">
          ${f.photo ? html`<img class="photo-thumb" src=${f.photo} alt="Portada" />` : null}
          <label class="btn">${Icon('upload', 18)} ${f.photo ? 'Cambiar foto' : 'Subir una foto de tu carpeta'}<input type="file" accept="image/*" hidden onChange=${onPhoto} /></label>
          ${f.photo ? html`<button class="btn ghost" onClick=${() => up({ photo: null })}>Quitar</button>` : null}
        </div>
      </div>
    </div>
  <//>`;
}
