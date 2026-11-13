// Stats Lab page: tabs, the equation switch, one line chart per idea,
// power tables, and set-value buttons.
// All math lives in js/lab/power.js (window.LabPower). Charts are plain
// inline SVG colored with CSS variables, so both themes work with no redraw.
(function () {
  'use strict';

  var LP = window.LabPower;
  if (!LP) return;

  var SVGNS = 'http://www.w3.org/2000/svg';
  var ALPHA = 0.05;
  var POWERS = [0.8, 0.85, 0.9, 0.95];
  var DASH = ['', '9 5', '2 4', '12 4 2 4'];   // one pattern per line, so color is never the only cue
  var view = 'n';                               // 'n': sample size for a given power. 'power': the reverse.

  // ---------- formatting ----------
  function int(n) { return Math.round(n).toLocaleString('en-US'); }
  function pct(p, d) { return (p * 100).toFixed(d || 0) + '%'; }
  function pct1(p) { return (Math.round(p * 1000) / 10) + '%'; }
  function f2(v) { return Number(v).toFixed(2); }
  function tick(v) {
    if (v >= 1e6) return (v / 1e6) + 'M';
    if (v >= 1e4) return (v / 1e3) + 'k';
    return int(v);
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  function up(x) { return Math.ceil(x - 1e-9); }
  function merge() {
    var o = {};
    for (var i = 0; i < arguments.length; i++) {
      var a = arguments[i];
      if (a) Object.keys(a).forEach(function (k) { o[k] = a[k]; });
    }
    return o;
  }
  function opts(values, fmt, paper) {
    return values.map(function (v) { return [String(v), fmt(v), v === paper ? 'paper' : '']; });
  }

  // ---------- tab definitions ----------
  // Each tab gives: the paper's values, solve(v, power) and power(v, n) from
  // LabPower, the charts (one input varied over four set values, the rest
  // held fixed), the power table, and the set-value buttons.
  // The chart x axis (or y axis) counts `axis`: patients, people, or people
  // with the disease. raw(r) is that count before rounding up.
  var powerInput = { key: 'power', label: 'Power', options: opts(POWERS, pct, null) };

  var TABS = {
    cox: {
      paper: { hr: 1.89, sigma: 0.7, eventRate: 0.36, power: 0.9 },
      axis: 'Patients',
      solve: function (v, power) {
        return LP.coxN({ hr: v.hr, sigma: v.sigma, eventRate: v.eventRate, alpha: ALPHA, power: power, r2: 0 });
      },
      power: function (v, n) {
        return LP.coxPower({ hr: v.hr, n: n, sigma: v.sigma, eventRate: v.eventRate, alpha: ALPHA, r2: 0 });
      },
      raw: function (r) { return r.raw; },
      need: function (r) { return int(r.n) + ' patients'; },
      charts: [
        { key: 'hr', values: [1.25, 1.5, 1.75, 2], legend: 'Hazard ratio', short: function (x) { return 'HR ' + f2(x); },
          title: 'A bigger hazard ratio needs fewer patients',
          caption: 'Held fixed: SD 0.70, 36% event rate, alpha 0.05, R² 0.' },
        { key: 'sigma', values: [0.35, 0.7, 1, 1.4], fixed: { hr: 1.5 }, legend: 'SD of the score', short: function (x) { return 'SD ' + f2(x); },
          title: 'A wider spread in the score needs fewer patients',
          caption: 'Held fixed: hazard ratio 1.5, 36% event rate, alpha 0.05, R² 0.' },
        { key: 'eventRate', values: [0.1, 0.25, 0.36, 0.5], fixed: { hr: 1.5 }, legend: 'Event rate', short: pct1,
          title: 'A lower event rate needs more patients',
          caption: 'Held fixed: hazard ratio 1.5, SD 0.70, alpha 0.05, R² 0.' }
      ],
      table: {
        key: 'hr', values: [1.25, 1.5, 1.75, 1.89, 2], head: 'Hazard ratio', fmt: f2,
        title: 'More power needs more patients',
        caption: 'Patients needed. Held fixed: SD 0.70, 36% event rate, alpha 0.05, R² 0. Events = patients × 36%.',
        cell: function (r) { return int(r.n); }
      },
      inputs: [
        { key: 'hr', label: 'Hazard ratio', options: opts([1.25, 1.5, 1.75, 1.89, 2], f2, 1.89) },
        { key: 'sigma', label: 'SD of the score', options: opts([0.35, 0.5, 0.7, 1, 1.4], f2, 0.7),
          hint: '0.50 is a yes or no factor split 50/50.' },
        { key: 'eventRate', label: 'Event rate', options: opts([0.1, 0.25, 0.36, 0.5], pct, 0.36) },
        powerInput
      ],
      fixedNote: 'R² is fixed at 0 and alpha at 0.05, two-sided.',
      answer: function (v, r) {
        return 'With a hazard ratio of ' + f2(v.hr) + ' and ' + pct(v.eventRate) +
          ' of patients having an event, you need about <b>' + int(r.n) + '</b> patients for ' + pct(v.power) +
          ' power. That is <b>' + int(r.events) + '</b> events.';
      },
      study: function (r) {
        return 'For 90% power, a new study would need about <b>' + int(r.n) + '</b> patients (<b>' + int(r.events) + '</b> events).';
      }
    },

    logistic: {
      paper: { or: 1.61, p0: 0.017, power: 0.9 },
      axis: 'People',
      solve: function (v, power) { return LP.logisticNormalN({ or: v.or, p0: v.p0, alpha: ALPHA, power: power, r2: 0 }); },
      power: function (v, n) { return LP.logisticNormalPower({ or: v.or, n: n, p0: v.p0, alpha: ALPHA, r2: 0 }); },
      raw: function (r) { return r.raw; },
      need: function (r) { return int(r.n) + ' people'; },
      charts: [
        { key: 'or', values: [1.25, 1.5, 1.75, 2], legend: 'Odds ratio per 1 SD', short: function (x) { return 'OR ' + f2(x); },
          title: 'A bigger odds ratio needs fewer people',
          caption: 'Held fixed: 1.7% baseline chance, alpha 0.05, R² 0.' },
        { key: 'p0', values: [0.017, 0.05, 0.2, 0.5], fixed: { or: 1.5 }, legend: 'Baseline chance', short: pct1,
          title: 'A rarer outcome needs more people',
          caption: 'Held fixed: odds ratio 1.5 per 1 SD, alpha 0.05, R² 0.' }
      ],
      table: {
        key: 'or', values: [1.25, 1.5, 1.61, 1.75, 2], head: 'Odds ratio', fmt: f2,
        title: 'More power needs more people',
        caption: 'People needed. Held fixed: 1.7% baseline chance, alpha 0.05, R² 0.',
        cell: function (r) { return int(r.n); }
      },
      inputs: [
        { key: 'or', label: 'Odds ratio per 1 SD', options: opts([1.25, 1.5, 1.61, 1.75, 2], f2, 1.61) },
        { key: 'p0', label: 'Baseline chance', options: opts([0.017, 0.05, 0.2, 0.5], pct1, 0.017) },
        powerInput
      ],
      fixedNote: 'R² is fixed at 0 and alpha at 0.05, two-sided.',
      answer: function (v, r) {
        return 'With an odds ratio of ' + f2(v.or) + ' per SD and a ' + pct1(v.p0) +
          ' baseline chance of the outcome, you need about <b>' + int(r.n) + '</b> people for ' + pct(v.power) + ' power.';
      },
      study: function (r) {
        return 'For 90% power, a new study would need about <b>' + int(r.n) + '</b> women.';
      }
    },

    auc: {
      paper: { auc1: 0.58, ratio: 59.6, power: 0.9 },
      axis: 'People with the disease',
      solve: function (v, power) { return LP.rocN({ auc0: 0.5, auc1: v.auc1, ratio: v.ratio, alpha: ALPHA, power: power }); },
      power: function (v, n) { return LP.rocPower({ auc0: 0.5, auc1: v.auc1, ratio: v.ratio, alpha: ALPHA, nPos: n }); },
      raw: function (r) { return r.raw; },
      need: function (r) { return int(r.nPos) + ' with the disease, ' + int(r.n) + ' in total'; },
      charts: [
        { key: 'auc1', values: [0.55, 0.58, 0.65, 0.7], legend: 'Expected AUC', short: function (x) { return 'AUC ' + f2(x); },
          title: 'A higher AUC needs fewer people',
          caption: 'Held fixed: 59.6 people without the disease per person with it, null AUC 0.50, alpha 0.05.' },
        { key: 'ratio', values: [1, 3, 10, 59.6], legend: 'Without the disease per person with it',
          short: function (x) { return x + ' to 1'; },
          title: 'More people without the disease means fewer with it are needed',
          caption: 'Held fixed: AUC 0.58, null AUC 0.50, alpha 0.05.' }
      ],
      table: {
        key: 'auc1', values: [0.55, 0.58, 0.6, 0.65, 0.7], head: 'Expected AUC', fmt: f2,
        title: 'More power needs more people',
        caption: 'People with the disease needed, with the total number of people in small type. Held fixed: 59.6 without the disease per person with it, null AUC 0.50, alpha 0.05.',
        cell: function (r) { return int(r.nPos) + '<small>' + int(r.n) + '</small>'; }
      },
      inputs: [
        { key: 'auc1', label: 'Expected AUC', options: opts([0.55, 0.58, 0.6, 0.65, 0.7], f2, 0.58) },
        { key: 'ratio', label: 'Without the disease per person with it', options: opts([1, 3, 10, 59.6], String, 59.6) },
        powerInput
      ],
      fixedNote: 'The null AUC is fixed at 0.50 and alpha at 0.05, two-sided.',
      answer: function (v, r) {
        return 'With an AUC of ' + f2(v.auc1) + ' and ' + v.ratio + ' people without the disease per person with it, you need about <b>' +
          int(r.nPos) + '</b> people with the disease for ' + pct(v.power) + ' power. That is <b>' + int(r.n) + '</b> people in total.';
      },
      study: function (r) {
        return 'For 90% power, a new study would need about <b>' + int(r.nPos) + '</b> women with breast cancer and <b>' +
          int(r.nNeg) + '</b> without (<b>' + int(r.n) + '</b> in total).';
      }
    }
  };

  // ---------- small helpers ----------
  function el(tag, attrs, html) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (html !== undefined) n.innerHTML = html;
    return n;
  }
  function svgEl(tag, attrs) {
    var n = document.createElementNS(SVGNS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }
  function niceCeil(x) {
    var p = Math.pow(10, Math.floor(Math.log10(x)));
    var steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
    for (var i = 0; i < steps.length; i++) if (steps[i] * p >= x) return steps[i] * p;
    return 10 * p;
  }
  function logTicks(lo, hi) {
    var out = [], p = Math.pow(10, Math.floor(Math.log10(lo)));
    for (; p <= hi * 1.0001; p *= 10) {
      [1, 2, 5].forEach(function (m) { var v = m * p; if (v >= lo * 0.9999 && v <= hi * 1.0001) out.push(v); });
    }
    return out;
  }
  function floor125(x) {
    var p = Math.pow(10, Math.floor(Math.log10(x))), m = x / p;
    return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p;
  }
  function ceil125(x) {
    var p = Math.pow(10, Math.floor(Math.log10(x))), m = x / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
  }

  // A row of set-value buttons. options: [value, label, small tag].
  function segControl(label, options, value, onChange, hint) {
    var wrap = el('div', { 'class': 'control' });
    wrap.innerHTML = '<span class="control-label">' + esc(label) + '</span>' +
      '<div class="seg" role="group" aria-label="' + esc(label) + '">' +
      options.map(function (o) {
        return '<button type="button" data-v="' + o[0] + '" aria-pressed="' + (o[0] === value) + '">' + esc(o[1]) +
          (o[2] ? ' <small>' + esc(o[2]) + '</small>' : '') + '</button>';
      }).join('') + '</div>' + (hint ? '<span class="hint">' + esc(hint) + '</span>' : '');
    var btns = wrap.querySelectorAll('button');
    function set(v) { btns.forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === v)); }); }
    btns.forEach(function (b) {
      b.addEventListener('click', function () { var v = b.getAttribute('data-v'); set(v); onChange(v); });
    });
    wrap.set = set;
    return wrap;
  }

  // ---------- line chart ----------
  // One chart, up to four lines. Each series gives power(n) and n(power).
  // The global `view` picks which way round the axes go:
  //   'power': x = sample size, y = power.   'n': x = power, y = sample size (log).
  // series: [{ short, sub, power: fn(n), n: fn(power) }]
  function lineChart(host, o) {
    host.innerHTML = '<div class="lc-plot"><div class="lc-tip" hidden></div></div><ul class="lc-legend" aria-label="' +
      esc(o.legend) + '"></ul>';
    var plot = host.firstChild, tip = plot.firstChild, legend = host.lastChild;
    var svg = svgEl('svg', { tabindex: '0', role: 'img', focusable: 'true' });
    plot.appendChild(svg);

    legend.innerHTML = '<li class="lc-legend-title">' + esc(o.legend) + '</li>' + o.series.map(function (s, i) {
      return '<li><svg width="30" height="8" aria-hidden="true"><line x1="1" x2="29" y1="4" y2="4" style="stroke:var(--series-' +
        (i + 1) + ')" stroke-width="2.5"' + (DASH[i] ? ' stroke-dasharray="' + DASH[i] + '"' : '') + '/></svg>' +
        '<span><b>' + esc(s.short) + '</b><small>' + esc(s.sub) + ' for 90% power</small></span></li>';
    }).join('');
    svg.setAttribute('aria-label', o.title + '. ' + o.legend + ': ' + o.series.map(function (s) {
      return s.short + ', ' + s.sub + ' for 90% power';
    }).join('; ') + '. Use the left and right arrow keys to read the lines. The power table below gives set values.');

    var g = null, cur = { on: false, x: null, view: null }, lastW = 0;

    function draw() {
      var w = plot.clientWidth;
      if (!w) return;                               // tab is hidden
      lastW = w;
      var small = w < 520, h = small ? 300 : 360, pv = view === 'power';
      var labW = Math.max.apply(null, o.series.map(function (s) { return s.short.length; })) * 6.6 + 24;
      var m = { l: pv ? 44 : 50, r: labW, t: 26, b: 42 };
      var pw = w - m.l - m.r, ph = h - m.t - m.b;
      svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
      svg.setAttribute('width', w);
      svg.setAttribute('height', h);
      while (svg.firstChild) svg.removeChild(svg.firstChild);

      var ax;
      if (pv) {
        ax = { xmin: 0, ymin: 0, ymax: 1,
          xmax: niceCeil(Math.max.apply(null, o.series.map(function (s) { return s.n(0.8); }))) };
      } else {
        ax = { xmin: 0.5, xmax: 0.99,
          ymin: floor125(Math.max(1, Math.min.apply(null, o.series.map(function (s) { return s.n(0.5); })))),
          ymax: ceil125(Math.max.apply(null, o.series.map(function (s) { return s.n(0.99); }))) };
      }
      var lmin = Math.log10(ax.ymin || 1), lmax = Math.log10(ax.ymax || 10);
      function X(v) { return m.l + (v - ax.xmin) / (ax.xmax - ax.xmin) * pw; }
      function Y(v) {
        if (pv) return m.t + (1 - v) * ph;
        v = Math.min(ax.ymax, Math.max(ax.ymin, v));
        return m.t + (1 - (Math.log10(v) - lmin) / (lmax - lmin)) * ph;
      }
      function add(tag, attrs, text) {
        var n = svgEl(tag, attrs);
        if (text !== undefined) n.textContent = text;
        svg.appendChild(n);
        return n;
      }
      function hline(v, cls) { add('line', { 'class': cls, x1: m.l, x2: m.l + pw, y1: Y(v), y2: Y(v) }); }
      function vline(v, cls) { add('line', { 'class': cls, x1: X(v), x2: X(v), y1: m.t, y2: m.t + ph }); }
      function xlab(v, text, cls) { add('text', { 'class': cls || '', x: X(v), y: m.t + ph + 16, 'text-anchor': 'middle' }, text); }
      function ylab(v, text, cls) { add('text', { 'class': cls || '', x: m.l - 7, y: Y(v) + 4, 'text-anchor': 'end' }, text); }

      // grid, ticks, and the 80% and 90% power reference lines
      if (pv) {
        [0, 0.2, 0.4, 0.6, 1].forEach(function (v) { hline(v, 'grid'); ylab(v, pct(v)); });
        [0.8, 0.9].forEach(function (v) { hline(v, 'ref'); ylab(v, pct(v), 'ref-label'); });
        var div = [5, 4, 6].filter(function (d) {
          var st = ax.xmax / d, mm = st / Math.pow(10, Math.floor(Math.log10(st)));
          return [1, 1.5, 2, 2.5, 3, 4, 5].some(function (k) { return Math.abs(mm - k) < 1e-9; });
        })[0] || 4;
        if (small && div > 4) div = div / 2;
        for (var k = 0; k <= div; k++) {
          var xv = ax.xmax * k / div;
          if (k) vline(xv, 'grid');
          xlab(xv, tick(xv));
        }
      } else {
        var ticks = logTicks(ax.ymin, ax.ymax);
        var decadesOnly = ticks.length > 8;
        ticks.forEach(function (v) {
          hline(v, 'grid');
          if (!decadesOnly || String(v).charAt(0) === '1') ylab(v, tick(v));
        });
        [0.5, 0.6, 0.7].forEach(function (v) { xlab(v, pct(v)); });
        xlab(0.99, '99%');
        [0.8, 0.9].forEach(function (v) { vline(v, 'ref'); xlab(v, pct(v), 'ref-label'); });
      }
      add('line', { 'class': 'axis', x1: m.l, x2: m.l + pw, y1: m.t + ph, y2: m.t + ph });
      add('text', { 'class': 'ax-title', x: m.l + pw / 2, y: h - 5, 'text-anchor': 'middle' },
        pv ? o.axis : 'Power');
      add('text', { 'class': 'ax-title', x: 0, y: 11, 'text-anchor': 'start' },
        pv ? 'Power' : o.axis + ' (log scale)');

      // the lines, then a label at the end of each
      var ends = o.series.map(function (s, i) {
        var pts = [], steps = 120, j, xv2, yv;
        for (j = 0; j <= steps; j++) {
          xv2 = ax.xmin + (ax.xmax - ax.xmin) * j / steps;
          yv = pv ? s.power(xv2) : s.n(xv2);
          pts.push(X(xv2).toFixed(1) + ',' + Y(yv).toFixed(1));
        }
        var attrs = { 'class': 'curve', style: 'stroke:var(--series-' + (i + 1) + ')', points: pts.join(' ') };
        if (DASH[i]) attrs['stroke-dasharray'] = DASH[i];
        add('polyline', attrs);
        return { i: i, y: Y(yv), ly: Y(yv) };
      });
      var order = ends.slice().sort(function (a, b) { return a.y - b.y; }), gap = 15, q;
      for (q = 1; q < order.length; q++) order[q].ly = Math.max(order[q].ly, order[q - 1].ly + gap);
      var over = order[order.length - 1].ly - (m.t + ph);
      if (over > 0) {
        order[order.length - 1].ly -= over;
        for (q = order.length - 2; q >= 0; q--) order[q].ly = Math.min(order[q].ly, order[q + 1].ly - gap);
      }
      var x1 = m.l + pw;
      order.forEach(function (e) {
        add('polyline', { 'class': 'leader', style: 'stroke:var(--series-' + (e.i + 1) + ')',
          points: (x1 + 2) + ',' + e.y.toFixed(1) + ' ' + (x1 + 10) + ',' + e.ly.toFixed(1) + ' ' + (x1 + 14) + ',' + e.ly.toFixed(1) });
        add('text', { 'class': 'end-label', x: x1 + 17, y: e.ly + 4 }, o.series[e.i].short);
      });

      // crosshair layer for hover and keyboard
      var line = add('line', { 'class': 'cursor-line', y1: m.t, y2: m.t + ph, visibility: 'hidden' });
      var dots = o.series.map(function (s, i) {
        return add('circle', { 'class': 'cursor-dot', style: 'fill:var(--series-' + (i + 1) + ')', r: 4.5, visibility: 'hidden' });
      });
      g = { m: m, pw: pw, ax: ax, X: X, Y: Y, pv: pv, line: line, dots: dots, start: pv ? ax.xmax / 2 : 0.9 };
      if (cur.on) show(null);
    }

    function show(xv) {
      if (!g) return;
      if (xv === null) xv = cur.x !== null && cur.view === g.pv ? cur.x : g.start;
      xv = Math.min(g.ax.xmax, Math.max(g.pv ? 1 : g.ax.xmin, xv));
      xv = g.pv ? Math.round(xv) : Math.round(xv * 100) / 100;
      cur.on = true; cur.x = xv; cur.view = g.pv;
      var cx = g.X(xv);
      g.line.setAttribute('x1', cx); g.line.setAttribute('x2', cx); g.line.setAttribute('visibility', 'visible');
      var rows = o.series.map(function (s, i) {
        var yv = g.pv ? s.power(xv) : s.n(xv);
        g.dots[i].setAttribute('cx', cx); g.dots[i].setAttribute('cy', g.Y(yv)); g.dots[i].setAttribute('visibility', 'visible');
        return '<span class="lc-tip-row"><i style="background:var(--series-' + (i + 1) + ')"></i>' + esc(s.short) +
          '<b>' + (g.pv ? pct(yv, 1) : int(up(yv))) + '</b></span>';
      });
      tip.innerHTML = '<span class="lc-tip-head">' + (g.pv ? int(xv) + ' ' + o.axis.toLowerCase() : pct(xv) + ' power') +
        '</span>' + rows.join('') + '<span class="lc-tip-foot">' + (g.pv ? 'Power' : o.axis + ' needed') + '</span>';
      tip.hidden = false;
      var tw = tip.offsetWidth, left = cx + 12;
      if (left + tw > plot.clientWidth) left = cx - tw - 12;
      tip.style.left = Math.max(0, left) + 'px';
      tip.style.top = (g.pv ? g.m.t + 60 : g.m.t + 6) + 'px';
    }

    function hide() {
      cur.on = false;
      tip.hidden = true;
      if (g) {
        g.line.setAttribute('visibility', 'hidden');
        g.dots.forEach(function (d) { d.setAttribute('visibility', 'hidden'); });
      }
    }

    function fromPointer(ev) {
      if (!g) return;
      var r = svg.getBoundingClientRect();
      var frac = (ev.clientX - r.left - g.m.l) / g.pw;
      show(g.ax.xmin + frac * (g.ax.xmax - g.ax.xmin));
    }
    svg.addEventListener('pointermove', fromPointer);
    svg.addEventListener('pointerdown', fromPointer);
    svg.addEventListener('pointerleave', function () { if (document.activeElement !== svg) hide(); });
    svg.addEventListener('focus', function () { show(null); });
    svg.addEventListener('blur', hide);
    svg.addEventListener('keydown', function (ev) {
      if (!g) return;
      var span = g.ax.xmax - g.ax.xmin, step = g.pv ? Math.max(1, span / (ev.shiftKey ? 10 : 50)) : (ev.shiftKey ? 0.05 : 0.01);
      var x = cur.x !== null && cur.view === g.pv ? cur.x : g.start;
      if (ev.key === 'ArrowRight') x += step;
      else if (ev.key === 'ArrowLeft') x -= step;
      else if (ev.key === 'Home') x = g.ax.xmin;
      else if (ev.key === 'End') x = g.ax.xmax;
      else if (ev.key === 'Escape') { hide(); return; }
      else return;
      ev.preventDefault();
      show(x);
    });

    if (window.ResizeObserver) {
      new ResizeObserver(function () {
        var w = plot.clientWidth;
        if (w && Math.abs(w - lastW) > 1) draw();
      }).observe(plot);
    } else {
      window.addEventListener('resize', draw);
    }
    return draw;
  }

  // ---------- charts and power table for one tab ----------
  function buildCharts(key, host) {
    var T = TABS[key], draws = [];
    T.charts.forEach(function (c) {
      var card = el('div', { 'class': 'tool-card', id: key + '-chart-' + c.key });
      card.innerHTML = '<h2 class="lab-h">' + esc(c.title) + '</h2><p class="tool-sub">' + esc(c.caption) + '</p><div class="lc"></div>';
      host.appendChild(card);
      var series = c.values.map(function (val) {
        var v = merge(T.paper, c.fixed); v[c.key] = val;
        return {
          short: c.short(val),
          sub: T.need(T.solve(v, 0.9)),
          power: function (n) { return T.power(v, n); },
          n: function (power) { return T.raw(T.solve(v, power)); }
        };
      });
      draws.push(lineChart(card.lastChild, { series: series, legend: c.legend, title: c.title, axis: T.axis }));
    });

    var t = T.table, card = el('div', { 'class': 'tool-card', id: key + '-chart-power' });
    card.innerHTML = '<h2 class="lab-h">' + esc(t.title) + '</h2><p class="tool-sub">' + esc(t.caption) + '</p>' +
      '<div class="pw-wrap"><table class="pw-table"><thead><tr><th scope="col">' + esc(t.head) + '</th>' +
      POWERS.map(function (p) { return '<th scope="col">' + pct(p) + '<span> power</span></th>'; }).join('') + '</tr></thead><tbody>' +
      t.values.map(function (val) {
        var v = merge(T.paper); v[t.key] = val;
        var paper = val === T.paper[t.key];
        return '<tr' + (paper ? ' class="is-paper"' : '') + '><th scope="row">' + t.fmt(val) +
          (paper ? ' <small>paper</small>' : '') + '</th>' +
          POWERS.map(function (p) { return '<td>' + t.cell(T.solve(v, p)) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
    host.appendChild(card);

    return function () { draws.forEach(function (d) { d(); }); };
  }

  // ---------- set values ----------
  function buildCalc(key, host) {
    var T = TABS[key], vals = merge(T.paper), controls = {};
    host.innerHTML = '<div class="calc-head"><h2 class="lab-h">Try set values</h2>' +
      '<button type="button" class="lab-reset">Reset to the paper values</button></div>';
    var rows = el('div', { 'class': 'set-rows' });
    T.inputs.forEach(function (d) {
      var c = segControl(d.label, d.options, String(vals[d.key]), function (v) { vals[d.key] = parseFloat(v); update(); }, d.hint);
      controls[d.key] = c;
      rows.appendChild(c);
    });
    host.appendChild(rows);
    host.appendChild(el('p', { 'class': 'set-fixed' }, esc(T.fixedNote)));
    var line = el('p', { 'class': 'result-line', 'aria-live': 'polite' });
    host.appendChild(line);

    function update() { line.innerHTML = T.answer(vals, T.solve(vals, vals.power)); }
    host.querySelector('.lab-reset').addEventListener('click', function () {
      vals = merge(T.paper);
      T.inputs.forEach(function (d) { controls[d.key].set(String(vals[d.key])); });
      update();
    });
    update();

    var study = document.querySelector('[data-study="' + key + '"]');
    if (study) study.innerHTML = T.study(T.solve(T.paper, 0.9));
  }

  // ---------- tabs and the equation switch ----------
  var redraw = {};
  function init() {
    var keys = Object.keys(TABS), current = keys[0];
    keys.forEach(function (key) {
      var w = document.querySelector('[data-charts="' + key + '"]');
      var c = document.querySelector('[data-calc="' + key + '"]');
      if (w) redraw[key] = buildCharts(key, w);
      if (c) buildCalc(key, c);
    });

    var switches = document.querySelectorAll('.eq-switch button');
    function setView(v) {
      view = v;
      switches.forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-view') === v)); });
      document.querySelectorAll('[data-eq-view]').forEach(function (n) { n.hidden = n.getAttribute('data-eq-view') !== v; });
      if (redraw[current]) redraw[current]();
    }
    switches.forEach(function (b) {
      b.addEventListener('click', function () { setView(b.getAttribute('data-view')); });
    });

    var tabs = keys.map(function (k) { return document.getElementById('tab-' + k); });
    function select(key, focus, push) {
      current = key;
      keys.forEach(function (k, i) {
        var on = k === key;
        tabs[i].setAttribute('aria-selected', String(on));
        tabs[i].tabIndex = on ? 0 : -1;
        document.getElementById('panel-' + k).hidden = !on;
        if (on && focus) tabs[i].focus();
      });
      if (redraw[key]) redraw[key]();
      if (push) { try { history.replaceState(null, '', '#' + key); } catch (e) { /* file:// */ } }
    }
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { select(keys[i], false, true); });
      t.addEventListener('keydown', function (ev) {
        var j = i;
        if (ev.key === 'ArrowRight') j = (i + 1) % keys.length;
        else if (ev.key === 'ArrowLeft') j = (i - 1 + keys.length) % keys.length;
        else if (ev.key === 'Home') j = 0;
        else if (ev.key === 'End') j = keys.length - 1;
        else return;
        ev.preventDefault();
        select(keys[j], true, true);
      });
    });
    // "#cox" opens a tab. "#cox-chart-hr" opens the tab and jumps to that chart.
    function fromHash() {
      var h = location.hash.replace('#', ''), key = h.split('-')[0];
      select(keys.indexOf(key) >= 0 ? key : keys[0], false, false);
      var target = h !== key && document.getElementById(h);
      if (target) target.scrollIntoView();
    }
    window.addEventListener('hashchange', fromHash);
    setView(view);
    fromHash();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
