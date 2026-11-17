import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ConfigStore, OAuthClientLimitError } from "../dist/config-store.js";
import { upstreamErrorDetail } from "../dist/format.js";

// Fixes from the security review: OAuth client eviction (O-001), the ?token= opt-in (O-002),
// bounded passkey sign-in starts (O-003), sign-out elsewhere after a credential change (O-004)
// and short upstream error messages (O-006).

const KEY = "test-passphrase";
const PASSWORD = "correct horse battery";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

function seed() {
  const dir = mkdtempSync(join(tmpdir(), "mcp-arr-fixes-"));
  const configPath = join(dir, "config.json");
  const store = new ConfigStore({ path: configPath, allowAutoKey: false, env: { CONFIG_ENCRYPTION_KEY: KEY } });
  store.load();
  const user = store.createUser("Alice", "admin", { id: "dGVzdA", publicKey: "AA", counter: 0, name: "k" }, "aGFuZGxl");
  store.setPassword(user.id, PASSWORD);
  const { token } = store.createToken(user.id, "test");
  return { dir, configPath, store, user, token };
}

function start(env) {
  const port = String(36000 + Math.floor(Math.random() * 1000));
  const child = spawn(process.execPath, ["dist/index.js"], {
    cwd: new URL("..", import.meta.url),
    env: { PATH: process.env.PATH, MCP_TRANSPORT: "http", HOST: "127.0.0.1", PORT: port, CONFIG_ENCRYPTION_KEY: KEY, TLS_MODE: "off", PUBLIC_URL: `https://mcp.example.com:${port}`, ...env },
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr.resume();
  return { port, child, base: `http://127.0.0.1:${port}`, origin: `https://mcp.example.com:${port}` };
}

async function ready(port) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("server not ready");
}

async function stop(s) {
  s.child.kill("SIGTERM");
  await once(s.child, "exit").catch(() => {});
}

const mcpInit = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } };

function mcp(base, { query = "", auth } = {}) {
  return fetch(`${base}/mcp${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(auth ? { Authorization: auth } : {}) },
    body: JSON.stringify(mcpInit),
  });
}

test("O-001: a registration flood never evicts a client that is in use", () => {
  const { dir, store, user } = seed();
  try {
    const used = store.registerOAuthClient({ name: "Claude", redirectUris: [REDIRECT] });
    store.issueOAuthTokens(user.id, used, 3600, 86400);
    for (let i = 0; i < 250; i++) store.registerOAuthClient({ name: `spam ${i}`, redirectUris: [REDIRECT] });
    assert.ok(store.getOAuthClient(used.id), "the connector with tokens survives");
    // fill every slot with clients that hold tokens: then registration is refused instead
    // (199 more: with the first connector that makes all 200 slots used)
    for (let i = 0; i < 199; i++) {
      const c = store.registerOAuthClient({ name: `real ${i}`, redirectUris: [REDIRECT] });
      store.issueOAuthTokens(user.id, c, 3600, 86400);
    }
    assert.throws(() => store.registerOAuthClient({ name: "one more", redirectUris: [REDIRECT] }), OAuthClientLimitError);
    assert.ok(store.getOAuthClient(used.id));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("O-002: ?token= is refused unless ALLOW_TOKEN_IN_URL=true; the header always works", async () => {
  const { dir, configPath, token } = seed();
  for (const [allow, expected] of [["", 401], ["true", 200]]) {
    const s = start({ CONFIG_PATH: configPath, ...(allow ? { ALLOW_TOKEN_IN_URL: allow } : {}) });
    try {
      await ready(s.port);
      assert.equal((await mcp(s.base, { query: `?token=${token}` })).status, expected, `ALLOW_TOKEN_IN_URL=${allow || "unset"}`);
      assert.equal((await mcp(s.base, { auth: `Bearer ${token}` })).status, 200);
    } finally {
      await stop(s);
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

test("O-003 and O-004: sign-in starts are limited; a password change signs out other sessions", async () => {
  const { dir, configPath } = seed();
  const s = start({ CONFIG_PATH: configPath });
  const json = { "Content-Type": "application/json", Origin: s.origin };
  try {
    await ready(s.port);

    const login = async () => {
      const r = await fetch(`${s.base}/admin/api/login/password`, { method: "POST", headers: json, body: JSON.stringify({ name: "Alice", password: PASSWORD }) });
      assert.equal(r.status, 200);
      return r.headers.get("set-cookie").split(";")[0];
    };
    const state = (cookie) => fetch(`${s.base}/admin/api/overview`, { headers: { Cookie: cookie } }).then((r) => r.status);

    const a = await login();
    const b = await login();
    assert.equal(await state(a), 200);
    assert.equal(await state(b), 200);
    const change = await fetch(`${s.base}/admin/api/me/password`, {
      method: "PUT", headers: { ...json, Cookie: a }, body: JSON.stringify({ currentPassword: PASSWORD, password: "another long password" }),
    });
    assert.equal(change.status, 200);
    assert.equal(await state(a), 200, "the session that made the change stays signed in");
    assert.equal(await state(b), 401, "other sessions are signed out");

    let limited = false;
    for (let i = 0; i < 110 && !limited; i++) {
      const r = await fetch(`${s.base}/admin/api/login/options`, { method: "POST", headers: json, body: "{}" });
      if (r.status === 429) limited = true;
      else assert.equal(r.status, 200);
    }
    assert.ok(limited, "unauthenticated sign-in starts are rate limited per address");
  } finally {
    await stop(s);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("O-006: upstream errors keep short messages and drop raw bodies", () => {
  const quiet = console.error;
  console.error = () => {};
  try {
    assert.equal(upstreamErrorDetail("Radarr", 400, JSON.stringify([{ propertyName: "Path", errorMessage: "Path is already configured" }])), " - Path is already configured");
    assert.equal(upstreamErrorDetail("Overseerr", 500, JSON.stringify({ message: "Request not found" })), " - Request not found");
    assert.equal(upstreamErrorDetail("Radarr", 500, "<html>System.IO.DirectoryNotFoundException at /opt/Radarr/Radarr.dll</html>"), "");
    assert.equal(upstreamErrorDetail("Radarr", 500, JSON.stringify({ exception: "at /opt/x", type: "Error" })), "");
    assert.ok(upstreamErrorDetail("Radarr", 400, JSON.stringify({ message: "x".repeat(500) })).length <= 203);
  } finally {
    console.error = quiet;
  }
});
