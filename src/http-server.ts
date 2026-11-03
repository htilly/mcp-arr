/**
 * HTTP mode: Streamable HTTP MCP endpoint (/mcp) + web admin UI (/admin).
 *
 * Auth:
 * - /mcp requires a bearer token (Authorization: Bearer <token> or ?token=<token>).
 *   Valid tokens: MCP_AUTH_TOKEN env var and/or tokens created in the web UI.
 *   Set MCP_AUTH_DISABLED=true to turn auth off (only on a trusted network!).
 * - /admin requires the admin password: ADMIN_PASSWORD env var, or a password created on
 *   first run (protected by a one-time setup code printed to the server log).
 */

import { createServer as createHttpServer, IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import {
  ConfigStore,
  SERVICE_DEFS,
  ServiceId,
  isServiceId,
  safeEqual,
  verifyPassword,
} from './config-store.js';
import { SonarrClient, RadarrClient, LidarrClient, ReadarrClient, ProwlarrClient } from './arr-client.js';
import { TautulliClient } from './tautulli-client.js';
import { OverseerrClient } from './overseerr-client.js';
import { BazarrClient } from './bazarr-client.js';
import { renderAdminPage } from './admin-ui.js';

export interface HttpServerOptions {
  store: ConfigStore;
  createServer: () => Server;
  onConfigChanged: () => void;
  getConfiguredSummary: () => string[];
}

interface McpSession {
  transport: StreamableHTTPServerTransport;
  server: Server;
  lastSeen: number;
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const MAX_BODY_BYTES = 1024 * 1024;
const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MCP_SESSION_IDLE_MS = 2 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;
const TEST_TIMEOUT_MS = 10_000;
const MIN_PASSWORD_LENGTH = 8;

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

async function readJson(req: IncomingMessage): Promise<unknown> {
  const text = await readBody(req);
  if (!text) return {};
  try {
    return JSON.parse(text);
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
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function clientIp(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? 'unknown';
}

function isSecureRequest(req: IncomingMessage): boolean {
  return (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0].trim() === 'https'
    || Boolean((req.socket as { encrypted?: boolean }).encrypted);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
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
        case 'readarr': return (await new ReadarrClient(cfg).getStatus()).version;
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

// ---------- server ----------

export async function startHttpServer(opts: HttpServerOptions): Promise<void> {
  const { store } = opts;
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  const authDisabled = process.env.MCP_AUTH_DISABLED === 'true';
  const envToken = process.env.MCP_AUTH_TOKEN || undefined;
  const envAdminPassword = process.env.ADMIN_PASSWORD || undefined;

  if (!store.writable) throw new Error('HTTP mode requires a writable config file (CONFIG_PATH)');

  let setupCode: string | undefined;
  if (!envAdminPassword && !store.getAdminPasswordHash()) {
    setupCode = randomBytes(4).toString('hex').toUpperCase().replace(/(.{4})/, '$1-');
  }

  const mcpSessions = new Map<string, McpSession>();
  const adminSessions = new Map<string, number>(); // session id -> expiry timestamp
  const loginFailures = new Map<string, { count: number; first: number }>();

  function configChanged(): void {
    opts.onConfigChanged();
    for (const s of mcpSessions.values()) {
      s.server.sendToolListChanged().catch(() => { /* client may not support it */ });
    }
  }

  // Periodic cleanup of idle MCP sessions and expired admin sessions
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [id, s] of mcpSessions) {
      if (now - s.lastSeen > MCP_SESSION_IDLE_MS) {
        mcpSessions.delete(id);
        s.transport.close().catch(() => {});
      }
    }
    for (const [id, exp] of adminSessions) if (exp < now) adminSessions.delete(id);
    for (const [ip, f] of loginFailures) if (now - f.first > LOGIN_WINDOW_MS) loginFailures.delete(ip);
  }, 5 * 60 * 1000);
  cleanup.unref();

  // ----- MCP endpoint -----

  function mcpAuthorized(req: IncomingMessage, url: URL): boolean {
    if (authDisabled) return true;
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : url.searchParams.get('token') ?? undefined;
    if (!token) return false;
    if (envToken && safeEqual(token, envToken)) return true;
    return store.verifyToken(token);
  }

  async function handleMcp(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    if (!mcpAuthorized(req, url)) {
      const noTokens = !envToken && !store.hasTokens();
      sendJson(res, 401, {
        jsonrpc: '2.0',
        error: {
          code: -32001,
          message: noTokens
            ? 'Unauthorized: no MCP access token exists yet. Create one in the web UI (/admin).'
            : 'Unauthorized: missing or invalid access token',
        },
        id: null,
      }, { 'WWW-Authenticate': 'Bearer' });
      return;
    }

    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    const existing = sessionId ? mcpSessions.get(sessionId) : undefined;

    if (req.method === 'POST') {
      const body = await readJson(req);
      if (existing) {
        existing.lastSeen = Date.now();
        await existing.transport.handleRequest(req, res, body);
        return;
      }
      if (sessionId) {
        sendJson(res, 404, { jsonrpc: '2.0', error: { code: -32001, message: 'Session not found' }, id: null });
        return;
      }
      if (!isInitializeRequest(body)) {
        sendJson(res, 400, { jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request: no valid session ID provided' }, id: null });
        return;
      }
      const server = opts.createServer();
      const session: McpSession = {
        server,
        lastSeen: Date.now(),
        transport: new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: id => { mcpSessions.set(id, session); },
        }),
      };
      session.transport.onclose = () => {
        if (session.transport.sessionId) mcpSessions.delete(session.transport.sessionId);
      };
      await server.connect(session.transport);
      await session.transport.handleRequest(req, res, body);
      return;
    }

    if (req.method === 'GET' || req.method === 'DELETE') {
      if (!existing) {
        sendJson(res, sessionId ? 404 : 400, { jsonrpc: '2.0', error: { code: -32000, message: sessionId ? 'Session not found' : 'Missing mcp-session-id header' }, id: null });
        return;
      }
      existing.lastSeen = Date.now();
      await existing.transport.handleRequest(req, res);
      return;
    }

    sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'GET, POST, DELETE' });
  }

  // ----- admin auth -----

  function isAdmin(req: IncomingMessage): boolean {
    const sid = parseCookies(req).marr_admin;
    if (!sid) return false;
    const exp = adminSessions.get(sid);
    if (!exp || exp < Date.now()) {
      adminSessions.delete(sid);
      return false;
    }
    return true;
  }

  function startAdminSession(req: IncomingMessage, res: ServerResponse): string {
    const sid = randomBytes(32).toString('base64url');
    adminSessions.set(sid, Date.now() + ADMIN_SESSION_TTL_MS);
    const secure = isSecureRequest(req) ? '; Secure' : '';
    return `marr_admin=${sid}; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=${ADMIN_SESSION_TTL_MS / 1000}${secure}`;
  }

  function checkPassword(password: string): boolean {
    if (envAdminPassword) return safeEqual(password, envAdminPassword);
    const hash = store.getAdminPasswordHash();
    return hash ? verifyPassword(password, hash) : false;
  }

  function rateLimited(req: IncomingMessage): boolean {
    const f = loginFailures.get(clientIp(req));
    return Boolean(f && f.count >= LOGIN_MAX_FAILURES && Date.now() - f.first < LOGIN_WINDOW_MS);
  }

  function recordFailure(req: IncomingMessage): void {
    const ip = clientIp(req);
    const f = loginFailures.get(ip);
    if (!f || Date.now() - f.first > LOGIN_WINDOW_MS) loginFailures.set(ip, { count: 1, first: Date.now() });
    else f.count++;
  }

  /** Basic CSRF protection for state-changing admin requests (in addition to SameSite=Strict cookies). */
  function checkMutationOrigin(req: IncomingMessage): void {
    const contentType = req.headers['content-type'] ?? '';
    if (!contentType.includes('application/json')) throw new HttpError(415, 'Content-Type must be application/json');
    const origin = req.headers.origin;
    if (origin) {
      let originHost: string;
      try {
        originHost = new URL(origin).host;
      } catch {
        throw new HttpError(403, 'Invalid Origin');
      }
      const allowed = [req.headers.host, req.headers['x-forwarded-host']].filter(Boolean).map(h => String(h).split(',')[0].trim());
      if (!allowed.includes(originHost)) throw new HttpError(403, 'Cross-origin request blocked');
    }
  }

  function servicesView() {
    const effective = store.getEffective();
    return SERVICE_DEFS.map(def => {
      const e = effective[def.id];
      return {
        id: def.id,
        displayName: def.displayName,
        exampleUrl: def.exampleUrl,
        envPrefix: def.envPrefix,
        url: e.url ?? '',
        urlSource: e.urlSource,
        hasApiKey: Boolean(e.apiKey),
        apiKeyHint: e.apiKey && e.apiKey.length >= 12 ? e.apiKey.slice(-4) : '',
        apiKeySource: e.apiKeySource,
        configured: Boolean(e.url && e.apiKey),
      };
    });
  }

  // ----- admin API -----

  async function handleAdminApi(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    const method = req.method ?? 'GET';
    if (method !== 'GET') checkMutationOrigin(req);

    // Public endpoints
    if (path === '/state' && method === 'GET') {
      sendJson(res, 200, {
        setupRequired: Boolean(setupCode),
        authenticated: isAdmin(req),
      });
      return;
    }

    if (path === '/setup' && method === 'POST') {
      if (!setupCode) throw new HttpError(409, 'Setup already completed');
      if (rateLimited(req)) throw new HttpError(429, 'Too many attempts, try again later');
      const body = (await readJson(req)) as Record<string, unknown>;
      const code = (str(body.code) ?? '').trim().toUpperCase();
      const password = str(body.password) ?? '';
      if (!safeEqual(code, setupCode)) {
        recordFailure(req);
        throw new HttpError(403, 'Invalid setup code (see the server log)');
      }
      if (password.length < MIN_PASSWORD_LENGTH) throw new HttpError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      store.setAdminPassword(password);
      setupCode = undefined;
      sendJson(res, 200, { ok: true }, { 'Set-Cookie': startAdminSession(req, res) });
      return;
    }

    if (path === '/login' && method === 'POST') {
      if (setupCode) throw new HttpError(409, 'Setup required');
      if (rateLimited(req)) throw new HttpError(429, 'Too many failed attempts, try again later');
      const body = (await readJson(req)) as Record<string, unknown>;
      if (!checkPassword(str(body.password) ?? '')) {
        recordFailure(req);
        throw new HttpError(401, 'Wrong password');
      }
      loginFailures.delete(clientIp(req));
      sendJson(res, 200, { ok: true }, { 'Set-Cookie': startAdminSession(req, res) });
      return;
    }

    if (path === '/logout' && method === 'POST') {
      const sid = parseCookies(req).marr_admin;
      if (sid) adminSessions.delete(sid);
      sendJson(res, 200, { ok: true }, { 'Set-Cookie': 'marr_admin=; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=0' });
      return;
    }

    // Everything below requires an admin session
    if (!isAdmin(req)) throw new HttpError(401, 'Not logged in');

    if (path === '/overview' && method === 'GET') {
      sendJson(res, 200, {
        services: servicesView(),
        configuredSummary: opts.getConfiguredSummary(),
        security: {
          passwordFromEnv: Boolean(envAdminPassword),
          encryption: store.encryptionEnabled,
          configPath: store.path,
          mcpAuthDisabled: authDisabled,
          envTokenSet: Boolean(envToken),
        },
        tokens: store.listTokens(),
        activeMcpSessions: mcpSessions.size,
      });
      return;
    }

    const serviceMatch = path.match(/^\/services\/([a-z]+)(\/test)?$/);
    if (serviceMatch) {
      const id = serviceMatch[1];
      if (!isServiceId(id)) throw new HttpError(404, 'Unknown service');
      const effective = store.getEffective()[id];

      if (serviceMatch[2] && method === 'POST') {
        const body = (await readJson(req)) as Record<string, unknown>;
        const url = (str(body.url) || effective.url || '').trim();
        const apiKey = (str(body.apiKey) || effective.apiKey || '').trim();
        if (!url || !apiKey) throw new HttpError(400, 'URL and API key are required to test');
        sendJson(res, 200, await testServiceConnection(id, url, apiKey));
        return;
      }

      if (!serviceMatch[2] && method === 'PUT') {
        const body = (await readJson(req)) as Record<string, unknown>;
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
        configChanged();
        sendJson(res, 200, { ok: true, services: servicesView(), configuredSummary: opts.getConfiguredSummary() });
        return;
      }
    }

    if (path === '/tokens' && method === 'POST') {
      const body = (await readJson(req)) as Record<string, unknown>;
      const created = store.createToken(str(body.name) ?? '');
      sendJson(res, 200, { token: created.token, info: created.info, tokens: store.listTokens() });
      return;
    }

    const tokenMatch = path.match(/^\/tokens\/([0-9a-f-]+)$/);
    if (tokenMatch && method === 'DELETE') {
      if (!store.deleteToken(tokenMatch[1])) throw new HttpError(404, 'Token not found');
      sendJson(res, 200, { ok: true, tokens: store.listTokens() });
      return;
    }

    if (path === '/password' && method === 'POST') {
      if (envAdminPassword) throw new HttpError(409, 'Admin password is set by the ADMIN_PASSWORD environment variable');
      const body = (await readJson(req)) as Record<string, unknown>;
      if (!checkPassword(str(body.current) ?? '')) throw new HttpError(403, 'Current password is wrong');
      const next = str(body.password) ?? '';
      if (next.length < MIN_PASSWORD_LENGTH) throw new HttpError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      store.setAdminPassword(next);
      // Invalidate all other sessions
      adminSessions.clear();
      sendJson(res, 200, { ok: true }, { 'Set-Cookie': startAdminSession(req, res) });
      return;
    }

    throw new HttpError(404, 'Not found');
  }

  // ----- router -----

  const httpServer = createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    try {
      if (path === '/mcp' || path === '/mcp/') {
        await handleMcp(req, res, url);
        return;
      }
      if (path === '/healthz') {
        sendJson(res, 200, { ok: true });
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
      if (error instanceof HttpError) {
        sendJson(res, error.status, { error: error.message });
      } else {
        console.error('HTTP request error:', error);
        sendJson(res, 500, { error: 'Internal server error' });
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => resolve());
  });

  const summary = opts.getConfiguredSummary();
  console.error(`*arr MCP server running (http) on http://${host}:${port}`);
  console.error(`  MCP endpoint: /mcp   Web UI: /admin   Config: ${store.path}${store.encryptionEnabled ? ' (API keys encrypted)' : ''}`);
  console.error(`  Configured services: ${summary.length ? summary.join(', ') : '(none yet - add them in the web UI)'}`);
  if (authDisabled) console.error('  WARNING: MCP_AUTH_DISABLED=true - the MCP endpoint accepts unauthenticated requests');
  if (setupCode) {
    console.error('');
    console.error('  ================================================');
    console.error(`  First-run setup code: ${setupCode}`);
    console.error('  Open /admin and enter this code to set the admin password.');
    console.error('  ================================================');
    console.error('');
  }

  const shutdown = () => {
    for (const s of mcpSessions.values()) s.transport.close().catch(() => {});
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
