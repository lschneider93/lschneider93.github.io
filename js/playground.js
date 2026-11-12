/* Pickleball Playground: serve and return landings from one hand-labelled match.
   Data: data/pickleball/serves_returns.json (built by scripts/pickleball/export_playground.py).
   Coordinates in the data are in the hitter's view: x 0 to 20 ft, y 22 (net) to 44 (far baseline). */
(function () {
  'use strict';

  // ---------- statistics (ported from the Serve Explorer prototype) ----------
  var SE = (function () {
    var MIN_N = 8, NET_Y = 22, SEED = 20261112, SHUFFLES = 20000, ALPHA = 0.05,
        LEAN_PTS = 10, LEAN_FT = 1, EPS = 1e-9;
    var LANES = ['sideline', 'body', 'middle'], BANDS = ['deep', 'mid', 'shallow'], COURTS = ['right', 'left'];
    var KEYS = ['team', 'player', 'court', 'parity', 'game'];
    var FIELD = {team: 't', player: 'w', court: 'ct', parity: 'p', game: 'g'};
    function select(rows, f) {
      return rows.filter(function (r) {
        for (var i = 0; i < KEYS.length; i++) {
          var k = KEYS[i];
          if (f[k] != null && r[FIELD[k]] !== f[k]) return false;
        }
        return true;
      });
    }
    function laneCounts(rows) {
      var out = {};
      COURTS.forEach(function (c) { out[c] = {n: 0, sideline: 0, body: 0, middle: 0}; });
      rows.forEach(function (r) {
        if (!(r.ct in out)) return;
        out[r.ct].n += 1;
        if (LANES.indexOf(r.l) >= 0) out[r.ct][r.l] += 1;
      });
      return out;
    }
    function pooledLanes(rows) {
      var lc = laneCounts(rows), out = {n: lc.right.n + lc.left.n};
      LANES.forEach(function (l) { out[l] = lc.right[l] + lc.left[l]; });
      return out;
    }
    function topLane(c) {
      var best = LANES[0];
      LANES.forEach(function (l) { if (c[l] > c[best]) best = l; });
      return best;
    }
    function bandCounts(rows) {
      var out = {n: rows.length, deep: 0, mid: 0, shallow: 0};
      rows.forEach(function (r) { if (BANDS.indexOf(r.b) >= 0) out[r.b] += 1; });
      return out;
    }
    function inDepths(rows) {
      var out = [];
      rows.forEach(function (r) { if (!r.o) out.push(r.y - NET_Y); });
      return out;
    }
    function quantile(vals, q) {
      var s = vals.slice().sort(function (a, b) { return a - b; }), n = s.length;
      if (!n) return null;
      var h = (n - 1) * q, lo = Math.floor(h);
      if (lo + 1 >= n) return s[lo];
      return s[lo] + (h - lo) * (s[lo + 1] - s[lo]);
    }
    function median(v) { return quantile(v, 0.5); }
    function mulberry32(a) {
      return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        var t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
    }
    // seeded shuffle test on the gap between two medians
    function shuffleTest(a, b) {
      var obs = median(a) - median(b), pool = a.concat(b), na = a.length;
      var rng = mulberry32(SEED), hits = 0;
      for (var s = 0; s < SHUFFLES; s++) {
        for (var i = pool.length - 1; i > 0; i--) {
          var j = Math.floor(rng() * (i + 1)), tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
        }
        var d = median(pool.slice(0, na)) - median(pool.slice(na));
        if (Math.abs(d) >= Math.abs(obs) - EPS) hits += 1;
      }
      return [obs, (hits + 1) / (SHUFFLES + 1)];
    }
    function wilson(k, n) {
      if (!n) return [0, 1];
      var z = 1.959963984540054, p = k / n, den = 1 + z * z / n;
      var c = (p + z * z / (2 * n)) / den;
      var h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den;
      return [Math.max(0, c - h), Math.min(1, c + h)];
    }
    function newcombe(k1, n1, k2, n2) {
      var p1 = k1 / n1, p2 = k2 / n2, a = wilson(k1, n1), b = wilson(k2, n2), d = p2 - p1;
      return [d, d - Math.sqrt(Math.pow(p2 - b[0], 2) + Math.pow(a[1] - p1, 2)),
                 d + Math.sqrt(Math.pow(b[1] - p2, 2) + Math.pow(p1 - a[0], 2))];
    }
    function tag(n1, n2, gap, clear, leanAt) {
      if (n1 < MIN_N || n2 < MIN_N) return 'small';
      if (clear) return 'clear';
      if (Math.abs(gap) >= leanAt - EPS) return 'lean';
      return 'none';
    }
    function shareCompare(k1, n1, k2, n2) {
      if (n1 < MIN_N || n2 < MIN_N) return {k1: k1, n1: n1, k2: k2, n2: n2, gap: null, lo: null, hi: null, tag: 'small'};
      var g = newcombe(k1, n1, k2, n2), gap = 100 * (k1 / n1 - k2 / n2);
      var clear = !(g[1] <= 0 && 0 <= g[2]);
      return {k1: k1, n1: n1, k2: k2, n2: n2, gap: gap, lo: -100 * g[2], hi: -100 * g[1],
              tag: tag(n1, n2, gap, clear, LEAN_PTS)};
    }
    function ftCompare(a, b) {
      var n1 = a.length, n2 = b.length;
      if (n1 < MIN_N || n2 < MIN_N) return {n1: n1, n2: n2, v1: null, v2: null, gap: null, p: null, tag: 'small'};
      var r = shuffleTest(a, b);
      return {n1: n1, n2: n2, v1: median(a), v2: median(b), gap: r[0], p: r[1],
              tag: tag(n1, n2, r[0], r[1] < ALPHA, LEAN_FT)};
    }
    function fmt1(v) { return (Math.floor(v * 10 + 0.5) / 10).toFixed(1); }
    function backhandLane(c) { return c === 'right' ? 'middle' : c === 'left' ? 'sideline' : null; }
    function labelParts(f, ctx) {
      var who = f.player ? (ctx.players[f.player] || f.player) : f.team ? (ctx.teams[f.team] || f.team) : 'Everyone';
      return [who,
              f.court ? f.court + ' court' : null,
              f.parity ? 'receiving team on an ' + f.parity + ' score' : null,
              f.game != null ? 'game ' + f.game : null];
    }
    var OPEN = ['Everyone', 'both courts', 'any score', 'all games'];
    function compareNames(fa, fb, ctx) {
      var pa = labelParts(fa, ctx), pb = labelParts(fb, ctx), da = [], db = [];
      for (var i = 0; i < pa.length; i++) {
        if (pa[i] !== pb[i]) { da.push(pa[i] || OPEN[i]); db.push(pb[i] || OPEN[i]); }
      }
      if (!da.length) return ['first group', 'second group'];
      return [da.join(' · '), db.join(' · ')];
    }
    function line(label, va, vb, na, nb, res, kind) {
      var text = res.tag === 'small'
        ? label + ': not enough serves to compare (' + res.n1 + ' for ' + na + ', ' + res.n2 + ' for ' + nb + ').'
        : label + ': ' + va + ' (' + na + ') vs ' + vb + ' (' + nb + ').';
      return {text: text, tag: res.tag, stat: res, kind: kind};
    }
    function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
    function compare(lens, rows, fa, fb, ctx) {
      var A = select(rows, fa), B = select(rows, fb), nm = compareNames(fa, fb, ctx), na = nm[0], nb = nm[1];
      if (lens === 'lane') {
        if (fa.court && fb.court) {
          var la = laneCounts(A)[fa.court], lb = laneCounts(B)[fb.court];
          var ka = la[backhandLane(fa.court)], kb = lb[backhandLane(fb.court)];
          return [line('To the backhand side', ka + ' of ' + la.n, kb + ' of ' + lb.n, na, nb, shareCompare(ka, la.n, kb, lb.n), 'backhand')];
        }
        var pa = pooledLanes(A), pb = pooledLanes(B), ln = topLane(pa);
        return [line(cap(ln) + ' lane', pa[ln] + ' of ' + pa.n, pb[ln] + ' of ' + pb.n, na, nb, shareCompare(pa[ln], pa.n, pb[ln], pb.n), 'lane')];
      }
      var r1 = ftCompare(inDepths(A), inDepths(B));
      var l1 = line('Typical serve, feet from the net', r1.v1 != null ? fmt1(r1.v1) + ' ft' : '', r1.v2 != null ? fmt1(r1.v2) + ' ft' : '', na, nb, r1, 'typical');
      var ba = bandCounts(A), bb = bandCounts(B);
      var l2 = line('Deep (the last 3 ft)', ba.deep + ' of ' + ba.n, bb.deep + ' of ' + bb.n, na, nb, shareCompare(ba.deep, ba.n, bb.deep, bb.n), 'deep');
      return [l1, l2];
    }
    return {MIN_N: MIN_N, LANES: LANES, BANDS: BANDS, COURTS: COURTS, select: select, laneCounts: laneCounts,
            topLane: topLane, bandCounts: bandCounts, wilson: wilson, shareCompare: shareCompare, compare: compare};
  })();

  var TAG_TEXT = {clear: 'Clear difference', lean: 'Leans this way, could be chance', none: 'No difference', small: 'Small sample, we need more data'};
  var THIRDS = ['left', 'middle', 'right'];
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]; }); }
  function pct(k, n) { return Math.round(100 * k / n) + '%'; }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  var D = null, CTX = null, TEAM_SLOT = {}, PLAYER_TEAM = {};
  var state = {role: 'serve', view: 'lane', game: null, team: null, players: [], court: null, parity: null, preset: null, a: null, b: null};

  var PRESETS = [
    {key: 'teams', q: 'Team vs team: who serves where?', view: 'lane',
      a: {team: 0}, b: {team: 1}},
    {key: 'deeper', q: 'Which team serves deeper?', view: 'depth',
      a: {team: 0}, b: {team: 1}},
    {key: 'courts', q: 'Right court vs left court', view: 'lane',
      a: {court: 'right'}, b: {court: 'left'}},
    {key: 'one', q: 'One player: right court vs left court', view: 'lane', pick: 'one',
      a: {player: 'BJ', court: 'right'}, b: {player: 'BJ', court: 'left'}},
    {key: 'two', q: 'Player vs player', view: 'lane', pick: 'two',
      a: {player: 'BJ'}, b: {player: 'JW'}},
    {key: 'parity', q: 'Receiving team on an odd score vs an even score', view: 'lane',
      a: {parity: 'odd'}, b: {parity: 'even'}}
  ];
  function filt(spec) {
    var f = {team: null, player: null, court: null, parity: null, game: null};
    if (spec.team != null) f.team = typeof spec.team === 'number' ? D.teams[spec.team].id : spec.team;
    if (spec.player) { f.player = spec.player; f.team = PLAYER_TEAM[spec.player]; }
    if (spec.court) f.court = spec.court;
    if (spec.parity) f.parity = spec.parity;
    return f;
  }

  // ---------- selection ----------
  function pick(rows) {
    return rows.filter(function (r) {
      if (state.game != null && r.g !== state.game) return false;
      if (state.team && r.t !== state.team) return false;
      if (state.players.length && state.players.indexOf(r.w) < 0) return false;
      if (state.court && r.ct !== state.court) return false;
      if (state.parity && r.p !== state.parity) return false;
      return true;
    });
  }
  function shown() {
    return {
      serve: state.role === 'return' ? [] : pick(D.serves),
      ret: state.role === 'serve' ? [] : pick(D.returns)
    };
  }

  // ---------- court drawing: 10 svg units per foot, server at the bottom ----------
  var X0 = -1.5, X1 = 21.5, YTOP = 47.4, YBOT = -4.2;
  function X(f) { return (f - X0) * 10; }
  function Y(f) { return (YTOP - f) * 10; }
  function n1(v) { return Math.round(v * 10) / 10; }
  function rect(x0, y0, x1, y1, cls) {
    return '<rect class="' + cls + '" x="' + n1(X(x0)) + '" y="' + n1(Y(y1)) + '" width="' + n1(X(x1) - X(x0)) + '" height="' + n1(Y(y0) - Y(y1)) + '"/>';
  }
  function seg(x0, y0, x1, y1, cls) {
    return '<line class="' + cls + '" x1="' + n1(X(x0)) + '" y1="' + n1(Y(y0)) + '" x2="' + n1(X(x1)) + '" y2="' + n1(Y(y1)) + '"/>';
  }
  function txt(x, y, s, size, opt) {
    opt = opt || {};
    return '<text x="' + n1(X(x)) + '" y="' + n1(Y(y)) + '" font-size="' + size + '" text-anchor="' + (opt.anchor || 'middle') +
      '" dominant-baseline="central"' + (opt.dim ? ' class="dim"' : '') + ' font-weight="' + (opt.w || 500) + '">' + esc(s) + '</text>';
  }
  function pill(x, y, s, size, anchor) {
    var w = s.length * size * 0.56 + 8, h = size + 5, cx = X(x), x0 = anchor === 'end' ? cx - w + 4 : cx - w / 2;
    return '<rect class="pg-pill" x="' + n1(x0) + '" y="' + n1(Y(y) - h / 2) + '" width="' + n1(w) + '" height="' + n1(h) + '" rx="3"/>' +
      txt(x, y, s, size, {anchor: anchor, w: 700});
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function courtX0(c) { return c === 'right' ? 0 : 10; }
  function laneX(c, lane) {
    var i = c === 'right' ? ['sideline', 'body', 'middle'].indexOf(lane) : ['middle', 'body', 'sideline'].indexOf(lane);
    return [courtX0(c) + i * 10 / 3, courtX0(c) + (i + 1) * 10 / 3];
  }
  // where a row is drawn: serves as they are, returns turned around to come back down the court
  function pos(r, role) {
    var x = role === 'serve' ? r.x : 20 - r.x, y = role === 'serve' ? r.y : 44 - r.y;
    return [clamp(x, X0 + 0.5, X1 - 0.5), clamp(y, YBOT + 1.2, YTOP - 1.2)];
  }
  function thirdX(t) { // a returner's third, on the turned-around court
    return t === 'left' ? [40 / 3, 20] : t === 'middle' ? [20 / 3, 40 / 3] : [0, 20 / 3];
  }
  function thirdCounts(rows) {
    var c = {n: rows.length, left: 0, middle: 0, right: 0};
    rows.forEach(function (r) { if (THIRDS.indexOf(r.l) >= 0) c[r.l] += 1; });
    return c;
  }
  function topOf(c, keys) {
    var best = keys[0];
    keys.forEach(function (k) { if (c[k] > c[best]) best = k; });
    return c[best] > 0 ? best : null;
  }
  function share(k, n) { return n >= SE.MIN_N ? pct(k, n) : ''; }

  function markSvg(cx, cy, slot) {
    if (slot === 1) {
      var d = 3.9;
      return '<path class="mark" d="M' + n1(cx) + ' ' + n1(cy - d) + 'L' + n1(cx + d) + ' ' + n1(cy) + 'L' + n1(cx) + ' ' + n1(cy + d) + 'L' + n1(cx - d) + ' ' + n1(cy) + 'Z"/>';
    }
    return '<circle class="mark" cx="' + n1(cx) + '" cy="' + n1(cy) + '" r="3.1"/>';
  }

  function courtSvg(sel) {
    var s = '', lit = '', splits = '', top = '';
    var showServe = state.role !== 'return', showRet = state.role !== 'serve';
    s += rect(X0, YBOT, X1, YTOP, 'pg-apron');
    s += rect(0, 0, 20, 44, 'pg-surface');
    s += rect(0, 15, 20, 29, 'pg-kitchen');

    if (showServe) {
      var rows = sel.serve;
      if (state.view === 'lane') {
        var courts = state.court ? [state.court] : SE.COURTS, lc = SE.laneCounts(rows);
        courts.forEach(function (c) {
          var cc = lc[c], cx0 = courtX0(c);
          for (var i = 1; i < 3; i++) splits += seg(cx0 + i * 10 / 3, 29, cx0 + i * 10 / 3, 44, 'pg-split');
          top += txt(cx0 + 5, 27.9, cap(c) + ' court · ' + cc.n, 8, {w: 700});
          var best = cc.n >= SE.MIN_N ? SE.topLane(cc) : null;
          if (best) { var lx = laneX(c, best); lit += rect(lx[0], 29, lx[1], 44, 'pg-lit'); }
          SE.LANES.forEach(function (l) {
            var xx = laneX(c, l), mx = (xx[0] + xx[1]) / 2;
            top += txt(mx, 26.3, l, 7, {dim: true});
            top += txt(mx, 24.8, String(cc[l]), 9.5, {w: 700});
            top += txt(mx, 23.4, share(cc[l], cc.n), 7.5);
          });
        });
      } else {
        var bc = SE.bandCounts(rows);
        lit += rect(0, 41, 20, 44, 'pg-lit');
        splits += seg(0, 41, 20, 41, 'pg-split') + seg(0, 36.5, 20, 36.5, 'pg-split');
        [['deep', 'Deep (last 3 ft)', 27.6], ['mid', 'Mid (next 4.5 ft)', 25.5], ['shallow', 'Shallow (the rest)', 23.4]].forEach(function (b) {
          top += txt(10, b[2], b[1] + ': ' + bc[b[0]] + ' of ' + bc.n + (bc.n >= SE.MIN_N ? ' · ' + pct(bc[b[0]], bc.n) : ''), 8, {w: b[0] === 'deep' ? 700 : 500});
        });
        top += pill(19.6, 42.5, 'deep', 7, 'end') + pill(19.6, 38.75, 'mid', 7, 'end') + pill(19.6, 32.75, 'shallow', 7, 'end');
      }
    }
    if (showRet) {
      var rr = sel.ret;
      if (state.view === 'lane') {
        var tc = thirdCounts(rr), bt = tc.n >= SE.MIN_N ? topOf(tc, THIRDS) : null;
        splits += seg(20 / 3, 0, 20 / 3, 19.9, 'pg-split') + seg(40 / 3, 0, 40 / 3, 19.9, 'pg-split');
        if (bt) { var tx = thirdX(bt); lit += rect(tx[0], 0, tx[1], 15, 'pg-lit'); }
        top += txt(10, 20.8, 'Thirds, as the returner sees them · ' + tc.n, 8, {w: 700});
        THIRDS.forEach(function (t) {
          var xx = thirdX(t), mx = (xx[0] + xx[1]) / 2;
          top += txt(mx, 19.2, t, 7, {dim: true});
          top += txt(mx, 17.7, String(tc[t]), 9.5, {w: 700});
          top += txt(mx, 16.3, share(tc[t], tc.n), 7.5);
        });
      } else {
        var rb = SE.bandCounts(rr);
        lit += rect(0, 0, 20, 3, 'pg-lit');
        splits += seg(0, 3, 20, 3, 'pg-split') + seg(0, 10, 20, 10, 'pg-split');
        [['deep', 'Deep (19 ft or more)', 20.6], ['mid', 'Mid (12 to 19 ft)', 18.5], ['shallow', 'Shallow (under 12 ft)', 16.4]].forEach(function (b) {
          top += txt(10, b[2], b[1] + ': ' + rb[b[0]] + ' of ' + rb.n + (rb.n >= SE.MIN_N ? ' · ' + pct(rb[b[0]], rb.n) : ''), 8, {w: b[0] === 'deep' ? 700 : 500});
        });
        top += pill(19.6, 1.5, 'deep', 7, 'end') + pill(19.6, 6.5, 'mid', 7, 'end') + pill(19.6, 12.5, 'shallow', 7, 'end');
      }
    }

    // court lines over the zones, net last
    var lines = '<rect class="pg-line" x="' + X(0) + '" y="' + Y(44) + '" width="200" height="440"/>' +
      seg(0, 15, 20, 15, 'pg-line') + seg(0, 29, 20, 29, 'pg-line') +
      seg(10, 0, 10, 15, 'pg-line') + seg(10, 29, 10, 44, 'pg-line') +
      seg(-0.3, 22, 20.3, 22, 'pg-net');

    var marks = '', idx = 0;
    function add(rows, role) {
      rows.forEach(function (r) {
        var p = pos(r, role), cx = X(p[0]), cy = Y(p[1]), slot = TEAM_SLOT[r.t] || 0;
        marks += '<g class="pg-dot t' + slot + '" tabindex="' + (idx === 0 ? 0 : -1) + '" role="img" data-role="' + role + '" data-i="' + (role === 'serve' ? D.serves.indexOf(r) : D.returns.indexOf(r)) +
          '" aria-label="' + esc(ariaFor(r, role)) + '"><circle class="hit" cx="' + n1(cx) + '" cy="' + n1(cy) + '" r="5.5"/>' + markSvg(cx, cy, slot) + '</g>';
        idx += 1;
      });
    }
    add(sel.serve, 'serve'); add(sel.ret, 'return');

    var caps = txt(10, 45.9, "receiver's baseline", 7, {dim: true}) + txt(10, -3.3, "server's baseline", 7, {dim: true}) +
      '<text class="dim" font-size="7" text-anchor="middle" dominant-baseline="central" transform="translate(' + n1(X(-0.8)) + ' ' + n1(Y(22)) + ') rotate(-90)">net</text>';
    var label = 'Pickleball court, 20 by 44 feet. ' + describeCount(sel) + ' Use the arrow keys to move between marks.';
    return '<svg viewBox="0 0 ' + n1(X(X1)) + ' ' + n1(Y(YBOT)) + '" role="group" aria-label="' + esc(label) + '">' +
      s + lit + splits + lines + caps + '<g id="pg-marks">' + marks + '</g><g pointer-events="none">' + top + '</g></svg>';
  }

  // ---------- words ----------
  function spot(r) {
    if (r.o) {
      if (r.y > 44) return 'Landed out, ' + (r.y - 44).toFixed(1) + ' ft past the baseline';
      return 'Landed out, wide of the sideline';
    }
    return 'Landed ' + (r.y - 22).toFixed(1) + ' ft past the net, ' + r.x.toFixed(1) + ' ft from the left sideline';
  }
  function bandWords(r, role) {
    if (r.o) return 'Out: counted in no lane or depth band';
    if (role === 'serve') return cap(r.b) + ' depth, ' + r.l + ' lane, ' + r.ct + ' court';
    return cap(r.b) + ' depth, ' + r.l + ' third (returner\'s view)';
  }
  function ariaFor(r, role) {
    return D.players[r.w] + ', ' + role + ', game ' + r.g + ' rally ' + (+r.id.slice(1)) + '. ' + spot(r) + '. ' + bandWords(r, role) + '.';
  }
  function tipHtml(r, role) {
    return '<b>' + esc(D.players[r.w]) + ' · ' + role + '</b>Game ' + r.g + ', rally ' + (+r.id.slice(1)) +
      (r.p ? ' · receiving score ' + r.p : '') + '<br>' + esc(spot(r)) + '<br>' + esc(bandWords(r, role));
  }
  function describeCount(sel) {
    var parts = [];
    if (state.role !== 'return') parts.push(plural(sel.serve.length, 'serve'));
    if (state.role !== 'serve') parts.push(plural(sel.ret.length, 'return'));
    return 'Showing ' + parts.join(' and ') + '.';
  }
  function filterWords() {
    var w = [];
    if (state.players.length) w.push(state.players.map(function (p) { return D.players[p]; }).join(' and '));
    else if (state.team) w.push(CTX.teams[state.team]);
    else w.push('Both teams');
    w.push(state.game != null ? 'game ' + state.game : 'all 3 games');
    if (state.court) w.push('serves into the ' + state.court + ' court');
    if (state.parity) w.push('receiving team on an ' + state.parity + ' score');
    return w.join(', ');
  }

  // ---------- side panel ----------
  function tableHtml(title, sub, n, rows, noun) {
    var best = null;
    rows.forEach(function (r) { if (!r.out && (best == null || r.k > best)) best = r.k; });
    var h = '<table class="pg-table"><caption>' + esc(title) + ' <small>' + esc(sub) + '</small></caption><tbody>';
    rows.forEach(function (r) {
      if (r.out && !r.k) return;
      var sh = n >= SE.MIN_N ? pct(r.k, n) : '';
      h += '<tr' + (!r.out && r.k === best && r.k > 0 && n >= SE.MIN_N ? ' class="top"' : '') + '><th scope="row">' + esc(r.label) + (r.hint ? '<small>' + esc(r.hint) + '</small>' : '') + '</th>' +
        '<td class="k">' + r.k + ' of ' + n + '</td><td class="share"><span>' + sh + '</span>' + (sh ? '<i style="width:' + Math.round(100 * r.k / n) + '%"></i>' : '') + '</td></tr>';
    });
    if (n < SE.MIN_N) h += '<tr><th scope="row" colspan="3">Small sample (' + plural(n, noun) + '). No shares shown under 8.</th></tr>';
    return h + '</tbody></table>';
  }
  function outCount(rows) { return rows.filter(function (r) { return r.o; }).length; }
  function tablesHtml(sel) {
    var h = '';
    if (state.role !== 'return') {
      var S = sel.serve;
      if (state.view === 'lane') {
        var lc = SE.laneCounts(S);
        (state.court ? [state.court] : SE.COURTS).forEach(function (c) {
          var cc = lc[c], bh = c === 'right' ? 'middle' : 'sideline';
          h += tableHtml('Serves into the ' + c + ' court', 'by lane, named from the receiver', cc.n, SE.LANES.map(function (l) {
            return {label: cap(l), k: cc[l], hint: l === bh ? 'backhand side of a right-hander' : ''};
          }).concat([{label: 'Out', k: outCount(S.filter(function (r) { return r.ct === c; })), out: true}]), 'serve');
        });
      } else {
        var bc = SE.bandCounts(S);
        h += tableHtml('Serves', 'by depth, from the receiver\'s baseline', bc.n, [
          {label: 'Deep', k: bc.deep, hint: 'the last 3 ft'},
          {label: 'Mid', k: bc.mid, hint: 'the next 4.5 ft'},
          {label: 'Shallow', k: bc.shallow, hint: 'the rest, up to the kitchen'},
          {label: 'Out', k: outCount(S), out: true}], 'serve');
      }
    }
    if (state.role !== 'serve') {
      var R = sel.ret;
      if (state.view === 'lane') {
        var tc = thirdCounts(R);
        h += tableHtml('Returns', 'by third of the court, as the returner sees it', tc.n, THIRDS.map(function (t) {
          return {label: cap(t), k: tc[t]};
        }).concat([{label: 'Out', k: outCount(R), out: true}]), 'return');
      } else {
        var rb = SE.bandCounts(R);
        h += tableHtml('Returns', 'by depth, from the net', rb.n, [
          {label: 'Deep', k: rb.deep, hint: '19 ft or more, the last 3 ft'},
          {label: 'Mid', k: rb.mid, hint: '12 to 19 ft'},
          {label: 'Shallow', k: rb.shallow, hint: 'under 12 ft'},
          {label: 'Out', k: outCount(R), out: true}], 'return');
      }
    }
    return h;
  }
  function legendHtml(sel) {
    var all = sel.serve.concat(sel.ret), h = '';
    D.teams.forEach(function (t, i) {
      var n = all.filter(function (r) { return r.t === t.id; }).length;
      h += '<span class="chart-legend-item"><svg viewBox="-5 -5 10 10" class="pg-dot t' + i + '" aria-hidden="true">' + markSvg(0, 0, i) + '</svg>' +
        (i ? 'Diamond' : 'Circle') + ': ' + esc(t.name) + ' (' + n + ')</span>';
    });
    h += '<span class="chart-legend-item"><i class="sw lit"></i>' + (state.view === 'lane' ? 'Most used lane' : 'Deep band') + '</span>';
    h += '<span class="chart-legend-item"><i class="sw kitchen"></i>Kitchen (no volleys)</span>';
    return h;
  }

  // ---------- presets ----------
  function presetByKey(k) { for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].key === k) return PRESETS[i]; return null; }
  function applyPreset(p, a, b) {
    state.preset = p.key; state.role = 'serve'; state.view = p.view;
    state.a = a || filt(p.a); state.b = b || filt(p.b);
    syncFromPair();
  }
  function syncFromPair() {
    var a = state.a, b = state.b, ps = [];
    [a.player, b.player].forEach(function (pl) { if (pl && ps.indexOf(pl) < 0) ps.push(pl); });
    state.players = ps;
    state.team = ps.length ? (ps.every(function (pl) { return PLAYER_TEAM[pl] === PLAYER_TEAM[ps[0]]; }) ? PLAYER_TEAM[ps[0]] : null)
      : (a.team === b.team ? a.team : null);
    state.court = a.court === b.court ? a.court : null;
    state.parity = a.parity === b.parity ? a.parity : null;
    state.game = null;
  }
  function answerLines() {
    if (!state.preset) return [];
    return SE.compare(state.view, D.serves, state.a, state.b, CTX);
  }
  function answerHtml() {
    var lines = answerLines(), h = '', backhand = false;
    lines.forEach(function (ln) {
      if (ln.kind === 'backhand') backhand = true;
      h += '<p>' + esc(ln.text) + ' <span class="pg-tag ' + ln.tag + '">' + TAG_TEXT[ln.tag] + '</span></p>';
    });
    h += '<p class="pg-standing">' + (backhand ? 'Backhand side: the middle lane of the right court and the sideline lane of the left court. All four players are right-handed. ' : '') +
      'One match. A team\'s plan can change from match to match.</p>';
    return h;
  }
  function playerOpts(sel) {
    var h = '';
    D.teams.forEach(function (t) { t.players.forEach(function (p) { h += '<option value="' + p + '"' + (p === sel ? ' selected' : '') + '>' + esc(D.players[p]) + '</option>'; }); });
    return h;
  }
  function pickerHtml() {
    var p = state.preset ? presetByKey(state.preset) : null;
    if (!p || !p.pick) return '';
    if (p.pick === 'one') {
      var h = '<span id="pg-pick-label">Player</span><div class="seg" role="group" aria-labelledby="pg-pick-label">';
      D.teams.forEach(function (t) { t.players.forEach(function (pl) {
        h += '<button type="button" data-pick-one="' + pl + '" aria-pressed="' + (state.a.player === pl) + '">' + esc(D.players[pl]) + '</button>';
      }); });
      return h + '</div>';
    }
    return '<label for="pg-pick-a">Compare</label><select id="pg-pick-a" data-pick-two="a">' + playerOpts(state.a.player) + '</select>' +
      '<label for="pg-pick-b">with</label><select id="pg-pick-b" data-pick-two="b">' + playerOpts(state.b.player) + '</select>';
  }

  // ---------- controls ----------
  function opts(list, sel) {
    return list.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(sel == null ? '' : sel) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('');
  }
  function syncControls() {
    Array.prototype.forEach.call(document.querySelectorAll('#pg-role button'), function (b) { b.setAttribute('aria-pressed', String(b.dataset.role === state.role)); });
    Array.prototype.forEach.call(document.querySelectorAll('#pg-view button'), function (b) { b.setAttribute('aria-pressed', String(b.dataset.view === state.view)); });
    $('pg-game').innerHTML = opts([['', 'All games']].concat(D.games.map(function (g) { return [g, 'Game ' + g]; })), state.game);
    $('pg-team').innerHTML = opts([['', 'Both teams']].concat(D.teams.map(function (t) { return [t.id, t.name]; })), state.team);
    var pl = [['', 'Any player']];
    D.teams.forEach(function (t) { if (!state.team || state.team === t.id) t.players.forEach(function (p) { pl.push([p, D.players[p]]); }); });
    var cur = state.players.length === 1 ? state.players[0] : '';
    if (state.players.length > 1) { cur = 'pair'; pl.push(['pair', state.players.map(function (p) { return D.players[p]; }).join(' and ')]); }
    $('pg-player').innerHTML = opts(pl, cur);
    $('pg-court').innerHTML = opts([['', 'Both courts'], ['right', 'Right court'], ['left', 'Left court']], state.court);
    $('pg-parity').innerHTML = opts([['', 'Any score'], ['odd', 'Odd'], ['even', 'Even']], state.parity);
  }

  function render() {
    var sel = shown();
    $('pg-presets').innerHTML = PRESETS.map(function (p) {
      return '<button type="button" class="filter-chip" data-q="' + p.key + '" aria-pressed="' + (state.preset === p.key) + '">' + esc(p.q) + '</button>';
    }).join('');
    $('pg-picker').innerHTML = pickerHtml();
    var ans = $('pg-answer');
    if (state.preset) { ans.innerHTML = answerHtml(); ans.hidden = false; } else { ans.hidden = true; ans.innerHTML = ''; }
    syncControls();
    hideTip();
    $('pg-svg').innerHTML = courtSvg(sel);
    var cnt = [];
    if (state.role !== 'return') cnt.push('<b>' + sel.serve.length + '</b> ' + (sel.serve.length === 1 ? 'serve' : 'serves'));
    if (state.role !== 'serve') cnt.push('<b>' + sel.ret.length + '</b> ' + (sel.ret.length === 1 ? 'return' : 'returns'));
    $('pg-count').innerHTML = cnt.join(' and ') + ' shown<span>' + esc(filterWords()) + '</span>';
    $('pg-tables').innerHTML = tablesHtml(sel);
    $('pg-legend').innerHTML = legendHtml(sel);
  }

  // ---------- tooltip ----------
  function rowOf(g) { return (g.dataset.role === 'serve' ? D.serves : D.returns)[+g.dataset.i]; }
  function showTip(g) {
    var tip = $('pg-tip'), wrap = $('pg-court-wrap');
    Array.prototype.forEach.call(document.querySelectorAll('.pg-dot.on'), function (d) { d.classList.remove('on'); });
    g.classList.add('on');
    tip.innerHTML = tipHtml(rowOf(g), g.dataset.role);
    tip.hidden = false;
    var r = g.querySelector('.mark').getBoundingClientRect(), w = wrap.getBoundingClientRect();
    var tw = tip.offsetWidth, th = tip.offsetHeight;
    var left = clamp(r.left + r.width / 2 - w.left - tw / 2, 0, Math.max(0, w.width - tw));
    var topPx = r.top - w.top - th - 8;
    if (topPx < 0 && r.bottom - w.top + 8 + th <= w.height) topPx = r.bottom - w.top + 8;
    tip.style.left = left + 'px'; tip.style.top = topPx + 'px';
  }
  function hideTip() {
    $('pg-tip').hidden = true;
    Array.prototype.forEach.call(document.querySelectorAll('.pg-dot.on'), function (d) { d.classList.remove('on'); });
  }

  // ---------- finding cards ----------
  function ci(k, n) { var w = SE.wilson(k, n); return Math.round(100 * w[0]) + ' to ' + Math.round(100 * w[1]) + '%'; }
  function gapWords(c) {
    return 'Gap ' + Math.abs(Math.round(c.gap)) + ' points (95% range ' + Math.round(Math.min(Math.abs(c.lo), Math.abs(c.hi))) + ' to ' +
      Math.round(Math.max(Math.abs(c.lo), Math.abs(c.hi))) + '). ' + TAG_TEXT[c.tag] + '.';
  }
  function gapWordsSigned(c) {
    var crosses = c.lo < 0 && c.hi > 0;
    if (!crosses) return gapWords(c);
    return 'Gap ' + Math.abs(Math.round(c.gap)) + ' points (95% range ' + Math.round(c.lo) + ' to +' + Math.round(c.hi) + ', so it could be zero). ' + TAG_TEXT[c.tag] + '.';
  }
  function findings() {
    var S = D.serves, R = D.returns, out = [];
    var bc = SE.bandCounts(S);
    out.push({id: 'deep-serves', num: bc.deep + ' of ' + bc.n,
      what: 'serves landed deep, in the last 3 ft before the baseline. That is ' + pct(bc.deep, bc.n) + '.',
      small: '95% range ' + ci(bc.deep, bc.n) + '. Most serves landed mid: ' + bc.mid + ' of ' + bc.n + '.'});

    var lc = SE.laneCounts(S), cb = SE.shareCompare(lc.left.sideline, lc.left.n, lc.right.middle, lc.right.n);
    out.push({id: 'backhand', num: lc.left.sideline + ' of ' + lc.left.n + ' <small>vs ' + lc.right.middle + ' of ' + lc.right.n + '</small>',
      what: 'serves went to the receiver\'s backhand side in the left court (' + pct(lc.left.sideline, lc.left.n) + ') against the right court (' + pct(lc.right.middle, lc.right.n) + ').',
      small: gapWordsSigned(cb) + ' All four players are right-handed.'});

    var a = SE.bandCounts(SE.select(S, {team: D.teams[0].id})), b = SE.bandCounts(SE.select(S, {team: D.teams[1].id}));
    var ct = SE.shareCompare(a.deep, a.n, b.deep, b.n);
    out.push({id: 'deep-teams', num: a.deep + ' of ' + a.n + ' <small>vs ' + b.deep + ' of ' + b.n + '</small>',
      what: 'deep serves for ' + esc(D.teams[0].name) + ' (' + pct(a.deep, a.n) + ') against ' + esc(D.teams[1].name) + ' (' + pct(b.deep, b.n) + ').',
      small: gapWordsSigned(ct)});

    var rb = SE.bandCounts(R), ro = outCount(R);
    out.push({id: 'mid-returns', num: rb.mid + ' of ' + rb.n,
      what: 'returns landed mid court, 12 to 19 ft past the net. That is ' + pct(rb.mid, rb.n) + '.',
      small: '95% range ' + ci(rb.mid, rb.n) + '. ' + rb.deep + ' landed deep, ' + rb.shallow + ' shallow, ' + ro + ' out.'});

    var mid = R.filter(function (r) { return r.b === 'mid' && r.t3; }), drops = mid.filter(function (r) { return r.t3 === 'drop'; }).length;
    var typed = R.filter(function (r) { return r.t3; }).length;
    out.push({id: 'third-drop', num: drops + ' of ' + mid.length,
      what: 'times, off a mid return, the serving team hit a drop (a soft ball into the kitchen) as its third shot. That is ' + pct(drops, mid.length) + '.',
      small: '95% range ' + ci(drops, mid.length) + '. Only ' + typed + ' third shots have a type label so far, so this count is small.'});

    var ev = thirdCounts(R.filter(function (r) { return r.p === 'even'; })), od = thirdCounts(R.filter(function (r) { return r.p === 'odd'; }));
    var cp = SE.shareCompare(ev.right, ev.n, od.right, od.n);
    out.push({id: 'return-right', num: ev.right + ' of ' + ev.n + ' <small>vs ' + od.right + ' of ' + od.n + '</small>',
      what: 'returns went to the returner\'s right third on an even receiving score (' + pct(ev.right, ev.n) + ') against an odd one (' + pct(od.right, od.n) + ').',
      small: gapWordsSigned(cp) + ' On odd scores the receiving pair has to switch sides after the return (stacking).'});
    return out;
  }
  function renderFindings() {
    $('pg-findings').innerHTML = findings().map(function (f) {
      return '<div class="metric-tile" data-finding="' + f.id + '"><span class="metric-num">' + f.num + '</span><span class="metric-what">' + f.what + '<small>' + f.small + '</small></span></div>';
    }).join('');
  }

  // ---------- events ----------
  function userFilter() { state.preset = null; state.a = state.b = null; }
  function bind() {
    document.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target : e.target.parentNode;
      var q = t.closest('[data-q]');
      if (q) { applyPreset(presetByKey(q.dataset.q)); render(); focusBack('[data-q="' + q.dataset.q + '"]'); return; }
      var one = t.closest('[data-pick-one]');
      if (one) {
        var pl = one.dataset.pickOne;
        state.a.player = state.b.player = pl; state.a.team = state.b.team = PLAYER_TEAM[pl];
        syncFromPair(); render(); focusBack('[data-pick-one="' + pl + '"]'); return;
      }
      var rb = t.closest('#pg-role button');
      if (rb) {
        if (rb.dataset.role !== 'serve') userFilter();
        state.role = rb.dataset.role; render(); return;
      }
      var vb = t.closest('#pg-view button');
      if (vb) { state.view = vb.dataset.view; render(); return; }
      if (t.closest('#pg-reset')) {
        userFilter();
        state.role = 'serve'; state.view = 'lane'; state.game = null; state.team = null; state.players = []; state.court = null; state.parity = null;
        render(); return;
      }
      var dot = t.closest('.pg-dot[data-i]');
      if (dot) { dot.focus(); showTip(dot); return; }
      hideTip();
    });
    document.addEventListener('change', function (e) {
      var el = e.target;
      if (el.dataset.pickTwo) {
        var side = el.dataset.pickTwo;
        state[side].player = el.value; state[side].team = PLAYER_TEAM[el.value];
        syncFromPair(); render(); focusBack('#' + el.id); return;
      }
      var k = el.dataset.k;
      if (!k) return;
      var v = el.value === '' ? null : el.value;
      userFilter();
      if (k === 'game') state.game = v == null ? null : +v;
      else if (k === 'team') {
        state.team = v;
        state.players = state.players.filter(function (p) { return !v || PLAYER_TEAM[p] === v; });
      } else if (k === 'player') {
        if (v === 'pair') return;
        state.players = v ? [v] : [];
        if (v && state.team && PLAYER_TEAM[v] !== state.team) state.team = null;
      } else state[k] = v;
      render(); focusBack('#' + el.id);
    });
    var svgBox = $('pg-svg');
    svgBox.addEventListener('mouseover', function (e) { var d = e.target.closest && e.target.closest('.pg-dot'); if (d) showTip(d); });
    svgBox.addEventListener('mouseout', function (e) { var d = e.target.closest && e.target.closest('.pg-dot'); if (!d) return;
      var f = document.activeElement && document.activeElement.closest ? document.activeElement.closest('.pg-dot[data-i]') : null;
      if (f) showTip(f); else hideTip();
    });
    svgBox.addEventListener('focusin', function (e) { var d = e.target.closest && e.target.closest('.pg-dot'); if (d) showTip(d); });
    svgBox.addEventListener('focusout', hideTip);
    svgBox.addEventListener('keydown', function (e) {
      var d = e.target.closest && e.target.closest('.pg-dot');
      if (!d) return;
      var all = Array.prototype.slice.call(svgBox.querySelectorAll('.pg-dot')), i = all.indexOf(d), j = i;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = Math.min(all.length - 1, i + 1);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = Math.max(0, i - 1);
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = all.length - 1;
      else if (e.key === 'Escape') { hideTip(); return; }
      else return;
      e.preventDefault();
      d.setAttribute('tabindex', '-1'); all[j].setAttribute('tabindex', '0'); all[j].focus();
    });
  }
  function focusBack(selr) { var el = document.querySelector(selr); if (el) el.focus(); }

  function fail() {
    $('pg-error').hidden = false;
    $('pg-stage').hidden = true;
    $('pg-controls').hidden = true;
    $('pg-findings').innerHTML = '<p class="note">The match data did not load, so there are no numbers to show.</p>';
  }

  function start(data) {
    D = data;
    CTX = {teams: {}, players: D.players};
    D.teams.forEach(function (t, i) { CTX.teams[t.id] = t.name; TEAM_SLOT[t.id] = i; t.players.forEach(function (p) { PLAYER_TEAM[p] = t.id; }); });
    var nc = D.not_counted, tot = D.totals;
    var foot = 'Drawn: the ' + D.serves.length + ' serves and ' + D.returns.length + ' returns whose bounce I saw. Left out: ' +
      plural(nc.serve.no_landing, 'serve') + ' and ' + plural(nc['return'].no_landing, 'return') + ' with no landing recorded, plus ' +
      plural(nc.serve.estimated, 'serve') + ' and ' + plural(nc['return'].estimated, 'return') + ' placed without seeing the bounce.';
    $('pg-foot').textContent = foot + ' Courts are named from the receiving side, so the right court is on your left.';
    $('pg-how-counts').textContent = 'The match has ' + tot.serve + ' serves and ' + tot['return'] + ' returns. Only landings I placed by hand after seeing the bounce are on this page: ' +
      D.serves.length + ' serves and ' + D.returns.length + ' returns. Model estimates of where a ball landed are left out.';
    bind();
    render();
    renderFindings();
  }

  fetch('data/pickleball/serves_returns.json')
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(start)
    .catch(function (err) { if (window.console) console.warn('playground data failed to load', err); fail(); });
})();
