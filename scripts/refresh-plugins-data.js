#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { inferCat, inferOS } = require('./metadata-inference.js');

const outPath = path.join(__dirname, '..', 'plugins-data.json');
const PAGES = 10;
const PAGE_DELAY_MS = 1200;
const token = process.env.GITHUB_TOKEN;

async function fetchPage(page) {
  const url = `https://api.github.com/search/repositories?q=topic:pytest-plugin&sort=stars&order=desc&per_page=100&page=${page}`;
  const headers = { Accept: 'application/vnd.github.v3+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`api ${r.status}: ${await r.text()}`);
  const json = await r.json();
  if (!json.items || !Array.isArray(json.items)) throw new Error('invalid response');
  return json.items.map((item) => ({
    name: item.name,
    full_name: item.full_name,
    description: item.description || '',
    stars: item.stargazers_count || 0,
    pushed_at: item.pushed_at || null,
    html_url: item.html_url || `https://github.com/${item.full_name}`,
  }));
}

async function main() {
  const allRepos = [];
  for (let p = 1; p <= PAGES; p++) {
    process.stderr.write(`Fetching page ${p}/${PAGES}...\n`);
    const repos = await fetchPage(p);
    if (!repos.length) break;
    allRepos.push(...repos);
    if (p < PAGES) await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
  }

  const seen = new Set();
  const repos = allRepos.filter((r) => {
    const n = r.name.toLowerCase();
    if (seen.has(n)) return false;
    seen.add(n);
    return true;
  });

  const plugins = repos.map((repo) => {
    const pkgName = repo.name.toLowerCase();
    const summary = repo.description || `pytest plugin: ${pkgName}`;
    const cat = inferCat(pkgName, summary);
    const os = inferOS(pkgName, summary, null);
    return {
      name: pkgName,
      summary,
      latestDate: repo.pushed_at || null,
      ghUrl: repo.html_url,
      pypiUrl: `https://pypi.org/project/${pkgName}/`,
      stars: repo.stars || 0,
      cat,
      os,
    };
  });

  fs.writeFileSync(outPath, JSON.stringify({ plugins }, null, 2), 'utf8');
  console.log('Wrote', plugins.length, 'plugins to', outPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
