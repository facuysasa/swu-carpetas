// Mesa con cámara: zoom con la rueda, desplazamiento arrastrando, pellizco en pantallas táctiles,
// selección por recuadro y el arranque de los arrastres de cartas.
import { html, useState, useRef, useEffect, useLayoutEffect } from './vendor/preact-htm.js';
import { uiGet, uiSet } from './store.js';
import { cls } from './util.js';

export const ZMIN = 0.15;
export const ZMAX = 8;
const clampZ = z => Math.max(ZMIN, Math.min(ZMAX, z));

export function fitCam(rect, W, H, pad = 0.9) {
  const z = clampZ(Math.min((W * pad) / Math.max(1, rect.w), (H * pad) / Math.max(1, rect.h)));
  return { z, x: (W - rect.w * z) / 2 - rect.x * z, y: (H - rect.h * z) / 2 - rect.y * z };
}

// apiRef.current: { fit(animate), zoomBy(f), toWorld(clientX, clientY), cam(), size() }
export function TableView({ camKey, restore = false, fitRect, fitToken, onSize, selectMode, resolveDrag, onDragStart, onDragMove, onDragEnd, onMarquee, onBackgroundTap, apiRef, className, children, overlay }) {
  const vp = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [cam, setCamState] = useState(() => uiGet('cam:' + camKey, null));
  const camRef = useRef(cam);
  const [glide, setGlide] = useState(false);
  const [moving, setMoving] = useState(false);
  const [marquee, setMarquee] = useState(null);
  const g = useRef(null);
  const pointers = useRef(new Map());
  const suppress = useRef(0);
  const lastFit = useRef(null);
  const handlers = useRef({});
  handlers.current = { resolveDrag, onDragStart, onDragMove, onDragEnd, onMarquee, onBackgroundTap, selectMode };

  const setCam = (c, opts = {}) => {
    camRef.current = c;
    setCamState(c);
    if (opts.glide) { setGlide(true); clearTimeout(setCam.t); setCam.t = setTimeout(() => setGlide(false), 420); }
  };
  useEffect(() => { const t = setTimeout(() => cam && uiSet('cam:' + camKey, cam), 400); return () => clearTimeout(t); }, [cam, camKey]);

  useLayoutEffect(() => {
    const el = vp.current;
    const ro = new ResizeObserver(([e]) => { const sz = { w: e.contentRect.width, h: e.contentRect.height }; setSize(sz); onSize && onSize(sz); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const initKey = useRef(null);
  const fit = (animate = true) => {
    if (!size.w || !fitRect) return;
    lastFit.current = fitToken;
    setCam(fitCam(fitRect, size.w, size.h), { glide: animate });
  };
  // Encuadre al entrar (o la última vista guardada, si corresponde)
  useEffect(() => {
    if (!size.w || initKey.current === camKey) return;
    initKey.current = camKey;
    lastFit.current = fitToken;
    const stored = restore ? uiGet('cam:' + camKey, null) : null;
    setCam(stored || fitCam(fitRect, size.w, size.h));
  }, [camKey, size.w]);
  // Reencuadre animado cuando cambia lo que hay que mostrar (abrir, cerrar, página en modo foco)
  useEffect(() => {
    if (!size.w || initKey.current !== camKey || lastFit.current === fitToken) return;
    lastFit.current = fitToken;
    setCam(fitCam(fitRect, size.w, size.h), { glide: true });
  }, [fitToken]);

  const c = cam || (size.w && fitRect ? fitCam(fitRect, size.w, size.h) : { x: 0, y: 0, z: 1 });
  if (!camRef.current && size.w && fitRect) camRef.current = c;

  const toWorld = (cx, cy) => {
    const r = vp.current.getBoundingClientRect();
    const k = camRef.current || c;
    return { x: (cx - r.left - k.x) / k.z, y: (cy - r.top - k.y) / k.z };
  };
  const zoomAt = (cx, cy, f) => {
    const r = vp.current.getBoundingClientRect();
    const k = camRef.current || c;
    const z = clampZ(k.z * f);
    const sx = cx - r.left;
    const sy = cy - r.top;
    setCam({ z, x: sx - (sx - k.x) * (z / k.z), y: sy - (sy - k.y) * (z / k.z) });
  };
  const zoomBy = f => {
    const r = vp.current.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, f);
  };
  const fitTo = rect => { if (size.w) setCam(fitCam(rect, size.w, size.h, 0.85), { glide: true }); };
  if (apiRef) apiRef.current = { fit, fitTo, zoomBy, toWorld, cam: () => camRef.current || c, size: () => size, el: () => vp.current };

  // Rueda: zoom alrededor del puntero (no dentro de paneles)
  useEffect(() => {
    const el = vp.current;
    const onWheel = e => {
      if (e.target.closest('.ui-layer')) return;
      e.preventDefault();
      const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : e.ctrlKey ? 0.01 : 0.0018));
      zoomAt(e.clientX, e.clientY, f);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Evita el clic que sigue a un arrastre
  useEffect(() => {
    const el = vp.current;
    const onClick = e => { if (Date.now() < suppress.current) { e.stopPropagation(); e.preventDefault(); } };
    const noNative = e => e.preventDefault();
    el.addEventListener('click', onClick, true);
    el.addEventListener('dragstart', noNative);
    return () => { el.removeEventListener('click', onClick, true); el.removeEventListener('dragstart', noNative); };
  }, []);

  const isBackground = t => t === vp.current || t.classList.contains('world') || t.classList.contains('table-bg');

  function onPointerDown(e) {
    const h = handlers.current;
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    const pt = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, pt);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      if (g.current && g.current.mode === 'drag') h.onDragEnd && h.onDragEnd(null, e);
      clearTimeout(g.current && g.current.timer);
      g.current = { mode: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), c0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, cam0: camRef.current || c };
      setMoving(true);
      return;
    }
    const inUi = e.target.closest('.ui-layer');
    const drag = e.button === 1 ? null : (h.resolveDrag ? h.resolveDrag(e.target, e) : null);
    if (inUi && !drag) return;
    if (drag) {
      const touch = e.pointerType === 'touch';
      g.current = { mode: touch ? 'pending-touch' : 'pending-drag', drag, start: pt, id: e.pointerId, inUi: !!inUi };
      if (touch) g.current.timer = setTimeout(() => { const s = g.current; if (s && s.mode === 'pending-touch') { s.mode = 'drag'; capture(s.id); navigator.vibrate && navigator.vibrate(12); h.onDragStart(s.drag, toWorld(s.start.x, s.start.y), s.start); } }, 330);
      return;
    }
    if (h.selectMode || e.shiftKey) {
      g.current = { mode: 'marquee', start: pt, id: e.pointerId, additive: e.shiftKey || e.ctrlKey || e.metaKey };
      return;
    }
    g.current = { mode: 'pan', start: pt, cam0: camRef.current || c, id: e.pointerId, moved: false, onBg: isBackground(e.target) };
  }

  const capture = id => { try { vp.current.setPointerCapture(id); } catch { /* nada */ } };
  function onPointerMove(e) {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const s = g.current;
    if (!s) return;
    const h = handlers.current;
    if (s.mode === 'pinch') {
      const pts = [...pointers.current.values()];
      if (pts.length < 2) return;
      const [a, b] = pts;
      const d1 = Math.hypot(a.x - b.x, a.y - b.y);
      const c1 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const r = vp.current.getBoundingClientRect();
      const z = clampZ(s.cam0.z * (d1 / s.d0));
      const sx = s.c0.x - r.left;
      const sy = s.c0.y - r.top;
      setCam({ z, x: sx - (sx - s.cam0.x) * (z / s.cam0.z) + (c1.x - s.c0.x), y: sy - (sy - s.cam0.y) * (z / s.cam0.z) + (c1.y - s.c0.y) });
      return;
    }
    if (e.pointerId !== s.id) return;
    const dx = e.clientX - s.start.x;
    const dy = e.clientY - s.start.y;
    const dist = Math.hypot(dx, dy);
    if (s.mode === 'pending-drag') {
      if (dist > 5) { capture(e.pointerId); s.mode = 'drag'; h.onDragStart(s.drag, toWorld(s.start.x, s.start.y), s.start); h.onDragMove(toWorld(e.clientX, e.clientY), e); }
    } else if (s.mode === 'pending-touch') {
      if (dist > 9) {
        clearTimeout(s.timer);
        if (s.inUi) { g.current = null; return; } // deja desplazar la lista de la caja
        g.current = { mode: 'pan', start: s.start, cam0: camRef.current || c, id: s.id, moved: true, onBg: false };
        capture(e.pointerId);
        setMoving(true);
      }
    } else if (s.mode === 'drag') {
      h.onDragMove(toWorld(e.clientX, e.clientY), e);
    } else if (s.mode === 'pan') {
      if (dist > 3 && !s.moved) { s.moved = true; capture(e.pointerId); setMoving(true); }
      if (s.moved) setCam({ ...s.cam0, x: s.cam0.x + dx, y: s.cam0.y + dy });
    } else if (s.mode === 'marquee') {
      if (!s.captured) { s.captured = true; capture(e.pointerId); }
      const r = vp.current.getBoundingClientRect();
      setMarquee({ x: Math.min(s.start.x, e.clientX) - r.left, y: Math.min(s.start.y, e.clientY) - r.top, w: Math.abs(dx), h: Math.abs(dy) });
    }
  }

  function onPointerUp(e, cancel) {
    pointers.current.delete(e.pointerId);
    const s = g.current;
    if (!s) return;
    const h = handlers.current;
    if (s.mode === 'pinch') { if (pointers.current.size < 2) { g.current = null; setMoving(false); suppress.current = Date.now() + 350; } return; }
    if (e.pointerId !== s.id) return;
    g.current = null;
    clearTimeout(s.timer);
    setMoving(false);
    if (s.mode === 'drag') { suppress.current = Date.now() + 350; h.onDragEnd(cancel ? null : toWorld(e.clientX, e.clientY), e); return; }
    if (s.mode === 'pan') { if (s.moved) suppress.current = Date.now() + 350; else if (s.onBg && !cancel) h.onBackgroundTap && h.onBackgroundTap(e); return; }
    if (s.mode === 'marquee') {
      setMarquee(null);
      const a = toWorld(s.start.x, s.start.y);
      const b = toWorld(e.clientX, e.clientY);
      if (Math.hypot(e.clientX - s.start.x, e.clientY - s.start.y) > 4) {
        suppress.current = Date.now() + 350;
        h.onMarquee && h.onMarquee({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }, s.additive);
      } else if (isBackground(e.target)) h.onBackgroundTap && h.onBackgroundTap(e);
    }
  }

  // La veta de la madera acompaña el zoom en escalones (así no se redibuja en cada cuadro)
  const tz = Math.pow(2, Math.round(Math.log2(Math.max(0.35, Math.min(2.8, c.z))) * 2) / 2);
  const bg = `--px:${c.x.toFixed(1)}px;--py:${c.y.toFixed(1)}px;--tz:${tz.toFixed(3)}`;
  return html`<div ref=${vp} class=${cls('table-view', className, moving && 'moving', selectMode && 'select-mode')} style=${bg}
      onPointerDown=${onPointerDown} onPointerMove=${onPointerMove} onPointerUp=${onPointerUp} onPointerCancel=${e => onPointerUp(e, true)}>
    <div class=${cls('world', glide && 'glide')} style=${`transform:translate(${c.x.toFixed(1)}px,${c.y.toFixed(1)}px) scale(${c.z.toFixed(4)})`}>
      ${children}
    </div>
    ${marquee ? html`<div class="marquee" style=${`left:${marquee.x}px;top:${marquee.y}px;width:${marquee.w}px;height:${marquee.h}px`}></div>` : null}
    ${overlay}
  </div>`;
}
