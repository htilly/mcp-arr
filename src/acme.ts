/**
 * Minimal ACME (RFC 8555) client for TLS_MODE=acme - Let's Encrypt, ZeroSSL, step-ca or any other
 * ACME CA. No external dependencies: JWS signing uses WebCrypto (ES256), CSRs use @peculiar/x509.
 *
 * Challenges:
 *  - http-01: for servers reachable from the internet on port 80. A small HTTP listener answers
 *    /.well-known/acme-challenge/* and redirects everything else to https.
 *  - dns-01: for servers on a LAN (nothing needs to be reachable from the internet) and for
 *    wildcard certificates. The TXT record is set through a DNS provider:
 *      cloudflare - Cloudflare API token
 *      acme-dns   - CNAME delegation to an acme-dns server: works with every DNS provider, and no
 *                   DNS credentials ever leave your hands (one-time CNAME record per name)
 *      exec       - your own script, same interface as lego's "exec" provider
 */

import 'reflect-metadata';
import * as x509 from '@peculiar/x509';
import { execFile } from 'node:child_process';
import { createHash, createHmac, webcrypto } from 'node:crypto';
import { Resolver } from 'node:dns/promises';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { isIP } from 'node:net';

type CryptoKey = webcrypto.CryptoKey;
type CryptoKeyPair = webcrypto.CryptoKeyPair;

x509.cryptoProvider.set(webcrypto as never);

export const LETSENCRYPT_PRODUCTION = 'https://acme-v02.api.letsencrypt.org/directory';
export const LETSENCRYPT_STAGING = 'https://acme-staging-v02.api.letsencrypt.org/directory';

const ALG = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' } as const;
const DEFAULT_ACME_DNS_SERVER = 'https://auth.acme-dns.io';

export type ChallengeType = 'http-01' | 'dns-01';
export type DnsProviderName = 'cloudflare' | 'acme-dns' | 'exec';

export interface AcmeSettings {
  directoryUrl: string;
  staging: boolean;
  email?: string;
  domains: string[];
  challenge: ChallengeType;
  /** http-01 listener */
  httpPort: number;
  httpHost: string;
  /** Where the http-01 listener redirects other requests (the PUBLIC_URL origin). */
  redirectOrigin: string;
  dnsProvider?: DnsProviderName;
  /** Public resolvers used to check that the TXT record is visible before asking the CA. */
  dnsResolvers: string[];
  dnsTimeoutMs: number;
  dnsDelayMs: number;
  eab?: { kid: string; hmacKey: string };
  profile?: string;
  cloudflare?: { token: string; zoneId?: string };
  acmeDns?: { server: string; username?: string; password?: string; subdomain?: string };
  execHook?: string;
}

export class AcmeError extends Error {
  constructor(message: string, public readonly type?: string, public readonly status?: number) {
    super(message);
  }
}

/** Parse and validate the ACME_* environment variables. Throws on configuration errors. */
export function acmeSettingsFromEnv(env: NodeJS.ProcessEnv, names: string[], redirectOrigin: string, listenHost: string): AcmeSettings {
  const list = (v?: string) => (v ?? '').split(',').map(x => x.trim()).filter(Boolean);
  const domains = [...new Set((list(env.ACME_DOMAINS).length ? list(env.ACME_DOMAINS) : names).map(n => n.toLowerCase()).filter(n => !isIP(n)))];
  if (!domains.length) throw new Error('TLS_MODE=acme needs at least one DNS name (PUBLIC_URL host, TLS_SANS or ACME_DOMAINS)');

  const staging = env.ACME_STAGING === 'true';
  const directoryUrl = env.ACME_DIRECTORY_URL || (staging ? LETSENCRYPT_STAGING : LETSENCRYPT_PRODUCTION);

  const dnsProvider = env.ACME_DNS_PROVIDER?.toLowerCase() as DnsProviderName | undefined;
  if (dnsProvider && !['cloudflare', 'acme-dns', 'exec'].includes(dnsProvider)) {
    throw new Error(`Unknown ACME_DNS_PROVIDER '${env.ACME_DNS_PROVIDER}' (use 'cloudflare', 'acme-dns' or 'exec')`);
  }
  const challenge = (env.ACME_CHALLENGE?.toLowerCase() || (dnsProvider ? 'dns-01' : 'http-01')) as ChallengeType;
  if (challenge !== 'http-01' && challenge !== 'dns-01') {
    throw new Error(`Unknown ACME_CHALLENGE '${env.ACME_CHALLENGE}' (use 'http-01' or 'dns-01')`);
  }
  if (challenge === 'dns-01' && !dnsProvider) throw new Error('ACME_CHALLENGE=dns-01 requires ACME_DNS_PROVIDER (cloudflare, acme-dns or exec)');
  if (challenge === 'http-01' && domains.some(d => d.startsWith('*.'))) {
    throw new Error('Wildcard names need ACME_CHALLENGE=dns-01 (http-01 cannot validate wildcards)');
  }

  const s: AcmeSettings = {
    directoryUrl,
    staging,
    email: env.ACME_EMAIL || undefined,
    domains,
    challenge,
    httpPort: Number(env.ACME_HTTP_PORT || 80),
    httpHost: listenHost,
    redirectOrigin,
    dnsProvider: challenge === 'dns-01' ? dnsProvider : undefined,
    dnsResolvers: list(env.ACME_DNS_RESOLVERS).length ? list(env.ACME_DNS_RESOLVERS) : ['1.1.1.1', '8.8.8.8'],
    dnsTimeoutMs: Number(env.ACME_DNS_TIMEOUT || 300) * 1000,
    dnsDelayMs: Number(env.ACME_DNS_DELAY ?? 10) * 1000,
    profile: env.ACME_PROFILE || undefined,
  };
  if (!Number.isInteger(s.httpPort) || s.httpPort < 1 || s.httpPort > 65535) throw new Error('ACME_HTTP_PORT must be a port number');
  if (env.ACME_EAB_KID || env.ACME_EAB_HMAC_KEY) {
    if (!env.ACME_EAB_KID || !env.ACME_EAB_HMAC_KEY) throw new Error('Set both ACME_EAB_KID and ACME_EAB_HMAC_KEY');
    s.eab = { kid: env.ACME_EAB_KID, hmacKey: env.ACME_EAB_HMAC_KEY };
  }
  if (s.dnsProvider === 'cloudflare') {
    const token = env.CLOUDFLARE_DNS_API_TOKEN || env.CF_DNS_API_TOKEN;
    if (!token) throw new Error('ACME_DNS_PROVIDER=cloudflare requires CLOUDFLARE_DNS_API_TOKEN (permissions: Zone:Read + DNS:Edit)');
    s.cloudflare = { token, zoneId: env.CLOUDFLARE_ZONE_ID || undefined };
  }
  if (s.dnsProvider === 'acme-dns') {
    s.acmeDns = {
      server: (env.ACMEDNS_API_BASE || DEFAULT_ACME_DNS_SERVER).replace(/\/+$/, ''),
      username: env.ACMEDNS_USERNAME || undefined,
      password: env.ACMEDNS_PASSWORD || undefined,
      subdomain: env.ACMEDNS_SUBDOMAIN || undefined,
    };
    const given = [s.acmeDns.username, s.acmeDns.password, s.acmeDns.subdomain].filter(Boolean).length;
    if (given && given !== 3) throw new Error('Set all of ACMEDNS_USERNAME, ACMEDNS_PASSWORD and ACMEDNS_SUBDOMAIN, or none (then an account is registered automatically)');
  }
  if (s.dnsProvider === 'exec') {
    if (!env.ACME_DNS_HOOK) throw new Error('ACME_DNS_PROVIDER=exec requires ACME_DNS_HOOK (path to a script: <script> present|cleanup <fqdn> <value>)');
    s.execHook = env.ACME_DNS_HOOK;
  }
  return s;
}

// ---------------- encoding helpers ----------------

export function b64url(data: Buffer | Uint8Array | string): string {
  return Buffer.from(data as Uint8Array).toString('base64url');
}

async function exportKeyPem(key: CryptoKey): Promise<string> {
  const der = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', key));
  return `-----BEGIN PRIVATE KEY-----\n${der.toString('base64').match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`;
}

function pemToDer(pem: string): Buffer {
  return Buffer.from(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64');
}

export async function generateKeyPem(): Promise<string> {
  const keys = (await webcrypto.subtle.generateKey(ALG, true, ['sign', 'verify'])) as CryptoKeyPair;
  return exportKeyPem(keys.privateKey);
}

interface Jwk { kty: string; crv: string; x: string; y: string }

// ---------------- ACME protocol ----------------

interface Directory {
  newNonce: string;
  newAccount: string;
  newOrder: string;
  meta?: { termsOfService?: string; externalAccountRequired?: boolean; profiles?: Record<string, string> };
}

interface Order {
  status: 'pending' | 'ready' | 'processing' | 'valid' | 'invalid';
  authorizations: string[];
  finalize: string;
  certificate?: string;
  error?: { detail?: string };
}

interface Challenge { type: string; url: string; token: string; status: string; error?: { type?: string; detail?: string } }
interface Authorization {
  identifier: { type: string; value: string };
  status: 'pending' | 'valid' | 'invalid' | 'deactivated' | 'expired' | 'revoked';
  challenges: Challenge[];
  wildcard?: boolean;
}

/** A pending DNS step the user has to do by hand (acme-dns CNAME). */
export interface PendingCname {
  name: string;
  target: string;
}

/** Persistent state the client needs (stored encrypted in the config file). */
export interface AcmeState {
  directoryUrl: string;
  accountKeyPem: string;
  accountUrl?: string;
  /** acme-dns registrations, keyed by base domain (wildcard and plain name share one). */
  acmeDns?: Record<string, { server: string; username: string; password: string; subdomain: string; fulldomain: string }>;
}

export interface IssueResult {
  certPem: string;
  keyPem: string;
}

export interface AcmeClientOptions {
  settings: AcmeSettings;
  state: AcmeState;
  /** Called whenever the state changes (account registered, acme-dns registered...). */
  saveState: (s: AcmeState) => void;
  log: (msg: string) => void;
  /** Shared http-01 token store (served by the challenge listener). */
  httpTokens: Map<string, string>;
}

export class AcmeClient {
  private dir?: Directory;
  private nonce?: string;
  private key?: CryptoKey;
  private jwk?: Jwk;
  private readonly s: AcmeSettings;

  constructor(private readonly o: AcmeClientOptions) {
    this.s = o.settings;
  }

  private async directory(): Promise<Directory> {
    if (this.dir) return this.dir;
    const res = await fetchWithTimeout(this.s.directoryUrl, {});
    if (!res.ok) throw new AcmeError(`ACME directory ${this.s.directoryUrl} returned HTTP ${res.status}`);
    this.dir = (await res.json()) as Directory;
    return this.dir;
  }

  private async accountKey(): Promise<CryptoKey> {
    if (this.key) return this.key;
    const der = pemToDer(this.o.state.accountKeyPem);
    const priv = await webcrypto.subtle.importKey('pkcs8', der, ALG, true, ['sign']);
    const full = (await webcrypto.subtle.exportKey('jwk', priv)) as Jwk & { d?: string };
    this.jwk = { crv: full.crv, kty: full.kty, x: full.x, y: full.y };
    this.key = priv;
    return priv;
  }

  /** RFC 7638 thumbprint of the account key. */
  private async thumbprint(): Promise<string> {
    await this.accountKey();
    const j = this.jwk!;
    return b64url(createHash('sha256').update(JSON.stringify({ crv: j.crv, kty: j.kty, x: j.x, y: j.y })).digest());
  }

  private async getNonce(): Promise<string> {
    if (this.nonce) {
      const n = this.nonce;
      this.nonce = undefined;
      return n;
    }
    const res = await fetchWithTimeout((await this.directory()).newNonce, { method: 'HEAD' });
    const n = res.headers.get('replay-nonce');
    if (!n) throw new AcmeError('ACME server did not return a nonce');
    return n;
  }

  private async sign(url: string, payload: unknown, useJwk: boolean): Promise<string> {
    const key = await this.accountKey();
    const header: Record<string, unknown> = { alg: 'ES256', nonce: await this.getNonce(), url };
    if (useJwk) header.jwk = this.jwk;
    else header.kid = this.o.state.accountUrl;
    const protectedB64 = b64url(JSON.stringify(header));
    const payloadB64 = payload === undefined ? '' : b64url(JSON.stringify(payload));
    const sig = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, Buffer.from(`${protectedB64}.${payloadB64}`));
    return JSON.stringify({ protected: protectedB64, payload: payloadB64, signature: b64url(Buffer.from(sig)) });
  }

  /** Signed POST (payload undefined = POST-as-GET). Retries on badNonce. */
  private async post(url: string, payload: unknown, opts: { useJwk?: boolean; accept?: string } = {}): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const body = await this.sign(url, payload, !!opts.useJwk);
      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/jose+json', ...(opts.accept ? { Accept: opts.accept } : {}) },
        body,
      });
      const nonce = res.headers.get('replay-nonce');
      if (nonce) this.nonce = nonce;
      if (res.ok) return res;
      let problem: { type?: string; detail?: string } = {};
      try {
        problem = (await res.json()) as typeof problem;
      } catch {
        /* not JSON */
      }
      if (problem.type === 'urn:ietf:params:acme:error:badNonce' && attempt < 3) continue;
      throw new AcmeError(`${problem.detail || `HTTP ${res.status}`}${problem.type ? ` (${problem.type.replace('urn:ietf:params:acme:error:', '')})` : ''}`, problem.type, res.status);
    }
  }

  private async ensureAccount(): Promise<void> {
    if (this.o.state.accountUrl) return;
    const dir = await this.directory();
    const payload: Record<string, unknown> = { termsOfServiceAgreed: true };
    if (this.s.email) payload.contact = [`mailto:${this.s.email}`];
    if (this.s.eab) {
      await this.accountKey();
      const protectedB64 = b64url(JSON.stringify({ alg: 'HS256', kid: this.s.eab.kid, url: dir.newAccount }));
      const payloadB64 = b64url(JSON.stringify(this.jwk));
      const mac = createHmac('sha256', Buffer.from(this.s.eab.hmacKey, 'base64url')).update(`${protectedB64}.${payloadB64}`).digest();
      payload.externalAccountBinding = { protected: protectedB64, payload: payloadB64, signature: b64url(mac) };
    } else if (dir.meta?.externalAccountRequired) {
      throw new AcmeError('This ACME CA requires external account binding - set ACME_EAB_KID and ACME_EAB_HMAC_KEY');
    }
    const res = await this.post(dir.newAccount, payload, { useJwk: true });
    const url = res.headers.get('location');
    if (!url) throw new AcmeError('ACME server did not return an account URL');
    this.o.state.accountUrl = url;
    this.o.saveState(this.o.state);
    this.o.log(`ACME account registered at ${new URL(this.s.directoryUrl).host}${dir.meta?.termsOfService ? ` (terms of service: ${dir.meta.termsOfService})` : ''}`);
  }

  private async getJson<T>(url: string): Promise<{ body: T; res: Response }> {
    const res = await this.post(url, undefined);
    return { body: (await res.json()) as T, res };
  }

  /** Request a certificate for all configured domains. */
  async issue(dnsSolver?: DnsSolver): Promise<IssueResult> {
    await this.accountKey();
    await this.ensureAccount();
    const dir = await this.directory();

    const orderPayload: Record<string, unknown> = { identifiers: this.s.domains.map(value => ({ type: 'dns', value })) };
    if (this.s.profile) orderPayload.profile = this.s.profile;
    let res: Response;
    try {
      res = await this.post(dir.newOrder, orderPayload);
    } catch (err) {
      // Account deleted / unknown on the server (e.g. directory reset) -> register again once
      if (err instanceof AcmeError && err.type === 'urn:ietf:params:acme:error:accountDoesNotExist') {
        this.o.state.accountUrl = undefined;
        await this.ensureAccount();
        res = await this.post(dir.newOrder, orderPayload);
      } else throw err;
    }
    const orderUrl = res.headers.get('location');
    if (!orderUrl) throw new AcmeError('ACME server did not return an order URL');
    let order = (await res.json()) as Order;

    const thumb = await this.thumbprint();
    const cleanups: (() => Promise<void>)[] = [];
    try {
      const toValidate: { authzUrl: string; challenge: Challenge; name: string }[] = [];
      for (const authzUrl of order.authorizations) {
        const { body: authz } = await this.getJson<Authorization>(authzUrl);
        if (authz.status === 'valid') continue;
        if (authz.status !== 'pending') throw new AcmeError(`Authorization for ${authz.identifier.value} is ${authz.status}`);
        const challenge = authz.challenges.find(c => c.type === this.s.challenge);
        if (!challenge) throw new AcmeError(`The CA does not offer ${this.s.challenge} for ${authz.identifier.value}`);
        const keyAuth = `${challenge.token}.${thumb}`;
        const name = `${authz.wildcard ? '*.' : ''}${authz.identifier.value}`;
        if (this.s.challenge === 'http-01') {
          this.o.httpTokens.set(challenge.token, keyAuth);
          cleanups.push(async () => void this.o.httpTokens.delete(challenge.token));
        } else {
          const fqdn = `_acme-challenge.${authz.identifier.value}.`;
          const value = b64url(createHash('sha256').update(keyAuth).digest());
          const handle = await dnsSolver!.present(fqdn, value, authz.identifier.value);
          cleanups.push(() => dnsSolver!.cleanup(fqdn, value, handle).catch(err => this.o.log(`DNS cleanup for ${fqdn} failed: ${errMsg(err)}`)));
          toValidate.push({ authzUrl, challenge, name: fqdn });
          continue;
        }
        toValidate.push({ authzUrl, challenge, name });
      }

      if (this.s.challenge === 'dns-01' && toValidate.length) {
        await waitForTxt(this.s, toValidate.map(v => v.name), this.o.log);
      }

      for (const v of toValidate) await this.post(v.challenge.url, {});
      for (const v of toValidate) await this.waitForAuthz(v.authzUrl);

      // Finalize with a fresh certificate key
      const certKeys = (await webcrypto.subtle.generateKey(ALG, true, ['sign', 'verify'])) as CryptoKeyPair;
      const csr = await x509.Pkcs10CertificateRequestGenerator.create({
        name: `CN=${this.s.domains[0]}`,
        keys: certKeys,
        signingAlgorithm: ALG,
        extensions: [new x509.SubjectAlternativeNameExtension(this.s.domains.map(value => ({ type: 'dns' as const, value })))],
      });
      order = (await this.waitForOrder(orderUrl, ['ready', 'valid', 'processing'])) as Order;
      if (order.status === 'ready') {
        await this.post(order.finalize, { csr: b64url(Buffer.from(csr.rawData)) });
      }
      order = await this.waitForOrder(orderUrl, ['valid']);
      if (!order.certificate) throw new AcmeError('Order is valid but has no certificate URL');
      const certRes = await this.post(order.certificate, undefined, { accept: 'application/pem-certificate-chain' });
      const certPem = (await certRes.text()).replace(/\r\n/g, '\n').trim() + '\n';
      return { certPem, keyPem: await exportKeyPem(certKeys.privateKey) };
    } finally {
      for (const c of cleanups) await c();
    }
  }

  private async waitForAuthz(url: string): Promise<void> {
    const deadline = Date.now() + 180_000;
    for (;;) {
      const { body, res } = await this.getJson<Authorization>(url);
      if (body.status === 'valid') return;
      if (body.status !== 'pending') {
        const ch = body.challenges.find(c => c.error);
        throw new AcmeError(`Validation of ${body.identifier.value} failed: ${ch?.error?.detail ?? body.status}`, ch?.error?.type);
      }
      if (Date.now() > deadline) throw new AcmeError(`Timed out waiting for validation of ${body.identifier.value}`);
      await sleep(retryAfter(res, 2000));
    }
  }

  private async waitForOrder(url: string, want: Order['status'][]): Promise<Order> {
    const deadline = Date.now() + 180_000;
    for (;;) {
      const { body, res } = await this.getJson<Order>(url);
      if (want.includes(body.status)) return body;
      if (body.status === 'invalid') throw new AcmeError(`Order failed: ${body.error?.detail ?? 'invalid'}`);
      if (Date.now() > deadline) throw new AcmeError(`Timed out waiting for the order (status ${body.status})`);
      await sleep(retryAfter(res, 2000));
    }
  }
}

function retryAfter(res: Response, fallback: number): number {
  const v = Number(res.headers.get('retry-after'));
  return Number.isFinite(v) && v > 0 ? Math.min(v * 1000, 30_000) : fallback;
}

/** Wait until every TXT record is visible on the public resolvers (best effort), then a short delay. */
async function waitForTxt(s: AcmeSettings, fqdns: string[], log: (m: string) => void): Promise<void> {
  const resolver = new Resolver({ timeout: 3000, tries: 1 });
  try {
    resolver.setServers(s.dnsResolvers);
  } catch {
    /* invalid resolver list - fall back to system resolvers */
  }
  const pending = new Set(fqdns.map(f => f.replace(/\.$/, '')));
  const deadline = Date.now() + s.dnsTimeoutMs;
  let unreachable = 0;
  while (pending.size && Date.now() < deadline) {
    for (const name of [...pending]) {
      try {
        const records = await resolver.resolveTxt(name);
        if (records.length) pending.delete(name);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ECONNREFUSED' || code === 'ETIMEOUT') unreachable++;
      }
    }
    if (unreachable > 6 && pending.size) {
      log(`Cannot reach DNS resolvers ${s.dnsResolvers.join(', ')} to check propagation - continuing after ACME_DNS_DELAY (set ACME_DNS_RESOLVERS if outbound DNS to them is blocked)`);
      break;
    }
    if (pending.size) await sleep(5000);
  }
  if (pending.size && unreachable <= 6) log(`TXT record not visible yet for ${[...pending].join(', ')} - asking the CA anyway`);
  if (s.dnsDelayMs > 0) await sleep(s.dnsDelayMs);
}

// ---------------- DNS solvers ----------------

export interface DnsSolver {
  /** Create the TXT record; returns a handle passed to cleanup. `domain` is the name being validated (without *.). */
  present(fqdn: string, value: string, domain: string): Promise<unknown>;
  cleanup(fqdn: string, value: string, handle: unknown): Promise<void>;
  /** Steps the user still has to do before issuance can work (acme-dns CNAME). */
  pendingSetup?(): Promise<PendingCname[]>;
}

export function createDnsSolver(s: AcmeSettings, state: AcmeState, saveState: (st: AcmeState) => void, log: (m: string) => void): DnsSolver | undefined {
  if (s.challenge !== 'dns-01') return undefined;
  if (s.dnsProvider === 'cloudflare') return new CloudflareSolver(s.cloudflare!.token, s.cloudflare!.zoneId);
  if (s.dnsProvider === 'acme-dns') return new AcmeDnsSolver(s, state, saveState, log);
  return new ExecSolver(s.execHook!);
}

class CloudflareSolver implements DnsSolver {
  private zones = new Map<string, string>();
  constructor(private readonly token: string, private readonly zoneId?: string) {}

  private async api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetchWithTimeout(`https://api.cloudflare.com/client/v4${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
    });
    const body = (await res.json().catch(() => ({}))) as { success?: boolean; result?: T; errors?: { message: string }[] };
    if (!res.ok || !body.success) {
      throw new Error(`Cloudflare API: ${body.errors?.map(e => e.message).join('; ') || `HTTP ${res.status}`}`);
    }
    return body.result as T;
  }

  private async zoneFor(name: string): Promise<string> {
    if (this.zoneId) return this.zoneId;
    const labels = name.replace(/\.$/, '').split('.');
    for (let i = 0; i < labels.length - 1; i++) {
      const candidate = labels.slice(i).join('.');
      const cached = this.zones.get(candidate);
      if (cached) return cached;
      const zones = await this.api<{ id: string }[]>(`/zones?name=${encodeURIComponent(candidate)}`);
      if (zones.length) {
        this.zones.set(candidate, zones[0].id);
        return zones[0].id;
      }
    }
    throw new Error(`No Cloudflare zone found for ${name} (does the token have Zone:Read? or set CLOUDFLARE_ZONE_ID)`);
  }

  async present(fqdn: string, value: string): Promise<unknown> {
    const zone = await this.zoneFor(fqdn);
    const rec = await this.api<{ id: string }>(`/zones/${zone}/dns_records`, {
      method: 'POST',
      body: JSON.stringify({ type: 'TXT', name: fqdn.replace(/\.$/, ''), content: value, ttl: 120, comment: 'mcp-arr ACME challenge' }),
    });
    return { zone, id: rec.id };
  }

  async cleanup(_fqdn: string, _value: string, handle: unknown): Promise<void> {
    const h = handle as { zone: string; id: string };
    await this.api(`/zones/${h.zone}/dns_records/${h.id}`, { method: 'DELETE' });
  }
}

class AcmeDnsSolver implements DnsSolver {
  constructor(
    private readonly s: AcmeSettings,
    private readonly state: AcmeState,
    private readonly saveState: (st: AcmeState) => void,
    private readonly log: (m: string) => void,
  ) {}

  private baseDomains(): string[] {
    return [...new Set(this.s.domains.map(d => d.replace(/^\*\./, '')))];
  }

  /** Account for a base domain: from env (shared by all names) or registered automatically. */
  private async account(domain: string) {
    const cfg = this.s.acmeDns!;
    if (cfg.username && cfg.password && cfg.subdomain) {
      const host = new URL(cfg.server).hostname;
      return { server: cfg.server, username: cfg.username, password: cfg.password, subdomain: cfg.subdomain, fulldomain: `${cfg.subdomain}.${host}` };
    }
    const existing = this.state.acmeDns?.[domain];
    if (existing && existing.server === cfg.server) return existing;
    const res = await fetchWithTimeout(`${cfg.server}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!res.ok) throw new Error(`acme-dns registration at ${cfg.server} failed: HTTP ${res.status}`);
    const r = (await res.json()) as { username: string; password: string; subdomain: string; fulldomain: string };
    this.state.acmeDns = { ...(this.state.acmeDns ?? {}), [domain]: { server: cfg.server, ...r } };
    this.saveState(this.state);
    this.log(`acme-dns: registered ${domain} at ${cfg.server}. Create this DNS record once at your DNS provider: _acme-challenge.${domain}  CNAME  ${r.fulldomain}`);
    return this.state.acmeDns[domain];
  }

  async pendingSetup(): Promise<PendingCname[]> {
    const out: PendingCname[] = [];
    const resolver = new Resolver({ timeout: 3000, tries: 1 });
    try {
      resolver.setServers(this.s.dnsResolvers);
    } catch {
      /* system resolvers */
    }
    for (const domain of this.baseDomains()) {
      const acc = await this.account(domain);
      const name = `_acme-challenge.${domain}`;
      let ok = false;
      try {
        const cnames = await resolver.resolveCname(name);
        ok = cnames.some(c => c.replace(/\.$/, '').toLowerCase() === acc.fulldomain.toLowerCase());
      } catch (err) {
        // Resolvers unreachable (outbound DNS blocked): cannot check - let the CA decide
        const code = (err as NodeJS.ErrnoException).code;
        ok = code === 'ETIMEOUT' || code === 'ECONNREFUSED';
        if (ok) this.log(`Cannot reach ${this.s.dnsResolvers.join(', ')} to check ${name} - trying anyway (set ACME_DNS_RESOLVERS)`);
      }
      if (!ok) out.push({ name, target: acc.fulldomain });
    }
    return out;
  }

  async present(_fqdn: string, value: string, domain: string): Promise<unknown> {
    const acc = await this.account(domain);
    const res = await fetchWithTimeout(`${acc.server}/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-User': acc.username, 'X-Api-Key': acc.password },
      body: JSON.stringify({ subdomain: acc.subdomain, txt: value }),
    });
    if (!res.ok) throw new Error(`acme-dns update failed: HTTP ${res.status}`);
    return undefined;
  }

  async cleanup(): Promise<void> {
    // acme-dns keeps the last two values and overwrites them on the next update - nothing to delete
  }
}

class ExecSolver implements DnsSolver {
  constructor(private readonly script: string) {}
  private run(action: string, fqdn: string, value: string): Promise<void> {
    return new Promise((resolve, reject) => {
      execFile(this.script, [action, fqdn, value], { timeout: 120_000 }, (err, _stdout, stderr) => {
        if (err) reject(new Error(`ACME_DNS_HOOK ${action} failed: ${(stderr || err.message).trim().slice(0, 300)}`));
        else resolve();
      });
    });
  }
  async present(fqdn: string, value: string): Promise<unknown> {
    await this.run('present', fqdn, value);
    return undefined;
  }
  async cleanup(fqdn: string, value: string): Promise<void> {
    await this.run('cleanup', fqdn, value);
  }
}

// ---------------- http-01 listener ----------------

/**
 * Plain-HTTP listener for http-01: answers /.well-known/acme-challenge/<token> and redirects
 * everything else to the https PUBLIC_URL.
 */
export function startChallengeServer(s: AcmeSettings, tokens: Map<string, string>): Promise<Server> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url ?? '/').split('?')[0];
    const m = /^\/\.well-known\/acme-challenge\/([A-Za-z0-9_-]+)$/.exec(path);
    if (m) {
      const keyAuth = tokens.get(m[1]);
      if (keyAuth && (req.method === 'GET' || req.method === 'HEAD')) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(keyAuth);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
      }
      return;
    }
    res.writeHead(301, { Location: `${s.redirectOrigin}${path.startsWith('/') ? path : '/'}` });
    res.end();
  });
  return new Promise((resolve, reject) => {
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EACCES') {
        reject(new Error(`Cannot listen on port ${s.httpPort} for http-01 (permission denied). Run with a higher ACME_HTTP_PORT (e.g. 8080) and forward port 80 to it - in Docker: ports "80:8080"`));
      } else if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${s.httpPort} is already in use - http-01 needs it (or set ACME_HTTP_PORT and forward port 80 to it, or use dns-01)`));
      } else reject(err);
    });
    server.listen(s.httpPort, s.httpHost, () => resolve(server));
  });
}

// ---------------- misc ----------------

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export function errMsg(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as Error & { cause?: { code?: string; message?: string } }).cause;
    return cause?.code || cause?.message ? `${err.message} (${cause.code ?? cause.message})` : err.message;
  }
  return String(err);
}

async function fetchWithTimeout(url: string, init: RequestInit, ms = 30_000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}
