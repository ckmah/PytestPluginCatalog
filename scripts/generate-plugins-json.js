#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { inferCat, inferOS } = require('./metadata-inference.js');

const dataPath = path.join(__dirname, '..', 'plugins-data.json');

const html = fs.readFileSync(htmlPath, 'utf8');
// Match each "name": { cat:"...", pipeline:..., win:... } line (optional rank at end)
const re = /^\s*"([^"]+)"\s*:\s*\{\s*cat:\s*"([^"]+)"\s*,\s*pipeline:\s*(true|false)\s*,\s*win:\s*(true|false|"maybe")/gm;
const knowledge = {};
let m;
while ((m = re.exec(html)) !== null) {
  const [, name, cat, pipeline, win] = m;
  knowledge[name] = {
    cat,
    pipeline: pipeline === 'true',
    win: win === '"maybe"' ? 'maybe' : win === 'true',
  };
}

const plugins = Object.keys(knowledge).map((pkgName) => {
  const k = knowledge[pkgName] || {};
  return {
    name: pkgName,
    summary: `pytest plugin: ${pkgName}`,
    latestDate: null,
    ghUrl: `https://pypi.org/project/${pkgName}/`,
    pypiUrl: `https://pypi.org/project/${pkgName}/`,
    stars: 0,
    cat: k.cat || 'other',
  };
});

fs.writeFileSync(dataPath, JSON.stringify({ plugins }, null, 2), 'utf8');
console.log('Wrote', plugins.length, 'plugins to', dataPath);
