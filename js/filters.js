// Barra de búsqueda, filtros y orden. Los filtros se combinan: dentro de un grupo vale cualquiera
// de los elegidos y entre grupos tienen que cumplirse todos (por ejemplo: Prestige + azul).
import { html, useState } from './vendor/preact-htm.js';
import { ASPECTS, TYPES, RARITIES, FAMILIES, cls, ASPECT } from './util.js';
import { SORTS, DEFAULT_DIR, emptyFilter, filterActive } from './autofill.js';
import { setLabel, setOrder } from './catalog.js';
import { Icon, Segmented } from './ui.js';
import { uiGet, uiSet } from './store.js';

function statusLabel(st, places) {
  const fixed = { free: 'Sin guardar', placed: 'En carpetas', table: 'En la mesa', boxes: 'En cajas', conflict: 'Con copias de más' };
  if (fixed[st]) return fixed[st];
  const list = st.startsWith('b:') ? (places && places.binders) : (places && places.boxes);
  const p = (list || []).find(x => x.id === st.slice(2));
  return p ? p.name : st;
}

function toggleIn(list, v) {
  return list.includes(v) ? list.filter(x => x !== v) : [...list, v];
}

export function FilterBar({ filter, setFilter, sort, setSort, sets = [], chars = [], places, showStatus = true, placeholder = 'Buscar por nombre, personaje, rasgo o número', autoFocus, compact, id = 'general' }) {
  const wide = matchMedia('(min-width: 900px)').matches;
  const [open, setOpenRaw] = useState(uiGet('filtersOpen:' + id, wide && !compact));
  const setOpen = v => { setOpenRaw(v); uiSet('filtersOpen:' + id, v); };
  const f = { ...emptyFilter(), ...filter };
  const up = patch => setFilter({ ...f, ...patch });
  const nActive = f.aspects.length + f.types.length + f.sets.length + f.rarities.length + f.families.length + f.chars.length + (f.foil !== 'any' ? 1 : 0) + (f.minPrice ? 1 : 0) + (f.status !== 'all' ? 1 : 0);
  const sortedSets = [...sets].sort((a, b) => setOrder(a) - setOrder(b));
  const charName = id => (chars.find(c => c.id === id) || {}).name || id;

  // Resumen de lo aplicado (se ve aunque el panel esté cerrado)
  const pills = [
    ...f.aspects.map(a => ({ label: a === 'none' ? 'Sin aspecto' : ASPECT[a].es, off: () => up({ aspects: f.aspects.filter(x => x !== a) }) })),
    ...f.families.map(v => ({ label: FAMILIES.find(x => x.id === v).es, off: () => up({ families: f.families.filter(x => x !== v) }) })),
    ...(f.foil !== 'any' ? [{ label: f.foil === 'foil' ? 'Solo foil' : 'Sin foil', off: () => up({ foil: 'any' }) }] : []),
    ...f.rarities.map(v => ({ label: RARITIES.find(x => x.id === v).es, off: () => up({ rarities: f.rarities.filter(x => x !== v) }) })),
    ...f.types.map(v => ({ label: TYPES.find(x => x.id === v).es, off: () => up({ types: f.types.filter(x => x !== v) }) })),
    ...f.chars.map(v => ({ label: charName(v), off: () => up({ chars: f.chars.filter(x => x !== v) }) })),
    ...f.sets.map(v => ({ label: v, off: () => up({ sets: f.sets.filter(x => x !== v) }) })),
    ...(f.minPrice ? [{ label: `Desde US$ ${f.minPrice}`, off: () => up({ minPrice: '' }) }] : []),
    ...(f.status !== 'all' ? [{ label: statusLabel(f.status, places), off: () => up({ status: 'all' }) }] : []),
  ];

  return html`<div class="filterbar">
    <div class="fb-row">
      <label class="search">
        ${Icon('search', 18)}
        <input type="search" value=${f.q} placeholder=${placeholder} onInput=${e => up({ q: e.currentTarget.value })} autofocus=${autoFocus} />
      </label>
      <div class="aspect-toggles" role="group" aria-label="Filtrar por aspecto">
        ${ASPECTS.map(a => html`<button class=${cls('asp', f.aspects.includes(a.id) && 'on')} style=${`--c:${a.color}`} title=${a.es} aria-label=${a.es} aria-pressed=${f.aspects.includes(a.id)}
          onClick=${() => up({ aspects: toggleIn(f.aspects, a.id) })}><span></span></button>`)}
        <button class=${cls('asp', 'asp-none', f.aspects.includes('none') && 'on')} title="Sin aspecto" aria-label="Sin aspecto" aria-pressed=${f.aspects.includes('none')} onClick=${() => up({ aspects: toggleIn(f.aspects, 'none') })}><span></span></button>
      </div>
      <button class=${cls('btn', 'filters-btn', open && 'on')} aria-expanded=${open} onClick=${() => setOpen(!open)}>${Icon('sliders', 18)} Filtros${nActive ? html` <b class="pill">${nActive}</b>` : ''}</button>
      ${setSort ? html`<div class="sort">
        <span class="muted hide-sm">Ordenar por</span>
        <select aria-label="Ordenar por" value=${sort.id} onChange=${e => { const id = e.currentTarget.value; setSort({ id, dir: DEFAULT_DIR[id] || 'asc' }); }}>
          ${SORTS.map(s => html`<option value=${s.id}>${s.es}</option>`)}
        </select>
        <button class="icon-btn" title=${sort.dir === 'asc' ? 'Ascendente' : 'Descendente'} aria-label="Invertir orden" onClick=${() => setSort({ ...sort, dir: sort.dir === 'asc' ? 'desc' : 'asc' })}>
          <span class=${cls('dir', sort.dir)}>${Icon('down', 18)}</span>
        </button>
      </div>` : null}
    </div>
    ${open ? html`<div class="fb-more">
      <div class="fb-group"><span class="fb-label">Variante</span>
        ${FAMILIES.map(v => html`<button class=${cls('chip', f.families.includes(v.id) && 'on')} aria-pressed=${f.families.includes(v.id)} onClick=${() => up({ families: toggleIn(f.families, v.id) })}>${v.es}</button>`)}
        <span class="fb-sep"></span>
        <button class=${cls('chip', f.foil === 'foil' && 'on')} aria-pressed=${f.foil === 'foil'} onClick=${() => up({ foil: f.foil === 'foil' ? 'any' : 'foil' })}>Foil</button>
        <button class=${cls('chip', f.foil === 'nonfoil' && 'on')} aria-pressed=${f.foil === 'nonfoil'} onClick=${() => up({ foil: f.foil === 'nonfoil' ? 'any' : 'nonfoil' })}>Sin foil</button>
      </div>
      <div class="fb-group"><span class="fb-label">Rareza</span>
        ${RARITIES.map(r => html`<button class=${cls('chip', f.rarities.includes(r.id) && 'on')} aria-pressed=${f.rarities.includes(r.id)} onClick=${() => up({ rarities: toggleIn(f.rarities, r.id) })}>${r.es}</button>`)}
      </div>
      <div class="fb-group"><span class="fb-label">Tipo</span>
        ${TYPES.map(t => html`<button class=${cls('chip', f.types.includes(t.id) && 'on')} aria-pressed=${f.types.includes(t.id)} onClick=${() => up({ types: toggleIn(f.types, t.id) })}>${t.es}</button>`)}
      </div>
      ${chars.length ? html`<div class="fb-group"><span class="fb-label">Personaje</span>
        <select class="char-select" value="" onChange=${e => { const v = e.currentTarget.value; if (v) up({ chars: toggleIn(f.chars, v) }); e.currentTarget.value = ''; }}>
          <option value="">Elegí un personaje…</option>
          ${chars.map(c => html`<option value=${c.id}>${c.name} (${c.total})</option>`)}
        </select>
        ${f.chars.map(id => html`<button class="chip on" onClick=${() => up({ chars: f.chars.filter(x => x !== id) })}>${charName(id)} ✕</button>`)}
      </div>` : null}
      ${sortedSets.length ? html`<div class="fb-group"><span class="fb-label">Expansión</span>
        ${sortedSets.map(s => html`<button class=${cls('chip', f.sets.includes(s) && 'on')} title=${setLabel(s)} aria-pressed=${f.sets.includes(s)} onClick=${() => up({ sets: toggleIn(f.sets, s) })}>${s}</button>`)}
      </div>` : null}
      <div class="fb-group"><span class="fb-label">Precio desde</span>
        <label class="price-in">US$ <input type="number" min="0" step="0.5" inputmode="decimal" value=${f.minPrice} onInput=${e => up({ minPrice: e.currentTarget.value })} /></label>
      </div>
      ${showStatus ? html`<div class="fb-group"><span class="fb-label">Dónde está</span>
        <select class="char-select" value=${f.status} onChange=${e => up({ status: e.currentTarget.value })}>
          <option value="all">En cualquier lugar</option>
          <option value="free">Sin guardar</option>
          <option value="placed">En carpetas</option>
          <option value="table">En la mesa</option>
          <option value="boxes">En cajas</option>
          ${(places && places.binders || []).map(b => html`<option value=${'b:' + b.id}>Carpeta: ${b.name}</option>`)}
          ${(places && places.boxes || []).map(b => html`<option value=${'x:' + b.id}>Caja: ${b.name}</option>`)}
          <option value="conflict">Con copias de más</option>
        </select>
      </div>` : null}
    </div>` : null}
    ${pills.length || f.q ? html`<div class="fb-active">
      ${pills.map(p => html`<button class="chip on sm" onClick=${p.off} title="Quitar este filtro">${p.label} ✕</button>`)}
      ${filterActive(f) ? html`<button class="link-btn" onClick=${() => setFilter(emptyFilter())}>Limpiar todo</button>` : null}
    </div>` : null}
  </div>`;
}
