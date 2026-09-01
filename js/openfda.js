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
    // 20 fetched: the chart shows the top 12, the transparency table all 20.
    return BASE + '?search=' + encodeURIComponent(drugSearch(drug)) +
      '&count=patient.reaction.reactionmeddrapt.exact&limit=20';
  }

  function outcomeUrl(drug) {
    return BASE + '?search=' + encodeURIComponent(drugSearch(drug)) +
      '&count=patient.reaction.reactionoutcome';
  }

  function qualificationUrl(drug) {
    return BASE + '?search=' + encodeURIComponent(drugSearch(drug)) +
      '&count=primarysource.qualification';
  }

  // Six flags explaining WHY a report is serious. Each is its own count query
  // (single-bucket responses); one report can set several flags at once.
  var SERIOUSNESS_FIELDS = [
    { field: 'seriousnessdeath', label: 'Death' },
    { field: 'seriousnesshospitalization', label: 'Hospitalization' },
    { field: 'seriousnesslifethreatening', label: 'Life-threatening' },
    { field: 'seriousnessdisabling', label: 'Disability' },
    { field: 'seriousnesscongenitalanomali', label: 'Congenital anomaly' },
    { field: 'seriousnessother', label: 'Other serious' }
  ];

  function seriousnessUrls(drug) {
    return SERIOUSNESS_FIELDS.map(function (f) {
      return BASE + '?search=' + encodeURIComponent(drugSearch(drug)) +
        '&count=' + f.field;
    });
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

  // count=receivedate returns daily {time:"YYYYMMDD",count}; aggregate to months.
  // FAERS publishes quarterly with a 2-3 month lag, so the partial current
  // month and any trailing empty months are trimmed: without this the right
  // edge of the chart fakes a decline that is really just unpublished data.
  function toMonthly(results) {
    var byMonth = {};
    (results || []).forEach(function (r) {
      var t = String(r.time || '');
      if (t.length < 6) return;
      var key = t.slice(0, 4) + '-' + t.slice(4, 6);
      byMonth[key] = (byMonth[key] || 0) + (r.count || 0);
    });
    var months = Object.keys(byMonth).sort();
    var currentMonth = new Date().toISOString().slice(0, 7);
    while (months.length) {
      var last = months[months.length - 1];
      if (last === currentMonth || !byMonth[last]) months.pop();
      else break;
    }
    return {
      months: months,
      counts: months.map(function (m) { return byMonth[m]; }),
      dataThrough: months.length ? months[months.length - 1] : null
    };
  }

  function titleCase(term) {
    var t = String(term || '').toLowerCase();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  function toReactions(results, limit) {
    var items = (results || []).slice(0, limit || 12);
    return {
      labels: items.map(function (r) { return titleCase(r.term); }),
      counts: items.map(function (r) { return r.count || 0; })
    };
  }

  // Coded values, decoded per the openFDA drug/event field reference.
  var OUTCOME_LABELS = {
    1: 'Recovered', 2: 'Recovering', 3: 'Not recovered',
    4: 'Recovered with lasting effects', 5: 'Fatal', 6: 'Unknown'
  };
  var QUALIFICATION_LABELS = {
    1: 'Physician', 2: 'Pharmacist', 3: 'Other health professional',
    4: 'Lawyer', 5: 'Consumer or non-professional'
  };

  function toCoded(results, labels) {
    var items = (results || []).filter(function (r) { return labels[r.term]; });
    var total = 0;
    items.forEach(function (r) { total += r.count || 0; });
    return {
      labels: items.map(function (r) { return labels[r.term]; }),
      counts: items.map(function (r) { return r.count || 0; }),
      total: total
    };
  }

  function toOutcomes(results) { return toCoded(results, OUTCOME_LABELS); }
  function toQualification(results) { return toCoded(results, QUALIFICATION_LABELS); }

  // Zip the six single-bucket seriousness responses (order matches
  // SERIOUSNESS_FIELDS / seriousnessUrls). A null entry = that fetch failed.
  function toSeriousness(resultsList) {
    var labels = [], counts = [];
    SERIOUSNESS_FIELDS.forEach(function (f, i) {
      var results = resultsList[i];
      if (!results) return;
      var count = 0;
      (results || []).forEach(function (r) { if (String(r.term) === '1') count = r.count || 0; });
      labels.push(f.label);
      counts.push(count);
    });
    return { labels: labels, counts: counts };
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

  // The fields this page queries, plus verified count-queryable fields it
  // deliberately skips. The full drug/event schema has hundreds of fields;
  // the dictionary footer links to the complete reference.
  var DICTIONARY = [
    { field: 'patient.reaction.reactionmeddrapt', plain: 'The reported reaction as a MedDRA preferred term, e.g. "Nausea". One report can list many.', used: 'reactions chart, table' },
    { field: 'receivedate', plain: 'Date FDA first received the report. Counted by day, summed to months here.', used: 'reports-over-time chart' },
    { field: 'serious', plain: '1 if the report meets any seriousness criterion, 2 if not.', used: 'tiles' },
    { field: 'seriousnessdeath', plain: 'Flag: the report involved a death. Not a confirmed cause of death.', used: 'seriousness chart' },
    { field: 'seriousnesshospitalization', plain: 'Flag: hospitalization, new or prolonged.', used: 'seriousness chart' },
    { field: 'seriousnesslifethreatening', plain: 'Flag: judged life-threatening.', used: 'seriousness chart' },
    { field: 'seriousnessdisabling', plain: 'Flag: resulted in disability.', used: 'seriousness chart' },
    { field: 'seriousnesscongenitalanomali', plain: 'Flag: congenital anomaly.', used: 'seriousness chart' },
    { field: 'seriousnessother', plain: 'Flag: serious for another medically important reason.', used: 'seriousness chart' },
    { field: 'patient.reaction.reactionoutcome', plain: 'How each reaction resolved, coded 1-6: recovered, recovering, not recovered, recovered with lasting effects, fatal, unknown.', used: 'outcomes chart' },
    { field: 'primarysource.qualification', plain: 'Who filed the report, coded 1-5: physician, pharmacist, other health professional, lawyer, consumer.', used: 'reporter chart' },
    { field: 'patient.patientsex', plain: 'Patient sex, where reported.', used: 'not used' },
    { field: 'patient.patientagegroup', plain: 'Patient age group, where reported.', used: 'not used' },
    { field: 'patient.drug.drugindication', plain: 'Why the drug was being taken.', used: 'not used' },
    { field: 'occurcountry', plain: 'Country where the event occurred.', used: 'not used' },
    { field: 'reporttype', plain: 'Spontaneous report vs. report from a study.', used: 'not used' }
  ];

  global.OpenFDA = {
    TTL_MS: TTL_MS,
    topReactionsUrl: topReactionsUrl,
    overTimeUrl: overTimeUrl,
    seriousUrl: seriousUrl,
    outcomeUrl: outcomeUrl,
    qualificationUrl: qualificationUrl,
    seriousnessUrls: seriousnessUrls,
    toMonthly: toMonthly,
    toReactions: toReactions,
    toSerious: toSerious,
    toOutcomes: toOutcomes,
    toQualification: toQualification,
    toSeriousness: toSeriousness,
    DICTIONARY: DICTIONARY,
    COMMON_DRUGS: [
      'Metformin', 'Atorvastatin', 'Ibuprofen', 'Acetaminophen', 'Lisinopril',
      'Amlodipine', 'Omeprazole', 'Sertraline', 'Levothyroxine', 'Gabapentin',
      'Semaglutide', 'Adalimumab', 'Apixaban', 'Warfarin', 'Prednisone'
    ]
  };
})(window);
