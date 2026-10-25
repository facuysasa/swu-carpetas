// Constantes del juego y utilidades generales

export const ASPECTS = [
  { id: 'Vigilance', es: 'Vigilancia', color: '#2f6bd0' },
  { id: 'Command', es: 'Mando', color: '#2c9a52' },
  { id: 'Aggression', es: 'Agresión', color: '#d23a30' },
  { id: 'Cunning', es: 'Astucia', color: '#e8b52d' },
  { id: 'Villainy', es: 'Villanía', color: '#2a2a2f' },
  { id: 'Heroism', es: 'Heroísmo', color: '#ece6d6' },
];
export const ASPECT = Object.fromEntries(ASPECTS.map(a => [a.id, a]));
export const NEUTRAL_COLOR = '#8a8d93';

export const TYPES = [
  { id: 'Leader', es: 'Líder' },
  { id: 'Base', es: 'Base' },
  { id: 'Unit', es: 'Unidad' },
  { id: 'Event', es: 'Evento' },
  { id: 'Upgrade', es: 'Mejora' },
  { id: 'Token', es: 'Ficha' },
];
export const TYPE = Object.fromEntries(TYPES.map(t => [t.id, t]));

export const RARITIES = [
  { id: 'Legendary', es: 'Legendaria' },
  { id: 'Rare', es: 'Rara' },
  { id: 'Special', es: 'Especial' },
  { id: 'Uncommon', es: 'Infrecuente' },
  { id: 'Common', es: 'Común' },
];
export const RARITY = Object.fromEntries(RARITIES.map(r => [r.id, r]));

export const FAMILIES = [
  { id: 'prestige', es: 'Prestige' },
  { id: 'showcase', es: 'Showcase' },
  { id: 'hyperspace', es: 'Hyperspace' },
  { id: 'promo', es: 'Promo' },
  { id: 'standard', es: 'Normal' },
];
export const FAMILY = Object.fromEntries(FAMILIES.map(f => [f.id, f]));

export const ARENAS = { Ground: 'Terrestre', Space: 'Espacial' };

export function norm(s) {
  return (s == null ? '' : String(s))
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

export function normNum(n) {
  const s = String(n == null ? '' : n).trim().toUpperCase();
  return /^\d+$/.test(s) ? String(parseInt(s, 10)) : s;
}

export function normType(t) {
  if (!t) return null;
  const s = String(t);
  if (/token/i.test(s)) return 'Token';
  for (const x of TYPES) if (s.toLowerCase().startsWith(x.id.toLowerCase())) return x.id;
  return s;
}

export function normRarity(r) {
  if (!r) return null;
  const s = String(r).trim().toLowerCase();
  const map = { c: 'Common', u: 'Uncommon', r: 'Rare', l: 'Legendary', s: 'Special' };
  if (map[s]) return map[s];
  for (const x of RARITIES) if (s.startsWith(x.id.toLowerCase())) return x.id;
  return String(r);
}

const PROMO_SET = /^(P\d\d|C\d\d|J\d\d|G\d\d|GG|SS\d|.*OP|.*OPJ|.*P|TS\d\d)$/;
export function isPromoSet(set) {
  const S = String(set || '').toUpperCase();
  return PROMO_SET.test(S) && !['SOR', 'SHD', 'TWI', 'JTL', 'LOF', 'SEC', 'LAW', 'ASH', 'HMW', 'IBH'].includes(S);
}

export function variantFamily(variant, set) {
  const v = norm(variant);
  if (v.includes('prestige') || v.includes('serial')) return 'prestige';
  if (v.includes('showcase')) return 'showcase';
  if (v.includes('hyperspace')) return 'hyperspace';
  if (/weekly|promo|top ?\d|participation|judge|prerelease|event|convention|store|ss /.test(v)) return 'promo';
  if (isPromoSet(set)) return 'promo';
  return 'standard';
}

export function vtagOf(variant) {
  const m = /top\s*(\d+)/i.exec(String(variant || ''));
  return m ? 'top' + m[1] : '';
}

export function printingKey(set, num, foil, vtag) {
  return `${String(set).toUpperCase()}-${normNum(num)}${foil ? '-F' : ''}${vtag ? '-' + vtag : ''}`;
}

const moneyFmt = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
export function money(n) {
  if (n == null || !isFinite(n)) return '—';
  return moneyFmt.format(n);
}

export function parsePrice(x) {
  if (x == null) return null;
  let s = String(x).trim();
  if (!s || /n\/?a/i.test(s)) return null;
  s = s.replace(/[^0-9.,\-]/g, '');
  if (s.includes(',') && !s.includes('.')) s = s.replace(',', '.');
  else s = s.replace(/,/g, '');
  const v = parseFloat(s);
  return isFinite(v) ? v : null;
}

export function uid(prefix = 'x') {
  return prefix + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 7);
}

export function cls(...a) {
  return a.filter(Boolean).join(' ');
}

export function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

export function debounce(fn, ms) {
  let t;
  const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  f.flush = (...a) => { clearTimeout(t); fn(...a); };
  return f;
}

export function plural(n, one, many) {
  return `${n.toLocaleString('es-AR')} ${n === 1 ? one : many}`;
}

export function downloadText(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export function readFileText(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsText(file);
  });
}

export function resizeImage(file, maxW = 720, quality = 0.8) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / img.naturalWidth);
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      res(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = rej;
    img.src = URL.createObjectURL(file);
  });
}

// Posición de un bolsillo dentro de una carpeta
export function slotPos(binder, idx) {
  const per = binder.rows * binder.cols;
  const face = Math.floor(idx / per) + 1;
  const p = idx % per;
  return { face, row: Math.floor(p / binder.cols), col: p % binder.cols, n: p + 1 };
}
export function facesOf(binder) {
  return binder.sheets * 2;
}
export function capacityOf(binder) {
  return facesOf(binder) * binder.rows * binder.cols;
}
