/**
 * OAuth 2.1 authorization server for remote MCP clients (Claude, ChatGPT/OpenAI).
 *
 * Lets "custom connectors" sign in with the user's existing mcp-arr login (passkey or
 * password) instead of a pasted access token:
 *   - discovery:   /.well-known/oauth-protected-resource, /.well-known/oauth-authorization-server
 *   - registration: POST /oauth/register       (RFC 7591 dynamic client registration)
 *   - authorize:   GET  /oauth/authorize       (-> consent screen inside the web UI)
 *   - token:       POST /oauth/token           (authorization_code + PKCE S256, refresh_token)
 *   - revoke:      POST /oauth/revoke          (RFC 7009)
 *
 * It is only switched on when it can work: the connectors run in the vendors' clouds, so the
 * server must be reachable over HTTPS with a publicly trusted certificate (see resolveOAuthMode).
 * Issued access tokens are ordinary mcp-arr tokens (listed and revocable in the web UI) that
 * additionally expire; the /mcp endpoint needs no changes to accept them.
 */

import { createHash, randomBytes } from 'node:crypto';
import type { ConfigStore, StoredOAuthClient } from './config-store.js';
import { safeEqual, sha256 } from './config-store.js';

export const OAUTH_SCOPE = 'mcp';

/** Redirect hosts of the known connector platforms. Others need OAUTH_ALLOWED_REDIRECT_HOSTS. */
export const DEFAULT_REDIRECT_HOSTS = [
  'claude.ai',
  'claude.com',
  'chatgpt.com',
  'chat.openai.com',
  'platform.openai.com',
  'openai.com',
];

const ACCESS_TTL_S = 60 * 60; // 1 hour
const REFRESH_TTL_S = 60 * 24 * 60 * 60; // 60 days
const CODE_TTL_MS = 5 * 60 * 1000;
const REQUEST_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING = 500;

export class OAuthError extends Error {
  constructor(public status: number, public code: string, description: string) {
    super(description);
  }
}

export interface OAuthDecision {
  enabled: boolean;
  /** Why it is on/off - printed at startup and shown in the web UI. */
  reason: string;
}

/**
 * Decide whether OAuth should be offered.
 *  - OAUTH=off  -> never
 *  - OAUTH=on   -> always (admin takes responsibility for the certificate)
 *  - auto       -> only with an https PUBLIC_URL and a certificate the vendors' servers can verify:
 *                  TLS_MODE=file with a non-self-signed certificate covering the host, or
 *                  TLS_MODE=off (a reverse proxy terminates HTTPS). The built-in CA is never
 *                  trusted by Claude/OpenAI, so TLS_MODE=internal keeps OAuth off.
 */
export function resolveOAuthMode(input: {
  setting: string | undefined;
  publicUrl: URL;
  tlsMode: 'internal' | 'file' | 'off';
  /** Result of inspecting the configured certificate (file mode only). */
  certProblem?: string;
}): OAuthDecision {
  const setting = (input.setting || 'auto').toLowerCase();
  if (setting !== 'auto' && setting !== 'on' && setting !== 'off') {
    throw new Error(`Unknown OAUTH '${input.setting}' (use 'auto', 'on' or 'off')`);
  }
  if (setting === 'off') return { enabled: false, reason: 'disabled with OAUTH=off' };
  if (input.publicUrl.protocol !== 'https:') {
    return setting === 'on'
      ? { enabled: false, reason: 'OAUTH=on ignored: PUBLIC_URL must be https:// (Claude and OpenAI only connect over HTTPS)' }
      : { enabled: false, reason: 'PUBLIC_URL is not https://' };
  }
  if (setting === 'on') return { enabled: true, reason: 'enabled with OAUTH=on' };
  if (input.tlsMode === 'internal') {
    return { enabled: false, reason: 'TLS_MODE=internal uses a private CA that Claude/OpenAI do not trust - use TLS_MODE=file with a public certificate, or a reverse proxy (TLS_MODE=off)' };
  }
  if (input.tlsMode === 'file' && input.certProblem) {
    return { enabled: false, reason: `certificate does not look publicly trusted: ${input.certProblem} (set OAUTH=on to override)` };
  }
  return {
    enabled: true,
    reason: input.tlsMode === 'file' ? 'own certificate configured' : 'HTTPS terminated by a reverse proxy',
  };
}

interface PendingRequest {
  client: StoredOAuthClient;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
  scope: string;
  resource?: string;
  expires: number;
}

interface AuthCode {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  resource?: string;
  expires: number;
}

export interface OAuthOptions {
  store: ConfigStore;
  /** e.g. https://mcp.example.com (no trailing slash) */
  issuer: string;
  mcpPath: string;
  allowedRedirectHosts: string[];
}

function s256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

function isLoopback(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}

export class OAuthProvider {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly codes = new Map<string, AuthCode>();

  constructor(private readonly opts: OAuthOptions) {}

  get resourceUrl(): string {
    return `${this.opts.issuer}${this.opts.mcpPath}`;
  }

  /** URL given in WWW-Authenticate so clients can discover the authorization server. */
  get resourceMetadataUrl(): string {
    return `${this.opts.issuer}/.well-known/oauth-protected-resource${this.opts.mcpPath}`;
  }

  protectedResourceMetadata() {
    return {
      resource: this.resourceUrl,
      authorization_servers: [this.opts.issuer],
      bearer_methods_supported: ['header'],
      scopes_supported: [OAUTH_SCOPE],
      resource_name: '*arr MCP server',
    };
  }

  authorizationServerMetadata() {
    const i = this.opts.issuer;
    return {
      issuer: i,
      authorization_endpoint: `${i}/oauth/authorize`,
      token_endpoint: `${i}/oauth/token`,
      registration_endpoint: `${i}/oauth/register`,
      revocation_endpoint: `${i}/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
      revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
      scopes_supported: [OAUTH_SCOPE],
    };
  }

  // ---------- redirect URI policy ----------

  private redirectAllowed(uri: string): boolean {
    let u: URL;
    try {
      u = new URL(uri);
    } catch {
      return false;
    }
    if (u.hash) return false;
    if (u.protocol === 'http:') return isLoopback(u.hostname); // native/desktop clients (RFC 8252)
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    return this.opts.allowedRedirectHosts.some(a => host === a || host.endsWith(`.${a}`));
  }

  // ---------- dynamic client registration ----------

  register(body: Record<string, unknown>): Record<string, unknown> {
    const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === 'string') : [];
    if (uris.length === 0 || uris.length > 10) {
      throw new OAuthError(400, 'invalid_redirect_uri', 'redirect_uris must contain 1-10 URIs');
    }
    for (const uri of uris) {
      if (!this.redirectAllowed(uri)) {
        throw new OAuthError(
          400,
          'invalid_redirect_uri',
          `redirect URI not allowed: ${uri.slice(0, 200)} (server admins can allow more hosts with OAUTH_ALLOWED_REDIRECT_HOSTS)`
        );
      }
    }
    const method = typeof body.token_endpoint_auth_method === 'string' ? body.token_endpoint_auth_method : 'none';
    if (method !== 'none' && method !== 'client_secret_post' && method !== 'client_secret_basic') {
      throw new OAuthError(400, 'invalid_client_metadata', `unsupported token_endpoint_auth_method '${method}'`);
    }
    const name = (typeof body.client_name === 'string' ? body.client_name : '')
      .replace(/[\u0000-\u001f]/g, '').trim().slice(0, 64) || 'MCP client';
    const secret = method === 'none' ? undefined : randomBytes(32).toString('base64url');
    const client = this.opts.store.registerOAuthClient({
      name,
      redirectUris: uris,
      ...(secret ? { secretHash: sha256(secret) } : {}),
    });
    return {
      client_id: client.id,
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
      client_id_issued_at: Math.floor(Date.parse(client.createdAt) / 1000),
      client_name: client.name,
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: method,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: OAUTH_SCOPE,
    };
  }

  // ---------- authorization ----------

  /**
   * Validate an /oauth/authorize request and park it until the user approves in the web UI.
   * Errors here must be shown to the user (never redirected) because client/redirect are untrusted.
   */
  beginAuthorization(params: URLSearchParams): string {
    const client = this.opts.store.getOAuthClient(params.get('client_id') ?? '');
    if (!client) throw new OAuthError(400, 'invalid_client', 'Unknown client_id - the connector must register first');
    const redirectUri = params.get('redirect_uri') ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : '');
    if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
      throw new OAuthError(400, 'invalid_request', 'redirect_uri does not match the registered one');
    }
    if (params.get('response_type') !== 'code') {
      throw new OAuthError(400, 'unsupported_response_type', 'Only response_type=code is supported');
    }
    const challenge = params.get('code_challenge') ?? '';
    if (params.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) {
      throw new OAuthError(400, 'invalid_request', 'PKCE with code_challenge_method=S256 is required');
    }
    const resource = params.get('resource') ?? undefined;
    if (resource && resource.replace(/\/+$/, '') !== this.resourceUrl) {
      throw new OAuthError(400, 'invalid_target', 'Unknown resource');
    }
    this.sweep();
    if (this.pending.size >= MAX_PENDING) throw new OAuthError(503, 'temporarily_unavailable', 'Too many pending requests');
    const id = randomBytes(24).toString('base64url');
    this.pending.set(id, {
      client,
      redirectUri,
      codeChallenge: challenge,
      state: params.get('state') ?? undefined,
      scope: OAUTH_SCOPE,
      resource,
      expires: Date.now() + REQUEST_TTL_MS,
    });
    return id;
  }

  /** What the consent screen shows. */
  describeRequest(id: string): { clientName: string; redirectHost: string; scope: string } | undefined {
    const p = this.getPending(id);
    if (!p) return undefined;
    return { clientName: p.client.name, redirectHost: new URL(p.redirectUri).host, scope: p.scope };
  }

  /** The user approved (userId) or denied (undefined). Returns the URL to send the browser to. */
  complete(id: string, userId: string | undefined): string {
    const p = this.getPending(id);
    if (!p) throw new OAuthError(404, 'invalid_request', 'This sign-in request has expired - start again from the connector');
    this.pending.delete(id);
    const target = new URL(p.redirectUri);
    if (p.state) target.searchParams.set('state', p.state);
    target.searchParams.set('iss', this.opts.issuer);
    if (!userId) {
      target.searchParams.set('error', 'access_denied');
      return target.toString();
    }
    const code = randomBytes(32).toString('base64url');
    this.codes.set(sha256(code), {
      clientId: p.client.id,
      userId,
      redirectUri: p.redirectUri,
      codeChallenge: p.codeChallenge,
      resource: p.resource,
      expires: Date.now() + CODE_TTL_MS,
    });
    target.searchParams.set('code', code);
    return target.toString();
  }

  // ---------- token endpoint ----------

  /** Authenticate the client from the request (Basic header or body). */
  private authenticateClient(basic: string | undefined, form: URLSearchParams): StoredOAuthClient {
    let clientId = form.get('client_id') ?? '';
    let secret = form.get('client_secret') ?? undefined;
    if (basic?.startsWith('Basic ')) {
      const decoded = Buffer.from(basic.slice(6), 'base64').toString('utf8');
      const idx = decoded.indexOf(':');
      if (idx > 0) {
        try {
          clientId = decodeURIComponent(decoded.slice(0, idx));
          secret = decodeURIComponent(decoded.slice(idx + 1));
        } catch {
          throw new OAuthError(401, 'invalid_client', 'Malformed client credentials');
        }
      }
    }
    const client = this.opts.store.getOAuthClient(clientId);
    if (!client) throw new OAuthError(401, 'invalid_client', 'Unknown client');
    if (client.secretHash && !(secret && safeEqual(sha256(secret), client.secretHash))) {
      throw new OAuthError(401, 'invalid_client', 'Wrong client secret');
    }
    return client;
  }

  token(basic: string | undefined, form: URLSearchParams): Record<string, unknown> {
    const client = this.authenticateClient(basic, form);
    const grant = form.get('grant_type');

    if (grant === 'authorization_code') {
      const code = form.get('code') ?? '';
      const entry = this.codes.get(sha256(code));
      this.codes.delete(sha256(code)); // single use, even on failure
      if (!entry || entry.expires < Date.now() || entry.clientId !== client.id) {
        throw new OAuthError(400, 'invalid_grant', 'Authorization code is invalid or expired');
      }
      const redirectUri = form.get('redirect_uri');
      if (redirectUri !== null && redirectUri !== entry.redirectUri) {
        throw new OAuthError(400, 'invalid_grant', 'redirect_uri does not match');
      }
      const verifier = form.get('code_verifier') ?? '';
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !safeEqual(s256(verifier), entry.codeChallenge)) {
        throw new OAuthError(400, 'invalid_grant', 'PKCE verification failed');
      }
      return this.issue(entry.userId, client);
    }

    if (grant === 'refresh_token') {
      const refreshed = this.opts.store.takeRefreshToken(form.get('refresh_token') ?? '');
      if (!refreshed || refreshed.clientId !== client.id) {
        throw new OAuthError(400, 'invalid_grant', 'Refresh token is invalid or expired');
      }
      return this.issue(refreshed.userId, client, refreshed.tokenId);
    }

    throw new OAuthError(400, 'unsupported_grant_type', 'Use authorization_code or refresh_token');
  }

  private issue(userId: string, client: StoredOAuthClient, replaceTokenId?: string): Record<string, unknown> {
    const t = this.opts.store.issueOAuthTokens(userId, client, ACCESS_TTL_S, REFRESH_TTL_S, replaceTokenId);
    return {
      access_token: t.accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TTL_S,
      refresh_token: t.refreshToken,
      scope: OAUTH_SCOPE,
    };
  }

  revoke(basic: string | undefined, form: URLSearchParams): void {
    const client = this.authenticateClient(basic, form);
    const token = form.get('token');
    if (token) this.opts.store.revokeOAuthToken(token, client.id);
  }

  // ---------- housekeeping ----------

  private getPending(id: string): PendingRequest | undefined {
    const p = this.pending.get(id);
    if (!p) return undefined;
    if (p.expires < Date.now()) {
      this.pending.delete(id);
      return undefined;
    }
    return p;
  }

  sweep(): void {
    const now = Date.now();
    for (const [k, v] of this.pending) if (v.expires < now) this.pending.delete(k);
    for (const [k, v] of this.codes) if (v.expires < now) this.codes.delete(k);
  }
}
