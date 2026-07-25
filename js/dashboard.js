// Dashboard orchestration: tabs, fetch-with-cache, Plotly rendering.
// Both APIs are CORS-open; everything runs client-side on GitHub Pages.
(function () {
  'use strict';

  // ---------- fetch + localStorage cache ----------
  var CACHE_PREFIX = 'dash:v1:';

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
    } catch (e) { /* quota / private browsing — degrade to no cache */ }
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
      showBanner(bannerEl, 'warn', 'Live fetch failed — showing cached data from ' + fmtDate(result.fetchedAt) + '.', retryFn);
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
    trendSlot.classList.add('skeleton');
    mapSlot.classList.add('skeleton');

    fetchCached(CDC.trendUrl(geo), CDC.TTL_MS).then(function (result) {
      if (epoch !== cdcEpoch) return; // a newer render superseded this one
      markStale(banner, result, renderCdc);
      var s = CDC.toSeries(result.data);
      trendSlot.classList.remove('skeleton');

      if (s.latestRaw) {
        slot('cdc-week').textContent = s.latestRaw.week;
        slot('tile-covid').textContent = s.latestRaw.covid !== null ? s.latestRaw.covid.toFixed(2) + '%' : '—';
        slot('tile-flu').textContent = s.latestRaw.flu !== null ? s.latestRaw.flu.toFixed(2) + '%' : '—';
        slot('tile-rsv').textContent = s.latestRaw.rsv !== null ? s.latestRaw.rsv.toFixed(2) + '%' : '—';
        slot('tile-combined').textContent = s.latestRaw.combined !== null ? s.latestRaw.combined.toFixed(2) + '%' : '—';
      }

      Plotly.react(trendSlot, [
        { x: s.weeks, y: s.covid, name: 'COVID-19', type: 'scatter', mode: 'lines', line: { color: COLORS.covid, width: 2.5 } },
        { x: s.weeks, y: s.flu, name: 'Influenza', type: 'scatter', mode: 'lines', line: { color: COLORS.flu, width: 2.5 } },
        { x: s.weeks, y: s.rsv, name: 'RSV', type: 'scatter', mode: 'lines', line: { color: COLORS.rsv, width: 2.5 } }
      ], baseLayout({ yaxis: { gridcolor: GRID, zeroline: false, ticksuffix: '%', rangemode: 'tozero' } }), PLOTLY_CONFIG);
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
    }).catch(function () {
      if (epoch !== cdcEpoch) return;
      mapSlot.classList.remove('skeleton');
      mapSlot.innerHTML = '<div class="dash-banner error">Map data unavailable right now.</div>';
    });

    cdcRendered = true;
  }

  // ---------- openFDA tab ----------
  var fdaRendered = false;
  var fdaEpoch = 0;

  function renderFda() {
    var epoch = ++fdaEpoch;
    var drug = slot('fda-drug').value.trim();
    if (!drug) return;
    var banner = slot('fda-banner');
    var reactionsSlot = slot('fda-reactions');
    var timeSlot = slot('fda-time');
    reactionsSlot.classList.add('skeleton');
    timeSlot.classList.add('skeleton');

    var anyStale = false;

    var pReactions = fetchCached(OpenFDA.topReactionsUrl(drug), OpenFDA.TTL_MS).then(function (result) {
      if (epoch !== fdaEpoch) return;
      anyStale = anyStale || result.stale;
      var r = OpenFDA.toReactions(result.data.results);
      reactionsSlot.classList.remove('skeleton');
      Plotly.react(reactionsSlot, [{
        x: r.counts.slice().reverse(),
        y: r.labels.slice().reverse(),
        type: 'bar',
        orientation: 'h',
        marker: { color: COLORS.bar }
      }], baseLayout({ margin: { l: 160, r: 16, t: 8, b: 40 }, hovermode: 'closest' }), PLOTLY_CONFIG);
    });

    var pTime = fetchCached(OpenFDA.overTimeUrl(drug), OpenFDA.TTL_MS).then(function (result) {
      if (epoch !== fdaEpoch) return;
      anyStale = anyStale || result.stale;
      var m = OpenFDA.toMonthly(result.data.results);
      timeSlot.classList.remove('skeleton');
      Plotly.react(timeSlot, [{
        x: m.months, y: m.counts, type: 'scatter', mode: 'lines',
        fill: 'tozeroy', line: { color: COLORS.line, width: 2 },
        fillcolor: 'rgba(74,227,181,0.08)'
      }], baseLayout({ hovermode: 'x' }), PLOTLY_CONFIG);
    });

    var pSerious = fetchCached(OpenFDA.seriousUrl(drug), OpenFDA.TTL_MS).then(function (result) {
      if (epoch !== fdaEpoch) return;
      anyStale = anyStale || result.stale;
      var s = OpenFDA.toSerious(result.data.results);
      var total = s.serious + s.nonSerious;
      slot('tile-total').textContent = total ? total.toLocaleString() : '—';
      slot('tile-serious').textContent = s.serious ? s.serious.toLocaleString() : '—';
      slot('tile-serious-pct').textContent = total ? ((100 * s.serious) / total).toFixed(1) + '%' : '—';
    });

    Promise.all([pReactions, pTime, pSerious]).then(function () {
      if (epoch !== fdaEpoch) return;
      if (anyStale) {
        showBanner(banner, 'warn', 'Live fetch failed for some charts — showing cached data.', renderFda);
      } else {
        clearBanner(banner);
      }
      slot('fda-current-drug').textContent = drug;
    }).catch(function () {
      if (epoch !== fdaEpoch) return;
      reactionsSlot.classList.remove('skeleton');
      timeSlot.classList.remove('skeleton');
      showBanner(banner, 'error', 'No results for "' + drug + '" — try a generic name like metformin or ibuprofen.', null);
    });

    fdaRendered = true;
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
      else { Plotly.Plots.resize(slot('cdc-trend')); Plotly.Plots.resize(slot('cdc-map')); }
    }
    if (id === 'panel-fda') {
      if (!fdaRendered) renderFda();
      else { Plotly.Plots.resize(slot('fda-reactions')); Plotly.Plots.resize(slot('fda-time')); }
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

  // initial render
  selectTab('panel-cdc');
})();
