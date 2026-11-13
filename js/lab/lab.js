// Stats Lab page: tabs, the equation switch, one power curve chart per idea,
// power tables, and a slider card with its own small chart.
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
  var chartCount = 0;

  // ---------- formatting ----------
  function int(n) { return Math.round(n).toLocaleString('en-US'); }
  function pct(p, d) { return (p * 100).toFixed(d || 0) + '%'; }
  function pct1(p) { return (Math.round(p * 1000) / 10) + '%'; }
  function f2(v) { return Number(v).toFixed(2); }
  function f1(v) { return Number(v).toFixed(1); }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  function merge() {
    var o = {};
    for (var i = 0; i < arguments.length; i++) {
      var a = arguments[i];
      if (a) Object.keys(a).forEach(function (k) { o[k] = a[k]; });
    }
    return o;
  }

  // ---------- tab definitions ----------
  // Each tab gives: the paper's values, solve(v, power) and power(v, n) from
  // LabPower, the charts (one input varied over four set values, the rest
  // held fixed), the power table, and the sliders.
  // Every chart has sample size on x and power on y. count(r) is the sample
  // size on that axis: patients, people, or people with the disease.
  var powerSlider = { key: 'power', label: 'Power', min: 80, max: 95, step: 5, scale: 100, fmt: pct };
  var MORE_POWER = 'As we increase power we need more %s, because we want to be more confident that a real difference is found.';

  var TABS = {
    cox: {
      paper: { hr: 1.89, sigma: 0.7, eventRate: 0.36, power: 0.9 },
      axis: 'Sample size', unit: 'patients',
      solve: function (v, power) {
        return LP.coxN({ hr: v.hr, sigma: v.sigma, eventRate: v.eventRate, alpha: ALPHA, power: power, r2: 0 });
      },
      power: function (v, n) {
        return LP.coxPower({ hr: v.hr, n: n, sigma: v.sigma, eventRate: v.eventRate, alpha: ALPHA, r2: 0 });
      },
      count: function (r) { return r.n; },
      need: function (r) { return int(r.n) + ' patients'; },
      charts: [
        { key: 'hr', legend: 'Hazard ratio', short: function (x) { return 'HR ' + f1(x); },
          sets: [[1.2, 1.3, 1.4, 1.5], [1.5, 1.6, 1.7, 1.8]], open: 1, setLabel: 'Hazard ratios shown',
          xmax: 1000, step: 100,
          title: 'A bigger hazard ratio needs fewer patients',
          why: 'As the hazard ratio increases, fewer events are needed for the same power. A bigger effect is easier to see.',
          caption: 'Held fixed: SD 0.70, 36% event rate, alpha 0.05, R² 0.' },
        { key: 'sigma', values: [0.6, 0.8, 1, 1.2], fixed: { hr: 1.5 }, legend: 'SD of the variable', short: function (x) { return 'SD ' + f1(x); },
          xmax: 1000, step: 100,
          title: 'A wider spread in the variable needs fewer patients',
          why: 'As the SD increases, fewer events are needed. Patients differ more, so the difference between them is easier to see.',
          caption: 'Held fixed: hazard ratio 1.5, 36% event rate, alpha 0.05, R² 0.' },
        { key: 'eventRate', values: [0.1, 0.25, 0.36, 0.5], fixed: { hr: 1.5 }, legend: 'Event rate', short: pct1,
          xmax: 1000, step: 100,
          title: 'A lower event rate needs more patients',
          why: 'The lower the share of patients who have the event, the more patients are needed. Only events carry information.',
          caption: 'Held fixed: hazard ratio 1.5, SD 0.70, alpha 0.05, R² 0.' }
      ],
      table: {
        key: 'hr', values: [1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.89], head: 'Hazard ratio', fmt: f2,
        title: 'More power needs more patients',
        why: MORE_POWER.replace('%s', 'events'),
        caption: 'Patients needed. Held fixed: SD 0.70, 36% event rate, alpha 0.05, R² 0. Events = patients × 36%.',
        cell: function (r) { return int(r.n); }
      },
      sliders: [
        { key: 'hr', label: 'Hazard ratio', min: 1.1, max: 2.5, step: 0.05, fmt: f2 },
        { key: 'sigma', label: 'SD of the variable', min: 0.3, max: 1.5, step: 0.05, fmt: f2 },
        { key: 'eventRate', label: 'Event rate', min: 5, max: 100, step: 5, scale: 100, fmt: pct },
        powerSlider
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
      axis: 'Sample size', unit: 'people',
      solve: function (v, power) { return LP.logisticNormalN({ or: v.or, p0: v.p0, alpha: ALPHA, power: power, r2: 0 }); },
      power: function (v, n) { return LP.logisticNormalPower({ or: v.or, n: n, p0: v.p0, alpha: ALPHA, r2: 0 }); },
      count: function (r) { return r.n; },
      need: function (r) { return int(r.n) + ' people'; },
      charts: [
        { key: 'or', values: [1.25, 1.5, 1.75, 2], legend: 'Odds ratio per 1 SD', short: function (x) { return 'OR ' + f2(x); },
          xmax: 10000, step: 1000,
          title: 'A bigger odds ratio needs fewer people',
          why: 'As the odds ratio increases, fewer people are needed for the same power. A bigger effect is easier to see.',
          caption: 'Held fixed: 1.7% baseline chance, alpha 0.05, R² 0.' },
        { key: 'p0', values: [0.017, 0.05, 0.2, 0.5], fixed: { or: 1.5 }, legend: 'Baseline chance', short: pct1,
          xmax: 4000, step: 500,
          title: 'A rarer outcome needs more people',
          why: 'The further the baseline chance is below 50%, the more people are needed. A rare outcome gives few cases to learn from.',
          caption: 'Held fixed: odds ratio 1.5 per 1 SD, alpha 0.05, R² 0.' }
      ],
      table: {
        key: 'or', values: [1.25, 1.5, 1.61, 1.75, 2], head: 'Odds ratio', fmt: f2,
        title: 'More power needs more people',
        why: MORE_POWER.replace('%s', 'people'),
        caption: 'People needed. Held fixed: 1.7% baseline chance, alpha 0.05, R² 0.',
        cell: function (r) { return int(r.n); }
      },
      sliders: [
        { key: 'or', label: 'Odds ratio per 1 SD', min: 1.1, max: 2.5, step: 0.05, fmt: f2 },
        { key: 'p0', label: 'Baseline chance', min: 1, max: 50, step: 1, scale: 100, fmt: pct1 },
        powerSlider
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
      axis: 'Sample size (people with the disease)', unit: 'people with the disease',
      solve: function (v, power) { return LP.rocN({ auc0: 0.5, auc1: v.auc1, ratio: v.ratio, alpha: ALPHA, power: power }); },
      power: function (v, n) { return LP.rocPower({ auc0: 0.5, auc1: v.auc1, ratio: v.ratio, alpha: ALPHA, nPos: n }); },
      count: function (r) { return r.nPos; },
      need: function (r) { return int(r.nPos) + ' with the disease, ' + int(r.n) + ' in total'; },
      charts: [
        { key: 'auc1', values: [0.55, 0.58, 0.65, 0.7], legend: 'Expected AUC', short: function (x) { return 'AUC ' + f2(x); },
          xmax: 300, step: 50,
          title: 'A higher AUC needs fewer people',
          why: 'The further the AUC is above 0.50, the fewer people are needed. A better variable is easier to tell from a coin flip.',
          caption: 'Held fixed: 59.6 people without the disease per person with it, null AUC 0.50, alpha 0.05.' },
        { key: 'ratio', values: [1, 3, 10, 59.6], legend: 'Without the disease per person with it',
          short: function (x) { return x + ' to 1'; },
          xmax: 300, step: 50,
          title: 'More people without the disease means fewer with it are needed',
          why: 'The more people without the disease per person with it, the fewer people with the disease are needed. The gain is small past about 10, and the total keeps growing.',
          caption: 'Held fixed: AUC 0.58, null AUC 0.50, alpha 0.05.' }
      ],
      table: {
        key: 'auc1', values: [0.55, 0.58, 0.6, 0.65, 0.7], head: 'Expected AUC', fmt: f2,
        title: 'More power needs more people',
        why: MORE_POWER.replace('%s', 'people'),
        caption: 'People with the disease needed, with the total number of people in small type. Held fixed: 59.6 without the disease per person with it, null AUC 0.50, alpha 0.05.',
        cell: function (r) { return int(r.nPos) + '<small>' + int(r.n) + '</small>'; }
      },
      sliders: [
        { key: 'auc1', label: 'Expected AUC', min: 0.52, max: 0.8, step: 0.01, fmt: f2 },
        { key: 'ratio', label: 'Without the disease per person with it', min: 1, max: 60, step: 1, fmt: String },
        powerSlider
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
  // A round tick step that splits xmax into 4, 5 or 6 parts.
  function niceStep(xmax) {
    var div = [5, 4, 6].filter(function (d) {
      var st = xmax / d, m = st / Math.pow(10, Math.floor(Math.log10(st)));
      return [1, 1.5, 2, 2.5, 3, 4, 5].some(function (k) { return Math.abs(m - k) < 1e-9; });
    })[0] || 4;
    return xmax / div;
  }

  // A two-or-more button choice. options: [value, label].
  function segControl(label, options, value, onChange) {
    var wrap = el('div', { 'class': 'control' });
    wrap.innerHTML = '<span class="control-label">' + esc(label) + '</span>' +
      '<div class="seg" role="group" aria-label="' + esc(label) + '">' +
      options.map(function (o) {
        return '<button type="button" data-v="' + o[0] + '" aria-pressed="' + (o[0] === value) + '">' + esc(o[1]) + '</button>';
      }).join('') + '</div>';
    var btns = wrap.querySelectorAll('button');
    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        var v = b.getAttribute('data-v');
        btns.forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        onChange(v);
      });
    });
    return wrap;
  }

  // A stepped slider with a label and a live readout. The readout shows the
  // value in use, which can sit between two steps (the paper's 1.89).
  function sliderControl(id, d, value, onInput) {
    var k = d.scale || 1;
    var wrap = el('div', { 'class': 'control' });
    wrap.innerHTML = '<label for="' + id + '"><span>' + esc(d.label) + '</span><output for="' + id + '"></output></label>' +
      '<input type="range" id="' + id + '" min="' + d.min + '" max="' + d.max + '" step="' + d.step + '">';
    var input = wrap.querySelector('input'), out = wrap.querySelector('output');
    function show(v) { out.textContent = d.fmt(v); input.setAttribute('aria-valuetext', d.fmt(v)); }
    wrap.set = function (v) { input.value = v * k; show(v); };
    input.addEventListener('input', function () {
      var v = parseFloat(input.value) / k;
      show(v);
      onInput(v);
    });
    wrap.set(value);
    return wrap;
  }

  // ---------- line chart ----------
  // Power (y, 0 to 100%) against sample size (x). Up to four lines.
  // o: { title, axis, unit, legend, xmax, step, height }
  //   xmax and step fix the x axis. Leave them out to fit it to the mark.
  // series: [{ short, sub, power: fn(n) }]
  // mark: { n, power } draws one dot with drop lines to both axes.
  // Returns { draw, update(series, mark) }.
  function lineChart(host, o) {
    var solo = !o.legend, clipId = 'lc-clip-' + (++chartCount);
    host.innerHTML = '<div class="lc-plot"><div class="lc-tip" hidden></div></div>' + (solo ? '' : '<ul class="lc-legend"></ul>');
    if (solo) host.classList.add('lc-solo');
    var plot = host.firstChild, tip = plot.firstChild, legend = solo ? null : host.lastChild;
    var svg = svgEl('svg', { tabindex: '0', role: 'img', focusable: 'true' });
    plot.appendChild(svg);

    var series = [], mark = null, g = null, cur = { on: false, x: null }, lastW = 0;

    function update(s, mk) {
      series = s; mark = mk || null;
      if (legend) {
        legend.setAttribute('aria-label', o.legend);
        legend.innerHTML = '<li class="lc-legend-title">' + esc(o.legend) + '</li>' + series.map(function (q, i) {
          return '<li><svg width="30" height="8" aria-hidden="true"><line x1="1" x2="29" y1="4" y2="4" style="stroke:var(--series-' +
            (i + 1) + ')" stroke-width="2.5"' + (DASH[i] ? ' stroke-dasharray="' + DASH[i] + '"' : '') + '/></svg>' +
            '<span><b>' + esc(q.short) + '</b><small>' + esc(q.sub) + ' for 90% power</small></span></li>';
        }).join('');
      }
      svg.setAttribute('aria-label', o.title + '. Power against sample size. ' + (mark
        ? int(mark.n) + ' ' + o.unit + ' for ' + pct(mark.power) + ' power'
        : o.legend + ': ' + series.map(function (q) { return q.short + ', ' + q.sub + ' for 90% power'; }).join('; ')) +
        '. Use the left and right arrow keys to read the chart.');
      cur.x = null;
      draw();
    }

    function draw() {
      var w = plot.clientWidth;
      if (!w || !series.length) return;             // tab is hidden
      lastW = w;
      var small = w < 520, h = o.height || (small ? 300 : 360);
      var labW = solo ? 28 : Math.max(46, Math.max.apply(null, series.map(function (s) { return s.short.length; })) * 6.6 + 24);
      var m = { l: 44, r: labW, t: 26, b: 42 };
      var pw = w - m.l - m.r, ph = h - m.t - m.b;
      var xmax = o.xmax || niceCeil(Math.max(10, mark.n * 1.3));
      var step = o.step || niceStep(xmax);
      svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
      svg.setAttribute('width', w);
      svg.setAttribute('height', h);
      while (svg.firstChild) svg.removeChild(svg.firstChild);

      function X(v) { return m.l + v / xmax * pw; }
      function Y(v) { return m.t + (1 - v) * ph; }
      function add(tag, attrs, text) {
        var n = svgEl(tag, attrs);
        if (text !== undefined) n.textContent = text;
        svg.appendChild(n);
        return n;
      }
      function hline(v, cls) { add('line', { 'class': cls, x1: m.l, x2: m.l + pw, y1: Y(v), y2: Y(v) }); }
      function ylab(v, cls) { add('text', { 'class': cls || '', x: m.l - 7, y: Y(v) + 4, 'text-anchor': 'end' }, pct(v)); }

      var clip = add('clipPath', { id: clipId });
      clip.appendChild(svgEl('rect', { x: m.l, y: m.t - 2, width: pw, height: ph + 4 }));

      // grid, ticks, and the 80% and 90% power reference lines
      [0, 0.2, 0.4, 0.6, 1].forEach(function (v) { hline(v, 'grid'); ylab(v); });
      [0.8, 0.9].forEach(function (v) { hline(v, 'ref'); ylab(v, 'ref-label'); });
      var count = Math.round(xmax / step), every = pw / count < 46 ? 2 : 1;
      for (var k = 0; k <= count; k++) {
        var xv = step * k;
        if (k) add('line', { 'class': 'grid', x1: X(xv), x2: X(xv), y1: m.t, y2: m.t + ph });
        if (k % every === 0) add('text', { x: X(xv), y: m.t + ph + 16, 'text-anchor': 'middle' }, int(xv));
      }
      add('line', { 'class': 'axis', x1: m.l, x2: m.l + pw, y1: m.t + ph, y2: m.t + ph });
      add('text', { 'class': 'ax-title', x: m.l + pw / 2, y: h - 5, 'text-anchor': 'middle' }, o.axis);
      add('text', { 'class': 'ax-title', x: 0, y: 11, 'text-anchor': 'start' }, 'Power');

      // drop lines for the marked point go under the curve
      if (mark) {
        add('polyline', { 'class': 'drop', points: m.l + ',' + Y(mark.power) + ' ' + X(mark.n) + ',' + Y(mark.power) + ' ' +
          X(mark.n) + ',' + (m.t + ph) });
      }

      // the lines, clipped at the plot edge
      var ends = series.map(function (s, i) {
        var pts = [], steps = 160, j, yv;
        for (j = 0; j <= steps; j++) {
          yv = s.power(xmax * j / steps);
          pts.push(X(xmax * j / steps).toFixed(1) + ',' + Y(yv).toFixed(1));
        }
        var attrs = { 'class': 'curve', style: 'stroke:var(--series-' + (i + 1) + ')', points: pts.join(' '),
          'clip-path': 'url(#' + clipId + ')' };
        if (DASH[i]) attrs['stroke-dasharray'] = DASH[i];
        add('polyline', attrs);
        return { i: i, y: Y(yv), ly: Y(yv) };
      });

      // a label at the end of each line, spread apart where the lines meet
      if (!solo) {
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
          add('text', { 'class': 'end-label', x: x1 + 17, y: e.ly + 4 }, series[e.i].short);
        });
      }

      if (mark) {
        add('circle', { 'class': 'mark', r: 5.5, cx: X(mark.n), cy: Y(mark.power), 'data-n': mark.n, 'data-power': mark.power });
        add('text', { 'class': 'end-label halo', x: X(mark.n) + 9, y: Y(mark.power) + 18 }, 'N = ' + int(mark.n));
        add('text', { 'class': 'halo', x: X(mark.n) + 9, y: Y(mark.power) + 33 }, pct(mark.power) + ' power');
      }

      // crosshair layer for hover and keyboard
      var line = add('line', { 'class': 'cursor-line', y1: m.t, y2: m.t + ph, visibility: 'hidden' });
      var dots = series.map(function (s, i) {
        return add('circle', { 'class': 'cursor-dot', style: 'fill:var(--series-' + (i + 1) + ')', r: 4.5, visibility: 'hidden' });
      });
      g = { m: m, pw: pw, xmax: xmax, X: X, Y: Y, line: line, dots: dots };
      if (cur.on) show(null);
    }

    function show(xv) {
      if (!g) return;
      if (xv === null) xv = cur.x !== null ? cur.x : (mark ? mark.n : g.xmax / 2);
      xv = Math.round(Math.min(g.xmax, Math.max(1, xv)));
      cur.on = true; cur.x = xv;
      var cx = g.X(xv);
      g.line.setAttribute('x1', cx); g.line.setAttribute('x2', cx); g.line.setAttribute('visibility', 'visible');
      var rows = series.map(function (s, i) {
        var yv = s.power(xv);
        g.dots[i].setAttribute('cx', cx); g.dots[i].setAttribute('cy', g.Y(yv)); g.dots[i].setAttribute('visibility', 'visible');
        return '<span class="lc-tip-row"><i style="background:var(--series-' + (i + 1) + ')"></i>' + esc(s.short) +
          '<b>' + pct(yv, 1) + '</b></span>';
      });
      tip.innerHTML = '<span class="lc-tip-head">' + int(xv) + ' ' + esc(o.unit) + '</span>' + rows.join('');
      tip.hidden = false;
      var tw = tip.offsetWidth, left = cx + 12;
      if (left + tw > plot.clientWidth) left = cx - tw - 12;
      tip.style.left = Math.max(0, left) + 'px';
      tip.style.top = (g.m.t + 60) + 'px';
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
      show((ev.clientX - r.left - g.m.l) / g.pw * g.xmax);
    }
    svg.addEventListener('pointermove', fromPointer);
    svg.addEventListener('pointerdown', fromPointer);
    svg.addEventListener('pointerleave', function () { if (document.activeElement !== svg) hide(); });
    svg.addEventListener('focus', function () { show(null); });
    svg.addEventListener('blur', hide);
    svg.addEventListener('keydown', function (ev) {
      if (!g) return;
      var step = Math.max(1, g.xmax / (ev.shiftKey ? 10 : 50));
      var x = cur.x !== null ? cur.x : g.xmax / 2;
      if (ev.key === 'ArrowRight') x += step;
      else if (ev.key === 'ArrowLeft') x -= step;
      else if (ev.key === 'Home') x = 0;
      else if (ev.key === 'End') x = g.xmax;
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
    return { draw: draw, update: update };
  }

  // ---------- charts and power table for one tab ----------
  function buildCharts(key, host) {
    var T = TABS[key], draws = [];
    T.charts.forEach(function (c) {
      var card = el('div', { 'class': 'tool-card', id: key + '-chart-' + c.key });
      card.innerHTML = '<h2 class="lab-h">' + esc(c.title) + '</h2><p class="tool-sub">' + esc(c.why) + '</p>';
      host.appendChild(card);
      function seriesFor(values) {
        return values.map(function (val) {
          var v = merge(T.paper, c.fixed); v[c.key] = val;
          return {
            short: c.short(val),
            sub: T.need(T.solve(v, 0.9)),
            power: function (n) { return T.power(v, n); }
          };
        });
      }
      if (c.sets) {
        var pick = segControl(c.setLabel, c.sets.map(function (s, i) { return [String(i), s.join(', ')]; }), String(c.open),
          function (i) { chart.update(seriesFor(c.sets[i])); });
        pick.classList.add('set-pick');
        card.appendChild(pick);
      }
      var box = el('div', { 'class': 'lc' });
      card.appendChild(box);
      card.appendChild(el('p', { 'class': 'lc-cap' }, esc(c.caption)));
      var chart = lineChart(box, { title: c.title, legend: c.legend, axis: T.axis, unit: T.unit, xmax: c.xmax, step: c.step });
      chart.update(seriesFor(c.sets ? c.sets[c.open] : c.values));
      draws.push(chart.draw);
    });

    var t = T.table, card = el('div', { 'class': 'tool-card', id: key + '-chart-power' });
    card.innerHTML = '<h2 class="lab-h">' + esc(t.title) + '</h2><p class="tool-sub">' + esc(t.why) + '</p>' +
      '<div class="pw-wrap"><table class="pw-table"><thead><tr><th scope="col">' + esc(t.head) + '</th>' +
      POWERS.map(function (p) { return '<th scope="col">' + pct(p) + '<span> power</span></th>'; }).join('') + '</tr></thead><tbody>' +
      t.values.map(function (val) {
        var v = merge(T.paper); v[t.key] = val;
        var paper = val === T.paper[t.key];
        return '<tr' + (paper ? ' class="is-paper"' : '') + '><th scope="row">' + t.fmt(val) +
          (paper ? ' <small>paper</small>' : '') + '</th>' +
          POWERS.map(function (p) { return '<td>' + t.cell(T.solve(v, p)) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></div><p class="lc-cap">' + esc(t.caption) + '</p>';
    host.appendChild(card);

    return draws;
  }

  // ---------- sliders with one power curve ----------
  function buildTry(key, host) {
    var T = TABS[key], vals = merge(T.paper), controls = {};
    host.innerHTML = '<div class="calc-head"><h2 class="lab-h">Try it</h2>' +
      '<button type="button" class="lab-reset">Reset to the paper values</button></div>' +
      '<div class="try-grid"><div class="try-controls"></div><div class="lc"></div></div>';
    var rows = host.querySelector('.try-controls'), box = host.querySelector('.lc');
    T.sliders.forEach(function (d) {
      var c = sliderControl('try-' + key + '-' + d.key, d, vals[d.key], function (v) { vals[d.key] = v; update(); });
      controls[d.key] = c;
      rows.appendChild(c);
    });
    rows.appendChild(el('p', { 'class': 'set-fixed' }, esc(T.fixedNote)));
    var line = el('p', { 'class': 'result-line', 'aria-live': 'polite' });
    host.appendChild(line);
    var chart = lineChart(box, { title: 'Power curve for the chosen values', axis: T.axis, unit: T.unit, height: 280 });

    function update() {
      var v = merge(vals), r = T.solve(v, v.power);
      line.innerHTML = T.answer(v, r);
      chart.update([{ short: 'Power', power: function (n) { return T.power(v, n); } }], { n: T.count(r), power: v.power });
    }
    host.querySelector('.lab-reset').addEventListener('click', function () {
      vals = merge(T.paper);
      T.sliders.forEach(function (d) { controls[d.key].set(vals[d.key]); });
      update();
    });
    update();

    var study = document.querySelector('[data-study="' + key + '"]');
    if (study) study.innerHTML = T.study(T.solve(T.paper, 0.9));
    return chart.draw;
  }

  // ---------- tabs and the equation switch ----------
  function init() {
    var keys = Object.keys(TABS), redraw = {};
    keys.forEach(function (key) {
      var w = document.querySelector('[data-charts="' + key + '"]');
      var c = document.querySelector('[data-try="' + key + '"]');
      redraw[key] = (w ? buildCharts(key, w) : []).concat(c ? [buildTry(key, c)] : []);
    });

    // The switch picks which form of the equation shows, on every tab.
    var switches = document.querySelectorAll('.eq-switch button');
    switches.forEach(function (b) {
      b.addEventListener('click', function () {
        var v = b.getAttribute('data-view');
        switches.forEach(function (x) { x.setAttribute('aria-pressed', String(x.getAttribute('data-view') === v)); });
        document.querySelectorAll('[data-eq-view]').forEach(function (n) { n.hidden = n.getAttribute('data-eq-view') !== v; });
      });
    });

    var tabs = keys.map(function (k) { return document.getElementById('tab-' + k); });
    function select(key, focus, push) {
      keys.forEach(function (k, i) {
        var on = k === key;
        tabs[i].setAttribute('aria-selected', String(on));
        tabs[i].tabIndex = on ? 0 : -1;
        document.getElementById('panel-' + k).hidden = !on;
        if (on && focus) tabs[i].focus();
      });
      redraw[key].forEach(function (d) { d(); });
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
    fromHash();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
