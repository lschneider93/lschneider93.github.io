// Small vanilla sortable-table renderer + missingness helper, shared by both
// dashboard tabs. No innerHTML for data cells; nulls render visibly and sort last.
(function (global) {
  'use strict';

  function isMissing(row, key) {
    return !(key in row) || row[key] === null || row[key] === undefined || row[key] === '';
  }

  // columns: [{key, label, numeric, fmt}] ; fmt(value, row) -> display string.
  // opts.sortable adds th sort buttons (aria-sort on the active th).
  function render(container, opts) {
    var columns = opts.columns;
    var rows = opts.rows.slice();
    var sort = { key: null, dir: 1 };

    container.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    var table = document.createElement('table');
    table.className = 'data';
    var thead = document.createElement('thead');
    var headRow = document.createElement('tr');
    var ths = {};

    columns.forEach(function (col) {
      var th = document.createElement('th');
      if (col.numeric) th.className = 'num';
      if (opts.sortable) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'th-sort';
        btn.textContent = col.label;
        btn.addEventListener('click', function () {
          if (sort.key === col.key) sort.dir = -sort.dir;
          else { sort.key = col.key; sort.dir = col.numeric ? -1 : 1; }
          applySort();
          renderBody();
          updateAria();
        });
        th.appendChild(btn);
      } else {
        th.textContent = col.label;
      }
      ths[col.key] = th;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    table.appendChild(tbody);
    wrap.appendChild(table);
    container.appendChild(wrap);

    function applySort() {
      var col = null;
      columns.forEach(function (c) { if (c.key === sort.key) col = c; });
      if (!col) return;
      rows.sort(function (a, b) {
        var am = isMissing(a, col.key), bm = isMissing(b, col.key);
        if (am && bm) return 0;
        if (am) return 1; // nulls always last
        if (bm) return -1;
        var av = a[col.key], bv = b[col.key];
        if (col.numeric) { av = parseFloat(av); bv = parseFloat(bv); }
        if (av < bv) return -sort.dir;
        if (av > bv) return sort.dir;
        return 0;
      });
    }

    function updateAria() {
      columns.forEach(function (c) {
        var th = ths[c.key];
        if (c.key === sort.key) th.setAttribute('aria-sort', sort.dir === 1 ? 'ascending' : 'descending');
        else th.removeAttribute('aria-sort');
      });
    }

    function renderBody() {
      tbody.innerHTML = '';
      rows.forEach(function (row) {
        var tr = document.createElement('tr');
        columns.forEach(function (col) {
          var td = document.createElement('td');
          if (col.numeric) td.className = 'num';
          if (isMissing(row, col.key)) {
            td.className += (td.className ? ' ' : '') + 'null-cell';
            td.textContent = 'null';
          } else {
            td.textContent = col.fmt ? col.fmt(row[col.key], row) : String(row[col.key]);
          }
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
    }

    renderBody();
  }

  // fields: [{key, label}] -> [{key, label, missing, total, pct}]
  function missingRates(rows, fields) {
    return fields.map(function (f) {
      var missing = 0;
      rows.forEach(function (row) { if (isMissing(row, f.key)) missing++; });
      return {
        key: f.key,
        label: f.label,
        missing: missing,
        total: rows.length,
        pct: rows.length ? (100 * missing) / rows.length : 0
      };
    });
  }

  global.Tables = { render: render, missingRates: missingRates, isMissing: isMissing };
})(window);
