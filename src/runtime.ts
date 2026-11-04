/**
 * The parts of HTTP mode that follow the server settings (settings.ts) and can be switched at
 * runtime from the web UI: certificate manager, OAuth provider and proxy trust. Also the
 * "Test" action, which checks a set of settings without applying them.
 */

import { X509Certificate } from 'node:crypto';
import type { ConfigStore } from './config-store.js';
import {
  AcmeClient,
  AcmeState,
  LETSENCRYPT_PRODUCTION,
  LETSENCRYPT_STAGING,
  acmeSettingsFromEnv,
  acquireChallengeServer,
  createDnsSolver,
  errMsg,
  generateKeyPem,
} from './acme.js';
import { DEFAULT_REDIRECT_HOSTS, OAuthProvider, resolveOAuthMode } from './oauth.js';
import { TlsManager, TlsMode, internalCaWouldChange } from './tls.js';

export interface RuntimeContext {
  store: ConfigStore;
  publicUrl: URL;
  /** PUBLIC_URL host name. */
  hostname: string;
  /** HOST - listen address (also used for the http-01 listener). */
  listenHost: string;
  mcpPath: string;
  /**
   * Setup mode: PUBLIC_URL is not set yet. A temporary certificate for `setupNames` is served,
   * passkeys and OAuth are off, and the admin sets PUBLIC_URL in the web UI.
   */
  setup?: boolean;
  /** Host names / IPs for the temporary certificate (setup mode and fallback). */
  setupNames: string[];
}

export interface Runtime {
  tls: TlsManager;
  tlsMode: TlsMode;
  oauth?: OAuthProvider;
  oauthReason: string;
  oauthHosts: string[];
  trustProxy: boolean;
}

const splitList = (v?: string) => (v ?? '').split(',').map(x => x.trim()).filter(Boolean);

export function parseTlsMode(env: NodeJS.ProcessEnv): TlsMode {
  const mode = (env.TLS_MODE || 'internal').toLowerCase();
  if (mode !== 'internal' && mode !== 'file' && mode !== 'acme' && mode !== 'off') {
    throw new Error(`Unknown TLS_MODE '${mode}' (use 'internal', 'file', 'acme' or 'off')`);
  }
  return mode;
}

function tlsManagerFor(ctx: RuntimeContext, env: NodeJS.ProcessEnv, previous?: Runtime): TlsManager {
  const mode = parseTlsMode(env);
  if (ctx.setup && mode !== 'off') return temporaryTls(ctx);
  const names = [ctx.hostname, ...splitList(env.TLS_SANS)];
  const acme = mode === 'acme' ? acmeSettingsFromEnv(env, names, ctx.publicUrl.origin, ctx.listenHost) : undefined;
  if (mode === 'file' && (!env.TLS_CERT_FILE || !env.TLS_KEY_FILE)) throw new Error('Own certificate files: set both the certificate and the key file');
  return new TlsManager({
    mode,
    store: ctx.store,
    names,
    acme,
    caPermitted: splitList(env.TLS_CA_NAME_CONSTRAINTS),
    certFile: env.TLS_CERT_FILE,
    keyFile: env.TLS_KEY_FILE,
    leafDays: env.TLS_LEAF_DAYS ? Number(env.TLS_LEAF_DAYS) : undefined,
    initialMaterial: previous?.tls.current(),
  });
}

/**
 * Build (and start) everything that depends on the settings. Throws on invalid settings; on
 * failure nothing that was started is left running.
 */
function temporaryTls(ctx: RuntimeContext, error?: string): TlsManager {
  return new TlsManager({ mode: 'internal', store: ctx.store, names: [...new Set([...(ctx.setup ? [] : [ctx.hostname]), ...ctx.setupNames])], temporary: true, error });
}

/** Check settings without starting anything (used before a restart for a new PUBLIC_URL). */
export function validateSettings(ctx: RuntimeContext, env: NodeJS.ProcessEnv): void {
  const oauthSetting = (env.OAUTH || 'auto').toLowerCase();
  if (!['auto', 'on', 'off'].includes(oauthSetting)) throw new Error(`Unknown OAUTH '${env.OAUTH}' (use 'auto', 'on' or 'off')`);
  tlsManagerFor(ctx, env);
}

/**
 * Like buildRuntime, but never fails: when the settings cannot be used (bad certificate files,
 * invalid ACME settings ...) the server still starts with a temporary certificate and shows the
 * error, so it can be fixed in the web UI.
 */
export async function buildRuntimeOrFallback(ctx: RuntimeContext, env: NodeJS.ProcessEnv): Promise<Runtime> {
  try {
    return await buildRuntime(ctx, env);
  } catch (err) {
    const message = `The certificate settings could not be used: ${errMsg(err)}. Serving a temporary self-signed certificate - fix the settings in the web UI (Settings).`;
    console.error(`WARNING: ${message}`);
    const tls = temporaryTls(ctx, message);
    await tls.init();
    return { tls, tlsMode: tls.mode, oauthReason: 'off while the certificate settings have an error', oauthHosts: [], trustProxy: env.TRUST_PROXY === 'true' };
  }
}

export async function buildRuntime(ctx: RuntimeContext, env: NodeJS.ProcessEnv, previous?: Runtime): Promise<Runtime> {
  const oauthSetting = (env.OAUTH || 'auto').toLowerCase();
  if (!['auto', 'on', 'off'].includes(oauthSetting)) throw new Error(`Unknown OAUTH '${env.OAUTH}' (use 'auto', 'on' or 'off')`);

  const tls = tlsManagerFor(ctx, env, previous);
  try {
    await tls.init();
  } catch (err) {
    tls.stop();
    throw err;
  }

  const decision = ctx.setup ? { enabled: false, reason: 'PUBLIC_URL is not set yet (setup mode)' } : resolveOAuthMode({
    setting: env.OAUTH,
    publicUrl: ctx.publicUrl,
    tlsMode: tls.mode,
    certProblem: tls.publicTrustProblem(ctx.hostname),
  });
  const oauthHosts = [...DEFAULT_REDIRECT_HOSTS, ...splitList(env.OAUTH_ALLOWED_REDIRECT_HOSTS).map(h => h.toLowerCase())];
  let oauth: OAuthProvider | undefined;
  if (decision.enabled) {
    // Keep the provider (and sign-ins in progress) when nothing about it changed
    oauth = previous?.oauth && sameList(previous.oauthHosts, oauthHosts)
      ? previous.oauth
      : new OAuthProvider({ store: ctx.store, issuer: ctx.publicUrl.origin, mcpPath: ctx.mcpPath, allowedRedirectHosts: oauthHosts });
  }
  return { tls, tlsMode: tls.mode, oauth, oauthReason: decision.reason, oauthHosts, trustProxy: env.TRUST_PROXY === 'true' };
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

export interface TestResult {
  ok: boolean;
  message: string;
}

/**
 * Check a set of settings without applying them. For ACME this requests a real certificate -
 * from Let's Encrypt *staging* when Let's Encrypt production is configured (no rate limit
 * worries, nothing trusted is issued) - and throws it away.
 */
export async function testSettings(ctx: RuntimeContext, env: NodeJS.ProcessEnv, log: (m: string) => void): Promise<TestResult> {
  const mode = parseTlsMode(env);
  const names = [ctx.hostname, ...splitList(env.TLS_SANS)];
  log(`Certificate mode: ${mode}`);

  let result: TestResult;
  if (mode === 'off') {
    result = { ok: true, message: `Plain HTTP on this port. A reverse proxy must terminate HTTPS for ${ctx.publicUrl.origin} - browsers and MCP clients connecting directly will fail.` };
  } else if (mode === 'internal') {
    const changes = internalCaWouldChange(ctx.store, names, splitList(env.TLS_CA_NAME_CONSTRAINTS));
    log(`Certificate names: ${names.join(', ')}`);
    result = changes
      ? { ok: true, message: 'Works offline. A NEW root CA will be generated for these names - install the new root certificate (Certificates tab) on every device afterwards.' }
      : { ok: true, message: 'Works offline. The installed root certificate stays valid.' };
  } else if (mode === 'file') {
    const tls = tlsManagerFor(ctx, env);
    try {
      await tls.init();
      const leaf = tls.info().leaf!;
      log(`Loaded ${env.TLS_CERT_FILE}: issued by ${leaf.issuer || '(empty)'}, valid until ${leaf.notAfter}, names ${leaf.sans.join(', ')}`);
      const problem = tls.publicTrustProblem(ctx.hostname);
      result = problem
        ? { ok: true, message: `Files are valid, but the certificate does not look publicly trusted: ${problem}. Devices need to trust its CA.` }
        : { ok: true, message: 'Files are valid and the certificate covers the host name.' };
    } finally {
      tls.stop();
    }
  } else {
    result = await testAcme(ctx, env, names, log);
  }

  // What OAuth would do
  if (result.ok) {
    const probe = mode === 'acme' ? tlsManagerFor(ctx, env) : undefined;
    let certProblem: string | undefined;
    if (probe) certProblem = probe.publicTrustProblem(ctx.hostname);
    const decision = resolveOAuthMode({ setting: env.OAUTH, publicUrl: ctx.publicUrl, tlsMode: mode, certProblem });
    log(`OAuth for Claude/ChatGPT connectors would be ${decision.enabled ? 'ON' : 'off'} (${decision.reason})`);
  }
  return result;
}

async function testAcme(ctx: RuntimeContext, env: NodeJS.ProcessEnv, names: string[], log: (m: string) => void): Promise<TestResult> {
  const configured = acmeSettingsFromEnv(env, names, ctx.publicUrl.origin, ctx.listenHost);
  const settings = { ...configured };
  if (configured.directoryUrl === LETSENCRYPT_PRODUCTION) {
    settings.directoryUrl = LETSENCRYPT_STAGING;
    settings.staging = true;
    log("Testing against Let's Encrypt STAGING (the real certificate is requested after Save & apply)");
  } else {
    log(`Testing against ${configured.directoryUrl}`);
  }
  log(`Names: ${settings.domains.join(', ')} - validation ${settings.challenge}${settings.dnsProvider ? ` via ${settings.dnsProvider}` : ` on port ${settings.httpPort}`}`);

  // A throwaway account; acme-dns registrations are shared with the real configuration so the
  // CNAME the user creates now keeps working after applying.
  const stored = ctx.store.getTls().acme;
  const state: AcmeState = { directoryUrl: settings.directoryUrl, accountKeyPem: await generateKeyPem(), acmeDns: stored?.acmeDns };
  const saveState = (st: AcmeState) => {
    const tls = ctx.store.getTls();
    const acme = tls.acme ?? { directoryUrl: '', accountKeyPem: '' };
    ctx.store.setTls({ ...tls, acme: { ...acme, acmeDns: st.acmeDns } });
  };

  let release: (() => void) | undefined;
  try {
    let tokens = new Map<string, string>();
    if (settings.challenge === 'http-01') {
      const ch = await acquireChallengeServer(settings);
      tokens = ch.tokens;
      release = ch.release;
      log(`Listening for the HTTP check on port ${settings.httpPort} - port 80 on the internet must reach it`);
    }
    const solver = createDnsSolver(settings, state, saveState, log);
    if (solver?.pendingSetup) {
      const pending = await solver.pendingSetup();
      if (pending.length) {
        return {
          ok: false,
          message: `Create ${pending.length === 1 ? 'this DNS record' : 'these DNS records'} at your DNS provider, then test again: ${pending.map(p => `${p.name} CNAME ${p.target}`).join(' ; ')}`,
        };
      }
      log('acme-dns CNAME record found');
    }
    // The throwaway account itself is not saved
    const client = new AcmeClient({ settings, state, saveState: () => {}, log, httpTokens: tokens });
    const issued = await client.issue(solver);
    const cert = new X509Certificate(issued.certPem);
    log(`Certificate issued by ${(cert.issuer ?? '').replace(/\n/g, ', ')}, valid until ${cert.validTo} - discarded (test only)`);
    return {
      ok: true,
      message: settings.staging && configured.directoryUrl === LETSENCRYPT_PRODUCTION
        ? 'Works: Let’s Encrypt staging issued a test certificate with these settings. Save & apply to get the real one.'
        : 'Works: the CA issued a certificate with these settings.',
    };
  } catch (err) {
    return { ok: false, message: errMsg(err) };
  } finally {
    release?.();
  }
}
