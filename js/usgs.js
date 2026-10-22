// USGS Water Services fetch/transform module for the Utah water dashboard.
// Three services, all CORS-open and keyless:
//   iv/   instantaneous values (latest readings)
//   stat/ daily statistics (per-calendar-day percentiles, RDB only)
//   dv/   daily values (historical daily means)
(function (global) {
  'use strict';

  var BASE = 'https://waterservices.usgs.gov/nwis';

  var IV_TTL_MS = 15 * 60 * 1000;       // readings update every 15 min
  var STAT_TTL_MS = 24 * 60 * 60 * 1000; // percentile tables change once a day at most
  var DV_TTL_MS = 6 * 60 * 60 * 1000;

  // The IV service returns each series' most recent value EVER, even if the
  // sensor died in 2014. Anything older than this is excluded from stats/map.
  var FRESH_MS = 6 * 60 * 60 * 1000;

  // Featured gages: long percentile records, spread across the state's basins.
  var MARQUEE = [
    { no: '10163000', name: 'Provo River at Provo' },
    { no: '09315000', name: 'Green River at Green River' },
    { no: '09180500', name: 'Colorado River near Cisco' },
    { no: '09406000', name: 'Virgin River at Virgin' },
    { no: '10136500', name: 'Weber River at Gateway' },
    { no: '10109000', name: 'Logan River above State Dam' }
  ];

  var GSL_SITE = '10010000'; // Great Salt Lake at Saltair Boat Harbor (south arm)
  var GSL_HEALTHY_FLOOR = 4198;   // ft, bottom of the state's healthy range (4,198-4,205)
  var GSL_RECORD_LOW = 4188.5;    // ft, November 2022 record low

  // ---------- URLs ----------
  function ivStatewideUrl() {
    return BASE + '/iv/?format=json&stateCd=ut&siteStatus=active&parameterCd=00060,00065,00010';
  }
  function statDailyUrl(siteNos) {
    return BASE + '/stat/?format=rdb&sites=' + siteNos.join(',') +
      '&statReportType=daily&statTypeCd=all&parameterCd=00060';
  }
  function dvUrl(siteNo, paramCd, days) {
    return BASE + '/dv/?format=json&sites=' + siteNo + '&parameterCd=' + paramCd +
      '&period=P' + days + 'D'; // the dv service rejects P5Y; day-based periods only
  }

  // ---------- small helpers ----------
  function decodeEntities(s) {
    // variableName arrives with entities like ft&#179;/s
    var el = document.createElement('textarea');
    el.innerHTML = s;
    return el.value;
  }

  function num(v) {
    var n = parseFloat(v);
    return isNaN(n) ? null : n;
  }

  // ---------- IV condensing ----------
  // One row per site with its latest discharge/gage-height/temp reading.
  // Sentinel values (the declared noDataValue, -999999) are dropped and counted.
  // Only the first values block per series is used; extras are multi-sensor
  // rigs (up to 36 depths at the Great Salt Lake breach) and are counted, not summed.
  function condenseIv(json, nowMs) {
    var bySite = {};
    var quality = {
      seriesTotal: 0, seriesFresh: 0, seriesStale: 0,
      sentinelsDropped: 0, multiSensorSeries: 0,
      qualifiers: {}, oldestStaleISO: null
    };

    json.value.timeSeries.forEach(function (t) {
      var code = t.variable.variableCode[0].value;
      var noData = t.variable.noDataValue;
      var block = t.values[0];
      if (t.values.length > 1) quality.multiSensorSeries++;
      if (!block || !block.value.length) return;
      quality.seriesTotal++;

      var v = block.value[block.value.length - 1];
      var val = num(v.value);
      (v.qualifiers || []).forEach(function (q) {
        quality.qualifiers[q] = (quality.qualifiers[q] || 0) + 1;
      });
      if (val !== null && (val === noData || val <= -99999)) {
        quality.sentinelsDropped++;
        val = null;
      }

      var ageMs = nowMs - Date.parse(v.dateTime);
      var fresh = ageMs < FRESH_MS;
      if (fresh) quality.seriesFresh++;
      else {
        quality.seriesStale++;
        if (!quality.oldestStaleISO || v.dateTime < quality.oldestStaleISO) {
          quality.oldestStaleISO = v.dateTime;
        }
      }

      var siteNo = t.sourceInfo.siteCode[0].value;
      var row = bySite[siteNo];
      if (!row) {
        var geo = t.sourceInfo.geoLocation.geogLocation;
        row = bySite[siteNo] = {
          no: siteNo,
          name: t.sourceInfo.siteName,
          lat: geo.latitude, lon: geo.longitude
        };
      }
      var field = { '00060': 'q', '00065': 'gh', '00010': 'wt' }[code];
      if (field) {
        row[field] = val;
        row[field + 'Time'] = v.dateTime;
        row[field + 'Fresh'] = fresh;
        row[field + 'Qual'] = (v.qualifiers || []).join(',');
      }
    });

    var rows = Object.keys(bySite).map(function (k) { return bySite[k]; });
    return { rows: rows, quality: quality };
  }

  // ---------- stat RDB parsing ----------
  // RDB: '#' comments, a header line, then a column-format line (5s, 3n, ...)
  // that must be skipped before the data rows.
  function parseRdb(text) {
    var lines = text.split('\n').filter(function (l) {
      return l && l.charAt(0) !== '#';
    });
    if (lines.length < 3) return [];
    var cols = lines[0].split('\t');
    return lines.slice(2).map(function (l) {
      var parts = l.split('\t');
      var row = {};
      cols.forEach(function (c, i) { row[c] = parts[i]; });
      return row;
    });
  }

  var PCT_ANCHORS = [
    [5, 'p05_va'], [10, 'p10_va'], [20, 'p20_va'], [25, 'p25_va'], [50, 'p50_va'],
    [75, 'p75_va'], [80, 'p80_va'], [90, 'p90_va'], [95, 'p95_va']
  ];

  // Full-year table for one site: dayStats['M-D'] -> percentile row (numbers).
  function statsToYear(rdbRows, siteNo) {
    var year = {};
    rdbRows.forEach(function (r) {
      if (r.site_no !== siteNo || r.parameter_cd !== '00060') return;
      var key = parseInt(r.month_nu, 10) + '-' + parseInt(r.day_nu, 10);
      var row = { beginYr: parseInt(r.begin_yr, 10), endYr: parseInt(r.end_yr, 10), count: parseInt(r.count_nu, 10) };
      ['min_va', 'max_va', 'mean_va', 'p05_va', 'p10_va', 'p20_va', 'p25_va',
        'p50_va', 'p75_va', 'p80_va', 'p90_va', 'p95_va'].forEach(function (c) {
          row[c] = num(r[c]);
        });
      row.maxYr = parseInt(r.max_va_yr, 10) || null;
      row.minYr = parseInt(r.min_va_yr, 10) || null;
      year[key] = row;
    });
    return year;
  }

  // All sites in a batch, today's calendar day only (for the map).
  function statsToDay(rdbRows, monthDayKey) {
    var out = {};
    rdbRows.forEach(function (r) {
      if (r.parameter_cd !== '00060') return;
      var key = parseInt(r.month_nu, 10) + '-' + parseInt(r.day_nu, 10);
      if (key !== monthDayKey) return;
      var row = { count: parseInt(r.count_nu, 10) };
      PCT_ANCHORS.forEach(function (a) { row[a[1]] = num(r[a[1]]); });
      out[r.site_no] = row;
    });
    return out;
  }

  function monthDayKey(d) { return (d.getMonth() + 1) + '-' + d.getDate(); }

  // Piecewise-linear percentile of value against a day's anchor row.
  // Returns {pct, clampedLow, clampedHigh} or null if the row lacks anchors.
  function percentileOf(value, dayRow) {
    if (value === null || !dayRow) return null;
    var pts = [];
    PCT_ANCHORS.forEach(function (a) {
      if (dayRow[a[1]] !== null && dayRow[a[1]] !== undefined) pts.push([a[0], dayRow[a[1]]]);
    });
    if (pts.length < 2) return null;
    if (value <= pts[0][1]) return { pct: pts[0][0], clampedLow: true, clampedHigh: false };
    var last = pts[pts.length - 1];
    if (value >= last[1]) return { pct: last[0], clampedLow: false, clampedHigh: true };
    for (var i = 1; i < pts.length; i++) {
      var lo = pts[i - 1], hi = pts[i];
      if (value <= hi[1]) {
        var frac = hi[1] === lo[1] ? 0 : (value - lo[1]) / (hi[1] - lo[1]);
        return { pct: lo[0] + frac * (hi[0] - lo[0]), clampedLow: false, clampedHigh: false };
      }
    }
    return null;
  }

  // WaterWatch-style flow classes. Diverging: warm is dry, gray is normal, cool is wet.
  var CLASSES = [
    { key: 'muchbelow', label: 'Much below normal', test: function (p) { return p < 10; }, color: '#E36A6A' },
    { key: 'below', label: 'Below normal', test: function (p) { return p < 25; }, color: '#F8A44C' },
    { key: 'normal', label: 'Normal', test: function (p) { return p <= 75; }, color: '#8B95A8' },
    { key: 'above', label: 'Above normal', test: function (p) { return p <= 90; }, color: '#45C8E8' },
    { key: 'muchabove', label: 'Much above normal', test: function () { return true; }, color: '#6B7CF8' }
  ];

  function classOf(pct) {
    for (var i = 0; i < CLASSES.length; i++) {
      if (CLASSES[i].test(pct)) return CLASSES[i];
    }
    return null;
  }

  function ordinal(n) {
    n = Math.round(n);
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  // ---------- data dictionaries ----------
  var PARAM_DICTIONARY = [
    { field: '00060', plain: 'Streamflow (discharge), cubic feet per second. 179 Utah sites.', used: 'Yes, everywhere' },
    { field: '00065', plain: 'Gage height, feet above a local datum. Not comparable across sites; one Colorado River gage reports 3,568 ft because its datum is sea level.', used: 'Table only' },
    { field: '00010', plain: 'Water temperature, degrees C. 30 sites.', used: 'Table only' },
    { field: '62614', plain: 'Lake surface elevation above NGVD 1929, feet. How the Great Salt Lake is measured.', used: 'Yes, GSL card' },
    { field: '00045', plain: 'Precipitation, inches. 30 sites.', used: 'No' },
    { field: '72019', plain: 'Depth to groundwater, feet below land surface. 30 wells.', used: 'No' },
    { field: '00095', plain: 'Specific conductance, a salinity proxy. The Great Salt Lake has hit 187,000 uS/cm, roughly triple seawater. Real, not an error.', used: 'No' },
    { field: '63680', plain: 'Turbidity, FNU. The Virgin River has hit 3,960 during flash floods. Also real.', used: 'No' },
    { field: '00300 / 00400', plain: 'Dissolved oxygen and pH at a handful of water-quality sites.', used: 'No' },
    { field: 'weather set', plain: 'Air temp, wind, humidity, barometric pressure, solar radiation at gage weather stations.', used: 'No' }
  ];

  var QUALIFIER_DICTIONARY = [
    { field: 'P', plain: 'Provisional. Subject to revision; most live readings carry this.', used: 'Shown per row' },
    { field: 'A', plain: 'Approved for publication.', used: 'Shown per row' },
    { field: 'e', plain: 'Estimated value.', used: 'Shown per row' },
    { field: 'Dis', plain: 'Data collection discontinued at this series.', used: 'Filtered by freshness' },
    { field: 'Fld / Dry', plain: 'Site flooded, or dry with no flow to measure.', used: 'Shown per row' },
    { field: 'Eqp', plain: 'Equipment malfunction. Value untrustworthy.', used: 'Shown per row' },
    { field: 'Rat', plain: 'Rating (stage-to-flow curve) still being developed.', used: 'Shown per row' },
    { field: 'Bkw', plain: 'Backwater from ice or debris distorting the reading.', used: 'Shown per row' }
  ];

  var STAT_DICTIONARY = [
    { field: 'month_nu, day_nu', plain: 'Calendar day the row summarizes. 366 rows per site; Feb 29 has about a quarter of the years the other days have.', used: 'Yes' },
    { field: 'begin_yr, end_yr, count_nu', plain: 'Period of record and number of years behind this day. Shown as "n years" wherever a percentile appears.', used: 'Yes' },
    { field: 'p05_va ... p95_va', plain: 'Flow percentiles for this calendar day across all years on record.', used: 'Yes, the whole point' },
    { field: 'mean_va, min_va, max_va', plain: 'Mean, record low, record high for this day, with min_va_yr and max_va_yr naming the years.', used: 'Envelope chart' },
    { field: 'loc_web_ds, ts_id', plain: 'Internal series identifiers.', used: 'No' }
  ];

  global.USGS = {
    IV_TTL_MS: IV_TTL_MS, STAT_TTL_MS: STAT_TTL_MS, DV_TTL_MS: DV_TTL_MS, FRESH_MS: FRESH_MS,
    MARQUEE: MARQUEE, GSL_SITE: GSL_SITE,
    GSL_HEALTHY_FLOOR: GSL_HEALTHY_FLOOR, GSL_RECORD_LOW: GSL_RECORD_LOW,
    ivStatewideUrl: ivStatewideUrl, statDailyUrl: statDailyUrl, dvUrl: dvUrl,
    decodeEntities: decodeEntities, num: num,
    condenseIv: condenseIv, parseRdb: parseRdb,
    statsToYear: statsToYear, statsToDay: statsToDay, monthDayKey: monthDayKey,
    percentileOf: percentileOf, classOf: classOf, CLASSES: CLASSES, ordinal: ordinal,
    PARAM_DICTIONARY: PARAM_DICTIONARY,
    QUALIFIER_DICTIONARY: QUALIFIER_DICTIONARY,
    STAT_DICTIONARY: STAT_DICTIONARY
  };
})(window);
