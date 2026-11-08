#!/usr/bin/env node
/**
 * Security regression tests. Runs dist/index.js against a local stub server with
 * dummy keys, so no real service is contacted. Build first: npm run build
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const entry = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js');
const DUMMY_KEY = 'dummy-key-0123456789';

let stub;
let baseUrl;
let requests = [];
const openClients = [];

before(async () => {
  stub = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/fail')) {
      res.statusCode = 500;
      res.end(`upstream echoed ${DUMMY_KEY}`);
      return;
    }
    if (req.url.includes('/episode?')) {
      res.end(JSON.stringify([
        { id: 1, hasFile: true, episodeFileId: 11 },
        { id: 2, hasFile: true, episodeFileId: 12 },
      ]));
      return;
    }
    res.end(JSON.stringify({ status: 2 }));
  });
  await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${stub.address().port}`;
});

after(async () => {
  await Promise.all(openClients.map((c) => c.close()));
  stub.close();
});

async function connect(env = {}) {
  const client = new Client({ name: 'security-test', version: '1.0.0' });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    env: {
      PATH: process.env.PATH,
      SONARR_URL: baseUrl,
      SONARR_API_KEY: DUMMY_KEY,
      RADARR_URL: baseUrl,
      RADARR_API_KEY: DUMMY_KEY,
      OVERSEERR_URL: baseUrl,
      OVERSEERR_API_KEY: DUMMY_KEY,
      LIDARR_URL: baseUrl,
      LIDARR_API_KEY: DUMMY_KEY,
      PROWLARR_URL: baseUrl,
      PROWLARR_API_KEY: DUMMY_KEY,
      TAUTULLI_URL: baseUrl,
      TAUTULLI_API_KEY: DUMMY_KEY,
      BAZARR_URL: baseUrl,
      BAZARR_API_KEY: DUMMY_KEY,
      ...env,
    },
  }));
  openClients.push(client);
  return client;
}

async function call(client, name, args) {
  requests = [];
  const result = await client.callTool({ name, arguments: args });
  return { ...result, text: result.content[0].text, requests };
}

function startupFailure(env) {
  return spawnSync(process.execPath, [entry], {
    env: { PATH: process.env.PATH, ...env },
    input: '',
    encoding: 'utf8',
    timeout: 10000,
  });
}

test('O-001: non-integer IDs are rejected before any request', async () => {
  const client = await connect();
  const attacks = [
    ['sonarr_delete_series', { seriesId: '../downloadclient/1', confirm: true }],
    ['radarr_delete_movie', { movieId: '../tag/1', confirm: true }],
    ['overseerr_approve_request', { requestId: '../settings/main/regenerate', confirm: true }],
    ['sonarr_get_episodes', { seriesId: '1&x=y' }],
    ['sonarr_delete_series', { seriesId: 0, confirm: true }],
    ['sonarr_delete_series', { seriesId: -1, confirm: true }],
    ['sonarr_delete_series', { seriesId: 1.5, confirm: true }],
    ['sonarr_delete_series', { seriesId: 2 ** 53, confirm: true }],
    ['sonarr_delete_episode_files', { episodeFileIds: [1, '../tag/1'], confirm: true }],
    ['radarr_delete_queue_item', { queueId: '../tag/1', confirm: true }],
  ];
  for (const [name, args] of attacks) {
    const result = await call(client, name, args);
    assert.equal(result.isError, true, `${name} ${JSON.stringify(args)}`);
    assert.deepEqual(result.requests, [], `${name} ${JSON.stringify(args)}`);
  }
});

test('O-001: valid IDs still reach the expected endpoint', async () => {
  const client = await connect();
  const result = await call(client, 'sonarr_delete_episode_files', { episodeFileIds: [7], confirm: true });
  assert.notEqual(result.isError, true, result.text);
  assert.deepEqual(result.requests, ['DELETE /api/v3/episodefile/7']);
});

test('O-003: deleteFiles defaults to false', async () => {
  const client = await connect();
  const series = await call(client, 'sonarr_delete_series', { seriesId: 5, confirm: true });
  assert.match(series.requests[0], /^DELETE \/api\/v3\/series\/5\?deleteFiles=false/);
  const movie = await call(client, 'radarr_delete_movie', { movieId: 5, confirm: true });
  assert.match(movie.requests[0], /^DELETE \/api\/v3\/movie\/5\?deleteFiles=false/);
});

test('O-003: deleteFiles must be a real boolean', async () => {
  const client = await connect();
  const result = await call(client, 'sonarr_delete_series', { seriesId: 5, deleteFiles: 'false', confirm: true });
  assert.equal(result.isError, true);
  assert.deepEqual(result.requests, []);
});

test('O-003: confirm: true is required', async () => {
  const client = await connect();
  for (const confirm of [undefined, false, 'true']) {
    const args = { seriesId: 5, ...(confirm === undefined ? {} : { confirm }) };
    const result = await call(client, 'sonarr_delete_series', args);
    assert.equal(result.isError, true);
    assert.deepEqual(result.requests, []);
  }
});

test('O-003: tools carry annotations', async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  assert.equal(byName.sonarr_delete_series.annotations.destructiveHint, true);
  assert.ok(byName.sonarr_delete_series.inputSchema.required.includes('confirm'));
  assert.equal(byName.sonarr_get_series.annotations.readOnlyHint, true);
  assert.equal(byName.sonarr_search_missing.annotations.readOnlyHint, false);
});

test('every tool that looks like a write is marked as one', async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  const looksLikeWrite = /_(add|delete|update|refresh|test|reset|download|terminate|approve|decline)_|_search_(missing|episode|movie|movies|album|series)$/;
  for (const tool of tools) {
    if (looksLikeWrite.test(tool.name) && !tool.name.includes('_get_')) {
      assert.equal(tool.annotations.readOnlyHint, false, tool.name);
    }
  }
});

test('O-003: ARR_READ_ONLY hides and blocks write tools', async () => {
  const client = await connect({ ARR_READ_ONLY: 'true' });
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  assert.ok(names.includes('sonarr_get_series'));
  for (const hidden of ['sonarr_delete_series', 'sonarr_search_missing', 'overseerr_approve_request']) {
    assert.ok(!names.includes(hidden), hidden);
  }
  const result = await call(client, 'sonarr_delete_series', { seriesId: 5, confirm: true });
  assert.equal(result.isError, true);
  assert.match(result.text, /ARR_READ_ONLY/);
  assert.deepEqual(result.requests, []);
});

test('A-007: delete_season requires an integer seasonNumber', async () => {
  const client = await connect();
  for (const args of [{ seriesId: 7 }, { seriesId: 7, seasonNumber: '1' }, { seriesId: 7, seasonNumber: 1.5 }]) {
    const result = await call(client, 'sonarr_delete_season', { ...args, confirm: true });
    assert.equal(result.isError, true, JSON.stringify(args));
    assert.deepEqual(result.requests, [], JSON.stringify(args));
  }
});

test('A-007: delete_season filters by season, including season 0', async () => {
  const client = await connect();
  const result = await call(client, 'sonarr_delete_season', { seriesId: 7, seasonNumber: 0, confirm: true });
  assert.notEqual(result.isError, true, result.text);
  assert.equal(result.requests[0], 'GET /api/v3/episode?seriesId=7&seasonNumber=0');
  assert.equal(result.requests[1], 'DELETE /api/v3/episodefile/bulk');
});

test('A-004: malformed service URLs stop startup without printing the key', () => {
  for (const url of ['192.168.1.5:8181', 'localhost:8181', 'ftp://example.test']) {
    const result = startupFailure({ TAUTULLI_URL: url, TAUTULLI_API_KEY: DUMMY_KEY });
    assert.equal(result.status, 1, url);
    assert.match(result.stderr, /TAUTULLI_URL must be/);
    assert.ok(!result.stderr.includes(DUMMY_KEY), url);
    assert.ok(!result.stdout.includes(DUMMY_KEY), url);
  }
});

test('A-004: API keys are redacted from error text', async () => {
  const client = await connect({ SONARR_URL: `${baseUrl}/fail` });
  const result = await call(client, 'sonarr_get_series', {});
  assert.equal(result.isError, true);
  assert.match(result.text, /\[REDACTED\]/);
  assert.ok(!result.text.includes(DUMMY_KEY));
});

test("isBlockedServiceHost blocks link-local and cloud metadata, allows LAN and loopback", async () => {
  const { isBlockedServiceHost } = await import("../dist/security.js");
  for (const url of ["http://169.254.169.254/latest", "http://[fe80::1]/", "http://metadata.google.internal/", "http://[::ffff:169.254.169.254]/"]) {
    assert.equal(isBlockedServiceHost(url), true, url);
  }
  for (const url of ["http://192.168.1.5:8989", "http://localhost:8989", "http://sonarr:8989", "https://10.0.0.2"]) {
    assert.equal(isBlockedServiceHost(url), false, url);
  }
});
