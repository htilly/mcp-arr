import assert from 'node:assert/strict';
import test from 'node:test';
import { RadarrClient } from '../dist/arr-client.js';

function fixture() {
  const calls = [];
  const candidate = { path: '/downloads/movie.mkv', size: 20000000000, movie: { id: 42 }, quality: { quality: { id: 19 }, revision: { version: 1 } }, languages: [{ id: 1, name: 'English' }], downloadId: 'download-42', rejections: [{ reason: 'Not an upgrade' }] };
  const client = new RadarrClient({ url: 'http://example.invalid', apiKey: '***REDACTED***' });
  client.request = async (endpoint, options) => {
    calls.push({ endpoint, options });
    if (endpoint === '/rootfolder') return [{ path: '/movies' }];
    if (endpoint.startsWith('/queue?')) return { records: [{ outputPath: '/downloads/complete/Movie.2024' }] };
    if (endpoint === '/remotepathmapping') return [{ localPath: '/downloads/' }];
    if (endpoint === '/downloadclient') return [{ fields: [{ name: 'watchFolder', value: 'D:\\Watch' }, { name: 'category', value: 'radarr' }] }];
    return endpoint.startsWith('/manualimport?') ? [candidate] : { id: 123, status: 'queued' };
  };
  const selection = { path: candidate.path, movieId: 42, expectedSizeBytes: candidate.size, acknowledgedRejections: ['Not an upgrade'] };
  return { client, candidate, selection, calls };
}

test('manual import re-scans and posts exact metadata to command endpoint', async () => {
  const { client, candidate, selection, calls } = fixture();
  const result = await client.manualImport({ downloadId: 'download-42' }, [selection], 'copy', true);
  assert.equal(result.id, 123);
  assert.match(calls[0].endpoint, /downloadId=download-42/);
  assert.equal(calls[1].endpoint, '/command');
  const body = JSON.parse(calls[1].options.body);
  assert.equal(body.name, 'ManualImport');
  assert.equal(body.importMode, 'copy');
  assert.deepEqual(body.files[0].quality, candidate.quality);
  assert.deepEqual(body.files[0].languages, candidate.languages);
  assert.equal(body.files[0].movieId, 42);
  assert.equal(body.files[0].downloadId, 'download-42');
});

test('confirmation and invalid selections cause no API requests', async () => {
  for (const change of [s => ({ ...s, expectedSizeBytes: 0 }), s => ({ ...s, movieId: -1 })]) {
    const { client, selection, calls } = fixture();
    await assert.rejects(client.manualImport({ downloadId: 'download-42' }, [change(selection)], 'copy', true));
    assert.equal(calls.length, 0);
  }
  const { client, selection, calls } = fixture();
  await assert.rejects(client.manualImport({ downloadId: 'download-42' }, [selection], 'copy', false));
  await assert.rejects(client.manualImport({ downloadId: 'download-42' }, [selection, selection], 'copy', true));
  assert.equal(calls.length, 0);
});

test('changed files, unknown mappings and unacknowledged rejections never submit', async () => {
  for (const change of [c => { c.size++; }, c => { c.movie.id++; }, c => { c.languages = []; }, c => { c.quality.quality.id = 0; }, c => { c.rejections.push({ reason: 'File is locked' }); }, c => { c.path += '.changed'; }]) {
    const { client, candidate, selection, calls } = fixture();
    change(candidate);
    await assert.rejects(client.manualImport({ downloadId: 'download-42' }, [selection], 'copy', true));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options, undefined);
  }
});

test('inspection validates scope and safely encodes folder paths; command lookup is read-only', async () => {
  const { client, calls } = fixture();
  await assert.rejects(client.getManualImportCandidates({}));
  await assert.rejects(client.getManualImportCandidates({ folder: 123 }));
  await assert.rejects(client.getCommand(-1));
  assert.equal(calls.length, 0);
  await client.getManualImportCandidates({ folder: '/downloads/A & B' });
  const scan = calls.find(c => c.endpoint.startsWith('/manualimport?'));
  assert.equal(new URLSearchParams(scan.endpoint.split('?')[1]).get('folder'), '/downloads/A & B');
  calls.length = 0;
  await client.getCommand(123);
  assert.equal(calls[0].endpoint, '/command/123');
  assert.equal(calls[0].options, undefined);
});

test('folder scans are limited to root, download and queue folders', async () => {
  const { client, calls } = fixture();
  for (const folder of ['/movies', '/movies/Film (2024)', '/downloads', '/downloads/complete/Movie.2024', 'D:\\Watch\\x']) {
    await client.getManualImportCandidates({ folder });
  }
  for (const folder of ['/etc', '/home/user', '/moviesX', '/downloads/../etc', '/movies/./x', '/', 'D:\\Other']) {
    calls.length = 0;
    await assert.rejects(client.getManualImportCandidates({ folder }), /outside|Invalid folder/, folder);
    assert.ok(!calls.some(c => c.endpoint.startsWith('/manualimport?')), `no scan for ${folder}`);
  }
  // downloadId scans need no folder check
  calls.length = 0;
  await client.getManualImportCandidates({ downloadId: 'abc' });
  assert.deepEqual(calls.map(c => c.endpoint.split('?')[0]), ['/manualimport']);
});
