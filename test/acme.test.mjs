import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { connect } from "node:tls";
import { request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ConfigStore } from "../dist/config-store.js";
import { acmeSettingsFromEnv, createDnsSolver } from "../dist/acme.js";
import { resolveOAuthMode } from "../dist/oauth.js";

// TLS_MODE=acme against Pebble, Let's Encrypt's ACME test server.
//
// The end-to-end tests run only when Pebble is available:
//   go install github.com/letsencrypt/pebble/v2/cmd/pebble@v2.7.0
//   go install github.com/letsencrypt/pebble/v2/cmd/pebble-challtestsrv@v2.7.0
//   PEBBLE_BIN=<dir with both binaries> PEBBLE_DIR=<pebble source dir, for test/certs> node --test test/acme.test.mjs
// (PEBBLE_DIR is e.g. $(go env GOMODCACHE)/github.com/letsencrypt/pebble/v2@v2.7.0)

const PEBBLE_BIN = process.env.PEBBLE_BIN;
const PEBBLE_DIR = process.env.PEBBLE_DIR;
const havePebble = !!(PEBBLE_BIN && PEBBLE_DIR && existsSync(join(PEBBLE_BIN, "pebble")));
const KEY = "test-passphrase";

// ---------- unit tests (always run) ----------

test("acmeSettingsFromEnv validates the configuration", () => {
  const base = { ACME_EMAIL: "a@example.com" };
  const s = acmeSettingsFromEnv(base, ["mcp.example.com", "192.168.1.5"], "https://mcp.example.com", "0.0.0.0");
  assert.deepEqual(s.domains, ["mcp.example.com"], "IP addresses are dropped");
  assert.equal(s.challenge, "http-01");
  assert.equal(s.httpPort, 80);
  assert.match(s.directoryUrl, /acme-v02\.api\.letsencrypt\.org/);

  const staging = acmeSettingsFromEnv({ ACME_STAGING: "true" }, ["a.example.com"], "https://a.example.com", "0.0.0.0");
  assert.match(staging.directoryUrl, /staging/);

  const dns = acmeSettingsFromEnv({ ACME_DNS_PROVIDER: "cloudflare", CLOUDFLARE_DNS_API_TOKEN: "t" }, ["a.example.com"], "", "");
  assert.equal(dns.challenge, "dns-01", "a DNS provider implies dns-01");

  assert.throws(() => acmeSettingsFromEnv({ ACME_DNS_PROVIDER: "cloudflare" }, ["a.example.com"], "", ""), /CLOUDFLARE_DNS_API_TOKEN/);
  assert.throws(() => acmeSettingsFromEnv({ ACME_DNS_PROVIDER: "route99" }, ["a.example.com"], "", ""), /Unknown ACME_DNS_PROVIDER/);
  assert.throws(() => acmeSettingsFromEnv({ ACME_DOMAINS: "*.example.com" }, ["a.example.com"], "", ""), /Wildcard/);
  assert.throws(() => acmeSettingsFromEnv({ ACME_CHALLENGE: "dns-01" }, ["a.example.com"], "", ""), /ACME_DNS_PROVIDER/);
  assert.throws(() => acmeSettingsFromEnv({ ACME_DNS_PROVIDER: "acme-dns", ACMEDNS_USERNAME: "u" }, ["a.example.com"], "", ""), /ACMEDNS_PASSWORD/);
  assert.throws(() => acmeSettingsFromEnv({}, ["10.0.0.1"], "", ""), /at least one DNS name/);
  assert.throws(() => acmeSettingsFromEnv({ ACME_EAB_KID: "k" }, ["a.example.com"], "", ""), /ACME_EAB_HMAC_KEY/);
});

test("OAuth auto mode accepts a public ACME certificate but not staging", () => {
  const publicUrl = new URL("https://mcp.example.com");
  assert.equal(resolveOAuthMode({ setting: "auto", publicUrl, tlsMode: "acme" }).enabled, true);
  const staging = resolveOAuthMode({ setting: "auto", publicUrl, tlsMode: "acme", certProblem: "staging" });
  assert.equal(staging.enabled, false);
});

test("Cloudflare solver finds the zone by walking up the name and creates/deletes the TXT record", async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET", body: init.body, auth: init.headers?.Authorization });
    const u = new URL(url);
    let result;
    if (u.pathname.endsWith("/zones")) result = u.searchParams.get("name") === "example.com" ? [{ id: "zone1" }] : [];
    else if (init.method === "POST") result = { id: "rec1" };
    else result = { id: "rec1" };
    return new Response(JSON.stringify({ success: true, result }), { status: 200 });
  };
  try {
    const s = acmeSettingsFromEnv({ ACME_DNS_PROVIDER: "cloudflare", CLOUDFLARE_DNS_API_TOKEN: "tok" }, ["mcp.home.example.com"], "", "");
    const solver = createDnsSolver(s, { directoryUrl: "x", accountKeyPem: "" }, () => {}, () => {});
    const handle = await solver.present("_acme-challenge.mcp.home.example.com.", "VALUE", "mcp.home.example.com");
    await solver.cleanup("_acme-challenge.mcp.home.example.com.", "VALUE", handle);
  } finally {
    globalThis.fetch = realFetch;
  }
  const zoneLookups = calls.filter((c) => c.url.includes("/zones?name="));
  assert.deepEqual(zoneLookups.map((c) => new URL(c.url).searchParams.get("name")), ["_acme-challenge.mcp.home.example.com", "mcp.home.example.com", "home.example.com", "example.com"]);
  const create = calls.find((c) => c.method === "POST");
  assert.match(create.url, /\/zones\/zone1\/dns_records$/);
  assert.deepEqual({ ...JSON.parse(create.body), comment: undefined }, { type: "TXT", name: "_acme-challenge.mcp.home.example.com", content: "VALUE", ttl: 120, comment: undefined });
  assert.equal(create.auth, "Bearer tok");
  assert.match(calls.find((c) => c.method === "DELETE").url, /\/zones\/zone1\/dns_records\/rec1$/);
});

// ---------- end-to-end against Pebble ----------

function seed() {
  const dir = mkdtempSync(join(tmpdir(), "mcp-arr-acme-"));
  const configPath = join(dir, "config.json");
  const store = new ConfigStore({ path: configPath, allowAutoKey: false, env: { CONFIG_ENCRYPTION_KEY: KEY } });
  store.load();
  return { dir, configPath };
}

function spawnLogged(cmd, args, opts = {}) {
  const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
  let out = "";
  child.stdout.setEncoding("utf8").on("data", (c) => (out += c));
  child.stderr.setEncoding("utf8").on("data", (c) => (out += c));
  return { child, out: () => out };
}

async function stop(p) {
  if (p.child.exitCode !== null) return;
  p.child.kill("SIGTERM");
  await once(p.child, "exit").catch(() => {});
}

async function waitFor(fn, ms, what) {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => undefined);
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** Issuer of the certificate the server presents for `servername`. */
function peerIssuer(port, servername) {
  return new Promise((resolve, reject) => {
    const s = connect({ host: "127.0.0.1", port, servername, rejectUnauthorized: false }, () => {
      const c = s.getPeerCertificate();
      s.end();
      resolve(c.issuer?.CN ?? "");
    });
    s.on("error", reject);
  });
}

async function startPebble(httpPort) {
  const base = 14000 + Math.floor(Math.random() * 500) * 2;
  const dnsPort = base + 1000 + 3;
  const mgmt = base + 1000 + 5;
  const dir = mkdtempSync(join(tmpdir(), "pebble-"));
  const config = join(dir, "pebble.json");
  writeFileSync(config, JSON.stringify({
    pebble: {
      listenAddress: `127.0.0.1:${base}`,
      managementListenAddress: `127.0.0.1:${base + 1}`,
      certificate: join(PEBBLE_DIR, "test/certs/localhost/cert.pem"),
      privateKey: join(PEBBLE_DIR, "test/certs/localhost/key.pem"),
      httpPort,
      tlsPort: 5001,
      externalAccountBindingRequired: false,
      retryAfter: { authz: 1, order: 1 },
      profiles: { default: { description: "default", validityPeriod: 7776000 } },
    },
  }));
  const challtest = spawnLogged(join(PEBBLE_BIN, "pebble-challtestsrv"), [
    "-defaultIPv4", "127.0.0.1", "-defaultIPv6", "",
    "-dns01", `127.0.0.1:${dnsPort}`, "-management", `127.0.0.1:${mgmt}`,
    "-http01", "", "-https01", "", "-tlsalpn01", "", "-doh", "",
  ]);
  const pebble = spawnLogged(join(PEBBLE_BIN, "pebble"), ["-config", config, "-dnsserver", `127.0.0.1:${dnsPort}`], {
    env: { ...process.env, PEBBLE_VA_NOSLEEP: "1" },
  });
  const directory = `https://localhost:${base}/dir`;
  const ca = join(PEBBLE_DIR, "test/certs/pebble.minica.pem");
  await waitFor(async () => {
    const r = await fetch(`http://127.0.0.1:${mgmt}/clear-request-history`, { method: "POST", body: '{"host":"x"}' });
    return r.status < 500;
  }, 15000, "challtestsrv");
  await waitFor(() => new Promise((res) => {
    const s = connect({ host: "127.0.0.1", port: base, rejectUnauthorized: false }, () => { s.end(); res(true); });
    s.on("error", () => res(false));
  }), 15000, "pebble");
  const mgmtPost = (path, body) => fetch(`http://127.0.0.1:${mgmt}${path}`, { method: "POST", body: JSON.stringify(body) });
  return {
    directory, ca, dnsPort, mgmtPost,
    async stop() {
      await stop(pebble);
      await stop(challtest);
      rmSync(dir, { recursive: true, force: true });
    },
    logs: () => pebble.out(),
  };
}

function startMcp(env) {
  const port = 35000 + Math.floor(Math.random() * 1000);
  const p = spawnLogged(process.execPath, ["dist/index.js"], {
    cwd: new URL("..", import.meta.url),
    env: {
      PATH: process.env.PATH,
      MCP_TRANSPORT: "http",
      HOST: "127.0.0.1",
      PORT: String(port),
      CONFIG_ENCRYPTION_KEY: KEY,
      TLS_MODE: "acme",
      ACME_DNS_DELAY: "0",
      PUBLIC_URL: `https://mcp.example.test:${port}`,
      ...env,
    },
  });
  return { ...p, port };
}

test("TLS_MODE=acme gets a certificate via http-01, hot-swaps it and reuses it after restart", { skip: !havePebble && "Pebble not installed (set PEBBLE_BIN/PEBBLE_DIR)", timeout: 120_000 }, async () => {
  const httpPort = 25000 + Math.floor(Math.random() * 1000);
  const pebble = await startPebble(httpPort);
  const { dir, configPath } = seed();
  const env = {
    CONFIG_PATH: configPath,
    ACME_DIRECTORY_URL: pebble.directory,
    ACME_HTTP_PORT: String(httpPort),
    ACME_EMAIL: "admin@example.test",
    NODE_EXTRA_CA_CERTS: pebble.ca,
  };
  let mcp = startMcp(env);
  try {
    // Temporary self-signed certificate first, then the Pebble one without a restart
    await waitFor(async () => /Pebble Intermediate/.test(await peerIssuer(mcp.port, "mcp.example.test")), 60000, "ACME certificate\n" + mcp.out());
    assert.match(mcp.out(), /certificate issued/);

    // The challenge listener redirects normal requests to https
    const redirect = await fetch(`http://127.0.0.1:${httpPort}/admin`, { redirect: "manual" });
    assert.equal(redirect.status, 301);
    assert.equal(redirect.headers.get("location"), `https://mcp.example.test:${mcp.port}/admin`);
    const unknownToken = await fetch(`http://127.0.0.1:${httpPort}/.well-known/acme-challenge/nope`);
    assert.equal(unknownToken.status, 404);

    // Restart: the stored certificate is served immediately, no new order
    await stop(mcp);
    mcp = startMcp(env);
    await waitFor(async () => /Pebble Intermediate/.test(await peerIssuer(mcp.port, "mcp.example.test")), 15000, "restart").catch((e) => { throw new Error(e.message + "\n" + mcp.out()); });
    assert.match(mcp.out(), /certificate valid/);
    assert.doesNotMatch(mcp.out(), /requesting a certificate/);
  } finally {
    await stop(mcp);
    await pebble.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("TLS_MODE=acme gets a wildcard certificate via dns-01 with an exec hook", { skip: !havePebble && "Pebble not installed (set PEBBLE_BIN/PEBBLE_DIR)", timeout: 120_000 }, async () => {
  const pebble = await startPebble(25000 + Math.floor(Math.random() * 1000));
  const { dir, configPath } = seed();
  // Hook in the lego "exec" format: <script> present|cleanup <fqdn> <value>
  const hookServer = createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    const { action, fqdn, value } = JSON.parse(body);
    await pebble.mgmtPost(action === "present" ? "/set-txt" : "/clear-txt", action === "present" ? { host: fqdn, value } : { host: fqdn });
    res.end("ok");
  });
  await new Promise((r) => hookServer.listen(0, "127.0.0.1", r));
  const hook = join(dir, "hook.mjs");
  writeFileSync(hook, `#!${process.execPath}\nconst [action, fqdn, value] = process.argv.slice(2);\nawait fetch("http://127.0.0.1:${hookServer.address().port}", { method: "POST", body: JSON.stringify({ action, fqdn, value }) });\n`);
  chmodSync(hook, 0o755);

  const mcp = startMcp({
    CONFIG_PATH: configPath,
    ACME_DIRECTORY_URL: pebble.directory,
    ACME_DNS_PROVIDER: "exec",
    ACME_DNS_HOOK: hook,
    ACME_DOMAINS: "mcp.example.test,*.example.test",
    ACME_DNS_RESOLVERS: `127.0.0.1:${pebble.dnsPort}`,
    NODE_EXTRA_CA_CERTS: pebble.ca,
  });
  try {
    await waitFor(async () => /Pebble Intermediate/.test(await peerIssuer(mcp.port, "other.example.test")), 60000, "dns-01 certificate\n" + mcp.out());
    assert.match(mcp.out(), /via exec/);
  } finally {
    await stop(mcp);
    hookServer.close();
    await pebble.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("TLS_MODE=acme with acme-dns registers, waits for the CNAME, then issues", { skip: !havePebble && "Pebble not installed (set PEBBLE_BIN/PEBBLE_DIR)", timeout: 120_000 }, async () => {
  const pebble = await startPebble(25000 + Math.floor(Math.random() * 1000));
  const { dir, configPath } = seed();
  // Minimal acme-dns server: /register and /update (which sets the TXT record behind the CNAME)
  let updates = 0;
  const acmeDns = createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    if (req.url === "/register") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ username: "u1", password: "p1", subdomain: "abc123", fulldomain: "abc123.auth.example.test" }));
      return;
    }
    if (req.url === "/update" && req.headers["x-api-user"] === "u1" && req.headers["x-api-key"] === "p1") {
      const { txt } = JSON.parse(body);
      updates++;
      await pebble.mgmtPost("/set-txt", { host: "abc123.auth.example.test.", value: txt });
      res.end(JSON.stringify({ txt }));
      return;
    }
    res.statusCode = 401;
    res.end();
  });
  await new Promise((r) => acmeDns.listen(0, "127.0.0.1", r));
  const env = {
    CONFIG_PATH: configPath,
    ACME_DIRECTORY_URL: pebble.directory,
    ACME_DNS_PROVIDER: "acme-dns",
    ACMEDNS_API_BASE: `http://127.0.0.1:${acmeDns.address().port}`,
    ACME_DNS_RESOLVERS: `127.0.0.1:${pebble.dnsPort}`,
    NODE_EXTRA_CA_CERTS: pebble.ca,
  };
  let mcp = startMcp(env);
  try {
    await waitFor(async () => /_acme-challenge\.mcp\.example\.test CNAME abc123\.auth\.example\.test/.test(mcp.out()), 20000, "CNAME instructions\n" + mcp.out());
    assert.equal(updates, 0, "no ACME order before the CNAME exists");
    await stop(mcp);

    // User creates the CNAME; on the next start the registration is reused and the certificate issued
    await pebble.mgmtPost("/set-cname", { host: "_acme-challenge.mcp.example.test.", target: "abc123.auth.example.test." });
    mcp = startMcp(env);
    await waitFor(async () => /Pebble Intermediate/.test(await peerIssuer(mcp.port, "mcp.example.test")), 30000, "acme-dns certificate").catch((e) => { throw new Error(e.message + "\n" + mcp.out()); });
    assert.ok(updates >= 1);
    assert.doesNotMatch(mcp.out(), /registered mcp\.example\.test/, "the acme-dns account is stored and reused");
  } finally {
    await stop(mcp);
    acmeDns.close();
    await pebble.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Web UI: test ACME settings, then switch from the built-in CA to ACME live (old certificate kept until issued)", { skip: !havePebble && "Pebble not installed (set PEBBLE_BIN/PEBBLE_DIR)", timeout: 120_000 }, async () => {
  const httpPort = 25000 + Math.floor(Math.random() * 1000);
  const pebble = await startPebble(httpPort);
  const { dir, configPath } = seed();
  const store = new ConfigStore({ path: configPath, allowAutoKey: false, env: { CONFIG_ENCRYPTION_KEY: KEY } });
  store.load();
  const user = store.createUser("Alice", "admin", { id: "dGVzdA", publicKey: "AA", counter: 0, name: "k" }, "aGFuZGxl");
  store.setPassword(user.id, "correct horse battery");

  // TLS_MODE comes from the saved settings (default: built-in CA), not the environment
  const mcp = startMcp({ CONFIG_PATH: configPath, TLS_MODE: "", NODE_EXTRA_CA_CERTS: pebble.ca });
  const origin = `https://mcp.example.test:${mcp.port}`;
  const call = (path, { method = "GET", body, cookie } = {}) => new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = httpsRequest({
      host: "127.0.0.1", port: mcp.port, path, method, rejectUnauthorized: false, servername: "mcp.example.test",
      headers: { "Content-Type": "application/json", Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}) },
    }, (res) => {
      let text = "";
      res.setEncoding("utf8").on("data", (c) => (text += c)).on("end", () => {
        let json;
        try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, json, text });
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
  try {
    await waitFor(async () => /mcp-arr local CA/.test(await peerIssuer(mcp.port, "mcp.example.test")), 15000, "built-in CA");
    const login = await call("/admin/api/login/password", { method: "POST", body: { name: "Alice", password: "correct horse battery" } });
    assert.equal(login.status, 200, login.text);
    const cookie = login.headers["set-cookie"][0].split(";")[0];
    const values = { TLS_MODE: "acme", ACME_DIRECTORY_URL: pebble.directory, ACME_CHALLENGE: "http-01", ACME_HTTP_PORT: String(httpPort) };

    // Test: a real issuance against the CA, nothing applied
    const started = await call("/admin/api/settings/test", { method: "POST", body: { values }, cookie });
    assert.equal(started.status, 200, started.text);
    const job = await waitFor(async () => {
      const j = (await call(`/admin/api/settings/test/${started.json.id}`, { cookie })).json;
      return j.status !== "running" && j;
    }, 60000, "test job");
    assert.equal(job.status, "ok", `${job.message}\n${job.log.join("\n")}`);
    assert.match(job.log.join("\n"), /Validation passed/);
    assert.match(await peerIssuer(mcp.port, "mcp.example.test"), /mcp-arr local CA/, "testing does not change the certificate");
    const saved = new ConfigStore({ path: configPath, allowAutoKey: false, env: { CONFIG_ENCRYPTION_KEY: KEY } });
    saved.load();
    assert.equal(saved.getSettings().TLS_MODE, undefined, "testing saves nothing");

    // Apply: same HTTPS listener, the built-in certificate stays until the ACME one is issued
    const applied = await call("/admin/api/settings", { method: "PUT", body: { values }, cookie });
    assert.equal(applied.status, 200, applied.text);
    assert.equal(applied.json.listenerChange, false);
    assert.equal(applied.json.overview.tls.mode, "acme");
    assert.doesNotMatch(await peerIssuer(mcp.port, "mcp.example.test"), /temporary/);
    await waitFor(async () => /Pebble Intermediate/.test(await peerIssuer(mcp.port, "mcp.example.test")), 60000, "ACME certificate after apply");
    const ov = (await call("/admin/api/overview", { cookie })).json;
    assert.equal(ov.tls.acme.status, "valid");
  } finally {
    await stop(mcp);
    await pebble.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
