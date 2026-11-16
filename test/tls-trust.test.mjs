#!/usr/bin/env node
/**
 * Trusting a self-signed certificate by fingerprint (src/tls-trust.ts).
 * A local HTTPS stub with a fresh self-signed certificate answers like SABnzbd
 * and qBittorrent. Build first: npm run build
 */

import 'reflect-metadata';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:https';
import { webcrypto, X509Certificate } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as x509 from '@peculiar/x509';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fetchFor, normaliseFingerprint, TlsTrustError } from '../dist/tls-trust.js';
import { QBittorrentClient } from '../dist/qbittorrent-client.js';
import { testServiceConnection } from '../dist/http-server.js';

const entry = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js');
const KEY = 'sab-test-key-0123456789abcdef';
const ALG = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' };

let server;
let baseUrl;
let fingerprint;
let requests = [];
const openClients = [];

async function selfSigned() {
  x509.cryptoProvider.set(webcrypto);
  const keys = await webcrypto.subtle.generateKey(ALG, true, ['sign', 'verify']);
  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: '01',
    name: 'CN=sabnzbd.test',
    notBefore: new Date(Date.now() - 3600_000),
    notAfter: new Date(Date.now() + 86400_000),
    keys,
    signingAlgorithm: ALG,
    extensions: [new x509.SubjectAlternativeNameExtension([{ type: 'ip', value: '127.0.0.1' }])],
  });
  const pkcs8 = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', keys.privateKey)).toString('base64');
  const keyPem = `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
  return { cert: cert.toString('pem'), key: keyPem };
}

before(async () => {
  const material = await selfSigned();
  fingerprint = new X509Certificate(material.cert).fingerprint256;
  server = createServer(material, (req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'https://x');
      requests.push({ method: req.method, path: url.pathname, apikey: url.searchParams.get('apikey'), cookie: req.headers.cookie, body });
      res.setHeader('Content-Type', 'application/json');
      if (url.pathname === '/api' && url.searchParams.get('mode') === 'version') return res.end(JSON.stringify({ version: '4.5.1' }));
      if (url.pathname === '/api' && url.searchParams.get('mode') === 'queue') {
        return res.end(JSON.stringify({ queue: { status: 'Idle', paused: false, kbpersec: '0', speedlimit: '', noofslots: 0, slots: [], diskspace1: '100', diskspace2: '100' } }));
      }
      if (url.pathname === '/api/v2/auth/login') {
        res.setHeader('Set-Cookie', ['QBT_SID_8080=abc123; HttpOnly; path=/', 'other=1; path=/']);
        res.setHeader('Content-Type', 'text/plain');
        return res.end(body.includes('password=pw') ? 'Ok.' : 'Fails.');
      }
      if (url.pathname === '/api/v2/app/version') {
        res.setHeader('Content-Type', 'text/plain');
        return res.end(req.headers.cookie?.includes('QBT_SID_8080=abc123') ? 'v5.1.0' : '');
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `https://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await Promise.all(openClients.map((c) => c.close()));
  server?.close();
});

async function connect(env = {}) {
  const client = new Client({ name: 'tls-trust-test', version: '1.0.0' });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    env: { PATH: process.env.PATH, SABNZBD_URL: baseUrl, SABNZBD_API_KEY: KEY, ...env },
  }));
  openClients.push(client);
  return client;
}

async function call(client, name, args = {}) {
  requests = [];
  const result = await client.callTool({ name, arguments: args });
  return { ...result, text: result.content[0].text, requests };
}

test('fingerprints are normalised and checked', () => {
  const hex = 'ab'.repeat(32);
  assert.equal(normaliseFingerprint(hex), Array(32).fill('AB').join(':'));
  assert.equal(normaliseFingerprint(`SHA256 ${Array(32).fill('ab').join(':')}`), Array(32).fill('AB').join(':'));
  assert.throws(() => normaliseFingerprint('abc'), TlsTrustError);
  assert.throws(() => fetchFor('not-a-fingerprint'), /64 hex digits/);
});

test('without a fingerprint the error says the certificate is untrusted and shows its fingerprint', async () => {
  const client = await connect();
  const result = await call(client, 'sabnzbd_status');
  assert.equal(result.isError, true);
  assert.match(result.text, /not trusted \(DEPTH_ZERO_SELF_SIGNED_CERT\)/);
  assert.ok(result.text.includes(fingerprint), result.text);
  assert.ok(!result.text.includes(KEY));
  assert.deepEqual(result.requests, [], 'no HTTP request (and no API key) reached the server');
});

test('with the right fingerprint requests go through', async () => {
  const client = await connect({ SABNZBD_TLS_FINGERPRINT: fingerprint.replace(/:/g, '').toLowerCase() });
  const result = await call(client, 'sabnzbd_status');
  assert.notEqual(result.isError, true, result.text);
  assert.match(result.text, /4\.5\.1/);
  assert.ok(result.requests.length > 0);
  assert.equal(result.requests[0].apikey, KEY);
});

test('with a wrong fingerprint nothing is sent', async () => {
  const wrong = Array(32).fill('00').join(':');
  const client = await connect({ SABNZBD_TLS_FINGERPRINT: wrong });
  const result = await call(client, 'sabnzbd_status');
  assert.equal(result.isError, true);
  assert.match(result.text, /does not match the trusted fingerprint/);
  assert.ok(result.text.includes(fingerprint));
  assert.deepEqual(result.requests, [], 'the API key never left the client');
});

test('pinned fetch keeps form bodies and every Set-Cookie header (qBittorrent login)', async () => {
  requests = [];
  const qbt = new QBittorrentClient({ url: baseUrl, username: 'admin', password: 'pw', fetch: fetchFor(fingerprint) });
  assert.equal(await qbt.getVersion(), 'v5.1.0');
  const login = requests.find((r) => r.path === '/api/v2/auth/login');
  assert.match(login.body, /username=admin&password=pw/);
  assert.match(requests.find((r) => r.path === '/api/v2/app/version').cookie, /QBT_SID_8080=abc123; other=1/);
});

test('the web UI connection test explains how to trust the certificate', async () => {
  const untrusted = await testServiceConnection('sabnzbd', baseUrl, { apiKey: KEY });
  assert.equal(untrusted.ok, false);
  assert.ok(untrusted.error.includes(fingerprint), untrusted.error);
  const trusted = await testServiceConnection('sabnzbd', baseUrl, { apiKey: KEY, tlsFingerprint: fingerprint });
  assert.deepEqual(trusted, { ok: true, version: '4.5.1' });
});
