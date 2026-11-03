/**
 * TLS certificates for HTTP mode, designed for networks WITHOUT internet access.
 *
 * TLS_MODE:
 *  - internal (default): a built-in certificate authority. On first run a root CA is generated
 *    (ECDSA P-256, name-constrained to the configured host names / IPs so the installed root cannot
 *    be abused for other sites) and a server certificate is issued and renewed automatically.
 *    All private keys are stored inside the encrypted config file.
 *  - file: bring your own certificate (TLS_CERT_FILE / TLS_KEY_FILE), e.g. from a LAN CA such as
 *    step-ca (incl. its ACME server), Caddy, your router, or a DNS-01 certificate copied in.
 *    The files are watched and reloaded on change.
 *  - acme: a publicly trusted certificate from Let's Encrypt (or any ACME CA), obtained and renewed
 *    automatically - http-01 for servers reachable from the internet, dns-01 for LAN-only servers
 *    and wildcards (see acme.ts). Account and certificate keys are stored in the encrypted config.
 *  - off: plain HTTP - only for running behind a reverse proxy that terminates TLS.
 */

import 'reflect-metadata';
import * as x509 from '@peculiar/x509';
import { AsnConvert } from '@peculiar/asn1-schema';
import { GeneralName, GeneralSubtree, GeneralSubtrees, NameConstraints, id_ce_nameConstraints } from '@peculiar/asn1-x509';
import { X509Certificate, createPrivateKey, randomBytes, webcrypto } from 'node:crypto';
import { existsSync, readFileSync, unwatchFile, watchFile } from 'node:fs';
import { isIP } from 'node:net';
import type { Server } from 'node:http';
import { ConfigStore, StoredKeyPair, StoredTls } from './config-store.js';
import {
  AcmeClient,
  AcmeSettings,
  AcmeState,
  DnsSolver,
  LETSENCRYPT_STAGING,
  PendingCname,
  createDnsSolver,
  errMsg,
  generateKeyPem,
  startChallengeServer,
} from './acme.js';

type CryptoKey = webcrypto.CryptoKey;
type CryptoKeyPair = webcrypto.CryptoKeyPair;

x509.cryptoProvider.set(webcrypto as never);

export type TlsMode = 'internal' | 'file' | 'acme' | 'off';

/** ACME CAs whose roots are in the public trust stores (for the OAuth auto check). */
const PUBLIC_ACME_HOSTS = ['acme-v02.api.letsencrypt.org', 'acme.zerossl.com', 'dv.acme-v02.api.pki.goog', 'api.buypass.com', 'acme.ssl.com'];

export interface AcmeInfo {
  directoryUrl: string;
  staging: boolean;
  challenge: string;
  dnsProvider?: string;
  domains: string[];
  status: 'pending' | 'issuing' | 'valid' | 'waiting-dns' | 'error';
  /** acme-dns: CNAME records the user still has to create. */
  pendingCnames?: PendingCname[];
  nextAttempt?: string;
  httpPort?: number;
}

export interface TlsMaterial {
  cert: string;
  key: string;
}

export interface CertSummary {
  subject: string;
  issuer: string;
  notBefore: string;
  notAfter: string;
  fingerprint256: string;
  sans: string[];
}

export interface TlsInfo {
  mode: TlsMode;
  names: string[];
  ca?: CertSummary & { permitted: string[] };
  leaf?: CertSummary;
  certFile?: string;
  keyFile?: string;
  acme?: AcmeInfo;
  lastError?: string;
}

export interface TlsManagerOptions {
  mode: TlsMode;
  store: ConfigStore;
  /** Host names and IP addresses the server certificate must cover. */
  names: string[];
  /** Optional name constraints for the CA (default: exactly `names`). E.g. ["home.lan"]. */
  caPermitted?: string[];
  certFile?: string;
  keyFile?: string;
  /** Server certificate lifetime in days (default 397, the browser maximum). */
  leafDays?: number;
  /** TLS_MODE=acme settings (see acmeSettingsFromEnv). */
  acme?: AcmeSettings;
}

const ALG = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' } as const;
const DAY_MS = 86_400_000;
const CA_DAYS = 3650;

export class TlsManager {
  readonly mode: TlsMode;
  private readonly store: ConfigStore;
  private readonly names: string[];
  private readonly caPermitted: string[];
  private readonly leafDays: number;
  private readonly certFile?: string;
  private readonly keyFile?: string;
  private material?: TlsMaterial;
  private caCertPem?: string;
  private listeners: ((m: TlsMaterial) => void)[] = [];
  private timer?: NodeJS.Timeout;
  private lastError?: string;
  private readonly acme?: AcmeSettings;
  private acmeClient?: AcmeClient;
  private dnsSolver?: DnsSolver;
  private challengeServer?: Server;
  private readonly httpTokens = new Map<string, string>();
  private acmeStatus: AcmeInfo['status'] = 'pending';
  private pendingCnames?: PendingCname[];
  private acmeTimer?: NodeJS.Timeout;
  private nextAttempt?: Date;
  private failures = 0;
  private issuing = false;
  private stopped = false;

  constructor(opts: TlsManagerOptions) {
    this.mode = opts.mode;
    this.store = opts.store;
    this.names = unique(opts.names.map(n => n.toLowerCase()));
    this.caPermitted = unique((opts.caPermitted?.length ? opts.caPermitted : this.names).map(n => n.toLowerCase()));
    this.leafDays = opts.leafDays ?? 397;
    this.certFile = opts.certFile;
    this.keyFile = opts.keyFile;
    this.acme = opts.acme;
    if (this.mode === 'acme' && !this.acme) throw new Error('TLS_MODE=acme needs ACME settings');
  }

  /** Current certificate + key (undefined in 'off' mode). */
  current(): TlsMaterial | undefined {
    return this.material;
  }

  /** Root CA certificate (PEM) in internal mode. */
  caPem(): string | undefined {
    return this.caCertPem;
  }

  /**
   * Cheap sanity check that a TLS_MODE=file certificate could be publicly trusted (the chain
   * to a public root cannot be verified offline): not self-signed, not expired, covers the host.
   * Returns a description of the problem, or undefined if nothing looks wrong.
   */
  publicTrustProblem(host: string): string | undefined {
    if (this.mode === 'acme') {
      if (this.acme!.staging || this.acme!.directoryUrl === LETSENCRYPT_STAGING) return "it comes from Let's Encrypt staging (ACME_STAGING=true), which is not trusted";
      const dirHost = new URL(this.acme!.directoryUrl).hostname;
      if (!PUBLIC_ACME_HOSTS.includes(dirHost)) return `it is issued by a custom ACME CA (${dirHost}) that may not be publicly trusted`;
      const covers = (d: string) => d === host || (d.startsWith('*.') && host.endsWith(d.slice(1)) && host.split('.').length === d.split('.').length);
      if (!this.acme!.domains.some(covers)) {
        return `ACME_DOMAINS does not include ${host}`;
      }
      return undefined;
    }
    if (this.mode !== 'file' || !this.material) return undefined;
    let cert: X509Certificate;
    try {
      cert = new X509Certificate(this.material.cert);
    } catch {
      return 'the certificate file could not be parsed';
    }
    if (cert.subject === cert.issuer) return 'it is self-signed';
    if (Date.parse(cert.validTo) < Date.now()) return 'it has expired';
    if (!cert.checkHost(host)) return `it does not cover ${host}`;
    return undefined;
  }

  onChange(listener: (m: TlsMaterial) => void): void {
    this.listeners.push(listener);
  }

  info(): TlsInfo {
    const tls = this.store.getTls();
    return {
      mode: this.mode,
      names: this.names,
      ...(this.mode === 'internal' && tls.ca ? { ca: { ...summarize(tls.ca.certPem), permitted: tls.ca.permitted } } : {}),
      ...(this.material ? { leaf: summarize(this.material.cert) } : {}),
      ...(this.mode === 'file' ? { certFile: this.certFile, keyFile: this.keyFile } : {}),
      ...(this.mode === 'acme' ? {
        acme: {
          directoryUrl: this.acme!.directoryUrl,
          staging: this.acme!.staging,
          challenge: this.acme!.challenge,
          dnsProvider: this.acme!.dnsProvider,
          domains: this.acme!.domains,
          status: this.acmeStatus,
          ...(this.pendingCnames?.length ? { pendingCnames: this.pendingCnames } : {}),
          ...(this.nextAttempt ? { nextAttempt: this.nextAttempt.toISOString() } : {}),
          ...(this.acme!.challenge === 'http-01' ? { httpPort: this.acme!.httpPort } : {}),
        },
      } : {}),
      ...(this.lastError ? { lastError: this.lastError } : {}),
    };
  }

  async init(): Promise<void> {
    if (this.mode === 'off') return;
    if (this.mode === 'file') {
      if (!this.certFile || !this.keyFile) throw new Error('TLS_MODE=file requires TLS_CERT_FILE and TLS_KEY_FILE');
      this.material = loadFiles(this.certFile, this.keyFile);
      for (const f of [this.certFile, this.keyFile]) watchFile(f, { interval: 5000 }, () => this.reloadFiles());
      return;
    }
    if (this.mode === 'acme') {
      await this.initAcme();
      return;
    }
    await this.ensureInternal();
    // Check for renewal regularly (more often for short test lifetimes)
    const interval = Math.max(1000, Math.min(12 * 3600_000, (this.leafDays * DAY_MS) / 10));
    this.timer = setInterval(() => {
      this.ensureInternal().catch(err => {
        this.lastError = `Certificate renewal failed: ${err instanceof Error ? err.message : String(err)}`;
        console.error(this.lastError);
      });
    }, interval);
    this.timer.unref();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.acmeTimer) clearTimeout(this.acmeTimer);
    this.challengeServer?.close();
    if (this.certFile) unwatchFile(this.certFile);
    if (this.keyFile) unwatchFile(this.keyFile);
  }

  private emit(): void {
    if (!this.material) return;
    for (const l of this.listeners) l(this.material);
  }

  private reloadFiles(): void {
    try {
      const next = loadFiles(this.certFile!, this.keyFile!);
      if (next.cert === this.material?.cert && next.key === this.material?.key) return;
      this.material = next;
      this.lastError = undefined;
      console.error(`TLS certificate reloaded from ${this.certFile}`);
      this.emit();
    } catch (err) {
      // Files may be mid-write - keep serving the old certificate
      this.lastError = `Could not reload certificate files: ${err instanceof Error ? err.message : String(err)}`;
      console.error(this.lastError);
    }
  }

  // ----- ACME (Let's Encrypt) -----

  private async initAcme(): Promise<void> {
    const a = this.acme!;
    const tls = this.store.getTls();
    let state = tls.acme;
    if (!state || state.directoryUrl !== a.directoryUrl) {
      // New CA (or staging -> production): new account, keep acme-dns registrations
      state = { directoryUrl: a.directoryUrl, accountKeyPem: await generateKeyPem(), acmeDns: state?.acmeDns };
      this.saveAcme(state);
    }
    const saveState = (st: AcmeState) => this.saveAcme(st);
    const log = (m: string) => console.error(`ACME: ${m}`);
    this.acmeClient = new AcmeClient({ settings: a, state: state as AcmeState, saveState, log, httpTokens: this.httpTokens });
    this.dnsSolver = createDnsSolver(a, state as AcmeState, saveState, log);

    const cert = state.cert;
    if (cert && cert.directoryUrl === a.directoryUrl && sameSet(cert.sans, a.domains) && Date.parse(new X509Certificate(cert.certPem).validTo) > Date.now()) {
      this.material = { cert: cert.certPem, key: cert.keyPem };
      this.acmeStatus = 'valid';
    } else {
      // Serve a temporary self-signed certificate until the CA has issued the real one
      this.material = await createSelfSigned(a.domains);
      this.acmeStatus = 'pending';
    }
    if (a.challenge === 'http-01') this.challengeServer = await startChallengeServer(a, this.httpTokens);
    this.scheduleAcme(0);
  }

  private saveAcme(state: NonNullable<StoredTls['acme']>): void {
    this.store.setTls({ ...this.store.getTls(), acme: state });
  }

  private scheduleAcme(ms: number): void {
    if (this.stopped) return;
    if (this.acmeTimer) clearTimeout(this.acmeTimer);
    this.nextAttempt = new Date(Date.now() + ms);
    this.acmeTimer = setTimeout(() => void this.acmeTick(), ms);
    this.acmeTimer.unref();
  }

  private needsAcmeCert(): boolean {
    const cert = this.store.getTls().acme?.cert;
    if (!cert || cert.directoryUrl !== this.acme!.directoryUrl || !sameSet(cert.sans, this.acme!.domains)) return true;
    const c = new X509Certificate(cert.certPem);
    const from = Date.parse(c.validFrom);
    const to = Date.parse(c.validTo);
    // Renew when a third of the lifetime is left (30 days for a 90-day certificate)
    return to - Date.now() < (to - from) / 3;
  }

  /** Issue or renew when needed. Exposed for tests. */
  async acmeTick(): Promise<void> {
    if (this.issuing || this.stopped) return;
    this.issuing = true;
    try {
      if (!this.needsAcmeCert()) {
        this.acmeStatus = 'valid';
        this.scheduleAcme(12 * 3600_000);
        return;
      }
      // acme-dns: the one-time CNAME must exist first - checking is free, asking the CA is not
      if (this.dnsSolver?.pendingSetup) {
        this.pendingCnames = await this.dnsSolver.pendingSetup();
        if (this.pendingCnames.length) {
          this.acmeStatus = 'waiting-dns';
          this.lastError = `Waiting for DNS: create ${this.pendingCnames.map(p => `${p.name} CNAME ${p.target}`).join(' and ')} at your DNS provider`;
          console.error(`ACME: ${this.lastError}`);
          this.scheduleAcme(120_000);
          return;
        }
      }
      this.acmeStatus = 'issuing';
      console.error(`ACME: requesting a certificate for ${this.acme!.domains.join(', ')} from ${new URL(this.acme!.directoryUrl).host} (${this.acme!.challenge}${this.acme!.dnsProvider ? ` via ${this.acme!.dnsProvider}` : ''})`);
      const issued = await this.acmeClient!.issue(this.dnsSolver);
      const acme = this.store.getTls().acme!;
      this.saveAcme({ ...acme, cert: { ...issued, sans: this.acme!.domains, directoryUrl: this.acme!.directoryUrl } });
      this.material = { cert: issued.certPem, key: issued.keyPem };
      this.acmeStatus = 'valid';
      this.lastError = undefined;
      this.failures = 0;
      console.error(`ACME: certificate issued, valid until ${new X509Certificate(issued.certPem).validTo}`);
      this.emit();
      this.scheduleAcme(12 * 3600_000);
    } catch (err) {
      this.failures++;
      // Let's Encrypt allows 5 failed validations per name per hour - back off: 15m, 30m, 1h, 2h ... 12h
      const delay = Math.min(12 * 3600_000, 15 * 60_000 * 2 ** (this.failures - 1));
      this.acmeStatus = 'error';
      this.lastError = `Certificate request failed: ${errMsg(err)}`;
      console.error(`ACME: ${this.lastError} - retrying in ${Math.round(delay / 60_000)} min`);
      this.scheduleAcme(delay);
    } finally {
      this.issuing = false;
    }
  }

  // ----- internal CA -----

  private async ensureInternal(): Promise<void> {
    let tls = this.store.getTls();
    let changed = false;

    const caValid = tls.ca
      && sameSet(tls.ca.permitted, this.caPermitted)
      && this.names.every(n => permittedBy(n, tls.ca!.permitted))
      && new Date(new X509Certificate(tls.ca.certPem).validTo).getTime() > Date.now() + 2 * this.leafDays * DAY_MS;
    if (!caValid) {
      if (tls.ca) console.error('Host names changed or CA expiring - generating a NEW local CA. Re-install the root certificate on your devices.');
      tls = { ...tls, ca: { ...(await createCa(this.caPermitted)), permitted: this.caPermitted }, leaf: undefined };
      changed = true;
    }

    const leaf = tls.leaf;
    const lifetime = this.leafDays * DAY_MS;
    const renewBefore = Math.min(30 * DAY_MS, lifetime / 3);
    const leafValid = leaf
      && sameSet(leaf.sans, this.names)
      && new X509Certificate(leaf.certPem).checkIssued(new X509Certificate(tls.ca!.certPem))
      && new Date(new X509Certificate(leaf.certPem).validTo).getTime() - Date.now() > renewBefore;
    if (!leafValid) {
      tls = { ...tls, leaf: { ...(await createLeaf(tls.ca!, this.names, this.leafDays)), sans: this.names } };
      changed = true;
    }

    if (changed) this.store.setTls(tls);
    this.caCertPem = tls.ca!.certPem;
    const next = { cert: `${tls.leaf!.certPem}${tls.ca!.certPem}`, key: tls.leaf!.keyPem };
    const isUpdate = this.material && this.material.cert !== next.cert;
    this.material = next;
    this.lastError = undefined;
    if (isUpdate) {
      console.error(`TLS server certificate renewed (valid until ${new X509Certificate(tls.leaf!.certPem).validTo})`);
      this.emit();
    }
  }
}

// ---------- helpers ----------

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every(x => b.includes(x));
}

/** Is `name` covered by a DNS/IP name constraint list? (DNS constraints include subdomains.) */
function permittedBy(name: string, permitted: string[]): boolean {
  if (isIP(name)) return permitted.includes(name);
  return permitted.some(p => !isIP(p) && (name === p || name.endsWith(`.${p}`)));
}

function serial(): string {
  const b = randomBytes(16);
  b[0] &= 0x7f; // positive
  return b.toString('hex');
}

async function exportKeyPem(key: CryptoKey): Promise<string> {
  const der = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', key));
  return `-----BEGIN PRIVATE KEY-----\n${der.toString('base64').match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`;
}

async function importKeyPem(pem: string): Promise<CryptoKey> {
  const der = Buffer.from(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64');
  return webcrypto.subtle.importKey('pkcs8', der, ALG, true, ['sign']);
}

function nameConstraintsExtension(permitted: string[]): x509.Extension {
  const subtrees = permitted.map(p => {
    const ipVersion = isIP(p);
    const base = ipVersion
      ? new GeneralName({ iPAddress: `${p}/${ipVersion === 4 ? 32 : 128}` })
      : new GeneralName({ dNSName: p });
    return new GeneralSubtree({ base });
  });
  const nc = new NameConstraints({ permittedSubtrees: new GeneralSubtrees(subtrees) });
  return new x509.Extension(id_ce_nameConstraints, true, AsnConvert.serialize(nc));
}

async function createCa(permitted: string[]): Promise<StoredKeyPair> {
  const keys = (await webcrypto.subtle.generateKey(ALG, true, ['sign', 'verify'])) as CryptoKeyPair;
  const id = randomBytes(4).toString('hex');
  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: serial(),
    name: `CN=mcp-arr local CA ${id}, O=mcp-arr`,
    notBefore: new Date(Date.now() - 3600_000),
    notAfter: new Date(Date.now() + CA_DAYS * DAY_MS),
    keys,
    signingAlgorithm: ALG,
    extensions: [
      new x509.BasicConstraintsExtension(true, 0, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign, true),
      await x509.SubjectKeyIdentifierExtension.create(keys.publicKey),
      nameConstraintsExtension(permitted),
    ],
  });
  return { certPem: cert.toString('pem') + '\n', keyPem: await exportKeyPem(keys.privateKey) };
}

/** Short-lived self-signed certificate, served while the first ACME certificate is pending. */
async function createSelfSigned(names: string[]): Promise<TlsMaterial> {
  const keys = (await webcrypto.subtle.generateKey(ALG, true, ['sign', 'verify'])) as CryptoKeyPair;
  const dnsNames = names.map(n => n.replace(/^\*\./, ''));
  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: serial(),
    name: `CN=${dnsNames[0]}, O=mcp-arr (temporary - waiting for ACME)`,
    notBefore: new Date(Date.now() - 3600_000),
    notAfter: new Date(Date.now() + 90 * DAY_MS),
    keys,
    signingAlgorithm: ALG,
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.serverAuth]),
      new x509.SubjectAlternativeNameExtension(names.map(value => ({ type: 'dns' as const, value }))),
    ],
  });
  return { cert: cert.toString('pem') + '\n', key: await exportKeyPem(keys.privateKey) };
}

async function createLeaf(ca: StoredKeyPair, names: string[], days: number): Promise<StoredKeyPair> {
  const caCert = new x509.X509Certificate(ca.certPem);
  const caKey = await importKeyPem(ca.keyPem);
  const keys = (await webcrypto.subtle.generateKey(ALG, true, ['sign', 'verify'])) as CryptoKeyPair;
  const dnsNames = names.filter(n => !isIP(n));
  const cert = await x509.X509CertificateGenerator.create({
    serialNumber: serial(),
    subject: `CN=${dnsNames[0] ?? names[0]}`,
    issuer: caCert.subject,
    notBefore: new Date(Date.now() - 3600_000),
    notAfter: new Date(Date.now() + days * DAY_MS),
    signingKey: caKey,
    publicKey: keys.publicKey,
    signingAlgorithm: ALG,
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
      new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.serverAuth]),
      new x509.SubjectAlternativeNameExtension(names.map(n => ({ type: isIP(n) ? 'ip' : 'dns', value: n }))),
      await x509.AuthorityKeyIdentifierExtension.create(caCert),
      await x509.SubjectKeyIdentifierExtension.create(keys.publicKey),
    ],
  });
  return { certPem: cert.toString('pem') + '\n', keyPem: await exportKeyPem(keys.privateKey) };
}

function loadFiles(certFile: string, keyFile: string): TlsMaterial {
  if (!existsSync(certFile)) throw new Error(`TLS_CERT_FILE ${certFile} does not exist`);
  if (!existsSync(keyFile)) throw new Error(`TLS_KEY_FILE ${keyFile} does not exist`);
  const cert = readFileSync(certFile, 'utf8');
  const key = readFileSync(keyFile, 'utf8');
  const parsed = new X509Certificate(cert);
  if (!parsed.checkPrivateKey(createPrivateKey(key))) throw new Error('TLS_KEY_FILE does not match TLS_CERT_FILE');
  return { cert, key };
}

function summarize(certPem: string): CertSummary {
  const c = new X509Certificate(certPem);
  return {
    subject: (c.subject ?? '').replace(/\n/g, ', '),
    issuer: (c.issuer ?? '').replace(/\n/g, ', '),
    notBefore: new Date(c.validFrom).toISOString(),
    notAfter: new Date(c.validTo).toISOString(),
    fingerprint256: c.fingerprint256,
    sans: (c.subjectAltName ?? '').split(',').map(s => s.trim().replace(/^(DNS|IP Address):/, '')).filter(Boolean),
  };
}
