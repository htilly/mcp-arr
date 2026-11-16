#!/usr/bin/env node
/**
 * SABnzbd tests against a local stub that answers like SABnzbd's /api, so no
 * real service is contacted. The MCP tests run dist/index.js over stdio; the
 * client tests pin the exact request shapes. Build first: npm run build
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const { SabnzbdClient } = await import(pathToFileURL(join(dist, 'sabnzbd-client.js')).href);
const entry = join(dist, 'index.js');
const openClients = [];

const API_KEY = 'dummysabnzbdkey0123456789abcdef';
const NZO = 'SABnzbd_nzo_ab12cd34';

let stub;
let baseUrl;
let requests = [];

const QUEUE = {
  status: 'Downloading', paused: false, pause_int: '0', sizeleft: '580 MB', timeleft: '0:00:00', speed: '0 ', kbpersec: '0.00', speedlimit: '100', speedlimit_abs: '',
  diskspace1: '120.5', diskspace2: '980.1', noofslots: 1, version: '4.5.1',
  slots: [{ nzo_id: NZO, filename: 'Some.Show.S01E01', status: 'Downloading', percentage: '42', mb: '1000', mbleft: '580', timeleft: '0:00:00', cat: 'tv' }],
};

before(async () => {
  stub = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const q = Object.fromEntries(url.searchParams);
    requests.push({ path: url.pathname, q });
    res.setHeader('Content-Type', 'application/json');
    const send = (d) => res.end(JSON.stringify(d));
    if (url.pathname !== '/api') { res.statusCode = 404; return res.end('{}'); }
    if (q.mode === 'version') return send({ version: '4.5.1' }); // works without a key in SABnzbd too
    if (q.apikey !== API_KEY) return send({ status: false, error: 'API Key Incorrect' });
    switch (q.mode) {
      case 'queue':
        if (q.name) return send({ status: true, nzo_ids: (q.value ?? '').split(',') });
        return send({ queue: QUEUE });
      case 'history':
        if (q.name === 'delete') return send({ status: true });
        return send({ history: { noofslots: 1, slots: [{ nzo_id: 'SABnzbd_nzo_failed1', name: 'Broken.Release', status: 'Failed', fail_message: 'Repair failed, not enough repair blocks', retry: 1 }] } });
      case 'pause': case 'resume': case 'retry_all': return send({ status: true });
      case 'retry': return send({ status: true, nzo_id: q.value });
      case 'config':
        if (q.name === 'speedlimit' || q.name === 'set_pause') return send({ status: true });
        return send({ status: false, error: 'not implemented' });
    }
    return send({ status: false, error: 'not implemented' });
  });
  await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${stub.address().port}`;
});

after(async () => {
  await Promise.all(openClients.map((c) => c.close()));
  stub.close();
});

async function connect(env = {}) {
  const client = new Client({ name: 'sabnzbd-test', version: '1.0.0' });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    env: { PATH: process.env.PATH, SABNZBD_URL: baseUrl, SABNZBD_API_KEY: API_KEY, ...env },
  }));
  openClients.push(client);
  return client;
}

async function call(client, name, args = {}) {
  requests = [];
  const result = await client.callTool({ name, arguments: args });
  return { ...result, text: result.content[0].text, requests };
}
beforeEach(() => { requests = []; });

const sab = () => new SabnzbdClient({ url: baseUrl + '/', apiKey: API_KEY });

test('every call sends mode, output=json and apikey', async () => {
  assert.equal(await sab().getVersion(), '4.5.1');
  const queue = await sab().getQueue({ start: 0, limit: 20 });
  assert.equal(queue.slots[0].nzo_id, NZO);
  assert.equal(requests[1].path, '/api');
  assert.deepEqual(requests[1].q, { mode: 'queue', output: 'json', apikey: API_KEY, start: '0', limit: '20' });
});

test('a wrong API key becomes a 401 error without the key', async () => {
  const bad = new SabnzbdClient({ url: baseUrl, apiKey: 'wrong-key-12345' });
  await assert.rejects(bad.getQueue(), (err) => {
    assert.match(err.message, /SABnzbd API error: 401 - check SABNZBD_API_KEY/);
    assert.ok(!err.message.includes('wrong-key-12345'));
    return true;
  });
});

test('other SABnzbd refusals are passed on briefly', async () => {
  await assert.rejects(sab().request('config', { name: 'nope' }), /SABnzbd API error: 400 - not implemented/);
});

test('history can be limited to failed jobs', async () => {
  const history = await sab().getHistory({ failedOnly: true, limit: 10 });
  assert.equal(history.slots[0].status, 'Failed');
  assert.equal(requests[0].q.failed_only, '1');
  assert.equal(requests[0].q.limit, '10');
});

test('global and per-item pause/resume', async () => {
  await sab().pauseAll();
  await sab().pauseAll(30);
  await sab().resumeAll();
  await sab().pauseItems([NZO, 'SABnzbd_nzo_x2']);
  await sab().resumeItems([NZO]);
  assert.deepEqual(requests.map(({ q }) => [q.mode, q.name, q.value]), [
    ['pause', undefined, undefined],
    ['config', 'set_pause', '30'],
    ['resume', undefined, undefined],
    ['queue', 'pause', `${NZO},SABnzbd_nzo_x2`],
    ['queue', 'resume', NZO],
  ]);
});

test('nzo ids are validated before any request', async () => {
  for (const bad of [[], ['a,b'], ['x&mode=shutdown'], ['../']]) {
    await assert.rejects(sab().deleteQueueItems(bad, false));
  }
  assert.deepEqual(requests, []);
});

test('delete from queue and history, with and without files', async () => {
  await sab().deleteQueueItems([NZO], true);
  await sab().deleteHistoryItems(['SABnzbd_nzo_failed1'], false);
  assert.deepEqual(requests.map(({ q }) => [q.mode, q.name, q.value, q.del_files]), [
    ['queue', 'delete', NZO, '1'],
    ['history', 'delete', 'SABnzbd_nzo_failed1', '0'],
  ]);
});

test('retry one or all failed jobs', async () => {
  await sab().retry('SABnzbd_nzo_failed1');
  await sab().retryAll();
  assert.deepEqual(requests.map(({ q }) => [q.mode, q.value]), [['retry', 'SABnzbd_nzo_failed1'], ['retry_all', undefined]]);
});

test('speed limit accepts percent or K/M values only', async () => {
  await sab().setSpeedLimit('50');
  await sab().setSpeedLimit('50%');
  await sab().setSpeedLimit('5m');
  await sab().setSpeedLimit('800K');
  assert.deepEqual(requests.map(({ q }) => q.value), ['50', '50', '5M', '800K']);
  for (const bad of ['fast', '5G', '-1', '1&x=y']) {
    await assert.rejects(sab().setSpeedLimit(bad), /Speed limit/);
  }
});

test('stuck detection on queue slots', () => {
  const r = (slot, queue = QUEUE) => SabnzbdClient.queueStuckReason({ ...QUEUE.slots[0], ...slot }, queue);
  assert.match(r({}), /0 KB\/s/);
  assert.equal(r({}, { ...QUEUE, kbpersec: '1200.5' }), undefined);
  assert.equal(r({}, { ...QUEUE, paused: true }), undefined);
  assert.match(r({ status: 'Grabbing' }), /waiting for the NZB/);
  assert.match(r({ status: 'Propagating' }), /propagation/);
  assert.equal(r({ status: 'Queued' }), undefined);
});

// ---------- MCP level (dist/index.js over stdio) ----------

test('MCP: tools are listed with annotations, deletes need confirm', async () => {
  const client = await connect();
  const byName = Object.fromEntries((await client.listTools()).tools.map((t) => [t.name, t]));
  for (const n of ['sabnzbd_status', 'sabnzbd_get_queue', 'sabnzbd_get_history', 'sabnzbd_pause', 'sabnzbd_resume',
    'sabnzbd_set_speed_limit', 'sabnzbd_retry_failed', 'sabnzbd_delete_queue_item', 'sabnzbd_delete_history_item']) {
    assert.ok(byName[n], n);
  }
  assert.equal(byName.sabnzbd_get_history.annotations.readOnlyHint, true);
  assert.equal(byName.sabnzbd_pause.annotations.readOnlyHint, false);
  for (const n of ['sabnzbd_delete_queue_item', 'sabnzbd_delete_history_item']) {
    assert.equal(byName[n].annotations.destructiveHint, true, n);
    assert.ok(byName[n].inputSchema.required.includes('confirm'), n);
    const refused = await call(client, n, { nzoIds: [NZO] });
    assert.equal(refused.isError, true);
    assert.deepEqual(refused.requests, []);
  }
  const ok = await call(client, 'sabnzbd_delete_queue_item', { nzoIds: [NZO], deleteFiles: true, confirm: true });
  assert.notEqual(ok.isError, true, ok.text);
  assert.deepEqual([ok.requests[0].q.mode, ok.requests[0].q.name, ok.requests[0].q.value, ok.requests[0].q.del_files], ['queue', 'delete', NZO, '1']);
});

test('MCP: ARR_READ_ONLY hides write and delete tools', async () => {
  const client = await connect({ ARR_READ_ONLY: 'true' });
  const names = (await client.listTools()).tools.map((t) => t.name);
  assert.ok(names.includes('sabnzbd_get_queue'));
  for (const hidden of ['sabnzbd_pause', 'sabnzbd_resume', 'sabnzbd_set_speed_limit', 'sabnzbd_retry_failed', 'sabnzbd_delete_queue_item', 'sabnzbd_delete_history_item']) {
    assert.ok(!names.includes(hidden), hidden);
  }
});

test('MCP: arr_status reports the version and catches a wrong key without leaking it', async () => {
  const ok = JSON.parse((await call(await connect(), 'arr_status')).text).sabnzbd;
  assert.deepEqual(ok, { configured: true, connected: true, version: '4.5.1' });

  const wrong = 'wrong-sab-key-9876543210';
  const client = await connect({ SABNZBD_API_KEY: wrong });
  const bad = JSON.parse((await call(client, 'arr_status')).text).sabnzbd;
  assert.equal(bad.connected, false);
  assert.match(bad.error, /401 - check SABNZBD_API_KEY/);
  const queue = await call(client, 'sabnzbd_get_queue');
  assert.equal(queue.isError, true);
  assert.ok(!queue.text.includes(wrong) && !bad.error.includes(wrong));
});

test('MCP: SABnzbd without an API key is not enabled', async () => {
  const client = await connect({ SABNZBD_API_KEY: '' });
  const names = (await client.listTools()).tools.map((t) => t.name);
  assert.ok(!names.some((n) => n.startsWith('sabnzbd_')));
});

test('MCP: stuck queue jobs and failed history jobs are easy to find', async () => {
  const client = await connect();
  const queue = JSON.parse((await call(client, 'sabnzbd_get_queue', { stuckOnly: true })).text);
  assert.equal(queue.total, 1);
  assert.equal(queue.jobs[0].nzoId, NZO);
  assert.match(queue.jobs[0].stuck, /0 KB\/s/);
  assert.equal(queue.jobs[0].progress, '42%');

  const history = await call(client, 'sabnzbd_get_history', { failedOnly: true });
  assert.equal(history.requests[0].q.failed_only, '1');
  const h = JSON.parse(history.text);
  assert.equal(h.failedCount, 1);
  assert.match(h.jobs[0].failMessage, /repair blocks/);
  assert.equal(h.jobs[0].canRetry, true);

  const retry = await call(client, 'sabnzbd_retry_failed', { nzoId: 'SABnzbd_nzo_failed1' });
  assert.notEqual(retry.isError, true, retry.text);
  assert.equal(retry.requests[0].q.mode, 'retry');
});

test('MCP: status, pause for minutes, speed limit validation', async () => {
  const client = await connect();
  const status = JSON.parse((await call(client, 'sabnzbd_status')).text);
  assert.equal(status.version, '4.5.1');
  assert.equal(status.paused, false);
  assert.equal(status.speedLimit, 'none');
  assert.equal(status.freeDiskIncomplete, '120.5 GB');

  const paused = await call(client, 'sabnzbd_pause', { minutes: 15 });
  assert.deepEqual([paused.requests[0].q.mode, paused.requests[0].q.name, paused.requests[0].q.value], ['config', 'set_pause', '15']);
  const mixed = await call(client, 'sabnzbd_pause', { nzoIds: [NZO], minutes: 5 });
  assert.equal(mixed.isError, true);
  assert.deepEqual(mixed.requests, []);

  const bad = await call(client, 'sabnzbd_set_speed_limit', { limit: '5G' });
  assert.equal(bad.isError, true);
  assert.deepEqual(bad.requests, []);
  const good = await call(client, 'sabnzbd_set_speed_limit', { limit: '5M' });
  assert.notEqual(good.isError, true, good.text);
  assert.equal(good.requests[0].q.value, '5M');
});
