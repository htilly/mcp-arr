import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture, data } from './helpers/mock-mcp.mjs';

const request = {
  id: 7, status: 1, type: 'tv', is4k: false, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
  media: { tmdbId: 1399, tvdbId: 121361, status: 2 },
  seasons: [{ seasonNumber: 1 }, { seasonNumber: 2 }],
  requestedBy: { id: 3, displayName: 'Alice', email: 'alice@example.invalid' },
};

test('overseerr tools register only when Overseerr is configured', async () => {
  const f = await fixture('overseerr', () => ({}));
  try {
    const names = (await f.client.listTools()).tools.map(t => t.name);
    assert.ok(names.includes('overseerr_get_requests'));
    assert.ok(names.includes('overseerr_approve_request'));
  } finally { await f.close(); }
  const g = await fixture('radarr', () => []);
  try {
    const names = (await g.client.listTools()).tools.map(t => t.name);
    assert.equal(names.some(name => name.startsWith('overseerr_')), false);
  } finally { await g.close(); }
});

test('overseerr_get_requests validates, then summarizes requests', async () => {
  const f = await fixture('overseerr', () => ({ pageInfo: { pages: 1, pageSize: 5, results: 1, page: 1 }, results: [request] }));
  try {
    for (const args of [{ take: 0 }, { take: 101 }, { skip: -1 }, { filter: 'declined' }, { requestedBy: 0 }, { requestedBy: '3' }]) {
      assert.equal((await f.call('overseerr_get_requests', args)).isError, true);
    }
    assert.equal(f.calls.length, 0);
    const result = data(await f.call('overseerr_get_requests', { filter: 'pending', take: 5 }));
    assert.equal(f.calls[0].method, 'GET');
    assert.equal(f.calls[0].path, '/api/v1/request?take=5&filter=pending&sort=added');
    assert.equal(result.totalRequests, 1);
    assert.deepEqual(result.requests[0], {
      id: 7, type: 'tv', status: 'pending', is4k: false, requestedBy: 'Alice', requestedById: 3,
      requestedAt: '2026-11-01T00:00:00.000Z', media: { tmdbId: 1399, tvdbId: 121361, status: 'pending' }, seasons: [1, 2],
    });
    assert.doesNotMatch(JSON.stringify(result), /alice@example/);
  } finally { await f.close(); }
});

test('approve and decline require confirmed=true before contacting Overseerr', async () => {
  const f = await fixture('overseerr', call => ({ ...request, status: call.path.endsWith('/approve') ? 2 : 3 }));
  try {
    for (const tool of ['overseerr_approve_request', 'overseerr_decline_request']) {
      assert.equal((await f.call(tool, { requestId: 0, confirmed: true })).isError, true);
      const refused = await f.call(tool, { requestId: 7 });
      assert.equal(refused.isError, true);
      assert.match(refused.content[0].text, /approval/);
      assert.equal((await f.call(tool, { requestId: 7, confirmed: 'true' })).isError, true);
    }
    assert.equal(f.calls.length, 0);
    const approved = data(await f.call('overseerr_approve_request', { requestId: 7, confirmed: true }));
    assert.equal(approved.newStatus, 'approved');
    const declined = data(await f.call('overseerr_decline_request', { requestId: 7, confirmed: true }));
    assert.equal(declined.newStatus, 'declined');
    assert.deepEqual(f.calls.map(call => `${call.method} ${call.path}`), ['POST /api/v1/request/7/approve', 'POST /api/v1/request/7/decline']);
  } finally { await f.close(); }
});

test('overseerr errors do not expose raw API responses', async () => {
  const f = await fixture('overseerr', () => { throw new Error('private'); });
  try {
    const result = await f.call('overseerr_search', { query: 'the wire' });
    assert.equal(result.isError, true);
    assert.doesNotMatch(result.content[0].text, /private-upstream-detail/);
    assert.equal(f.calls[0].path, '/api/v1/search?query=the%20wire');
    const status = data(await f.call('arr_status'));
    assert.equal(status.overseerr.configured, true);
    assert.equal(status.overseerr.connected, false);
    assert.doesNotMatch(JSON.stringify(status), /private-upstream-detail/);
  } finally { await f.close(); }
});
