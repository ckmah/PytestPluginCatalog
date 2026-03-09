# Pytest Plugin Catalog

Browse pytest plugins discovered from GitHub (topic: `pytest-plugin`), with categories, pipeline/Windows support, and links to GitHub and PyPI.

**Live site:** [GitHub Pages](https://clarencemah.github.io/PytestPluginCatalog/) (or your repo’s Pages URL).

## Run locally

Open `index.html` in a browser. The page fetches `plugins-data.json` from the same origin, so use a local server if needed:

```powershell
# Python
python3 -m http.server 8000

# Node (npx)
npx serve .
```

Then visit `http://localhost:8000`.

## Data and scripts

- **`plugins-data.json`** – Plugin list (name, summary, stars, category, ghUrl, pypiUrl, latestDate). The UI reads this file.
- **`scripts/refresh-plugins-data.js`** – Fetches up to 5 pages from GitHub’s search API (`topic:pytest-plugin`, by stars), merges with category “knowledge” embedded in `index.html`, and overwrites `plugins-data.json`. Set `GITHUB_TOKEN` for higher rate limits.
- **`scripts/generate-plugins-json.js`** – Builds `plugins-data.json` from the knowledge block in `index.html` only (no API); entries get placeholder summary/stars/dates.
 - **`scripts/fetch-readmes.js`** – Fetches full READMEs for each plugin in `plugins-data.json` and writes `data/readme-cache.json`. Uses `GITHUB_TOKEN` / `GH_TOKEN` from the environment (or `.env`) to avoid rate limiting.
 - **`scripts/generate-summaries-transformers.js`** – Uses a local `transformers.js` model (default `Xenova/flan-t5-base`) to turn each README into a short “what the plugin does” sentence. Writes `data/summaries-cache.json`.
 - **`scripts/generate-embeddings.py`** – Uses `sentence-transformers` + PCA to encode the summaries into 64‑dimensional vectors, stored in `data/embeddings.json` (used for semantic search in the UI).

```powershell
# Install JS deps (once)
npm install

# Refresh from GitHub (requires a GitHub token for reasonable rate limits)
$env:GITHUB_TOKEN = "<your GitHub token>"
node scripts/refresh-plugins-data.js

# (Optional) Generate from index.html knowledge only
node scripts/generate-plugins-json.js

# Fetch full READMEs for each plugin
node scripts/fetch-readmes.js

# Generate short functional summaries with a local transformers.js model
node scripts/generate-summaries-transformers.js

# Generate embeddings from summaries (Python 3.11+ with uv)
uv run scripts/generate-embeddings.py
```

## CI

- **Refresh:** `.github/workflows/refresh-plugins.yml` runs on a daily schedule and on `workflow_dispatch`. It runs `refresh-plugins-data.js` and commits `plugins-data.json` if it changed.
- **Deploy:** `.github/workflows/deploy.yml` runs on push to `main` (and manually). It copies `index.html` and `plugins-data.json` into `_site/` and deploys to GitHub Pages.

## License

MIT (see [LICENSE](LICENSE)).
