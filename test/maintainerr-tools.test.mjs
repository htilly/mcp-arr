import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture, data } from './helpers/mock-mcp.mjs';

const COLLECTION = { id: 1, title: 'Leaving Soon', type: 'movie', arrAction: 0, deleteAfterDays: 15, totalSizeBytes: 10 * 1024 ** 3, mediaCount: 1 };
const ITEM = { id: 9, collectionId: 1, mediaServerId: '102042', addDate: '2026-11-02T23:00:00.000Z', sizeBytes: 1024 ** 3, mediaData: { title: 'Love Me', year: 2025, type: 'movie' } };

function maintainerr(call) {
  const path = call.path.split('?')[0];
  if (path === '/api/app/status') return { version: '2.20.0' };
  if (path === '/api/collections') return [COLLECTION];
  if (path === '/api/collections/media/1/content/1') return { totalSize: 1, items: [ITEM] };
  if (path === '/api/rules/exclusion' && call.method === 'POST') {
    return call.body.collectionId === 99 ? { code: 0, result: 'Failed - no rule group' } : { code: 1, result: 'Success' };
  }
  if (path === '/api/collections/media/postpone') return { deletionDate: '2026-12-01' };
  if (path === '/api/collections/handle') return {};
  throw new Error('unexpected request');
}

test('maintainerr tools register only when Maintainerr is configured', async () => {
  for (const service of ['maintainerr', 'radarr']) {
    const f = await fixture(service, () => []);
    try {
      const tools = (await f.client.listTools()).tools;
      assert.equal(tools.some(t => t.name === 'maintainerr_get_collections'), service === 'maintainerr');
      const handler = tools.find(t => t.name === 'maintainerr_handle_collections');
      if (handler) assert.deepEqual(handler.inputSchema.required, ['confirmed']);
    } finally { await f.close(); }
  }
});

test('arr_status and collection media report Maintainerr data', async () => {
  const f = await fixture('maintainerr', maintainerr);
  try {
    const status = data(await f.call('arr_status'));
    assert.deepEqual(status.maintainerr, { configured: true, connected: true, version: '2.20.0' });
    const media = data(await f.call('maintainerr_get_collection_media', { collectionId: 1 }));
    assert.equal(media.collection, 'Leaving Soon');
    assert.equal(media.items[0].mediaId, '102042');
    assert.equal(media.items[0].deletionDate, '2026-11-17T23:00:00.000Z');
    assert.ok(f.calls.some(c => c.path === '/api/collections/media/1/content/1?size=25'));
  } finally { await f.close(); }
});

test('invalid ids and ranges are refused before any request', async () => {
  const f = await fixture('maintainerr', maintainerr);
  try {
    for (const mediaId of ['../settings', '1?x=y', '1/../../rules', '', 5]) {
      assert.equal((await f.call('maintainerr_get_media_status', { mediaId })).isError, true, String(mediaId));
    }
    assert.equal((await f.call('maintainerr_get_collection_media', { collectionId: 0 })).isError, true);
    assert.equal((await f.call('maintainerr_get_collection_media', { collectionId: 1, size: 101 })).isError, true);
    assert.equal((await f.call('maintainerr_postpone_deletion', { collectionId: 1, mediaId: '102042', days: 4000 })).isError, true);
    assert.equal(f.calls.length, 0);
  } finally { await f.close(); }
});

test('write tools send the expected requests and surface refusals', async () => {
  const f = await fixture('maintainerr', maintainerr);
  try {
    assert.equal(data(await f.call('maintainerr_postpone_deletion', { collectionId: 1, mediaId: '102042', days: 30 })).deletionDate, '2026-12-01');
    assert.deepEqual(f.calls.at(-1).body, { collectionId: 1, mediaId: '102042', days: 30 });
    assert.equal(data(await f.call('maintainerr_exclude_media', { mediaId: 'abc-123' })).success, true);
    assert.deepEqual(f.calls.at(-1).body, { mediaId: 'abc-123', action: 0 });
    const refused = await f.call('maintainerr_exclude_media', { mediaId: 'abc-123', collectionId: 99 });
    assert.equal(refused.isError, true);
    assert.match(refused.content[0].text, /no rule group/);
  } finally { await f.close(); }
});

test('handle_collections requires explicit confirmation', async () => {
  const f = await fixture('maintainerr', maintainerr);
  try {
    for (const input of [{}, { confirmed: false }, { confirmed: 'true' }]) {
      assert.equal((await f.call('maintainerr_handle_collections', input)).isError, true);
    }
    assert.equal(f.calls.length, 0);
    assert.equal(data(await f.call('maintainerr_handle_collections', { confirmed: true })).success, true);
    assert.deepEqual(f.calls.map(c => [c.method, c.path]), [['POST', '/api/collections/handle']]);
  } finally { await f.close(); }
});

test('Maintainerr server errors do not expose raw response bodies', async () => {
  const f = await fixture('maintainerr', () => { throw new Error('private'); });
  try {
    const result = await f.call('maintainerr_get_rules');
    assert.equal(result.isError, true);
    assert.doesNotMatch(result.content[0].text, /private-upstream-detail/);
  } finally { await f.close(); }
});
