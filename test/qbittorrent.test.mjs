#!/usr/bin/env node
/**
 * qBittorrent tests against a local stub that answers like the WebUI API v2, so
 * no real service is contacted. The MCP tests run dist/index.js over stdio; the
 * client tests cover the login/session handling in detail. Build first: npm run build
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const { QBittorrentClient } = await import(pathToFileURL(join(dist, 'qbittorrent-client.js')).href);
const entry = join(dist, 'index.js');

const USER = 'admin';
const PASS = 'dummy-qbt-password-0123';
const API_KEY = 'qbt_dummyapikey0123456789abcdef';
const HASH_A = 'a'.repeat(40);
const HASH_B = 'B'.repeat(64);

let stub;
let baseUrl;
let requests = [];
/** Stub behaviour, reset before each test. */
let opt;
const openClients = [];

/** WebAPI 2.11+ (qBittorrent 5) has stop/start instead of pause/resume. */
function v5() {
  const [major, minor] = opt.webapi.split('.').map(Number);
  return major > 2 || (major === 2 && minor >= 11);
}

function reset() {
  opt = { webapi: '2.11.4', requireAuth: true, cookieName: 'QBT_SID_8080', sid: 'sid-1', expireOnce: false, bypassLogin: false, fail500: false };
}

before(async () => {
  stub = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const [path, qs] = req.url.split('?');
      const form = Object.fromEntries(new URLSearchParams(req.method === 'POST' ? body : qs ?? ''));
      requests.push({ method: req.method, path, form, headers: req.headers });
      const text = (t, status = 200, headers = {}) => { res.writeHead(status, { 'Content-Type': 'text/plain', ...headers }); res.end(t); };
      const json = (d) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };

      if (path === '/api/v2/auth/login') {
        if (opt.bypassLogin) return text('Ok.');
        if (form.username === USER && form.password === PASS) {
          return text('Ok.', 200, { 'Set-Cookie': `${opt.cookieName}=${opt.sid}; HttpOnly; path=/; SameSite=Strict` });
        }
        return text('Fails.');
      }

      // auth check
      const auth = req.headers['x-api-key'] === API_KEY
        || req.headers.authorization === `Bearer ${API_KEY}`
        || (req.headers.cookie ?? '').includes(`${opt.cookieName}=${opt.sid}`);
      if (req.headers['x-api-key'] && req.headers['x-api-key'] !== API_KEY) return text('', 401);
      if (opt.requireAuth && !auth) return text('Forbidden', 403);
      if (opt.expireOnce) { opt.expireOnce = false; opt.sid = 'sid-2'; return text('Forbidden', 403); }

      switch (path) {
        case '/api/v2/app/version': return text('v5.1.2');
        case '/api/v2/app/webapiVersion': return text(opt.webapi);
        case '/api/v2/transfer/info': return json({ dl_info_speed: 1048576, dl_info_data: 1, up_info_speed: 2048, up_info_data: 2, dl_rate_limit: 0, up_rate_limit: 512000, dht_nodes: 300, connection_status: 'connected' });
        case '/api/v2/transfer/speedLimitsMode': return text('0');
        case '/api/v2/torrents/info': {
          // A body that would leak the session if it were ever passed on.
          if (opt.fail500) return text(`internal error, session ${req.headers.cookie}`, 500);
          const now = Math.floor(Date.now() / 1000);
          return json([
            { hash: HASH_A, name: 'Some.Linux.ISO', state: 'stalledDL', progress: 0.4, size: 1e9, dlspeed: 0, upspeed: 0, eta: 8640000, ratio: 0, added_on: 1, last_activity: 1, category: 'tv' },
            { hash: HASH_B.toLowerCase(), name: 'Healthy.Download', state: 'downloading', progress: 0.9, size: 2e9, dlspeed: 5e6, upspeed: 1e5, eta: 125, ratio: 0.12, added_on: now - 600, last_activity: now, category: 'tv' },
          ]);
        }
        case '/api/v2/torrents/pause':
          if (v5()) return text('Not Found', 404);
          return text('');
        case '/api/v2/torrents/resume':
          if (v5()) return text('Not Found', 404);
          return text('');
        case '/api/v2/torrents/stop':
        case '/api/v2/torrents/start':
          if (!v5()) return text('Not Found', 404);
          return text('');
        case '/api/v2/torrents/delete':
        case '/api/v2/torrents/recheck':
        case '/api/v2/torrents/reannounce':
        case '/api/v2/transfer/setDownloadLimit':
        case '/api/v2/transfer/setUploadLimit':
        case '/api/v2/transfer/toggleSpeedLimitsMode':
          return text('');
        case '/api/v2/sync/maindata': return json({ rid: 1, server_state: { free_space_on_disk: 5e11, use_alt_speed_limits: false } });
      }
      return text('Not Found', 404);
    });
  });
  await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${stub.address().port}`;
});

after(async () => {
  await Promise.all(openClients.map((c) => c.close()));
  stub.close();
});

async function connect(env = {}) {
  const client = new Client({ name: 'qbittorrent-test', version: '1.0.0' });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    env: { PATH: process.env.PATH, QBITTORRENT_URL: baseUrl, QBITTORRENT_USERNAME: USER, QBITTORRENT_PASSWORD: PASS, ...env },
  }));
  openClients.push(client);
  return client;
}

async function call(client, name, args = {}) {
  requests = [];
  const result = await client.callTool({ name, arguments: args });
  return { ...result, text: result.content[0].text, requests };
}
beforeEach(() => { reset(); requests = []; });

test('username/password: logs in once, keeps any cookie name, sends Referer and Origin', async () => {
  const qbt = new QBittorrentClient({ url: baseUrl + '/', username: USER, password: PASS });
  assert.equal(qbt.authMode, 'login');
  assert.equal(await qbt.getVersion(), 'v5.1.2');
  const info = await qbt.getTransferInfo();
  assert.equal(info.connection_status, 'connected');
  assert.equal(requests.filter((r) => r.path === '/api/v2/auth/login').length, 1);
  const login = requests[0];
  assert.equal(login.method, 'POST');
  assert.deepEqual(login.form, { username: USER, password: PASS });
  for (const r of requests) {
    assert.equal(r.headers.referer, `${baseUrl}/`);
    assert.equal(r.headers.origin, baseUrl);
  }
  assert.equal(requests[1].headers.cookie, 'QBT_SID_8080=sid-1');
});

test('an expired session triggers one re-login and a retry', async () => {
  const qbt = new QBittorrentClient({ url: baseUrl, username: USER, password: PASS });
  await qbt.getVersion();
  opt.expireOnce = true;
  requests = [];
  assert.equal(await qbt.getVersion(), 'v5.1.2');
  assert.deepEqual(requests.map((r) => r.path), ['/api/v2/app/version', '/api/v2/auth/login', '/api/v2/app/version']);
  assert.equal(requests[2].headers.cookie, 'QBT_SID_8080=sid-2');
});

test('wrong password gives a clear error without the password', async () => {
  const qbt = new QBittorrentClient({ url: baseUrl, username: USER, password: 'wrong-password-xyz' });
  await assert.rejects(qbt.getVersion(), (err) => {
    assert.match(err.message, /401 - login failed/);
    assert.ok(!err.message.includes('wrong-password-xyz'));
    return true;
  });
});

test('API key goes in Authorization and X-API-Key, no login, no cookie', async () => {
  const qbt = new QBittorrentClient({ url: baseUrl, apiKey: API_KEY, username: USER, password: PASS });
  assert.equal(qbt.authMode, 'apiKey');
  await qbt.getTransferInfo();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].headers.authorization, `Bearer ${API_KEY}`);
  assert.equal(requests[0].headers['x-api-key'], API_KEY);
  assert.equal(requests[0].headers.cookie, undefined);

  const bad = new QBittorrentClient({ url: baseUrl, apiKey: 'qbt_wrongkey' });
  await assert.rejects(bad.getVersion(), (err) => {
    assert.match(err.message, /401 - check QBITTORRENT_API_KEY/);
    assert.ok(!err.message.includes('qbt_wrongkey'));
    return true;
  });
});

test('no credentials works when qBittorrent bypasses auth, and explains a 403 otherwise', async () => {
  opt.requireAuth = false;
  const open = new QBittorrentClient({ url: baseUrl });
  assert.equal(open.authMode, 'none');
  assert.equal(await open.getVersion(), 'v5.1.2');
  assert.equal(requests.length, 1);

  opt.requireAuth = true;
  await assert.rejects(open.getVersion(), /403 - qBittorrent wants a login/);
});

test('login answered "Ok." without a cookie (whitelisted subnet) is not repeated', async () => {
  opt.requireAuth = false;
  opt.bypassLogin = true;
  const qbt = new QBittorrentClient({ url: baseUrl, username: USER, password: 'anything-at-all' });
  await qbt.getVersion();
  await qbt.getVersion();
  assert.equal(requests.filter((r) => r.path === '/api/v2/auth/login').length, 1);
});

test('pause/resume use stop/start on WebAPI >= 2.11 and pause/resume before', async () => {
  const v5 = new QBittorrentClient({ url: baseUrl, apiKey: API_KEY });
  await v5.pause([HASH_A, HASH_B]);
  await v5.resume('all');
  const posts = requests.filter((r) => r.method === 'POST');
  assert.deepEqual(posts.map((r) => r.path), ['/api/v2/torrents/stop', '/api/v2/torrents/start']);
  assert.equal(posts[0].form.hashes, `${HASH_A}|${HASH_B.toLowerCase()}`);
  assert.equal(posts[1].form.hashes, 'all');
  assert.equal(requests.filter((r) => r.path === '/api/v2/app/webapiVersion').length, 1, 'version is cached');

  opt.webapi = '2.9.3';
  requests = [];
  const v4 = new QBittorrentClient({ url: baseUrl, apiKey: API_KEY });
  await v4.pause([HASH_A]);
  await v4.resume([HASH_A]);
  assert.deepEqual(requests.filter((r) => r.method === 'POST').map((r) => r.path), ['/api/v2/torrents/pause', '/api/v2/torrents/resume']);
});

test('hashes are validated before any request; delete refuses "all"', async () => {
  const qbt = new QBittorrentClient({ url: baseUrl, apiKey: API_KEY });
  for (const bad of [[], ['abc'], [`${HASH_A}|all`], ['../x']]) {
    await assert.rejects(qbt.pause(bad));
  }
  await assert.rejects(qbt.deleteTorrents('all', true), /hash/);
  assert.deepEqual(requests, []);

  await qbt.deleteTorrents([HASH_A], true);
  assert.deepEqual(requests[0].form, { hashes: HASH_A, deleteFiles: 'true' });
  await qbt.deleteTorrents([HASH_A], false);
  assert.equal(requests[1].form.deleteFiles, 'false');
});

test('torrent list passes filters and validates the filter name', async () => {
  const qbt = new QBittorrentClient({ url: baseUrl, apiKey: API_KEY });
  const list = await qbt.getTorrents({ filter: 'stalled_downloading', category: 'tv', limit: 10, offset: 20 });
  assert.equal(list[0].hash, HASH_A);
  assert.deepEqual(requests[0].form, { filter: 'stalled_downloading', category: 'tv', limit: '10', offset: '20' });
  await assert.rejects(qbt.getTorrents({ filter: 'bogus' }), /filter must be one of/);
});

test('speed limits and alternative limits', async () => {
  const qbt = new QBittorrentClient({ url: baseUrl, apiKey: API_KEY });
  await qbt.setGlobalDownloadLimit(5 * 1024 * 1024);
  await qbt.setGlobalUploadLimit(0);
  await qbt.setAltSpeedLimitsEnabled(false); // already off: no toggle
  await qbt.setAltSpeedLimitsEnabled(true);
  const posts = requests.filter((r) => r.method === 'POST');
  assert.deepEqual(posts.map((r) => [r.path, r.form.limit]), [
    ['/api/v2/transfer/setDownloadLimit', String(5 * 1024 * 1024)],
    ['/api/v2/transfer/setUploadLimit', '0'],
    ['/api/v2/transfer/toggleSpeedLimitsMode', undefined],
  ]);
  assert.equal((await qbt.getServerState()).free_space_on_disk, 5e11);
});

test('stuck detection', () => {
  const now = 1_000_000;
  const base = { hash: HASH_A, name: 'x', progress: 0.5, size: 1, dlspeed: 0, upspeed: 0, eta: 0, ratio: 0, added_on: now - 7200, last_activity: now - 7200 };
  const reason = (t, min) => QBittorrentClient.stuckReason({ ...base, ...t }, now, min);
  assert.match(reason({ state: 'stalledDL' }), /stalled/);
  assert.equal(reason({ state: 'stalledDL', last_activity: now - 60 }), undefined);
  assert.match(reason({ state: 'metaDL' }), /no metadata/);
  assert.equal(reason({ state: 'error' }), 'error');
  assert.equal(reason({ state: 'missingFiles', progress: 1 }), 'missing files');
  assert.match(reason({ state: 'downloading' }), /0 B\/s/);
  assert.equal(reason({ state: 'downloading', dlspeed: 1000 }), undefined);
  assert.equal(reason({ state: 'stoppedDL' }), undefined);
  assert.equal(reason({ state: 'queuedDL' }), undefined);
  assert.equal(reason({ state: 'stalledUP', progress: 1 }), undefined);
  assert.equal(reason({ state: 'stalledDL' }, 180), undefined, 'custom threshold');
});

// ---------- MCP level (dist/index.js over stdio) ----------

test('MCP: tools are listed with annotations, delete needs confirm', async () => {
  const client = await connect();
  const byName = Object.fromEntries((await client.listTools()).tools.map((t) => [t.name, t]));
  for (const n of ['qbittorrent_status', 'qbittorrent_get_torrents', 'qbittorrent_pause', 'qbittorrent_resume',
    'qbittorrent_set_speed_limits', 'qbittorrent_recheck', 'qbittorrent_reannounce', 'qbittorrent_delete_torrents']) {
    assert.ok(byName[n], n);
  }
  assert.equal(byName.qbittorrent_get_torrents.annotations.readOnlyHint, true);
  assert.equal(byName.qbittorrent_pause.annotations.readOnlyHint, false);
  assert.equal(byName.qbittorrent_pause.annotations.destructiveHint, false);
  const del = byName.qbittorrent_delete_torrents;
  assert.equal(del.annotations.destructiveHint, true);
  assert.ok(del.inputSchema.required.includes('confirm'));
  assert.match(byName.arr_status.description, /qBittorrent/);

  const refused = await call(client, 'qbittorrent_delete_torrents', { hashes: [HASH_A] });
  assert.equal(refused.isError, true);
  assert.deepEqual(refused.requests, []);
  const ok = await call(client, 'qbittorrent_delete_torrents', { hashes: [HASH_A], confirm: true });
  assert.notEqual(ok.isError, true, ok.text);
  const post = ok.requests.find((r) => r.path === '/api/v2/torrents/delete');
  assert.deepEqual(post.form, { hashes: HASH_A, deleteFiles: 'false' });
});

test('MCP: ARR_READ_ONLY hides write and delete tools', async () => {
  const client = await connect({ ARR_READ_ONLY: 'true' });
  const names = (await client.listTools()).tools.map((t) => t.name);
  assert.ok(names.includes('qbittorrent_get_torrents'));
  assert.ok(names.includes('qbittorrent_status'));
  for (const hidden of ['qbittorrent_pause', 'qbittorrent_resume', 'qbittorrent_set_speed_limits', 'qbittorrent_recheck', 'qbittorrent_reannounce', 'qbittorrent_delete_torrents']) {
    assert.ok(!names.includes(hidden), hidden);
  }
  const refused = await call(client, 'qbittorrent_pause', { all: true });
  assert.equal(refused.isError, true);
  assert.deepEqual(refused.requests, []);
});

test('MCP: the URL alone enables it (auth bypass) and arr_status reports the version', async () => {
  opt.requireAuth = false;
  const client = await connect({ QBITTORRENT_USERNAME: '', QBITTORRENT_PASSWORD: '' });
  const result = await call(client, 'arr_status');
  const status = JSON.parse(result.text);
  assert.deepEqual(status.qbittorrent, { configured: true, connected: true, version: 'v5.1.2' });
  assert.ok(!result.requests.some((r) => r.path === '/api/v2/auth/login'));
});

test('MCP: password, API key and session cookie never show up in errors', async () => {
  // wrong password
  const wrongPass = 'wrong-password-zz9876';
  const c1 = await connect({ QBITTORRENT_PASSWORD: wrongPass });
  const s1 = JSON.parse((await call(c1, 'arr_status')).text).qbittorrent;
  assert.equal(s1.connected, false);
  assert.match(s1.error, /401 - login failed/);
  assert.ok(!JSON.stringify(s1).includes(wrongPass));

  // wrong API key
  const wrongKey = 'qbt_wrongkey_abcdef0123456789';
  const c2 = await connect({ QBITTORRENT_API_KEY: wrongKey });
  const r2 = await call(c2, 'qbittorrent_get_torrents');
  assert.equal(r2.isError, true);
  assert.match(r2.text, /401 - check QBITTORRENT_API_KEY/);
  assert.ok(!r2.text.includes(wrongKey));

  // upstream error body containing the cookie
  opt.fail500 = true;
  const c3 = await connect();
  const r3 = await call(c3, 'qbittorrent_get_torrents');
  assert.equal(r3.isError, true);
  assert.match(r3.text, /qBittorrent API error: 500/);
  assert.ok(!r3.text.includes('sid-1'), r3.text);
  assert.ok(!r3.text.includes(PASS));
});

test('MCP: torrents carry stalled/stuck flags and stuckOnly finds them', async () => {
  const client = await connect();
  const all = JSON.parse((await call(client, 'qbittorrent_get_torrents', { category: 'tv', limit: 10 })).text);
  assert.equal(all.returned, 2);
  const [stalled, healthy] = all.torrents;
  assert.equal(stalled.stalled, true);
  assert.match(stalled.stuck, /stalled, no data/);
  assert.equal(stalled.eta, null);
  assert.equal(stalled.progress, '40%');
  assert.equal(healthy.stalled, false);
  assert.equal(healthy.stuck, null);
  assert.equal(healthy.eta, '2m');
  assert.equal(all.stuckCount, 1);

  const stuck = JSON.parse((await call(client, 'qbittorrent_get_torrents', { stuckOnly: true })).text);
  assert.equal(stuck.total, 1);
  assert.equal(stuck.torrents[0].hash, HASH_A);
  const info = requests.find((r) => r.path === '/api/v2/torrents/info');
  assert.equal(info.form.limit, undefined, 'stuckOnly pages locally');
});

test('MCP: pause/resume all, speed limits in KiB/s, status', async () => {
  const client = await connect();
  const paused = await call(client, 'qbittorrent_pause', { all: true });
  assert.notEqual(paused.isError, true, paused.text);
  assert.deepEqual(paused.requests.filter((r) => r.method === 'POST' && r.path !== '/api/v2/auth/login').map((r) => [r.path, r.form.hashes]), [['/api/v2/torrents/stop', 'all']]);

  const neither = await call(client, 'qbittorrent_resume', {});
  assert.equal(neither.isError, true);

  const limits = await call(client, 'qbittorrent_set_speed_limits', { downloadKiBps: 2048 });
  assert.notEqual(limits.isError, true, limits.text);
  assert.equal(limits.requests.find((r) => r.path === '/api/v2/transfer/setDownloadLimit').form.limit, String(2048 * 1024));

  const status = JSON.parse((await call(client, 'qbittorrent_status')).text);
  assert.equal(status.connectionStatus, 'connected');
  assert.equal(status.downloadSpeed, '1 MB/s');
  assert.equal(status.downloadLimit, 'unlimited');
  assert.equal(status.uploadLimit, '500 KB/s');
  assert.equal(status.auth, 'login');
  assert.equal(status.freeDiskSpace, '465.66 GB');
});
