// Citi Bike dashboard orchestration. Unlike the live dashboards, all data here
// is static JSON produced offline by scripts/citibike/prep.py (DuckDB over the
// monthly S3 trip files). No caching layer needed; the JSONs ship with the site.
(function () {
  'use strict';

  // ---------- shared Plotly styling (matches dashboard.js) ----------
  var FONT = { family: 'DM Sans, sans-serif', color: '#96A0B5', size: 12 };
  var GRID = 'rgba(255,255,255,0.06)';
  var C = { mint: '#4AE3B5', indigo: '#7C8CF8', amber: '#F8A44C', sky: '#4AC2E3', red: '#E36A6A', dim: 'rgba(150,160,181,0.5)' };
  var PLOTLY_CONFIG = { displayModeBar: false, responsive: true };

  function baseLayout(extra) {
    var layout = {
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      font: FONT,
      margin: { l: 48, r: 16, t: 8, b: 40 },
      xaxis: { gridcolor: GRID, zeroline: false },
      yaxis: { gridcolor: GRID, zeroline: false },
      legend: { orientation: 'h', y: 1.12 },
      hovermode: 'x unified'
    };
    Object.keys(extra || {}).forEach(function (k) { layout[k] = extra[k]; });
    return layout;
  }

  function slot(id) { return document.getElementById(id); }

  function safeResize(id) {
    var el = slot(id);
    if (el && el.data) Plotly.Plots.resize(el);
  }

  function fmtInt(n) { return n.toLocaleString(); }
  function fmtPct(x, dp) { return (100 * x).toFixed(dp === undefined ? 1 : dp) + '%'; }

  // ---------- data dictionary ----------
  var DICTIONARY = [
    { field: 'ride_id', plain: 'Unique trip identifier, 16 hex characters', used: 'duplicate check, sample' },
    { field: 'rideable_type', plain: 'classic_bike or electric_bike (older files said docked_bike; normalized)', used: 'yes' },
    { field: 'started_at', plain: 'Trip start, local New York time, millisecond precision', used: 'yes' },
    { field: 'ended_at', plain: 'Trip end, local New York time', used: 'yes (duration)' },
    { field: 'start_station_name', plain: 'Departure station display name', used: 'yes' },
    { field: 'start_station_id', plain: 'Departure station code', used: 'yes' },
    { field: 'end_station_name', plain: 'Arrival station name; null when the bike never docked', used: 'yes' },
    { field: 'end_station_id', plain: 'Arrival station code; null when the bike never docked', used: 'yes' },
    { field: 'start_lat', plain: 'Start latitude, a per-trip GPS fix rather than the surveyed dock location', used: 'bounds check' },
    { field: 'start_lng', plain: 'Start longitude', used: 'bounds check' },
    { field: 'end_lat', plain: 'End latitude; null when the bike never docked', used: 'bounds check' },
    { field: 'end_lng', plain: 'End longitude', used: 'bounds check' },
    { field: 'member_casual', plain: 'Annual member or casual (single ride / day pass) rider', used: 'yes' }
  ];

  // ---------- load all aggregates ----------
  var FILES = ['meta', 'quality', 'daily', 'hourly_weekday', 'duration_hist', 'monthly', 'stations', 'sample'];
  var D = {}; // D.meta, D.quality, ...

  function getJSON(name) {
    return fetch('data/citibike/' + name + '.json').then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + name);
      return res.json();
    });
  }

  function showError(msg) {
    var el = slot('cb-banner');
    el.innerHTML = '';
    var div = document.createElement('div');
    div.className = 'dash-banner error';
    div.appendChild(document.createTextNode(msg));
    el.appendChild(div);
    document.querySelectorAll('.chart-slot').forEach(function (s) { s.classList.remove('skeleton'); });
  }

  // ---------- quality tab ----------
  function renderQuality() {
    var q = D.quality, meta = D.meta;
    var t = meta.totals;

    slot('tile-checked').textContent = fmtInt(t.rows_in);
    slot('tile-removed').textContent = fmtInt(t.rows_removed);
    slot('tile-removed-sub').textContent = 'Removed by rules (' + fmtPct(t.rows_removed / t.rows_in, 2) + ')';
    slot('tile-kept').textContent = fmtInt(t.rows_out);
    slot('tile-months').textContent = q.months.length;

    // rules table
    var foundTotals = {};
    q.months.forEach(function (m) {
      Object.keys(m.found).forEach(function (k) { foundTotals[k] = (foundTotals[k] || 0) + m.found[k]; });
      Object.keys(m.flagged).forEach(function (k) { foundTotals[k] = (foundTotals[k] || 0) + m.flagged[k]; });
    });
    if (typeof q.out_of_window === 'number') foundTotals.out_of_window = q.out_of_window;
    var ruleRows = q.checks.map(function (c) {
      var found = foundTotals[c.id] || 0;
      return {
        label: c.label,
        threshold: c.threshold,
        disposition: c.disposition,
        found: found,
        share: (100 * found) / t.rows_in
      };
    });
    Tables.render(slot('dq-rules'), {
      sortable: true,
      rows: ruleRows,
      columns: [
        { key: 'label', label: 'Check' },
        { key: 'threshold', label: 'What it catches' },
        { key: 'disposition', label: 'Disposition' },
        { key: 'found', label: 'Found', numeric: true, fmt: fmtInt },
        { key: 'share', label: 'Share of rows', numeric: true, fmt: function (v) { return v < 0.001 && v > 0 ? '<0.001%' : v.toFixed(3) + '%'; } }
      ]
    });

    var kept = foundTotals.missing_end || 0;
    slot('dq-note').textContent = 'The publisher already filters the loudest errors: sub-minute trips and negative durations come back at or near zero because Lyft removes them before publishing, and durations are truncated at exactly 1,500 minutes. The checks stay in the pipeline anyway; the day the feed changes, these counts will say so. ' +
      fmtInt(kept) + ' trips with no end station were kept and flagged rather than dropped, since a bike that never docked is real behavior, not an error.' +
      (foundTotals.duplicate_ride_id ? ' ' + fmtInt(foundTotals.duplicate_ride_id) + ' duplicate ride ids were found and kept; at roughly one per hundred thousand rows they cannot move any chart on this page.' : '');

    // removal rate by month
    var months = q.months.map(function (m) { return m.month; });
    var rate = q.months.map(function (m) { return (100 * m.rows_removed) / m.rows_in; });
    var mSlot = slot('dq-monthly');
    mSlot.classList.remove('skeleton');
    Plotly.react(mSlot, [{
      x: months, y: rate, type: 'bar', marker: { color: C.sky },
      hovertemplate: '%{x}: %{y:.2f}% removed<extra></extra>'
    }], baseLayout({
      xaxis: { gridcolor: GRID, zeroline: false, type: 'category' },
      yaxis: { gridcolor: GRID, zeroline: false, ticksuffix: '%', rangemode: 'tozero' },
      showlegend: false
    }), PLOTLY_CONFIG);

    // missingness by column
    var cols = Object.keys(q.null_rates);
    var rates = cols.map(function (k) { return 100 * q.null_rates[k]; });
    var missSlot = slot('dq-missing');
    missSlot.classList.remove('skeleton');
    Plotly.react(missSlot, [{
      x: rates.slice().reverse(),
      y: cols.slice().reverse(),
      type: 'bar', orientation: 'h', marker: { color: C.indigo },
      hovertemplate: '%{y}: %{x:.3f}% null<extra></extra>'
    }], baseLayout({
      margin: { l: 150, r: 16, t: 8, b: 40 },
      xaxis: { gridcolor: GRID, zeroline: false, ticksuffix: '%' },
      yaxis: { gridcolor: 'rgba(0,0,0,0)', zeroline: false, tickfont: { size: 10 } },
      hovermode: 'closest',
      showlegend: false
    }), PLOTLY_CONFIG);

    // sample table (columnar arrays -> row objects)
    var sCols = D.sample.columns;
    var sRows = D.sample.rows.map(function (arr) {
      var o = {};
      sCols.forEach(function (c, i) { o[c] = arr[i]; });
      return o;
    });
    Tables.render(slot('sample-table'), {
      sortable: true,
      rows: sRows,
      columns: sCols.map(function (c) {
        return { key: c, label: c, numeric: ['start_lat', 'start_lng', 'end_lat', 'end_lng', 'dur_min'].indexOf(c) !== -1 };
      })
    });

    Tables.render(slot('cb-dict'), {
      sortable: false,
      rows: DICTIONARY,
      columns: [
        { key: 'field', label: 'Field' },
        { key: 'plain', label: 'What it means' },
        { key: 'used', label: 'Used here' }
      ]
    });

    var gen = new Date(meta.generated_at);
    var last = q.months[q.months.length - 1];
    slot('cb-generated').textContent = 'Aggregates built ' + gen.toLocaleDateString(undefined, { dateStyle: 'medium' }) +
      ' from ' + q.months.length + ' monthly files; trip data through ' + (last.ts_max || 'n/a') + '.';
  }

  // ---------- patterns tab ----------
  var patternsRendered = false;

  function overallMedianMin() {
    var h = D.duration_hist;
    var total = 0, i;
    for (i = 0; i < h.member.length; i++) total += h.member[i] + h.casual[i];
    var half = total / 2, cum = 0;
    for (i = 0; i < h.member.length; i++) {
      cum += h.member[i] + h.casual[i];
      if (cum >= half) {
        return i < h.edges_min.length - 1 ? (h.edges_min[i] + h.edges_min[i + 1]) / 2 : h.edges_min[i];
      }
    }
    return null;
  }

  function renderDaily() {
    var d = D.daily, c = d.counts;
    var split = slot('daily-split').value;
    var traces;
    function sum(a, b) { return a.map(function (v, i) { return v + b[i]; }); }
    if (split === 'rider') {
      traces = [
        { name: 'Members', y: sum(c.member_classic_bike, c.member_electric_bike), color: C.mint },
        { name: 'Casual', y: sum(c.casual_classic_bike, c.casual_electric_bike), color: C.amber }
      ];
    } else {
      traces = [
        { name: 'Electric', y: sum(c.member_electric_bike, c.casual_electric_bike), color: C.sky },
        { name: 'Classic', y: sum(c.member_classic_bike, c.casual_classic_bike), color: C.indigo }
      ];
    }
    var el = slot('chart-daily');
    el.classList.remove('skeleton');
    Plotly.react(el, traces.map(function (tr) {
      return {
        x: d.dates, y: tr.y, name: tr.name, type: 'scatter', mode: 'lines',
        stackgroup: 'one', line: { width: 0.8, color: tr.color }
      };
    }), baseLayout({
      yaxis: { gridcolor: GRID, zeroline: false, rangemode: 'tozero' },
      annotations: [{
        x: '2026-02-23', y: 0, yref: 'y',
        text: 'Feb 2026 blizzard:<br>system shut down',
        showarrow: true, arrowhead: 0, arrowcolor: 'rgba(150,160,181,0.6)',
        ax: 0, ay: -96, font: { family: FONT.family, size: 11, color: '#C7CEDD' },
        bgcolor: 'rgba(10,14,26,0.85)', borderpad: 3
      }]
    }), PLOTLY_CONFIG);
  }

  function renderMonthly() {
    var m = D.monthly;
    var el = slot('chart-monthly');
    el.classList.remove('skeleton');
    Plotly.react(el, [
      { x: m.months, y: m.trips, name: 'Trips', type: 'bar', marker: { color: C.indigo }, hovertemplate: '%{x}: %{y:,} trips<extra></extra>' },
      { x: m.months, y: m.median_min, name: 'Median minutes', type: 'scatter', mode: 'lines+markers', yaxis: 'y2', line: { color: C.amber, width: 2.5 }, hovertemplate: 'median %{y} min<extra></extra>' }
    ], baseLayout({
      xaxis: { gridcolor: GRID, zeroline: false, type: 'category' },
      yaxis: { gridcolor: GRID, zeroline: false, rangemode: 'tozero', title: { text: 'trips', font: FONT } },
      yaxis2: { overlaying: 'y', side: 'right', rangemode: 'tozero', gridcolor: 'rgba(0,0,0,0)', zeroline: false, title: { text: 'minutes', font: FONT } },
      margin: { l: 56, r: 48, t: 8, b: 40 }
    }), PLOTLY_CONFIG);
  }

  function renderHeatmap() {
    var h = D.hourly_weekday;
    var group = slot('heatmap-group').value;
    var el = slot('chart-heatmap');
    el.classList.remove('skeleton');
    Plotly.react(el, [{
      z: h[group],
      x: h.hours.map(function (v) { return v + ':00'; }),
      y: h.weekdays,
      type: 'heatmap',
      colorscale: [[0, '#151A2E'], [0.5, '#1E6B58'], [1, '#4AE3B5']],
      hovertemplate: '%{y} %{x}: %{z:,} trips<extra></extra>',
      colorbar: { tickfont: FONT, thickness: 12, len: 0.8 }
    }], baseLayout({
      yaxis: { autorange: 'reversed', gridcolor: 'rgba(0,0,0,0)', zeroline: false },
      xaxis: { gridcolor: 'rgba(0,0,0,0)', zeroline: false, tickfont: { size: 10 } },
      hovermode: 'closest'
    }), PLOTLY_CONFIG);
  }

  function renderDuration() {
    var h = D.duration_hist;
    var labels = h.edges_min.map(function (e, i) {
      return i < h.edges_min.length - 1 ? e + '–' + h.edges_min[i + 1] : '120+';
    });
    function shares(counts) {
      var total = counts.reduce(function (a, b) { return a + b; }, 0);
      return counts.map(function (v) { return (100 * v) / total; });
    }
    var el = slot('chart-duration');
    el.classList.remove('skeleton');
    Plotly.react(el, [
      { x: labels, y: shares(h.member), name: 'Members', type: 'bar', marker: { color: C.mint }, opacity: 0.85 },
      { x: labels, y: shares(h.casual), name: 'Casual', type: 'bar', marker: { color: C.amber }, opacity: 0.7 }
    ], baseLayout({
      barmode: 'overlay',
      yaxis: { gridcolor: GRID, zeroline: false, ticksuffix: '%' },
      xaxis: { gridcolor: 'rgba(0,0,0,0)', zeroline: false, tickfont: { size: 9 }, dtick: 5, title: { text: 'minutes', font: FONT } }
    }), PLOTLY_CONFIG);
  }

  function renderStations() {
    var s = D.stations.stations.slice().reverse(); // top first after reversal in hbar
    var el = slot('chart-stations');
    el.classList.remove('skeleton');
    Plotly.react(el, [{
      x: s.map(function (r) { return r.departures; }),
      y: s.map(function (r) { return r.name; }),
      type: 'bar', orientation: 'h',
      marker: {
        color: s.map(function (r) { return r.pct_member; }),
        colorscale: [[0, C.amber], [1, C.mint]],
        cmin: 0.5, cmax: 1,
        colorbar: { title: { text: 'member share', font: FONT }, tickfont: FONT, thickness: 10, len: 0.6, tickformat: '.0%' }
      },
      customdata: s.map(function (r) { return [r.arrivals, r.pct_member]; }),
      hovertemplate: '%{y}<br>%{x:,} departures, %{customdata[0]:,} arrivals<br>%{customdata[1]:.0%} member<extra></extra>'
    }], baseLayout({
      height: 640,
      margin: { l: 210, r: 16, t: 8, b: 40 },
      yaxis: { gridcolor: 'rgba(0,0,0,0)', zeroline: false, tickfont: { size: 10 } },
      xaxis: { gridcolor: GRID, zeroline: false },
      hovermode: 'closest',
      showlegend: false
    }), PLOTLY_CONFIG);
  }

  function renderPatterns() {
    var m = D.monthly;
    var trips = m.trips.reduce(function (a, b) { return a + b; }, 0);
    function weighted(key) {
      var s = 0;
      m.months.forEach(function (_, i) { s += m[key][i] * m.trips[i]; });
      return s / trips;
    }
    slot('tile-trips').textContent = fmtInt(trips);
    var med = overallMedianMin();
    slot('tile-median').textContent = med !== null ? med.toFixed(1).replace(/\.0$/, '') + ' min' : '–';
    slot('tile-member').textContent = fmtPct(weighted('pct_member'));
    slot('tile-ebike').textContent = fmtPct(weighted('pct_electric'));

    renderDaily();
    renderMonthly();
    renderHeatmap();
    renderDuration();
    renderStations();
    patternsRendered = true;
  }

  // ---------- tabs (render lazily; Plotly sizes wrong in hidden panels) ----------
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.dash-tab'));
  var PATTERN_SLOTS = ['chart-daily', 'chart-monthly', 'chart-heatmap', 'chart-duration', 'chart-stations'];
  var loaded = false;

  function selectTab(id) {
    tabs.forEach(function (t) {
      t.setAttribute('aria-selected', String(t.getAttribute('aria-controls') === id));
    });
    ['panel-quality', 'panel-patterns'].forEach(function (pid) {
      document.getElementById(pid).hidden = pid !== id;
    });
    if (id === 'panel-quality') {
      ['dq-monthly', 'dq-missing'].forEach(safeResize);
    }
    if (id === 'panel-patterns' && loaded) {
      if (!patternsRendered) renderPatterns();
      else PATTERN_SLOTS.forEach(safeResize);
    }
  }

  tabs.forEach(function (t, i) {
    t.addEventListener('click', function () { selectTab(t.getAttribute('aria-controls')); });
    t.addEventListener('keydown', function (e) {
      var next = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = tabs[(i + 1) % tabs.length];
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = tabs[(i - 1 + tabs.length) % tabs.length];
      if (e.key === 'Home') next = tabs[0];
      if (e.key === 'End') next = tabs[tabs.length - 1];
      if (next) {
        e.preventDefault();
        next.focus();
        selectTab(next.getAttribute('aria-controls'));
      }
    });
  });

  slot('daily-split').addEventListener('change', renderDaily);
  slot('heatmap-group').addEventListener('change', renderHeatmap);

  // ---------- boot ----------
  Promise.all(FILES.map(getJSON)).then(function (results) {
    FILES.forEach(function (name, i) { D[name] = results[i]; });
    loaded = true;
    renderQuality();
    if (!document.getElementById('panel-patterns').hidden) renderPatterns();
  }).catch(function (err) {
    showError('Could not load the dashboard data files. If you are viewing this locally, serve the site with a web server; file:// blocks fetch. (' + err.message + ')');
  });
})();
