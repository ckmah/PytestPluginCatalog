#!/usr/bin/env node
'use strict';
const url = 'https://api.github.com/search/repositories?q=topic:pytest-plugin&sort=stars&order=desc&per_page=20&page=1';
async function main() {
  const r = await fetch(url, { headers: { Accept: 'application/vnd.github.v3+json' } });
  if (!r.ok) {
    console.error('FAIL:', r.status, r.statusText);
    const t = await r.text();
    if (t) console.error(t.slice(0, 500));
    process.exit(1);
  }
  const data = await r.json();
  const items = data.items;
  if (!Array.isArray(items) || items.length === 0) {
    console.error('FAIL: no items');
    process.exit(1);
  }
  console.log('OK: total_count=', data.total_count, 'items=', items.length);
  console.log('sample:', items[0].full_name, items[0].stargazers_count, 'stars');
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
