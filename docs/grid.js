(function () {
  'use strict';

  const SPACING = 32;    // px, same as the CSS grid
  const FPS     = 30;
  const AMPLITUDE = 1.3;

  // lambda px, period s (sign = direction), angle rad, amp px
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
  if (!ctx) return;
  cv.className = 'gridfield';
  cv.setAttribute('aria-hidden', 'true');

  let W = 0, H = 0, cols = 0, rows = 0, nx = null, ny = null;
  let stroke = null, alpha = 0.13;

  function readTheme() {
    const cs = getComputedStyle(document.documentElement);
    alpha = parseFloat(cs.getPropertyValue('--grid-strength')) || 0.13;
    const stop = (n, fallback) => (cs.getPropertyValue(n).trim() || fallback);
    /* CSS angle: clockwise from "to top" */
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
    cols = Math.ceil(W / SPACING) + 3;
    rows = Math.ceil(H / SPACING) + 3;
    nx = new Float32Array(cols * rows);
    ny = new Float32Array(cols * rows);
    readTheme();
  }

  function draw(t) {
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

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'destination-out';
    const f = ctx.createLinearGradient(0, H / 3, 0, H);
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
  document.documentElement.classList.add('grid-live');
  resize();
  draw(0);
  if (!still.matches) start();

  let pending = 0;
  addEventListener('resize', () => {
    if (pending) return;
    pending = requestAnimationFrame(() => { pending = 0; resize(); draw(last); });
  }, { passive: true });

  addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  still.addEventListener('change', () => { stop(); draw(0); if (!still.matches) start(); });
  new MutationObserver(() => { readTheme(); draw(last); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
})();
