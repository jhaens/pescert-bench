/* =============================================================================
 * Background lattice
 *
 * The static CSS grid in `styles.css` is a fixed 32px mesh.  This replaces it with
 * the same mesh drawn on a canvas, with every node displaced from its equilibrium
 * site by a superposition of eight plane waves:
 *
 *     u(r, t) = SUM_s  A_s e^_s sin(k_s . r - w_s t + phi_s)
 *
 * Three things keep that from looking like one wave crossing the page:
 *
 *   - the eight k vectors point all round the circle, so there is no direction of
 *     travel to pick out, only the 2D interference of everything at once;
 *   - half are longitudinal (e || k) and half transverse (e perp k), which adds
 *     shear to what would otherwise be pure compression;
 *   - the periods are mutually incommensurate and unrelated to the wavelengths, so
 *     there is no common wave speed and the pattern never repeats.
 *
 * What survives is local: wavelengths are 150-420px against a 32px lattice, so any
 * two neighbouring nodes still move almost together.  Zoomed out the field looks
 * uncorrelated, close up it is smooth.  RMS displacement is about 5% of the lattice
 * constant, peaks near 13%.
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

  /* One knob for how alive the lattice is.  The per-wave amplitudes below are
     relative; this scales all of them.  0 freezes it, 2 is distracting. */
  const AMPLITUDE = 1.3;

  /* Wavelength (px), period (s), direction (rad), amplitude (px), polarisation and
     phase are the readable parameters; k, omega and the polarisation vector are
     derived from them once, here.  `period` is signed: a negative one runs the wave
     backwards, so the set does not drift one way on average. */
  const WAVES = [
    { lambda: 310, period:  6.5, angle:  0.35, amp: 0.85, pol: 'L', phase: 0.0 },
    { lambda: 190, period: -4.4, angle:  2.10, amp: 0.60, pol: 'T', phase: 1.7 },
    { lambda: 420, period:  9.1, angle: -1.25, amp: 0.75, pol: 'L', phase: 3.4 },
    { lambda: 150, period:  3.7, angle:  4.05, amp: 0.45, pol: 'T', phase: 5.1 },
    { lambda: 260, period: -7.3, angle:  1.55, amp: 0.65, pol: 'L', phase: 2.2 },
    { lambda: 350, period:  5.2, angle: -2.60, amp: 0.55, pol: 'T', phase: 4.8 },
    { lambda: 210, period: 11.0, angle:  0.95, amp: 0.50, pol: 'L', phase: 0.9 },
    { lambda: 175, period: -8.2, angle:  3.30, amp: 0.40, pol: 'T', phase: 6.0 }
  ].map((w) => {
    const c = Math.cos(w.angle), s = Math.sin(w.angle);
    /* longitudinal displaces along k, transverse across it */
    const ex = w.pol === 'L' ? c : -s;
    const ey = w.pol === 'L' ? s :  c;
    return {
      kx: c * 2 * Math.PI / w.lambda,
      ky: s * 2 * Math.PI / w.lambda,
      om: 2 * Math.PI / (w.period * 1000),
      ph: w.phase,
      ax: ex * w.amp * AMPLITUDE,
      ay: ey * w.amp * AMPLITUDE
    };
  });

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
          const u = Math.sin(w.kx * x0 + w.ky * y0 - w.om * t + w.ph);
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
