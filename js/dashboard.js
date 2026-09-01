// Dashboard orchestration: tabs, fetch-with-cache, Plotly rendering.
// Both APIs are CORS-open; everything runs client-side on GitHub Pages.
(function () {
  'use strict';

  // ---------- fetch + localStorage cache ----------
  var CACHE_PREFIX = 'dash:v2:'; // v2: widened CDC selects orphaned v1 entries

  try {
    for (var ci = localStorage.length - 1; ci >= 0; ci--) {
      var ck = localStorage.key(ci);
      if (ck && ck.indexOf('dash:v1:') === 0) localStorage.removeItem(ck);
    }
  } catch (e) { /* private browsing */ }

  function cacheKey(url) { return CACHE_PREFIX + url; }

  function readCache(url) {
    try {
      var raw = localStorage.getItem(cacheKey(url));
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function writeCache(url, data) {
    try {
      localStorage.setItem(cacheKey(url), JSON.stringify({ fetchedAt: Date.now(), data: data }));
    } catch (e) { /* quota / private browsing: degrade to no cache */ }
  }

  // Resolves {data, stale:boolean, fetchedAt}. Fresh cache -> no network.
  // Network failure with any cache -> stale fallback. Otherwise rejects.
  function fetchCached(url, ttlMs) {
    var cached = readCache(url);
    if (cached && (Date.now() - cached.fetchedAt) < ttlMs) {
      return Promise.resolve({ data: cached.data, stale: false, fetchedAt: cached.fetchedAt });
    }
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (json) {
      writeCache(url, json);
      return { data: json, stale: false, fetchedAt: Date.now() };
    }).catch(function (err) {
      if (cached) return { data: cached.data, stale: true, fetchedAt: cached.fetchedAt };
      throw err;
    });
  }

  // ---------- shared Plotly styling ----------
  var FONT = { family: 'DM Sans, sans-serif', color: '#96A0B5', size: 12 };
  var GRID = 'rgba(255,255,255,0.06)';
  var COLORS = { covid: '#4AE3B5', flu: '#7C8CF8', rsv: '#F8A44C', bar: '#4AC2E3', line: '#4AE3B5' };

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

  var PLOTLY_CONFIG = { displayModeBar: false, responsive: true };

  function slot(id) { return document.getElementById(id); }

  function safeResize(id) {
    var el = slot(id);
    if (el && el.data) Plotly.Plots.resize(el);
  }

  function fmtPct(v) { return CDC.num(v) !== null ? CDC.num(v).toFixed(2) : null; }

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

  function clearBanner(el) { el.innerHTML = ''; }

  function fmtDate(ts) {
    return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  function markStale(bannerEl, result, retryFn) {
    if (result.stale) {
      showBanner(bannerEl, 'warn', 'Live fetch failed. Showing cached data from ' + fmtDate(result.fetchedAt) + '.', retryFn);
    } else {
      clearBanner(bannerEl);
    }
  }

  // ---------- CDC tab ----------
  var cdcRendered = false;
  var cdcEpoch = 0; // bumped per render; stale async completions are ignored

  function renderCdc() {
    var epoch = ++cdcEpoch;
    var geo = slot('cdc-state').value;
    var banner = slot('cdc-banner');
    var trendSlot = slot('cdc-trend');
    var mapSlot = slot('cdc-map');
    var directionSlot = slot('cdc-trend-direction');
    var missingSlot = slot('cdc-missing');
    trendSlot.classList.add('skeleton');
    mapSlot.classList.add('skeleton');
    directionSlot.classList.add('skeleton');
    missingSlot.classList.add('skeleton');

    // The quality card joins the trend fetch (sum check) and the map fetch
    // (facts, missingness); render whatever has arrived, in either order.
    var stash = { trendRows: null, mapRows: null };

    fetchCached(CDC.trendUrl(geo), CDC.TTL_MS).then(function (result) {
      if (epoch !== cdcEpoch) return; // a newer render superseded this one
      markStale(banner, result, renderCdc);
      var s = CDC.toSeries(result.data);
      trendSlot.classList.remove('skeleton');

      if (s.latestRaw) {
        slot('cdc-week').textContent = s.latestRaw.week;
        slot('tile-covid').textContent = s.latestRaw.covid !== null ? s.latestRaw.covid.toFixed(2) + '%' : '–';
        slot('tile-flu').textContent = s.latestRaw.flu !== null ? s.latestRaw.flu.toFixed(2) + '%' : '–';
        slot('tile-rsv').textContent = s.latestRaw.rsv !== null ? s.latestRaw.rsv.toFixed(2) + '%' : '–';
        slot('tile-combined').textContent = s.latestRaw.combined !== null ? s.latestRaw.combined.toFixed(2) + '%' : '–';
      }

      Plotly.react(trendSlot, [
        { x: s.weeks, y: s.covid, name: 'COVID-19', type: 'scatter', mode: 'lines', line: { color: COLORS.covid, width: 2.5 } },
        { x: s.weeks, y: s.flu, name: 'Influenza', type: 'scatter', mode: 'lines', line: { color: COLORS.flu, width: 2.5 } },
        { x: s.weeks, y: s.rsv, name: 'RSV', type: 'scatter', mode: 'lines', line: { color: COLORS.rsv, width: 2.5 } }
      ], baseLayout({ yaxis: { gridcolor: GRID, zeroline: false, ticksuffix: '%', rangemode: 'tozero' } }), PLOTLY_CONFIG);

      stash.trendRows = result.data;
      renderCdcQuality(stash, geo);
    }).catch(function () {
      if (epoch !== cdcEpoch) return;
      trendSlot.classList.remove('skeleton');
      showBanner(banner, 'error', 'Could not reach the CDC API. It may be briefly unavailable.', renderCdc);
    });

    fetchCached(CDC.latestWeekUrl(), CDC.TTL_MS).then(function (weekResult) {
      var latest = weekResult.data.length ? weekResult.data[0].week_end : null;
      if (!latest) throw new Error('no data');
      return fetchCached(CDC.mapUrl(latest), CDC.TTL_MS);
    }).then(function (result) {
      if (epoch !== cdcEpoch) return;
      var c = CDC.toChoropleth(result.data);
      mapSlot.classList.remove('skeleton');
      Plotly.react(mapSlot, [{
        type: 'choropleth',
        locationmode: 'USA-states',
        locations: c.locations,
        z: c.values,
        text: c.hover,
        hoverinfo: 'text',
        colorscale: [[0, '#151A2E'], [0.5, '#1E6B58'], [1, '#4AE3B5']],
        marker: { line: { color: '#0A0E1A', width: 1 } },
        colorbar: { title: { text: '% ED visits', font: FONT }, tickfont: FONT, thickness: 12, len: 0.8 }
      }], {
        paper_bgcolor: 'rgba(0,0,0,0)',
        geo: { scope: 'usa', bgcolor: 'rgba(0,0,0,0)', lakecolor: 'rgba(0,0,0,0)', landcolor: '#151A2E', subunitcolor: GRID },
        font: FONT,
        margin: { l: 0, r: 0, t: 0, b: 0 }
      }, PLOTLY_CONFIG);

      stash.mapRows = result.data;
      renderCdcTrendDirection(result.data);
      renderCdcStateTable(result.data);
      renderCdcQuality(stash, geo);
    }).catch(function () {
      if (epoch !== cdcEpoch) return;
      mapSlot.classList.remove('skeleton');
      directionSlot.classList.remove('skeleton');
      missingSlot.classList.remove('skeleton');
      mapSlot.innerHTML = '<div class="dash-banner error">Map data unavailable right now.</div>';
    });

    cdcRendered = true;
  }

  var TREND_COLORS = {
    'Increasing': '#F8A44C',
    'No Change': 'rgba(150,160,181,0.5)',
    'Decreasing': '#4AE3B5',
    'Unavailable': 'rgba(150,160,181,0.2)'
  };

  function renderCdcTrendDirection(rows) {
    var el = slot('cdc-trend-direction');
    el.classList.remove('skeleton');
    var t = CDC.toTrendCounts(rows);
    Plotly.react(el, t.byLabel.map(function (series) {
      return {
        x: series.counts,
        y: t.pathogens,
        name: series.label,
        type: 'bar',
        orientation: 'h',
        marker: { color: TREND_COLORS[series.label] }
      };
    }), baseLayout({
      barmode: 'stack',
      hovermode: 'closest',
      margin: { l: 80, r: 16, t: 8, b: 40 },
      xaxis: { gridcolor: GRID, zeroline: false, title: { text: 'states', font: FONT } }
    }), PLOTLY_CONFIG);
  }

  function renderCdcStateTable(rows) {
    var trendFmt = function (v) { return v; };
    var tableRows = rows.map(function (r) {
      var copy = {};
      Object.keys(r).forEach(function (k) { copy[k] = r[k]; });
      var combined = CDC.combinedOf(r);
      if (combined !== null) copy.combined_calc = combined;
      return copy;
    });
    Tables.render(slot('cdc-table'), {
      sortable: true,
      rows: tableRows,
      columns: [
        { key: 'geography', label: 'Geography' },
        { key: 'percent_visits_covid', label: 'COVID %', numeric: true, fmt: fmtPct },
        { key: 'percent_visits_influenza', label: 'Flu %', numeric: true, fmt: fmtPct },
        { key: 'percent_visits_rsv', label: 'RSV %', numeric: true, fmt: fmtPct },
        { key: 'combined_calc', label: 'Combined (computed)', numeric: true, fmt: function (v) { return v.toFixed(2); } },
        { key: 'ed_trends_covid', label: 'COVID trend', fmt: trendFmt },
        { key: 'ed_trends_influenza', label: 'Flu trend', fmt: trendFmt },
        { key: 'ed_trends_rsv', label: 'RSV trend', fmt: trendFmt }
      ]
    });
  }

  var CDC_MISSING_FIELDS = [
    { key: 'percent_visits_covid', label: 'COVID %' },
    { key: 'percent_visits_influenza', label: 'Flu %' },
    { key: 'percent_visits_rsv', label: 'RSV %' },
    { key: 'percent_visits_combined', label: 'Combined (source)' },
    { key: 'ed_trends_covid', label: 'COVID trend label' },
    { key: 'ed_trends_influenza', label: 'Flu trend label' },
    { key: 'ed_trends_rsv', label: 'RSV trend label' }
  ];

  function renderCdcQuality(stash, geo) {
    if (stash.mapRows) {
      var q = CDC.toQuality(stash.mapRows, Date.now());
      slot('dq-week').textContent = q.weekEnd || '–';
      slot('dq-build').textContent = q.buildnumber || '–';
      slot('dq-age').textContent = q.daysOld !== null ? q.daysOld : '–';
      slot('dq-geos').textContent = q.geoCount || '–';
      slot('dq-rows').textContent = q.rowCount || '–';

      var mapNote = slot('cdc-map-missing');
      if (q.statesWithNulls.length) {
        mapNote.textContent = 'Missing this week: ' + q.statesWithNulls.map(function (s) {
          return s.geography + ' (' + s.fields.join(', ') + ')';
        }).join('; ') + '.';
      } else {
        mapNote.textContent = 'All states reported values this week.';
      }

      var rates = Tables.missingRates(stash.mapRows, CDC_MISSING_FIELDS).slice().reverse();
      var missingSlot = slot('cdc-missing');
      missingSlot.classList.remove('skeleton');
      Plotly.react(missingSlot, [{
        x: rates.map(function (r) { return r.pct; }),
        y: rates.map(function (r) { return r.label; }),
        type: 'bar',
        orientation: 'h',
        marker: { color: COLORS.flu },
        text: rates.map(function (r) { return r.missing + ' of ' + r.total; }),
        hoverinfo: 'text'
      }], baseLayout({
        hovermode: 'closest',
        margin: { l: 140, r: 16, t: 8, b: 40 },
        xaxis: { gridcolor: GRID, zeroline: false, ticksuffix: '%', range: [0, 100], title: { text: 'rows missing the value', font: FONT } }
      }), PLOTLY_CONFIG);
    }

    var parts = [];
    if (stash.mapRows) {
      var q2 = CDC.toQuality(stash.mapRows, Date.now());
      parts.push('The source combined column was null in ' + q2.combinedNull + ' of ' + q2.rowCount +
        ' rows this week, so the Combined tile and map are COVID + flu + RSV summed in your browser.');
    }
    if (stash.trendRows) {
      var check = CDC.sumCheck(stash.trendRows);
      if (check.checked > 0) {
        parts.push('Where the source column still has values (' + check.checked + ' of ' + check.total +
          ' weeks fetched for ' + geo + '), the computed sum matches it within ' + check.maxDiff.toFixed(2) + ' points.');
      } else {
        parts.push('The source column was null in all ' + check.total + ' weeks fetched for ' + geo +
          ', so there is nothing left to check the sum against; it has been unpopulated since September 2024.');
      }
    }
    slot('cdc-quality-note').textContent = parts.join(' ');
  }

  // ---------- openFDA tab ----------
  var fdaRendered = false;
  var fdaEpoch = 0;

  function hBarLayout(extra) {
    var base = {
      hovermode: 'closest',
      margin: { l: 160, r: 16, t: 8, b: 40 },
      yaxis: { gridcolor: GRID, zeroline: false, automargin: true }
    };
    Object.keys(extra || {}).forEach(function (k) { base[k] = extra[k]; });
    return baseLayout(base);
  }

  function renderFda() {
    var epoch = ++fdaEpoch;
    var drug = slot('fda-drug').value.trim();
    if (!drug) return;
    var banner = slot('fda-banner');
    var reactionsSlot = slot('fda-reactions');
    var timeSlot = slot('fda-time');
    var qualSlot = slot('fda-qualification');
    var outcomeSlot = slot('fda-outcomes');
    var seriousnessSlot = slot('fda-seriousness');
    var allSlots = [reactionsSlot, timeSlot, qualSlot, outcomeSlot, seriousnessSlot];
    allSlots.forEach(function (s) { s.classList.add('skeleton'); });

    var anyStale = false;

    // Each promise resolves with the parsed data it rendered, so the joint
    // completion below can build the reactions table and cross-check note.
    var pReactions = fetchCached(OpenFDA.topReactionsUrl(drug), OpenFDA.TTL_MS).then(function (result) {
      if (epoch !== fdaEpoch) return null;
      anyStale = anyStale || result.stale;
      var r = OpenFDA.toReactions(result.data.results, 12);
      reactionsSlot.classList.remove('skeleton');
      Plotly.react(reactionsSlot, [{
        x: r.counts.slice().reverse(),
        y: r.labels.slice().reverse(),
        type: 'bar',
        orientation: 'h',
        marker: { color: COLORS.bar }
      }], hBarLayout(), PLOTLY_CONFIG);
      return result.data.results;
    });

    var pTime = fetchCached(OpenFDA.overTimeUrl(drug), OpenFDA.TTL_MS).then(function (result) {
      if (epoch !== fdaEpoch) return null;
      anyStale = anyStale || result.stale;
      var m = OpenFDA.toMonthly(result.data.results);
      timeSlot.classList.remove('skeleton');
      slot('tile-through').textContent = m.dataThrough || '–';
      Plotly.react(timeSlot, [{
        x: m.months, y: m.counts, type: 'scatter', mode: 'lines',
        fill: 'tozeroy', line: { color: COLORS.line, width: 2 },
        fillcolor: 'rgba(74,227,181,0.08)'
      }], baseLayout({
        hovermode: 'x',
        annotations: m.dataThrough ? [{
          text: 'FAERS data through ' + m.dataThrough,
          xref: 'paper', yref: 'paper', x: 1, y: 1.1,
          xanchor: 'right', showarrow: false, font: FONT
        }] : []
      }), PLOTLY_CONFIG);
      return m;
    });

    var pSerious = fetchCached(OpenFDA.seriousUrl(drug), OpenFDA.TTL_MS).then(function (result) {
      if (epoch !== fdaEpoch) return null;
      anyStale = anyStale || result.stale;
      var s = OpenFDA.toSerious(result.data.results);
      var total = s.serious + s.nonSerious;
      slot('tile-total').textContent = total ? total.toLocaleString() : '–';
      slot('tile-serious').textContent = s.serious ? s.serious.toLocaleString() : '–';
      slot('tile-serious-pct').textContent = total ? ((100 * s.serious) / total).toFixed(1) + '%' : '–';
      return total;
    });

    var pQualification = fetchCached(OpenFDA.qualificationUrl(drug), OpenFDA.TTL_MS).then(function (result) {
      if (epoch !== fdaEpoch) return null;
      anyStale = anyStale || result.stale;
      var q = OpenFDA.toQualification(result.data.results);
      qualSlot.classList.remove('skeleton');
      Plotly.react(qualSlot, [{
        x: q.counts.slice().reverse(),
        y: q.labels.slice().reverse(),
        type: 'bar',
        orientation: 'h',
        marker: { color: COLORS.bar }
      }], hBarLayout(), PLOTLY_CONFIG);
      return q;
    });

    var pOutcomes = fetchCached(OpenFDA.outcomeUrl(drug), OpenFDA.TTL_MS).then(function (result) {
      if (epoch !== fdaEpoch) return null;
      anyStale = anyStale || result.stale;
      var o = OpenFDA.toOutcomes(result.data.results);
      outcomeSlot.classList.remove('skeleton');
      Plotly.react(outcomeSlot, [{
        x: o.counts.slice().reverse(),
        y: o.labels.slice().reverse(),
        type: 'bar',
        orientation: 'h',
        marker: {
          color: o.labels.slice().reverse().map(function (l) {
            return l === 'Fatal' ? '#E36A6A' : COLORS.bar;
          })
        }
      }], hBarLayout(), PLOTLY_CONFIG);
      return o;
    });

    // Six single-bucket queries; one failing hides its bar, not the panel.
    var pSeriousness = Promise.all(OpenFDA.seriousnessUrls(drug).map(function (url) {
      return fetchCached(url, OpenFDA.TTL_MS).then(function (result) {
        anyStale = anyStale || result.stale;
        return result.data.results;
      }).catch(function () { return null; });
    })).then(function (resultsList) {
      if (epoch !== fdaEpoch) return null;
      var s = OpenFDA.toSeriousness(resultsList);
      seriousnessSlot.classList.remove('skeleton');
      Plotly.react(seriousnessSlot, [{
        x: s.counts.slice().reverse(),
        y: s.labels.slice().reverse(),
        type: 'bar',
        orientation: 'h',
        marker: { color: COLORS.rsv }
      }], hBarLayout(), PLOTLY_CONFIG);
      return s;
    });

    Promise.all([pReactions, pTime, pSerious, pQualification, pOutcomes, pSeriousness]).then(function (values) {
      if (epoch !== fdaEpoch) return;
      if (anyStale) {
        showBanner(banner, 'warn', 'Live fetch failed for some charts. Showing cached data.', renderFda);
      } else {
        clearBanner(banner);
      }
      slot('fda-current-drug').textContent = drug;
      renderFdaTable(values[0], values[2]);
      renderFdaQualityNote(values[4], values[5]);
    }).catch(function () {
      if (epoch !== fdaEpoch) return;
      allSlots.forEach(function (s) { s.classList.remove('skeleton'); });
      showBanner(banner, 'error', 'No results for "' + drug + '". Try a generic name like metformin or ibuprofen.', null);
    });

    fdaRendered = true;
  }

  function renderFdaTable(reactionResults, totalReports) {
    if (!reactionResults) return;
    var rows = reactionResults.map(function (r) {
      var t = String(r.term || '').toLowerCase();
      return {
        reaction: t.charAt(0).toUpperCase() + t.slice(1),
        count: r.count || 0,
        share: totalReports ? (100 * (r.count || 0)) / totalReports : null
      };
    });
    Tables.render(slot('fda-table'), {
      sortable: true,
      rows: rows,
      columns: [
        { key: 'reaction', label: 'Reaction' },
        { key: 'count', label: 'Reports', numeric: true, fmt: function (v) { return v.toLocaleString(); } },
        { key: 'share', label: 'Share of all reports', numeric: true, fmt: function (v) { return v.toFixed(1) + '%'; } }
      ]
    });
  }

  function renderFdaQualityNote(outcomes, seriousness) {
    var parts = [];
    if (outcomes && seriousness) {
      var fatal = 0;
      outcomes.labels.forEach(function (l, i) { if (l === 'Fatal') fatal = outcomes.counts[i]; });
      var death = 0;
      seriousness.labels.forEach(function (l, i) { if (l === 'Death') death = seriousness.counts[i]; });
      if (fatal || death) {
        parts.push('Cross-check: ' + fatal.toLocaleString() + ' reactions coded fatal above vs ' +
          death.toLocaleString() + ' reports flagged for death here. One counts reactions, the other counts reports, so they will not match, and neither is a confirmed cause of death.');
      }
    }
    slot('fda-quality-note').textContent = parts.join(' ');
  }

  // ---------- tabs (render lazily; Plotly sizes wrong in hidden panels) ----------
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.dash-tab'));

  function selectTab(id) {
    tabs.forEach(function (t) {
      var selected = t.getAttribute('aria-controls') === id;
      t.setAttribute('aria-selected', String(selected));
    });
    ['panel-cdc', 'panel-fda'].forEach(function (pid) {
      document.getElementById(pid).hidden = pid !== id;
    });
    if (id === 'panel-cdc') {
      if (!cdcRendered) renderCdc();
      else ['cdc-trend', 'cdc-map', 'cdc-trend-direction', 'cdc-missing'].forEach(safeResize);
    }
    if (id === 'panel-fda') {
      if (!fdaRendered) renderFda();
      else ['fda-reactions', 'fda-time', 'fda-qualification', 'fda-outcomes', 'fda-seriousness'].forEach(safeResize);
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

  // ---------- controls ----------
  var stateSelect = slot('cdc-state');
  var optUS = document.createElement('option');
  optUS.value = 'United States';
  optUS.textContent = 'United States (national)';
  stateSelect.appendChild(optUS);
  CDC.STATES.forEach(function (name) {
    var opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    stateSelect.appendChild(opt);
  });
  stateSelect.addEventListener('change', renderCdc);

  var drugInput = slot('fda-drug');
  var datalist = slot('drug-options');
  OpenFDA.COMMON_DRUGS.forEach(function (d) {
    var opt = document.createElement('option');
    opt.value = d;
    datalist.appendChild(opt);
  });
  slot('fda-go').addEventListener('click', renderFda);
  drugInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') renderFda(); });

  // ---------- data dictionaries (static, rendered once) ----------
  var DICT_COLUMNS = [
    { key: 'field', label: 'Field' },
    { key: 'plain', label: 'What it means' },
    { key: 'used', label: 'Used here' }
  ];
  Tables.render(slot('cdc-dict'), { columns: DICT_COLUMNS, rows: CDC.DICTIONARY, sortable: false });
  Tables.render(slot('fda-dict'), { columns: DICT_COLUMNS, rows: OpenFDA.DICTIONARY, sortable: false });

  // initial render
  selectTab('panel-cdc');
})();
