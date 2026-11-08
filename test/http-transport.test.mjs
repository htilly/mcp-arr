import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { request as httpsRequestRaw } from "node:https";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ConfigStore } from "../dist/config-store.js";

// Regression tests for the HTTP transport.
//
// mcp-arr runs HTTP in *stateless* mode (a fresh transport per request, no
// Mcp-Session-Id issued) so that MCP clients which do not echo a session header
// back - e.g. Claude Code - work. Prior to 1.6.5 the server ran stateful and
// rejected any post-initialize request that omitted the session header with
// `400 Mcp-Session-Id header is required`.
//
// HTTP mode requires a per-user access token on every MCP request. The tests
// seed an encrypted config with a user + token directly through ConfigStore
// (normally created via passkey login in the web UI).

const ENCRYPTION_KEY = "test-passphrase";

function seedConfig() {
  const dir = mkdtempSync(join(tmpdir(), "mcp-arr-test-"));
  const configPath = join(dir, "config.json");
  const store = new ConfigStore({ path: configPath, allowAutoKey: false, env: { CONFIG_ENCRYPTION_KEY: ENCRYPTION_KEY } });
  store.load();
  const user = store.createUser("Test", "admin", {
    id: "dGVzdC1jcmVkZW50aWFs",
    publicKey: "AA",
    counter: 0,
    name: "test",
  }, "dGVzdC1oYW5kbGU");
  const { token } = store.createToken(user.id, "test client");
  return { dir, configPath, token };
}

function startServer(env) {
  const port = String(33000 + Math.floor(Math.random() * 1000));
  const child = spawn(process.execPath, ["dist/index.js"], {
    cwd: new URL("..", import.meta.url),
    env: {
      PATH: process.env.PATH,
      MCP_TRANSPORT: "http",
      HOST: "127.0.0.1",
      PORT: port,
      CONFIG_ENCRYPTION_KEY: ENCRYPTION_KEY,
      ...env(port),
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  return { port, child, stderr: () => stderr };
}

async function stopServer(server) {
  server.child.kill("SIGTERM");
  await once(server.child, "exit").catch(() => {});
}

test("HTTP transport serves clients that omit the session header (stateless) and requires a token", async () => {
  const { dir, configPath, token } = seedConfig();
  const server = startServer((port) => ({
    TLS_MODE: "off",
    PUBLIC_URL: `http://localhost:${port}`,
    CONFIG_PATH: configPath,
  }));

  try {
    await waitForHealth(server.port);

    // no token -> 401
    const unauthorized = await postMcp(server.port, initializeRequest());
    assert.equal(unauthorized.status, 401);

    // wrong token -> 401
    const wrongToken = await postMcp(server.port, initializeRequest(), { token: "marr_wrong" });
    assert.equal(wrongToken.status, 401);

    // initialize WITHOUT any session id (a stateless client)
    const initializeResponse = await postMcp(server.port, initializeRequest(), { token });
    assert.equal(initializeResponse.status, 200);
    assert.equal(initializeResponse.headers.get("mcp-session-id"), null, "stateless mode must not issue a session id");

    // tools/list WITHOUT the Mcp-Session-Id header - the exact request the old
    // stateful transport rejected with 400. Must succeed.
    const toolsResponse = await postMcp(server.port, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, { token });
    assert.equal(toolsResponse.status, 200, "a post-initialize request without a session header must succeed in stateless mode");
    const body = await toolsResponse.text();
    assert.match(body, /"tools"/);
    assert.doesNotMatch(body, /Mcp-Session-Id header is required/);
    assert.doesNotMatch(body, /Stateless transport cannot be reused/);

    // a second independent request must also succeed (fresh server per request)
    const secondResponse = await postMcp(server.port, { jsonrpc: "2.0", id: 3, method: "tools/list", params: {} }, { token });
    assert.equal(secondResponse.status, 200);
  } finally {
    await stopServer(server);
    rmSync(dir, { recursive: true, force: true });
  }

  assert.doesNotMatch(server.stderr(), /Fatal error/);
});

test("a malformed request target gets 400 and does not stop the server", async () => {
  const { dir, configPath } = seedConfig();
  const server = startServer((port) => ({
    TLS_MODE: "off",
    PUBLIC_URL: `http://localhost:${port}`,
    CONFIG_PATH: configPath,
  }));

  try {
    await waitForHealth(server.port);
    const response = await rawRequest(server.port, "GET //[ HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
    assert.match(response, /^HTTP\/1\.1 400 /);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(server.child.exitCode, null, "server process exited");
    const health = await fetch(`http://127.0.0.1:${server.port}/health`);
    assert.equal(health.status, 200);
  } finally {
    await stopServer(server);
    rmSync(dir, { recursive: true, force: true });
  }
});

function rawRequest(port, text) {
  return new Promise((resolve, reject) => {
    const socket = connect(Number(port), "127.0.0.1", () => socket.write(text));
    let data = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => { data += chunk; });
    socket.on("end", () => resolve(data));
    socket.on("error", reject);
  });
}

test("HTTP mode refuses to start without PUBLIC_URL", async () => {
  const { dir, configPath } = seedConfig();
  const server = startServer(() => ({ CONFIG_PATH: configPath }));
  const [code] = await once(server.child, "exit");
  rmSync(dir, { recursive: true, force: true });
  assert.notEqual(code, 0);
  assert.match(server.stderr(), /PUBLIC_URL is required/);
});

test("TLS_MODE=internal serves HTTPS with a certificate chained to the built-in CA", async () => {
  const { dir, configPath, token } = seedConfig();
  const server = startServer((port) => ({
    PUBLIC_URL: `https://localhost:${port}`,
    CONFIG_PATH: configPath,
  }));

  try {
    await waitForHealth(server.port, { https: true });
    const ca = await httpsRequest(server.port, "/ca.crt", { rejectUnauthorized: false });
    assert.match(ca.body, /BEGIN CERTIFICATE/);

    // With the downloaded CA trusted, the server certificate must verify for "localhost"
    const health = await httpsRequest(server.port, "/health", { ca: ca.body, servername: "localhost" });
    assert.equal(health.status, 200);

    const mcp = await httpsRequest(server.port, "/mcp", {
      ca: ca.body,
      servername: "localhost",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(initializeRequest()),
    });
    assert.equal(mcp.status, 200);
  } finally {
    await stopServer(server);
    rmSync(dir, { recursive: true, force: true });
  }
});

function initializeRequest() {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "mcp-arr-test", version: "0.0.0" },
    },
  };
}

async function waitForHealth(port, { https = false } = {}) {
  const deadline = Date.now() + 15000;
  let lastError;

  while (Date.now() < deadline) {
    try {
      if (https) {
        const res = await httpsRequest(port, "/health", { rejectUnauthorized: false });
        if (res.status === 200) return;
      } else {
        const response = await fetch(`http://127.0.0.1:${port}/health`);
        if (response.ok) return;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`HTTP server did not become healthy: ${lastError}`);
}

function postMcp(port, payload, { token } = {}) {
  return fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });
}

function httpsRequest(port, path, { body, ...options }) {
  return new Promise((resolve, reject) => {
    const req = httpsRequestRaw({ host: "127.0.0.1", port, path, ...options }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}
