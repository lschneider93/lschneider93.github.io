// openFDA drug adverse-event reports (FAERS). Count queries only; we never
// download individual reports. Keyless: 240 req/min, 1000 req/day per IP.
// FAERS caveat (shown in the UI): reports are unverified and counts != incidence.
(function (global) {
  'use strict';

  var BASE = 'https://api.fda.gov/drug/event.json';
  var TTL_MS = 24 * 60 * 60 * 1000; // 24h per-drug cache

  function drugSearch(drug) {
    // generic_name is upper-cased in openFDA; exact phrase match.
    // Strip quotes/backslashes so input can't escape the phrase query.
    return 'patient.drug.openfda.generic_name:"' + drug.toUpperCase().replace(/["\\]/g, '') + '"';
  }

  function yyyymmdd(d) {
    return d.toISOString().slice(0, 10).replace(/-/g, '');
  }

  function topReactionsUrl(drug) {
    return BASE + '?search=' + encodeURIComponent(drugSearch(drug)) +
      '&count=patient.reaction.reactionmeddrapt.exact&limit=12';
  }

  function overTimeUrl(drug) {
    // count=receivedate returns at most 1000 day-buckets, so keep the range
    // under ~2.7 years or the series silently truncates. Trailing 2 years.
    var end = new Date();
    var start = new Date(end.getTime() - 730 * 24 * 60 * 60 * 1000);
    return BASE + '?search=' + encodeURIComponent(
      drugSearch(drug) + ' AND receivedate:[' + yyyymmdd(start) + ' TO ' + yyyymmdd(end) + ']'
    ) + '&count=receivedate';
  }

  function seriousUrl(drug) {
    return BASE + '?search=' + encodeURIComponent(drugSearch(drug)) + '&count=serious';
  }

  // count=receivedate returns daily {time:"YYYYMMDD",count}; aggregate to months
  function toMonthly(results) {
    var byMonth = {};
    (results || []).forEach(function (r) {
      var t = String(r.time || '');
      if (t.length < 6) return;
      var key = t.slice(0, 4) + '-' + t.slice(4, 6);
      byMonth[key] = (byMonth[key] || 0) + (r.count || 0);
    });
    var months = Object.keys(byMonth).sort();
    return { months: months, counts: months.map(function (m) { return byMonth[m]; }) };
  }

  function toReactions(results) {
    var items = (results || []).slice(0, 12);
    return {
      labels: items.map(function (r) {
        var t = String(r.term || '').toLowerCase();
        return t.charAt(0).toUpperCase() + t.slice(1);
      }),
      counts: items.map(function (r) { return r.count || 0; })
    };
  }

  // count=serious returns terms 1 (serious) and 2 (non-serious)
  function toSerious(results) {
    var out = { serious: 0, nonSerious: 0 };
    (results || []).forEach(function (r) {
      if (String(r.term) === '1') out.serious = r.count || 0;
      if (String(r.term) === '2') out.nonSerious = r.count || 0;
    });
    return out;
  }

  global.OpenFDA = {
    TTL_MS: TTL_MS,
    topReactionsUrl: topReactionsUrl,
    overTimeUrl: overTimeUrl,
    seriousUrl: seriousUrl,
    toMonthly: toMonthly,
    toReactions: toReactions,
    toSerious: toSerious,
    COMMON_DRUGS: [
      'Metformin', 'Atorvastatin', 'Ibuprofen', 'Acetaminophen', 'Lisinopril',
      'Amlodipine', 'Omeprazole', 'Sertraline', 'Levothyroxine', 'Gabapentin',
      'Semaglutide', 'Adalimumab', 'Apixaban', 'Warfarin', 'Prednisone'
    ]
  };
})(window);
