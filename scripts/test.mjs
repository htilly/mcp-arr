#!/usr/bin/env node
/**
 * Test connections to all services supported by mcp-arr.
 * Loads config from test-config.txt (project root) if present, then overrides with env vars.
 * Usage: npm run test
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

const FETCH_TIMEOUT_MS = 15000;

async function fetchWithTimeout(url, options = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    clearTimeout(t);
    return res;
  } catch (err) {
    clearTimeout(t);
    throw err;
  }
}

// *arr: GET /api/vX/system/status with X-Api-Key
const ARR_SERVICES = [
  { key: 'sonarr', name: 'Sonarr (TV)', apiVersion: 'v3', listPath: '/series' },
  { key: 'radarr', name: 'Radarr (Movies)', apiVersion: 'v3', listPath: '/movie' },
  { key: 'lidarr', name: 'Lidarr (Music)', apiVersion: 'v1', listPath: '/artist' },
  { key: 'readarr', name: 'Readarr (Books)', apiVersion: 'v1', listPath: '/author' },
  { key: 'prowlarr', name: 'Prowlarr (Indexers)', apiVersion: 'v1', listPath: '/indexer' },
];

async function arrRequest(service, path) {
  const baseUrl = get(`${service.key.toUpperCase()}_URL`)?.replace(/\/$/, '');
  const apiKey = get(`${service.key.toUpperCase()}_API_KEY`);
  if (!baseUrl || !apiKey) return null;
  const url = `${baseUrl}/api/${service.apiVersion}${path}`;
  try {
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: `${res.status} ${res.statusText}`, data: null };
    if (!text || !text.trim()) return { ok: true, data: [], error: null };
    const data = JSON.parse(text);
    return { ok: true, data, error: null };
  } catch (err) {
    const cause = err.cause?.message ?? err.cause?.code ?? err.message;
    return { ok: false, error: cause, data: null };
  }
}

/** Tests sortBy and limit the same way as MCP server (Sonarr/Radarr). */
function testSortByAndLimit(serviceKey, data) {
  if (!Array.isArray(data)) return { ok: false, error: 'No data' };
  try {
    if (serviceKey === 'sonarr') {
      let arr = [...data];
      arr.sort((a, b) => (a.added ?? '').localeCompare(b.added ?? ''));
      arr.sort((a, b) => (b.statistics?.sizeOnDisk ?? 0) - (a.statistics?.sizeOnDisk ?? 0));
      arr = arr.slice(0, 100);
    } else if (serviceKey === 'radarr') {
      let arr = [...data];
      arr.sort((a, b) => (a.dateAdded ?? a.added ?? '').localeCompare(b.dateAdded ?? b.added ?? ''));
      arr.sort((a, b) => (b.sizeOnDisk ?? 0) - (a.sizeOnDisk ?? 0));
      arr = arr.slice(0, 100);
    } else {
      return { ok: true };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Runs the same type of calls as MCP tools (list resource). */
async function runArrFunctionalTest(service) {
  const r = await arrRequest(service, service.listPath);
  if (!r) return null;
  if (!r.ok) return { ok: false, error: r.error, count: null, data: null };
  const arr = Array.isArray(r.data) ? r.data : null;
  if (!arr) return { ok: false, error: 'Response is not an array', count: null, data: null };
  return { ok: true, error: null, count: arr.length, data: arr };
}

async function testTautulliFunctional(baseUrl, apiKey) {
  try {
    const data = await tautulliRequest(baseUrl, apiKey, 'get_server_info');
    if (!data || typeof data !== 'object') return { ok: false, error: 'Invalid response' };
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function testArr(service) {
  const baseUrl = get(`${service.key.toUpperCase()}_URL`)?.replace(/\/$/, '');
  const apiKey = get(`${service.key.toUpperCase()}_API_KEY`);
  if (!baseUrl || !apiKey) return null;
  const url = `${baseUrl}/api/${service.apiVersion}/system/status`;
  try {
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      if (res.status === 401) return { ok: false, error: `401 Unauthorized - check API key` };
      return { ok: false, error: `${res.status} ${res.statusText}` };
    }
    const data = await res.json();
    const version = data.version ?? data.appName ?? 'OK';
    return { ok: true, version };
  } catch (err) {
    const cause = err.cause?.message ?? err.cause?.code ?? err.message;
    if (cause === 'This operation was aborted') {
      return { ok: false, error: `Connection timeout - check if ${service.name} is reachable at ${baseUrl}` };
    }
    if (cause === 'ECONNREFUSED' || cause?.includes('ECONNREFUSED')) {
      return { ok: false, error: `Connection refused - ${service.name} not running at ${baseUrl}` };
    }
    if (cause === 'ENOTFOUND' || cause?.includes('ENOTFOUND')) {
      return { ok: false, error: `Host not found - check URL (${baseUrl})` };
    }
    return { ok: false, error: cause };
  }
}

async function testTautulli() {
  const baseUrl = get('TAUTULLI_URL')?.replace(/\/$/, '');
  const apiKey = get('TAUTULLI_API_KEY');
  if (!baseUrl || !apiKey) return null;
  const url = `${baseUrl}/api/v2?apikey=${encodeURIComponent(apiKey)}&cmd=server_status`;
  try {
    const res = await fetchWithTimeout(url, { method: 'GET' });
    if (!res.ok) {
      if (res.status === 401) return { ok: false, error: `401 Unauthorized - check API key` };
      return { ok: false, error: `${res.status} ${res.statusText}` };
    }
    const json = await res.json();
    if (json.response?.result === 'error') return { ok: false, error: json.response.message || 'API error' };
    return { ok: true, data: json.response.data };
  } catch (err) {
    const cause = err.cause?.message ?? err.cause?.code ?? err.message;
    if (cause === 'This operation was aborted') {
      return { ok: false, error: `Connection timeout - check if Tautulli is reachable at ${baseUrl}` };
    }
    if (cause === 'ECONNREFUSED' || cause?.includes('ECONNREFUSED')) {
      return { ok: false, error: `Connection refused - Tautulli not running at ${baseUrl}` };
    }
    return { ok: false, error: cause };
  }
}

async function testOverseerr() {
  const baseUrl = get('OVERSEERR_URL')?.replace(/\/$/, '');
  const apiKey = get('OVERSEERR_API_KEY');
  if (!baseUrl || !apiKey) return null;
  const url = `${baseUrl}/api/v1/status`;
  try {
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `${res.status} ${res.statusText}${text ? ` - ${text.slice(0, 100)}` : ''}` };
    }
    const data = await res.json();
    return { ok: true, version: data.version ?? 'OK' };
  } catch (err) {
    const cause = err.cause?.message ?? err.cause?.code ?? err.message;
    // Add more context for common errors
    if (cause === 'This operation was aborted') {
      return { ok: false, error: `Connection timeout (${FETCH_TIMEOUT_MS}ms) - check if Overseerr is reachable at ${baseUrl}` };
    }
    if (cause === 'ECONNREFUSED' || cause?.includes('ECONNREFUSED')) {
      return { ok: false, error: `Connection refused - Overseerr not running at ${baseUrl}` };
    }
    if (cause === 'ENOTFOUND' || cause?.includes('ENOTFOUND')) {
      return { ok: false, error: `Host not found - check OVERSEERR_URL (${baseUrl})` };
    }
    return { ok: false, error: `${cause} (URL: ${baseUrl})` };
  }
}

async function testOverseerrFunctional(baseUrl, apiKey) {
  try {
    const url = `${baseUrl}/api/v1/request?take=5`;
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
    });
    if (!res.ok) return { ok: false, error: `${res.status} ${res.statusText}` };
    const data = await res.json();
    return { ok: true, count: data.pageInfo?.results ?? 0, error: null };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function tautulliRequest(baseUrl, apiKey, cmd, params = {}) {
  const search = new URLSearchParams([
    ['apikey', apiKey],
    ['cmd', cmd],
    ...Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]),
  ]);
  const res = await fetchWithTimeout(`${baseUrl}/api/v2?${search}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.response?.result === 'error') throw new Error(json.response.message || 'API error');
  return json.response.data;
}

function statusLine(name, result) {
  if (result === null) return `  ⚪ ${name}: (not configured)`;
  if (result.ok) return `  🟢 ${name}: OK${result.version ? ` – ${result.version}` : ''}`;
  return `  🔴 ${name}: Error – ${result.error}`;
}

async function main() {
  const summary = [];

  for (const service of ARR_SERVICES) {
    const r = await testArr(service);
    summary.push({ name: service.name, result: r });
  }

  const tautulliResult = await testTautulli();
  summary.push({ name: 'Tautulli (Plex)', result: tautulliResult });

  const overseerrResult = await testOverseerr();
  summary.push({ name: 'Overseerr (Requests)', result: overseerrResult });

  const configuredCount = summary.filter((s) => s.result !== null).length;
  if (configuredCount === 0) {
    console.log('No service configured. Set URL and API_KEY in test-config.txt (or environment variables).');
    process.exit(1);
  }

  const tautulliUrl = get('TAUTULLI_URL')?.replace(/\/$/, '');
  const tautulliApiKey = get('TAUTULLI_API_KEY');
  const tautulliConfigured = Boolean(tautulliUrl && tautulliApiKey);

  const overseerrUrl = get('OVERSEERR_URL')?.replace(/\/$/, '');
  const overseerrApiKey = get('OVERSEERR_API_KEY');
  const overseerrConfigured = Boolean(overseerrUrl && overseerrApiKey);

  // Connection status first
  console.log('--- Connection ---\n');
  for (const s of summary) {
    console.log(statusLine(s.name, s.result));
  }
  console.log('');

  // Functional tests – same API calls as MCP tools
  console.log('--- Functional Tests ---\n');
  let funcFail = 0;
  for (const service of ARR_SERVICES) {
    const conn = summary.find((s) => s.name === service.name)?.result;
    if (conn === null || !conn?.ok) {
      console.log(`  ⚪ ${service.name}: (skipped)`);
      continue;
    }
    const r = await runArrFunctionalTest(service);
    if (r.ok) {
      const label = service.key === 'sonarr' ? 'series' : service.key === 'radarr' ? 'movies' : service.key === 'lidarr' ? 'artists' : service.key === 'readarr' ? 'authors' : 'indexers';
      console.log(`  🟢 ${service.name}: OK (${r.count} ${label})`);
      if (service.key === 'sonarr' || service.key === 'radarr') {
        const sortLimit = testSortByAndLimit(service.key, r.data);
        if (!sortLimit.ok) {
          console.log(`     sortBy/limit: Error – ${sortLimit.error}`);
          funcFail++;
        }
      }
    } else {
      console.log(`  🔴 ${service.name}: Error – ${r.error}`);
      funcFail++;
    }
  }
  if (tautulliConfigured && tautulliResult?.ok) {
    const r = await testTautulliFunctional(tautulliUrl, tautulliApiKey);
    if (r.ok) {
      console.log('  🟢 Tautulli (Plex): OK');
    } else {
      console.log(`  🔴 Tautulli (Plex): Error – ${r.error}`);
      funcFail++;
    }
  } else {
    console.log('  ⚪ Tautulli (Plex): (skipped)');
  }

  if (overseerrConfigured && overseerrResult?.ok) {
    const r = await testOverseerrFunctional(overseerrUrl, overseerrApiKey);
    if (r.ok) {
      console.log(`  🟢 Overseerr (Requests): OK (${r.count} requests)`);
    } else {
      console.log(`  🔴 Overseerr (Requests): Error – ${r.error}`);
      funcFail++;
    }
  } else {
    console.log('  ⚪ Overseerr (Requests): (skipped)');
  }

  const someOk = summary.some((s) => s.result?.ok);
  if (!someOk) {
    console.log('\nNo configured service responded. Check URL and API key.');
    process.exit(1);
  }
  const allOk = summary.filter((s) => s.result !== null).every((s) => s.result.ok);
  if (!allOk) {
    console.log('\nSome services did not respond.');
  }
  if (funcFail > 0) {
    console.log(`\n${funcFail} functional test(s) failed. Check API key and that the service responds as expected.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  if (err.cause?.code) console.error('Code:', err.cause.code);
  process.exit(1);
});
