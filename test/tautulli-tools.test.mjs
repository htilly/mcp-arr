import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture, data } from './helpers/mock-mcp.mjs';

const ok = payload => ({ response: { result: 'success', message: null, data: payload } });
const params = call => new URL(call.path, 'http://x').searchParams;

test('tautulli tools register only when Tautulli is configured', async () => {
  const f = await fixture('tautulli', () => ok({}));
  try {
    const names = (await f.client.listTools()).tools.map(t => t.name);
    assert.ok(names.includes('tautulli_get_history'));
    assert.ok(names.includes('tautulli_terminate_session'));
  } finally { await f.close(); }
  const g = await fixture('radarr', () => []);
  try {
    const names = (await g.client.listTools()).tools.map(t => t.name);
    assert.equal(names.some(name => name.startsWith('tautulli_')), false);
  } finally { await g.close(); }
});

test('tautulli_get_history validates, then summarizes a title lookup', async () => {
  const f = await fixture('tautulli', call => {
    const cmd = params(call).get('cmd');
    if (cmd === 'search') return ok({ results_count: 1, results_list: { movie: [{ title: 'Dune' }] } });
    if (cmd === 'get_history') return ok({ recordsFiltered: 3, data: [{ friendly_name: 'Alice', date: 1700000000, full_title: 'Dune', media_type: 'movie' }] });
    throw new Error('unexpected');
  });
  try {
    for (const args of [{ length: 0 }, { length: 101 }, { user_id: -1 }, { start: '1' }, { media_type: 'photo' }]) {
      assert.equal((await f.call('tautulli_get_history', args)).isError, true);
    }
    assert.equal(f.calls.length, 0);
    const result = data(await f.call('tautulli_get_history', { title: ' Dune ', length: 5 }));
    assert.equal(result.searchedFor, 'Dune');
    assert.equal(result.existsInLibrary, true);
    assert.equal(result.watchedCount, 3);
    assert.deepEqual(result.history[0], { who: 'Alice', when: '2023-11-14T22:13:20.000Z', title: 'Dune', mediaType: 'movie' });
    const history = params(f.calls.find(call => params(call).get('cmd') === 'get_history'));
    assert.equal(history.get('search'), 'Dune');
    assert.equal(history.get('length'), '5');
    assert.equal(history.get('apikey'), 'test');
  } finally { await f.close(); }
});

test('tautulli_terminate_session requires confirmed=true before contacting Tautulli', async () => {
  const f = await fixture('tautulli', () => ok(null));
  try {
    assert.equal((await f.call('tautulli_terminate_session', { confirmed: true })).isError, true);
    assert.equal((await f.call('tautulli_terminate_session', { session_key: 0, confirmed: true })).isError, true);
    const refused = await f.call('tautulli_terminate_session', { session_key: 12 });
    assert.equal(refused.isError, true);
    assert.match(refused.content[0].text, /approval/);
    assert.equal((await f.call('tautulli_terminate_session', { session_key: 12, confirmed: 'true' })).isError, true);
    assert.equal(f.calls.length, 0);
    const result = data(await f.call('tautulli_terminate_session', { session_key: 12, message: 'Server maintenance', confirmed: true }));
    assert.equal(result.terminated, true);
    const sent = params(f.calls[0]);
    assert.equal(sent.get('cmd'), 'terminate_session');
    assert.equal(sent.get('session_key'), '12');
    assert.equal(sent.get('message'), 'Server maintenance');
  } finally { await f.close(); }
});

test('tautulli errors do not expose raw API responses', async () => {
  const f = await fixture('tautulli', () => ({ response: { result: 'error', message: 'private-upstream-detail', data: {} } }));
  try {
    const result = await f.call('tautulli_get_activity');
    assert.equal(result.isError, true);
    assert.doesNotMatch(result.content[0].text, /private-upstream-detail/);
    const status = data(await f.call('arr_status'));
    assert.equal(status.tautulli.configured, true);
    assert.equal(status.tautulli.connected, false);
    assert.doesNotMatch(JSON.stringify(status), /private-upstream-detail/);
  } finally { await f.close(); }
});
