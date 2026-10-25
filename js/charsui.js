// Pantalla y piezas de interfaz de personajes
import { html, useState, useMemo } from './vendor/preact-htm.js';
import { A } from './store.js';
import { deriveChars, AUTO_OK, geminiConfig } from './chars.js';
import { Icon, CardTile, ask, toast } from './ui.js';
import { cls, norm, plural } from './util.js';

const SRC = { nombre: 'por el nombre de la carta', texto: 'porque el nombre de la carta lo menciona', ia: 'detectado por IA en la ilustración' };

// Personajes dentro de la ficha de una carta
export function CharTags({ state, d, info }) {
  const cd = deriveChars(state, d);
  const r = cd.byKey.get(info.key);
  const [name, setName] = useState('');
  if (!r) return null;
  const add = () => { if (name.trim()) { A.addTagByName(r.ak, name, cd); setName(''); } };
  return html`<div class="chartags">
    <h3>Personajes</h3>
    <div class="tag-list">
      ${r.conf.map(id => html`<span key=${id} class="tag-chip ok" title="Confirmado por vos">${cd.nameOf(id)}
        <button aria-label=${`Quitar ${cd.nameOf(id)}`} title="No está en esta carta" onClick=${() => A.rejectTag(r.ak, id)}>✕</button></span>`)}
      ${r.auto.map(a => html`<span key=${a.id} class=${cls('tag-chip', a.p >= AUTO_OK && a.s !== 'ia' ? 'auto' : 'sug')} title=${`Sugerido ${SRC[a.s]} (${Math.round(a.p * 100)}%)`}>
        ${cd.nameOf(a.id)}${a.s === 'ia' ? html`<small>${Math.round(a.p * 100)}%</small>` : null}
        <button aria-label=${`Confirmar ${cd.nameOf(a.id)}`} title="Sí, está" onClick=${() => A.confirmTag(r.ak, a.id)}>✓</button>
        <button aria-label=${`Descartar ${cd.nameOf(a.id)}`} title="No está" onClick=${() => A.rejectTag(r.ak, a.id)}>✕</button></span>`)}
      ${!r.conf.length && !r.auto.length ? html`<span class="muted small">Todavía sin personajes.</span>` : null}
    </div>
    <div class="tag-add">
      <input list="chars-dl" placeholder="Agregar personaje, ej.: Darth Vader" value=${name}
        onInput=${e => setName(e.currentTarget.value)} onKeyDown=${e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
      <datalist id="chars-dl">${cd.list.map(c => html`<option value=${c.name} />`)}</datalist>
      <button class="btn sm" disabled=${!name.trim()} onClick=${add}>Agregar</button>
    </div>
    <p class="muted small">Lo que confirmás o descartás se usa como ejemplo para que la detección automática acierte cada vez más.</p>
  </div>`;
}

// Una carta por ilustración (las variantes que comparten arte se muestran una vez)
function artsToInfos(d, cd, arts) {
  const out = [];
  const seen = new Set();
  for (const info of d.list) {
    const r = cd.byKey.get(info.key);
    if (!r || !arts.has(r.ak) || seen.has(r.ak)) continue;
    seen.add(r.ak);
    out.push({ info, ak: r.ak });
  }
  return out;
}

export function IaProgress({ job, onStop }) {
  if (!job) return null;
  const pct = job.total ? Math.round((job.done / job.total) * 100) : 0;
  return html`<div class="ia-progress" role="status">
    <span>${job.running ? (job.waiting ? 'Esperando el límite gratuito de Gemini…' : `Detectando personajes: ${job.done} de ${job.total}`) : `Detección terminada: ${job.done} ilustraciones revisadas`}</span>
    <i class="ia-bar"><b style=${`width:${pct}%`}></b></i>
    ${job.running ? html`<button class="btn sm" onClick=${onStop}>Frenar</button>` : null}
  </div>`;
}

export function CharsScreen({ state, d, onBack, onCard, job, startDetect, openSettings }) {
  const cd = deriveChars(state, d);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null);
  const [rename, setRename] = useState(null);
  const selId = sel ? cd.resolveId(sel) : null;
  const selected = selId ? cd.list.find(c => c.id === selId) : null;
  const list = cd.list.filter(c => !q || norm(c.name).includes(norm(q)));
  const unchecked = useMemo(() => [...cd.byArt.values()].filter(r => !r.cv).map(r => r.ak), [cd]);
  const pendingAll = useMemo(() => [...cd.byArt.values()].filter(r => r.sug.length), [cd]);
  const hasKey = !!geminiConfig().key;
  const busy = job && job.running;

  function detectAll() {
    if (!hasKey) { openSettings(); toast('Pegá tu API key gratuita de Gemini para detectar personajes en las ilustraciones.'); return; }
    startDetect(unchecked.length ? unchecked : [...cd.byArt.keys()]);
  }
  function searchChar(c) {
    if (!hasKey) { openSettings(); toast('Pegá tu API key gratuita de Gemini para buscar con IA.'); return; }
    const bc = cd.byChar.get(c.id);
    const arts = [...cd.byArt.values()].filter(r => !r.conf.includes(c.id) && !r.rejected.includes(c.id) && !(bc && bc.auto.has(r.ak))).map(r => r.ak);
    startDetect(arts, c.id);
  }
  async function merge(c) {
    const others = cd.list.filter(x => x.id !== c.id);
    const v = await ask({
      title: `Unir ${c.name} con…`,
      body: html`<p>Elegí con qué personaje unirlo. Sus cartas pasan a ese personaje (útil para nombres repetidos, como “Vader” y “Darth Vader”).</p>`,
      buttons: [...others.slice(0, 8).map(o => ({ label: o.name, value: o.id })), { label: 'Cancelar', value: null, kind: 'ghost' }],
    });
    if (v) { A.mergeChar(c.id, v, cd); setSel(v); }
  }
  async function remove(c) {
    const ok = await ask({ title: 'Quitar personaje', body: html`<p>¿Quitás <b>${c.name}</b> de tu base? Se borran sus etiquetas; las cartas no se tocan.</p>`, buttons: [{ label: 'Quitar', value: true, kind: 'danger' }, { label: 'Cancelar', value: false, kind: 'ghost' }] });
    if (ok) { A.hideChar(c.id, cd); setSel(null); }
  }

  const reviewTile = (info, ak, id) => html`<div key=${ak} class="review-tile">
    <${CardTile} info=${info} onClick=${() => onCard(info)} />
    <div class="review-btns">
      <button class="rv ok" aria-label="Sí, está" title="Sí, está" onClick=${() => A.confirmTag(ak, id)}>${Icon('check', 18)}</button>
      <button class="rv no" aria-label="No está" title="No está" onClick=${() => A.rejectTag(ak, id)}>${Icon('close', 18)}</button>
    </div>
  </div>`;

  let detail;
  if (selected) {
    const bc = cd.byChar.get(selected.id);
    const confirmed = artsToInfos(d, cd, new Set([...bc.conf, ...bc.auto]));
    const sugg = artsToInfos(d, cd, bc.sug);
    detail = html`<section class="char-detail">
      <div class="char-head">
        <button class="btn ghost only-sm" onClick=${() => setSel(null)}>${Icon('back', 18)} Personajes</button>
        ${rename != null
          ? html`<input class="char-name-in" value=${rename} onInput=${e => setRename(e.currentTarget.value)} onKeyDown=${e => { if (e.key === 'Enter' && rename.trim()) { A.renameChar(selected.id, rename, cd); setRename(null); } }} autofocus />
              <button class="btn sm primary" onClick=${() => { if (rename.trim()) A.renameChar(selected.id, rename, cd); setRename(null); }}>Guardar</button>`
          : html`<h2>${selected.name}</h2>`}
        <span class="grow"></span>
        <button class="icon-btn" title="Renombrar" aria-label="Renombrar" onClick=${() => setRename(selected.name)}>${Icon('edit')}</button>
        <button class="btn sm ghost" onClick=${() => merge(selected)}>Unir con…</button>
        <button class="btn sm danger-ghost" onClick=${() => remove(selected)}>Quitar</button>
      </div>
      <p class="muted small">${plural(confirmed.length, 'ilustración', 'ilustraciones')} con ${selected.name}${sugg.length ? `, ${plural(sugg.length, 'posible', 'posibles')} para revisar` : ''}.</p>
      ${sugg.length ? html`<h3 class="sub-h">Posibles: ¿aparece ${selected.name}?</h3>
        <div class="grid review">${sugg.map(({ info, ak }) => reviewTile(info, ak, selected.id))}</div>` : null}
      <div class="row-btns">
        <button class="btn" disabled=${busy} onClick=${() => searchChar(selected)}>${Icon('wand', 18)} Buscar a ${selected.name} con IA en el resto</button>
      </div>
      <h3 class="sub-h">Cartas con ${selected.name}</h3>
      ${confirmed.length ? html`<div class="grid">${confirmed.map(({ info }) => html`<${CardTile} key=${info.key} info=${info} onClick=${() => onCard(info)} />`)}</div>`
        : html`<p class="muted">Todavía no hay cartas confirmadas. Revisá las posibles o agregalo desde la ficha de una carta.</p>`}
    </section>`;
  } else {
    detail = html`<section class="char-detail intro">
      <h2>Tu base de personajes</h2>
      <p>Los personajes salen solos del nombre de tus cartas (por ejemplo, la unidad “Obi-Wan Kenobi”). Para las que no lo nombran, como eventos o mejoras, la IA mira la ilustración y te sugiere quién aparece. Vos confirmás o descartás, y eso le sirve de ejemplo para acertar más la próxima vez.</p>
      <div class="row-btns">
        <button class="btn primary" disabled=${busy} onClick=${detectAll}>${Icon('wand', 18)} ${unchecked.length ? `Detectar en ${plural(unchecked.length, 'ilustración', 'ilustraciones')} sin revisar` : 'Volver a detectar en todas'}</button>
      </div>
      ${!hasKey ? html`<p class="muted small">Necesita una API key gratuita de Gemini (en Ajustes).</p>` : null}
      ${pendingAll.length ? html`<h3 class="sub-h">Sugerencias para revisar</h3>
        <div class="grid review">${pendingAll.slice(0, 40).map(r => {
          const info = artsToInfos(d, cd, new Set([r.ak]))[0];
          const s = r.sug[0];
          return info ? html`<div key=${r.ak} class="review-tile">
            <${CardTile} info=${info} onClick=${() => onCard(info)} />
            <span class="review-q">¿${cd.nameOf(s.id)}?</span>
            <div class="review-btns">
              <button class="rv ok" aria-label="Sí" onClick=${() => A.confirmTag(r.ak, s.id)}>${Icon('check', 18)}</button>
              <button class="rv no" aria-label="No" onClick=${() => A.rejectTag(r.ak, s.id)}>${Icon('close', 18)}</button>
            </div>
          </div>` : null;
        })}</div>` : null}
    </section>`;
  }

  return html`<div class="chars">
    <header class="topbar">
      <button class="btn ghost back" onClick=${onBack}>${Icon('back', 20)}<span class="hide-sm">Mesa</span></button>
      <h1 class="topbar-title">Personajes</h1>
      <div class="grow"></div>
      <button class="btn" disabled=${busy} onClick=${detectAll}>${Icon('wand', 18)} <span class="hide-sm">Detectar con IA</span></button>
    </header>
    <div class=${cls('chars-body', selected && 'has-sel')}>
      <aside class="char-list">
        <label class="search">${Icon('search', 18)}<input type="search" placeholder="Buscar personaje" value=${q} onInput=${e => setQ(e.currentTarget.value)} /></label>
        <ul>
          ${list.map(c => html`<li key=${c.id}><button class=${cls('char-item', selId === c.id && 'on')} onClick=${() => { setSel(c.id); setRename(null); }}>
            <span class="ci-name">${c.name}</span>
            <span class="ci-meta">${c.total}${c.sug ? html` · <b>${c.sug} por revisar</b>` : ''}</span>
          </button></li>`)}
        </ul>
        ${!list.length ? html`<p class="muted small">No hay personajes con ese nombre.</p>` : null}
      </aside>
      ${detail}
    </div>
  </div>`;
}
