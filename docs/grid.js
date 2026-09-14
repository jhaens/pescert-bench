/* =============================================================================
 * Background lattice
 *
 * The static CSS grid in `styles.css` is a fixed 32px mesh.  This replaces it with
 * the same mesh drawn on a canvas, with every node displaced from its equilibrium
 * site by a superposition of three plane waves:
 *
 *     u(r, t) = SUM_s  A_s k^_s sin(k_s . r - w_s t)
 *
 * The waves are longitudinal (displacement along k) and their wavelengths are an
 * order of magnitude longer than the lattice constant, so neighbouring nodes move
 * almost together: the lattice breathes rather than shimmering.  Amplitudes sum to
 * 1.6px on a 32px mesh -- a 5% distortion, which is about the threshold of notice.
 *
 * It is progressive enhancement, and deliberately cheap to remove: drop the
 * <script> tag and the CSS grid underneath is what renders.  Nothing else on the
 * page reads from here.
 *
 * Costs: one 30fps canvas repaint of the viewport, paused whenever the tab is
 * hidden, and skipped entirely under prefers-reduced-motion (one static frame).
 * ========================================================================== */

(function () {
  'use strnict';

  const SPACING = 32;    // lattice constant, matching the CSS fallback
  const FADE_PX = 680;   // ... and the distance over which it fades out
  const FPS     = 30;

  /* wavelength and period are the readable parameters; k, omega and the
     polarisation vector are derived from them once, here. */
  const WAVES = [
    { lambda: 520, period: 19, angle:  0.40, amp: 0.7 },
    { lambda: 380, period: 14, angle:  2.20, amp: 0.5 },
    { lambda: 700, period: 25, angle: -1.10, amp: 0.4 }
  ].map((w) => ({
    kx: Math.cos(w.angle) * 2 * Math.PI / w.lambda,
    ky: Math.sin(w.angle) * 2 * Math.PI / w.lambda,
    om: 2 * Math.PI / (w.period * 1000),
    ax: Math.cos(w.angle) * w.amp,          /* longitudinal: u || k */
    ay: Math.sin(w.angle) * w.amp
  }));

  const cv = document.createElement('canvas');
  const ctx = cv.getContext && cv.getContext('2d');
  if (!ctx) return;                          /* no canvas: keep the CSS grid */
  cv.className = 'gridfield';
  cv.setAttribute('aria-hidden', 'true');

  let W = 0, H = 0, cols = 0, rows = 0, nx = null, ny = null;
  let stroke = null, alpha = 0.13;

  /* Colours and strength come from the same custom properties the CSS grid used,
     so the two stay in step and a theme switch needs no second definition. */
  function readTheme() {
    const cs = getComputedStyle(document.documentElement);
    alpha = parseFloat(cs.getPropertyValue('--grid-strength')) || 0.13;
    const stop = (n, fallback) => (cs.getPropertyValue(n).trim() || fallback);
    /* CSS angles run clockwise from "to top", hence (sin, -cos) */
    const a = 118 * Math.PI / 180, ux = Math.sin(a), uy = -Math.cos(a);
    const L = Math.abs(W * ux) + Math.abs(H * uy);
    const g = ctx.createLinearGradient(W / 2 - ux * L / 2, H / 2 - uy * L / 2,
                                       W / 2 + ux * L / 2, H / 2 + uy * L / 2);
    g.addColorStop(0,    stop('--mark-1', '#5b9cf5'));
    g.addColorStop(0.55, stop('--mark-2', '#7b6ef0'));
    g.addColorStop(1,    stop('--mark-3', '#a061ee'));
    stroke = g;
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    /* one ring of nodes beyond each edge, so a displaced line never ends in view */
    cols = Math.ceil(W / SPACING) + 3;
    rows = Math.ceil(H / SPACING) + 3;
    nx = new Float32Array(cols * rows);
    ny = new Float32Array(cols * rows);
    readTheme();
  }

  function draw(t) {
    /* 1. where every node is now */
    for (let j = 0; j < rows; j++) {
      const y0 = (j - 1) * SPACING + 0.5;
      for (let i = 0; i < cols; i++) {
        const x0 = (i - 1) * SPACING + 0.5;
        let dx = 0, dy = 0;
        for (let s = 0; s < WAVES.length; s++) {
          const w = WAVES[s];
          const u = Math.sin(w.kx * x0 + w.ky * y0 - w.om * t);
          dx += w.ax * u; dy += w.ay * u;
        }
        const k = j * cols + i;
        nx[k] = x0 + dx; ny[k] = y0 + dy;
      }
    }

    /* 2. the mesh: one polyline per row, one per column, all in a single path */
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i;
        if (i === 0) ctx.moveTo(nx[k], ny[k]); else ctx.lineTo(nx[k], ny[k]);
      }
    }
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const k = j * cols + i;
        if (j === 0) ctx.moveTo(nx[k], ny[k]); else ctx.lineTo(nx[k], ny[k]);
      }
    }
    ctx.stroke();

    /* 3. fade it out down the page, as the CSS grid does.  Past FADE_PX the
          gradient holds its last stop, so one rect erases the whole lower page. */
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'destination-out';
    const f = ctx.createLinearGradient(0, 0, 0, FADE_PX);
    f.addColorStop(0, 'rgba(0,0,0,0)');
    f.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = f;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
  }

  const still = matchMedia('(prefers-reduced-motion: reduce)');
  let raf = 0, last = -1e9;

  function frame(ts) {
    raf = requestAnimationFrame(frame);
    if (ts - last < 1000 / FPS) return;
    last = ts;
    draw(ts);
  }
  function start() {
    if (raf || still.matches) return;
    last = -1e9;
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  document.body.insertBefore(cv, document.body.firstChild);
  document.documentElement.classList.add('grid-live');   /* hides the CSS grid */
  resize();
  draw(0);
  if (!still.matches) start();

  /* a resize reallocates the node arrays, so coalesce bursts into one frame */
  let pending = 0;
  addEventListener('resize', () => {
    if (pending) return;
    pending = requestAnimationFrame(() => { pending = 0; resize(); draw(last); });
  }, { passive: true });

  addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  still.addEventListener('change', () => { stop(); draw(0); if (!still.matches) start(); });
  /* the theme toggle only rewrites data-theme on <html> */
  new MutationObserver(() => { readTheme(); draw(last); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
})();
