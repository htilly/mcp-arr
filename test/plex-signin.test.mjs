#!/usr/bin/env node
/**
 * "Sign in with Plex" (src/plex-signin.ts + the /admin/api/services/<id>/signin
 * routes). Runs the server in HTTP mode against a fake plex.tv. Build first.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigStore } from '../dist/config-store.js';
import { pickConnection, resourcesToResults } from '../dist/plex-signin.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ACCOUNT_TOKEN = 'account-token-should-never-be-saved';
const SERVER_TOKEN = 'server-access-token-0123456789';
const KEY = 'test-passphrase-plex-signin';

let plexTv;
let plexTvUrl;
let pinPolls = 0;
let servers = 1;
let seen = [];
let dir;
let child;
let port;
let origin;
let cookie;

const RESOURCES = () => [
  {
    name: 'Tilly Plex', provides: 'server', owned: true, accessToken: SERVER_TOKEN, clientIdentifier: 'abc',
    connections: [
      { protocol: 'https', address: '1.2.3.4', port: 32400, uri: 'https://1-2-3-4.hash.plex.direct:32400', local: false, relay: false },
      { protocol: 'https', address: '172.16.230.80', port: 32400, uri: 'https://172-16-230-80.hash.plex.direct:32400', local: true, relay: false },
    ],
  },
  { name: 'Plex Web', provides: 'client,player', accessToken: 'player-token' },
  ...(servers > 1 ? [{ name: 'Friend', provides: 'server', owned: false, accessToken: 'friend-token', connections: [{ address: '5.6.7.8', port: 32400, uri: 'https://5-6-7-8.x.plex.direct:32400', local: false }] }] : []),
];

before(async () => {
  plexTv = createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, client: req.headers['x-plex-client-identifier'], token: req.headers['x-plex-token'] });
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'POST' && req.url.startsWith('/api/v2/pins')) return res.end(JSON.stringify({ id: 42, code: 'ABCD1234' }));
    if (req.url.startsWith('/api/v2/pins/42')) {
      pinPolls += 1;
      return res.end(JSON.stringify({ id: 42, code: 'ABCD1234', authToken: pinPolls >= 2 ? ACCOUNT_TOKEN : null }));
    }
    if (req.url.startsWith('/api/v2/resources')) {
      if (req.headers['x-plex-token'] !== ACCOUNT_TOKEN) { res.statusCode = 401; return res.end('{}'); }
      return res.end(JSON.stringify(RESOURCES()));
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise((resolve) => plexTv.listen(0, '127.0.0.1', resolve));
  plexTvUrl = `http://127.0.0.1:${plexTv.address().port}`;

  dir = mkdtempSync(join(tmpdir(), 'mcp-arr-plex-signin-'));
  const configPath = join(dir, 'config.json');
  const seed = new ConfigStore({ path: configPath, allowAutoKey: false, env: { CONFIG_ENCRYPTION_KEY: KEY } });
  seed.load();
  const user = seed.createUser('Alice', 'admin', { id: 'dGVzdA', publicKey: 'AA', counter: 0, name: 'k' }, 'aGFuZGxl');
  seed.setPassword(user.id, 'correct horse battery');

  port = 38000 + Math.floor(Math.random() * 1000);
  origin = `http://mcp.example.com:${port}`;
  child = spawn(process.execPath, [join(root, 'dist', 'index.js')], {
    env: {
      PATH: process.env.PATH, MCP_TRANSPORT: 'http', HOST: '127.0.0.1', PORT: String(port), TLS_MODE: 'off',
      CONFIG_ENCRYPTION_KEY: KEY, CONFIG_PATH: configPath, PUBLIC_URL: origin,
      PLEX_TV_URL: plexTvUrl, PLEX_APP_URL: 'https://app.plex.example',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (c) => (stderr += c));
  const deadline = Date.now() + 15000;
  for (;;) {
    if ((await http('/health').catch(() => ({}))).status === 200) break;
    if (Date.now() > deadline) throw new Error(`server did not start: ${stderr}`);
    await new Promise((r) => setTimeout(r, 150));
  }
  const login = await http('/admin/api/login/password', { method: 'POST', body: { name: 'Alice', password: 'correct horse battery' } });
  assert.equal(login.status, 200, login.text);
  cookie = login.headers['set-cookie'][0].split(';')[0];
});

after(async () => {
  child?.kill('SIGTERM');
  if (child) await once(child, 'exit').catch(() => {});
  plexTv?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function http(path, { method = 'GET', body, withCookie = false } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = request({
      host: '127.0.0.1', port, path, method, agent: false,
      headers: {
        'Content-Type': 'application/json', Host: `mcp.example.com:${port}`, Origin: origin,
        ...(withCookie ? { Cookie: cookie } : {}), ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8').on('data', (c) => (text += c)).on('end', () => {
        let json; try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, json, text });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
const ui = (path, opts = {}) => http(`/admin/api${path}`, { withCookie: true, ...opts });

async function waitFor(fn, ms) {
  const deadline = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 100));
  }
}

test('the best Plex connection is a local address over http, never a relay', () => {
  assert.equal(pickConnection(RESOURCES()[0].connections), 'http://172.16.230.80:32400');
  assert.equal(pickConnection([{ address: '9.9.9.9', port: 1, relay: true, local: true }]), undefined);
  assert.equal(pickConnection([{ address: '1.2.3.4', port: 32400, uri: 'https://x.plex.direct:32400', local: false }]), 'https://x.plex.direct:32400');
  const results = resourcesToResults(RESOURCES());
  assert.deepEqual(results.map((r) => r.label), ['Tilly Plex'], 'players are not servers');
});

test('Sign in with Plex saves the server token and local URL, never the account token', async () => {
  const overview = await ui('/overview');
  const plex = overview.json.services.find((s) => s.id === 'plex');
  assert.equal(plex.signIn, 'Sign in with Plex');
  assert.equal(plex.configured, false);

  seen = []; pinPolls = 0; servers = 1;
  const start = await ui('/services/plex/signin', { method: 'POST', body: {} });
  assert.equal(start.status, 200, start.text);
  assert.match(start.json.authUrl, /^https:\/\/app\.plex\.example\/auth#\?clientID=[0-9a-f-]{36}&code=ABCD1234/);
  // Plex sends the browser back to the web UI, which then shows the result.
  const forward = new URLSearchParams(start.json.authUrl.split('#?')[1]).get('forwardUrl');
  assert.equal(forward, `${origin}/admin#signin=plex:${start.json.sessionId}`);
  assert.match(start.json.sessionId, /^[0-9a-f]{32}$/);
  const clientId = seen[0].client;
  assert.match(clientId, /^[0-9a-f-]{36}$/);

  const pending = await ui(`/services/plex/signin/${start.json.sessionId}`, { method: 'POST', body: {} });
  assert.deepEqual(pending.json, { status: 'pending' });
  // The server checks the PIN itself (every 2 s): no browser polling is needed for it to save.
  await waitFor(() => pinPolls >= 2 && seen.some((r) => r.url.startsWith('/api/v2/resources')), 10000);
  await new Promise((r) => setTimeout(r, 200));
  const saved = await ui(`/services/plex/signin/${start.json.sessionId}`, { method: 'POST', body: {} });
  assert.equal(saved.json.status, 'saved', saved.text);
  const after = saved.json.services.find((s) => s.id === 'plex');
  assert.equal(after.configured, true);
  assert.equal(after.url, 'http://172.16.230.80:32400');
  assert.ok(!saved.text.includes(SERVER_TOKEN) && !saved.text.includes(ACCOUNT_TOKEN), 'no token reaches the browser');
  assert.equal(after.fields.find((f) => f.key === 'token').hint, SERVER_TOKEN.slice(-4));
  assert.ok(seen.every((r) => r.client === clientId), 'one stable client id');

  // Another tab (e.g. the one Plex sends back) sees the same result.
  const again1 = await ui(`/services/plex/signin/${start.json.sessionId}`, { method: 'POST', body: {} });
  assert.equal(again1.json.status, 'saved');

  // A second sign-in uses the same install id.
  seen = [];
  const again = await ui('/services/plex/signin', { method: 'POST', body: {} });
  assert.equal(seen[0].client, clientId);
  assert.equal(again.status, 200);
});

test('with several servers the admin picks one', async () => {
  seen = []; pinPolls = 5; servers = 2;
  const start = await ui('/services/plex/signin', { method: 'POST', body: {} });
  let choose;
  await waitFor(async () => (choose = await ui(`/services/plex/signin/${start.json.sessionId}`, { method: 'POST', body: {} })).json.status !== 'pending', 10000);
  assert.equal(choose.json.status, 'choose');
  assert.deepEqual(choose.json.choices.map((c) => c.label), ['Tilly Plex', 'Friend (shared with you)']);
  assert.ok(!choose.text.includes('friend-token'));
  const bad = await ui(`/services/plex/signin/${start.json.sessionId}/choose`, { method: 'POST', body: { index: 9 } });
  assert.equal(bad.status, 400);
  const picked = await ui(`/services/plex/signin/${start.json.sessionId}/choose`, { method: 'POST', body: { index: 1 } });
  assert.equal(picked.json.status, 'saved', picked.text);
  const twice = await ui(`/services/plex/signin/${start.json.sessionId}/choose`, { method: 'POST', body: { index: 0 } });
  assert.equal(twice.status, 400, 'a finished sign-in cannot be changed afterwards');
  assert.equal(picked.json.services.find((s) => s.id === 'plex').url, 'https://5-6-7-8.x.plex.direct:32400');
});

test('sign-in needs an admin session and only exists for services that have one', async () => {
  const anonymous = await http('/admin/api/services/plex/signin', { method: 'POST', body: {} });
  assert.equal(anonymous.status, 401);
  const sonarr = await ui('/services/sonarr/signin', { method: 'POST', body: {} });
  assert.equal(sonarr.status, 404);
  const unknown = await ui(`/services/plex/signin/${'0'.repeat(32)}`, { method: 'POST', body: {} });
  assert.equal(unknown.status, 404);
});
