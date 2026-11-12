// Hero background: a drifting sample of points joined to their near
// neighbors. The cursor behaves like a new observation: nearby points lean
// toward it and their links light up in the accent color.
// Plain canvas, no library. Pauses when hidden or off screen, draws a single
// still frame when the visitor prefers reduced motion.
(function () {
  'use strict';

  var host = document.querySelector('.net-host');
  if (!host || !host.getContext && !document.createElement('canvas').getContext) return;

  var canvas = document.createElement('canvas');
  canvas.className = 'net';
  canvas.setAttribute('aria-hidden', 'true');
  host.insertBefore(canvas, host.firstChild);
  var ctx = canvas.getContext('2d');

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  var LINK = 130;          // px, link distance
  var REACH = 190;         // px, cursor influence
  var pts = [], w = 0, h = 0, dpr = 1;
  var mouse = { x: -9999, y: -9999, on: false };
  var running = false, visible = true, raf = 0;
  var col = {};

  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    col.dot = cs.getPropertyValue('--net-dot').trim() || 'rgba(157,171,191,.55)';
    col.line = cs.getPropertyValue('--net-line').trim() || '157,171,191';
    col.hot = cs.getPropertyValue('--net-hot').trim() || '110,231,183';
  }

  function size() {
    var r = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = Math.max(1, Math.round(r.width));
    h = Math.max(1, Math.round(r.height));
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var cap = w < 700 ? 36 : 150;
    var n = Math.min(cap, Math.round((w * h) / 9500));
    pts = [];
    for (var i = 0; i < n; i++) {
      pts.push({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.28, vy: (Math.random() - 0.5) * 0.28,
        r: 1.2 + Math.random() * 1.6
      });
    }
  }

  function step() {
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (mouse.on) {
        var dx = mouse.x - p.x, dy = mouse.y - p.y, d2 = dx * dx + dy * dy;
        if (d2 < REACH * REACH && d2 > 400) {
          var d = Math.sqrt(d2), pull = (1 - d / REACH) * 0.012;
          p.vx += (dx / d) * pull; p.vy += (dy / d) * pull;
        }
      }
      p.vx *= 0.992; p.vy *= 0.992;
      var sp = Math.abs(p.vx) + Math.abs(p.vy);
      if (sp < 0.08) { p.vx += (Math.random() - 0.5) * 0.05; p.vy += (Math.random() - 0.5) * 0.05; }
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > w) { p.vx = -p.vx; p.x = Math.max(0, Math.min(w, p.x)); }
      if (p.y < 0 || p.y > h) { p.vy = -p.vy; p.y = Math.max(0, Math.min(h, p.y)); }
    }
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);
    var L2 = LINK * LINK, R2 = REACH * REACH, i, j, a, b, dx, dy, d2;
    ctx.lineWidth = 1;
    for (i = 0; i < pts.length; i++) {
      a = pts[i];
      for (j = i + 1; j < pts.length; j++) {
        b = pts[j];
        dx = a.x - b.x; if (dx > LINK || dx < -LINK) continue;
        dy = a.y - b.y; if (dy > LINK || dy < -LINK) continue;
        d2 = dx * dx + dy * dy; if (d2 > L2) continue;
        var alpha = (1 - d2 / L2) * 0.22, rgb = col.line;
        if (mouse.on) {
          var mx = (a.x + b.x) / 2 - mouse.x, my = (a.y + b.y) / 2 - mouse.y, m2 = mx * mx + my * my;
          if (m2 < R2) { rgb = col.hot; alpha = Math.min(0.85, alpha + (1 - m2 / R2) * 0.6); }
        }
        ctx.strokeStyle = 'rgba(' + rgb + ',' + alpha.toFixed(3) + ')';
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
    }
    for (i = 0; i < pts.length; i++) {
      a = pts[i];
      var hot = false;
      if (mouse.on) { dx = a.x - mouse.x; dy = a.y - mouse.y; hot = dx * dx + dy * dy < R2 * 0.45; }
      ctx.fillStyle = hot ? 'rgba(' + col.hot + ',0.95)' : col.dot;
      ctx.beginPath(); ctx.arc(a.x, a.y, hot ? a.r + 0.8 : a.r, 0, 6.2832); ctx.fill();
    }
  }

  function loop() {
    if (!running) return;
    step(); draw();
    raf = requestAnimationFrame(loop);
  }
  function start() {
    if (running || reduced.matches || document.hidden || !visible) return;
    running = true; raf = requestAnimationFrame(loop);
  }
  function stop() { running = false; cancelAnimationFrame(raf); }

  window.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'touch') return;
    var r = canvas.getBoundingClientRect();
    mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
    mouse.on = mouse.y > -REACH && mouse.y < h + REACH;
  }, { passive: true });
  document.addEventListener('pointerleave', function () { mouse.on = false; });
  window.addEventListener('blur', function () { mouse.on = false; });

  var rz;
  window.addEventListener('resize', function () {
    clearTimeout(rz);
    rz = setTimeout(function () { size(); draw(); }, 150);
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else start(); });
  document.addEventListener('themechange', function () { readColors(); draw(); });
  if (reduced.addEventListener) reduced.addEventListener('change', function () { if (reduced.matches) { stop(); draw(); } else start(); });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (en) {
      visible = en[0].isIntersecting;
      if (visible) start(); else stop();
    }).observe(host);
  }

  readColors(); size(); draw(); start();
})();
