// CDC NSSP emergency-department visit data (Socrata dataset rdmq-nq56).
// Percent of ED visits attributed to COVID-19, influenza, and RSV, weekly by state.
// All numeric fields arrive as strings; parseFloat everything.
(function (global) {
  'use strict';

  var BASE = 'https://data.cdc.gov/resource/rdmq-nq56.json';
  var TTL_MS = 12 * 60 * 60 * 1000; // weekly data; 12h cache is plenty

  function trendUrl(geography) {
    var params = new URLSearchParams({
      geography: geography,
      county: 'All',
      '$select': 'week_end,geography,percent_visits_covid,percent_visits_influenza,percent_visits_rsv,percent_visits_combined,percent_visits_smoothed_covid,percent_visits_smoothed_1,percent_visits_smoothed_rsv,percent_visits_smoothed,ed_trends_covid,ed_trends_influenza,ed_trends_rsv,buildnumber',
      '$order': 'week_end DESC',
      '$limit': '104'
    });
    return BASE + '?' + params.toString();
  }

  function latestWeekUrl() {
    var params = new URLSearchParams({
      county: 'All',
      '$select': 'week_end',
      '$order': 'week_end DESC',
      '$limit': '1'
    });
    return BASE + '?' + params.toString();
  }

  function mapUrl(weekEnd) {
    // All 20 columns on purpose: this one ~52-row response also feeds the
    // state table, trend-direction chart, and data-quality panel.
    var params = new URLSearchParams({
      county: 'All',
      week_end: weekEnd,
      '$limit': '80'
    });
    return BASE + '?' + params.toString();
  }

  function num(v) {
    var n = parseFloat(v);
    return isNaN(n) ? null : n;
  }

  // The dataset's percent_visits_combined column has been null since 2024-09,
  // so "combined" is computed client-side as covid + flu + rsv. sumCheck()
  // verifies the sum against the source column where it still exists.
  function combinedOf(row) {
    var c = num(row.percent_visits_covid);
    var f = num(row.percent_visits_influenza);
    var r = num(row.percent_visits_rsv);
    if (c === null && f === null && r === null) return null;
    return (c || 0) + (f || 0) + (r || 0);
  }

  // rows (DESC) -> {weeks[], covid[], flu[], rsv[], combined[]} in ascending order
  function toSeries(rows) {
    var asc = rows.slice().reverse();
    return {
      weeks: asc.map(function (r) { return (r.week_end || '').slice(0, 10); }),
      covid: asc.map(function (r) { return num(r.percent_visits_smoothed_covid !== undefined ? r.percent_visits_smoothed_covid : r.percent_visits_covid); }),
      // Socrata quirk: the smoothed influenza column is named percent_visits_smoothed_1
      flu: asc.map(function (r) { return num(r.percent_visits_smoothed_1 !== undefined ? r.percent_visits_smoothed_1 : r.percent_visits_influenza); }),
      rsv: asc.map(function (r) { return num(r.percent_visits_smoothed_rsv !== undefined ? r.percent_visits_smoothed_rsv : r.percent_visits_rsv); }),
      combined: asc.map(combinedOf),
      latestRaw: rows.length ? {
        week: (rows[0].week_end || '').slice(0, 10),
        covid: num(rows[0].percent_visits_covid),
        flu: num(rows[0].percent_visits_influenza),
        rsv: num(rows[0].percent_visits_rsv),
        combined: combinedOf(rows[0])
      } : null
    };
  }

  var STATE_ABBR = {
    'Alabama':'AL','Alaska':'AK','Arizona':'AZ','Arkansas':'AR','California':'CA','Colorado':'CO',
    'Connecticut':'CT','Delaware':'DE','District of Columbia':'DC','Florida':'FL','Georgia':'GA',
    'Hawaii':'HI','Idaho':'ID','Illinois':'IL','Indiana':'IN','Iowa':'IA','Kansas':'KS','Kentucky':'KY',
    'Louisiana':'LA','Maine':'ME','Maryland':'MD','Massachusetts':'MA','Michigan':'MI','Minnesota':'MN',
    'Mississippi':'MS','Missouri':'MO','Montana':'MT','Nebraska':'NE','Nevada':'NV','New Hampshire':'NH',
    'New Jersey':'NJ','New Mexico':'NM','New York':'NY','North Carolina':'NC','North Dakota':'ND',
    'Ohio':'OH','Oklahoma':'OK','Oregon':'OR','Pennsylvania':'PA','Rhode Island':'RI','South Carolina':'SC',
    'South Dakota':'SD','Tennessee':'TN','Texas':'TX','Utah':'UT','Vermont':'VT','Virginia':'VA',
    'Washington':'WA','West Virginia':'WV','Wisconsin':'WI','Wyoming':'WY'
  };

  // map rows -> {locations[], values[], hover[]} for a USA-states choropleth
  function toChoropleth(rows) {
    var locations = [], values = [], hover = [];
    rows.forEach(function (r) {
      var abbr = STATE_ABBR[r.geography];
      var v = combinedOf(r);
      if (abbr && v !== null) {
        locations.push(abbr);
        values.push(v);
        hover.push(r.geography + ': ' + v.toFixed(2) + '%');
      }
    });
    return { locations: locations, values: values, hover: hover };
  }

  var TREND_LABELS = ['Increasing', 'No Change', 'Decreasing'];
  var PATHOGENS = [
    { key: 'ed_trends_covid', pct: 'percent_visits_covid', label: 'COVID-19' },
    { key: 'ed_trends_influenza', pct: 'percent_visits_influenza', label: 'Influenza' },
    { key: 'ed_trends_rsv', pct: 'percent_visits_rsv', label: 'RSV' }
  ];

  // map rows -> per-pathogen counts of the official CDC trend labels.
  // Socrata omits null keys, so "no label" = key absent, not key === null.
  function toTrendCounts(rows) {
    var states = rows.filter(function (r) { return r.geography !== 'United States'; });
    return {
      pathogens: PATHOGENS.map(function (p) { return p.label; }),
      byLabel: TREND_LABELS.concat(['Unavailable']).map(function (label) {
        return {
          label: label,
          counts: PATHOGENS.map(function (p) {
            var n = 0;
            states.forEach(function (r) {
              var v = r[p.key];
              // "Unavailable" covers both the source's explicit
              // "Data Unavailable" label and a missing key.
              if (label === 'Unavailable' ? (v === undefined || v === '' || v === 'Data Unavailable') : v === label) n++;
            });
            return n;
          })
        };
      })
    };
  }

  // map rows -> quality facts for the "Data quality this week" card
  function toQuality(rows, now) {
    var weekEnd = rows.length ? (rows[0].week_end || '').slice(0, 10) : null;
    var daysOld = weekEnd ? Math.round((now - new Date(weekEnd + 'T00:00:00Z')) / 86400000) : null;
    var build = null;
    rows.forEach(function (r) { if (r.buildnumber) build = r.buildnumber; });
    var combinedNull = 0;
    var statesWithNulls = [];
    rows.forEach(function (r) {
      if (!('percent_visits_combined' in r)) combinedNull++;
      var gaps = PATHOGENS.filter(function (p) { return !(p.pct in r); });
      if (gaps.length && r.geography !== 'United States') {
        statesWithNulls.push({
          geography: r.geography,
          fields: gaps.map(function (p) { return p.label; })
        });
      }
    });
    return {
      weekEnd: weekEnd,
      daysOld: daysOld,
      buildnumber: build,
      rowCount: rows.length,
      geoCount: rows.filter(function (r) { return r.geography !== 'United States'; }).length,
      combinedNull: combinedNull,
      statesWithNulls: statesWithNulls
    };
  }

  // trend rows (one geography, 104 weeks): compare the client-side sum with
  // the source combined column wherever the source still has a value.
  function sumCheck(rows) {
    var checked = 0, maxDiff = 0;
    rows.forEach(function (r) {
      var source = num(r.percent_visits_combined);
      if (source === null) return;
      var sum = combinedOf(r);
      if (sum === null) return;
      checked++;
      var d = Math.abs(source - sum);
      if (d > maxDiff) maxDiff = d;
    });
    return { checked: checked, total: rows.length, maxDiff: maxDiff };
  }

  // Every column in the dataset, in plain language, with how this page uses it.
  var DICTIONARY = [
    { field: 'week_end', plain: 'Date the surveillance week ends (Saturday).', used: 'trend chart, tiles, table' },
    { field: 'geography', plain: 'State name, or "United States" for the national rollup.', used: 'everywhere' },
    { field: 'county', plain: 'County name; "All" is the state-level rollup. This page only requests "All".', used: 'query filter' },
    { field: 'percent_visits_covid', plain: 'Percent of ED visits diagnosed as COVID-19 that week, unsmoothed.', used: 'tiles, map, table' },
    { field: 'percent_visits_influenza', plain: 'Percent of ED visits diagnosed as influenza, unsmoothed.', used: 'tiles, map, table' },
    { field: 'percent_visits_rsv', plain: 'Percent of ED visits diagnosed as RSV, unsmoothed.', used: 'tiles, map, table' },
    { field: 'percent_visits_combined', plain: 'Source-provided COVID + flu + RSV percent. Null since September 2024, so this page computes the sum in your browser instead.', used: 'quality check only' },
    { field: 'percent_visits_smoothed_covid', plain: '3-week moving average of the COVID percent.', used: 'trend chart' },
    { field: 'percent_visits_smoothed_1', plain: '3-week moving average of the influenza percent. Yes, the column is really named "_1" at the source.', used: 'trend chart' },
    { field: 'percent_visits_smoothed_rsv', plain: '3-week moving average of the RSV percent.', used: 'trend chart' },
    { field: 'percent_visits_smoothed', plain: 'Smoothed combined percent. Also null since September 2024.', used: 'not used' },
    { field: 'ed_trends_covid', plain: 'CDC’s official call on the COVID trajectory: Increasing, Decreasing, No Change, or Data Unavailable.', used: 'trend-direction chart, table' },
    { field: 'ed_trends_influenza', plain: 'Official influenza trajectory label.', used: 'trend-direction chart, table' },
    { field: 'ed_trends_rsv', plain: 'Official RSV trajectory label.', used: 'trend-direction chart, table' },
    { field: 'hsa', plain: 'Health Service Area name, for sub-state rows. "All" at the state level shown here.', used: 'not used' },
    { field: 'hsa_counties', plain: 'Counties making up the Health Service Area.', used: 'not used' },
    { field: 'hsa_nci_id', plain: 'Numeric ID of the Health Service Area.', used: 'not used' },
    { field: 'fips', plain: 'FIPS geographic code for the row.', used: 'not used' },
    { field: 'trend_source', plain: 'Whether the trend labels were computed at State or HSA level.', used: 'not used' },
    { field: 'buildnumber', plain: 'Date CDC built this data file. The "Data built" fact above comes from here.', used: 'quality card' }
  ];

  global.CDC = {
    TTL_MS: TTL_MS,
    trendUrl: trendUrl,
    latestWeekUrl: latestWeekUrl,
    mapUrl: mapUrl,
    num: num,
    combinedOf: combinedOf,
    toSeries: toSeries,
    toChoropleth: toChoropleth,
    toTrendCounts: toTrendCounts,
    toQuality: toQuality,
    sumCheck: sumCheck,
    DICTIONARY: DICTIONARY,
    STATES: Object.keys(STATE_ABBR)
  };
})(window);
