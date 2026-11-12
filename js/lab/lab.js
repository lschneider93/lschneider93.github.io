// Stats Lab page: tabs, "what if" small multiples, and calculators.
// All math lives in js/lab/power.js (window.LabPower). Charts are plain
// inline SVG colored with CSS variables, so both themes work with no redraw.
(function () {
  'use strict';

  var LP = window.LabPower;
  if (!LP) return;

  var SVGNS = 'http://www.w3.org/2000/svg';
  var ALPHA = 0.05;

  // ---------- formatting ----------
  function int(n) { return Math.round(n).toLocaleString('en-US'); }
  function pct(p, d) { return (p * 100).toFixed(d || 0) + '%'; }
  function fix(d) { return function (v) { return Number(v).toFixed(d); }; }
  function tick(v) {
    if (v >= 1e6) return (v / 1e6) + 'M';
    if (v >= 1e4) return (v / 1e3) + 'k';
    return int(v);
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

  // ---------- tab definitions ----------
  // Each tab gives: four effect sizes, the nuisance sliders for the small
  // multiples, n(effect, power, s) and power(effect, n, s) for the charts,
  // and the calculator inputs with a plain-words result sentence.
  var TABS = {
    cox: {
      effects: [1.25, 1.5, 1.75, 2.0],
      effectLabel: function (e) { return 'Hazard ratio ' + e.toFixed(2); },
      people: 'patients',
      whatIfTitle: 'What if the effect were bigger or smaller?',
      whatIfSub: 'Each panel is one hazard ratio. Weak effects need far more patients.',
      nuisance: [
        { key: 'sigma', label: 'SD of the predictor', min: 0.1, max: 2, step: 0.05, value: 0.7, fmt: fix(2),
          hint: 'How much the predictor varies. A 50/50 yes or no factor is 0.50.' },
        { key: 'eventRate', label: 'Patients who have the event', min: 0.05, max: 1, step: 0.01, value: 0.36, fmt: pct,
          hint: 'Only events carry information. Fewer events means more patients.' }
      ],
      foot: 'Fixed here: two-sided alpha 0.05, no other covariates (R² = 0).',
      n: function (e, power, s) {
        return LP.coxN({ hr: e, sigma: s.sigma, eventRate: s.eventRate, alpha: ALPHA, power: power }).raw;
      },
      power: function (e, n, s) {
        return LP.coxPower({ hr: e, n: n, sigma: s.sigma, eventRate: s.eventRate, alpha: ALPHA });
      },
      calcSub: 'Starts at the study values above. Move any slider.',
      inputs: [
        { key: 'hr', label: 'Hazard ratio', min: 1.05, max: 3, step: 0.01, value: 1.89, fmt: fix(2),
          hint: 'Per 1-unit rise in the predictor.' },
        { key: 'sigma', label: 'SD of the predictor', min: 0.1, max: 2, step: 0.01, value: 0.7, fmt: fix(2),
          hint: 'Use 0.50 for a 50/50 yes or no factor.' },
        { key: 'eventRate', label: 'Patients who have the event', min: 0.05, max: 1, step: 0.01, value: 0.36, fmt: pct,
          hint: 'Share with the event by the end of follow-up.' },
        { key: 'r2', label: 'R² with other covariates', min: 0, max: 0.9, step: 0.01, value: 0, fmt: fix(2),
          hint: 'Overlap between the predictor and the rest of the model.' },
        { key: 'alpha', label: 'Alpha (two-sided)', min: 0.005, max: 0.1, step: 0.005, value: 0.05, fmt: fix(3),
          hint: 'Chance of a false alarm.' },
        { key: 'power', label: 'Power', min: 0.5, max: 0.99, step: 0.01, value: 0.9, fmt: pct,
          hint: 'Chance of finding a real effect.' }
      ],
      result: function (v) {
        var r = LP.coxN(v);
        return {
          line: 'With a hazard ratio of ' + v.hr.toFixed(2) + ' and ' + pct(v.eventRate) +
            ' of patients having an event, you need about <b>' + int(r.n) + '</b> patients for ' + pct(v.power) + ' power.',
          sub: 'That is <b>' + int(r.events) + '</b> events. The number of events drives power, not the number of patients.',
          study: 'To find this effect again with 90% power, a new study would need about <b>' + int(r.n) +
            '</b> patients (<b>' + int(r.events) + '</b> events).'
        };
      }
    },

    logistic: {
      effects: [1.25, 1.5, 1.75, 2.0],
      effectLabel: function (e) { return 'Odds ratio ' + e.toFixed(2); },
      people: 'people',
      whatIfTitle: 'What if the effect were bigger or smaller?',
      whatIfSub: 'Each panel is one odds ratio, per 1 SD rise in the predictor.',
      nuisance: [
        { key: 'p0', label: 'Baseline chance of the outcome', min: 0.005, max: 0.5, step: 0.005, value: 0.017, fmt: function (p) { return pct(p, 1); },
          hint: 'Rare outcomes need many more people. Try 1.7%, then 38%.' }
      ],
      foot: 'Fixed here: two-sided alpha 0.05, no other covariates (R² = 0), predictor on a number scale.',
      n: function (e, power, s) {
        return LP.logisticNormalN({ or: e, p0: s.p0, alpha: ALPHA, power: power }).raw;
      },
      power: function (e, n, s) {
        return LP.logisticNormalPower({ or: e, n: n, p0: s.p0, alpha: ALPHA });
      },
      calcSub: 'Starts at the study values above. Move any slider.',
      inputs: [
        { key: 'xtype', type: 'seg', label: 'Type of predictor', value: 'normal',
          options: [['normal', 'Number scale'], ['binary', 'Yes or no']] },
        { key: 'or', label: 'Odds ratio', min: 1.05, max: 3, step: 0.01, value: 1.61, fmt: fix(2),
          hint: 'Per 1 SD rise, or yes compared with no.' },
        { key: 'p0', label: 'Baseline chance of the outcome', min: 0.005, max: 0.9, step: 0.001, value: 0.017, fmt: function (p) { return pct(p, 1); },
          hint: 'At the average predictor value, or in the "no" group.' },
        { key: 'fracX1', label: 'People in the "yes" group', min: 0.02, max: 0.98, step: 0.01, value: 0.5, fmt: pct,
          hint: 'Share of the sample that has the factor.', showIf: function (v) { return v.xtype === 'binary'; } },
        { key: 'r2', label: 'R² with other covariates', min: 0, max: 0.9, step: 0.01, value: 0, fmt: fix(2),
          hint: 'Overlap between the predictor and the rest of the model.' },
        { key: 'alpha', label: 'Alpha (two-sided)', min: 0.005, max: 0.1, step: 0.005, value: 0.05, fmt: fix(3),
          hint: 'Chance of a false alarm.' },
        { key: 'power', label: 'Power', min: 0.5, max: 0.99, step: 0.01, value: 0.9, fmt: pct,
          hint: 'Chance of finding a real effect.' }
      ],
      result: function (v) {
        var bin = v.xtype === 'binary';
        var r = bin ? LP.logisticBinaryN(v) : LP.logisticNormalN(v);
        var p1 = LP.oddsToP1(v.p0, v.or);
        return {
          line: 'With an odds ratio of ' + v.or.toFixed(2) + (bin ? '' : ' per SD') + ' and a ' + pct(v.p0, 1) +
            ' baseline chance of the outcome, you need about <b>' + int(r.n) + '</b> people for ' + pct(v.power) + ' power.',
          sub: bin
            ? 'The chance of the outcome goes from <b>' + pct(v.p0, 1) + '</b> without the factor to <b>' + pct(p1, 1) +
              '</b> with it. About <b>' + int(r.n * v.fracX1) + '</b> people have the factor.'
            : 'The chance of the outcome goes from <b>' + pct(v.p0, 1) + '</b> at the average to <b>' + pct(p1, 1) + '</b> one SD higher.',
          study: 'To find this effect again with 90% power, a new study would need about <b>' + int(r.n) +
            '</b> women. At a 38% baseline, like the 10 pooled studies, it drops to about <b>' +
            int(LP.logisticNormalN({ or: v.or, p0: 11428 / (11428 + 18323), alpha: v.alpha, power: v.power }).n) + '</b>.'
        };
      }
    },

    auc: {
      effects: [0.60, 0.65, 0.70, 0.75],
      effectLabel: function (e) { return 'AUC ' + e.toFixed(2); },
      people: 'people',
      whatIfTitle: 'What if the score were better or worse?',
      whatIfSub: 'Each panel is one true AUC, tested against a coin flip (0.50).',
      nuisance: [
        { key: 'ratio', label: 'People without the disease per case', min: 0.5, max: 100, step: 0.1, value: 59.6, fmt: fix(1),
          hint: 'Rare diseases mean a big total sample to reach enough cases.' }
      ],
      foot: 'Fixed here: two-sided alpha 0.05, null AUC 0.50, continuous score. Sample size is the total, with and without the disease.',
      n: function (e, power, s) {
        return LP.rocN({ auc0: 0.5, auc1: e, ratio: s.ratio, alpha: ALPHA, power: power }).rawTotal;
      },
      power: function (e, n, s) {
        return LP.rocPower({ auc0: 0.5, auc1: e, ratio: s.ratio, alpha: ALPHA, nPos: n / (1 + s.ratio) });
      },
      calcSub: 'Starts at the study values above. Move any slider.',
      inputs: [
        { key: 'auc1', label: 'AUC you expect', min: 0.51, max: 0.95, step: 0.01, value: 0.58, fmt: fix(2),
          hint: 'How well the score truly sorts people.' },
        { key: 'auc0', label: 'Null AUC', min: 0.5, max: 0.9, step: 0.01, value: 0.5, fmt: fix(2),
          hint: 'The mark to beat. 0.50 is a coin flip.' },
        { key: 'ratio', label: 'People without the disease per case', min: 0.5, max: 100, step: 0.1, value: 59.6, fmt: fix(1),
          hint: '1.0 means equal groups.' },
        { key: 'alpha', label: 'Alpha (two-sided)', min: 0.005, max: 0.1, step: 0.005, value: 0.05, fmt: fix(3),
          hint: 'Chance of a false alarm.' },
        { key: 'power', label: 'Power', min: 0.5, max: 0.99, step: 0.01, value: 0.9, fmt: pct,
          hint: 'Chance of finding a real effect.' }
      ],
      result: function (v) {
        if (v.auc1 <= v.auc0) {
          return { line: 'The AUC you expect must be higher than the null AUC.', sub: '', study: '' };
        }
        var r = LP.rocN(v);
        return {
          line: 'With an AUC of ' + v.auc1.toFixed(2) + ' against a null of ' + v.auc0.toFixed(2) + ', you need about <b>' +
            int(r.nPos) + '</b> people with the disease and <b>' + int(r.nNeg) + '</b> without for ' + pct(v.power) + ' power.',
          sub: 'That is <b>' + int(r.n) + '</b> people in total, at ' + v.ratio.toFixed(1) + ' without the disease per case.',
          study: 'To show this AUC beats a coin flip with 90% power, a new study would need about <b>' + int(r.nPos) +
            '</b> cases and <b>' + int(r.nNeg) + '</b> women without cancer (<b>' + int(r.n) + '</b> in total).'
        };
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

  // A slider with a label and a live number readout.
  function sliderControl(id, d, onInput) {
    var wrap = el('div', { 'class': 'control' });
    wrap.innerHTML =
      '<label for="' + id + '"><span>' + esc(d.label) + '</span><output for="' + id + '">' + d.fmt(d.value) + '</output></label>' +
      '<input type="range" id="' + id + '" min="' + d.min + '" max="' + d.max + '" step="' + d.step + '" value="' + d.value + '">' +
      (d.hint ? '<span class="hint">' + esc(d.hint) + '</span>' : '');
    var input = wrap.querySelector('input'), out = wrap.querySelector('output');
    input.addEventListener('input', function () {
      var v = parseFloat(input.value);
      out.textContent = d.fmt(v);
      input.setAttribute('aria-valuetext', d.fmt(v));
      onInput(v);
    });
    input.setAttribute('aria-valuetext', d.fmt(d.value));
    wrap.set = function (v) { input.value = v; out.textContent = d.fmt(v); input.setAttribute('aria-valuetext', d.fmt(v)); };
    return wrap;
  }

  function segControl(label, options, value, onChange) {
    var wrap = el('div', { 'class': 'control' });
    wrap.innerHTML = '<span class="control-label">' + esc(label) + '</span>' +
      '<div class="seg" role="group" aria-label="' + esc(label) + '">' +
      options.map(function (o) {
        return '<button type="button" data-v="' + o[0] + '" aria-pressed="' + (o[0] === value) + '">' + esc(o[1]) + '</button>';
      }).join('') + '</div>';
    var btns = wrap.querySelectorAll('button');
    function set(v) { btns.forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === v)); }); }
    btns.forEach(function (b) {
      b.addEventListener('click', function () { var v = b.getAttribute('data-v'); set(v); onChange(v); });
    });
    wrap.set = set;
    return wrap;
  }

  // ---------- small multiples ----------
  function buildWhatIf(key, host) {
    var T = TABS[key];
    var state = { view: 'power' };
    T.nuisance.forEach(function (d) { state[d.key] = d.value; });

    host.innerHTML = '<h3>' + esc(T.whatIfTitle) + '</h3><p class="tool-sub">' + esc(T.whatIfSub) + '</p>';
    var bar = el('div', { 'class': 'sm-toolbar' });
    var view = segControl('Chart shows', [['power', 'Power by sample size'], ['n', 'Sample size by power']], 'power',
      function (v) { state.view = v; draw(); });
    view.classList.add('sm-view');
    bar.appendChild(view);
    T.nuisance.forEach(function (d) {
      bar.appendChild(sliderControl('wi-' + key + '-' + d.key, d, function (v) { state[d.key] = v; draw(); }));
    });
    host.appendChild(bar);

    var axes = el('p', { 'class': 'sm-axes' });
    host.appendChild(axes);

    var grid = el('div', { 'class': 'small-multiples' });
    var panels = T.effects.map(function (e, i) {
      var p = el('div', { 'class': 'sm-panel' });
      p.innerHTML = '<h4><i style="background:var(--series-' + (i + 1) + ')"></i>' + esc(T.effectLabel(e)) + '</h4>' +
        '<p class="sm-n"></p><div class="sm-chart"><div class="sm-tip" hidden></div></div>';
      var svg = svgEl('svg', { tabindex: '0', role: 'img', focusable: 'true' });
      p.querySelector('.sm-chart').appendChild(svg);
      grid.appendChild(p);
      var o = { effect: e, idx: i, root: p, svg: svg, tip: p.querySelector('.sm-tip'), note: p.querySelector('.sm-n'), cursor: null };
      wirePanel(o);
      return o;
    });
    host.appendChild(grid);
    host.appendChild(el('p', { 'class': 'sm-foot' }, esc(T.foot)));

    var lastW = 0;
    function draw() {
      var w = panels[0].svg.parentNode.clientWidth;
      if (!w) return;                       // tab is hidden
      lastW = w;
      var h = w < 200 ? 170 : 190;
      var powerView = state.view === 'power';
      axes.textContent = powerView
        ? 'Up: power, from 0 to 1. Across: number of ' + T.people + '. Dashed lines mark 80% and 90% power.'
        : 'Up: number of ' + T.people + ' (log scale). Across: power, from 0.50 to 0.99. Dashed lines mark 80% and 90% power.';

      // shared axes across the four panels
      var ax;
      if (powerView) {
        ax = { xmin: 0, xmax: niceCeil(T.n(T.effects[0], 0.9, state) * 1.08), ymin: 0, ymax: 1 };
      } else {
        ax = {
          xmin: 0.5, xmax: 0.99,
          ymin: floor125(Math.max(1, T.n(T.effects[T.effects.length - 1], 0.5, state))),
          ymax: ceil125(T.n(T.effects[0], 0.99, state))
        };
      }
      panels.forEach(function (p) { drawPanel(T, p, state, ax, w, h, powerView); });
    }

    if (window.ResizeObserver) {
      new ResizeObserver(function () {
        var w = panels[0].svg.parentNode.clientWidth;
        if (w && Math.abs(w - lastW) > 1) draw();
      }).observe(grid);
    } else {
      window.addEventListener('resize', draw);
    }
    return draw;
  }

  function drawPanel(T, p, state, ax, w, h, powerView) {
    var svg = p.svg, e = p.effect;
    var m = { l: powerView ? 30 : 38, r: 10, t: 10, b: 34 };
    var pw = w - m.l - m.r, ph = h - m.t - m.b;
    var color = 'var(--series-' + (p.idx + 1) + ')';
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    var lmin = Math.log10(ax.ymin || 1), lmax = Math.log10(ax.ymax || 10);
    function X(v) { return m.l + (v - ax.xmin) / (ax.xmax - ax.xmin) * pw; }
    function Y(v) {
      if (powerView) return m.t + (1 - v) * ph;
      return m.t + (1 - (Math.log10(v) - lmin) / (lmax - lmin)) * ph;
    }
    function add(tag, attrs, text) {
      var n = svgEl(tag, attrs);
      if (text !== undefined) n.textContent = text;
      svg.appendChild(n);
      return n;
    }

    var n80 = T.n(e, 0.8, state), n90 = T.n(e, 0.9, state);
    var N80 = Math.ceil(n80 - 1e-9), N90 = Math.ceil(n90 - 1e-9);

    // grid and axis labels
    if (powerView) {
      [0, 0.25, 0.5, 0.75, 1].forEach(function (v) {
        add('line', { 'class': 'grid', x1: m.l, x2: m.l + pw, y1: Y(v), y2: Y(v) });
      });
      [0, 0.5, 1].forEach(function (v) {
        add('text', { x: m.l - 6, y: Y(v) + 4, 'text-anchor': 'end' }, v === 0 ? '0' : v === 1 ? '1.0' : '0.5');
      });
      [0, ax.xmax / 2, ax.xmax].forEach(function (v, i) {
        add('line', { 'class': 'grid', x1: X(v), x2: X(v), y1: m.t, y2: m.t + ph });
        add('text', { x: X(v), y: m.t + ph + 14, 'text-anchor': i === 0 ? 'start' : i === 2 ? 'end' : 'middle' }, tick(v));
      });
    } else {
      var ticks = logTicks(ax.ymin, ax.ymax);
      var skip = ticks.length > 7 ? 3 : 1;           // label decades only when crowded
      ticks.forEach(function (v) {
        add('line', { 'class': 'grid', x1: m.l, x2: m.l + pw, y1: Y(v), y2: Y(v) });
        var lead = String(v).charAt(0);
        if (skip === 1 || lead === '1') add('text', { x: m.l - 6, y: Y(v) + 4, 'text-anchor': 'end' }, tick(v));
      });
      [0.5, 0.7, 0.99].forEach(function (v, i) {
        add('text', { x: X(v), y: m.t + ph + 14, 'text-anchor': i === 0 ? 'start' : i === 2 ? 'end' : 'middle' }, v.toFixed(2));
      });
    }
    add('line', { 'class': 'axis', x1: m.l, x2: m.l + pw, y1: m.t + ph, y2: m.t + ph });
    add('text', { 'class': 'ax-title', x: m.l + pw / 2, y: h - 4, 'text-anchor': 'middle' },
      powerView ? 'Sample size' : 'Power');

    // 80% and 90% reference lines, labeled in text
    if (powerView) {
      add('line', { 'class': 'ref', x1: m.l, x2: m.l + pw, y1: Y(0.9), y2: Y(0.9) });
      add('line', { 'class': 'ref', x1: m.l, x2: m.l + pw, y1: Y(0.8), y2: Y(0.8) });
      add('text', { 'class': 'ref-label', x: m.l + pw - 2, y: Y(0.9) - 4, 'text-anchor': 'end' }, '90%');
      add('text', { 'class': 'ref-label', x: m.l + pw - 2, y: Y(0.8) + 13, 'text-anchor': 'end' }, '80%');
    } else {
      add('line', { 'class': 'ref', x1: X(0.8), x2: X(0.8), y1: m.t, y2: m.t + ph });
      add('line', { 'class': 'ref', x1: X(0.9), x2: X(0.9), y1: m.t, y2: m.t + ph });
      add('text', { 'class': 'ref-label', x: X(0.8) - 3, y: m.t + 10, 'text-anchor': 'end' }, '80%');
      add('text', { 'class': 'ref-label', x: X(0.9) + 3, y: m.t + 10, 'text-anchor': 'start' }, '90%');
    }

    // the curve
    var pts = [], i, steps = 90, xv, yv;
    for (i = 0; i <= steps; i++) {
      xv = ax.xmin + (ax.xmax - ax.xmin) * i / steps;
      if (powerView) { yv = xv <= 0 ? LP.pnorm(-LP.qnorm(1 - ALPHA / 2)) : T.power(e, xv, state); }
      else { yv = Math.min(ax.ymax, Math.max(ax.ymin, T.n(e, xv, state))); }
      pts.push(X(xv).toFixed(1) + ',' + Y(yv).toFixed(1));
    }

    // drop lines from the 80% and 90% points
    [[n80, 0.8], [n90, 0.9]].forEach(function (q) {
      var cx = powerView ? X(q[0]) : X(q[1]), cy = powerView ? Y(q[1]) : Y(q[0]);
      if (powerView && q[0] > ax.xmax) return;
      if (powerView) add('line', { 'class': 'drop', style: 'stroke:' + color, x1: cx, x2: cx, y1: cy, y2: m.t + ph });
      else add('line', { 'class': 'drop', style: 'stroke:' + color, x1: m.l, x2: cx, y1: cy, y2: cy });
    });
    add('polyline', { 'class': 'curve', style: 'stroke:' + color, points: pts.join(' ') });
    [[n80, 0.8], [n90, 0.9]].forEach(function (q) {
      if (powerView && q[0] > ax.xmax) return;
      add('circle', { 'class': 'mark', style: 'fill:' + color, r: 4.5, cx: powerView ? X(q[0]) : X(q[1]), cy: powerView ? Y(q[1]) : Y(q[0]) });
    });

    // cursor layer for hover and keyboard
    var cl = add('line', { 'class': 'cursor-line', y1: m.t, y2: m.t + ph, visibility: 'hidden' });
    var cd = add('circle', { 'class': 'cursor-dot', r: 4.5, visibility: 'hidden' });

    p.note.innerHTML = '<span>80% power: <b>' + int(N80) + '</b></span> · <span>90% power: <b>' + int(N90) + '</b></span>';
    svg.setAttribute('aria-label', T.effectLabel(e) + '. ' + int(N80) + ' ' + T.people + ' for 80% power, ' +
      int(N90) + ' for 90% power. Use the left and right arrow keys to read the curve.');

    p.geom = {
      m: m, pw: pw, ph: ph, ax: ax, X: X, Y: Y, line: cl, dot: cd, powerView: powerView,
      start: powerView ? Math.min(n80, ax.xmax) : 0.8,
      valueAt: function (x) { return powerView ? T.power(e, x, state) : T.n(e, x, state); }
    };
    if (p.cursor !== null && p.active) showCursor(p, null);
  }

  function showCursor(p, xv) {
    var g = p.geom;
    if (!g) return;
    if (xv === null) xv = p.cursorX !== undefined && p.cursorView === g.powerView ? p.cursorX : g.start;
    var lo = g.powerView ? Math.max(1, g.ax.xmax / 400) : g.ax.xmin;
    xv = Math.min(g.ax.xmax, Math.max(lo, xv));
    if (g.powerView) xv = Math.max(1, Math.round(xv));
    var yv = g.valueAt(xv);
    var cx = g.X(xv), cy = g.Y(g.powerView ? yv : Math.min(g.ax.ymax, Math.max(g.ax.ymin, yv)));
    g.line.setAttribute('x1', cx); g.line.setAttribute('x2', cx); g.line.setAttribute('visibility', 'visible');
    g.dot.setAttribute('cx', cx); g.dot.setAttribute('cy', cy); g.dot.setAttribute('visibility', 'visible');
    p.cursor = true; p.cursorX = xv; p.cursorView = g.powerView;

    p.tip.innerHTML = g.powerView
      ? 'N = <b>' + int(xv) + '</b> · power <b>' + yv.toFixed(3) + '</b>'
      : 'Power <b>' + xv.toFixed(2) + '</b> · N = <b>' + int(Math.ceil(yv - 1e-9)) + '</b>';
    p.tip.hidden = false;
    var box = p.svg.parentNode, tw = p.tip.offsetWidth, th = p.tip.offsetHeight;
    var left = Math.min(box.clientWidth - tw, Math.max(0, cx - tw / 2));
    var top = cy - th - 10;
    if (top < 0) top = cy + 12;
    p.tip.style.left = left + 'px';
    p.tip.style.top = top + 'px';
  }

  function hideCursor(p) {
    var g = p.geom;
    p.active = false;
    p.tip.hidden = true;
    if (g) { g.line.setAttribute('visibility', 'hidden'); g.dot.setAttribute('visibility', 'hidden'); }
  }

  function wirePanel(p) {
    var svg = p.svg;
    function fromPointer(ev) {
      var g = p.geom; if (!g) return;
      var r = svg.getBoundingClientRect();
      var frac = (ev.clientX - r.left - g.m.l) / g.pw;
      p.active = true;
      showCursor(p, g.ax.xmin + frac * (g.ax.xmax - g.ax.xmin));
    }
    svg.addEventListener('pointermove', fromPointer);
    svg.addEventListener('pointerdown', fromPointer);
    svg.addEventListener('pointerleave', function () { if (document.activeElement !== svg) hideCursor(p); });
    svg.addEventListener('focus', function () { p.active = true; showCursor(p, null); });
    svg.addEventListener('blur', function () { hideCursor(p); });
    svg.addEventListener('keydown', function (ev) {
      var g = p.geom; if (!g) return;
      var span = g.ax.xmax - g.ax.xmin, step = span / (ev.shiftKey ? 10 : 50), x = p.cursorX !== undefined ? p.cursorX : g.start;
      if (ev.key === 'ArrowRight') x += step;
      else if (ev.key === 'ArrowLeft') x -= step;
      else if (ev.key === 'Home') x = g.ax.xmin;
      else if (ev.key === 'End') x = g.ax.xmax;
      else if (ev.key === 'Escape') { hideCursor(p); return; }
      else return;
      ev.preventDefault();
      p.active = true;
      showCursor(p, x);
    });
  }

  // ---------- calculator ----------
  function buildCalc(key, host) {
    var T = TABS[key], vals = {}, controls = {};
    T.inputs.forEach(function (d) { vals[d.key] = d.value; });

    host.innerHTML = '<div class="calc-head"><div><h3>Calculator</h3></div>' +
      '<button type="button" class="lab-reset">Reset to the study values</button></div>' +
      '<p class="tool-sub">' + esc(T.calcSub) + '</p>';
    var grid = el('div', { 'class': 'control-grid' });
    T.inputs.forEach(function (d) {
      var c = d.type === 'seg'
        ? segControl(d.label, d.options, d.value, function (v) { vals[d.key] = v; update(); })
        : sliderControl('calc-' + key + '-' + d.key, d, function (v) { vals[d.key] = v; update(); });
      controls[d.key] = c;
      grid.appendChild(c);
    });
    host.appendChild(grid);
    var line = el('p', { 'class': 'result-line', 'aria-live': 'polite' });
    var sub = el('p', { 'class': 'result-sub' });
    host.appendChild(line);
    host.appendChild(sub);

    function update() {
      T.inputs.forEach(function (d) { if (d.showIf) controls[d.key].hidden = !d.showIf(vals); });
      var v = {}; Object.keys(vals).forEach(function (k) { v[k] = vals[k]; });
      v.sides = 2;
      var r = T.result(v);
      line.innerHTML = r.line;
      sub.innerHTML = r.sub;
      sub.hidden = !r.sub;
      return r;
    }
    host.querySelector('.lab-reset').addEventListener('click', function () {
      T.inputs.forEach(function (d) { vals[d.key] = d.value; controls[d.key].set(d.value); });
      update();
    });

    // The study card's answer line uses the same function and the study inputs.
    var r0 = update();
    var study = document.querySelector('[data-study="' + key + '"]');
    if (study && r0.study) study.innerHTML = r0.study;
  }

  // ---------- tabs ----------
  var redraw = {};
  function init() {
    var keys = Object.keys(TABS);
    keys.forEach(function (key) {
      var w = document.querySelector('[data-whatif="' + key + '"]');
      var c = document.querySelector('[data-calc="' + key + '"]');
      if (w) redraw[key] = buildWhatIf(key, w);
      if (c) buildCalc(key, c);
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
    function fromHash() {
      var h = location.hash.replace('#', '');
      select(keys.indexOf(h) >= 0 ? h : keys[0], false, false);
    }
    window.addEventListener('hashchange', fromHash);
    fromHash();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
