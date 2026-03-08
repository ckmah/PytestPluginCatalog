#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { inferCat, inferOS } = require('./metadata-inference.js');

const dataPath = path.join(__dirname, '..', 'plugins-data.json');

let data;
try {
  data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
} catch (e) {
  data = { plugins: [] };
}

const plugins = (data.plugins || []).map((p) => {
  const cat = inferCat(p.name, p.summary || '');
  const os = inferOS(p.name, p.summary || '', p.win);
  const { name, summary, latestDate, ghUrl, pypiUrl, stars } = p;
  return { name, summary, latestDate, ghUrl, pypiUrl, stars, cat, os };
});

fs.writeFileSync(dataPath, JSON.stringify({ plugins }, null, 2), 'utf8');
console.log('Wrote', plugins.length, 'plugins to', dataPath);
