// Geometría de la mesa. La unidad es aproximadamente un milímetro real:
// una carta mide 63 × 88 y un bolsillo, 66 de ancho.
import { activeVersion } from './store.js';
import { capacityOf } from './util.js';

export const CARD_W = 63;
export const CARD_H = 88;

// Proporciones de una página (relativas a su ancho)
export function geometry(binder) {
  const pad = 0.045;
  const gc = 0.042;
  const gr = 0.018;
  const ratio = 92 / 66;
  const pw = (1 - 2 * pad - (binder.cols - 1) * gc) / binder.cols;
  const fh = 2 * pad + binder.rows * pw * ratio + (binder.rows - 1) * gr;
  return { pad, gc, gr, pw, ph: pw * ratio, fh, edge: 0.034, spine: 0.03 };
}

// Medidas de la carpeta sobre la mesa
export function binderSize(binder) {
  const g = geometry(binder);
  const fw = 66 / g.pw;
  const halfW = fw * (1 + g.edge + g.spine / 2);
  const h = fw * (g.fh + 2 * g.edge);
  const px = v => `${(v * fw).toFixed(2)}px`;
  const vars = `--fw:${fw.toFixed(2)}px;--fh:${px(g.fh)};--pad:${px(g.pad)};--gc:${px(g.gc)};--gr:${px(g.gr)};--pw:${px(g.pw)};--ph:${px(g.ph)};--edge:${px(g.edge)};--spine:${px(g.spine)};--cols:${binder.cols};--rows:${binder.rows}`;
  return { fw, halfW, h, vars, g };
}

// Caja de mazo parada sobre la mesa: frente, tapa y costado (la profundidad depende de la capacidad)
export function boxSize(box) {
  const W = 76;
  const H = 100;
  const depth = Math.max(30, Math.min(90, 12 + (box.cap || 80) * 0.55));
  const sideW = Math.round(depth * 0.55);
  const topH = Math.round(depth * 0.42);
  return { W, H, sideW, topH, w: W + sideW, h: H + topH, skx: -Math.atan(sideW / topH) * 180 / Math.PI, sky: -Math.atan(topH / sideW) * 180 / Math.PI };
}

// Dónde está cada carpeta y cada caja en la mesa (la guardada o una fila automática)
export function binderLayout(state) {
  const out = new Map();
  const pos = (state.table && state.table.pos) || {};
  let x = 0;
  let bottom = 330;
  for (const b of state.binders) {
    const s = binderSize(b);
    const p = pos[b.id] || { x, y: 0 };
    out.set(b.id, { x: p.x, y: p.y, w: s.halfW, h: s.h, kind: 'binder' });
    bottom = Math.max(bottom, s.h);
    x = Math.max(x, p.x + s.halfW) + 120;
  }
  for (const bx of state.boxes || []) {
    const s = boxSize(bx);
    const p = pos[bx.id] || { x, y: bottom - s.h };
    out.set(bx.id, { x: p.x, y: p.y, w: s.w, h: s.h, kind: 'box' });
    x = Math.max(x, p.x + s.w) + 90;
  }
  out.newSlot = { x, y: 0, w: 240, h: 320 };
  out.newBox = { x: x + 290, y: bottom - 150, w: 130, h: 150 };
  return out;
}

export function unionRect(rects, pad = 0) {
  if (!rects.length) return { x: -200, y: -150, w: 400, h: 300 };
  const x0 = Math.min(...rects.map(r => r.x)) - pad;
  const y0 = Math.min(...rects.map(r => r.y)) - pad;
  const x1 = Math.max(...rects.map(r => r.x + r.w)) + pad;
  const y1 = Math.max(...rects.map(r => r.y + r.h)) + pad;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// Bolsillos vacíos de una página, empezando por el elegido y dando la vuelta dentro de la página
export function emptyOnFace(binder, face, startIdx) {
  const per = binder.rows * binder.cols;
  const base = (face - 1) * per;
  const slots = activeVersion(binder).slots;
  const start = startIdx != null ? startIdx - base : 0;
  const out = [];
  for (let i = 0; i < per; i++) {
    const idx = base + ((start + i) % per);
    if (!slots[idx]) out.push(idx);
  }
  return out;
}

export function emptyInBinder(binder, n) {
  const slots = activeVersion(binder).slots;
  const cap = capacityOf(binder);
  const out = [];
  for (let i = 0; i < cap && out.length < n; i++) if (!slots[i]) out.push(i);
  return out;
}
