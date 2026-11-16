#!/usr/bin/env node
/**
 * Plex integration tests. Runs dist/index.js over stdio against a local stub
 * that answers like Plex Media Server, so no real server is contacted.
 * Build first: npm run build
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { redactPlexToken } from '../dist/plex-client.js';

const entry = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js');
const TOKEN = 'dummy-plex-token-0123456789';

let stub;
let baseUrl;
let requests = [];
const openClients = [];

const SECTIONS = [
  { key: '1', type: 'movie', title: 'Movies', refreshing: false, scannedAt: 1763200000, Location: [{ id: 1, path: '/data/movies' }] },
  { key: '2', type: 'show', title: 'TV Shows', refreshing: true, scannedAt: 1763100000, Location: [{ id: 2, path: '/data/tv' }] },
];

const SESSION = {
  ratingKey: '5001', type: 'episode', title: 'Pilot', grandparentTitle: 'Some Show', parentIndex: 1, index: 1,
  duration: 3_600_000, viewOffset: 900_000, sessionKey: '42',
  User: { id: '1', title: 'henrik' },
  Player: { title: 'Living Room TV', product: 'Plex for Samsung', platform: 'Tizen', device: 'Samsung TV', state: 'playing', local: true },
  Session: { id: 'abc123sessionid', bandwidth: 12000, location: 'lan' },
  TranscodeSession: {
    key: '/transcode/sessions/xyz', videoDecision: 'transcode', audioDecision: 'transcode',
    sourceVideoCodec: 'av1', videoCodec: 'h264', sourceAudioCodec: 'dca', audioCodec: 'aac', audioChannels: 2,
    container: 'mpegts', sourceContainer: 'mkv', progress: 12.5, speed: 1.4, throttled: false, protocol: 'hls',
  },
  Media: [{ container: 'mkv', videoCodec: 'av1', audioCodec: 'dca', videoResolution: '4k', bitrate: 18000,
    Part: [{ file: '/data/tv/Some Show/S01E01.mkv', Stream: [
      { streamType: 1, codec: 'av1', displayTitle: '4K (AV1 Main 10)', height: 2160, width: 3840, decision: 'transcode' },
      { streamType: 2, codec: 'dca', displayTitle: 'English (DTS 5.1)', channels: 6, decision: 'transcode', selected: true },
    ] }] }],
};

before(async () => {
  stub = createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, token: req.headers['x-plex-token'], accept: req.headers.accept, size: req.headers['x-plex-container-size'] });
    res.setHeader('Content-Type', 'application/json');
    const send = (data, status = 200) => { res.statusCode = status; res.end(data === undefined ? '' : JSON.stringify(data)); };
    if (req.headers['x-plex-token'] !== TOKEN) return send({ error: 'Unauthorized' }, 401);
    const path = req.url.split('?')[0];
    if (path === '/') return send({ MediaContainer: { friendlyName: 'nas', version: '1.42.1.10060', platform: 'Linux', transcoderVideo: true, transcoderActiveVideoSessions: 1, myPlexSubscription: true } });
    if (path === '/library/sections') return send({ MediaContainer: { size: 2, Directory: SECTIONS } });
    if (path === '/library/sections/1/all') return send({ MediaContainer: { size: 0, totalSize: 812 } });
    if (path === '/library/sections/2/all') return send({ MediaContainer: { size: 0, totalSize: 95 } });
    if (/^\/library\/sections\/[12]\/(refresh|emptyTrash)$/.test(path)) return send(undefined);
    if (path === '/library/recentlyAdded') return send({ MediaContainer: { Metadata: [{ ratingKey: '7', type: 'movie', title: 'New', addedAt: 1763200000 }] } });
    if (path === '/library/metadata/5001') return send({ MediaContainer: { Metadata: [SESSION] } });
    if (path === '/library/metadata/5001/refresh') return send(undefined);
    if (path === '/library/metadata/999') {
      res.statusCode = 500; res.setHeader('Content-Type', 'text/html');
      return res.end(`<html>secret page body, token ${TOKEN}</html>`);
    }
    if (path === '/hubs/search') return send({ MediaContainer: { Hub: [{ type: 'movie', title: 'Movies', size: 1, Metadata: [{ ratingKey: '7', type: 'movie', title: 'New' }] }, { type: 'show', title: 'Shows', size: 0 }] } });
    if (path === '/status/sessions') return send({ MediaContainer: { size: 1, Metadata: [SESSION] } });
    if (path === '/status/sessions/terminate') return send(undefined);
    if (path === '/transcode/sessions') return send({ MediaContainer: { TranscodeSession: [SESSION.TranscodeSession] } });
    if (path === '/activities') return send({ MediaContainer: { Activity: [
      { uuid: '0f2c-11aa', type: 'library.update.section', cancellable: true, title: 'Scanning TV Shows', progress: 40 },
      { uuid: '0f2c-22bb', type: 'media.generate.bif', cancellable: false, title: 'Thumbnails' },
    ] } });
    if (path.startsWith('/activities/')) return send(undefined);
    if (path === '/butler') return send({ ButlerTasks: { ButlerTask: [{ name: 'CleanOldBundles', enabled: true, interval: 7 }] } });
    send({}, 404);
  });
  await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${stub.address().port}`;
});

after(async () => {
  await Promise.all(openClients.map((c) => c.close()));
  stub.close();
});

async function connect(env = {}) {
  const client = new Client({ name: 'plex-test', version: '1.0.0' });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    env: { PATH: process.env.PATH, PLEX_URL: baseUrl, PLEX_TOKEN: TOKEN, ...env },
  }));
  openClients.push(client);
  return client;
}

async function call(client, name, args = {}) {
  requests = [];
  const result = await client.callTool({ name, arguments: args });
  return { ...result, text: result.content[0].text, requests };
}

const WRITE = ['plex_scan_library', 'plex_refresh_metadata', 'plex_cancel_activity'];
const CONFIRM = ['plex_empty_trash', 'plex_terminate_session'];

test('Plex tools are listed with annotations; destructive ones need confirm', async () => {
  const client = await connect();
  const byName = Object.fromEntries((await client.listTools()).tools.map((t) => [t.name, t]));
  for (const read of ['plex_status', 'plex_get_libraries', 'plex_get_sessions', 'plex_get_transcode_sessions', 'plex_search',
    'plex_get_recently_added', 'plex_get_item', 'plex_get_activities', 'plex_get_butler_tasks']) {
    assert.equal(byName[read]?.annotations.readOnlyHint, true, read);
  }
  for (const w of WRITE) {
    assert.equal(byName[w].annotations.readOnlyHint, false, w);
    assert.equal(byName[w].annotations.destructiveHint, false, w);
  }
  for (const c of CONFIRM) {
    assert.equal(byName[c].annotations.destructiveHint, true, c);
    assert.ok(byName[c].inputSchema.required.includes('confirm'), c);
  }
  assert.match(byName.arr_status.description, /Plex \(Media Server\)/);
});

test('empty trash and terminate refuse to run without confirm', async () => {
  const client = await connect();
  const trash = await call(client, 'plex_empty_trash', { sectionId: 1 });
  assert.equal(trash.isError, true);
  assert.deepEqual(trash.requests, []);
  const stop = await call(client, 'plex_terminate_session', { sessionId: 'abc123sessionid' });
  assert.equal(stop.isError, true);
  assert.deepEqual(stop.requests, []);

  const ok = await call(client, 'plex_empty_trash', { sectionId: 1, confirm: true });
  assert.notEqual(ok.isError, true, ok.text);
  assert.deepEqual([ok.requests[0].method, ok.requests[0].url], ['PUT', '/library/sections/1/emptyTrash']);
});

test('terminate looks up the session and sends a cleaned, short reason', async () => {
  const client = await connect();
  const missing = await call(client, 'plex_terminate_session', { sessionId: 'nosuchsession', confirm: true });
  assert.equal(missing.isError, true);
  assert.ok(!missing.requests.some((r) => r.url.startsWith('/status/sessions/terminate')));

  const result = await call(client, 'plex_terminate_session', {
    sessionId: 'abc123sessionid', confirm: true, reason: `Please\nuse the 1080p version${'!'.repeat(300)}`,
  });
  assert.notEqual(result.isError, true, result.text);
  assert.deepEqual(JSON.parse(result.text).stopped, { user: 'henrik', title: 'Some Show S01E01 - Pilot', player: 'Living Room TV' });
  const url = new URL(result.requests.at(-1).url, baseUrl);
  assert.equal(url.pathname, '/status/sessions/terminate');
  assert.equal(url.searchParams.get('sessionId'), 'abc123sessionid');
  assert.ok(url.searchParams.get('reason').startsWith('Please use the 1080p version'));
  assert.equal(url.searchParams.get('reason').length, 200);
});

test('ARR_READ_ONLY hides and refuses Plex write tools', async () => {
  const client = await connect({ ARR_READ_ONLY: 'true' });
  const names = (await client.listTools()).tools.map((t) => t.name);
  assert.ok(names.includes('plex_get_sessions'));
  for (const hidden of [...WRITE, ...CONFIRM]) assert.ok(!names.includes(hidden), hidden);
  const refused = await call(client, 'plex_scan_library', { sectionId: 1 });
  assert.equal(refused.isError, true);
  assert.deepEqual(refused.requests, []);
});

test('arr_status reports Plex; the token goes in a header only', async () => {
  const client = await connect();
  const result = await call(client, 'arr_status');
  const status = JSON.parse(result.text);
  assert.deepEqual(status.plex, { configured: true, connected: true, version: '1.42.1.10060' });
  const req = result.requests.find((r) => r.url === '/');
  assert.equal(req.token, TOKEN);
  assert.equal(req.accept, 'application/json');

  await call(client, 'plex_get_libraries');
  const all = [...result.requests, ...requests];
  assert.ok(all.length > 2);
  assert.ok(all.every((r) => !r.url.includes(TOKEN) && !/plex-token/i.test(r.url)));
});

test('errors carry no token and no upstream body', async () => {
  const client = await connect();
  const failed = await call(client, 'plex_get_item', { ratingKey: '999' });
  assert.equal(failed.isError, true);
  assert.match(failed.text, /Plex API error: 500/);
  assert.ok(!failed.text.includes(TOKEN));
  assert.ok(!failed.text.includes('secret page body'));

  const bad = await connect({ PLEX_TOKEN: 'wrong-token-value-1234' });
  const denied = await call(bad, 'plex_status');
  assert.equal(denied.isError, true);
  assert.match(denied.text, /401 - check PLEX_TOKEN/);
  assert.ok(!denied.text.includes('wrong-token-value-1234'));
  const status = JSON.parse((await call(bad, 'arr_status')).text);
  assert.equal(status.plex.connected, false);
});

test('ids are validated before they reach the URL', async () => {
  const client = await connect();
  for (const ratingKey of ['../prefs', '1?x=y', '1/../../', '', 'abc']) {
    for (const tool of ['plex_get_item', 'plex_refresh_metadata']) {
      const r = await call(client, tool, { ratingKey });
      assert.equal(r.isError, true, `${tool} ${ratingKey}`);
      assert.deepEqual(r.requests, [], `${tool} ${ratingKey}`);
    }
  }
  const stop = await call(client, 'plex_terminate_session', { sessionId: 'a b&c=d', confirm: true });
  assert.equal(stop.isError, true);
  assert.deepEqual(stop.requests, []);
  const cancel = await call(client, 'plex_cancel_activity', { uuid: '../butler' });
  assert.equal(cancel.isError, true);
  assert.deepEqual(cancel.requests, []);
  const section = await call(client, 'plex_scan_library', { sectionId: 1.5 });
  assert.equal(section.isError, true);
  assert.deepEqual(section.requests, []);
});

test('scan a library, or a folder inside it; other paths are refused', async () => {
  const client = await connect();
  const whole = await call(client, 'plex_scan_library', { sectionId: 2 });
  assert.notEqual(whole.isError, true, whole.text);
  assert.deepEqual([whole.requests[0].method, whole.requests[0].url], ['GET', '/library/sections/2/refresh']);

  const folder = await call(client, 'plex_scan_library', { sectionId: 2, path: '/data/tv/Some Show', force: true });
  assert.notEqual(folder.isError, true, folder.text);
  assert.equal(folder.requests.at(-1).url, '/library/sections/2/refresh?path=%2Fdata%2Ftv%2FSome+Show&force=1');

  for (const path of ['/data/movies/x', '/data/tvfoo', '/data/tv/../movies', '/etc']) {
    const r = await call(client, 'plex_scan_library', { sectionId: 2, path });
    assert.equal(r.isError, true, path);
    assert.ok(!r.requests.some((q) => q.url.includes('/refresh')), path);
  }
});

test('sessions show the transcode decision with inferred reasons (AV1 -> H.264, DTS -> AAC)', async () => {
  const client = await connect();
  const result = await call(client, 'plex_get_sessions');
  assert.notEqual(result.isError, true, result.text);
  const data = JSON.parse(result.text);
  assert.equal(data.count, 1);
  assert.equal(data.transcoding, 1);
  assert.match(data.note, /inferred/i);
  const [s] = data.sessions;
  assert.equal(s.decision, 'transcode');
  assert.equal(s.sessionId, 'abc123sessionid');
  assert.equal(s.user, 'henrik');
  assert.equal(s.title, 'Some Show S01E01 - Pilot');
  assert.equal(s.player.device, 'Samsung TV');
  assert.equal(s.progressPercent, 25);
  assert.deepEqual(s.video, { decision: 'transcode', from: 'av1', to: 'h264' });
  assert.deepEqual(s.audio, { decision: 'transcode', from: 'dca', to: 'aac', channels: 2 });
  assert.ok(s.inferredReasons.some((r) => /av1.*h264/.test(r)));
  assert.ok(s.inferredReasons.some((r) => /dca.*aac/.test(r)));
  assert.equal(s.source.streams[0].codec, 'av1');
});

test('libraries come with item counts; item, search and others are summarised', async () => {
  const client = await connect();
  const libs = JSON.parse((await call(client, 'plex_get_libraries')).text);
  assert.deepEqual(libs.libraries.map((l) => [l.sectionId, l.itemCount, l.scanningNow]), [[1, 812, false], [2, 95, true]]);
  assert.deepEqual(libs.libraries[1].folders, ['/data/tv']);

  const item = JSON.parse((await call(client, 'plex_get_item', { ratingKey: '5001' })).text);
  assert.equal(item.media[0].parts[0].streams[1].codec, 'dca');
  assert.equal(item.media[0].parts[0].streams[1].channels, 6);

  const search = await call(client, 'plex_search', { query: 'new' });
  assert.equal(new URL(search.requests[0].url, baseUrl).searchParams.get('query'), 'new');
  const found = JSON.parse(search.text);
  assert.equal(found.count, 1);
  assert.equal(found.results[0].items[0].ratingKey, '7');

  const recent = await call(client, 'plex_get_recently_added', { limit: 5 });
  assert.equal(recent.requests[0].size, '5');
  assert.equal(JSON.parse(recent.text).items[0].title, 'New');

  assert.equal(JSON.parse((await call(client, 'plex_get_transcode_sessions')).text).sessions[0].video.from, 'av1');
  assert.equal(JSON.parse((await call(client, 'plex_get_butler_tasks')).text).tasks[0].name, 'CleanOldBundles');

  const refresh = await call(client, 'plex_refresh_metadata', { ratingKey: '5001', force: true });
  assert.deepEqual([refresh.requests[0].method, refresh.requests[0].url], ['PUT', '/library/metadata/5001/refresh?force=1']);
});

test('cancel activity checks it exists and is cancellable', async () => {
  const client = await connect();
  const ok = await call(client, 'plex_cancel_activity', { uuid: '0f2c-11aa' });
  assert.notEqual(ok.isError, true, ok.text);
  assert.deepEqual([ok.requests.at(-1).method, ok.requests.at(-1).url], ['DELETE', '/activities/0f2c-11aa']);
  const locked = await call(client, 'plex_cancel_activity', { uuid: '0f2c-22bb' });
  assert.equal(locked.isError, true);
  assert.match(locked.text, /cannot be cancelled/);
  assert.ok(!locked.requests.some((r) => r.method === 'DELETE'));
});

test('redactPlexToken removes tokens from text', () => {
  assert.equal(redactPlexToken('http://x/?X-Plex-Token=abc&y=1'), 'http://x/?X-Plex-Token=[REDACTED]&y=1');
  assert.equal(redactPlexToken('header x-plex-token: abc'), 'header x-plex-token: [REDACTED]');
  assert.equal(redactPlexToken(`oops ${TOKEN} here`, TOKEN), 'oops [REDACTED] here');
});
