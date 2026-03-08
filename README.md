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

- **`plugins-data.json`** – Plugin list: name, summary, stars, ghUrl, pypiUrl, latestDate, **cat** (category), **os** (Mac/Linux/Windows compatibility: true / false / "maybe"). The UI reads this file.
- **`scripts/refresh-plugins-data.js`** – Fetches from GitHub search (`topic:pytest-plugin`, by stars), infers category and OS from name+summary, writes `plugins-data.json`. Set `GITHUB_TOKEN` for higher rate limits.
- **`scripts/infer-metadata.js`** – Re-infers **cat** and **os** from name+summary for existing entries in `plugins-data.json` (e.g. after editing data by hand).
- **`scripts/metadata-inference.js`** – Shared inference rules (used by refresh and infer-metadata).
- **`scripts/generate-plugins-json.js`** – Re-applies inference to current `plugins-data.json` (same effect as infer-metadata).

```bash
node scripts/refresh-plugins-data.js   # full refresh from GitHub
node scripts/infer-metadata.js        # re-infer categories and OS only
```

## CI

- **Refresh:** `.github/workflows/refresh-plugins.yml` runs on a daily schedule and on `workflow_dispatch`. It runs `refresh-plugins-data.js` and commits `plugins-data.json` if it changed.
- **Deploy:** `.github/workflows/deploy.yml` runs on push to `main` (and manually). It copies `index.html` and `plugins-data.json` into `_site/` and deploys to GitHub Pages.

## License

MIT (see [LICENSE](LICENSE)).
