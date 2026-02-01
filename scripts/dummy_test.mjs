#!/usr/bin/env node
/**
 * Dummy test: runs the same logic as tautulli_get_history.
 * Loads config from test-config.txt (project root) if present, then env.
 *
 * Usage:
 *   node scripts/dummy_test.mjs                    # default: "Dune: Prophecy", length 100
 *   node scripts/dummy_test.mjs "Turning Point"    # title only
 *   node scripts/dummy_test.mjs "Dune: Prophecy" 100
 *   TITLE="Turning Point" LENGTH=50 node scripts/dummy_test.mjs
 *   npm run test:dummy -- "Dune: Prophecy" 100
 */

import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const configPath = join(projectRoot, 'test-config.txt');

function loadTestConfig() {
  const env = {};
  if (!existsSync(configPath)) return env;
  const raw = readFileSync(configPath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const i = trimmed.indexOf('=');
    if (i <= 0) continue;
    const key = trimmed.slice(0, i).trim();
    let value = trimmed.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

const config = loadTestConfig();
function get(key) {
  return process.env[key] ?? config[key];
}

// title: first CLI arg, or env TITLE, or default
// length: second CLI arg, or env LENGTH, or default 100
const title = process.argv[2] ?? get('TITLE') ?? 'Dune: Prophecy';
const lengthRaw = process.argv[3] ?? get('LENGTH') ?? '100';
const length = Math.max(1, parseInt(lengthRaw, 10) || 100);

const baseUrl = get('TAUTULLI_URL')?.replace(/\/$/, '');
const apiKey = get('TAUTULLI_API_KEY');

if (!baseUrl || !apiKey) {
  console.error('Set TAUTULLI_URL and TAUTULLI_API_KEY in test-config.txt or env.');
  process.exit(1);
}

const apiBase = `${baseUrl}/api/v2`;

async function tautulliRequest(params) {
  const search = new URLSearchParams([
    ['apikey', apiKey],
    ['cmd', 'get_history'],
    ...Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]),
  ]);
  const res = await fetch(`${apiBase}?${search.toString()}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.response?.result === 'error') throw new Error(json.response.message || 'Tautulli API error');
  return json.response.data;
}

async function main() {
  console.log('--- Dummy test: tautulli_get_history ---');
  console.log('Request: { "title": "%s", "length": %d }\n', title, length);

  const searchWords = title.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean);
  const baseParams = { order_column: 'date', order_dir: 'desc' };
  const chunkSize = 1000;
  const maxChunks = 15;

  // 1) First call: get_history with search
  console.log('1) get_history with search="%s", length=%d', title, chunkSize);
  const first = await tautulliRequest({
    ...baseParams,
    length: chunkSize,
    search: title,
  });
  const firstRaw = first?.data ?? (Array.isArray(first) ? first : []);
  let rows = Array.isArray(firstRaw) ? firstRaw : [];
  console.log('   Response: data.length = %d, recordsFiltered = %s', rows.length, first?.recordsFiltered ?? 'n/a');
  if (rows.length > 0) {
    console.log('   First row keys:', Object.keys(rows[0] || {}).slice(0, 12).join(', '));
  }

  // 2) Fallback: paginate without search, filter client-side
  if (rows.length === 0 && searchWords.length > 0) {
    console.log('\n2) Fallback: paginate get_history (no search), filter client-side');
    const allRows = [];
    for (let start = 0; start < maxChunks * chunkSize; start += chunkSize) {
      const page = await tautulliRequest({ ...baseParams, start, length: chunkSize });
      const pageData = page?.data ?? (Array.isArray(page) ? page : []);
      const arr = Array.isArray(pageData) ? pageData : [];
      console.log('   start=%d -> %d rows', start, arr.length);
      allRows.push(...arr);
      if (arr.length < chunkSize) break;
    }
    rows = allRows.filter((row) => {
      const t = [row.title, row.full_title, row.grandparent_title, row.original_title].filter(Boolean).join(' ').toLowerCase();
      return searchWords.every((w) => t.includes(w));
    });
    console.log('   After filter (words: %s): %d rows', searchWords.join(', '), rows.length);
  }

  const returnLimit = Math.min(length, 100);
  const history = rows.slice(0, returnLimit).map((row) => ({
    who: row.friendly_name ?? row.user ?? '-',
    when: row.date != null ? new Date(row.date * 1000).toISOString() : '-',
    title: row.full_title ?? row.title ?? row.grandparent_title ?? '-',
  }));

  const result = {
    searchedFor: title,
    existsInLibrary: true, // skip library search in dummy
    summary: 'The film/series is in the Plex library.',
    watchedCount: rows.length,
    watchedSummary: rows.length === 0 ? 'No one has watched it (according to history).' : `${rows.length} play(s).`,
    returned: history.length,
    history,
  };

  console.log('\n--- Result (JSON) ---');
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
