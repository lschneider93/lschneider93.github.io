# lschneider93.github.io

Personal portfolio of **Logan Schneider**, data scientist and biostatistician.

**Live site:** https://lschneider93.github.io

## What's here

- `index.html`: homepage with results at a glance, project cards, a skills-by-project matrix, and contact
- `projects/`: long-form project pages (cancer research statistics, pickleball analytics, Utah snowpack thesis)
- `water.html`, `citibike.html`, `dashboard.html`: dashboards (live USGS water data, a year of Citi Bike trips, CDC and openFDA public health data)
- `lab.html`: Stats Lab, power and sample size calculators that run in the browser (`js/lab/`, checks in `tests/lab.test.html`)
- `playground.html`: Pickleball Playground, serves and returns from a hand-labeled pro match (`data/pickleball/`)
- `css/main.css`: one stylesheet; every color is a semantic token, dark theme by default and light under `[data-theme="light"]`
- `js/site.js`: the shared nav and footer (injected on every page, so they cannot drift), theme toggle
- `js/network.js`: the interactive point-and-link background behind page headers
- `assets/`: images and demo videos
- `resume.pdf`: current resume (generated from `resume-src.html`)

## Tech notes

Hand-built HTML, CSS, and vanilla JavaScript. No framework, no build step. Hosted on GitHub Pages (`.nojekyll`; Jekyll disabled). The dashboards talk directly to public APIs from the browser and cache responses in `localStorage` with a TTL to keep API usage polite:

- USGS water services: `waterservices.usgs.gov/nwis/`
- CDC NSSP emergency-department visit trajectories (Socrata): `data.cdc.gov/resource/rdmq-nq56.json`
- openFDA drug adverse events: `api.fda.gov/drug/event.json`

Chart colors are checked for color blindness and contrast in both themes. Nothing is told apart by color alone.

## Local preview

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## About the work

Projects on the site link to their own repositories, each with its own README and analysis. I use AI-assisted development tools as part of my workflow and validate the results with measured evaluations.

## Deploying

GitHub Pages caches `css/main.css` and media for ten minutes. When the stylesheet or a video changes, bump the `?v=` query string on the `<link>`, `<img>`, and `<source>` tags so browsers fetch the new file with the new HTML.
