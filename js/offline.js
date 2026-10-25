// Imágenes de tus cartas guardadas en el dispositivo, para usar la app sin conexión.
// Se guardan en el almacenamiento de la app (Cache Storage) y el service worker las sirve sin internet.
const IMG_CACHE = 'carpetas-imagenes-v1';
const MAP_KEY = 'swu-carpetas:img-offline:v1';
const PREF_KEY = 'swu-carpetas:offline-pref:v1';

export const offlineCapable = () => typeof caches !== 'undefined' && 'serviceWorker' in navigator && !window.SWU_STANDALONE
  && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname));

let map = {};
try { map = JSON.parse(localStorage.getItem(MAP_KEY) || '{}'); } catch { map = {}; }
let saveT = null;
function saveMap() {
  clearTimeout(saveT);
  saveT = setTimeout(() => { try { localStorage.setItem(MAP_KEY, JSON.stringify(map)); } catch { /* sin espacio */ } }, 400);
}

// Imagen ya guardada para una carta (sin conexión se usa primero)
export const savedUrl = (key, back) => map[back ? key + '#b' : key] || null;

export function offlineEnabled() {
  try { return JSON.parse(localStorage.getItem(PREF_KEY) ?? 'true'); } catch { return true; }
}
export function setOfflineEnabled(v) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(!!v)); } catch { /* nada */ }
}

export const imgJob = { running: false, done: 0, total: 0, failed: 0, error: '' };
const subs = new Set();
export function onImgJob(f) { subs.add(f); return () => subs.delete(f); }
const emit = () => subs.forEach(f => f({ ...imgJob }));

function loadImage(url, ms = 20000) {
  return new Promise(res => {
    const im = new Image();
    const t = setTimeout(() => { im.src = ''; res(false); }, ms);
    im.onload = () => { clearTimeout(t); res(im.naturalWidth > 0); };
    im.onerror = () => { clearTimeout(t); res(false); };
    im.src = url;
  });
}

// Si el sitio lo permite, se guarda una versión más liviana (WebP de 600 px de ancho)
async function shrink(blob) {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, 600 / Math.max(bmp.width, bmp.height * 0.72));
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
    const out = canvas.convertToBlob ? await canvas.convertToBlob({ type: 'image/webp', quality: 0.82 }) : await new Promise(r => canvas.toBlob(r, 'image/webp', 0.82));
    return out && out.size && out.size < blob.size ? out : blob;
  } catch { return blob; }
}

async function cacheUrl(cache, url) {
  if (await cache.match(url)) return true;
  if (!(await loadImage(url))) return false; // solo se guarda lo que de verdad es una imagen
  let res = null;
  try {
    const r = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (r.ok) { const small = await shrink(await r.blob()); res = new Response(small, { headers: { 'Content-Type': small.type || 'image/png' } }); }
  } catch { res = null; }
  if (!res) { try { res = await fetch(url, { mode: 'no-cors', credentials: 'omit' }); } catch { return false; } }
  try { await cache.put(url, res); return true; } catch (e) { if (e && e.name === 'QuotaExceededError') throw e; return false; }
}

const WEEK = 7 * 864e5;
const failedRecently = (k, url) => { const f = map[k + '#x']; if (!f) return false; const [u, t] = f.split('|'); return u === url && Date.now() - Number(t) < WEEK; };

// ¿Falta guardar algo de esta carta? (o hay una imagen preferida mejor, por ejemplo al cambiar el idioma)
function needs(info) {
  const sides = [['', info.front || []]];
  if (info.doubleSided && info.back && info.back.length) sides.push(['#b', info.back]);
  return sides.some(([sfx, urls]) => { const k = info.key + sfx; return urls[0] && map[k] !== urls[0] && !failedRecently(k, urls[0]); });
}

async function cacheCard(cache, info) {
  const sides = [['', info.front || []]];
  if (info.doubleSided && info.back && info.back.length) sides.push(['#b', info.back]);
  let ok = true;
  for (const [suffix, urls] of sides) {
    const k = info.key + suffix;
    const have = map[k] && (await cache.match(map[k]));
    if (have && (map[k] === urls[0] || failedRecently(k, urls[0]))) continue;
    let got = null;
    for (const url of have ? [urls[0]] : urls) { if (url && (await cacheUrl(cache, url))) { got = url; break; } }
    if (got) { map[k] = got; delete map[k + '#x']; } else { map[k + '#x'] = `${urls[0]}|${Date.now()}`; if (!have) ok = false; }
    saveMap();
  }
  return ok;
}

async function cleanup(cache, infos) {
  const keep = new Set(infos.map(i => i.key));
  const used = new Set();
  for (const [k, url] of Object.entries(map)) {
    if (!keep.has(k.replace(/#[bx]$/, ''))) { delete map[k]; continue; }
    if (!k.endsWith('#x')) used.add(url);
  }
  for (const req of await cache.keys()) if (!used.has(req.url)) await cache.delete(req);
  saveMap();
}

export function requestPersist() {
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch { /* nada */ }
}

// Guarda las imágenes de toda la colección (en segundo plano, de a cuatro a la vez)
export async function cacheCollection(infos) {
  if (!offlineCapable() || !offlineEnabled() || imgJob.running || !navigator.onLine || !infos.length) return;
  requestPersist();
  const cache = await caches.open(IMG_CACHE);
  // Si el navegador borró las imágenes (por falta de espacio), se empieza de nuevo
  if (Object.keys(map).some(k => !k.endsWith('#x')) && !(await cache.keys()).length) { map = {}; saveMap(); }
  const todo = infos.filter(needs).sort((a, b) => (b.placed ? 1 : 0) - (a.placed ? 1 : 0));
  if (!todo.length) { await cleanup(cache, infos); return; }
  Object.assign(imgJob, { running: true, done: 0, total: todo.length, failed: 0, error: '' });
  emit();
  const queue = todo.slice();
  const worker = async () => {
    while (queue.length && imgJob.running) {
      if (!navigator.onLine) { imgJob.error = 'Se cortó la conexión: sigo cuando vuelva.'; imgJob.running = false; break; }
      const info = queue.shift();
      try { if (!(await cacheCard(cache, info))) imgJob.failed++; } catch (e) {
        imgJob.error = e && e.name === 'QuotaExceededError' ? 'No queda espacio en el dispositivo para más imágenes.' : 'No se pudieron guardar algunas imágenes.';
        imgJob.running = false;
        break;
      }
      imgJob.done++;
      if (imgJob.done % 5 === 0 || !queue.length) emit();
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  // Se liberan las imágenes de cartas que ya no están en la colección
  if (!imgJob.error) await cleanup(cache, infos);
  imgJob.running = false;
  emit();
}

export function stopImageJob() { imgJob.running = false; emit(); }

// Una carta que se vio con conexión se guarda sola (por si se agregó a mano o cambió de imagen)
const pending = new Set();
export function noteLoaded(info, back) {
  if (!offlineCapable() || !offlineEnabled() || imgJob.running || !info || info.missing || pending.has(info.key)) return;
  if (savedUrl(info.key, back) === (back ? info.back : info.front)[0]) return;
  pending.add(info.key);
  setTimeout(async () => {
    try { const cache = await caches.open(IMG_CACHE); await cacheCard(cache, info); } catch { /* nada */ }
    pending.delete(info.key);
  }, 1500);
}

export function offlineStats(infos) {
  let saved = 0;
  for (const i of infos) if (map[i.key] && !String(map[i.key]).includes('|')) saved++;
  return { saved, total: infos.length };
}

export async function storageUsage() {
  try { const e = await navigator.storage.estimate(); return e.usage || 0; } catch { return 0; }
}

export async function clearImages() {
  try { await caches.delete(IMG_CACHE); } catch { /* nada */ }
  map = {};
  saveMap();
}
