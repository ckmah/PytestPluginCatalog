#!/usr/bin/env node
'use strict';
/**
 * generate-summaries-transformers.js — Create short "what the plugin does" summaries using transformers.js.
 *
 * Reads full READMEs from data/readme-cache.json, cleans them, processes the entire README
 * by chunking to fit model context, then merges into a single one-sentence functional summary.
 *
 * Output:
 *   data/summaries-cache.json  (name -> { summary, generated_at, readme_fetched_at, readme_len, model })
 *
 * Env:
 *   SUMMARY_MODEL (optional; default: Xenova/flan-t5-small)
 *
 * Usage:
 *   node scripts/generate-summaries-transformers.js [--force] [--limit N]
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const PLUGINS_DATA = path.join(PROJECT_ROOT, 'plugins-data.json');
const README_CACHE = path.join(PROJECT_ROOT, 'data', 'readme-cache.json');
const SUMMARIES_CACHE = path.join(PROJECT_ROOT, 'data', 'summaries-cache.json');

const force = process.argv.includes('--force');
const limitIdx = process.argv.indexOf('--limit');
const limit = limitIdx !== -1 ? Number(process.argv[limitIdx + 1]) : null;
const onlyIdx = process.argv.indexOf('--only');
const only = onlyIdx !== -1 ? String(process.argv[onlyIdx + 1] || '').trim() : null;

const model = (process.env.SUMMARY_MODEL || 'Xenova/flan-t5-small').trim();
const device = (process.env.SUMMARY_DEVICE || 'webgpu').trim().toLowerCase();
const dtype =
  (process.env.SUMMARY_DTYPE || (device === 'webgpu' ? 'fp16' : 'q8')).trim().toLowerCase();
const MAX_MODEL_INPUT_CHARS = Number(process.env.SUMMARY_MAX_CHARS || 6000);

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8');
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function cleanupReadme(raw) {
  let s = String(raw || '');
  s = s.replace(/\r\n/g, '\n');

  // Remove code blocks (markdown fenced + indented)
  s = s.replace(/```[\s\S]*?```/g, '\n');
  s = s.replace(/^(?: {4}|\t).+$/gm, '');

  // Drop reST images + their option lines
  s = s.replace(/^\s*\.\.\s*image::.*$/gm, '');
  s = s.replace(/^\s*:\w+:\s*.*$/gm, '');

  // Markdown images and badge links
  s = s.replace(/\[!\[[^\]]*]\([^)]*\)\]\([^)]*\)/g, '');
  s = s.replace(/!\[[^\]]*]\([^)]*\)/g, '');

  // HTML tags
  s = s.replace(/<[^>]+>/g, '');

  // Links to plain text
  s = s.replace(/\[([^\]]+)]\(([^)]+)\)/g, '$1');
  s = s.replace(/`([^`<]+)\s*<[^>]+>`_?/g, '$1');
  // reST inline references: `text`_ -> text
  s = s.replace(/`([^`]+)`_?/g, '$1');
  // reST reference suffix: Word_ -> Word
  s = s.replace(/\b([A-Za-z][A-Za-z0-9-]+)_\b/g, '$1');

  // Remove raw URLs
  s = s.replace(/\bhttps?:\/\/\S+\b/g, '');

  // Collapse whitespace
  s = s.replace(/[ \t]+\n/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  s = s.trim();
  return s;
}

const META_WORDS = [
  'installation',
  'install',
  'pip install',
  'usage',
  'quickstart',
  'getting started',
  'documentation',
  'docs',
  'contributing',
  'contribute',
  'license',
  'changelog',
  'release',
  'security',
  'support',
  'sponsors',
  'donate',
];

function looksLikeMetaParagraph(p) {
  const t = p.toLowerCase();
  if (!t) return true;
  if (t.length < 25) return true;
  if (META_WORDS.some((w) => t.includes(w))) return true;
  const letters = (t.match(/[a-z]/g) || []).length;
  if (letters / Math.max(1, t.length) < 0.45) return true;
  return false;
}

function looksLikeCodeishParagraph(p) {
  const t = p.toLowerCase();
  if (!t) return true;
  if (/\b(def|class|import|from)\b/.test(t)) return true;
  if (/\bpytest\.|@pytest\b/.test(t)) return true;
  if (/\b(pip|uv|poetry|conda|brew)\b/.test(t) && /\binstall\b/.test(t)) return true;
  if (/\b\w+\.py\b/.test(t)) return true;
  if (/[{}[\];<>]/.test(p)) return true;
  return false;
}

function splitParagraphs(s) {
  return s
    .split(/\n\s*\n+/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function buildCappedText(paras, maxChars) {
  if (!Array.isArray(paras) || !paras.length) return '';
  const out = [];
  let total = 0;
  for (const p of paras) {
    const add = (out.length ? 2 : 0) + p.length; // +2 for joining "\n\n"
    if (total + add > maxChars) break;
    out.push(p);
    total += add;
  }
  return (out.length ? out : paras).join('\n\n');
}

function pickFunctionalParagraph(paras, name) {
  const lowerName = String(name || '').toLowerCase();
  const scored = paras.map((p) => {
    const t = p.toLowerCase();
    let score = 0;
    if (t.includes('pytest')) score += 3;
    if (t.includes('plugin')) score += 2;
    if (lowerName && t.includes(lowerName)) score += 1;
    if (/\b(extends|adds|provides|allows|enables|supports)\b/.test(t)) score += 2;
    if (looksLikeMetaParagraph(p)) score -= 3;
    if (looksLikeCodeishParagraph(p)) score -= 2;
    return { p, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return (scored[0] && scored[0].score > 0 ? scored[0].p : null) || paras[0] || null;
}

function normalizeOneSentence(s) {
  if (!s) return null;
  let t = String(s).replace(/\s+/g, ' ').trim();
  if (!t) return null;

  t = t.replace(/^[-*]\s+/, '').trim();

  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    t = t.slice(1, -1).trim();
  }

  // Keep first sentence if the model returns multiple.
  const m = t.match(/^(.*?[.!?])\s+/);
  if (m) t = m[1].trim();

  if (!t) return null;
  if (t.toLowerCase() === 'null') return null;
  if (/\b(task|candidates|readme excerpt|one-sentence|functional summary)\b/i.test(t)) return null;

  // Reject obvious junk (filenames, commands, or extreme repetition).
  if (/\b\w+\.py\b/i.test(t)) return null;
  const toks = t.split(/\s+/).filter(Boolean);
  if (toks.length >= 8) {
    const uniq = new Set(toks.map((x) => x.toLowerCase()));
    if (uniq.size / toks.length < 0.35) return null;
  }

  // Hard limit, but prefer sentence boundary.
  if (t.length > 220) {
    const cut = t.slice(0, 220);
    const lastStop = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('!'), cut.lastIndexOf('?'));
    t = (lastStop > 80 ? cut.slice(0, lastStop + 1) : cut).trim();
  }

  if (t.length < 10) return null;
  return t;
}

function fallbackFromParagraph(paragraph, name) {
  if (!paragraph) return null;
  let t = String(paragraph).replace(/\s+/g, ' ').trim();
  if (!t) return null;
  // Drop trailing reST "::"
  t = t.replace(/::\s*$/, '').trim();
  // Prefer clause starting with functional verbs
  const m = t.match(/\b(extends|adds|provides|allows|enables|supports)\b[\s\S]*/i);
  if (m) t = m[0];
  if (!/^pytest plugin\b/i.test(t)) {
    t = `Pytest plugin that ${t}`;
  }
  return normalizeOneSentence(t);
}

async function summarizeChunk(summarizer, name, chunk) {
  const prompt =
    `What does the pytest plugin "${name}" do? ` +
    'Answer in one sentence, describing only functionality.\n\n' +
    chunk;

  const out = await summarizer(prompt, {
    max_new_tokens: 64,
    do_sample: false,
  });

  const text = Array.isArray(out) ? out[0]?.generated_text : out?.generated_text;
  return normalizeOneSentence(text);
}

async function mergeSummaries(summarizer, name, summaries) {
  const uniq = Array.from(new Set(summaries.filter(Boolean)));
  if (!uniq.length) return null;

  const prompt =
    `Write one sentence describing what the pytest plugin "${name}" does. ` +
    'Use only the facts in the lines below. If unclear, answer: null\n\n' +
    uniq.map((s) => `- ${s}`).join('\n');

  const out = await summarizer(prompt, {
    max_new_tokens: 64,
    do_sample: false,
  });
  const text = Array.isArray(out) ? out[0]?.generated_text : out?.generated_text;
  return normalizeOneSentence(text);
}

async function main() {
  let plugins = (readJson(PLUGINS_DATA, {}).plugins || []).filter((p) => p && p.name);
  if (only) plugins = plugins.filter((p) => p.name === only);
  const readmes = readJson(README_CACHE, {});
  const existing = readJson(SUMMARIES_CACHE, {});

  const { pipeline, env } = await import('@xenova/transformers');
  env.allowLocalModels = true;
  if (env.backends && env.backends.onnx) {
    try {
      env.backends.onnx.logLevel = 'fatal';
      if (env.backends.onnx.wasm) env.backends.onnx.wasm.logLevel = 'fatal';
      if (env.backends.onnx.webgpu) env.backends.onnx.webgpu.logLevel = 'fatal';
    } catch {
      // Best-effort: some versions/backends may not expose logLevel
    }
  }

  process.stderr.write(`Loading model ${model} on device=${device}, dtype=${dtype}...\n`);
  const summarizer = await pipeline('text2text-generation', model, {
    device,
    dtype,
  });

  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let missing = 0;

  for (const p of plugins) {
    const name = p.name;
    const entry = readmes[name];
    const readme = entry ? (entry.readme ?? entry.readme_excerpt ?? null) : null;
    const fetchedAt = entry ? (entry.fetched_at || null) : null;
    const readmeLen = readme ? String(readme).length : 0;

    const prev = existing[name];
    if (
      !force &&
      prev &&
      prev.summary !== undefined &&
      prev.readme_fetched_at === fetchedAt &&
      prev.readme_len === readmeLen &&
      prev.model === model
    ) {
      skipped++;
      continue;
    }

    processed++;
    if (limit !== null && processed > limit) break;

    if (!readme) {
      existing[name] = {
        summary: null,
        generated_at: nowIso(),
        readme_fetched_at: fetchedAt,
        readme_len: 0,
        model,
      };
      updated++;
      missing++;
      continue;
    }

    process.stderr.write(`[${processed}/${limit ?? plugins.length}] ${name}... `);

    const cleaned = cleanupReadme(readme);
    const parasAll = splitParagraphs(cleaned);
    const cappedText = buildCappedText(parasAll, MAX_MODEL_INPUT_CHARS);

    let summary = await summarizeChunk(summarizer, name, cappedText);
    if (!summary) {
      const para = pickFunctionalParagraph(parasAll, name);
      summary = fallbackFromParagraph(para, name);
    }

    existing[name] = {
      summary,
      generated_at: nowIso(),
      readme_fetched_at: fetchedAt,
      readme_len: readmeLen,
      model,
    };
    updated++;
    process.stderr.write(summary ? 'ok\n' : 'null\n');

    writeJson(SUMMARIES_CACHE, existing);
  }

  writeJson(SUMMARIES_CACHE, existing);
  console.log(`Done. updated=${updated} skipped=${skipped} missing_readme=${missing} -> ${SUMMARIES_CACHE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

