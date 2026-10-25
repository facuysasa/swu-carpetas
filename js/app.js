// Raíz de la app
import { html, render, useState, useEffect, useMemo, useRef } from './vendor/preact-htm.js';
import { getState, subscribe, derive, A, undo, redo, replaceState, freeCopies, resetAll, onPersistError } from './store.js';
import { catalog, loadCatalog, loadLive } from './catalog.js';

const STANDALONE = !!window.SWU_STANDALONE;
import { parseCollection, planImport } from './importer.js';
import { matches, comparator, emptyFilter, tagFn } from './autofill.js';
import { deriveChars, detectCharacters, geminiConfig, saveGeminiConfig, testGemini } from './chars.js';
import { CharsScreen, IaProgress } from './charsui.js';
import { offlineCapable, offlineEnabled, setOfflineEnabled, cacheCollection, onImgJob, imgJob, offlineStats, storageUsage, clearImages } from './offline.js';
import { FilterBar } from './filters.js';
import { BinderView, ClosedBinders } from './binder.js';
import { DeckBoxes, BoxModal, BoxEditor, WhereLine, whereParts } from './boxes.js';
import { TableView } from './camera.js';
import { useTable, Controls, SelectionBar, LooseDrawer } from './table.js';
import { binderLayout, unionRect } from './geom.js';
import { BinderEditor } from './panels.js';
import { CardDetail, AddCard } from './picker.js';
import { sync, onSync, connect, disconnect, syncNow, resolveConflict, syncEnabled } from './sync.js';
import { Modal, Icon, Toasts, DialogHost, CardTile, Segmented, Toggle, toast, ask, modalOpen, useIncremental, useImgBlocked } from './ui.js';
import { cls, money, plural, readFileText, downloadText } from './util.js';

function useOnline() {
  const [on, setOn] = useState(navigator.onLine);
  useEffect(() => {
    const a = () => setOn(true);
    const b = () => setOn(false);
    addEventListener('online', a);
    addEventListener('offline', b);
    return () => { removeEventListener('online', a); removeEventListener('offline', b); };
  }, []);
  return on;
}

function parseRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  const [a, b] = h.split('/');
  if (a === 'carpeta' && b) return { screen: 'binder', id: decodeURIComponent(b) };
  if (a === 'coleccion') return { screen: 'stock' };
  if (a === 'personajes') return { screen: 'chars' };
  return { screen: 'mesa' };
}
const go = path => { location.hash = path; };

function App() {
  const [s, setS] = useState(getState());
  const [, setCatV] = useState(catalog.version);
  const [route, setRoute] = useState(parseRoute());
  const [modal, setModal] = useState(null);
  const [card, setCard] = useState(null);
  const [gotoSlot, setGotoSlot] = useState(null);
  const [gotoTable, setGotoTable] = useState(null);
  const [syncState, setSyncState] = useState({ ...sync });
  const [job, setJob] = useState(null);
  const stopRef = useRef(false);
  const online = useOnline();
  const [imgState, setImgState] = useState({ ...imgJob });
  useEffect(() => onImgJob(setImgState), []);
  useEffect(() => { if (imgState.error) toast(imgState.error, { kind: 'warn', ms: 7000 }); }, [imgState.error]);

  // Detección de personajes con IA (corre en segundo plano y guarda de a tandas)
  async function startDetect(artKeys, focus) {
    if (job && job.running) return;
    if (!geminiConfig().key) { setModal({ kind: 'settings' }); toast('Pegá tu API key gratuita de Gemini para detectar personajes.'); return; }
    if (!artKeys.length) { toast('No hay ilustraciones para revisar.'); return; }
    stopRef.current = false;
    setJob({ running: true, done: 0, total: artKeys.length });
    try {
      const s0 = getState();
      const d0 = derive(s0);
      await detectCharacters({
        state: s0, d: d0, cd: deriveChars(s0, d0), artKeys, focus,
        onBatch: (res, batch) => { const s = getState(); A.setIaTags(res, batch, deriveChars(s, derive(s))); },
        onProgress: p => setJob(j => ({ ...j, ...p })),
        shouldStop: () => stopRef.current,
      });
      toast(stopRef.current ? 'Detección frenada; lo revisado quedó guardado.' : 'Listo: revisá las sugerencias en Personajes.');
    } catch (e) {
      toast(e.message || 'No se pudo completar la detección.', { kind: 'warn', ms: 8000 });
    }
    setJob(j => (j ? { ...j, running: false } : j));
    setTimeout(() => setJob(j => (j && !j.running ? null : j)), 5000);
  }
  function detectNew() {
    const s = getState();
    const cd = deriveChars(s, derive(s));
    const arts = [...cd.byArt.values()].filter(r => !r.cv).map(r => r.ak);
    if (arts.length && geminiConfig().key) startDetect(arts);
  }

  useEffect(() => subscribe(setS), []);
  useEffect(() => onPersistError(() => toast('No se pudo guardar en este dispositivo: el espacio de la app está lleno. Descargá una copia desde Ajustes.', { kind: 'warn', ms: 10000 })), []);
  useEffect(() => onSync(x => setSyncState({ ...x })), []);
  useEffect(() => {
    loadCatalog().then(() => setCatV(catalog.version));
    if (syncEnabled()) syncNow();
    const onHash = () => setRoute(parseRoute());
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  // Deshacer / rehacer con el teclado
  useEffect(() => {
    const k = e => {
      if (!(e.ctrlKey || e.metaKey) || modalOpen()) return;
      if (/input|textarea|select/i.test((e.target && e.target.tagName) || '')) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) { e.preventDefault(); const l = undo(); if (l) toast(`Deshiciste: ${l}`); }
      else if ((key === 'z' && e.shiftKey) || key === 'y') { e.preventDefault(); const l = redo(); if (l) toast(`Rehiciste: ${l}`); }
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, []);

  // Conflicto de sincronización
  useEffect(() => {
    if (syncState.status !== 'conflict') return;
    ask({
      title: 'Cambios en dos dispositivos',
      body: html`<p>Modificaste la colección o las carpetas en este dispositivo y en otro desde la última sincronización. Elegí qué versión conservar; la otra se reemplaza.</p>`,
      buttons: [
        { label: 'Quedarme con la de este dispositivo', value: 'local', kind: 'primary' },
        { label: 'Usar la de la nube', value: 'remote' },
      ],
    }).then(v => v && resolveConflict(v));
  }, [syncState.status]);

  const stockSets = Object.values(s.stock).map(e => e.set);
  const setsKey = [...new Set(stockSets)].sort().join(',');
  useEffect(() => {
    if (catalog.status !== 'missing' && catalog.status !== 'live') return;
    if (!setsKey) return;
    loadLive(setsKey.split(',')).then(() => setCatV(v => v + 1));
  }, [catalog.status, setsKey]);

  const d = derive(s);
  // Imágenes para usar sin conexión: al abrir, al importar y al cambiar el idioma
  const stockSig = `${Object.keys(s.stock).length}|${s.settings.lang}|${catalog.version}`;
  useEffect(() => {
    if (!online) return undefined;
    const tm = setTimeout(() => cacheCollection(derive(getState()).list), 2500);
    return () => clearTimeout(tm);
  }, [stockSig, online]);
  const binder = route.screen === 'binder' ? s.binders.find(b => b.id === route.id) : null;
  useEffect(() => { if (route.screen === 'binder' && !binder) go('/'); }, [route.screen, binder]);

  const openCard = info => setCard(info);
  // Ir a donde está una carta: bolsillo exacto, la mesa o la caja
  const goToLocation = loc => {
    setCard(null);
    if (!loc) return;
    if (loc.type === 'slot') { setGotoSlot({ face: loc.face, idx: loc.idx }); go('/carpeta/' + encodeURIComponent(loc.b)); }
    else if (loc.type === 'mesa') { setGotoTable(loc.id); go('/'); }
    else if (loc.type === 'caja') setModal({ kind: 'box', id: loc.box });
  };

  let screen;
  if (binder) {
    screen = html`<${BinderView} state=${s} d=${d} binder=${binder}
      onBack=${() => go('/')} onSwitch=${id => go('/carpeta/' + encodeURIComponent(id))}
      onCard=${openCard} gotoSlot=${gotoSlot} clearGoto=${() => setGotoSlot(null)}
      onEditBinder=${() => setModal({ kind: 'binder', binder })} />`;
  } else if (route.screen === 'chars') {
    screen = html`<${CharsScreen} state=${s} d=${d} onBack=${() => go('/')} onCard=${openCard} job=${job} startDetect=${startDetect} openSettings=${() => setModal({ kind: 'settings' })} />`;
  } else if (route.screen === 'stock') {
    screen = html`<${StockScreen} state=${s} d=${d} onBack=${() => go('/')} onCard=${openCard}
      onImport=${() => setModal({ kind: 'import' })} onAdd=${() => setModal({ kind: 'add' })} />`;
  } else {
    screen = html`<${MesaScreen} state=${s} d=${d} syncState=${syncState}
      onOpen=${id => go('/carpeta/' + encodeURIComponent(id))}
      onNew=${() => setModal({ kind: 'binder', binder: null })}
      onStock=${() => go('/coleccion')}
      onChars=${() => go('/personajes')}
      onCard=${openCard}
      gotoTable=${gotoTable} clearGotoTable=${() => setGotoTable(null)}
      onOpenBox=${id => setModal({ kind: 'box', id })}
      onNewBox=${() => setModal({ kind: 'boxEdit', box: null })}
      onImport=${() => setModal({ kind: 'import' })}
      onSettings=${() => setModal({ kind: 'settings' })} />`;
  }

  return html`<div class=${cls('app', 'scr-' + (binder ? 'binder' : route.screen))}>
    ${screen}
    ${modal && modal.kind === 'import' ? html`<${ImportModal} state=${s} d=${d} onClose=${() => setModal(null)} onImported=${detectNew} />` : null}
    ${modal && modal.kind === 'settings' ? html`<${SettingsModal} state=${s} d=${d} syncState=${syncState} onClose=${() => setModal(null)} />` : null}
    ${modal && modal.kind === 'add' ? html`<${AddCard} state=${s} onClose=${() => setModal(null)} />` : null}
    ${modal && modal.kind === 'binder' ? html`<${BinderEditor} state=${s} binder=${modal.binder && s.binders.find(b => b.id === modal.binder.id)}
      onClose=${() => setModal(null)} onDeleted=${() => go('/')} onCreated=${id => go('/carpeta/' + encodeURIComponent(id))} />` : null}
    ${modal && modal.kind === 'box' ? html`<${BoxModal} state=${s} d=${d} boxId=${modal.id} onClose=${() => setModal(null)}
      onEdit=${() => setModal({ kind: 'boxEdit', box: (s.boxes || []).find(b => b.id === modal.id), back: modal.id })} onCard=${openCard} />` : null}
    ${modal && modal.kind === 'boxEdit' ? html`<${BoxEditor} state=${s} box=${modal.box && (s.boxes || []).find(b => b.id === modal.box.id)}
      onClose=${() => setModal(modal.back && (s.boxes || []).some(b => b.id === modal.back) ? { kind: 'box', id: modal.back } : null)} onCreated=${() => {}} />` : null}
    ${card ? html`<${CardDetail} state=${s} d=${d} info=${d.infos.get(card.key) || card} onClose=${() => setCard(null)} onGo=${goToLocation} />` : null}
    <div class="status-tray">
      ${!online ? html`<div class="tray-pill offline">Sin conexión · todo se guarda en este dispositivo${syncEnabled() ? ' y se sincroniza al volver' : ''}</div>` : null}
      ${imgState.running ? html`<div class="tray-pill">Guardando imágenes para usar sin conexión: ${imgState.done} de ${imgState.total}
        <i class="ia-bar"><b style=${`width:${imgState.total ? Math.round((imgState.done / imgState.total) * 100) : 0}%`}></b></i></div>` : null}
      <${IaProgress} job=${job} onStop=${() => { stopRef.current = true; }} />
    </div>
    <${DialogHost} />
    <${Toasts} />
  </div>`;
}

// ---------- Mesa ----------
function SyncDot({ st }) {
  if (st.status === 'off') return null;
  const txt = { idle: 'Sincronizado', pending: 'Cambios por subir', syncing: 'Sincronizando…', offline: 'Sin conexión: se sube al volver', error: st.message || 'Error al sincronizar', conflict: 'Uniendo cambios' }[st.status] || '';
  return html`<span class=${cls('sync-dot', 's-' + st.status)} title=${txt} aria-label=${txt}></span>`;
}

function MesaScreen({ state, d, syncState, onOpen, onNew, onStock, onChars, onImport, onSettings, onCard, gotoTable, clearGotoTable, onOpenBox, onNewBox }) {
  const empty = !d.printings;
  const blocked = useImgBlocked();
  const apiRef = useRef(null);
  const t = useTable({ view: 'mesa', state, d, apiRef, onOpenCard: onCard });
  const layout = binderLayout(state);
  const rects = [...layout.values()].map(r => ({ x: r.x, y: r.y, w: r.w, h: r.h + 70 }));
  rects.push({ ...layout.newSlot, h: layout.newSlot.h + 70 }, { ...layout.newBox, h: layout.newBox.h + 40 });
  // Ir a una carta que está en la mesa (desde la colección): se encuadra y titila
  useEffect(() => {
    if (!gotoTable) return undefined;
    const c = state.table.cards[gotoTable];
    const tm = setTimeout(() => {
      if (c && apiRef.current) { apiRef.current.fitTo({ x: c.x - 160, y: c.y - 140, w: 63 + 320, h: 88 + 280 }); t.setFound(c.id); }
      clearGotoTable && clearGotoTable();
    }, 250);
    return () => clearTimeout(tm);
  }, [gotoTable]);
  const fitRect = unionRect(rects, 40);
  const note = STANDALONE && catalog.embedded
    ? `Versión de prueba en un solo archivo, con el catálogo de cartas incluido. ${blocked ? 'Dentro de claude.ai las imágenes de otros sitios están bloqueadas, así que las cartas se ven dibujadas con su color; descargá el archivo y abrilo en Chrome para verlas con su imagen real.' : 'Las imágenes salen de SWUDB, en inglés.'} Lo que guardes acá queda solo en este navegador.`
    : STANDALONE ? 'Versión de prueba en un solo archivo. Lo que guardes acá queda solo en este navegador.'
      : catalog.status === 'missing' ? `El catálogo de cartas no está disponible (${catalog.error}). Las imágenes se buscan una por una y algunos datos, como el color, pueden faltar.` : null;
  const overlay = html`
    <header class="mesa-head ui-layer">
      <div class="brand">
        <h1>Mis carpetas</h1>
        <p>${empty ? 'Tu mesa para ordenar Star Wars: Unlimited' : html`${plural(d.copies, 'carta', 'cartas')} · ${plural(d.placed, 'guardada', 'guardadas')}${d.inBoxes ? ` · ${d.inBoxes} en cajas` : ''}${d.onTable ? ` · ${d.onTable} en la mesa` : ''}${state.settings.prices && d.value ? html` · ${money(d.value)}` : ''}`}</p>
      </div>
      <nav class="mesa-actions">
        <button class="btn" onClick=${onStock}>${Icon('cards', 18)} Colección</button>
        <button class="btn" onClick=${onChars}>${Icon('info', 18)} <span class="hide-sm">Personajes</span></button>
        <button class="btn" onClick=${onImport}>${Icon('upload', 18)} <span class="hide-sm">Importar</span></button>
        <button class="icon-btn" aria-label="Ajustes" title="Ajustes" onClick=${onSettings}>${Icon('sliders')}<${SyncDot} st=${syncState} /></button>
      </nav>
    </header>
    ${note ? html`<p class="mesa-note ui-layer">${note}</p>` : null}
    ${empty ? html`<div class="welcome ui-layer">
      <h2>Empezá por tu colección</h2>
      <p>Importá los TXT o CSV que exportás de SWUDB. Después elegí una carpeta y empezá a llenar bolsillos.</p>
      <button class="btn primary" onClick=${onImport}>${Icon('upload', 18)} Importar archivos</button>
    </div>` : null}
    <${Controls} t=${t} apiRef=${apiRef} centerLabel="Centrar en las carpetas" />
    <${SelectionBar} t=${t} state=${state} d=${d} faces=${null} />
    <${LooseDrawer} t=${t} state=${state} d=${d} faces=${null} />
    ${!empty && !Object.keys(state.table.cards).length && !t.boxOpen ? html`<p class="mesa-tip ui-layer">Abrí la <b>caja</b> para llevar cartas a la mesa. Rueda: zoom · arrastrar: moverte · Shift + arrastrar: seleccionar.</p>` : null}`;
  return html`<div class="mesa">
    <${TableView} className="mesa-table" camKey="mesa" restore fitRect=${fitRect} fitToken=${`mesa|${state.binders.length}|${(state.boxes || []).length}`} apiRef=${apiRef}
      selectMode=${t.selectMode} resolveDrag=${t.resolveDrag} onDragStart=${t.onDragStart} onDragMove=${t.onDragMove} onDragEnd=${t.onDragEnd}
      onMarquee=${t.onMarquee} onBackgroundTap=${t.onBackgroundTap} overlay=${overlay}>
      <${ClosedBinders} state=${state} d=${d} t=${t} onOpen=${onOpen} onNew=${onNew} />
      <${DeckBoxes} state=${state} d=${d} t=${t} onOpenBox=${onOpenBox} onNewBox=${onNewBox} />
      ${t.layer}
    <//>
  </div>`;
}

// ---------- Colección ----------
let stockFilter = emptyFilter();
let stockSort = { id: 'price', dir: 'desc' };

function StockScreen({ state, d, onBack, onCard, onImport, onAdd }) {
  const [filter, setF] = useState(stockFilter);
  const [sort, setSo] = useState(stockSort);
  const setFilter = f => { stockFilter = f; setF(f); };
  const setSort = x => { stockSort = x; setSo(x); };
  const tagsOf = useMemo(() => tagFn(state, d), [state.tags, state.chars, d]);
  const charList = deriveChars(state, d).list;
  const items = useMemo(() => d.list.filter(i => matches(i, filter, freeCopies(state, d, i.key), tagsOf, d.where)).sort(comparator([sort])), [d, filter, sort, tagsOf]);
  const sets = useMemo(() => [...new Set(d.list.map(i => i.set))], [d]);
  const [shown, sentinel] = useIncremental(items.length, 72, JSON.stringify(filter) + sort.id + sort.dir);
  const copies = items.reduce((n, i) => n + i.count, 0);
  const value = items.reduce((n, i) => n + (i.price || 0) * i.count, 0);
  return html`<div class="stock">
    <header class="topbar">
      <button class="btn ghost back" onClick=${onBack}>${Icon('back', 20)}<span class="hide-sm">Mesa</span></button>
      <h1 class="topbar-title">Mi colección</h1>
      <div class="grow"></div>
      <button class="btn" onClick=${onAdd}>${Icon('plus', 18)} <span class="hide-sm">Agregar carta</span></button>
      <button class="btn" onClick=${onImport}>${Icon('upload', 18)} <span class="hide-sm">Importar</span></button>
    </header>
    <div class="stock-body">
      <${FilterBar} filter=${filter} setFilter=${setFilter} sort=${sort} setSort=${setSort} sets=${sets} chars=${charList} places=${{ binders: state.binders, boxes: state.boxes || [] }} id="coleccion" />
      <p class="muted stock-count">${plural(items.length, 'impresión', 'impresiones')} · ${plural(copies, 'carta', 'cartas')}${state.settings.prices && value ? ` · ${money(value)}` : ''}${d.conflicts.size ? html` · <span class="warn-text">${plural(d.conflicts.size, 'carta con copias de más en carpetas', 'cartas con copias de más en carpetas')}</span> <button class="link-btn" onClick=${() => A.trimConflicts()}>Corregir</button>` : ''}</p>
      ${items.length ? html`<div class="grid">
        ${items.slice(0, shown).map(info => {
          const placed = d.assigned.get(info.key) || 0;
          return html`<${CardTile} key=${info.key} info=${info} onClick=${() => onCard(info)}
            title=${`${info.displayName} · ${placed} de ${info.count} guardadas`}
            extra=${html`<${WhereLine} parts=${whereParts(state, d, info)} />`}
            badge=${html`<span class="tile-badges">
              ${state.settings.prices && info.price != null ? html`<span class="b-price">${money(info.price)}</span>` : null}
              <span class=${cls('b-count', placed > info.count && 'bad')}>×${info.count}</span>
            </span>
            <span class="b-bar" aria-hidden="true"><i style=${`width:${Math.min(100, (placed / Math.max(1, info.count)) * 100)}%`}></i></span>`} />`;
        })}
        <div ref=${sentinel} class="sentinel"></div>
      </div>` : html`<div class="empty-note">${d.list.length ? 'Ninguna carta coincide con esos filtros.' : html`Tu colección está vacía. <button class="link-btn" onClick=${onImport}>Importá tus archivos</button> o agregá cartas a mano.`}</div>`}
    </div>
  </div>`;
}

// ---------- Importar ----------
function ImportModal({ state, d, onClose, onImported }) {
  const [files, setFiles] = useState([]);
  const [mode, setMode] = useState('update');
  const [over, setOver] = useState(false);
  async function addFiles(list) {
    const parsed = [];
    for (const f of list) parsed.push(parseCollection(f.name, await readFileText(f)));
    setFiles(prev => [...prev.filter(p => !parsed.some(x => x.name === p.name)), ...parsed]);
  }
  const usable = files.filter(f => f.rows.length);
  const plan = usable.length ? planImport(state, d, usable, mode) : null;
  function apply() {
    A.setStock(plan.stock, 'importar colección');
    setTimeout(() => onImported && onImported(), 300);
    toast(`Colección actualizada: ${plural(plan.printings, 'impresión', 'impresiones')} de ${usable.map(f => f.name).join(', ')}`, { action: { label: 'Deshacer', run: undo }, ms: 6000 });
    if (plan.overAssigned.length) {
      ask({
        title: 'Hay cartas de más en tus carpetas',
        body: html`<p>${plural(plan.overAssigned.length, 'carta quedó', 'cartas quedaron')} ubicadas más veces de las copias que ahora tenés. ¿Las saco de las carpetas? (Empiezo por las últimas páginas.)</p>`,
        buttons: [{ label: 'Sacarlas', value: true, kind: 'primary' }, { label: 'Dejarlas marcadas', value: false, kind: 'ghost' }],
      }).then(v => v && A.trimConflicts());
    }
    onClose();
  }
  return html`<${Modal} title="Importar colección" size="md" onClose=${onClose}
    footer=${html`<button class="btn ghost" onClick=${onClose}>Cancelar</button><button class="btn primary" disabled=${!plan} onClick=${apply}>Importar</button>`}>
    <label class=${cls('drop', over && 'over')}
      onDragOver=${e => { e.preventDefault(); setOver(true); }} onDragLeave=${() => setOver(false)}
      onDrop=${e => { e.preventDefault(); setOver(false); addFiles([...e.dataTransfer.files]); }}>
      ${Icon('upload', 28)}
      <b>Arrastrá tus archivos o tocá para elegirlos</b>
      <span class="muted">TXT o CSV exportados de SWUDB. Podés subir varios a la vez (por ejemplo, uno por color).</span>
      <input type="file" accept=".txt,.csv,text/plain,text/csv" multiple hidden onChange=${e => addFiles([...e.currentTarget.files])} />
    </label>
    ${files.length ? html`<ul class="file-list">${files.map(f => html`<li>
      <b>${f.name}</b>
      <span class="muted">${f.rows.length ? `${plural(f.rows.length, 'impresión', 'impresiones')}, ${plural(f.rows.reduce((n, r) => n + r.count, 0), 'carta', 'cartas')}${f.format === 'csv' ? ' (CSV: sin nombres ni precios)' : ''}` : f.errors[0]}</span>
      <button class="icon-btn" aria-label="Quitar" onClick=${() => setFiles(files.filter(x => x !== f))}>${Icon('close', 16)}</button>
    </li>`)}</ul>` : null}
    ${plan ? html`
      <${Segmented} value=${mode} onChange=${setMode} options=${[
        { value: 'update', label: 'Actualizar' }, { value: 'add', label: 'Sumar' }, { value: 'replace', label: 'Reemplazar todo' },
      ]} />
      <p class="muted small">${{
        update: 'Las cantidades pasan a ser las del archivo. Si reimportás un archivo con el mismo nombre, las cartas que ya no aparecen en él se quitan.',
        add: 'Suma las copias del archivo a las que ya tenés (útil para una compra nueva).',
        replace: 'Tu colección pasa a ser exactamente la de estos archivos.',
      }[mode]}</p>
      <div class="import-summary">
        <span><b>${plan.added}</b> nuevas</span>
        <span><b>${plan.changed}</b> con otra cantidad</span>
        <span><b>${plan.removed.length}</b> que salen</span>
        ${plan.unmatched ? html`<span class="warn-text"><b>${plan.unmatched}</b> sin datos del catálogo</span>` : null}
      </div>
      ${plan.overAssigned.length ? html`<p class="warn-text small">${plural(plan.overAssigned.length, 'carta va a quedar', 'cartas van a quedar')} con copias de más en tus carpetas.</p>` : null}
    ` : null}
  <//>`;
}

// ---------- Ajustes: IA ----------
function GeminiSettings() {
  const [cfg, setCfg] = useState(geminiConfig());
  const [status, setStatus] = useState('');
  const up = p => { const n = { ...cfg, ...p }; setCfg(n); saveGeminiConfig(n); setStatus(''); };
  async function test() {
    setStatus('Probando…');
    try { await testGemini(cfg); setStatus('Funciona.'); } catch (e) { setStatus(e.message); }
  }
  return html`<h3 class="sub-h">Detección de personajes (IA gratuita)</h3>
    <p class="small">Usa el plan gratuito de Gemini: creá una API key en <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a> (sin tarjeta) y pegala acá. Queda guardada solo en este dispositivo. En el plan gratuito, Google puede usar lo que se envía para mejorar sus productos (acá solo van imágenes de cartas y nombres de personajes).</p>
    <div class="token-row">
      <input type="password" placeholder="API key de Gemini" value=${cfg.key} onInput=${e => up({ key: e.currentTarget.value.trim() })} autocomplete="off" />
      <button class="btn" disabled=${!cfg.key} onClick=${test}>Probar</button>
    </div>
    <label class="field"><span>Modelo</span><input value=${cfg.model} onInput=${e => up({ model: e.currentTarget.value.trim() || 'gemini-flash-latest' })} /></label>
    ${status ? html`<p class=${cls('small', status === 'Funciona.' ? 'muted' : 'warn-text')}>${status}</p>` : null}`;
}

// ---------- Ajustes ----------
function OfflineSettings({ d }) {
  const [on, setOn] = useState(offlineEnabled());
  const [usage, setUsage] = useState(0);
  const [job, setJobState] = useState({ ...imgJob });
  useEffect(() => onImgJob(setJobState), []);
  useEffect(() => { storageUsage().then(setUsage); }, [job.running]);
  const st = offlineStats(d.list);
  if (!offlineCapable()) {
    return html`<h3 class="sub-h">Usar sin conexión</h3>
      <p class="small muted">${STANDALONE ? 'En esta versión de prueba las imágenes no se pueden guardar para usarlas sin internet. Sí funciona en la versión publicada en GitHub e instalada como app, en la compu y en el celular.' : 'Este navegador no permite guardar imágenes para usarlas sin conexión.'}</p>`;
  }
  const mb = usage ? `${(usage / 1048576).toLocaleString('es-AR', { maximumFractionDigits: 0 })} MB` : '—';
  return html`<h3 class="sub-h">Usar sin conexión</h3>
    <p class="small">La app y todo lo que hacés funcionan sin internet. Para ver las cartas sin conexión, sus imágenes se guardan en este dispositivo apenas las importás.</p>
    <${Toggle} checked=${on} onChange=${v => { setOfflineEnabled(v); setOn(v); if (v) cacheCollection(d.list); }} label="Guardar en este dispositivo las imágenes de mis cartas" />
    <p class="small muted">${st.saved.toLocaleString('es-AR')} de ${st.total.toLocaleString('es-AR')} cartas con imagen guardada · la app usa ${mb} en este dispositivo</p>
    <div class="row-btns">
      <button class="btn" disabled=${job.running || !on || !navigator.onLine} onClick=${() => cacheCollection(d.list)}>${Icon('download', 18)} ${job.running ? `Guardando ${job.done} de ${job.total}…` : 'Guardar las que faltan'}</button>
      <button class="btn ghost" disabled=${job.running} onClick=${async () => { await clearImages(); setUsage(await storageUsage()); toast('Imágenes guardadas borradas de este dispositivo'); }}>Borrar imágenes guardadas</button>
    </div>`;
}

function SettingsModal({ state, d, syncState, onClose }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  async function doConnect() {
    setBusy(true);
    const ok = await connect(token);
    setBusy(false);
    if (ok) { setToken(''); toast('Sincronización activada'); }
  }
  function exportBackup() {
    const day = new Date().toISOString().slice(0, 10);
    downloadText(`carpetas-swu-${day}.json`, JSON.stringify(getState(), null, 1));
  }
  async function importBackup(e) {
    const f = e.currentTarget.files && e.currentTarget.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await readFileText(f));
      if (!data || !data.binders || !data.stock) throw new Error('formato');
      const ok = await ask({ title: 'Restaurar copia', body: html`<p>Esto reemplaza tu colección y tus carpetas por las del archivo <b>${f.name}</b>.</p>`, buttons: [{ label: 'Restaurar', value: true, kind: 'primary' }, { label: 'Cancelar', value: false, kind: 'ghost' }] });
      if (ok) { replaceState({ ...data, updatedAt: Date.now() }); toast('Copia restaurada'); onClose(); }
    } catch { toast('Ese archivo no es una copia de Carpetas SWU.', { kind: 'warn' }); }
  }
  async function reset() {
    const ok = await ask({ title: 'Borrar todo', body: html`<p>Se borran tu colección, tus carpetas y sus versiones en este dispositivo. Conviene descargar una copia antes.${syncEnabled() ? ' Este dispositivo también se desconecta de la sincronización; la copia en tu GitHub queda intacta.' : ''}</p>`, buttons: [{ label: 'Borrar todo', value: true, kind: 'danger' }, { label: 'Cancelar', value: false, kind: 'ghost' }] });
    if (ok) { if (syncEnabled()) disconnect(); resetAll(); toast('Listo: empezás de cero'); onClose(); }
  }
  const built = catalog.builtAt ? new Date(catalog.builtAt).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
  return html`<${Modal} title="Ajustes" size="md" onClose=${onClose}>
    <section class="settings">
      <h3 class="sub-h">Cartas</h3>
      <div class="set-row"><span>Idioma de las imágenes</span>
        <${Segmented} value=${state.settings.lang} onChange=${v => A.setSettings({ lang: v })} options=${[{ value: 'es', label: 'Español' }, { value: 'en', label: 'Inglés' }]} />
      </div>
      <${Toggle} checked=${state.settings.prices} onChange=${v => A.setSettings({ prices: v })} label="Mostrar precios" />
      <p class="muted small">${catalog.status === 'live' ? `Datos traídos en vivo de swu-db para ${catalog.count.toLocaleString('es-AR')} cartas de tus expansiones.` : catalog.status === 'ready' ? `Catálogo con ${catalog.count.toLocaleString('es-AR')} cartas${built ? `, actualizado el ${built}` : ''}. Se renueva solo cada lunes.` : `Catálogo no disponible${catalog.error ? ` (${catalog.error})` : ''}.`}</p>

      ${STANDALONE ? html`<h3 class="sub-h">Sincronizar entre dispositivos</h3><p class="small muted">La sincronización está en la versión publicada en GitHub. En esta versión de prueba todo queda en este navegador.</p>` : null}
      ${STANDALONE ? null : html`<h3 class="sub-h">Sincronizar entre dispositivos</h3>`}
      ${STANDALONE ? null : syncEnabled() ? html`
        <p>Tus datos se guardan en un Gist secreto de tu cuenta de GitHub y se sincronizan solos. Si cambiás cosas en los dos dispositivos, incluso sin conexión, se unen al reconectarse. ${syncState.lastAt ? `Última sincronización: ${new Date(syncState.lastAt).toLocaleString('es-AR')}.` : ''}</p>
        ${syncState.message ? html`<p class=${cls('small', syncState.status === 'error' ? 'warn-text' : 'muted')}>${syncState.message}</p>` : null}
        <div class="row-btns">
          <button class="btn" onClick=${() => syncNow()} disabled=${syncState.status === 'syncing'}>${Icon('cloud', 18)} Sincronizar ahora</button>
          <button class="btn ghost" onClick=${disconnect}>Desconectar este dispositivo</button>
        </div>` : html`
        <p class="small">Para usar la app en la compu y en el celular con los mismos datos, pegá un token de GitHub con permiso <b>gist</b>. El README explica cómo crearlo en un minuto.</p>
        <div class="token-row">
          <input type="password" placeholder="ghp_…" value=${token} onInput=${e => setToken(e.currentTarget.value)} autocomplete="off" />
          <button class="btn primary" disabled=${!token.trim() || busy} onClick=${doConnect}>${busy ? 'Conectando…' : 'Conectar'}</button>
        </div>
        ${syncState.message ? html`<p class="small warn-text">${syncState.message}</p>` : null}`}

      <${OfflineSettings} d=${d} />

      <${GeminiSettings} />

      <h3 class="sub-h">Copias de seguridad</h3>
      <div class="row-btns">
        <button class="btn" onClick=${exportBackup}>${Icon('download', 18)} Descargar copia</button>
        <label class="btn">${Icon('upload', 18)} Restaurar copia<input type="file" accept=".json,application/json" hidden onChange=${importBackup} /></label>
        <button class="btn danger-ghost" onClick=${reset}>${Icon('trash', 18)} Borrar todo</button>
      </div>
    </section>
  <//>`;
}

render(html`<${App} />`, document.getElementById('app'));
