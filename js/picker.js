// Selector de cartas para un bolsillo, ficha de carta y alta manual
import { html, useState, useMemo } from './vendor/preact-htm.js';
import { A, activeVersion, freeCopies, getState } from './store.js';
import { matches, comparator, emptyFilter, tagFn } from './autofill.js';
import { deriveChars } from './chars.js';
import { CharTags } from './charsui.js';
import { whereParts } from './boxes.js';
import { FilterBar } from './filters.js';
import { Modal, Icon, CardTile, CardImage, AspectDots, ask, toast, useIncremental, useLandscape, Toggle } from './ui.js';
import { cls, money, slotPos, capacityOf, FAMILY, RARITY, ARENAS, printingKey, plural } from './util.js';
import { catalog, searchCatalog, resolveCatalogCard, setLabel } from './catalog.js';

// Filtros y orden del selector se recuerdan entre aperturas
let pickerFilter = emptyFilter();
let pickerSort = { id: 'price', dir: 'desc' };

function binderName(s, id) {
  const b = s.binders.find(x => x.id === id);
  return b ? b.name : 'otra carpeta';
}

export function locationText(s, l) {
  if (l.b === 'mesa') return `la mesa${l.q > 1 ? ` (×${l.q})` : ''}`;
  if (l.b === 'caja') { const bx = (s.boxes || []).find(x => x.id === l.box); return `la caja ${bx ? bx.name : ''}${l.q > 1 ? ` (×${l.q})` : ''}`; }
  return `${binderName(s, l.b)}, página ${l.face}${l.q > 1 ? ` (×${l.q})` : ''}`;
}

function nextEmpty(binder, from) {
  const slots = activeVersion(binder).slots;
  const cap = capacityOf(binder);
  for (let i = from + 1; i < cap; i++) if (!slots[i]) return i;
  return null;
}

export function CardPicker({ state, d, binder, idx, onClose, onPlaced, onTarget }) {
  const [filter, setFilterRaw] = useState(pickerFilter);
  const [sort, setSortRaw] = useState(pickerSort);
  const setFilter = f => { pickerFilter = f; setFilterRaw(f); };
  const setSort = s => { pickerSort = s; setSortRaw(s); };
  const slot = activeVersion(binder).slots[idx];
  const current = slot ? d.infos.get(slot.k) : null;
  const pos = slotPos(binder, idx);
  const follow = state.settings.followNext;

  const tagsOf = useMemo(() => tagFn(state, d), [state.tags, state.chars, d]);
  const charList = deriveChars(state, d).list;
  const items = useMemo(() => d.list
    .filter(i => matches(i, filter, freeCopies(state, d, i.key), tagsOf, d.where))
    .sort(comparator([sort])), [d, filter, sort, tagsOf]);
  const sets = useMemo(() => [...new Set(d.list.map(i => i.set))], [d]);
  const [shown, sentinel] = useIncremental(items.length, 60, JSON.stringify(filter) + sort.id + sort.dir);

  async function pick(info) {
    const s = getState();
    const free = freeCopies(s, d, info.key);
    if (current && current.key === info.key) { onClose(); return; }
    if (free > 0) {
      A.place(binder.id, idx, info.key, 1);
    } else {
      const locs = (d.locs.get(info.key) || []).filter(l => !(l.b === binder.id && l.idx === idx));
      if (!locs.length) { toast('No te quedan copias de esa carta.', { kind: 'warn' }); return; }
      const choice = await ask({
        title: 'Esta carta ya está en otro lugar',
        body: html`<p>Todas tus copias de <b>${info.displayName}</b> ya están ubicadas. Si la traés, sale de donde está ahora.</p>`,
        buttons: [
          ...locs.slice(0, 4).map((l, i) => ({ label: `Traer desde ${locationText(s, l)}`, value: i, kind: i === 0 ? 'primary' : '' })),
          { label: 'Cancelar', value: null, kind: 'ghost' },
        ],
      });
      if (choice == null) return;
      A.placeTaking(binder.id, idx, info.key, 1, locs[choice]);
    }
    onPlaced && onPlaced(idx);
    if (follow) {
      const nb = getState().binders.find(b => b.id === binder.id);
      const n = nextEmpty(nb, idx);
      if (n != null) { onTarget(n); return; }
    }
    onClose();
  }

  const title = current ? `Reemplazar ${current.displayName}` : `Elegí una carta`;
  return html`<${Modal} title=${title} size="xl" className="picker" onClose=${onClose}
    head=${html`<span class="picker-where">Página ${pos.face} · bolsillo ${pos.n}</span>`}>
    <${FilterBar} filter=${filter} setFilter=${setFilter} sort=${sort} setSort=${setSort} sets=${sets} chars=${charList} places=${{ binders: state.binders, boxes: state.boxes || [] }} compact id="selector" />
    <div class="picker-opts">
      <span class="muted">${plural(items.length, 'carta', 'cartas')}</span>
      <${Toggle} checked=${follow} onChange=${v => A.setSettings({ followNext: v })} label="Al elegir, seguir con el próximo bolsillo vacío" />
    </div>
    ${items.length ? html`<div class="grid">
      ${items.slice(0, shown).map(info => {
        const free = freeCopies(state, d, info.key);
        const out = free <= 0;
        return html`<${CardTile} key=${info.key} info=${info} dim=${out} onClick=${() => pick(info)}
          badge=${html`<span class="tile-badges">
            ${state.settings.prices && info.price != null ? html`<span class="b-price">${money(info.price)}</span>` : null}
            <span class=${cls('b-count', out && 'out')}>${out ? 'Ubicada' : `${free} libre${free === 1 ? '' : 's'}`}</span>
          </span>`} />`;
      })}
      <div ref=${sentinel} class="sentinel"></div>
    </div>` : html`<div class="empty-note">
      ${d.list.length ? 'Ninguna carta coincide con esos filtros.' : 'Todavía no hay cartas en tu colección. Importá tus archivos desde la mesa.'}
    </div>`}
  <//>`;
}

export function CardDetail({ state, d, info, onClose, onGo }) {
  const [back, setBack] = useState(false);
  const [land, setLand] = useLandscape(info);
  const parts = whereParts(state, d, info);
  const placed = d.assigned.get(info.key) || 0;
  const free = info.count - placed;
  const rows = [
    ['Expansión', setLabel(info.set)],
    ['Número', info.num],
    ['Variante', `${info.variantLabel}${info.foil && !/foil/i.test(info.variantLabel) ? ' · foil' : ''}`],
    ['Rareza', (RARITY[info.rarity] && RARITY[info.rarity].es) || info.rarity || '—'],
    ['Tipo', info.typeEs || '—'],
    info.cost != null ? ['Coste', info.cost] : null,
    info.power != null || info.hp != null ? ['Poder / Vida', `${info.power ?? '—'} / ${info.hp ?? '—'}`] : null,
    info.arenas.length ? ['Arena', info.arenas.map(a => ARENAS[a] || a).join(', ')] : null,
    info.traits.length ? ['Rasgos', info.traits.join(', ')] : null,
    info.artist ? ['Ilustración', info.artist] : null,
    ['Precio', info.price != null ? `${money(info.price)}${info.priceFrom === 'file' ? ' (según tu archivo)' : ''}` : 'Sin dato'],
  ].filter(Boolean);
  return html`<${Modal} title=${info.displayName} size="lg" className="detail" onClose=${onClose}>
    <div class="detail-wrap">
      <div class="detail-art">
        <div class=${cls('detail-card', land && !back && 'land', info.foil && 'foil')}>
          <${CardImage} info=${info} back=${back} eager onOrient=${setLand} />
          ${info.foil ? html`<i class="foil-sheen"></i>` : null}
        </div>
        ${info.doubleSided ? html`<button class="btn ghost" onClick=${() => setBack(!back)}>${Icon('flip', 18)} Ver ${back ? 'frente' : 'dorso'}</button>` : null}
      </div>
      <div class="detail-info">
        ${info.displaySub ? html`<p class="detail-sub">${info.displaySub}</p>` : null}
        ${info.nameEs && info.nameEs !== info.name ? html`<p class="muted">En inglés: ${info.name}${info.sub ? ', ' + info.sub : ''}</p>` : null}
        <div class="detail-aspects"><${AspectDots} aspects=${info.aspects} size=${16} /> <span class="fam">${FAMILY[info.family].es}</span></div>
        <dl class="kv">${rows.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>
        <div class="stock-box">
          <div class="stepper">
            <span>Tenés</span>
            <button class="icon-btn" aria-label="Una copia menos" onClick=${() => A.setCount(info.key, info.count - 1)} disabled=${info.count <= 0}>${Icon('minus', 18)}</button>
            <b>${info.count}</b>
            <button class="icon-btn" aria-label="Una copia más" onClick=${() => A.setCount(info.key, info.count + 1)}>${Icon('plus', 18)}</button>
          </div>
          <p class=${cls('muted', free < 0 && 'warn-text')}>${free < 0 ? `Hay ${-free} ${-free === 1 ? 'copia ubicada' : 'copias ubicadas'} de más (en carpetas, cajas o la mesa).` : `${placed} guardada${placed === 1 ? '' : 's'} · ${free} sin guardar`}</p>
        </div>
        <${CharTags} state=${state} d=${d} info=${info} />
        <div class="locs">
          <h3>Dónde está</h3>
          ${parts.map(p => html`<div class=${cls('loc', 'w-' + p.t)}>
            <span class="where-dot"></span>
            <span class="loc-text">${p.long || p.text}${p.q > 1 ? ` · ${p.q} copias` : ''}</span>
            ${p.go && onGo ? html`<button class="btn ghost sm" onClick=${() => onGo(p.go)}>${p.t === 'caja' ? 'Abrir' : 'Ir'}</button>` : null}
          </div>`)}
          ${!parts.length ? html`<p class="muted small">No tenés copias de esta carta.</p>` : null}
        </div>
      </div>
    </div>
  <//>`;
}

export function AddCard({ state, onClose }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null);
  const [foil, setFoil] = useState(false);
  const [count, setCount] = useState(1);
  const lang = state.settings.lang;
  const results = useMemo(() => searchCatalog(q, 48), [q]);
  if (catalog.status !== 'ready' && catalog.status !== 'live') {
    return html`<${Modal} title="Agregar una carta" size="sm" onClose=${onClose}>
      <p>El catálogo de cartas todavía no está disponible, así que no puedo buscar por nombre. Mientras tanto, podés sumar cartas importando un archivo de SWUDB.</p>
    <//>`;
  }
  function add() {
    const c = sel;
    const key = printingKey(c.s, c.n, foil, '');
    A.addPrinting({ key, set: c.s, num: c.n, foil, vtag: '', count, name: c.nm, sub: c.st || null, variant: c.vt || null, rarity: c.r || null, price: null, src: 'a mano' });
    toast(`Agregaste ${count} × ${c.ne && lang === 'es' ? c.ne : c.nm}`);
    onClose();
  }
  return html`<${Modal} title="Agregar una carta" size="lg" onClose=${onClose}
    footer=${sel ? html`
      <${Toggle} checked=${foil} onChange=${setFoil} label="Es foil" />
      <div class="stepper"><button class="icon-btn" aria-label="Menos" onClick=${() => setCount(Math.max(1, count - 1))}>${Icon('minus', 18)}</button><b>${count}</b><button class="icon-btn" aria-label="Más" onClick=${() => setCount(count + 1)}>${Icon('plus', 18)}</button></div>
      <button class="btn primary" onClick=${add}>Agregar a la colección</button>` : null}>
    <label class="search wide">${Icon('search', 18)}<input type="search" placeholder="Nombre de la carta (en inglés o español)" value=${q} onInput=${e => { setQ(e.currentTarget.value); setSel(null); }} autofocus /></label>
    <div class="grid small">
      ${results.map(c => {
        const info = resolveCatalogCard(c, lang, foil);
        return html`<${CardTile} key=${c.s + c.n} info=${info} selected=${sel === c} onClick=${() => setSel(c)}
          badge=${html`<span class="tile-badges"><span class="b-count">${c.s} ${c.n}</span></span>`} />`;
      })}
    </div>
    ${q.length >= 2 && !results.length ? html`<div class="empty-note">No encontré cartas con ese nombre.</div>` : null}
  <//>`;
}
