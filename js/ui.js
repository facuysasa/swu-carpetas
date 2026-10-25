// Componentes de interfaz compartidos
import { html, useState, useEffect, useRef } from './vendor/preact-htm.js';
import { cls, ASPECT, NEUTRAL_COLOR, money } from './util.js';
import { savedUrl, noteLoaded } from './offline.js';

const P = {
  back: 'M15 18l-6-6 6-6',
  next: 'M9 18l6-6-6-6',
  prev: 'M15 18l-6-6 6-6',
  down: 'M6 9l6 6 6-6',
  close: 'M6 6l12 12M18 6L6 18',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-4',
  redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h4',
  layers: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5',
  focus: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  spread: 'M3 5.5C5.5 4.5 8.5 4.5 12 6.5v13c-3.5-2-6.5-2-9-1zM21 5.5c-2.5-1-5.5-1-9 1v13c3.5-2 6.5-2 9-1z',
  grid: 'M4 4h4v4H4zM10 4h4v4h-4zM16 4h4v4h-4zM4 10h4v4H4zM10 10h4v4h-4zM16 10h4v4h-4zM4 16h4v4H4zM10 16h4v4h-4zM16 16h4v4h-4z',
  upload: 'M12 15V4M7 9l5-5 5 5M5 20h14',
  sliders: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  cloud: 'M7 18a4.5 4.5 0 0 1-.5-9A6 6 0 0 1 18 8.5a4.75 4.75 0 0 1-1 9.5z',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  move: 'M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3',
  swap: 'M7 16V4M3 8l4-4 4 4M17 8v12M13 16l4 4 4-4',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5v.5',
  wand: 'M4 20L15 9M14 4v3M18.5 5.5l-2 2M20 10h-3M9 5h3M17 14v3M15.5 15.5h3',
  cards: 'M8 4h11v15H8zM5 7v13h11',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  check: 'M5 12l5 5 9-10',
  warn: 'M12 4l9 16H3zM12 10v4M12 17v.5',
  flip: 'M4 12a8 8 0 0 1 14-5l2 2M20 4v5h-5M20 12a8 8 0 0 1-14 5l-2-2M4 20v-5h5',
  map: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  book: 'M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2zM5 18a2 2 0 0 1 2-2h12M9 8h6',
};

export function Icon(name, size = 20) {
  return html`<svg class="ico" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${P[name] || ''} /></svg>`;
}

// ---------- Pila de modales (Esc cierra el de arriba) ----------
const stack = [];
export const modalOpen = () => stack.length > 0;
addEventListener('keydown', e => {
  if (e.key === 'Escape' && stack.length) {
    e.preventDefault();
    const top = stack[stack.length - 1];
    top.current && top.current();
  }
});

export function Modal({ title, onClose, children, footer, size = 'md', className = '', head }) {
  const ref = useRef(onClose);
  ref.current = onClose;
  const panel = useRef(null);
  useEffect(() => {
    stack.push(ref);
    const prev = document.activeElement;
    setTimeout(() => {
      const el = panel.current && panel.current.querySelector('[autofocus], input, button.primary');
      if (el && matchMedia('(pointer: fine)').matches) el.focus();
    }, 30);
    return () => {
      const i = stack.indexOf(ref);
      if (i >= 0) stack.splice(i, 1);
      if (prev && prev.focus) prev.focus();
    };
  }, []);
  return html`<div class="overlay" onPointerDown=${e => { if (e.target === e.currentTarget) e.currentTarget.dataset.down = '1'; }}
      onClick=${e => { if (e.target === e.currentTarget && e.currentTarget.dataset.down) onClose && onClose(); }}>
    <section ref=${panel} class=${cls('panel', 'panel-' + size, className)} role="dialog" aria-modal="true" aria-label=${title}>
      <header class="panel-head">
        <h2>${title}</h2>
        ${head}
        <button class="icon-btn" aria-label="Cerrar" onClick=${onClose}>${Icon('close')}</button>
      </header>
      <div class="panel-body">${children}</div>
      ${footer ? html`<footer class="panel-foot">${footer}</footer>` : null}
    </section>
  </div>`;
}

// ---------- Avisos ----------
let toastId = 0;
const toastSubs = new Set();
let toasts = [];
export function toast(text, opts = {}) {
  const t = { id: ++toastId, text, action: opts.action, kind: opts.kind || 'info' };
  toasts = [...toasts, t];
  toastSubs.forEach(f => f(toasts));
  setTimeout(() => { toasts = toasts.filter(x => x.id !== t.id); toastSubs.forEach(f => f(toasts)); }, opts.ms || 4200);
}
export function Toasts() {
  const [list, setList] = useState(toasts);
  useEffect(() => { toastSubs.add(setList); return () => toastSubs.delete(setList); }, []);
  return html`<div class="toasts" role="status" aria-live="polite">
    ${list.map(t => html`<div key=${t.id} class=${cls('toast', 't-' + t.kind)}>
      <span>${t.text}</span>
      ${t.action ? html`<button class="link-btn" onClick=${() => { t.action.run(); toasts = toasts.filter(x => x.id !== t.id); toastSubs.forEach(f => f(toasts)); }}>${t.action.label}</button>` : null}
    </div>`)}
  </div>`;
}

// ---------- Diálogos de confirmación (promesa) ----------
let dialogSet = null;
export function ask({ title, body, buttons }) {
  return new Promise(resolve => {
    dialogSet && dialogSet({ title, body, buttons, resolve });
  });
}
export function DialogHost() {
  const [d, setD] = useState(null);
  useEffect(() => { dialogSet = setD; return () => { dialogSet = null; }; }, []);
  if (!d) return null;
  const done = v => { setD(null); d.resolve(v); };
  return html`<${Modal} title=${d.title} size="sm" onClose=${() => done(null)}
    footer=${html`${d.buttons.map(b => html`<button class=${cls('btn', b.kind)} onClick=${() => done(b.value)}>${b.label}</button>`)}`}>
    <div class="dialog-body">${d.body}</div>
  <//>`;
}

// ---------- Carta ----------
const orientCache = new Map();

// Si el sitio bloquea imágenes de otros dominios (por ejemplo, dentro de claude.ai), se dibujan las cartas
let imgBlocked = false;
const blockedSubs = new Set();
export const imagesBlocked = () => imgBlocked;
// En la versión de prueba se averigua al arrancar si el sitio deja cargar imágenes de otros dominios
if (window.SWU_STANDALONE) { try { const probe = new Image(); probe.src = 'https://swudb.com/favicon.ico?prueba'; } catch { /* nada */ } }
document.addEventListener('securitypolicyviolation', e => {
  const dir = String(e.effectiveDirective || e.violatedDirective || '');
  if (dir.startsWith('img-src') && !imgBlocked) { imgBlocked = true; blockedSubs.forEach(f => f()); }
});
export function useImgBlocked() {
  const [b, setB] = useState(imgBlocked);
  useEffect(() => { if (imgBlocked !== b) setB(imgBlocked); const f = () => setB(true); blockedSubs.add(f); return () => blockedSubs.delete(f); }, []);
  return b;
}

export function CardProxy({ info }) {
  const a = info.aspects || [];
  const c1 = a[0] && ASPECT[a[0]] ? ASPECT[a[0]].color : NEUTRAL_COLOR;
  const c2 = a[1] && ASPECT[a[1]] ? ASPECT[a[1]].color : c1;
  return html`<div class="proxy" style=${`--c1:${c1};--c2:${c2}`}>
    <div class="proxy-in">
      <div class="proxy-band"></div>
      <div class="proxy-name">${info.displayName}</div>
      ${info.displaySub ? html`<div class="proxy-sub">${info.displaySub}</div>` : null}
      <div class="proxy-foot">${info.set} ${info.num}${info.foil ? ' · foil' : ''}</div>
    </div>
  </div>`;
}

export function CardImage({ info, back = false, eager = false, onOrient }) {
  const base = back ? info.back : info.front;
  // Sin conexión, primero la imagen guardada en el dispositivo
  const saved = !navigator.onLine ? savedUrl(info.key, back) : null;
  const urls = saved && base ? [saved, ...base.filter(u => u !== saved)] : base;
  const [i, setI] = useState(0);
  const blocked = useImgBlocked();
  const ref = useRef(null);
  const first = urls && urls[0];
  const src = urls && urls[i];
  useEffect(() => { setI(0); }, [info.key, back, first]);
  // Algunos bloqueos no disparan "error": se revisa si la imagen quedó rota
  useEffect(() => {
    const el = ref.current;
    if (!el || !src) return undefined;
    const check = () => { if (el.complete && el.naturalWidth === 0 && el.getAttribute('src') === src) setI(x => (urls[x] === src ? x + 1 : x)); };
    const t = setTimeout(check, 80);
    const t2 = setTimeout(check, 1500);
    return () => { clearTimeout(t); clearTimeout(t2); };
  }, [src]);
  if (blocked || !urls || i >= urls.length) return html`<${CardProxy} info=${info} />`;
  return html`<img ref=${ref} class="card-img" src=${src} alt="" loading=${eager ? 'eager' : 'lazy'} decoding="async" draggable=${false}
    onError=${() => setI(x => (urls[x] === src ? x + 1 : x))}
    onLoad=${e => {
      if (navigator.onLine) noteLoaded(info, back);
      const land = e.currentTarget.naturalWidth > e.currentTarget.naturalHeight * 1.05;
      if (!back && orientCache.get(info.key) !== land) { orientCache.set(info.key, land); onOrient && onOrient(land); }
    }} />`;
}

export function useLandscape(info) {
  const known = info ? (info.landscape ?? orientCache.get(info.key) ?? false) : false;
  const [land, setLand] = useState(known);
  useEffect(() => { setLand(info ? (info.landscape ?? orientCache.get(info.key) ?? false) : false); }, [info && info.key, info && info.landscape]);
  return [land, setLand];
}

// Carta "suelta" para grillas (respeta orientación horizontal de líderes y bases)
export function CardTile({ info, badge, dim, onClick, selected, title, extra }) {
  const [land, setLand] = useLandscape(info);
  return html`<button class=${cls('tile', dim && 'dim', selected && 'sel', info.foil && 'foil')} onClick=${onClick} title=${title || info.displayName}>
    <div class=${cls('tile-card', land && 'land')}>
      <${CardImage} info=${info} onOrient=${setLand} />
      ${info.foil ? html`<i class="foil-sheen"></i>` : null}
      ${badge}
    </div>
    <div class="tile-meta">
      <span class="tile-name">${info.displayName}</span>
      ${extra || html`<span class="tile-sub">${info.displaySub || info.typeEs || ''}</span>`}
    </div>
  </button>`;
}

export function AspectDots({ aspects, size = 12 }) {
  if (!aspects || !aspects.length) return html`<span class="aspect-dot neutral" style=${`width:${size}px;height:${size}px`} title="Sin aspecto"></span>`;
  return html`${aspects.map(a => html`<span class="aspect-dot" title=${ASPECT[a] ? ASPECT[a].es : a} style=${`background:${ASPECT[a] ? ASPECT[a].color : NEUTRAL_COLOR};width:${size}px;height:${size}px`}></span>`)}`;
}

export function Price({ value, show = true }) {
  if (!show) return null;
  return html`<span class="price">${money(value)}</span>`;
}

export function Segmented({ value, options, onChange, small }) {
  return html`<div class=${cls('seg', small && 'seg-sm')} role="radiogroup">
    ${options.map(o => html`<button role="radio" aria-checked=${value === o.value} class=${cls(value === o.value && 'on')} onClick=${() => onChange(o.value)}>${o.label}</button>`)}
  </div>`;
}

export function Toggle({ checked, onChange, label }) {
  return html`<label class="toggle"><input type="checkbox" checked=${checked} onChange=${e => onChange(e.currentTarget.checked)} /><span class="toggle-track"><span></span></span><span>${label}</span></label>`;
}

// Carga incremental para grillas largas
export function useIncremental(total, step = 60, resetKey) {
  const [n, setN] = useState(step);
  const ref = useRef(null);
  useEffect(() => { setN(step); }, [resetKey]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) setN(x => Math.min(total, x + step)); }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [total, n]);
  return [Math.min(n, total), ref];
}
