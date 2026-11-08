#!/usr/bin/env node
/**
 * Maintainerr tool tests. Runs dist/index.js against a local stub that answers
 * like Maintainerr, so no real service is contacted. Build first: npm run build
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const entry = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js');
const DUMMY_KEY = 'dummy-maintainerr-key-0123';

let stub;
let baseUrl;
let requests = [];
const openClients = [];

const COLLECTION = {
  id: 1, title: 'Leaving Soon', type: 'movie', libraryId: '1', isActive: true,
  arrAction: 0, deleteAfterDays: 15, totalSizeBytes: 10 * 1024 ** 3, mediaCount: 1, media: [],
};

before(async () => {
  stub = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : undefined, key: req.headers['x-api-key'] });
      res.setHeader('Content-Type', 'application/json');
      const send = (data, status = 200) => { res.statusCode = status; res.end(JSON.stringify(data)); };
      const path = req.url.split('?')[0];
      if (path === '/api/app/status') return send({ status: 1, version: '3.32.0' });
      if (path === '/api/health') return send({ status: 'ok', database: 'ok', uptimeSeconds: 5 });
      if (path === '/api/rules/execute/status') return send({ processingQueue: false, executingRuleGroupId: null, pendingRuleGroupIds: [] });
      if (path === '/api/collections') return send([COLLECTION]);
      if (path === '/api/collections/media/1/content/1') {
        return send({
          totalSize: 1,
          items: [{
            id: 9, collectionId: 1, mediaServerId: '102042', addDate: '2026-11-02T23:00:00.000Z',
            isManual: false, sizeBytes: 1024 ** 3, mediaData: { title: 'Love Me', year: 2025, type: 'movie' },
          }],
        });
      }
      if (path === '/api/rules/execute') return send({ message: 'The rule executor is already running', statusCode: 409 }, 409);
      if (path === '/api/rules/exclusion' && req.method === 'POST') {
        const parsed = JSON.parse(body);
        return send(parsed.collectionId === 99 ? { code: 0, result: 'Failed - no rule group' } : { code: 1, result: 'Success' }, 201);
      }
      if (path === '/api/collections/media/postpone') return send({ addDate: '2026-11-08', deleteAfterDays: 15, deletionDate: '2026-11-23' });
      send({});
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
  const client = new Client({ name: 'maintainerr-test', version: '1.0.0' });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    env: { PATH: process.env.PATH, MAINTAINERR_URL: baseUrl, MAINTAINERR_API_KEY: DUMMY_KEY, ...env },
  }));
  openClients.push(client);
  return client;
}

async function call(client, name, args = {}) {
  requests = [];
  const result = await client.callTool({ name, arguments: args });
  return { ...result, text: result.content[0].text, requests };
}

test('Maintainerr tools are listed, with the handler guarded by confirm', async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  assert.ok(byName.maintainerr_get_collections);
  assert.equal(byName.maintainerr_get_collections.annotations.readOnlyHint, true);
  assert.equal(byName.maintainerr_postpone_deletion.annotations.readOnlyHint, false);
  const handler = byName.maintainerr_handle_collections;
  assert.equal(handler.annotations.destructiveHint, true);
  assert.ok(handler.inputSchema.required.includes('confirm'));

  const refused = await call(client, 'maintainerr_handle_collections', {});
  assert.equal(refused.isError, true);
  assert.deepEqual(refused.requests, []);
  const ok = await call(client, 'maintainerr_handle_collections', { confirm: true });
  assert.notEqual(ok.isError, true, ok.text);
  assert.equal(ok.requests[0].method, 'POST');
  assert.equal(ok.requests[0].url, '/api/collections/handle');
});

test('ARR_READ_ONLY hides Maintainerr write tools', async () => {
  const client = await connect({ ARR_READ_ONLY: 'true' });
  const names = (await client.listTools()).tools.map((t) => t.name);
  assert.ok(names.includes('maintainerr_get_collection_media'));
  for (const hidden of ['maintainerr_run_rules', 'maintainerr_postpone_deletion', 'maintainerr_exclude_media', 'maintainerr_handle_collections']) {
    assert.ok(!names.includes(hidden), hidden);
  }
});

test('status sends the API key header and reports the version', async () => {
  const client = await connect();
  const result = await call(client, 'arr_status');
  const status = JSON.parse(result.text);
  assert.equal(status.maintainerr.connected, true);
  assert.equal(status.maintainerr.version, '3.32.0');
  assert.equal(result.requests[0].key, DUMMY_KEY);
});

test('collection media includes the deletion date', async () => {
  const client = await connect();
  const result = await call(client, 'maintainerr_get_collection_media', { collectionId: 1 });
  assert.notEqual(result.isError, true, result.text);
  const data = JSON.parse(result.text);
  assert.equal(data.items[0].mediaId, '102042');
  assert.equal(data.items[0].title, 'Love Me');
  assert.equal(data.items[0].deletionDate, '2026-11-17T23:00:00.000Z');
  assert.ok(result.requests.some((r) => r.url === '/api/collections/media/1/content/1?size=25'));
});

test('mediaId cannot redirect the request to another endpoint', async () => {
  const client = await connect();
  for (const mediaId of ['../settings', '1?x=y', '1/../../rules', '']) {
    const result = await call(client, 'maintainerr_get_media_status', { mediaId });
    assert.equal(result.isError, true, mediaId);
    assert.deepEqual(result.requests, [], mediaId);
  }
});

test('postpone sends a JSON body and enforces the day range', async () => {
  const client = await connect();
  const tooMany = await call(client, 'maintainerr_postpone_deletion', { collectionId: 1, mediaId: '102042', days: 4000 });
  assert.equal(tooMany.isError, true);
  assert.deepEqual(tooMany.requests, []);

  const result = await call(client, 'maintainerr_postpone_deletion', { collectionId: 1, mediaId: '102042', days: 30 });
  assert.notEqual(result.isError, true, result.text);
  assert.deepEqual(result.requests[0].body, { collectionId: 1, mediaId: '102042', days: 30 });
  assert.equal(JSON.parse(result.text).deletionDate, '2026-11-23');
});

test('exclusions report a refused change as an error', async () => {
  const client = await connect();
  const ok = await call(client, 'maintainerr_exclude_media', { mediaId: 'abc-123' });
  assert.notEqual(ok.isError, true, ok.text);
  assert.deepEqual(ok.requests[0].body, { mediaId: 'abc-123', action: 0 });

  const removed = await call(client, 'maintainerr_remove_exclusion', { mediaId: 'abc-123', collectionId: 1 });
  assert.deepEqual(removed.requests[0].body, { mediaId: 'abc-123', collectionId: 1, action: 1 });

  const refused = await call(client, 'maintainerr_exclude_media', { mediaId: 'abc-123', collectionId: 99 });
  assert.equal(refused.isError, true);
  assert.match(refused.text, /no rule group/);
});

test('Maintainerr conflict messages are passed on', async () => {
  const client = await connect();
  const result = await call(client, 'maintainerr_run_rules', {});
  assert.equal(result.isError, true);
  assert.match(result.text, /409.*already running/);
});
