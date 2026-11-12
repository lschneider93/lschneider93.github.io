// Shared site shell: one nav and one footer for every page, theme toggle,
// mobile menu, and theme helpers for charts.
(function () {
  'use strict';

  // Site root, worked out from this script's own URL so it is right on
  // /projects/* pages and on a local file server alike.
  var me = document.currentScript || document.querySelector('script[src*="js/site.js"]');
  var ROOT = new URL('..', me.src).href;
  function u(path) { return ROOT + path; }

  var PROJECTS = [
    ['projects/cancer-research.html', 'Cancer research statistics'],
    ['projects/pickleball.html', 'Pickleball analytics'],
    ['projects/rsnodas.html', 'Utah snowpack (thesis)'],
    ['water.html', 'Utah water dashboard'],
    ['citibike.html', 'Citi Bike dashboard'],
    ['dashboard.html', 'Public health dashboard']
  ];

  var here = location.href.split('#')[0].split('?')[0];
  function current(path) {
    var target = u(path);
    return here === target || (path === 'index.html' && here === ROOT) ? ' aria-current="page"' : '';
  }

  var SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></svg>';
  var MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>';

  function navHTML() {
    return '<div class="nav-inner">' +
      '<a class="logo" href="' + u('index.html') + '">logan<span>.</span>schneider</a>' +
      '<div class="nav-right">' +
      '<ul class="nav-links" id="nav-menu">' +
        '<li class="nav-item-dd">' +
          '<button class="nav-dd-toggle" aria-expanded="false" aria-haspopup="true" aria-controls="projects-menu">Work</button>' +
          '<ul class="nav-dd" id="projects-menu">' +
            '<li><a href="' + u('index.html#projects') + '">All work</a></li>' +
            PROJECTS.map(function (p) {
              return '<li><a href="' + u(p[0]) + '"' + current(p[0]) + '>' + p[1] + '</a></li>';
            }).join('') +
          '</ul>' +
        '</li>' +
        '<li><a href="' + u('lab.html') + '"' + current('lab.html') + '>Stats Lab</a></li>' +
        '<li><a href="' + u('playground.html') + '"' + current('playground.html') + '>Playground</a></li>' +
        '<li><a href="' + u('index.html#about') + '">About</a></li>' +
        '<li><a href="' + u('resume.pdf') + '" target="_blank" rel="noopener">Resume</a></li>' +
        '<li><a href="' + u('index.html#contact') + '">Contact</a></li>' +
      '</ul>' +
      '<button class="theme-toggle" type="button"></button>' +
      '<button class="nav-toggle" aria-expanded="false" aria-controls="nav-menu" aria-label="Menu">☰</button>' +
      '</div></div>';
  }

  function footHTML() {
    return '<div class="container">' +
      '<div class="foot-links">' +
        '<a href="' + u('index.html') + '">Home</a>' +
        '<a href="' + u('index.html#projects') + '">Work</a>' +
        '<a href="' + u('lab.html') + '">Stats Lab</a>' +
        '<a href="' + u('playground.html') + '">Playground</a>' +
        '<a href="' + u('resume.pdf') + '" target="_blank" rel="noopener">Resume</a>' +
        '<a href="https://github.com/lschneider93" target="_blank" rel="noopener">GitHub</a>' +
        '<a href="https://www.linkedin.com/in/logan-schneider-a2a740b6/" target="_blank" rel="noopener">LinkedIn</a>' +
      '</div>' +
      '<p>© ' + new Date().getFullYear() + ' Logan Schneider · <a href="https://github.com/lschneider93/lschneider93.github.io" target="_blank" rel="noopener">Built by hand</a> with HTML, CSS, and vanilla JS.</p>' +
      '</div>';
  }

  // ---- theme ----
  var root = document.documentElement;
  function theme() { return root.getAttribute('data-theme') === 'light' ? 'light' : 'dark'; }
  function cssVar(name) { return getComputedStyle(root).getPropertyValue(name).trim(); }

  function paintToggle(btn) {
    var t = theme();
    btn.innerHTML = (t === 'dark' ? SUN : MOON) + '<span class="tt-label">' + (t === 'dark' ? 'Light' : 'Dark') + '</span>';
    btn.setAttribute('aria-label', 'Switch to ' + (t === 'dark' ? 'light' : 'dark') + ' theme');
  }

  function setTheme(t) {
    if (t === 'light') root.setAttribute('data-theme', 'light'); else root.removeAttribute('data-theme');
    try { localStorage.setItem('theme', t); } catch (e) { /* private mode */ }
    document.querySelectorAll('.theme-toggle').forEach(paintToggle);
    // Plotly charts bake their colors in at draw time; data is cached, so a reload is quick.
    if (document.querySelector('.js-plotly-plot')) { location.reload(); return; }
    document.dispatchEvent(new CustomEvent('themechange', { detail: { theme: t } }));
  }

  window.Site = { theme: theme, cssVar: cssVar, root: ROOT, setTheme: setTheme };

  // ---- build shell ----
  function build() {
    var nav = document.querySelector('nav.site-nav');
    if (!nav) {
      nav = document.createElement('nav');
      nav.className = 'site-nav';
      nav.setAttribute('aria-label', 'Main');
      document.body.insertBefore(nav, document.body.firstChild);
    }
    nav.innerHTML = navHTML();

    var foot = document.querySelector('body > footer');
    if (!foot) { foot = document.createElement('footer'); document.body.appendChild(foot); }
    foot.innerHTML = footHTML();

    var tbtn = nav.querySelector('.theme-toggle');
    paintToggle(tbtn);
    tbtn.addEventListener('click', function () { setTheme(theme() === 'dark' ? 'light' : 'dark'); });

    var toggle = nav.querySelector('.nav-toggle');
    var menu = nav.querySelector('#nav-menu');
    toggle.addEventListener('click', function () {
      var open = menu.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });
    menu.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') {
        menu.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });

    var ddToggle = nav.querySelector('.nav-dd-toggle');
    var dd = nav.querySelector('.nav-dd');
    function closeDd() { dd.classList.remove('open'); ddToggle.setAttribute('aria-expanded', 'false'); }
    ddToggle.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = dd.classList.toggle('open');
      ddToggle.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', function (e) {
      if (dd.classList.contains('open') && !dd.contains(e.target) && e.target !== ddToggle) closeDd();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && dd.classList.contains('open')) { closeDd(); ddToggle.focus(); }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
