/**
 * HTTP(S) mode: Streamable HTTP MCP endpoint (/mcp) + web admin UI (/admin).
 *
 * - Served over HTTPS (see tls.ts) - designed for LAN use without internet access.
 * - Web UI: per-user login with passkeys (see auth.ts), roles admin/user.
 * - /mcp: per-user access tokens (Authorization: Bearer <token>, or ?token=<token>).
 *   Stateless Streamable HTTP: a fresh MCP server + transport per request and no
 *   Mcp-Session-Id, so clients that don't echo the session header (e.g. Claude Code)
 *   work and long-lived GET streams can't block other requests. The token is checked
 *   on every request, so revoking it or deleting its user takes effect immediately.
 */

import { createServer as createHttpServer, IncomingMessage, ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { randomBytes } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ConfigStore, Role, SERVICE_DEFS, ServiceId, StoredUser, isServiceId } from './config-store.js';
import { SonarrClient, RadarrClient, LidarrClient, ProwlarrClient } from './arr-client.js';
import { TautulliClient } from './tautulli-client.js';
import { OverseerrClient } from './overseerr-client.js';
import { BazarrClient } from './bazarr-client.js';
import { renderAdminPage } from './admin-ui.js';
import { Auth, AuthError } from './auth.js';
import { TlsManager } from './tls.js';

export interface HttpServerOptions {
  store: ConfigStore;
  auth: Auth;
  tls: TlsManager;
  publicUrl: URL;
  port: number;
  host: string;
  trustProxy: boolean;
  mcpPath: string;
  serverVersion: string;
  createServer: () => Server;
  onConfigChanged: () => void;
  getConfiguredSummary: () => string[];
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const MAX_BODY_BYTES = 1024 * 1024;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX_FAILURES = 10;
const TEST_TIMEOUT_MS = 10_000;
const SESSION_COOKIE = '__Host-marr_session';

// ---------- helpers ----------

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Request body too large');
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const text = await readBody(req);
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

function parseCookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      try {
        out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        // ignore malformed cookie
      }
    }
  }
  return out;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function role(value: unknown): Role {
  if (value === 'admin' || value === 'user') return value;
  throw new HttpError(400, "Role must be 'admin' or 'user'");
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms / 1000}s`)), ms);
    promise.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
  });
}

/** Try to connect to a service with the given URL/API key. */
export async function testServiceConnection(
  id: ServiceId,
  url: string,
  apiKey: string
): Promise<{ ok: boolean; version?: string; error?: string }> {
  const cfg = { url: url.replace(/\/+$/, ''), apiKey };
  try {
    const version = await withTimeout((async (): Promise<string | undefined> => {
      switch (id) {
        case 'sonarr': return (await new SonarrClient(cfg).getStatus()).version;
        case 'radarr': return (await new RadarrClient(cfg).getStatus()).version;
        case 'lidarr': return (await new LidarrClient(cfg).getStatus()).version;
        case 'prowlarr': return (await new ProwlarrClient(cfg).getStatus()).version;
        case 'tautulli': {
          const info = await new TautulliClient(cfg).request<{ tautulli_version?: string }>('get_tautulli_info');
          return info?.tautulli_version;
        }
        case 'overseerr': return (await new OverseerrClient(cfg).getStatus()).version;
        case 'bazarr': return (await new BazarrClient(cfg).getStatus()).bazarr_version;
      }
    })(), TEST_TIMEOUT_MS);
    return { ok: true, version };
  } catch (error) {
    const err = error as Error & { cause?: { code?: string; message?: string } };
    const detail = err.cause?.code || err.cause?.message;
    const message = `${err.message}${detail && !err.message.includes(detail) ? ` (${detail})` : ''}`;
    return { ok: false, error: message.slice(0, 300) };
  }
}

function publicUser(u: StoredUser) {
  return { id: u.id, name: u.name, role: u.role, createdAt: u.createdAt, passkeys: u.credentials.length };
}

// ---------- server ----------

export async function startHttpServer(opts: HttpServerOptions): Promise<void> {
  const { store, auth, tls } = opts;
  const publicOrigin = opts.publicUrl.origin;

  const failures = new Map<string, { count: number; first: number }>();

  function clientIp(req: IncomingMessage): string {
    if (opts.trustProxy) {
      const fwd = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
      if (fwd) return fwd;
    }
    return req.socket.remoteAddress ?? 'unknown';
  }

  function rateLimited(req: IncomingMessage): boolean {
    const f = failures.get(clientIp(req));
    return Boolean(f && f.count >= RATE_MAX_FAILURES && Date.now() - f.first < RATE_WINDOW_MS);
  }

  function recordFailure(req: IncomingMessage): void {
    const ip = clientIp(req);
    const f = failures.get(ip);
    if (!f || Date.now() - f.first > RATE_WINDOW_MS) failures.set(ip, { count: 1, first: Date.now() });
    else f.count++;
  }

  /** Run an auth step; count failures for rate limiting. */
  async function guarded<T>(req: IncomingMessage, fn: () => Promise<T>): Promise<T> {
    if (rateLimited(req)) throw new HttpError(429, 'Too many failed attempts - try again later');
    try {
      return await fn();
    } catch (error) {
      if (error instanceof AuthError && (error.status === 401 || error.status === 403)) recordFailure(req);
      throw error;
    }
  }

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [ip, f] of failures) if (now - f.first > RATE_WINDOW_MS) failures.delete(ip);
    auth.cleanup();
  }, 5 * 60 * 1000);
  cleanup.unref();

  // ----- MCP endpoint -----

  function mcpUser(req: IncomingMessage, url: URL): StoredUser | undefined {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : url.searchParams.get('token') ?? undefined;
    return token ? store.verifyToken(token) : undefined;
  }

  async function handleMcp(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const user = mcpUser(req, url);
    if (!user) {
      sendJson(res, 401, {
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Unauthorized: missing or invalid access token. Create one in the web UI (/admin).' },
        id: null,
      }, { 'WWW-Authenticate': 'Bearer' });
      return;
    }

    if (req.method !== 'POST' && req.method !== 'GET' && req.method !== 'DELETE') {
      sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'GET, POST, DELETE' });
      return;
    }
    const body = req.method === 'POST' ? await readJson(req) : undefined;
    const server = opts.createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  // ----- admin helpers -----

  function sessionCookie(sid: string): string {
    return `${SESSION_COOKIE}=${sid}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=${auth.sessionTtlSeconds}`;
  }

  function currentUser(req: IncomingMessage): StoredUser | undefined {
    return auth.sessionUser(parseCookies(req)[SESSION_COOKIE]);
  }

  function requireUser(req: IncomingMessage): StoredUser {
    const user = currentUser(req);
    if (!user) throw new HttpError(401, 'Not logged in');
    return user;
  }

  function requireAdmin(req: IncomingMessage): StoredUser {
    const user = requireUser(req);
    if (user.role !== 'admin') throw new HttpError(403, 'Admin role required');
    return user;
  }

  /** CSRF protection for state-changing requests (in addition to SameSite=Strict cookies). */
  function checkMutation(req: IncomingMessage): void {
    if (!(req.headers['content-type'] ?? '').includes('application/json')) {
      throw new HttpError(415, 'Content-Type must be application/json');
    }
    if (req.headers.origin !== publicOrigin) {
      throw new HttpError(403, `Origin not allowed - open the web UI at ${publicOrigin}`);
    }
  }

  function servicesView(includeDetails: boolean) {
    const effective = store.getEffective();
    return SERVICE_DEFS.map(def => {
      const e = effective[def.id];
      const base = { id: def.id, displayName: def.displayName, configured: Boolean(e.url && e.apiKey) };
      if (!includeDetails) return base;
      return {
        ...base,
        exampleUrl: def.exampleUrl,
        envPrefix: def.envPrefix,
        url: e.url ?? '',
        urlSource: e.urlSource,
        hasApiKey: Boolean(e.apiKey),
        apiKeyHint: e.apiKey && e.apiKey.length >= 12 ? e.apiKey.slice(-4) : '',
        apiKeySource: e.apiKeySource,
      };
    });
  }

  function tokensView(user: StoredUser) {
    const users = new Map(store.listUsers().map(u => [u.id, u.name]));
    return store.listTokens(user.role === 'admin' ? undefined : user.id).map(t => ({
      ...t,
      owner: users.get(t.userId) ?? 'unknown',
      own: t.userId === user.id,
    }));
  }

  function overview(user: StoredUser) {
    const isAdmin = user.role === 'admin';
    return {
      me: {
        ...publicUser(user),
        credentials: user.credentials.map(c => ({ id: c.id, name: c.name, createdAt: c.createdAt, lastUsedAt: c.lastUsedAt })),
      },
      publicUrl: publicOrigin,
      services: servicesView(isAdmin),
      configuredSummary: opts.getConfiguredSummary(),
      tokens: tokensView(user),
      tls: tls.info(),
      ...(isAdmin ? {
        users: store.listUsers().map(publicUser),
        invites: store.listInvites().map(i => ({ id: i.id, role: i.role, createdAt: i.createdAt, expiresAt: i.expiresAt })),
        security: {
          keySource: store.keySource,
          keyFilePath: store.keySource === 'key-file' ? store.keyFilePath : undefined,
          warnings: store.warnings,
          configPath: store.path,
          trustProxy: opts.trustProxy,
        },
      } : {}),
    };
  }

  // ----- admin API -----

  async function handleAdminApi(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    const method = req.method ?? 'GET';
    if (method !== 'GET') checkMutation(req);

    // --- public ---
    if (path === '/state' && method === 'GET') {
      const user = currentUser(req);
      sendJson(res, 200, {
        setupRequired: auth.setupRequired,
        recoveryAvailable: auth.recoveryAvailable,
        user: user ? publicUser(user) : null,
        rpID: auth.rpID,
      });
      return;
    }

    if (path === '/register/options' && method === 'POST') {
      const body = await readJson(req);
      const kind = str(body.kind);
      if (kind !== 'setup' && kind !== 'invite' && kind !== 'recovery' && kind !== 'add') throw new HttpError(400, 'Invalid kind');
      const user = kind === 'add' ? requireUser(req) : undefined;
      const result = await guarded(req, () => auth.startRegistration({
        kind,
        name: str(body.name),
        code: str(body.code),
        inviteToken: str(body.inviteToken),
        user,
      }));
      sendJson(res, 200, result);
      return;
    }

    if (path === '/register/verify' && method === 'POST') {
      const body = await readJson(req);
      const current = currentUser(req);
      const user = await guarded(req, () => auth.finishRegistration(
        str(body.flowId) ?? '',
        body.response as never,
        str(body.credentialName),
        current
      ));
      if (current && current.id === user.id) {
        sendJson(res, 200, { ok: true, user: publicUser(user) });
      } else {
        sendJson(res, 200, { ok: true, user: publicUser(user) }, { 'Set-Cookie': sessionCookie(auth.createSession(user.id)) });
      }
      return;
    }

    if (path === '/invite/check' && method === 'POST') {
      const body = await readJson(req);
      if (rateLimited(req)) throw new HttpError(429, 'Too many failed attempts - try again later');
      const invite = store.findInvite(str(body.token) ?? '');
      if (!invite) recordFailure(req);
      sendJson(res, 200, invite ? { valid: true, role: invite.role, expiresAt: invite.expiresAt } : { valid: false });
      return;
    }

    if (path === '/login/options' && method === 'POST') {
      if (rateLimited(req)) throw new HttpError(429, 'Too many failed attempts - try again later');
      sendJson(res, 200, await auth.startLogin());
      return;
    }

    if (path === '/login/verify' && method === 'POST') {
      const body = await readJson(req);
      const user = await guarded(req, () => auth.finishLogin(str(body.flowId) ?? '', body.response as never));
      sendJson(res, 200, { ok: true, user: publicUser(user) }, { 'Set-Cookie': sessionCookie(auth.createSession(user.id)) });
      return;
    }

    if (path === '/logout' && method === 'POST') {
      auth.destroySession(parseCookies(req)[SESSION_COOKIE]);
      sendJson(res, 200, { ok: true }, { 'Set-Cookie': `${SESSION_COOKIE}=; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` });
      return;
    }

    // --- any logged-in user ---
    const user = requireUser(req);

    if (path === '/overview' && method === 'GET') {
      sendJson(res, 200, overview(user));
      return;
    }

    const passkeyMatch = path.match(/^\/me\/passkeys\/([A-Za-z0-9_-]+)$/);
    if (passkeyMatch) {
      const body = method === 'PATCH' ? await readJson(req) : {};
      try {
        if (method === 'PATCH') store.renameCredential(user.id, passkeyMatch[1], str(body.name) ?? '');
        else if (method === 'DELETE') store.removeCredential(user.id, passkeyMatch[1]);
        else throw new HttpError(405, 'Method not allowed');
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(400, error instanceof Error ? error.message : String(error));
      }
      sendJson(res, 200, overview(store.getUser(user.id)!));
      return;
    }

    if (path === '/me' && method === 'PATCH') {
      const body = await readJson(req);
      store.renameUser(user.id, str(body.name) ?? '');
      sendJson(res, 200, overview(store.getUser(user.id)!));
      return;
    }

    if (path === '/tokens' && method === 'POST') {
      const body = await readJson(req);
      const created = store.createToken(user.id, str(body.name) ?? '');
      sendJson(res, 200, { token: created.token, info: created.info, tokens: tokensView(user) });
      return;
    }

    const tokenMatch = path.match(/^\/tokens\/([0-9a-f-]+)$/);
    if (tokenMatch && method === 'DELETE') {
      const ok = store.deleteToken(tokenMatch[1], user.role === 'admin' ? undefined : user.id);
      if (!ok) throw new HttpError(404, 'Token not found');
      sendJson(res, 200, { ok: true, tokens: tokensView(user) });
      return;
    }

    // --- admin only ---
    const serviceMatch = path.match(/^\/services\/([a-z]+)(\/test)?$/);
    if (serviceMatch) {
      requireAdmin(req);
      const id = serviceMatch[1];
      if (!isServiceId(id)) throw new HttpError(404, 'Unknown service');
      const effective = store.getEffective()[id];

      if (serviceMatch[2] && method === 'POST') {
        const body = await readJson(req);
        const url = (str(body.url) || effective.url || '').trim();
        const apiKey = (str(body.apiKey) || effective.apiKey || '').trim();
        if (!url || !apiKey) throw new HttpError(400, 'URL and API key are required to test');
        sendJson(res, 200, await testServiceConnection(id, url, apiKey));
        return;
      }

      if (!serviceMatch[2] && method === 'PUT') {
        const body = await readJson(req);
        const update: { url?: string; apiKey?: string } = {};
        if (body.url !== undefined) {
          if (effective.urlSource === 'env') throw new HttpError(409, 'URL is set by an environment variable');
          update.url = str(body.url) ?? '';
        }
        if (body.apiKey !== undefined) {
          if (effective.apiKeySource === 'env') throw new HttpError(409, 'API key is set by an environment variable');
          update.apiKey = str(body.apiKey) ?? '';
        }
        try {
          store.setService(id, update);
        } catch (error) {
          throw new HttpError(400, error instanceof Error ? error.message : String(error));
        }
        opts.onConfigChanged();
        sendJson(res, 200, { ok: true, services: servicesView(true), configuredSummary: opts.getConfiguredSummary() });
        return;
      }
    }

    const userMatch = path.match(/^\/users\/([0-9a-f-]+)$/);
    if (userMatch) {
      const admin = requireAdmin(req);
      const targetId = userMatch[1];
      try {
        if (method === 'PATCH') {
          const body = await readJson(req);
          if (body.role !== undefined) store.setUserRole(targetId, role(body.role));
          if (body.name !== undefined) store.renameUser(targetId, str(body.name) ?? '');
        } else if (method === 'DELETE') {
          if (targetId === admin.id) throw new HttpError(400, 'You cannot delete yourself');
          store.deleteUser(targetId);
          auth.destroyUserSessions(targetId);
        } else {
          throw new HttpError(405, 'Method not allowed');
        }
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(400, error instanceof Error ? error.message : String(error));
      }
      sendJson(res, 200, overview(store.getUser(admin.id)!));
      return;
    }

    if (path === '/invites' && method === 'POST') {
      const admin = requireAdmin(req);
      const body = await readJson(req);
      const { token, invite } = store.createInvite(role(body.role ?? 'user'), admin.id);
      sendJson(res, 200, {
        link: `${publicOrigin}/admin#invite=${token}`,
        invite: { id: invite.id, role: invite.role, expiresAt: invite.expiresAt },
        overview: overview(admin),
      });
      return;
    }

    const inviteMatch = path.match(/^\/invites\/([0-9a-f-]+)$/);
    if (inviteMatch && method === 'DELETE') {
      const admin = requireAdmin(req);
      if (!store.deleteInvite(inviteMatch[1])) throw new HttpError(404, 'Invite not found');
      sendJson(res, 200, overview(admin));
      return;
    }

    throw new HttpError(404, 'Not found');
  }

  // ----- router -----

  async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    try {
      if (tls.mode !== 'off') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000');
      }
      if (path === opts.mcpPath || path === `${opts.mcpPath}/`) {
        await handleMcp(req, res, url);
        return;
      }
      if (path === '/health' || path === '/healthz') {
        sendJson(res, 200, { status: 'ok', ok: true, version: opts.serverVersion, transport: 'http' });
        return;
      }
      if (path === '/ca.crt' && req.method === 'GET') {
        const pem = tls.caPem();
        if (!pem) throw new HttpError(404, 'No built-in CA in use (TLS_MODE is not internal)');
        res.writeHead(200, {
          'Content-Type': 'application/x-x509-ca-cert',
          'Content-Disposition': 'attachment; filename="mcp-arr-ca.crt"',
          'Cache-Control': 'no-store',
        });
        res.end(pem);
        return;
      }
      if (path === '/' && req.method === 'GET') {
        res.writeHead(302, { Location: '/admin' });
        res.end();
        return;
      }
      if ((path === '/admin' || path === '/admin/') && req.method === 'GET') {
        const nonce = randomBytes(16).toString('base64');
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
          'X-Frame-Options': 'DENY',
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'no-referrer',
        });
        res.end(renderAdminPage(nonce));
        return;
      }
      if (path.startsWith('/admin/api/')) {
        await handleAdminApi(req, res, path.slice('/admin/api'.length));
        return;
      }
      sendJson(res, 404, { error: 'Not found' });
    } catch (error) {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (error instanceof HttpError || error instanceof AuthError) {
        sendJson(res, error.status, { error: error.message });
      } else {
        console.error('HTTP request error:', error);
        sendJson(res, 500, { error: 'Internal server error' });
      }
    }
  }

  const material = tls.current();
  const server = material
    ? createHttpsServer({ cert: material.cert, key: material.key, minVersion: 'TLSv1.2' }, handler)
    : createHttpServer(handler);
  if (material) {
    tls.onChange(m => (server as ReturnType<typeof createHttpsServer>).setSecureContext({ cert: m.cert, key: m.key, minVersion: 'TLSv1.2' }));
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, opts.host, () => resolve());
  });

  const summary = opts.getConfiguredSummary();
  const info = tls.info();
  console.error(`*arr MCP server running (${material ? 'https' : 'http'}) on ${opts.host}:${opts.port}`);
  console.error(`  Public URL:  ${publicOrigin}   MCP endpoint: ${publicOrigin}${opts.mcpPath}   Web UI: ${publicOrigin}/admin`);
  console.error(`  Config:      ${store.path} (encrypted, key from ${store.keySource})`);
  for (const w of store.warnings) console.error(`  WARNING: ${w}`);
  if (info.mode === 'internal' && info.ca) {
    console.error(`  TLS:         built-in CA - download ${publicOrigin}/ca.crt and install it on your devices`);
    console.error(`  CA SHA-256:  ${info.ca.fingerprint256}`);
  } else if (info.mode === 'file') {
    console.error(`  TLS:         certificate from ${info.certFile}`);
  } else {
    console.error('  TLS:         off - make sure a reverse proxy terminates HTTPS');
  }
  console.error(`  Services:    ${summary.length ? summary.join(', ') : '(none yet - add them in the web UI)'}`);
  const code = auth.pendingSetupCode ?? auth.pendingRecoveryCode;
  if (code) {
    const what = auth.pendingSetupCode ? 'First-run setup' : 'Admin recovery';
    console.error('');
    console.error('  ================================================');
    console.error(`  ${what} code: ${code}`);
    console.error(`  Open ${publicOrigin}/admin and enter this code to register a passkey.`);
    console.error('  ================================================');
    console.error('');
  }

  const shutdown = () => {
    tls.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
