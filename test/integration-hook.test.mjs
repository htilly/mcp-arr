#!/usr/bin/env node
/**
 * Optional-integration hook tests (src/integration.ts). The registry ships
 * empty, so this copies dist/ to a scratch folder, swaps in a registry with a
 * fake "demo" integration (token + optional username/password fields) and runs
 * that copy against a local stub. Build first: npm run build
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { cpSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = 'demo-secret-token-0123456789';

// Inside the repo so the copy resolves node_modules; .test-build/ is git-ignored.
mkdirSync(join(root, '.test-build'), { recursive: true });
const scratch = mkdtempSync(join(root, '.test-build', 'hook-'));
const entry = join(scratch, 'dist', 'index.js');

const FIXTURE = `
import { jsonText } from "../integration.js";
export const demo = {
  name: "demo",
  displayName: "Demo (Testing)",
  envPrefix: "DEMO",
  exampleUrl: "http://localhost:1234",
  icon: '<circle r="40" class="ink f-sea"/>',
  fields: [
    { key: "token", label: "Token", envSuffix: "TOKEN", secret: true, required: true },
    { key: "username", label: "Username", envSuffix: "USERNAME", secret: false, required: false },
    { key: "password", label: "Password", envSuffix: "PASSWORD", secret: true, required: false },
  ],
  writeTools: ["demo_do"],
  confirmTools: ["demo_wipe"],
  create({ url, values }) {
    const get = async (path) => {
      const res = await fetch(url + path, { headers: { "x-demo-token": values.token, "x-demo-user": values.username ?? "" } });
      if (!res.ok) throw new Error("Demo API error: " + res.status + " (token " + values.token + ")");
      return res.json();
    };
    return {
      tools: [
        { name: "demo_get", description: "read", inputSchema: { type: "object", properties: {} } },
        { name: "demo_do", description: "write", inputSchema: { type: "object", properties: { n: { type: "integer", minimum: 1 } }, required: ["n"] } },
        { name: "demo_wipe", description: "destructive", inputSchema: { type: "object", properties: {} } },
      ],
      getStatus: () => get("/status"),
      async callTool(name, args) {
        if (name === "demo_get") return jsonText(await get("/thing"));
        if (name === "demo_do") return jsonText(await get("/do?n=" + args.n));
        if (name === "demo_wipe") return jsonText(await get("/wipe"));
        throw new Error("unknown");
      },
    };
  },
};
`;
const REGISTRY = `import { demo } from "./demo.js";\nexport const INTEGRATIONS = [demo];\n`;

let stub;
let baseUrl;
let requests = [];
const openClients = [];

before(async () => {
  cpSync(join(root, 'dist'), join(scratch, 'dist'), { recursive: true });
  cpSync(join(root, 'package.json'), join(scratch, 'package.json'));
  writeFileSync(join(scratch, 'dist', 'integrations', 'demo.js'), FIXTURE);
  writeFileSync(join(scratch, 'dist', 'integrations', 'index.js'), REGISTRY);

  stub = createServer((req, res) => {
    requests.push({ url: req.url, token: req.headers['x-demo-token'], user: req.headers['x-demo-user'] });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/status') return res.end(JSON.stringify({ version: '9.9.9' }));
    if (req.url === '/thing') return res.end(JSON.stringify({ thing: 1 }));
    if (req.url.startsWith('/do') || req.url === '/wipe') return res.end(JSON.stringify({ ok: true }));
    res.statusCode = 500;
    res.end('{}');
  });
  await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${stub.address().port}`;
});

after(async () => {
  await Promise.all(openClients.map((c) => c.close()));
  stub?.close();
  rmSync(scratch, { recursive: true, force: true });
});

async function connect(env = {}) {
  const client = new Client({ name: 'hook-test', version: '1.0.0' });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    env: { PATH: process.env.PATH, DEMO_URL: baseUrl, DEMO_TOKEN: TOKEN, ...env },
  }));
  openClients.push(client);
  return client;
}

async function call(client, name, args = {}) {
  requests = [];
  const result = await client.callTool({ name, arguments: args });
  return { ...result, text: result.content[0].text, requests };
}

test('integration tools are listed with policy applied', async () => {
  const client = await connect();
  const byName = Object.fromEntries((await client.listTools()).tools.map((t) => [t.name, t]));
  assert.equal(byName.demo_get.annotations.readOnlyHint, true);
  assert.equal(byName.demo_do.annotations.readOnlyHint, false);
  assert.equal(byName.demo_wipe.annotations.destructiveHint, true);
  assert.deepEqual(byName.demo_wipe.inputSchema.required, ['confirm']);
  assert.match(byName.arr_status.description, /Demo \(Testing\)/);
});

test('calls are routed with field values, after argument and confirm checks', async () => {
  const client = await connect({ DEMO_USERNAME: 'alice' });
  const ok = await call(client, 'demo_get');
  assert.notEqual(ok.isError, true, ok.text);
  assert.deepEqual(JSON.parse(ok.text), { thing: 1 });
  assert.equal(ok.requests[0].token, TOKEN);
  assert.equal(ok.requests[0].user, 'alice');

  const badArgs = await call(client, 'demo_do', { n: 0 });
  assert.equal(badArgs.isError, true);
  assert.deepEqual(badArgs.requests, []);

  const unconfirmed = await call(client, 'demo_wipe');
  assert.equal(unconfirmed.isError, true);
  assert.deepEqual(unconfirmed.requests, []);
  const confirmed = await call(client, 'demo_wipe', { confirm: true });
  assert.notEqual(confirmed.isError, true, confirmed.text);
  assert.equal(confirmed.requests[0].url, '/wipe');
});

test('ARR_READ_ONLY hides and refuses integration write tools', async () => {
  const client = await connect({ ARR_READ_ONLY: 'true' });
  const names = (await client.listTools()).tools.map((t) => t.name);
  assert.ok(names.includes('demo_get'));
  assert.ok(!names.includes('demo_do'));
  assert.ok(!names.includes('demo_wipe'));
  const refused = await call(client, 'demo_do', { n: 1 });
  assert.equal(refused.isError, true);
  assert.deepEqual(refused.requests, []);
});

test('arr_status reports the integration and errors never show secret fields', async () => {
  const client = await connect();
  const status = JSON.parse((await call(client, 'arr_status')).text);
  assert.deepEqual(status.demo, { configured: true, connected: true, version: '9.9.9' });

  const down = await connect({ DEMO_URL: 'http://127.0.0.1:1' });
  const downStatus = JSON.parse((await call(down, 'arr_status')).text);
  assert.equal(downStatus.demo.connected, false);

  // The stub answers 500 for unknown paths; the fixture puts the token in its error.
  const badPath = await connect({ DEMO_URL: `${baseUrl}/nope` });
  const failed = await call(badPath, 'demo_get');
  assert.equal(failed.isError, true);
  assert.ok(!failed.text.includes(TOKEN), failed.text);
  assert.match(failed.text, /\[REDACTED\]/);
});

test('without a required field the integration stays off', async () => {
  const client = await connect({ DEMO_TOKEN: '', DEMO_USERNAME: 'alice', DEMO_PASSWORD: 'pw' });
  const names = (await client.listTools()).tools.map((t) => t.name);
  assert.ok(!names.some((n) => n.startsWith('demo_')));
  const status = JSON.parse((await call(client, 'arr_status')).text);
  assert.deepEqual(status.demo, { configured: false });
});

test('config store reads env per field and saves only known fields', async () => {
  const { ConfigStore, buildServiceDefs } = await import(pathToFileURL(join(scratch, 'dist', 'config-store.js')).href);
  const env = { CONFIG_ENCRYPTION_KEY: 'test-passphrase-for-hook', DEMO_USERNAME: 'from-env' };
  const store = new ConfigStore({ path: join(scratch, 'config.json'), allowAutoKey: false, env });
  store.load();
  store.setService('demo', { url: 'http://demo.local:1234/', token: 'saved-token', password: 'pw' });
  const e = store.getEffective().demo;
  assert.equal(e.url, 'http://demo.local:1234');
  assert.deepEqual(e.values, { token: 'saved-token', username: 'from-env', password: 'pw' });
  assert.deepEqual(e.sources, { token: 'file', username: 'env', password: 'file' });
  assert.equal(e.configured, true);
  assert.throws(() => store.setService('demo', { apiKey: 'x' }), /Unknown field/);
  // Built-in services keep their single API key field.
  assert.deepEqual(store.getEffective().sonarr.values, { apiKey: undefined });

  const clash = { name: 'sonarr', displayName: 'X', envPrefix: 'X', exampleUrl: '', create() {} };
  assert.throws(() => buildServiceDefs([clash]), /collides/);
  const badField = { name: 'x', displayName: 'X', envPrefix: 'XX', exampleUrl: '', fields: [{ key: 'url', label: 'u', envSuffix: 'U', secret: false, required: false }], create() {} };
  assert.throws(() => buildServiceDefs([badField]), /invalid field/);
});

test('the web UI page carries integration icons without breaking the script', async () => {
  const { renderAdminPage } = await import(pathToFileURL(join(scratch, 'dist', 'admin-ui.js')).href);
  const page = renderAdminPage('n0nce');
  assert.ok(page.includes('Object.assign(ICONS, {"demo":"\\u003ccircle'), 'icon injected with < escaped');
  assert.ok(!page.includes('__INTEGRATION_ICONS__'));
});

test('web UI service endpoints handle integration fields and keep saved secrets on their host', { timeout: 30_000 }, async () => {
  const { spawn } = await import('node:child_process');
  const { once } = await import('node:events');
  const { request } = await import('node:http');
  const { ConfigStore } = await import(pathToFileURL(join(scratch, 'dist', 'config-store.js')).href);
  const KEY = 'test-passphrase-http';
  const configPath = join(scratch, 'http-config.json');
  const seed = new ConfigStore({ path: configPath, allowAutoKey: false, env: { CONFIG_ENCRYPTION_KEY: KEY } });
  seed.load();
  const user = seed.createUser('Alice', 'admin', { id: 'dGVzdA', publicKey: 'AA', counter: 0, name: 'k' }, 'aGFuZGxl');
  seed.setPassword(user.id, 'correct horse battery');

  const port = 37000 + Math.floor(Math.random() * 1000);
  const origin = `http://mcp.example.com:${port}`;
  const child = spawn(process.execPath, [entry], {
    env: {
      PATH: process.env.PATH, MCP_TRANSPORT: 'http', HOST: '127.0.0.1', PORT: String(port), TLS_MODE: 'off',
      CONFIG_ENCRYPTION_KEY: KEY, CONFIG_PATH: configPath, PUBLIC_URL: origin, DEMO_USERNAME: 'env-user',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (c) => (stderr += c));
  const http = (path, { method = 'GET', body, cookie } = {}) => new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = request({
      host: '127.0.0.1', port, path, method, agent: false,
      headers: { 'Content-Type': 'application/json', Host: `mcp.example.com:${port}`, Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8').on('data', (c) => (text += c)).on('end', () => {
        let json; try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, json, text });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
  try {
    const deadline = Date.now() + 15000;
    for (;;) {
      const ok = await http('/health').then((r) => r.status === 200, () => false);
      if (ok) break;
      if (Date.now() > deadline) throw new Error(`server did not start: ${stderr}`);
      await new Promise((r) => setTimeout(r, 150));
    }
    const login = await http('/admin/api/login/password', { method: 'POST', body: { name: 'Alice', password: 'correct horse battery' } });
    assert.equal(login.status, 200, login.text);
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    const ui = (path, opts = {}) => http(`/admin/api${path}`, { cookie, ...opts });

    let demo = (await ui('/overview')).json.services.find((s) => s.id === 'demo');
    assert.equal(demo.configured, false);
    assert.deepEqual(demo.fields.map((f) => [f.key, f.source, f.value]), [['token', 'none', ''], ['username', 'env', 'env-user'], ['password', 'none', '']]);

    const saved = await ui('/services/demo', { method: 'PUT', body: { url: baseUrl, fields: { token: TOKEN, password: 'pw-secret' } } });
    assert.equal(saved.status, 200, saved.text);
    demo = saved.json.services.find((s) => s.id === 'demo');
    assert.equal(demo.configured, true);
    assert.ok(!saved.text.includes(TOKEN) && !saved.text.includes('pw-secret'), 'secrets never go back to the browser');
    assert.equal(demo.fields[0].hint, TOKEN.slice(-4));
    assert.ok(saved.json.configuredSummary.includes('Demo (Testing)'));

    const tested = await ui('/services/demo/test', { method: 'POST', body: {} });
    assert.deepEqual(tested.json, { ok: true, version: '9.9.9' });

    const otherHost = await ui('/services/demo/test', { method: 'POST', body: { url: 'http://127.0.0.2:9' } });
    assert.equal(otherHost.status, 400);
    assert.match(otherHost.json.error, /saved secrets are only sent to the saved address/);

    const moved = await ui('/services/demo', { method: 'PUT', body: { url: 'http://127.0.0.2:9', fields: { token: TOKEN } } });
    assert.equal(moved.status, 400, 'the saved password must be typed again too');
    assert.match(moved.json.error, /again when changing the service address/);

    const envField = await ui('/services/demo', { method: 'PUT', body: { fields: { username: 'bob' } } });
    assert.equal(envField.status, 409);

    // Built-in services still accept the old apiKey body.
    const sonarr = await ui('/services/sonarr', { method: 'PUT', body: { url: 'http://127.0.0.1:8989', apiKey: 'sonarr-key-0123456789' } });
    assert.equal(sonarr.status, 200, sonarr.text);
    assert.equal(sonarr.json.services.find((s) => s.id === 'sonarr').configured, true);
  } finally {
    child.kill('SIGTERM');
    await once(child, 'exit').catch(() => {});
  }
});
