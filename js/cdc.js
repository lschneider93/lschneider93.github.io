// CDC NSSP emergency-department visit data (Socrata dataset rdmq-nq56).
// Percent of ED visits attributed to COVID-19, influenza, and RSV, weekly by state.
// All numeric fields arrive as strings — parseFloat everything.
(function (global) {
  'use strict';

  var BASE = 'https://data.cdc.gov/resource/rdmq-nq56.json';
  var TTL_MS = 12 * 60 * 60 * 1000; // weekly data; 12h cache is plenty

  function trendUrl(geography) {
    var params = new URLSearchParams({
      geography: geography,
      county: 'All',
      '$select': 'week_end,geography,percent_visits_covid,percent_visits_influenza,percent_visits_rsv,percent_visits_smoothed_covid,percent_visits_smoothed_1,percent_visits_smoothed_rsv',
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
    var params = new URLSearchParams({
      county: 'All',
      week_end: weekEnd,
      '$select': 'week_end,geography,percent_visits_covid,percent_visits_influenza,percent_visits_rsv',
      '$limit': '80'
    });
    return BASE + '?' + params.toString();
  }

  function num(v) {
    var n = parseFloat(v);
    return isNaN(n) ? null : n;
  }

  // The dataset's percent_visits_combined column is null in current data,
  // so "combined" is computed client-side as covid + flu + rsv.
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

  global.CDC = {
    TTL_MS: TTL_MS,
    trendUrl: trendUrl,
    latestWeekUrl: latestWeekUrl,
    mapUrl: mapUrl,
    toSeries: toSeries,
    toChoropleth: toChoropleth,
    STATES: Object.keys(STATE_ABBR)
  };
})(window);
