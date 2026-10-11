// "Shattering" effect for a deleted tile: the tile is cut into jittered triangular shards
// (clones of the tile clipped with clip-path) which fly apart, spin and fall while fading out.
const rnd = (a, b) => a + Math.random() * (b - a);

export function shatter(tile) {
  const r = tile.getBoundingClientRect();
  if (!r.width || !r.height || matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();
  const W = r.width, H = r.height;
  const cols = 5, rows = 4, jit = 0.3;

  // vertex grid; inner vertices are shifted randomly so the cracks look irregular
  const V = [];
  for (let j = 0; j <= rows; j++) {
    V[j] = [];
    for (let i = 0; i <= cols; i++) {
      let x = i / cols, y = j / rows;
      if (i > 0 && i < cols) x += rnd(-jit, jit) / cols;
      if (j > 0 && j < rows) y += rnd(-jit, jit) / rows;
      V[j][i] = [x, y];
    }
  }
  const shards = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = V[j][i], b = V[j][i + 1], c = V[j + 1][i + 1], d = V[j + 1][i];
      if (Math.random() < 0.5) shards.push([a, b, c], [a, c, d]);
      else shards.push([a, b, d], [b, c, d]);
    }
  }

  const holder = document.createElement('div');
  holder.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${W}px;height:${H}px;pointer-events:none;z-index:85`;
  const proto = tile.cloneNode(true);
  proto.querySelectorAll('.tools').forEach((n) => n.remove());
  proto.classList.remove('dragging', 'drop-into', 'drop-before', 'drop-after');
  proto.removeAttribute('draggable');
  proto.style.cssText = `position:absolute;left:0;top:0;margin:0;transform:none;transition:none;width:${W}px;height:${H}px`;

  const anims = [];
  shards.forEach((pts) => {
    const s = proto.cloneNode(true);
    const cx = (pts[0][0] + pts[1][0] + pts[2][0]) / 3, cy = (pts[0][1] + pts[1][1] + pts[2][1]) / 3;
    s.style.clipPath = 'polygon(' + pts.map((p) => `${(p[0] * 100).toFixed(2)}% ${(p[1] * 100).toFixed(2)}%`).join(',') + ')';
    s.style.transformOrigin = `${(cx * 100).toFixed(1)}% ${(cy * 100).toFixed(1)}%`;
    holder.append(s);

    const dx = (cx - 0.5) * W * rnd(0.5, 1.2) + rnd(-25, 25);
    const up = -rnd(8, 50) * (1 - cy);                 // upper pieces jump a little
    const fall = H * rnd(0.9, 2.1);
    const rot = rnd(-70, 70);
    const dist = Math.hypot(cx - 0.5, cy - 0.5);        // pieces near the "impact" in the centre go first
    anims.push(s.animate([
      { transform: 'translate(0,0) rotate(0deg) scale(1)', opacity: 1, offset: 0 },
      { transform: `translate(${dx * 0.35}px,${up}px) rotate(${rot * 0.3}deg) scale(1)`, opacity: 1, offset: 0.28 },
      { transform: `translate(${dx}px,${fall}px) rotate(${rot}deg) scale(.7)`, opacity: 0, offset: 1 },
    ], { duration: rnd(650, 950), delay: dist * 140 + rnd(0, 60), easing: 'cubic-bezier(.4,.1,.7,1)', fill: 'both' }));
  });

  document.body.append(holder);
  tile.style.visibility = 'hidden';                     // the shards take its place in the same frame
  return Promise.all(anims.map((a) => a.finished.catch(() => {}))).then(() => holder.remove());
}
