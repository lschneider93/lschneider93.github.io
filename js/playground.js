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
    function mean(v) { var t = 0; for (var i = 0; i < v.length; i++) t += v[i]; return v.length ? t / v.length : null; }
    function mulberry32(a) {
      return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        var t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
    }
    // seeded shuffle test on the gap between two averages
    function shuffleTest(a, b) {
      var obs = mean(a) - mean(b), pool = a.concat(b), na = a.length;
      var rng = mulberry32(SEED), hits = 0;
      for (var s = 0; s < SHUFFLES; s++) {
        for (var i = pool.length - 1; i > 0; i--) {
          var j = Math.floor(rng() * (i + 1)), tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
        }
        var d = mean(pool.slice(0, na)) - mean(pool.slice(na));
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
      return {n1: n1, n2: n2, v1: mean(a), v2: mean(b), gap: r[0], p: r[1],
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
      var l1 = line('Average depth, feet past the net', r1.v1 != null ? fmt1(r1.v1) + ' ft' : '', r1.v2 != null ? fmt1(r1.v2) + ' ft' : '', na, nb, r1, 'typical');
      var ba = bandCounts(A), bb = bandCounts(B);
      var l2 = line('Deep (the last 3 ft)', ba.deep + ' of ' + ba.n, bb.deep + ' of ' + bb.n, na, nb, shareCompare(ba.deep, ba.n, bb.deep, bb.n), 'deep');
      return [l1, l2];
    }
    return {MIN_N: MIN_N, LANES: LANES, BANDS: BANDS, COURTS: COURTS, select: select, laneCounts: laneCounts,
            topLane: topLane, bandCounts: bandCounts, wilson: wilson, shareCompare: shareCompare, ftCompare: ftCompare,
            inDepths: inDepths, mean: mean, fmt1: fmt1, compare: compare};
  })();

  var TAG_TEXT = {clear: 'Clear difference', lean: 'Leans this way, could be chance', none: 'No difference', small: 'Small sample, we need more data'};
  var THIRDS = ['left', 'middle', 'right'], SIDES = ['forehand', 'body', 'backhand'];
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]; }); }
  function pct(k, n) { return Math.round(100 * k / n) + '%'; }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  var f1 = SE.fmt1, mean = SE.mean;

  var D = null, CTX = null, TEAM_SLOT = {}, PLAYER_TEAM = {};
  var state = {role: 'serve', q: 'where', view: 'lane', game: null, team: null, players: [], court: null, parity: null, a: null, b: null};
  var wideMq = window.matchMedia ? window.matchMedia('(min-width: 701px)') : {matches: true};

  // view: lane (which side), avg (average depth lines), band (depth bands)
  // by: how the side summaries are grouped (team unless stated)
  var QUESTIONS = {
    serve: [
      {key: 'where', main: true, q: 'Who serves where?', chip: 'The short answer', view: 'lane', hl: 'side'},
      {key: 'deeper', q: 'Which team serves deeper?', view: 'avg', hl: 'depth'},
      {key: 'target', q: 'Is a team targeting a spot?', view: 'lane', hl: 'side'},
      {key: 'courts', q: 'Right court vs left court?', view: 'lane', hl: 'side', by: 'court'},
      {key: 'deep', q: 'How many serves are deep?', view: 'band', hl: 'band'},
      {key: 'missed', q: 'How many serves missed?', view: 'lane', ring: true},
      {key: 'two', q: 'Player vs player', view: 'lane', hl: 'side', pick: 'two', by: 'player', a: {player: 'B'}, b: {player: 'D'}},
      {key: 'one', q: 'One player: right court vs left court', view: 'lane', hl: 'side', pick: 'one', by: 'court',
        a: {player: 'B', court: 'right'}, b: {player: 'B', court: 'left'}}
    ],
    'return': [
      {key: 'rwhere', main: true, q: 'Where do returns go?', chip: 'The short answer', view: 'lane', hl: 'side'},
      {key: 'rdeep', q: 'How deep are returns?', view: 'band', hl: 'band'},
      {key: 'rteams', q: 'Which team returns deeper?', view: 'avg', hl: 'depth'},
      {key: 'rparity', q: 'Odd score vs even score?', view: 'lane', hl: 'side', by: 'parity'},
      {key: 'rthird', q: 'What comes after a mid return?', view: 'band', hl: 'band'},
      {key: 'rmissed', q: 'How many returns missed?', view: 'lane', ring: true}
    ]
  };
  function mainQ() { return QUESTIONS[state.role][0]; }
  function curQ() {
    var list = QUESTIONS[state.role];
    for (var i = 0; i < list.length; i++) if (list[i].key === state.q) return list[i];
    return null;
  }
  function filt(spec) {
    var f = {team: null, player: null, court: null, parity: null, game: null};
    if (spec.player) { f.player = spec.player; f.team = PLAYER_TEAM[spec.player]; }
    if (spec.court) f.court = spec.court;
    return f;
  }
  function applyQ(q) {
    state.q = q.key; state.view = q.view;
    state.game = null; state.team = null; state.court = null; state.parity = null; state.players = [];
    state.a = q.a ? filt(q.a) : null; state.b = q.b ? filt(q.b) : null;
    syncPlayers();
  }
  function syncPlayers() {
    var ps = [];
    [state.a, state.b].forEach(function (f) { if (f && f.player && ps.indexOf(f.player) < 0) ps.push(f.player); });
    state.players = ps;
  }

  // ---------- selection ----------
  function all() { return state.role === 'serve' ? D.serves : D.returns; }
  function shown() {
    return all().filter(function (r) {
      if (state.game != null && r.g !== state.game) return false;
      if (state.team && r.t !== state.team) return false;
      if (state.players.length && state.players.indexOf(r.w) < 0) return false;
      if (state.court && r.ct !== state.court) return false;
      if (state.parity && r.p !== state.parity) return false;
      return true;
    });
  }
  function teamShort(t) { return t.players.join(' & '); }
  function groupsOf(rows) {
    var q = curQ(), by = (q && q.by) || 'team', out = [];
    if (by === 'player') {
      state.players.forEach(function (p) {
        out.push({label: D.players[p], short: p, slot: TEAM_SLOT[PLAYER_TEAM[p]], rows: rows.filter(function (r) { return r.w === p; })});
      });
    } else if (by === 'court') {
      SE.COURTS.forEach(function (c) {
        out.push({label: cap(c) + ' court', short: cap(c), slot: null, court: c, rows: rows.filter(function (r) { return r.ct === c; })});
      });
    } else if (by === 'parity') {
      ['even', 'odd'].forEach(function (p) {
        out.push({label: cap(p) + ' score', short: cap(p), slot: null, rows: rows.filter(function (r) { return r.p === p; })});
      });
    } else {
      D.teams.forEach(function (t, i) {
        out.push({label: t.name, short: teamShort(t), slot: i, rows: rows.filter(function (r) { return r.t === t.id; })});
      });
    }
    return out.filter(function (g) { return g.rows.length; });
  }

  // ---------- numbers ----------
  function inRows(rows) { return rows.filter(function (r) { return !r.o; }); }
  function stat(vals) {
    if (!vals.length) return null;
    return {n: vals.length, mean: mean(vals), min: Math.min.apply(null, vals), max: Math.max.apply(null, vals)};
  }
  function depthStat(rows) { return stat(SE.inDepths(rows)); }
  // serves: feet from the center line. returns: feet from the returner's left sideline.
  function wideStat(rows, role) {
    return stat(inRows(rows).map(function (r) { return role === 'serve' ? Math.abs(r.x - 10) : r.x; }));
  }
  // a right-handed receiver's forehand is on the low-x side of both service courts
  function sideName(court, lane) {
    if (lane === 'body') return 'body';
    if (lane !== 'sideline' && lane !== 'middle') return null;
    return (court === 'right') === (lane === 'sideline') ? 'forehand' : 'backhand';
  }
  function sideCounts(rows) {
    var c = {n: rows.length, forehand: 0, body: 0, backhand: 0, out: 0};
    rows.forEach(function (r) { var s = sideName(r.ct, r.l); if (s) c[s] += 1; else if (r.o) c.out += 1; });
    return c;
  }
  function thirdCounts(rows) {
    var c = {n: rows.length, left: 0, middle: 0, right: 0, out: 0};
    rows.forEach(function (r) { if (THIRDS.indexOf(r.l) >= 0) c[r.l] += 1; else if (r.o) c.out += 1; });
    return c;
  }
  function bandCounts(rows) {
    var c = SE.bandCounts(rows); c.out = rows.filter(function (r) { return r.o; }).length; return c;
  }
  function topOf(c, keys) {
    var best = keys[0];
    keys.forEach(function (k) { if (c[k] > c[best]) best = k; });
    return c[best] > 0 ? best : null;
  }
  function share(k, n) { return n >= SE.MIN_N ? pct(k, n) : ''; }
  function sidePhrase(s) { return s === 'body' ? 'at the body' : 'to the ' + s + ' side'; }

  // ---------- court drawing: 10 svg units per foot, net at the bottom ----------
  var X0 = -1.5, X1 = 21.5, XS = 29.5, YTOP = 47.4, NET = 22, YB_PLAIN = 20.7;
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
    var w = s.length * size * 0.54 + 8, h = size + 5, cx = X(x);
    var x0 = anchor === 'end' ? cx - w + 4 : anchor === 'start' ? cx - 4 : cx - w / 2;
    return '<rect class="pg-pill" x="' + n1(x0) + '" y="' + n1(Y(y) - h / 2) + '" width="' + n1(w) + '" height="' + n1(h) + '" rx="3"/>' +
      txt(x, y, s, size, {anchor: anchor, w: 700});
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function courtX0(c) { return c === 'right' ? 0 : 10; }
  function laneX(c, lane) {
    var i = c === 'right' ? ['sideline', 'body', 'middle'].indexOf(lane) : ['middle', 'body', 'sideline'].indexOf(lane);
    return [courtX0(c) + i * 10 / 3, courtX0(c) + (i + 1) * 10 / 3];
  }
  function thirdX(t) { return t === 'left' ? [0, 20 / 3] : t === 'middle' ? [20 / 3, 40 / 3] : [40 / 3, 20]; }
  function pos(r) { return [clamp(r.x, X0 + 0.5, X1 - 0.5), clamp(r.y, NET + 0.4, YTOP - 1.2)]; }

  function markSvg(cx, cy, slot, k) {
    k = k || 1;
    if (slot === 1) {
      var d = 3.9 * k;
      return '<path class="mark" d="M' + n1(cx) + ' ' + n1(cy - d) + 'L' + n1(cx + d) + ' ' + n1(cy) + 'L' + n1(cx) + ' ' + n1(cy + d) + 'L' + n1(cx - d) + ' ' + n1(cy) + 'Z"/>';
    }
    if (slot == null) return '<rect class="mark" x="' + n1(cx - 1.6 * k) + '" y="' + n1(cy - 4.2 * k) + '" width="' + n1(3.2 * k) + '" height="' + n1(8.4 * k) + '" rx="1"/>';
    return '<circle class="mark" cx="' + n1(cx) + '" cy="' + n1(cy) + '" r="' + n1(3.1 * k) + '"/>';
  }
  function gcls(g) { return g.slot == null ? 'gn' : 'g' + g.slot; }

  // a range bar: shortest to deepest (or side to side) with a mark at the average
  function rangeBar(g, st, vertical, at, lo, hi, mid, tip) {
    var h = '<g class="pg-range ' + gcls(g) + '"><title>' + esc(tip) + '</title>';
    if (vertical) {
      h += seg(at, lo, at, hi, 'bar') + seg(at - 0.45, lo, at + 0.45, lo, 'bar') + seg(at - 0.45, hi, at + 0.45, hi, 'bar') +
        markSvg(X(at), Y(mid), g.slot, 1.15);
    } else {
      h += seg(lo, at, hi, at, 'bar') + seg(lo, at - 0.42, lo, at + 0.42, 'bar') + seg(hi, at - 0.42, hi, at + 0.42, 'bar') +
        markSvg(X(mid), Y(at), g.slot, 1.05);
    }
    return h + '</g>';
  }

  function courtSvg(rows, opt) {
    opt = opt || {};
    var role = state.role, q = curQ(), view = state.view, groups = groupsOf(rows);
    var strip = !!opt.strip && groups.length > 0, wstrip = !opt.plain && groups.length > 0;
    var ng = Math.max(1, Math.min(2, groups.length));
    var yb = opt.plain ? YB_PLAIN : (wstrip ? 20.4 - 1.5 * ng - 1.6 : YB_PLAIN);
    var xr = strip ? XS : X1;
    var s = '', lit = '', splits = '', top = '';
    s += rect(X0, yb, xr, YTOP, 'pg-apron');
    s += rect(0, NET, 20, 44, 'pg-surface');
    s += rect(0, NET, 20, 29, 'pg-kitchen');

    if (view === 'lane' && role === 'serve') {
      var courts = state.court ? [state.court] : SE.COURTS;
      courts.forEach(function (c) {
        var cr = rows.filter(function (r) { return r.ct === c; }), sc = sideCounts(cr), cx0 = courtX0(c);
        for (var i = 1; i < 3; i++) splits += seg(cx0 + i * 10 / 3, 29, cx0 + i * 10 / 3, 44, 'pg-split');
        top += txt(cx0 + 5, 28.1, cap(c) + ' court · ' + sc.n, 8.5, {w: 700});
        var best = sc.n >= SE.MIN_N ? topOf(sc, SIDES) : null;
        SE.LANES.forEach(function (l) {
          var xx = laneX(c, l), mx = (xx[0] + xx[1]) / 2, side = sideName(c, l);
          if (side === best) lit += rect(xx[0], 29, xx[1], 44, 'pg-lit');
          top += txt(mx, 26.3, String(sc[side]), 12, {w: 700});
          top += txt(mx, 24.75, share(sc[side], sc.n), 8);
          top += txt(mx, 23.35, side, 6.5, {w: 600});
        });
      });
    } else if (view === 'lane') {
      var tc = thirdCounts(rows), bt = tc.n >= SE.MIN_N ? topOf(tc, THIRDS) : null;
      splits += seg(20 / 3, 29, 20 / 3, 44, 'pg-split') + seg(40 / 3, 29, 40 / 3, 44, 'pg-split');
      top += txt(10, 28.1, 'Thirds, as the returner sees them · ' + tc.n, 8.5, {w: 700});
      THIRDS.forEach(function (t) {
        var xx = thirdX(t), mx = (xx[0] + xx[1]) / 2;
        if (t === bt) lit += rect(xx[0], 29, xx[1], 44, 'pg-lit');
        top += txt(mx, 26.3, String(tc[t]), 12, {w: 700});
        top += txt(mx, 24.75, share(tc[t], tc.n), 8);
        top += txt(mx, 23.35, t, 7, {w: 600});
      });
    } else if (view === 'band') {
      var bc = bandCounts(rows), cut = role === 'serve' ? 36.5 : 34;
      var names = role === 'serve'
        ? [['deep', 'Deep (the last 3 ft)'], ['mid', 'Mid (the next 4.5 ft)'], ['shallow', 'Shallow (the rest)']]
        : [['deep', 'Deep (19 ft or more)'], ['mid', 'Mid (12 to 19 ft)'], ['shallow', 'Shallow (under 12 ft)']];
      lit += rect(0, 41, 20, 44, 'pg-lit');
      splits += seg(0, 41, 20, 41, 'pg-split') + seg(0, cut, 20, cut, 'pg-split');
      names.forEach(function (b, i) {
        top += txt(10, 27.7 - i * 1.95, b[1] + ': ' + bc[b[0]] + ' of ' + bc.n + (bc.n >= SE.MIN_N ? ' · ' + pct(bc[b[0]], bc.n) : ''), 8.5, {w: i === 0 ? 700 : 500});
      });
      top += pill(19.6, 42.5, 'deep', 7.5, 'end') + pill(19.6, (41 + cut) / 2, 'mid', 7.5, 'end') + pill(19.6, (cut + 29) / 2 + 0.6, 'shallow', 7.5, 'end');
    } else {
      groups.slice(0, 2).forEach(function (g, i) {
        var st = depthStat(g.rows);
        if (!st) return;
        var y = NET + st.mean;
        top += seg(0, y, 20, y, 'pg-avg ' + gcls(g) + ' d' + i);
        top += pill(i ? 19.6 : 0.4, y + (i ? -1 : 1) * 0.0, g.short + ' average ' + f1(st.mean) + ' ft', 7.5, i ? 'end' : 'start');
        top += txt(10, 26.9 - i * 2.4, g.label + ': ' + f1(st.mean) + ' ft past the net on average', 8, {w: 600});
      });
    }

    var lines = '<rect class="pg-line" x="' + X(0) + '" y="' + Y(44) + '" width="200" height="220"/>' +
      seg(0, 29, 20, 29, 'pg-line') + seg(10, 29, 10, 44, 'pg-line') + seg(-0.3, NET, 20.3, NET, 'pg-net');

    var marks = '', rings = '', idx = 0;
    rows.forEach(function (r) {
      var p = pos(r), cx = X(p[0]), cy = Y(p[1]), slot = TEAM_SLOT[r.t] || 0;
      var dim = q && q.ring && !r.o;
      if (q && q.ring && r.o) rings += '<circle class="pg-ring" cx="' + n1(cx) + '" cy="' + n1(cy) + '" r="9"/>';
      marks += '<g class="pg-dot t' + slot + (dim ? ' dimmed' : '') + '" tabindex="' + (idx === 0 ? 0 : -1) + '" role="img" data-i="' + all().indexOf(r) +
        '" aria-label="' + esc(ariaFor(r)) + '"><circle class="hit" cx="' + n1(cx) + '" cy="' + n1(cy) + '" r="5.5"/>' + markSvg(cx, cy, slot) + '</g>';
      idx += 1;
    });

    var caps = txt(10, 45.9, role === 'serve' ? "receiver's baseline" : "serving team's baseline", 7.5, {dim: true}) +
      '<text class="dim" font-size="7.5" text-anchor="middle" dominant-baseline="central" transform="translate(' + n1(X(-0.8)) + ' ' + n1(Y(NET + 3.5)) + ') rotate(-90)">net</text>';

    // side to side: under the net, lined up with the court's width
    var under = '';
    if (wstrip) {
      var spans = role === 'serve' ? (state.court ? [state.court] : SE.COURTS) : [null];
      groups.slice(0, 2).forEach(function (g, i) {
        spans.forEach(function (c) {
          var gr = inRows(c ? g.rows.filter(function (r) { return r.ct === c; }) : g.rows);
          if (gr.length < 2) return;
          var xs = gr.map(function (r) { return r.x; }), lo = Math.min.apply(null, xs), hi = Math.max.apply(null, xs), m = mean(xs);
          under += rangeBar(g, null, false, 20.4 - i * 1.5, lo, hi, m,
            g.label + (c ? ', ' + c + ' court' : '') + ': side to side, ' + f1(lo) + ' to ' + f1(hi) + ' ft from the left sideline, average ' + f1(m));
        });
      });
      under += txt(10, 20.4 - 1.5 * ng - 0.55, 'Side to side: the range, with a mark at the average', 7, {dim: true});
    }
    // how deep: beside the court, lined up with its depth
    var beside = '';
    if (strip) {
      beside += txt(25.4, 46.2, 'How deep', 8.5, {w: 700}) + txt(25.4, 45.0, 'ft past the net', 7, {dim: true});
      groups.slice(0, 2).forEach(function (g, i) {
        var st = depthStat(g.rows), xf = 23.3 + i * 3.2;
        if (!st) return;
        beside += rangeBar(g, st, true, xf, NET + st.min, NET + st.max, NET + st.mean,
          g.label + ': average ' + f1(st.mean) + ' ft past the net, shortest ' + f1(st.min) + ', deepest ' + f1(st.max));
        beside += txt(xf + 0.65, NET + st.mean, f1(st.mean), 8.5, {anchor: 'start', w: 700});
        beside += txt(xf, NET + st.max + 0.8, f1(st.max), 7, {dim: true}) + txt(xf, NET + st.min - 0.8, f1(st.min), 7, {dim: true});
        beside += txt(xf + 0.4, 21.3, g.short, 7.5, {w: 700});
      });
    }

    var label = 'Half a pickleball court, 20 feet wide, from the net to the baseline. Showing ' +
      plural(rows.length, role === 'serve' ? 'serve' : 'return') + '. Use the arrow keys to move between marks.';
    return '<svg viewBox="0 0 ' + n1(X(xr)) + ' ' + n1(Y(yb)) + '" role="group" aria-label="' + esc(label) + '">' +
      s + lit + splits + lines + caps + under + beside + '<g>' + rings + '</g><g id="pg-marks">' + marks + '</g><g pointer-events="none">' + top + '</g></svg>';
  }

  // ---------- words ----------
  function spot(r) {
    if (r.o) {
      if (r.y > 44) return 'Landed out, ' + (r.y - 44).toFixed(1) + ' ft past the baseline';
      return 'Landed out, wide of the sideline';
    }
    return 'Landed ' + (r.y - 22).toFixed(1) + ' ft past the net, ' + r.x.toFixed(1) + ' ft from the left sideline';
  }
  function bandWords(r) {
    if (r.o) return 'Out: counted in no side and no depth band';
    if (state.role === 'serve') return cap(r.b) + ' depth, ' + (sideName(r.ct, r.l) === 'body' ? 'at the body' : sideName(r.ct, r.l) + ' side') + ', ' + r.ct + ' court';
    return cap(r.b) + ' depth, ' + r.l + ' third (returner\'s view)';
  }
  function roleWord() { return state.role === 'serve' ? 'serve' : 'return'; }
  function ariaFor(r) {
    return D.players[r.w] + ', ' + roleWord() + ', game ' + r.g + ' rally ' + (+r.id.slice(1)) + '. ' + spot(r) + '. ' + bandWords(r) + '.';
  }
  function tipHtml(r) {
    return '<b>' + esc(D.players[r.w]) + ' · ' + roleWord() + '</b>Game ' + r.g + ', rally ' + (+r.id.slice(1)) +
      (r.p ? ' · receiving score ' + r.p : '') + '<br>' + esc(spot(r)) + '<br>' + esc(bandWords(r));
  }
  function filterWords() {
    var w = [];
    if (state.players.length) w.push(state.players.map(function (p) { return D.players[p]; }).join(' and '));
    else if (state.team) w.push(CTX.teams[state.team]);
    else w.push('Both teams');
    w.push(state.game != null ? 'game ' + state.game : 'all ' + D.games.length + ' games');
    if (state.court) w.push('serves into the ' + state.court + ' court');
    if (state.parity) w.push('receiving team on an ' + state.parity + ' score');
    return w.join(', ');
  }

  // ---------- side panel ----------
  function glyph(g) {
    return '<svg viewBox="-6 -6 12 12" class="pg-glyph pg-range ' + gcls(g) + '" aria-hidden="true">' + markSvg(0, 0, g.slot, 1.1) + '</svg>';
  }
  function numTable(title, sub, heads, groups, cellsOf, hl) {
    var h = '<table class="pg-table pg-sum' + (hl ? ' hl' : '') + '"><caption>' + esc(title) + ' <small>' + esc(sub) + '</small></caption><thead><tr><td></td>';
    heads.forEach(function (x) { h += '<th scope="col">' + esc(x) + '</th>'; });
    h += '</tr></thead><tbody>';
    groups.forEach(function (g) {
      h += '<tr><th scope="row">' + glyph(g) + esc(g.label) + '</th>';
      cellsOf(g).forEach(function (c, i) { h += '<td' + (i === 0 ? ' class="lead"' : '') + '>' + c + '</td>'; });
      h += '</tr>';
    });
    return h + '</tbody></table>';
  }
  function statCells(st) { return st ? [f1(st.mean) + ' ft', f1(st.min), f1(st.max)] : ['n/a', '', '']; }
  // rows are categories, columns are groups
  function crossTable(title, sub, cols, rowDefs, hl) {
    var h = '<table class="pg-table pg-sum pg-cross' + (hl ? ' hl' : '') + '"><caption>' + esc(title) + ' <small>' + esc(sub) + '</small></caption><thead><tr><td></td>';
    cols.forEach(function (c) { h += '<th scope="col">' + (c.g ? glyph(c.g) : '') + esc(c.head) + '</th>'; });
    h += '</tr></thead><tbody>';
    var anyOut = cols.some(function (c) { return c.counts.out > 0; });
    rowDefs.concat(anyOut ? [{key: 'out', label: 'Out', out: true}] : []).forEach(function (rd) {
      h += '<tr><th scope="row">' + esc(rd.label) + (rd.hint ? '<small>' + esc(rd.hint) + '</small>' : '') + '</th>';
      cols.forEach(function (c) {
        var n = c.counts.n, k = c.counts[rd.key];
        var isTop = !rd.out && n >= SE.MIN_N && k > 0 && rowDefs.every(function (o) { return c.counts[o.key] <= k; });
        h += '<td' + (isTop ? ' class="top"' : '') + '>' + (n ? k + ' of ' + n + (n >= SE.MIN_N ? '<small>' + pct(k, n) + '</small>' : '') : '') + '</td>';
      });
      h += '</tr>';
    });
    return h + '</tbody></table>';
  }
  function tablesHtml(rows) {
    var q = curQ(), hl = q ? q.hl : null, role = state.role, groups = groupsOf(rows), h = '';
    if (!groups.length) return '<p class="pg-small">Nothing matches these filters.</p>';
    h += numTable('How deep', 'feet past the net', ['Average', 'Shortest', 'Deepest'], groups,
      function (g) { return statCells(depthStat(g.rows)); }, hl === 'depth');
    if (state.view === 'band') {
      h += crossTable('How deep, in bands', role === 'serve' ? 'measured from the baseline' : 'measured from the net',
        groups.map(function (g) { return {head: g.short, g: g, counts: bandCounts(g.rows)}; }),
        role === 'serve'
          ? [{key: 'deep', label: 'Deep', hint: 'the last 3 ft'}, {key: 'mid', label: 'Mid', hint: 'the next 4.5 ft'}, {key: 'shallow', label: 'Shallow', hint: 'the rest'}]
          : [{key: 'deep', label: 'Deep', hint: '19 ft or more'}, {key: 'mid', label: 'Mid', hint: '12 to 19 ft'}, {key: 'shallow', label: 'Shallow', hint: 'under 12 ft'}],
        hl === 'band');
    } else if (role === 'serve') {
      var sideRows = SIDES.map(function (s) { return {key: s, label: s === 'body' ? 'Body' : cap(s) + ' side'}; });
      if (groups[0].court) {
        h += crossTable('Which side', 'of a right-handed receiver', groups.map(function (g) { return {head: g.label, counts: sideCounts(g.rows)}; }), sideRows, hl === 'side');
      } else {
        (state.court ? [state.court] : SE.COURTS).forEach(function (c) {
          h += crossTable('Which side: ' + c + ' court', 'of a right-handed receiver', groups.map(function (g) {
            return {head: g.short, g: g, counts: sideCounts(g.rows.filter(function (r) { return r.ct === c; }))};
          }), sideRows, hl === 'side');
        });
      }
    } else {
      h += crossTable('Which third', 'as the returner sees the court', groups.map(function (g) { return {head: g.short, g: g, counts: thirdCounts(g.rows)}; }),
        THIRDS.map(function (t) { return {key: t, label: cap(t)}; }), hl === 'side');
    }
    h += numTable('How wide', role === 'serve' ? 'feet from the center line' : 'feet from the returner\'s left sideline',
      role === 'serve' ? ['Average', 'Closest', 'Widest'] : ['Average', 'Leftmost', 'Rightmost'], groups,
      function (g) { return statCells(wideStat(g.rows, role)); }, hl === 'width');
    return h;
  }
  function legendHtml(rows) {
    var h = '';
    D.teams.forEach(function (t, i) {
      var n = rows.filter(function (r) { return r.t === t.id; }).length;
      h += '<span class="chart-legend-item"><svg viewBox="-5 -5 10 10" class="pg-dot t' + i + '" aria-hidden="true">' + markSvg(0, 0, i) + '</svg>' +
        (i ? 'Diamond' : 'Circle') + ': ' + esc(t.name) + ' (' + n + ')</span>';
    });
    if (state.view !== 'avg') h += '<span class="chart-legend-item"><i class="sw lit"></i>' + (state.view === 'lane' ? 'Most used' : 'Deep band') + '</span>';
    h += '<span class="chart-legend-item"><i class="sw kitchen"></i>Kitchen</span>';
    h += '<span class="chart-legend-item"><i class="sw bar"></i>Bar: the range, with a mark at the average</span>';
    return h;
  }

  // ---------- conclusions ----------
  function teamRows(rows, i) { return rows.filter(function (r) { return r.t === D.teams[i].id; }); }
  function tn(i) { return D.teams[i].name; }
  function conclude() {
    var q = curQ();
    if (!q) return null;
    var S = D.serves, R = D.returns, out = {big: null, sub: null, lines: []};
    function add(t, tag) { out.lines.push({t: t, tag: tag || null}); }
    var g, d, m, hi, lo, dc, L, bh, ob, sc;
    if (state.role === 'serve') {
      g = [teamRows(S, 0), teamRows(S, 1)];
      d = g.map(SE.inDepths); m = d.map(mean);
      hi = m[0] >= m[1] ? 0 : 1; lo = 1 - hi;
      dc = SE.ftCompare(d[hi], d[lo]);
      L = g.map(function (rows) { return sideCounts(rows.filter(function (r) { return r.ct === 'left'; })); });
      bh = L[0].backhand * L[1].n >= L[1].backhand * L[0].n ? 0 : 1; ob = 1 - bh;
      sc = SE.shareCompare(L[bh].backhand, L[bh].n, L[ob].backhand, L[ob].n);
      var ml = [bh, ob].map(function (i) { return mean(SE.inDepths(g[i].filter(function (r) { return r.ct === 'left'; }))); });
      var slight = m[hi] - m[lo] < 2 ? 'slightly ' : '';
      var deeperLine = tn(hi) + ' served ' + slight + 'deeper: ' + f1(m[hi]) + ' ft past the net on average against ' + f1(m[lo]) + ' ft.';
      var bhLine = 'Into the left court, ' + tn(bh) + ' sent ' + L[bh].backhand + ' of ' + L[bh].n + ' serves to the backhand side, against ' +
        L[ob].backhand + ' of ' + L[ob].n + ' for ' + tn(ob) + '.';
      var reading = 'One reading: pulling the receiver wide, or going at the backhand.';

      if (q.key === 'where') {
        out.big = String(S.length); out.sub = 'serves, each placed by hand';
        add((dc.tag !== 'clear' && sc.tag !== 'clear' ? 'Not much difference between the teams. ' : '') + deeperLine, dc.tag);
        add(bhLine + (ml[0] < ml[1] ? ' Those serves were also slightly shorter: ' + f1(ml[0]) + ' ft against ' + f1(ml[1]) + ' ft.' : ''), sc.tag);
        add(reading);
      } else if (q.key === 'deeper') {
        out.big = f1(m[hi]) + ' ft'; out.sub = 'vs ' + f1(m[lo]) + ' ft';
        add((dc.tag !== 'clear' ? 'Not much difference. ' : '') + deeperLine, dc.tag);
        var ds = g.map(depthStat);
        add('Shortest to deepest: ' + tn(0) + ' ' + f1(ds[0].min) + ' to ' + f1(ds[0].max) + ' ft. ' + tn(1) + ' ' + f1(ds[1].min) + ' to ' + f1(ds[1].max) + ' ft.');
      } else if (q.key === 'target') {
        out.big = L[bh].backhand + ' of ' + L[bh].n; out.sub = 'vs ' + L[ob].backhand + ' of ' + L[ob].n;
        add(bhLine, sc.tag);
        var Rt = g.map(function (rows) { return sideCounts(rows.filter(function (r) { return r.ct === 'right'; })); });
        var tops = Rt.map(function (c) { return topOf(c, SIDES); });
        if (tops[0] && tops[0] === tops[1]) add('Into the right court both teams served mostly ' + sidePhrase(tops[0]) + ': ' + Rt[0][tops[0]] + ' of ' + Rt[0].n + ' and ' + Rt[1][tops[1]] + ' of ' + Rt[1].n + '.');
        else if (tops[0] && tops[1]) add('Into the right court, ' + tn(0) + ' served mostly ' + sidePhrase(tops[0]) + ' (' + Rt[0][tops[0]] + ' of ' + Rt[0].n + ') and ' + tn(1) + ' ' + sidePhrase(tops[1]) + ' (' + Rt[1][tops[1]] + ' of ' + Rt[1].n + ').');
        add(reading);
      } else if (q.key === 'courts') {
        var Lc = sideCounts(S.filter(function (r) { return r.ct === 'left'; })), Rc = sideCounts(S.filter(function (r) { return r.ct === 'right'; }));
        var rt = topOf(Rc, SIDES), cc = SE.shareCompare(Lc.backhand, Lc.n, Rc.backhand, Rc.n);
        out.big = Lc.backhand + ' of ' + Lc.n; out.sub = 'left-court serves to the backhand side';
        add('Left court: ' + Lc.backhand + ' of ' + Lc.n + ' to the backhand side, ' + Lc.forehand + ' to the forehand side. Right court: ' +
          Rc[rt] + ' of ' + Rc.n + ' ' + sidePhrase(rt) + ', ' + Rc.backhand + ' to the backhand side.', cc.tag);
        add(reading);
      } else if (q.key === 'deep') {
        var bc = bandCounts(S), ba = bandCounts(g[0]), bb = bandCounts(g[1]);
        out.big = bc.deep + ' of ' + bc.n; out.sub = pct(bc.deep, bc.n) + ' landed deep';
        add('Deep means the last 3 ft before the baseline. ' + bc.deep + ' of ' + bc.n + ' serves landed there. That is ' + pct(bc.deep, bc.n) + '.');
        add('Most landed mid, the next 4.5 ft: ' + bc.mid + ' of ' + bc.n + '.');
        add(tn(0) + ': ' + ba.deep + ' of ' + ba.n + ' deep. ' + tn(1) + ': ' + bb.deep + ' of ' + bb.n + '.', SE.shareCompare(ba.deep, ba.n, bb.deep, bb.n).tag);
      } else if (q.key === 'missed') {
        var outs = S.filter(function (r) { return r.o; }), faults = D.serve_faults != null ? D.serve_faults : outs.length, tot = D.totals.serve;
        out.big = faults + ' of ' + tot; out.sub = faults === 1 ? 'serve missed' : 'serves missed';
        add(faults + ' of ' + tot + (faults === 1 ? ' serves was missed.' : ' serves were missed.') +
          (faults === 1 && outs.length === 1 && outs[0].y > 44 ? ' It landed ' + (outs[0].y - 44).toFixed(1) + ' ft past the baseline.' : ''));
        add('The ring on the court marks it. ' + S.length + ' of the ' + tot + ' serves have a landing spot placed by hand.');
      } else {
        var pair = groupsOf(shown());
        if (q.key === 'two' && pair.length === 2) {
          var pc = pair.map(function (p) { return sideCounts(p.rows); });
          add('To the backhand side: ' + pc[0].backhand + ' of ' + pc[0].n + ' (' + pair[0].label + ') vs ' + pc[1].backhand + ' of ' + pc[1].n + ' (' + pair[1].label + ').',
            SE.shareCompare(pc[0].backhand, pc[0].n, pc[1].backhand, pc[1].n).tag);
        } else {
          SE.compare('lane', S, state.a, state.b, CTX).forEach(function (ln) { add(ln.text, ln.tag); });
        }
        SE.compare('depth', S, state.a, state.b, CTX).forEach(function (ln) { add(ln.text, ln.tag); });
      }
    } else {
      g = [teamRows(R, 0), teamRows(R, 1)];
      if (q.key === 'rwhere') {
        var tc = thirdCounts(R), tp = topOf(tc, THIRDS), ta = thirdCounts(g[0]), tb = thirdCounts(g[1]);
        out.big = tc[tp] + ' of ' + tc.n; out.sub = 'to the returner\'s ' + tp + ' third';
        add('Most returns went to the returner\'s ' + tp + ' third: ' + tc[tp] + ' of ' + tc.n + '. That is ' + pct(tc[tp], tc.n) + '.');
        add(tn(0) + ': ' + ta[tp] + ' of ' + ta.n + ' to the ' + tp + ' third. ' + tn(1) + ': ' + tb[tp] + ' of ' + tb.n + '.', SE.shareCompare(ta[tp], ta.n, tb[tp], tb.n).tag);
      } else if (q.key === 'rdeep') {
        var rb = bandCounts(R);
        out.big = rb.mid + ' of ' + rb.n; out.sub = pct(rb.mid, rb.n) + ' landed mid court';
        add(rb.mid + ' of ' + rb.n + ' returns landed mid court, 12 to 19 ft past the net. That is ' + pct(rb.mid, rb.n) + '.');
        add(rb.deep + ' landed deep (19 ft or more), ' + rb.shallow + ' shallow and ' + rb.out + ' out.');
      } else if (q.key === 'rteams') {
        d = g.map(SE.inDepths); m = d.map(mean); hi = m[0] >= m[1] ? 0 : 1; lo = 1 - hi; dc = SE.ftCompare(d[hi], d[lo]);
        out.big = f1(m[hi]) + ' ft'; out.sub = 'vs ' + f1(m[lo]) + ' ft';
        add((dc.tag !== 'clear' ? 'Not much difference. ' : '') + tn(hi) + ' returned ' + (m[hi] - m[lo] < 2 ? 'slightly ' : '') + 'deeper: ' +
          f1(m[hi]) + ' ft past the net on average against ' + f1(m[lo]) + ' ft.', dc.tag);
      } else if (q.key === 'rparity') {
        var ev = thirdCounts(R.filter(function (r) { return r.p === 'even'; })), od = thirdCounts(R.filter(function (r) { return r.p === 'odd'; }));
        out.big = pct(ev.right, ev.n); out.sub = 'vs ' + pct(od.right, od.n);
        add('On an even receiving score, ' + ev.right + ' of ' + ev.n + ' returns went to the returner\'s right third (' + pct(ev.right, ev.n) + '). On an odd score, ' +
          od.right + ' of ' + od.n + ' (' + pct(od.right, od.n) + ').', SE.shareCompare(ev.right, ev.n, od.right, od.n).tag);
        add('On odd scores the receiving pair has to switch sides after the return (stacking).');
      } else if (q.key === 'rthird') {
        var mid = R.filter(function (r) { return r.b === 'mid' && r.t3; }), drops = mid.filter(function (r) { return r.t3 === 'drop'; }).length;
        var typed = R.filter(function (r) { return r.t3; }).length;
        out.big = drops + ' of ' + mid.length; out.sub = 'third shots were drops';
        add('Off a mid return, the serving team hit a drop (a soft ball into the kitchen) on ' + drops + ' of ' + mid.length + ' third shots. That is ' + pct(drops, mid.length) + '.');
        add('Only ' + typed + ' third shots have a type label so far, so this count is small.');
      } else {
        var ro = R.filter(function (r) { return r.o; }), byT = [teamRows(ro, 0).length, teamRows(ro, 1).length];
        out.big = ro.length + ' of ' + R.length; out.sub = 'returns landed out';
        add(ro.length + ' of the ' + R.length + ' returns with a landing spot landed out.');
        if (ro.length > 1 && (byT[0] === 0 || byT[1] === 0)) add('All ' + ro.length + ' were hit by ' + tn(byT[0] ? 0 : 1) + '.');
        else if (ro.length) add(tn(0) + ': ' + byT[0] + '. ' + tn(1) + ': ' + byT[1] + '.');
      }
    }
    return out;
  }
  function answerHtml(c, q) {
    var h = '<div class="pg-answer-head"><div><p class="work-label">What we see</p><h4>' + esc(q.q) + '</h4></div>' +
      '<button type="button" class="filter-chip" id="pg-save">Save as image</button></div>';
    h += '<div class="pg-answer-body">';
    if (c.big) h += '<p class="pg-big"><b>' + esc(c.big) + '</b>' + (c.sub ? '<span>' + esc(c.sub) + '</span>' : '') + '</p>';
    h += '<div class="pg-lines">';
    c.lines.forEach(function (ln) {
      h += '<p>' + esc(ln.t) + (ln.tag ? ' <span class="pg-tag ' + ln.tag + '">' + TAG_TEXT[ln.tag] + '</span>' : '') + '</p>';
    });
    h += '<p class="pg-standing">One match. A team\'s plan can change from match to match. All four players are right-handed.</p></div></div>';
    return h;
  }

  // ---------- pickers and controls ----------
  function playerOpts(sel) {
    var h = '';
    D.teams.forEach(function (t) { t.players.forEach(function (p) { h += '<option value="' + p + '"' + (p === sel ? ' selected' : '') + '>' + esc(D.players[p]) + '</option>'; }); });
    return h;
  }
  function pickerHtml() {
    var q = curQ();
    if (!q || !q.pick) return '';
    if (q.pick === 'one') {
      var h = '<span id="pg-pick-label">Player</span><div class="seg" role="group" aria-labelledby="pg-pick-label">';
      D.teams.forEach(function (t) { t.players.forEach(function (pl) {
        h += '<button type="button" data-pick-one="' + pl + '" aria-pressed="' + (state.a.player === pl) + '">' + esc(D.players[pl]) + '</button>';
      }); });
      return h + '</div>';
    }
    return '<label for="pg-pick-a">Compare</label><select id="pg-pick-a" data-pick-two="a">' + playerOpts(state.a.player) + '</select>' +
      '<label for="pg-pick-b">with</label><select id="pg-pick-b" data-pick-two="b">' + playerOpts(state.b.player) + '</select>';
  }
  function opts(list, sel) {
    return list.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(sel == null ? '' : sel) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('');
  }
  function syncControls() {
    Array.prototype.forEach.call(document.querySelectorAll('#pg-role [role="tab"]'), function (b) {
      var on = b.dataset.role === state.role;
      b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
    });
    Array.prototype.forEach.call(document.querySelectorAll('#pg-view button'), function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.view === (state.view === 'lane' ? 'lane' : 'band')));
    });
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
    var rows = shown(), q = curQ(), noun = state.role === 'serve' ? 'serve' : 'return';
    $('pg-title').textContent = mainQ().q;
    $('pg-presets').innerHTML = QUESTIONS[state.role].map(function (p) {
      return '<button type="button" class="filter-chip' + (p.main ? ' main' : '') + '" data-q="' + p.key + '" aria-pressed="' + (state.q === p.key) + '">' + esc(p.chip || p.q) + '</button>';
    }).join('');
    $('pg-picker').innerHTML = pickerHtml();
    syncControls();
    hideTip();
    $('pg-svg').innerHTML = courtSvg(rows, {strip: wideMq.matches});
    $('pg-count').innerHTML = '<b>' + rows.length + '</b> ' + (rows.length === 1 ? noun : noun + 's') + ' shown<span>' + esc(filterWords()) + '</span>';
    $('pg-tables').innerHTML = tablesHtml(rows);
    $('pg-legend').innerHTML = legendHtml(rows);
    var ans = $('pg-answer'), c = conclude();
    if (c) { ans.innerHTML = answerHtml(c, q); ans.hidden = false; }
    else { ans.innerHTML = '<p class="pg-standing">Your own filters. Pick a question above to get its conclusion back.</p>'; ans.hidden = false; }
  }

  // ---------- tooltip ----------
  function rowOf(g) { return all()[+g.dataset.i]; }
  function showTip(g) {
    var tip = $('pg-tip'), wrap = $('pg-court-wrap');
    Array.prototype.forEach.call(document.querySelectorAll('.pg-dot.on'), function (d) { d.classList.remove('on'); });
    g.classList.add('on');
    tip.innerHTML = tipHtml(rowOf(g));
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

  // ---------- save the current question as a 1080 x 1350 image ----------
  var CARD_W = 1080, CARD_H = 1350, CARD_FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
  function wrap(ctx, text, maxW) {
    var words = String(text).split(/\s+/), lines = [], cur = '';
    words.forEach(function (w) {
      var t = cur ? cur + ' ' + w : w;
      if (cur && ctx.measureText(t).width > maxW) { lines.push(cur); cur = w; } else cur = t;
    });
    if (cur) lines.push(cur);
    return lines;
  }
  function cardParts() {
    // the card is always drawn in the light theme: it reads better in a feed
    var root = document.documentElement, prev = root.getAttribute('data-theme');
    root.setAttribute('data-theme', 'light');
    var holder = document.createElement('div');
    holder.className = 'pg-court';
    holder.style.cssText = 'position:absolute;left:-9999px;top:0;width:640px';
    $('explorer').appendChild(holder);
    holder.innerHTML = courtSvg(shown(), {plain: true});
    var svg = holder.firstChild, vb = svg.getAttribute('viewBox').split(' ');
    Array.prototype.forEach.call(svg.querySelectorAll('*'), function (el) {
      var cs = getComputedStyle(el), tag = el.tagName.toLowerCase();
      if (tag === 'g' || tag === 'title') { if (cs.opacity !== '1') el.setAttribute('opacity', cs.opacity); return; }
      el.setAttribute('fill', cs.fill); el.setAttribute('stroke', cs.stroke);
      el.setAttribute('stroke-width', el.classList.contains('mark') ? '0.7' : cs.strokeWidth);
      if (cs.strokeDasharray && cs.strokeDasharray !== 'none') el.setAttribute('stroke-dasharray', cs.strokeDasharray);
      if (cs.opacity !== '1') el.setAttribute('opacity', cs.opacity);
      if (tag === 'text') el.setAttribute('font-family', CARD_FONT);
      el.removeAttribute('class');
    });
    Array.prototype.forEach.call(svg.querySelectorAll('g'), function (el) { el.removeAttribute('class'); el.removeAttribute('tabindex'); });
    var cs = getComputedStyle($('explorer'));
    function v(n) { return cs.getPropertyValue(n).trim(); }
    var col = {bg: v('--bg'), surface: v('--surface'), text: v('--text'), bright: v('--text-bright'), dim: v('--text-dim'),
      accent: v('--accent'), border: v('--border-strong'), t0: v('--series-1'), t1: v('--series-2')};
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('width', vb[2]); svg.setAttribute('height', vb[3]);
    var xml = new XMLSerializer().serializeToString(svg);
    holder.parentNode.removeChild(holder);
    if (prev == null) root.removeAttribute('data-theme'); else root.setAttribute('data-theme', prev);
    return {xml: xml, w: +vb[2], h: +vb[3], col: col};
  }
  function drawCard(img, parts, c, q) {
    var cv = document.createElement('canvas'); cv.width = CARD_W; cv.height = CARD_H;
    var ctx = cv.getContext('2d'), col = parts.col, M = 64, y;
    ctx.fillStyle = col.bg; ctx.fillRect(0, 0, CARD_W, CARD_H);
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = col.accent; ctx.font = '700 26px "DM Sans", ' + CARD_FONT;
    ctx.fillText((state.role === 'serve' ? 'PRO PICKLEBALL · SERVES' : 'PRO PICKLEBALL · RETURNS'), M, 96);
    ctx.fillStyle = col.bright; ctx.font = '600 68px Fraunces, Georgia, serif';
    y = 178;
    wrap(ctx, q.q, CARD_W - 2 * M).slice(0, 2).forEach(function (ln) { ctx.fillText(ln, M, y); y += 76; });
    var top = y - 30, cw = 610, ch = cw * parts.h / parts.w;
    ctx.fillStyle = col.surface; ctx.fillRect(M, top, cw, ch);
    ctx.drawImage(img, M, top, cw, ch);
    ctx.strokeStyle = col.border; ctx.lineWidth = 2; ctx.strokeRect(M, top, cw, ch);
    // right column: the number, then the legend
    var rx = M + cw + 44, rw = CARD_W - M - rx, ry = top + 96;
    if (c.big) {
      var size = 104;
      do { ctx.font = '700 ' + size + 'px Fraunces, Georgia, serif'; size -= 4; } while (ctx.measureText(c.big).width > rw && size > 40);
      ctx.fillStyle = col.accent; ctx.fillText(c.big, rx, ry);
      ry += 52;
      if (c.sub) {
        ctx.fillStyle = col.text; ctx.font = '500 32px "DM Sans", ' + CARD_FONT;
        wrap(ctx, c.sub, rw).forEach(function (ln) { ctx.fillText(ln, rx, ry); ry += 42; });
      }
      ry += 40;
    }
    ctx.font = '500 28px "DM Sans", ' + CARD_FONT;
    D.teams.forEach(function (t, i) {
      ctx.fillStyle = i ? col.t1 : col.t0;
      ctx.beginPath();
      if (i) { ctx.moveTo(rx + 14, ry - 24); ctx.lineTo(rx + 28, ry - 10); ctx.lineTo(rx + 14, ry + 4); ctx.lineTo(rx, ry - 10); ctx.closePath(); }
      else ctx.arc(rx + 14, ry - 10, 12, 0, 6.2832);
      ctx.fill();
      ctx.fillStyle = col.text; ctx.fillText(t.name, rx + 42, ry);
      ry += 48;
    });
    ctx.fillStyle = col.dim; ctx.font = '400 24px "DM Sans", ' + CARD_FONT;
    wrap(ctx, 'One mark is one ball. Net at the bottom, baseline at the top.', rw).forEach(function (ln) { ry += 4; ctx.fillText(ln, rx, ry); ry += 30; });
    // the conclusion, full width
    y = top + ch + 62;
    ctx.fillStyle = col.bright; ctx.font = '500 35px "DM Sans", ' + CARD_FONT;
    var text = c.lines.length ? c.lines[0].t : '', room = Math.floor((CARD_H - 120 - y) / 47) + 1;
    var first = wrap(ctx, text, CARD_W - 2 * M).slice(0, Math.max(1, room));
    first.forEach(function (ln) { ctx.fillText(ln, M, y); y += 47; });
    if (c.lines.length > 1) {
      ctx.fillStyle = col.text; ctx.font = '400 30px "DM Sans", ' + CARD_FONT;
      var second = wrap(ctx, c.lines[1].t, CARD_W - 2 * M);
      if (y + 14 + second.length * 41 <= CARD_H - 118) { y += 14; second.forEach(function (ln) { ctx.fillText(ln, M, y); y += 41; }); }
    }
    ctx.strokeStyle = col.border; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(M, CARD_H - 96); ctx.lineTo(CARD_W - M, CARD_H - 96); ctx.stroke();
    ctx.fillStyle = col.dim; ctx.font = '500 25px "DM Sans", ' + CARD_FONT;
    ctx.fillText('One pro match, labelled by hand.', M, CARD_H - 52);
    ctx.textAlign = 'right';
    ctx.fillText('Logan Schneider · lschneider93.github.io', CARD_W - M, CARD_H - 52);
    ctx.textAlign = 'left';
    return cv;
  }
  function saveImage() {
    var q = curQ(), c = conclude();
    if (!q || !c) return;
    var parts = cardParts(), img = new Image();
    var fonts = document.fonts && document.fonts.load
      ? Promise.all(['600 68px Fraunces', '700 100px Fraunces', '500 32px "DM Sans"', '700 26px "DM Sans"', '400 24px "DM Sans"'].map(function (f) { return document.fonts.load(f); }))['catch'](function () {})
      : Promise.resolve();
    img.onload = function () {
      fonts.then(function () {
        var cv = drawCard(img, parts, c, q);
        cv.toBlob(function (blob) {
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob); a.download = 'pickleball-' + q.key + '.png';
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
        }, 'image/png');
      });
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(parts.xml);
  }

  // ---------- events ----------
  function byKey(k) { var l = QUESTIONS[state.role]; for (var i = 0; i < l.length; i++) if (l[i].key === k) return l[i]; return null; }
  function userFilter() { state.q = null; state.a = state.b = null; if (state.view === 'avg') state.view = 'band'; }
  function setRole(role) { state.role = role; applyQ(QUESTIONS[role][0]); render(); }
  function bind() {
    document.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target : e.target.parentNode;
      var tab = t.closest('#pg-role [role="tab"]');
      if (tab) { setRole(tab.dataset.role); return; }
      var qb = t.closest('[data-q]');
      if (qb) { applyQ(byKey(qb.dataset.q)); render(); focusBack('[data-q="' + qb.dataset.q + '"]'); return; }
      if (t.closest('#pg-save')) { saveImage(); return; }
      var one = t.closest('[data-pick-one]');
      if (one) {
        var pl = one.dataset.pickOne;
        state.a.player = state.b.player = pl; state.a.team = state.b.team = PLAYER_TEAM[pl];
        syncPlayers(); render(); focusBack('[data-pick-one="' + pl + '"]'); return;
      }
      var vb = t.closest('#pg-view button');
      if (vb) { userFilter(); state.view = vb.dataset.view; render(); return; }
      if (t.closest('#pg-reset')) { applyQ(mainQ()); render(); return; }
      var dot = t.closest('.pg-dot[data-i]');
      if (dot) { dot.focus(); showTip(dot); return; }
      hideTip();
    });
    $('pg-role').addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      setRole(state.role === 'serve' ? 'return' : 'serve');
      focusBack('#pg-role [aria-selected="true"]');
    });
    document.addEventListener('change', function (e) {
      var el = e.target;
      if (el.dataset.pickTwo) {
        var side = el.dataset.pickTwo;
        state[side].player = el.value; state[side].team = PLAYER_TEAM[el.value];
        syncPlayers(); render(); focusBack('#' + el.id); return;
      }
      var k = el.dataset.k;
      if (!k) return;
      var v = el.value === '' ? null : el.value;
      if (k === 'player' && v === 'pair') return;
      userFilter();
      if (k === 'game') state.game = v == null ? null : +v;
      else if (k === 'team') {
        state.team = v;
        state.players = state.players.filter(function (p) { return !v || PLAYER_TEAM[p] === v; });
      } else if (k === 'player') {
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
      var list = Array.prototype.slice.call(svgBox.querySelectorAll('.pg-dot')), i = list.indexOf(d), j = i;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = Math.min(list.length - 1, i + 1);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = Math.max(0, i - 1);
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = list.length - 1;
      else if (e.key === 'Escape') { hideTip(); return; }
      else return;
      e.preventDefault();
      d.setAttribute('tabindex', '-1'); list[j].setAttribute('tabindex', '0'); list[j].focus();
    });
    if (wideMq.addEventListener) wideMq.addEventListener('change', render);
  }
  function focusBack(selr) { var el = document.querySelector(selr); if (el) el.focus(); }

  function fail() {
    $('pg-error').hidden = false;
    $('pg-stage').hidden = true;
    $('pg-filters').hidden = true;
    $('pg-answer').hidden = true;
  }

  function start(data) {
    D = data;
    CTX = {teams: {}, players: D.players};
    D.teams.forEach(function (t, i) { CTX.teams[t.id] = t.name; TEAM_SLOT[t.id] = i; t.players.forEach(function (p) { PLAYER_TEAM[p] = t.id; }); });
    var nc = D.not_counted, tot = D.totals;
    $('pg-tab-serve-n').textContent = D.serves.length + ' with a landing spot';
    $('pg-tab-return-n').textContent = D.returns.length + ' with a landing spot';
    $('pg-foot').textContent = 'Drawn: the ' + D.serves.length + ' serves and ' + D.returns.length + ' returns whose bounce I saw. Left out: ' +
      plural(nc.serve.no_landing, 'serve') + ' and ' + plural(nc['return'].no_landing, 'return') + ' with no landing recorded, plus ' +
      plural(nc.serve.estimated, 'serve') + ' and ' + plural(nc['return'].estimated, 'return') + ' placed without seeing the bounce.' +
      ' Courts are named from the receiving side, so the right court is on your left.';
    $('pg-how-counts').textContent = 'The match has ' + tot.serve + ' serves and ' + tot['return'] + ' returns. Only landings I placed by hand after seeing the bounce are on this page: ' +
      D.serves.length + ' serves and ' + D.returns.length + ' returns. Model estimates of where a ball landed are left out.';
    applyQ(mainQ());
    bind();
    render();
  }

  fetch('data/pickleball/serves_returns.json?v=20261115')
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(start)
    .catch(function (err) { if (window.console) console.warn('playground data failed to load', err); fail(); });
})();
