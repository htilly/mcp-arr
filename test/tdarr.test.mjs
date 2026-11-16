#!/usr/bin/env node
/**
 * Tdarr tool tests. Runs dist/index.js against a local stub that answers like
 * Tdarr, so no real service is contacted. Build first: npm run build
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const entry = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js');
const DUMMY_KEY = 'tapi_dummy-tdarr-key-0123456789';

const stream = (codec_type, codec_name, extra = {}) => ({ codec_type, codec_name, ...extra });
const FILES = [
  {
    _id: '/media/movies/A (2024)/A.mkv', file: '/media/movies/A (2024)/A.mkv', DB: 'lib1', container: 'mkv',
    file_size: 4200.5, video_codec_name: 'av1', video_resolution: '2160p',
    TranscodeDecisionMaker: 'Not required', HealthCheck: 'Success',
    ffProbeData: { streams: [stream('video', 'av1'), stream('audio', 'eac3', { channels: 6, tags: { language: 'eng' } })] },
  },
  {
    // DTS only in the second audio track
    _id: '/media/movies/B (2019)/B.mkv', file: '/media/movies/B (2019)/B.mkv', DB: 'lib1', container: 'mkv',
    file_size: 9000, video_codec_name: 'h264', video_resolution: '1080p',
    TranscodeDecisionMaker: 'Transcode success', HealthCheck: 'Success',
    ffProbeData: { streams: [stream('video', 'h264'), stream('audio', 'aac'), stream('audio', 'dts', { channels: 6 })] },
  },
  {
    _id: '/media/tv/C/S01E01.mp4', file: '/media/tv/C/S01E01.mp4', DB: 'lib2', container: 'mp4',
    file_size: 800, video_codec_name: 'h264', video_resolution: '720p',
    TranscodeDecisionMaker: 'Not required', HealthCheck: 'Success',
    ffProbeData: { streams: [stream('video', 'h264'), stream('audio', 'aac')] },
  },
  {
    _id: '/media/tv/D/S02E03.mkv', file: '/media/tv/D/S02E03.mkv', DB: 'lib2', container: 'mkv',
    file_size: 2100, video_codec_name: 'av1', video_resolution: '1080p',
    TranscodeDecisionMaker: 'Transcode error', HealthCheck: 'Success',
    ffProbeData: { streams: [stream('video', 'av1'), stream('audio', 'truehd'), stream('audio', 'dts')] },
  },
];
// Many AV1 files, to hit the requeue cap.
const BULK = Array.from({ length: 130 }, (_, i) => ({
  _id: `/media/bulk/${i}.mkv`, file: `/media/bulk/${i}.mkv`, DB: 'lib3', container: 'mkv', file_size: 100,
  video_codec_name: 'av1', TranscodeDecisionMaker: 'Not required', HealthCheck: 'Success',
  ffProbeData: { streams: [stream('video', 'av1'), stream('audio', 'aac')] },
}));

let stub;
let baseUrl;
let requests = [];
let requireKey = false;
const openClients = [];

before(async () => {
  stub = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const parsed = body ? JSON.parse(body) : undefined;
      requests.push({ method: req.method, url: req.url, body: parsed, key: req.headers['x-api-key'] });
      res.setHeader('Content-Type', 'application/json');
      const send = (data, status = 200) => { res.statusCode = status; res.end(typeof data === 'string' ? data : JSON.stringify(data)); };
      if (requireKey && req.headers['x-api-key'] !== DUMMY_KEY) return send('Unauthorized: stub secret detail', 401);
      switch (req.url) {
        case '/api/v2/status':
          return send({ status: 'good', isProduction: true, os: 'linux', version: '2.58.02', uptime: 1234 });
        case '/api/v2/get-nodes':
          return send({
            node_1: {
              _id: 'node_1', nodeName: 'gpu-box', nodePaused: false,
              workers: { w1: { _id: 'w1', file: FILES[0]._id, fps: 87, percentage: 41.53, ETA: '0:12:03', status: 'Processing', workerType: 'transcodegpu', job: { type: 'transcode' } } },
            },
            node_2: { _id: 'node_2', nodeName: 'cpu-box', nodePaused: true, workers: {} },
          });
        case '/api/v2/cruddb': {
          const { collection, mode, docID } = parsed.data;
          if (collection === 'LibrarySettingsJSONDB' && mode === 'getAll') {
            return send([{ _id: 'lib1', name: 'Movies', folder: '/media/movies', processLibrary: true, flowId: 'flow_h264_aac' }]);
          }
          if (collection === 'StatisticsJSONDB' && mode === 'getAll') return send([{ totalFileCount: 4, totalTranscodeCount: 9, sizeDiff: 12.345 }]);
          if (collection === 'StagedJSONDB') return send([FILES[1]]);
          if (collection === 'FileJSONDB' && mode === 'getById') return send(FILES.find((f) => f._id === docID) ?? {});
          return send('bad request', 400);
        }
        case '/api/v2/stats/get-pies':
          return send({
            pieStats: {
              totalFiles: 4, sizeDiff: 12.345,
              status: { transcode: [{ name: 'Not required', value: 2 }, { name: 'Transcode error', value: 1 }] },
              video: { codecs: [{ name: 'h264', value: 2 }, { name: 'av1', value: 2 }] },
              audio: { codecs: [{ name: 'dts', value: 2 }] },
            },
          });
        case '/api/v2/client/status-tables':
          return send({ array: [FILES[3]], totalCount: parsed.data.opts.table === 'table1' ? 7 : 2 });
        case '/api/v2/search-db': {
          const s = String(parsed.data.string).toLowerCase();
          return send([...FILES, ...BULK].filter((f) => f._id.toLowerCase().includes(s)));
        }
        case '/api/v2/bulk-update-files':
        case '/api/v2/update-node':
          return send('OK');
        default:
          return send('no route xyz', 404);
      }
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
  const client = new Client({ name: 'tdarr-test', version: '1.0.0' });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    env: { PATH: process.env.PATH, TDARR_URL: baseUrl, ...env },
  }));
  openClients.push(client);
  return client;
}

async function call(client, name, args = {}) {
  requests = [];
  const result = await client.callTool({ name, arguments: args });
  return { ...result, text: result.content[0].text, requests };
}

test('URL alone enables Tdarr; tools carry annotations and requeue needs confirm', async () => {
  const client = await connect();
  const byName = Object.fromEntries((await client.listTools()).tools.map((t) => [t.name, t]));
  for (const name of ['tdarr_status', 'tdarr_get_libraries', 'tdarr_get_nodes', 'tdarr_search_files', 'tdarr_get_file',
    'tdarr_get_queue', 'tdarr_get_staged', 'tdarr_get_stats', 'tdarr_requeue_files', 'tdarr_set_node_paused']) {
    assert.ok(byName[name], name);
  }
  assert.equal(byName.tdarr_search_files.annotations.readOnlyHint, true);
  assert.match(byName.tdarr_search_files.description, /AV1.*DTS/s);
  assert.equal(byName.tdarr_set_node_paused.annotations.readOnlyHint, false);
  const requeue = byName.tdarr_requeue_files;
  assert.equal(requeue.annotations.readOnlyHint, false);
  assert.equal(requeue.annotations.destructiveHint, true);
  assert.ok(requeue.inputSchema.required.includes('confirm'));
  assert.match(requeue.description, /H\.264.*AAC.*flow or plugins/s);
  assert.match(byName.arr_status.description, /Tdarr/);
});

test('ARR_READ_ONLY hides and refuses Tdarr write tools', async () => {
  const client = await connect({ ARR_READ_ONLY: 'true' });
  const names = (await client.listTools()).tools.map((t) => t.name);
  assert.ok(names.includes('tdarr_search_files'));
  assert.ok(!names.includes('tdarr_requeue_files'));
  assert.ok(!names.includes('tdarr_set_node_paused'));
  const refused = await call(client, 'tdarr_set_node_paused', { nodeId: 'node_1', paused: true });
  assert.equal(refused.isError, true);
  assert.deepEqual(refused.requests, []);
});

test('arr_status reports Tdarr without an API key header', async () => {
  const client = await connect();
  const result = await call(client, 'arr_status');
  const status = JSON.parse(result.text);
  assert.equal(status.tdarr.connected, true);
  assert.equal(status.tdarr.version, '2.58.02');
  assert.equal(result.requests.find((r) => r.url === '/api/v2/status').key, undefined);
});

test('the API key is sent when set and never appears in errors', async () => {
  requireKey = true;
  try {
    const ok = await connect({ TDARR_API_KEY: DUMMY_KEY });
    const status = await call(ok, 'tdarr_status');
    assert.notEqual(status.isError, true, status.text);
    assert.ok(status.requests.every((r) => r.key === DUMMY_KEY));
    const data = JSON.parse(status.text);
    assert.equal(data.version, '2.58.02');
    assert.equal(data.nodes, 2);
    assert.equal(data.nodesPaused, 1);
    assert.equal(data.activeWorkers, 1);
    assert.equal(data.transcodeQueue, 7);
    assert.equal(data.healthCheckQueue, 2);

    const missing = await connect();
    const noKey = await call(missing, 'tdarr_get_nodes');
    assert.equal(noKey.isError, true);
    assert.match(noKey.text, /Tdarr API error: 401.*TDARR_API_KEY/);
    assert.doesNotMatch(noKey.text, /stub secret detail/);

    const wrongKey = 'tapi_wrong-key-abcdefghijkl';
    const wrong = await connect({ TDARR_API_KEY: wrongKey });
    const bad = await call(wrong, 'tdarr_get_nodes');
    assert.equal(bad.isError, true);
    assert.match(bad.text, /401 - check TDARR_API_KEY/);
    assert.ok(!bad.text.includes(wrongKey));
  } finally {
    requireKey = false;
  }
});

test('search finds AV1 video or DTS audio, including a DTS second track', async () => {
  const client = await connect();
  const result = await call(client, 'tdarr_search_files', { videoCodecs: ['av1'], audioCodecs: ['dts'], path: '/media/movies' });
  assert.notEqual(result.isError, true, result.text);
  const data = JSON.parse(result.text);
  assert.equal(data.matched, 2);
  assert.equal(data.scanned, 2);
  const b = data.files.find((f) => f.id === FILES[1]._id);
  assert.deepEqual(b.audioCodecs, ['aac', 'dts']);
  assert.equal(b.videoCodec, 'h264');
  assert.equal(b.resolution, '1080p');
  assert.deepEqual(result.requests[0].body, { data: { string: '/media/movies', greaterThanGB: 0, lessThanGB: 1_000_000 } });

  const both = JSON.parse((await call(client, 'tdarr_search_files', { videoCodecs: ['av1'], audioCodecs: ['dts'], match: 'all' })).text);
  assert.deepEqual(both.files.map((f) => f.id), [FILES[3]._id]);

  const limited = JSON.parse((await call(client, 'tdarr_search_files', { videoCodecs: ['av1'], limit: 5 })).text);
  assert.equal(limited.matched, 132);
  assert.equal(limited.returned, 5);
  assert.equal(limited.hasMore, true);
});

test('filter input is validated before anything reaches Tdarr', async () => {
  const client = await connect();
  const bad = [
    { videoCodecs: ['av1"; drop'] },
    { audioCodecs: [{ $ne: null }] },
    { audioCodecs: 'dts' },
    { libraryId: '../x' },
    { path: 'a\u0000b' },
    { transcodeStatus: 'Queued"}' },
    { match: 'either' },
    { minSizeGB: -1 },
    { limit: 1000 },
  ];
  for (const args of bad) {
    const result = await call(client, 'tdarr_search_files', args);
    assert.equal(result.isError, true, JSON.stringify(args));
    assert.deepEqual(result.requests, [], JSON.stringify(args));
  }
  const node = await call(client, 'tdarr_set_node_paused', { nodeId: '../node', paused: true });
  assert.equal(node.isError, true);
  assert.deepEqual(node.requests, []);
});

test('requeue needs confirm, is capped at 100 and reports how many matched', async () => {
  const client = await connect();
  const refused = await call(client, 'tdarr_requeue_files', { videoCodecs: ['av1'] });
  assert.equal(refused.isError, true);
  assert.deepEqual(refused.requests, []);

  const tooMany = await call(client, 'tdarr_requeue_files', { videoCodecs: ['av1'], max: 500, confirm: true });
  assert.equal(tooMany.isError, true);
  assert.deepEqual(tooMany.requests, []);

  const result = await call(client, 'tdarr_requeue_files', { videoCodecs: ['av1'], audioCodecs: ['dts'], confirm: true });
  assert.notEqual(result.isError, true, result.text);
  const data = JSON.parse(result.text);
  assert.equal(data.matched, 133);
  assert.equal(data.requeued, 100);
  assert.equal(data.skipped, 33);
  assert.match(data.message, /100 of 133/);
  const update = result.requests.find((r) => r.url === '/api/v2/bulk-update-files');
  assert.equal(update.body.data.fileIds.length, 100);
  assert.deepEqual(update.body.data.updatedObj, { TranscodeDecisionMaker: 'Queued' });
});

test('requeue by ids, health check mode, and refusal of an empty filter', async () => {
  const client = await connect();
  const byIds = await call(client, 'tdarr_requeue_files', { fileIds: [FILES[0]._id, FILES[0]._id, FILES[3]._id], healthCheck: true, confirm: true });
  assert.notEqual(byIds.isError, true, byIds.text);
  assert.equal(JSON.parse(byIds.text).requeued, 2);
  assert.deepEqual(byIds.requests[0].body.data, { fileIds: [FILES[0]._id, FILES[3]._id], updatedObj: { HealthCheck: 'Queued' } });

  for (const args of [{}, { minSizeGB: 1 }, { fileIds: [FILES[0]._id], audioCodecs: ['dts'] }]) {
    const result = await call(client, 'tdarr_requeue_files', { ...args, confirm: true });
    assert.equal(result.isError, true, JSON.stringify(args));
    assert.ok(!result.requests.some((r) => r.url === '/api/v2/bulk-update-files'), JSON.stringify(args));
  }
});

test('libraries, nodes, pause, queue, staged, stats and file details', async () => {
  const client = await connect();
  const libs = JSON.parse((await call(client, 'tdarr_get_libraries')).text);
  assert.equal(libs.libraries[0].flowId, 'flow_h264_aac');
  assert.equal(libs.libraries[0].totalFiles, 4);
  assert.deepEqual(libs.libraries[0].videoCodecs, { h264: 2, av1: 2 });

  const nodes = JSON.parse((await call(client, 'tdarr_get_nodes')).text).nodes;
  assert.equal(nodes[0].workers[0].progressPercent, 41.5);
  assert.equal(nodes[0].workers[0].fps, 87);
  assert.equal(nodes[1].paused, true);

  const pause = await call(client, 'tdarr_set_node_paused', { nodeId: 'node_2', paused: false });
  assert.notEqual(pause.isError, true, pause.text);
  assert.deepEqual(pause.requests[0].body, { data: { nodeID: 'node_2', nodeUpdates: { nodePaused: false } } });

  const queue = await call(client, 'tdarr_get_queue', { table: 'transcode_error', libraryId: 'lib2' });
  assert.deepEqual(queue.requests[0].body.data.opts, { table: 'table3', dbID: 'lib2' });
  assert.equal(JSON.parse(queue.text).files[0].videoCodec, 'av1');

  const staged = JSON.parse((await call(client, 'tdarr_get_staged')).text);
  assert.equal(staged.count, 1);

  const stats = JSON.parse((await call(client, 'tdarr_get_stats')).text);
  assert.equal(stats.spaceSavedGB, 12.35);
  assert.deepEqual(stats.audioCodecs, { dts: 2 });
  assert.equal(stats.global.transcodesDone, 9);

  const file = JSON.parse((await call(client, 'tdarr_get_file', { fileId: FILES[0]._id })).text);
  assert.deepEqual(file.streams[1], { type: 'audio', codec: 'eac3', channels: 6, language: 'eng' });
  const missing = await call(client, 'tdarr_get_file', { fileId: '/nope.mkv' });
  assert.equal(missing.isError, true);
});
