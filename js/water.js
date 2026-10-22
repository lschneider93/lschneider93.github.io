// Utah water dashboard orchestration. Same architecture as dashboard.js:
// client-side fetch + localStorage cache + Plotly, no backend.
(function () {
  'use strict';

  // ---------- fetch + cache ----------
  // Unlike dashboard.js this caches the TRANSFORMED result, not the raw body:
  // the statewide IV response is ~1 MB and the stat batches are ~350 KB each,
  // which would blow the localStorage quota if stored raw.
  var CACHE_PREFIX = 'water:v1:';

  function readCache(url) {
    try {
      var raw = localStorage.getItem(CACHE_PREFIX + url);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function writeCache(url, data) {
    try {
      localStorage.setItem(CACHE_PREFIX + url, JSON.stringify({ fetchedAt: Date.now(), data: data }));
    } catch (e) { /* quota / private browsing: degrade to no cache */ }
  }

  // opts: {text: parse body as text not JSON, transform: fn(body) -> stored,
  //        validate: fn(stored) -> bool (extra freshness check beyond TTL)}
  function fetchCached(url, ttlMs, opts) {
    opts = opts || {};
    var cached = readCache(url);
    if (cached && (Date.now() - cached.fetchedAt) < ttlMs &&
        (!opts.validate || opts.validate(cached.data))) {
      return Promise.resolve({ data: cached.data, stale: false, fetchedAt: cached.fetchedAt });
    }
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return opts.text ? res.text() : res.json();
    }).then(function (body) {
      var data = opts.transform ? opts.transform(body) : body;
      writeCache(url, data);
      return { data: data, stale: false, fetchedAt: Date.now() };
    }).catch(function (err) {
      if (cached && (!opts.validate || opts.validate(cached.data))) {
        return { data: cached.data, stale: true, fetchedAt: cached.fetchedAt };
      }
      throw err;
    });
  }

  // ---------- shared Plotly styling (matches dashboard.js) ----------
  var FONT = { family: 'DM Sans, sans-serif', color: '#96A0B5', size: 12 };
  var GRID = 'rgba(255,255,255,0.06)';
  var ACCENT = '#4AE3B5';
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

  function showBanner(el, kind, msg, retryFn) {
    el.innerHTML = '';
    var div = document.createElement('div');
    div.className = 'dash-banner ' + kind;
    div.appendChild(document.createTextNode(msg));
    if (retryFn) {
      var btn = document.createElement('button');
      btn.textContent = 'Retry';
      btn.addEventListener('click', retryFn);
      div.appendChild(btn);
    }
    el.appendChild(div);
  }

  function fmtDate(ts) {
    return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  function fmtAge(ms) {
    var min = Math.round(ms / 60000);
    if (min < 90) return min + ' min';
    var h = ms / 3600000;
    if (h < 48) return h.toFixed(1) + ' h';
    var d = h / 24;
    if (d < 400) return Math.round(d) + ' d';
    return (d / 365.25).toFixed(1) + ' yr';
  }

  function fmtFlow(q) {
    if (q === null || q === undefined) return null;
    return q >= 100 ? Math.round(q).toLocaleString() : q.toPrecision(3);
  }

  // ---------- shared state ----------
  var NOW = Date.now();
  var TODAY_KEY = USGS.monthDayKey(new Date());
  var state = { ivRows: null, ivQuality: null, dayStats: {}, statSitesQueried: 0 };

  // ---------- hero (marquee site) ----------
  var heroEpoch = 0;

  function renderHero() {
    var epoch = ++heroEpoch;
    var siteNo = slot('water-site').value;
    var banner = slot('water-banner');
    var envSlot = slot('water-envelope');
    envSlot.classList.add('skeleton');

    var pStats = fetchCached(USGS.statDailyUrl([siteNo]), USGS.STAT_TTL_MS, {
      text: true,
      transform: function (text) { return USGS.statsToYear(USGS.parseRdb(text), siteNo); }
    });
    var pDv = fetchCached(USGS.dvUrl(siteNo, '00060', 365), USGS.DV_TTL_MS, {
      transform: function (json) {
        var ts = json.value.timeSeries[0];
        var out = { dates: [], values: [] };
        if (ts) ts.values[0].value.forEach(function (v) {
          out.dates.push(v.dateTime.slice(0, 10));
          out.values.push(USGS.num(v.value));
        });
        return out;
      }
    });

    Promise.all([pStats, pDv, ivReady]).then(function (results) {
      if (epoch !== heroEpoch) return;
      var year = results[0].data;
      var dv = results[1].data;
      if (results[0].stale || results[1].stale) {
        showBanner(banner, 'warn', 'Live fetch failed. Showing cached data from ' + fmtDate(results[0].fetchedAt) + '.', renderHero);
      } else {
        banner.innerHTML = '';
      }

      var iv = null;
      (state.ivRows || []).forEach(function (r) { if (r.no === siteNo) iv = r; });
      var today = year[TODAY_KEY];
      var q = iv && iv.qFresh ? iv.q : null;

      slot('tile-flow').textContent = q !== null ? fmtFlow(q) + ' cfs' : '–';
      var pctText = '–', classText = '', vsMedian = '–', yearsText = '–';
      if (today) {
        yearsText = today.count + ' yrs';
        slot('tile-years-sub').textContent = 'Years of record (' + today.beginYr + '–' + today.endYr + ')';
        if (q !== null) {
          var p = USGS.percentileOf(q, today);
          if (p) {
            pctText = p.clampedHigh ? '>' + USGS.ordinal(p.pct) : p.clampedLow ? '<' + USGS.ordinal(p.pct) : USGS.ordinal(p.pct);
            var cls = USGS.classOf(p.pct);
            classText = cls ? cls.label.toLowerCase() : '';
          }
          if (today.p50_va) vsMedian = (q / today.p50_va).toFixed(1) + '×';
        }
      }
      slot('tile-pct').textContent = pctText;
      slot('tile-pct-sub').textContent = classText ? 'Percentile today, ' + classText : 'Percentile for today’s date';
      slot('tile-years').textContent = yearsText;
      slot('tile-median').textContent = vsMedian;

      var name = iv ? iv.name : siteNo;
      slot('envelope-site').textContent = name;
      if (today) {
        slot('envelope-sub').textContent = 'Daily mean flow for the past year against this gage’s percentile bands for each calendar day, ' +
          today.count + ' years of record. Record high for today: ' + fmtFlow(today.max_va) + ' cfs (' + today.maxYr +
          '). Record low: ' + fmtFlow(today.min_va) + ' cfs (' + today.minYr + ').';
      }

      renderEnvelope(envSlot, year, dv, q);
    }).catch(function () {
      if (epoch !== heroEpoch) return;
      envSlot.classList.remove('skeleton');
      showBanner(banner, 'error', 'Could not reach the USGS statistics service. It may be briefly unavailable.', renderHero);
    });
  }

  function renderEnvelope(el, year, dv, currentQ) {
    el.classList.remove('skeleton');
    var dates = [], p05 = [], p25 = [], p50 = [], p75 = [], p95 = [];
    var d = new Date();
    d.setDate(d.getDate() - 364);
    for (var i = 0; i < 365; i++) {
      var key = USGS.monthDayKey(d);
      var row = year[key];
      dates.push(d.toISOString().slice(0, 10));
      p05.push(row ? row.p05_va : null);
      p25.push(row ? row.p25_va : null);
      p50.push(row ? row.p50_va : null);
      p75.push(row ? row.p75_va : null);
      p95.push(row ? row.p95_va : null);
      d.setDate(d.getDate() + 1);
    }

    var traces = [
      { x: dates, y: p05, name: 'p05', type: 'scatter', mode: 'lines', line: { width: 0 }, hoverinfo: 'skip', showlegend: false },
      { x: dates, y: p95, name: '5–95% band', type: 'scatter', mode: 'lines', line: { width: 0 }, fill: 'tonexty', fillcolor: 'rgba(74,227,181,0.08)', hoverinfo: 'skip' },
      { x: dates, y: p25, name: 'p25', type: 'scatter', mode: 'lines', line: { width: 0 }, hoverinfo: 'skip', showlegend: false },
      { x: dates, y: p75, name: '25–75% band', type: 'scatter', mode: 'lines', line: { width: 0 }, fill: 'tonexty', fillcolor: 'rgba(74,227,181,0.16)', hoverinfo: 'skip' },
      { x: dates, y: p50, name: 'Median (by day)', type: 'scatter', mode: 'lines', line: { color: '#8B95A8', width: 1.5, dash: 'dot' } },
      { x: dv.dates, y: dv.values, name: 'Daily mean flow', type: 'scatter', mode: 'lines', line: { color: ACCENT, width: 2 } }
    ];
    if (currentQ !== null) {
      traces.push({
        x: [dates[dates.length - 1]], y: [currentQ], name: 'Right now', type: 'scatter',
        mode: 'markers', marker: { size: 9, color: '#F0F4F8', line: { color: ACCENT, width: 2 } }
      });
    }
    Plotly.react(el, traces, baseLayout({
      yaxis: { gridcolor: GRID, zeroline: false, title: { text: 'cfs', font: FONT }, rangemode: 'tozero' }
    }), PLOTLY_CONFIG);
  }

  // ---------- statewide map ----------
  function renderMap() {
    var mapSlot = slot('water-map');
    var classSlot = slot('water-classes');

    var freshQ = state.ivRows.filter(function (r) { return r.q !== null && r.qFresh; });
    // The stat service rejects requests with more than 10 sites (HTTP 400).
    var chunks = [];
    for (var i = 0; i < freshQ.length; i += 10) {
      chunks.push(freshQ.slice(i, i + 10).map(function (r) { return r.no; }));
    }
    state.statSitesQueried = freshQ.length;

    Promise.all(chunks.map(function (siteNos) {
      return fetchCached(USGS.statDailyUrl(siteNos), USGS.STAT_TTL_MS, {
        text: true,
        transform: function (text) {
          return { day: TODAY_KEY, sites: USGS.statsToDay(USGS.parseRdb(text), TODAY_KEY) };
        },
        validate: function (stored) { return stored && stored.day === TODAY_KEY; }
      }).catch(function () { return { data: { day: TODAY_KEY, sites: {} }, failed: true }; });
    })).then(function (results) {
      var dayStats = {};
      results.forEach(function (res) {
        Object.keys(res.data.sites).forEach(function (k) { dayStats[k] = res.data.sites[k]; });
      });
      state.dayStats = dayStats;

      var byClass = {};
      USGS.CLASSES.forEach(function (c) { byClass[c.key] = []; });
      var unranked = [];
      freshQ.forEach(function (r) {
        var p = USGS.percentileOf(r.q, dayStats[r.no]);
        if (!p) { r.pct = null; unranked.push(r); return; }
        r.pct = p.pct;
        r.pctClamped = p.clampedLow ? 'low' : p.clampedHigh ? 'high' : null;
        r.cls = USGS.classOf(p.pct);
        byClass[r.cls.key].push(r);
      });

      function markerSize(q) {
        return Math.max(6, Math.min(22, 6 + 3.2 * Math.log10(1 + q)));
      }
      function hoverText(r) {
        var pctLabel = r.pctClamped === 'low' ? 'below the 5th' : r.pctClamped === 'high' ? 'above the 95th' : USGS.ordinal(r.pct);
        var yrs = state.dayStats[r.no] ? state.dayStats[r.no].count : '?';
        return r.name + '<br>' + fmtFlow(r.q) + ' cfs · ' + pctLabel + ' percentile for today<br>' +
          r.cls.label + ' · ' + yrs + ' years of record';
      }

      var traces = USGS.CLASSES.map(function (c) {
        var rows = byClass[c.key];
        return {
          type: 'scattergeo', mode: 'markers', name: c.label,
          lon: rows.map(function (r) { return r.lon; }),
          lat: rows.map(function (r) { return r.lat; }),
          text: rows.map(hoverText),
          hoverinfo: 'text',
          marker: {
            size: rows.map(function (r) { return markerSize(r.q); }),
            color: c.color, line: { color: '#0A0E1A', width: 1 }
          }
        };
      });
      traces.push({
        type: 'scattergeo', mode: 'markers', name: 'No historical stats',
        lon: unranked.map(function (r) { return r.lon; }),
        lat: unranked.map(function (r) { return r.lat; }),
        text: unranked.map(function (r) { return r.name + '<br>' + fmtFlow(r.q) + ' cfs · no percentile record'; }),
        hoverinfo: 'text',
        marker: { size: 6, color: 'rgba(139,149,168,0.35)', line: { color: '#0A0E1A', width: 1 } }
      });

      mapSlot.classList.remove('skeleton');
      Plotly.react(mapSlot, traces, {
        paper_bgcolor: 'rgba(0,0,0,0)',
        showlegend: false,
        geo: {
          scope: 'north america', projection: { type: 'mercator' }, resolution: 50,
          fitbounds: 'locations', // Albers (scope 'usa') draws Utah tilted; mercator keeps it upright
          bgcolor: 'rgba(0,0,0,0)', landcolor: '#151A2E',
          showsubunits: true, subunitcolor: 'rgba(255,255,255,0.15)',
          showcountries: false, showcoastlines: false,
          lakecolor: 'rgba(0,0,0,0)', showlakes: true
        },
        font: FONT,
        margin: { l: 0, r: 0, t: 0, b: 0 }
      }, PLOTLY_CONFIG);

      // custom legend with live counts
      var legend = slot('map-legend');
      legend.innerHTML = '';
      USGS.CLASSES.concat([{ label: 'No historical stats', color: 'rgba(139,149,168,0.35)', key: 'none' }]).forEach(function (c) {
        var n = c.key === 'none' ? unranked.length : byClass[c.key].length;
        var span = document.createElement('span');
        span.className = 'map-legend-item';
        var dot = document.createElement('i');
        dot.style.background = c.color;
        span.appendChild(dot);
        span.appendChild(document.createTextNode(c.label + ' (' + n + ')'));
        legend.appendChild(span);
      });

      // class-count bars, same colors as the map
      classSlot.classList.remove('skeleton');
      var order = USGS.CLASSES.slice().reverse();
      Plotly.react(classSlot, [{
        x: order.map(function (c) { return byClass[c.key].length; }),
        y: order.map(function (c) { return c.label; }),
        type: 'bar', orientation: 'h',
        marker: { color: order.map(function (c) { return c.color; }) },
        text: order.map(function (c) { return String(byClass[c.key].length); }),
        textposition: 'outside', textfont: { color: '#CDD5E0' },
        hoverinfo: 'skip'
      }], baseLayout({
        hovermode: false, showlegend: false,
        margin: { l: 140, r: 40, t: 8, b: 40 },
        xaxis: { gridcolor: GRID, zeroline: false, title: { text: 'gages reporting in the last 6 hours', font: FONT } }
      }), PLOTLY_CONFIG);

      renderQuality(results);
      renderTable(freshQ, unranked);
    });
  }

  // ---------- Great Salt Lake ----------
  function renderGsl() {
    var el = slot('water-gsl');
    fetchCached(USGS.dvUrl(USGS.GSL_SITE, '62614', 1826), USGS.DV_TTL_MS, {
      transform: function (json) {
        var ts = json.value.timeSeries[0];
        var out = { dates: [], values: [] };
        if (ts) ts.values[0].value.forEach(function (v) {
          var n = USGS.num(v.value);
          if (n !== null && n > -99999) { out.dates.push(v.dateTime.slice(0, 10)); out.values.push(n); }
        });
        return out;
      }
    }).then(function (result) {
      var g = result.data;
      el.classList.remove('skeleton');
      var latest = g.values[g.values.length - 1];
      slot('gsl-now').textContent = latest ? latest.toFixed(1) + ' ft' : '–';
      slot('gsl-gap').textContent = latest ? (USGS.GSL_HEALTHY_FLOOR - latest).toFixed(1) + ' ft' : '–';
      Plotly.react(el, [
        { x: g.dates, y: g.values, name: 'South arm elevation', type: 'scatter', mode: 'lines', line: { color: '#45C8E8', width: 2 } }
      ], baseLayout({
        showlegend: false,
        yaxis: { gridcolor: GRID, zeroline: false, title: { text: 'ft above NGVD 1929', font: FONT } },
        shapes: [
          { type: 'line', xref: 'paper', x0: 0, x1: 1, y0: USGS.GSL_HEALTHY_FLOOR, y1: USGS.GSL_HEALTHY_FLOOR, line: { color: ACCENT, width: 1, dash: 'dash' } },
          { type: 'line', xref: 'paper', x0: 0, x1: 1, y0: USGS.GSL_RECORD_LOW, y1: USGS.GSL_RECORD_LOW, line: { color: '#E36A6A', width: 1, dash: 'dash' } }
        ],
        annotations: [
          { x: 1, y: USGS.GSL_HEALTHY_FLOOR, xref: 'paper', xanchor: 'right', yanchor: 'bottom', text: 'healthy range floor, 4,198 ft', showarrow: false, font: { color: ACCENT, size: 11 } },
          { x: 1, y: USGS.GSL_RECORD_LOW, xref: 'paper', xanchor: 'right', yanchor: 'top', text: '2022 record low, 4,188.5 ft', showarrow: false, font: { color: '#E36A6A', size: 11 } }
        ]
      }), PLOTLY_CONFIG);
    }).catch(function () {
      el.classList.remove('skeleton');
      el.innerHTML = '<div class="dash-banner error">Great Salt Lake data unavailable right now.</div>';
    });
  }

  // ---------- data quality ----------
  function renderQuality(statResults) {
    var q = state.ivQuality;
    var freshQ = state.ivRows.filter(function (r) { return r.q !== null && r.qFresh; });
    var ranked = freshQ.filter(function (r) { return r.pct !== null && r.pct !== undefined; });

    slot('dq-sites').textContent = state.ivRows.length;
    slot('dq-fresh').textContent = q.seriesFresh + ' of ' + q.seriesTotal;
    slot('dq-stale').textContent = q.seriesStale;
    slot('dq-sentinels').textContent = q.sentinelsDropped;
    var prov = q.qualifiers.P || 0, appr = q.qualifiers.A || 0;
    slot('dq-provisional').textContent = prov + appr ? Math.round(100 * prov / (prov + appr)) + '%' : '–';

    var failedChunks = statResults.filter(function (r) { return r.failed; }).length;
    var parts = [
      'The USGS feed reports each sensor’s most recent value even when the sensor stopped years ago. ' +
      q.seriesStale + ' of ' + q.seriesTotal + ' series here are older than 6 hours' +
      (q.oldestStaleISO ? ', the oldest from ' + q.oldestStaleISO.slice(0, 10) : '') +
      ', so they are listed in the table below but excluded from the map and class counts.',
      q.sentinelsDropped + ' readings arrived as the sentinel value -999999 and were dropped.',
      ranked.length + ' of ' + freshQ.length + ' fresh streamflow gages have a historical percentile record; the rest appear on the map in gray.',
      q.multiSensorSeries + ' series carry multiple sensors (the Great Salt Lake breach alone has dozens at different depths); only the primary sensor is used.'
    ];
    if (failedChunks) parts.push(failedChunks + ' statistics batch request(s) failed; some gages may show as unranked until a retry.');
    slot('water-quality-note').textContent = parts.join(' ');
  }

  // ---------- raw table ----------
  function renderTable(freshQ, unranked) {
    var rows = state.ivRows.map(function (r) {
      return {
        name: r.name, no: r.no,
        q: r.q, wt: r.wt !== undefined ? r.wt : null,
        pct: (r.pct !== null && r.pct !== undefined) ? Math.round(r.pct) : null,
        cls: r.cls ? r.cls.label : null,
        qual: r.qQual || null,
        age: r.qTime ? NOW - Date.parse(r.qTime) : null
      };
    }).filter(function (r) { return r.q !== null || r.wt !== null; });

    Tables.render(slot('water-table'), {
      sortable: true,
      rows: rows,
      columns: [
        { key: 'name', label: 'Site' },
        { key: 'no', label: 'Site no.' },
        { key: 'q', label: 'Flow (cfs)', numeric: true, fmt: fmtFlow },
        { key: 'wt', label: 'Water temp (C)', numeric: true, fmt: function (v) { return v.toFixed(1); } },
        { key: 'pct', label: 'Percentile today', numeric: true, fmt: function (v) { return String(v); } },
        { key: 'cls', label: 'Flow class' },
        { key: 'qual', label: 'Flags' },
        { key: 'age', label: 'Reading age', numeric: true, fmt: fmtAge }
      ]
    });
  }

  // ---------- boot ----------
  var ivReady = fetchCached(USGS.ivStatewideUrl(), USGS.IV_TTL_MS, {
    transform: function (json) { return USGS.condenseIv(json, Date.now()); }
  }).then(function (result) {
    state.ivRows = result.data.rows;
    state.ivQuality = result.data.quality;
    if (result.stale) {
      showBanner(slot('water-banner'), 'warn', 'Live fetch failed. Showing cached data from ' + fmtDate(result.fetchedAt) + '.', function () { location.reload(); });
    }
    renderMap();
    return result;
  }).catch(function (err) {
    ['water-map', 'water-classes'].forEach(function (id) { slot(id).classList.remove('skeleton'); });
    showBanner(slot('water-banner'), 'error', 'Could not reach the USGS water service. It may be briefly unavailable.', function () { location.reload(); });
    throw err;
  });

  var siteSelect = slot('water-site');
  USGS.MARQUEE.forEach(function (s) {
    var opt = document.createElement('option');
    opt.value = s.no;
    opt.textContent = s.name;
    siteSelect.appendChild(opt);
  });
  siteSelect.addEventListener('change', renderHero);

  var DICT_COLUMNS = [
    { key: 'field', label: 'Field' },
    { key: 'plain', label: 'What it means' },
    { key: 'used', label: 'Used here' }
  ];
  Tables.render(slot('param-dict'), { columns: DICT_COLUMNS, rows: USGS.PARAM_DICTIONARY, sortable: false });
  Tables.render(slot('qual-dict'), { columns: DICT_COLUMNS, rows: USGS.QUALIFIER_DICTIONARY, sortable: false });
  Tables.render(slot('stat-dict'), { columns: DICT_COLUMNS, rows: USGS.STAT_DICTIONARY, sortable: false });

  renderHero();
  renderGsl();
})();
