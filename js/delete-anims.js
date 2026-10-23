// Tile-deletion animations. The user picks one in Settings > Animation (setting `deleteAnim`).
//   startDelete(id, tile, host) -> { ready, done }
//     ready: resolves when the tile may be removed from the DOM (the page then re-renders and the other tiles slide in)
//     done : resolves when the whole effect (flying pieces etc.) is over
//   host: omitted for a real tile (effects are drawn in a fixed overlay on <body>);
//         an element with position:relative for the preview inside the settings window (effects are drawn inside it).
import { shatter } from './shatter.js';

export const DEFAULT_ANIM = 'dust';
export const DELETE_ANIMS = [
  ['fade', 'Fade and shrink'],
  ['pop', 'Pop'],
  ['dissolve', 'Dissolve'],
  ['tv', 'TV off'],
  ['shatter', 'Shatter'],
  ['dust', 'Disintegrate'],
  ['poof', 'Poof'],
];

const rnd = (a, b) => a + Math.random() * (b - a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (el, kf, o) => el.animate(kf, { fill: 'forwards', ...o }).finished.catch(() => {});

// An overlay exactly over the tile; everything that flies around is drawn in it.
function layerFor(tile, host) {
  const r = tile.getBoundingClientRect();
  let x = r.left, y = r.top, pos = 'fixed';
  if (host) { const h = host.getBoundingClientRect(); x -= h.left; y -= h.top; pos = 'absolute'; }
  const layer = document.createElement('div');
  layer.style.cssText = `position:${pos};left:${x}px;top:${y}px;width:${r.width}px;height:${r.height}px;pointer-events:none;z-index:85`;
  (host || document.body).append(layer);
  return { layer, W: r.width, H: r.height };
}
// A clean copy of the tile that pieces are cut from.
function protoOf(tile, W, H) {
  const c = tile.cloneNode(true);
  c.querySelectorAll('.tools').forEach((n) => n.remove());
  c.classList.remove('dragging', 'drop-into', 'drop-before', 'drop-after', 'kb-sel');
  c.removeAttribute('draggable');
  c.style.cssText = `position:absolute;left:0;top:0;margin:0;transform:none;transition:none;visibility:visible;width:${W}px;height:${H}px`;
  return c;
}
// Cuts the tile into cols x rows rectangles; fn(piece, row, col, cols, rows, scale) must start an animation and return its promise.
function pieces(tile, host, cols, rows, fn) {
  const { layer, W, H } = layerFor(tile, host);
  const base = protoOf(tile, W, H), w = W / cols, h = H / rows, k = Math.min(2, Math.max(0.8, W / 128)), jobs = [];
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const p = document.createElement('div');
      p.style.cssText = `position:absolute;overflow:hidden;left:${j * w}px;top:${i * h}px;width:${w + 0.5}px;height:${h + 0.5}px`;
      const c = base.cloneNode(true);
      c.style.left = -j * w + 'px'; c.style.top = -i * h + 'px';
      p.append(c); layer.append(p);
      jobs.push(fn(p, i, j, cols, rows, k));
    }
  }
  tile.style.visibility = 'hidden';                      // the pieces take its place in the same frame
  return Promise.all(jobs).then(() => layer.remove());
}

const own = (p) => ({ ready: p, done: p });             // effect played on the tile itself

const EFFECTS = {
  fade: (t) => own(run(t, [{ transform: 'none', opacity: 1 }, { transform: 'scale(.6)', opacity: 0 }], { duration: 280, easing: 'ease-in' })),
  pop: (t) => own(run(t, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.12)', opacity: 1, offset: 0.35 }, { transform: 'scale(0)', opacity: 0 }], { duration: 380, easing: 'ease-in-out' })),
  dissolve: (t) => own(run(t, [{ transform: 'none', opacity: 1, filter: 'blur(0)' }, { transform: 'scale(1.12)', opacity: 0, filter: 'blur(10px)' }], { duration: 500, easing: 'ease-out' })),
  tv: (t) => own(run(t, [
    { transform: 'scale(1,1)', opacity: 1, filter: 'brightness(1)' },
    { transform: 'scale(1,.03)', opacity: 1, filter: 'brightness(2)', offset: 0.55 },
    { transform: 'scale(0,.03)', opacity: 0, filter: 'brightness(2)' },
  ], { duration: 480, easing: 'ease-in' })),
  shatter: (t, host) => ({ ready: sleep(380), done: shatter(t, host) }),
  dust: (t, host) => {
    const cols = 16, rows = Math.max(6, Math.round(cols * t.getBoundingClientRect().height / Math.max(1, t.getBoundingClientRect().width)));
    const done = pieces(t, host, cols, rows, (p, i, j, C, R, k) => run(p, [
      { transform: 'none', opacity: 1 },
      { transform: `translate(${rnd(10, 50) * k}px,${rnd(-40, -10) * k}px) rotate(${rnd(-40, 40)}deg) scale(.4)`, opacity: 0 },
    ], { duration: rnd(500, 800), delay: j * 22 + rnd(0, 120), easing: 'ease-out' }));
    return { ready: sleep(350), done };
  },
  poof: (t, host) => {
    const { layer, W, H } = layerFor(t, host), k = Math.min(2, Math.max(0.8, W / 128));
    const jobs = [run(t, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(0)', opacity: 0 }], { duration: 260, easing: 'ease-in' })];
    for (let n = 0; n < 14; n++) {
      const d = document.createElement('div'), a = (n / 14) * Math.PI * 2 + rnd(-0.2, 0.2), dist = rnd(46, 86) * k, z = rnd(8, 16) * k;
      d.style.cssText = `position:absolute;border-radius:50%;background:rgba(215,215,225,.9);pointer-events:none;width:${z}px;height:${z}px;left:${W / 2 - z / 2}px;top:${H / 2 - z / 2}px`;
      layer.append(d);
      jobs.push(run(d, [{ transform: 'scale(.4)', opacity: 0.9 }, { transform: `translate(${Math.cos(a) * dist}px,${Math.sin(a) * dist}px) scale(1.2)`, opacity: 0 }], { duration: 520, delay: 120, easing: 'ease-out' }));
    }
    return { ready: sleep(300), done: Promise.all(jobs).then(() => layer.remove()) };
  },
};

export function startDelete(id, tile, host) {
  return (EFFECTS[id] || EFFECTS[DEFAULT_ANIM])(tile, host);
}
// Real deletion: plays the effect and resolves when the tile can be removed.
export async function playDelete(id, tile) {
  await startDelete(id, tile).ready;       // (the callers check the Animations settings, which already respect "reduce motion" in Auto)
}
