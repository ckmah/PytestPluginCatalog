#!/usr/bin/env node
'use strict';
/**
 * fetch-readmes.js — Fetch full READMEs for all plugins and store in data/readme-cache.json.
 *
 * Uses the GitHub Contents API to get each repo's README (decoded from base64).
 * Stores the full README content per plugin.
 *
 * Usage:
 *   GITHUB_TOKEN=ghp_... node scripts/fetch-readmes.js [--force]
 *   # or set GITHUB_TOKEN / GH_TOKEN in .env at repo root
 *
 * Options:
 *   --force   Re-fetch all READMEs, ignoring existing cache entries.
 */

const fs = require('fs');
const path = require('path');

const PLUGINS_DATA = path.join(__dirname, '..', 'plugins-data.json');
const README_CACHE = path.join(__dirname, '..', 'data', 'readme-cache.json');
const DOTENV_PATH = path.join(__dirname, '..', '.env');
const DELAY_MS = 800;
loadDotEnvIfPresent(DOTENV_PATH);
const token = (process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim() || null;

const force = process.argv.includes('--force');

function loadDotEnvIfPresent(dotenvPath) {
  if (!fs.existsSync(dotenvPath)) return;

  const raw = fs.readFileSync(dotenvPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue;

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function ghHeaders() {
  const h = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'PytestPluginCatalog',
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function fullNameFromUrl(ghUrl) {
  // e.g. https://github.com/pytest-dev/pytest-xdist → pytest-dev/pytest-xdist
  const m = ghUrl.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/);
  return m ? m[1] : null;
}

async function fetchReadme(fullName) {
  const url = `https://api.github.com/repos/${fullName}/readme`;
  const r = await fetch(url, { headers: ghHeaders() });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub ${r.status} for ${fullName}: ${await r.text()}`);
  const json = await r.json();
  if (!json.content) return null;
  // Content is base64-encoded
  const raw = Buffer.from(json.content, 'base64').toString('utf8');
  return raw.replace(/\r\n/g, '\n');
}

async function main() {
  if (!token) {
    process.stderr.write(
      'Warning: no GitHub token found in env (GITHUB_TOKEN/GH_TOKEN). Requests will be rate limited.\n'
    );
  }
  const { plugins } = JSON.parse(fs.readFileSync(PLUGINS_DATA, 'utf8'));

  fs.mkdirSync(path.dirname(README_CACHE), { recursive: true });
  let cache = {};
  if (fs.existsSync(README_CACHE)) {
    cache = JSON.parse(fs.readFileSync(README_CACHE, 'utf8'));
  }

  let fetched = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < plugins.length; i++) {
    const plugin = plugins[i];
    const name = plugin.name;

    // Legacy cache entries used `readme_excerpt`; those should be re-fetched once.
    if (!force && cache[name] && Object.prototype.hasOwnProperty.call(cache[name], 'readme')) {
      skipped++;
      continue;
    }

    const fullName = fullNameFromUrl(plugin.ghUrl || '');
    if (!fullName) {
      process.stderr.write(`  [skip] ${name}: no GitHub URL\n`);
      cache[name] = { readme: null, fetched_at: new Date().toISOString() };
      failed++;
      continue;
    }

    process.stderr.write(`[${i + 1}/${plugins.length}] ${fullName}…`);
    try {
      const readme = await fetchReadme(fullName);
      cache[name] = {
        readme,
        fetched_at: new Date().toISOString(),
      };
      process.stderr.write(readme ? ` ok (${readme.length} chars)\n` : ' no readme\n');
      fetched++;
    } catch (err) {
      process.stderr.write(` ERROR: ${err.message}\n`);
      cache[name] = { readme: null, fetched_at: new Date().toISOString() };
      failed++;
    }

    fs.writeFileSync(README_CACHE, JSON.stringify(cache, null, 2), 'utf8');

    if (i < plugins.length - 1 && fetched % 1 === 0) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }

  console.log(`Done. fetched=${fetched} skipped=${skipped} failed=${failed}`);
  console.log(`Cache: ${Object.keys(cache).length} entries → ${README_CACHE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
