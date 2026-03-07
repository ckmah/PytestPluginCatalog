# Pytest Plugin Catalog

Browse pytest plugins discovered from GitHub (topic: `pytest-plugin`), with categories, pipeline/Windows support, and links to GitHub and PyPI.

**Live site:** [GitHub Pages](https://clarencemah.github.io/PytestPluginCatalog/) (or your repo’s Pages URL).

## Run locally

Open `index.html` in a browser. The page fetches `plugins-data.json` from the same origin, so use a local server if needed:

```bash
# Python
python3 -m http.server 8000

# Node (npx)
npx serve .
```

Then visit `http://localhost:8000`.

## Data and scripts

- **`plugins-data.json`** – Plugin list (name, summary, stars, category, pipeline, win, ghUrl, pypiUrl, latestDate). The UI reads this file.
- **`scripts/refresh-plugins-data.js`** – Fetches up to 5 pages from GitHub’s search API (`topic:pytest-plugin`, by stars), merges with category/pipeline/win “knowledge” embedded in `index.html`, and overwrites `plugins-data.json`. Set `GITHUB_TOKEN` for higher rate limits.
- **`scripts/generate-plugins-json.js`** – Builds `plugins-data.json` from the knowledge block in `index.html` only (no API); entries get placeholder summary/stars/dates.

```bash
node scripts/refresh-plugins-data.js   # full refresh from GitHub
node scripts/generate-plugins-json.js   # from index.html knowledge only
```

## CI

- **Refresh:** `.github/workflows/refresh-plugins.yml` runs on a daily schedule and on `workflow_dispatch`. It runs `refresh-plugins-data.js` and commits `plugins-data.json` if it changed.
- **Deploy:** `.github/workflows/deploy.yml` runs on push to `main` (and manually). It copies `index.html` and `plugins-data.json` into `_site/` and deploys to GitHub Pages.

## License

MIT (see [LICENSE](LICENSE)).
