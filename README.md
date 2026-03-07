# pytest/plugins

A browser for the pytest plugin ecosystem — live data from GitHub, filterable by category, Windows compatibility, and pipeline relevance.

**[→ Open the app](https://ckmah.github.io/PytestPluginCatalog/)**

## Features

- **Live data** — scrapes the [`pytest-plugin` GitHub topic](https://github.com/topics/pytest-plugin) on load (~430 repos, sorted by stars)
- **Curated enrichment** — 140 well-known plugins are tagged with category, Windows compatibility, and pipeline relevance
- **12 categories** — Coverage, Performance, Execution, Mocking, I/O, Async, Reporting, Quality, Fixtures, Databases, DevEx, Web
- **Filters** — by category, Windows compat (`WIN ✓` / `WIN ✗` / `WIN ?`), pipeline recommended
- **Sort** — by category, stars, name, or recently updated
- **Search** — live filter by name or description
- **Dark / light mode**
- **Mobile-friendly** — add to home screen on iOS/Android for an app-like experience

## Add to home screen (mobile)

**Android (Chrome):** Menu → *Add to Home screen*  
**iOS (Safari):** Share → *Add to Home Screen*

## How it works

The app is a single self-contained HTML file. On load it fetches the GitHub topic page via the [allorigins](https://allorigins.win) CORS proxy, parses repo names, descriptions, and star counts, then enriches known plugins with curated metadata baked into the JS.

The `KNOWLEDGE` object in the source maps ~140 plugin names to:
- `cat` — category
- `pipeline` — whether it's recommended for pipeline/library development
- `win` — Windows compatibility (`true` / `false` / `"maybe"`)

Plugins not in `KNOWLEDGE` appear in the **Other** category with `WIN ?`.

## Development

Just edit `index.html` — it's a single file with no build step.

To add or correct a plugin's metadata, find the `KNOWLEDGE` object and add/update an entry:

```js
"pytest-myplugin": { cat: "mocking", pipeline: true, win: true },
```

Categories: `coverage` · `performance` · `execution` · `mocking` · `io` · `async` · `reporting` · `quality` · `fixtures` · `db` · `devex` · `web`

## License

MIT
