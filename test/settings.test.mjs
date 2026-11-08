import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ConfigStore } from "../dist/config-store.js";
import { effectiveSettings, mergedEnv, normaliseSetting } from "../dist/settings.js";

// Server settings in the web UI: saved encrypted, environment wins, applied live
// (including switching the listener between plain HTTP and HTTPS on the same port).

const KEY = "test-passphrase";

test("effective settings: environment wins over saved values over defaults", () => {
  const eff = effectiveSettings({ TLS_MODE: "acme", OAUTH: "off" }, { OAUTH: "on", CF_DNS_API_TOKEN: "abc" });
  assert.deepEqual(eff.TLS_MODE, { value: "acme", source: "file" });
  assert.equal(eff.OAUTH.source, "env");
  assert.equal(eff.OAUTH.value, "on");
  assert.equal(eff.CLOUDFLARE_DNS_API_TOKEN.envKey, "CF_DNS_API_TOKEN", "aliases count as the environment");
  assert.equal(eff.TRUST_PROXY.source, "default");
  assert.equal(eff.ACME_HTTP_PORT.value, "80");
  assert.equal(effectiveSettings({}, { MCP_ARR_DOCKER: "1" }).ACME_HTTP_PORT.value, "8080");
  assert.equal(effectiveSettings({ ACME_DNS_PROVIDER: "cloudflare" }, {}).ACME_CHALLENGE.value, "dns-01", "a DNS provider implies dns-01");

  const env = mergedEnv({ TLS_MODE: "acme", OAUTH: "off" }, { OAUTH: "on", PATH: "/bin" });
  assert.equal(env.TLS_MODE, "acme");
  assert.equal(env.OAUTH, "on");
  assert.equal(env.PATH, "/bin");

  assert.equal(normaliseSetting("TLS_SANS", " a , b,, c "), "a,b,c");
  assert.throws(() => normaliseSetting("TLS_MODE", "weird"), /unknown option/);
  assert.throws(() => normaliseSetting("ACME_HTTP_PORT", "99999"), /whole number/);
  assert.throws(() => normaliseSetting("ACME_EMAIL", "nope"), /e-mail/);
  assert.throws(() => normaliseSetting("ACME_DNS_HOOK", "/bin/sh"), /Unknown setting/, "the exec hook is environment-only");
  assert.throws(() => normaliseSetting("TLS_CERT_FILE", "a\nb"), /single line/);
});

function seed(settings) {
  const dir = mkdtempSync(join(tmpdir(), "mcp-arr-settings-"));
  const configPath = join(dir, "config.json");
  const store = new ConfigStore({ path: configPath, allowAutoKey: false, env: { CONFIG_ENCRYPTION_KEY: KEY } });
  store.load();
  const user = store.createUser("Alice", "admin", { id: "dGVzdA", publicKey: "AA", counter: 0, name: "k" }, "aGFuZGxl");
  store.setPassword(user.id, "correct horse battery");
  if (settings) store.setSettings(settings);
  return { dir, configPath };
}

function start(env, port = 36000 + Math.floor(Math.random() * 1000)) {
  const full = { PATH: process.env.PATH, MCP_TRANSPORT: "http", HOST: "127.0.0.1", PORT: String(port), CONFIG_ENCRYPTION_KEY: KEY, PUBLIC_URL: `https://mcp.example.com:${port}`, ...env };
  for (const k of Object.keys(full)) if (full[k] === undefined) delete full[k];
  const child = spawn(process.execPath, ["dist/index.js"], {
    cwd: new URL("..", import.meta.url),
    env: full,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let out = "";
  child.stderr.setEncoding("utf8").on("data", (c) => (out += c));
  return { port, child, out: () => out, origin: full.PUBLIC_URL ? new URL(full.PUBLIC_URL).origin : `https://127.0.0.1:${port}` };
}

async function stop(s) {
  if (s.child.exitCode !== null) return;
  s.child.kill("SIGTERM");
  await once(s.child, "exit").catch(() => {});
}

/** Request over plain HTTP or HTTPS (any certificate). */
function call(s, secure, path, { method = "GET", body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = (secure ? httpsRequest : httpRequest)({
      host: "127.0.0.1", port: s.port, path, method, agent: false, rejectUnauthorized: false, servername: new URL(s.origin).hostname === "127.0.0.1" ? undefined : new URL(s.origin).hostname,
      headers: { "Content-Type": "application/json", Origin: s.origin, ...(cookie ? { Cookie: cookie } : {}), ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}) },
    }, (res) => {
      const peer = secure ? res.socket?.getPeerCertificate?.() : undefined;
      const issuer = peer?.issuer ? `${peer.issuer.CN ?? ""} ${peer.issuer.O ?? ""}`.trim() : undefined;
      let text = "";
      res.setEncoding("utf8").on("data", (c) => (text += c)).on("end", () => {
        let json;
        try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, json, text, issuer });
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function until(fn, ms, what) {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => undefined);
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function login(s, secure) {
  const r = await call(s, secure, "/admin/api/login/password", { method: "POST", body: { name: "Alice", password: "correct horse battery" } });
  assert.equal(r.status, 200);
  return r.headers["set-cookie"][0].split(";")[0];
}

test("settings are saved, validated, tested and applied live - including HTTP <-> HTTPS", { timeout: 60_000 }, async () => {
  // Start in plain HTTP mode from a *saved* setting (no TLS_MODE in the environment)
  const { dir, configPath } = seed({ TLS_MODE: "off" });
  let s = start({ CONFIG_PATH: configPath, TRUST_PROXY: "true" });
  try {
    await until(async () => (await call(s, false, "/health")).status === 200, 15000, "server");
    const cookie = await login(s, false);
    const ui = (path, opts = {}, secure = false) => call(s, secure, `/admin/api${path}`, { cookie, ...opts });

    let ov = (await ui("/overview")).json;
    assert.equal(ov.settings.values.TLS_MODE.value, "off");
    assert.equal(ov.settings.values.TLS_MODE.source, "file");
    assert.equal(ov.settings.values.TRUST_PROXY.source, "env");
    assert.equal(ov.oauth.enabled, true, "https PUBLIC_URL behind a proxy -> OAuth auto on");

    // OAuth off, live
    let r = await ui("/settings", { method: "PUT", body: { values: { OAUTH: "off" } } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.listenerChange, false);
    assert.equal(r.json.overview.oauth.enabled, false);
    assert.equal((await call(s, false, "/.well-known/oauth-authorization-server")).status, 404);

    // Environment-locked, unknown and invalid values are refused; nothing is saved
    assert.equal((await ui("/settings", { method: "PUT", body: { values: { TRUST_PROXY: "false" } } })).status, 409);
    assert.equal((await ui("/settings", { method: "PUT", body: { values: { ACME_DNS_HOOK: "/bin/sh" } } })).status, 400);
    r = await ui("/settings", { method: "PUT", body: { values: { TLS_MODE: "file" } } });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /certificate and the key file/);
    assert.equal((await ui("/overview")).json.settings.values.TLS_MODE.value, "off");

    // Secrets are never sent back
    r = await ui("/settings", { method: "PUT", body: { values: { CLOUDFLARE_DNS_API_TOKEN: "super-secret-token-1234" } } });
    assert.equal(r.status, 200);
    const tokenView = r.json.overview.settings.values.CLOUDFLARE_DNS_API_TOKEN;
    assert.deepEqual([tokenView.value, tokenView.hasValue, tokenView.hint], ["", true, "1234"]);
    assert.doesNotMatch(JSON.stringify(r.json), /super-secret/);

    // Test without applying
    r = await ui("/settings/test", { method: "POST", body: { values: { TLS_MODE: "internal" } } });
    assert.equal(r.status, 200);
    const job = await until(async () => {
      const j = (await ui(`/settings/test/${r.json.id}`)).json;
      return j.status !== "running" && j;
    }, 10000, "test job");
    assert.equal(job.status, "ok", job.message);
    assert.match(job.message, /NEW root CA/);
    assert.match(job.log.join("\n"), /OAuth .* would be off/);
    assert.equal((await ui("/overview")).json.settings.values.TLS_MODE.value, "off", "testing does not apply");

    // Switch to the built-in CA: the same port now speaks HTTPS
    r = await ui("/settings", { method: "PUT", body: { values: { TLS_MODE: "internal" } } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.listenerChange, true);
    const health = await until(async () => {
      const h = await call(s, true, "/health");
      return h.status === 200 && h;
    }, 10000, "https after switch");
    assert.match(health.issuer, /mcp-arr local CA/);
    // The session survives; switch back to plain HTTP over the HTTPS connection
    ov = (await ui("/overview", {}, true)).json;
    assert.equal(ov.tls.mode, "internal");
    r = await ui("/settings", { method: "PUT", body: { values: { TLS_MODE: "off" } } }, true);
    assert.equal(r.json.listenerChange, true);
    await until(async () => (await call(s, false, "/health")).status === 200, 10000, "http after switching back");

    // Saved settings survive a restart
    await ui("/settings", { method: "PUT", body: { values: { TLS_MODE: "internal" } } });
    await stop(s);
    s = start({ CONFIG_PATH: configPath });
    await until(async () => (await call(s, true, "/health")).status === 200, 15000, "https after restart");
    assert.match(s.out(), /built-in CA/);
  } finally {
    await stop(s);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("setup mode: starts without PUBLIC_URL, passwords only, then PUBLIC_URL is set in the web UI and the server restarts on it", { timeout: 60_000 }, async () => {
  const { dir, configPath } = seed();
  let s = start({ CONFIG_PATH: configPath, PUBLIC_URL: undefined });
  try {
    await until(async () => (await call(s, true, "/health")).status === 200, 15000, "server in setup mode");
    let st = (await call(s, true, "/admin/api/state")).json;
    assert.equal(st.setupMode, true);
    assert.match(st.setupReason, /PUBLIC_URL is not set/);
    const health = await call(s, true, "/health");
    assert.match(health.issuer, /temporary/, "temporary self-signed certificate");
    assert.equal(health.headers["strict-transport-security"], undefined, "no HSTS for a temporary certificate");

    // Passkeys are off, passwords work; the page's own address is the allowed origin
    assert.equal((await call(s, true, "/admin/api/login/options", { method: "POST", body: {} })).status, 400);
    const cookie = await login(s, true);
    const ui = (path, opts = {}) => call(s, true, `/admin/api${path}`, { cookie, ...opts });
    const ov = (await ui("/overview")).json;
    assert.match(ov.setup.reason, /PUBLIC_URL/);
    assert.equal(ov.oauth.enabled, false);
    assert.equal(ov.settings.values.PUBLIC_URL.value, "");

    // Invalid addresses are refused
    let r = await ui("/settings", { method: "PUT", body: { values: { PUBLIC_URL: "https://192.168.1.10:3000" } } });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /host name, not an IP/);
    assert.equal((await ui("/settings", { method: "PUT", body: { values: { PUBLIC_URL: "http://mcp.example.com" } } })).status, 400);

    // Set it: the server restarts on the new address with the built-in CA
    r = await ui("/settings", { method: "PUT", body: { values: { PUBLIC_URL: `https://mcp.example.com:${s.port}` } } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.restart, true);
    assert.equal(r.json.reloadUrl, `https://mcp.example.com:${s.port}/admin`);
    const named = { ...s, origin: `https://mcp.example.com:${s.port}` };
    await until(async () => (await call(named, true, "/admin/api/state")).json?.setupMode === false, 15000, "restart with PUBLIC_URL");
    assert.match((await call(named, true, "/health")).issuer, /mcp-arr local CA/);
    assert.match(s.out(), /PUBLIC_URL changed in the web UI by Alice/);
    // The old (setup) origin is no longer accepted
    assert.equal((await call(s, true, "/admin/api/login/password", { method: "POST", body: { name: "Alice", password: "correct horse battery" } })).status, 403);
    const cookie2 = await login(named, true);
    assert.equal((await call(named, true, "/admin/api/overview", { cookie: cookie2 })).json.settings.values.PUBLIC_URL.source, "file");

    // Saved, so it survives a restart without the environment variable
    await stop(s);
    s = start({ CONFIG_PATH: configPath, PUBLIC_URL: undefined }, s.port);
    const again = { ...s, origin: `https://mcp.example.com:${s.port}` };
    await until(async () => (await call(again, true, "/admin/api/state")).json?.setupMode === false, 15000, "restart from saved PUBLIC_URL");
  } finally {
    await stop(s);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("saved settings that cannot be used do not stop the server", { timeout: 30_000 }, async () => {
  const { dir, configPath } = seed({ TLS_MODE: "file", TLS_CERT_FILE: "/nonexistent/cert.pem", TLS_KEY_FILE: "/nonexistent/key.pem" });
  const s = start({ CONFIG_PATH: configPath });
  try {
    await until(async () => (await call(s, true, "/health")).status === 200, 15000, "server with broken settings");
    assert.match((await call(s, true, "/health")).issuer, /temporary/);
    const cookie = await login(s, true);
    const ov = (await call(s, true, "/admin/api/overview", { cookie })).json;
    assert.match(ov.tls.lastError, /could not be used: TLS_CERT_FILE \/nonexistent\/cert.pem does not exist/);
    // ... and can be fixed in the web UI
    const r = await call(s, true, "/admin/api/settings", { method: "PUT", cookie, body: { values: { TLS_MODE: "internal" } } });
    assert.equal(r.status, 200, r.text);
    await until(async () => /mcp-arr local CA/.test((await call(s, true, "/health")).issuer), 10000, "fixed");
  } finally {
    await stop(s);
    rmSync(dir, { recursive: true, force: true });
  }
});
