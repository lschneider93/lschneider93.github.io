# lschneider93.github.io

Personal portfolio of **Logan Schneider**, data scientist and biostatistician.

**Live site:** https://lschneider93.github.io

## What's here

- `index.html`: the main portfolio page with projects, experience, skills, and contact
- `dashboard.html`: a public-health dashboard (work in progress) that fetches CDC respiratory-illness data and openFDA drug adverse-event data client-side, with no backend
- `projects/`: long-form project pages (e.g., pickleball analytics)
- `css/`, `js/`: shared styles and vanilla JavaScript (nav, dashboard fetch/cache/render)
- `assets/`: images and demo videos
- `resume.pdf`: current resume (generated from `resume-src.html`)

## Tech notes

Hand-built HTML, CSS, and vanilla JavaScript. No framework, no build step. Hosted on GitHub Pages (`.nojekyll`; Jekyll disabled). The dashboard talks directly to two public APIs from the browser:

- CDC NSSP emergency-department visit trajectories (Socrata): `data.cdc.gov/resource/rdmq-nq56.json`
- openFDA drug adverse events: `api.fda.gov/drug/event.json`

Responses are cached in `localStorage` with a TTL to keep API usage polite.

## Local preview

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## About the work

Projects on the site link to their own repositories, each with its own README and analysis. I use AI-assisted development tools as part of my workflow and validate the results with measured evaluations.
