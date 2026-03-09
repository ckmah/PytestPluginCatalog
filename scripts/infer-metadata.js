#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { inferCat, inferOS } = require('./metadata-inference.js');

const dataPath = path.join(__dirname, '..', 'plugins-data.json');

function main() {
  const raw = fs.readFileSync(dataPath, 'utf8');
  const data = JSON.parse(raw);
  const plugins = Array.isArray(data.plugins) ? data.plugins : data;

  const out = plugins.map((p) => {
    const legacyWin = p.win;
    const cat = inferCat(p.name, p.summary || '');
    const os = inferOS(p.name, p.summary || '', legacyWin);
    const { name, summary, latestDate, ghUrl, pypiUrl, stars } = p;
    return { name, summary, latestDate, ghUrl, pypiUrl, stars, cat, os };
  });

  const categories = [...new Set(out.map((p) => p.cat))].sort();
  fs.writeFileSync(dataPath, JSON.stringify({ plugins: out }, null, 2), 'utf8');
  console.log('Wrote', out.length, 'plugins. Categories:', categories.join(', '));
}

main();
