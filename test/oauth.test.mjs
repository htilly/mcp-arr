import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ConfigStore } from "../dist/config-store.js";

// OAuth 2.1 sign-in for Claude / OpenAI connectors: discovery, dynamic client
// registration, authorization code + PKCE, refresh rotation, and the rule that it
// only switches on when a publicly trusted certificate setup is in place.

const KEY = "test-passphrase";

function seed() {
  const dir = mkdtempSync(join(tmpdir(), "mcp-arr-oauth-"));
  const configPath = join(dir, "config.json");
  const store = new ConfigStore({ path: configPath, allowAutoKey: false, env: { CONFIG_ENCRYPTION_KEY: KEY } });
  store.load();
  const user = store.createUser("Alice", "admin", { id: "dGVzdA", publicKey: "AA", counter: 0, name: "k" }, "aGFuZGxl");
  store.setPassword(user.id, "correct horse battery");
  return { dir, configPath };
}

function start(env) {
  const port = String(34000 + Math.floor(Math.random() * 1000));
  const child = spawn(process.execPath, ["dist/index.js"], {
    cwd: new URL("..", import.meta.url),
    env: { PATH: process.env.PATH, MCP_TRANSPORT: "http", HOST: "127.0.0.1", PORT: port, CONFIG_ENCRYPTION_KEY: KEY, ...env(port) },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (c) => (stderr += c));
  return { port, child, stderr: () => stderr };
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

const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

test("OAuth: full authorization-code + PKCE flow, refresh rotation and revocation", async () => {
  const { dir, configPath } = seed();
  const s = start((port) => ({ TLS_MODE: "off", PUBLIC_URL: `https://mcp.example.com:${port}`, CONFIG_PATH: configPath }));
  const base = `http://127.0.0.1:${s.port}`;
  const origin = `https://mcp.example.com:${s.port}`;
  try {
    await ready(s.port);

    // discovery
    const meta = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
    assert.equal(meta.issuer, origin);
    assert.deepEqual(meta.code_challenge_methods_supported, ["S256"]);
    const prm = await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).json();
    assert.equal(prm.resource, `${origin}/mcp`);

    // /mcp points unauthenticated clients at the metadata
    const unauth = await fetch(`${base}/mcp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(unauth.status, 401);
    assert.match(unauth.headers.get("www-authenticate"), /resource_metadata="https:\/\/mcp\.example\.com:\d+\/\.well-known\/oauth-protected-resource\/mcp"/);

    // registration: unknown redirect hosts are refused, known ones accepted
    const evil = await fetch(`${base}/oauth/register`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_name: "x", redirect_uris: ["https://evil.example.org/cb"] }),
    });
    assert.equal(evil.status, 400);
    const reg = await fetch(`${base}/oauth/register`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_name: "Claude", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" }),
    });
    assert.equal(reg.status, 201);
    const client = await reg.json();

    // sign in to the web UI (password)
    const login = await fetch(`${base}/admin/api/login/password`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ name: "Alice", password: "correct horse battery" }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const ui = (path, method = "GET") => fetch(`${base}/admin/api${path}`, { method, headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" } });

    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const authorize = (extra = {}) => {
      const q = new URLSearchParams({ response_type: "code", client_id: client.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", state: "st4te", resource: `${origin}/mcp`, ...extra });
      return fetch(`${base}/oauth/authorize?${q}`, { redirect: "manual" });
    };

    // bad requests are shown, not redirected
    assert.equal((await authorize({ redirect_uri: "https://claude.ai/other" })).status, 400);
    assert.equal((await authorize({ code_challenge_method: "plain" })).status, 400);

    const az = await authorize();
    assert.equal(az.status, 302);
    const requestId = /#oauth=([A-Za-z0-9_-]+)/.exec(az.headers.get("location"))[1];

    // consent needs a logged-in user
    assert.equal((await fetch(`${base}/admin/api/oauth/request/${requestId}`)).status, 401);
    const info = await (await ui(`/oauth/request/${requestId}`)).json();
    assert.equal(info.clientName, "Claude");
    assert.equal(info.redirectHost, "claude.ai");

    const approved = await (await ui(`/oauth/request/${requestId}/approve`, "POST")).json();
    const cb = new URL(approved.redirect);
    assert.equal(cb.origin + cb.pathname, REDIRECT);
    assert.equal(cb.searchParams.get("state"), "st4te");
    const code = cb.searchParams.get("code");
    assert.ok(code);
    // a request can be completed only once
    assert.equal((await ui(`/oauth/request/${requestId}/approve`, "POST")).status, 404);

    const tokenReq = (params) => fetch(`${base}/oauth/token`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: client.client_id, ...params }),
    });

    // wrong verifier burns the code
    assert.equal((await tokenReq({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, code_verifier: randomBytes(48).toString("base64url") })).status, 400);
    assert.equal((await tokenReq({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, code_verifier: verifier })).status, 400);

    // happy path with a fresh code
    const az2 = await authorize();
    const id2 = /#oauth=([A-Za-z0-9_-]+)/.exec(az2.headers.get("location"))[1];
    const code2 = new URL((await (await ui(`/oauth/request/${id2}/approve`, "POST")).json()).redirect).searchParams.get("code");
    const tokRes = await tokenReq({ grant_type: "authorization_code", code: code2, redirect_uri: REDIRECT, code_verifier: verifier });
    assert.equal(tokRes.status, 200);
    const tok = await tokRes.json();
    assert.equal(tok.token_type, "Bearer");
    assert.ok(tok.refresh_token);

    const mcp = (token) => fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } }),
    });
    assert.equal((await mcp(tok.access_token)).status, 200);

    // refresh rotates both tokens
    const ref = await (await tokenReq({ grant_type: "refresh_token", refresh_token: tok.refresh_token })).json();
    assert.ok(ref.access_token && ref.access_token !== tok.access_token);
    assert.equal((await mcp(tok.access_token)).status, 401, "old access token is replaced");
    assert.equal((await tokenReq({ grant_type: "refresh_token", refresh_token: tok.refresh_token })).status, 400, "refresh tokens are single-use");
    assert.equal((await mcp(ref.access_token)).status, 200);

    // revocation
    const rev = await fetch(`${base}/oauth/revoke`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: client.client_id, token: ref.access_token }),
    });
    assert.equal(rev.status, 200);
    assert.equal((await mcp(ref.access_token)).status, 401);
    assert.equal((await tokenReq({ grant_type: "refresh_token", refresh_token: ref.refresh_token })).status, 400);
  } finally {
    await stop(s);
    rmSync(dir, { recursive: true, force: true });
  }
  assert.doesNotMatch(s.stderr(), /Fatal error/);
});

test("OAuth stays off with the built-in CA or an http PUBLIC_URL, and OAUTH=off wins", async () => {
  for (const [label, env] of [
    ["internal CA", (port) => ({ PUBLIC_URL: `https://localhost:${port}` })],
    ["http", (port) => ({ TLS_MODE: "off", PUBLIC_URL: `http://localhost:${port}` })],
    ["OAUTH=off", (port) => ({ TLS_MODE: "off", PUBLIC_URL: `https://mcp.example.com:${port}`, OAUTH: "off" })],
  ]) {
    const { dir, configPath } = seed();
    const s = start((port) => ({ ...env(port), CONFIG_PATH: configPath }));
    try {
      const deadline = Date.now() + 15000;
      while (!/OAuth:/.test(s.stderr()) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
      assert.match(s.stderr(), /OAuth:\s+off/, label);
    } finally {
      await stop(s);
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
