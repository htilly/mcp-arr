import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture, data } from './helpers/mock-mcp.mjs';

const sub = (code2, extra = {}) => ({ name: code2, code2, forced: false, hi: false, ...extra });

function respond(call) {
  const path = call.path.split('?')[0];
  if (path === '/api/system/status') return { data: { bazarr_version: '1.5.1' } };
  if (path === '/api/episodes/wanted') {
    return {
      total: 3,
      data: [{ seriesTitle: 'Show', episode_number: '1x02', episodeTitle: 'Two', sonarrSeriesId: 7, sonarrEpisodeId: 72, missing_subtitles: [sub('en', { hi: true })] }],
    };
  }
  if (path === '/api/movies' && call.method === 'GET') {
    return { total: 1, data: [{ radarrId: 5, title: 'Film', year: '2020', subtitles: [sub('sv')], missing_subtitles: [sub('en', { forced: true })] }] };
  }
  if (path === '/api/movies/subtitles' && call.method === 'PATCH') return null;
  throw new Error('unexpected request');
}

test('bazarr tools register only when Bazarr is configured', async () => {
  const f = await fixture('bazarr', respond);
  try {
    const names = (await f.client.listTools()).tools.map(t => t.name);
    assert.equal(names.filter(n => n.startsWith('bazarr_')).length, 16);
    assert.equal(names.some(n => n.startsWith('sonarr_') || n.startsWith('radarr_')), false);
  } finally { await f.close(); }
  const sonarr = await fixture('sonarr', () => []);
  try {
    const names = (await sonarr.client.listTools()).tools.map(t => t.name);
    assert.equal(names.some(n => n.startsWith('bazarr_')), false);
  } finally { await sonarr.close(); }
});

test('bazarr read tools map subtitle state and report status', async () => {
  const f = await fixture('bazarr', respond);
  try {
    const status = data(await f.call('arr_status'));
    assert.deepEqual(status.bazarr, { configured: true, connected: true, version: '1.5.1' });
    assert.deepEqual(status.sonarr, { configured: false });

    const wanted = data(await f.call('bazarr_get_wanted_episodes', { length: 10 }));
    assert.equal(f.calls.at(-1).path, '/api/episodes/wanted?start=0&length=10');
    assert.equal(wanted.total, 3);
    assert.deepEqual(wanted.episodes[0].missingSubtitles, ['en:hi']);
    assert.equal(wanted.episodes[0].sonarrEpisodeId, 72);

    const movies = data(await f.call('bazarr_get_movies', { radarrIds: [5] }));
    assert.equal(f.calls.at(-1).path, '/api/movies?start=0&length=50&radarrid%5B%5D=5');
    assert.deepEqual(movies.movies[0].subtitles, ['sv']);
    assert.deepEqual(movies.movies[0].missingSubtitles, ['en:forced']);
  } finally { await f.close(); }
});

test('bazarr subtitle download validates input before requesting', async () => {
  const f = await fixture('bazarr', respond);
  try {
    for (const args of [
      { radarrId: 0, language: 'en' },
      { radarrId: '5', language: 'en' },
      { radarrId: 5, language: 'english please' },
      { radarrId: 5, language: 'en', hi: 'yes' },
    ]) assert.equal((await f.call('bazarr_download_movie_subtitle', args)).isError, true);
    assert.equal((await f.call('bazarr_get_movies', { length: 201 })).isError, true);
    assert.equal((await f.call('bazarr_get_series', { seriesIds: Array(101).fill(1) })).isError, true);
    assert.equal(f.calls.length, 0);

    const result = data(await f.call('bazarr_download_movie_subtitle', { radarrId: 5, language: 'en', hi: true }));
    assert.equal(result.success, true);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].method, 'PATCH');
    assert.equal(f.calls[0].path, '/api/movies/subtitles?radarrid=5&language=en&forced=False&hi=True');
  } finally { await f.close(); }
});

test('bazarr errors do not expose raw API response bodies', async () => {
  const f = await fixture('bazarr', () => { throw new Error('private'); });
  try {
    const result = await f.call('bazarr_get_providers');
    assert.equal(result.isError, true);
    assert.doesNotMatch(result.content[0].text, /private-upstream-detail/);
  } finally { await f.close(); }
});
