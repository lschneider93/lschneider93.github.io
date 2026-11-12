// Homepage only: project filter chips and the skills-by-project matrix.
(function () {
  'use strict';

  // ---- filter chips ----
  var bar = document.getElementById('work-filters');
  var cards = Array.prototype.slice.call(document.querySelectorAll('.work-card[data-cat]'));
  if (bar && cards.length) {
    var chips = Array.prototype.slice.call(bar.querySelectorAll('.filter-chip'));
    chips.forEach(function (chip) {
      var f = chip.getAttribute('data-filter');
      var n = f === 'all' ? cards.length : cards.filter(function (c) {
        return c.getAttribute('data-cat').split(' ').indexOf(f) !== -1;
      }).length;
      chip.querySelector('.count').textContent = n;
      chip.addEventListener('click', function () {
        chips.forEach(function (c) { c.setAttribute('aria-pressed', String(c === chip)); });
        cards.forEach(function (c) {
          c.hidden = !(f === 'all' || c.getAttribute('data-cat').split(' ').indexOf(f) !== -1);
        });
      });
    });
  }

  // ---- skills by project matrix ----
  var table = document.getElementById('skill-matrix');
  if (!table) return;
  var P = [
    ['cancer', 'Cancer research', 'projects/cancer-research.html'],
    ['pickle', 'Pickleball analytics', 'projects/pickleball.html'],
    ['snow', 'Utah snowpack', 'projects/rsnodas.html'],
    ['water', 'Water dashboard', 'water.html'],
    ['bike', 'Citi Bike', 'citibike.html'],
    ['lab', 'Stats Lab', 'lab.html']
  ];
  var ROWS = [
    ['Statistics'],
    ['Survival analysis', 'cancer lab'],
    ['Logistic regression', 'cancer lab'],
    ['Mixed-effects models', 'cancer'],
    ['Power and sample size', 'cancer lab'],
    ['Spatial modeling', 'snow'],
    ['Machine learning'],
    ['Computer vision', 'pickle'],
    ['Model evaluation', 'pickle snow lab'],
    ['Cross-validation', 'pickle snow'],
    ['Data work'],
    ['Data quality checks', 'cancer pickle water bike'],
    ['Data pipelines', 'cancer pickle bike'],
    ['Dashboards and charts', 'cancer pickle water bike lab'],
    ['Tools'],
    ['R', 'cancer snow'],
    ['Python', 'pickle bike'],
    ['SQL', 'bike'],
    ['JavaScript', 'water bike lab']
  ];
  var html = '<thead><tr><th scope="col"><span class="sr-only">Skill</span></th>' + P.map(function (p) {
    return '<th scope="col"><a href="' + p[2] + '">' + p[1] + '</a></th>';
  }).join('') + '</tr></thead><tbody>';
  ROWS.forEach(function (r) {
    if (r.length === 1) {
      html += '<tr class="group"><th colspan="' + (P.length + 1) + '" scope="colgroup">' + r[0] + '</th></tr>';
      return;
    }
    var has = r[1].split(' ');
    html += '<tr><th scope="row">' + r[0] + '</th>' + P.map(function (p) {
      return has.indexOf(p[0]) === -1 ? '<td></td>'
        : '<td><a class="dot" href="' + p[2] + '" title="' + r[0] + ': ' + p[1] + '" aria-label="' + r[0] + ', shown in ' + p[1] + '">✓</a></td>';
    }).join('') + '</tr>';
  });
  table.innerHTML = html + '</tbody>';
})();
