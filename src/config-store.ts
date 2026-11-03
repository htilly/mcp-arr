/**
 * Persistent configuration store for mcp-arr.
 *
 * Service URLs / API keys can come from two places:
 *   1. Environment variables (e.g. SONARR_URL, SONARR_API_KEY) - always win and are read-only in the web UI
 *   2. A JSON config file (CONFIG_PATH) - editable through the web UI
 *
 * If CONFIG_ENCRYPTION_KEY is set, API keys are stored encrypted (AES-256-GCM) in the file.
 * Otherwise they are stored in plain text (protect the file / volume).
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type ServiceId =
  | 'sonarr'
  | 'radarr'
  | 'lidarr'
  | 'readarr'
  | 'prowlarr'
  | 'tautulli'
  | 'overseerr'
  | 'bazarr';

export interface ServiceDef {
  id: ServiceId;
  displayName: string;
  envPrefix: string;
  exampleUrl: string;
}

export const SERVICE_DEFS: ServiceDef[] = [
  { id: 'sonarr', displayName: 'Sonarr (TV)', envPrefix: 'SONARR', exampleUrl: 'http://localhost:8989' },
  { id: 'radarr', displayName: 'Radarr (Movies)', envPrefix: 'RADARR', exampleUrl: 'http://localhost:7878' },
  { id: 'lidarr', displayName: 'Lidarr (Music)', envPrefix: 'LIDARR', exampleUrl: 'http://localhost:8686' },
  { id: 'readarr', displayName: 'Readarr (Books)', envPrefix: 'READARR', exampleUrl: 'http://localhost:8787' },
  { id: 'prowlarr', displayName: 'Prowlarr (Indexers)', envPrefix: 'PROWLARR', exampleUrl: 'http://localhost:9696' },
  { id: 'tautulli', displayName: 'Tautulli (Plex)', envPrefix: 'TAUTULLI', exampleUrl: 'http://localhost:8181' },
  { id: 'overseerr', displayName: 'Overseerr (Requests)', envPrefix: 'OVERSEERR', exampleUrl: 'http://localhost:5055' },
  { id: 'bazarr', displayName: 'Bazarr (Subtitles)', envPrefix: 'BAZARR', exampleUrl: 'http://localhost:6767' },
];

export function isServiceId(value: string): value is ServiceId {
  return SERVICE_DEFS.some(d => d.id === value);
}

export type ValueSource = 'env' | 'file' | 'none';

export interface EffectiveService {
  url?: string;
  apiKey?: string;
  urlSource: ValueSource;
  apiKeySource: ValueSource;
}

export type EffectiveConfig = Record<ServiceId, EffectiveService>;

export interface StoredToken {
  id: string;
  name: string;
  hash: string; // sha256 hex of the token
  hint: string; // last 4 characters
  createdAt: string;
  lastUsedAt?: string;
}

interface StoredConfigFile {
  version: 1;
  services: Partial<Record<ServiceId, { url?: string; apiKey?: string }>>;
  admin?: { passwordHash?: string };
  tokens?: StoredToken[];
  encryption?: { salt: string; check: string };
}

const ENC_PREFIX = 'enc:v1:';
const ENC_CHECK_PLAINTEXT = 'mcp-arr-config';

function emptyConfig(): StoredConfigFile {
  return { version: 1, services: {}, tokens: [] };
}

// ---------- password / token helpers ----------

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt:${salt.toString('base64')}:${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltB64, hashB64] = stored.split(':');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(expected, actual);
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Constant-time string comparison (via hashing so lengths don't leak). */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(Buffer.from(sha256(a), 'hex'), Buffer.from(sha256(b), 'hex'));
}

// ---------- store ----------

export class ConfigStore {
  readonly path: string | undefined;
  readonly encryptionEnabled: boolean;
  private readonly encryptionSecret?: string;
  private key?: Buffer;
  private data: StoredConfigFile = emptyConfig();

  /**
   * @param path Config file path. If undefined, the store is env-only and never writes.
   * @param encryptionSecret Value of CONFIG_ENCRYPTION_KEY (optional).
   */
  constructor(path: string | undefined, encryptionSecret?: string) {
    this.path = path;
    this.encryptionSecret = encryptionSecret || undefined;
    this.encryptionEnabled = Boolean(this.encryptionSecret);
  }

  get writable(): boolean {
    return Boolean(this.path);
  }

  /** Load (or initialise) the config file. Throws with a clear message on decryption problems. */
  load(): void {
    if (!this.path || !existsSync(this.path)) {
      this.data = emptyConfig();
      if (this.encryptionSecret) this.initEncryption();
      return;
    }

    let parsed: StoredConfigFile;
    try {
      parsed = JSON.parse(readFileSync(this.path, 'utf8')) as StoredConfigFile;
    } catch (error) {
      throw new Error(`Could not read config file ${this.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.data = { ...emptyConfig(), ...parsed, services: parsed.services ?? {}, tokens: parsed.tokens ?? [] };

    const hasEncryptedValues = Object.values(this.data.services).some(s => s?.apiKey?.startsWith(ENC_PREFIX));

    if (!this.encryptionSecret) {
      if (hasEncryptedValues || this.data.encryption) {
        throw new Error(
          `Config file ${this.path} contains encrypted API keys, but CONFIG_ENCRYPTION_KEY is not set. ` +
          `Set CONFIG_ENCRYPTION_KEY to the key used when the keys were saved.`
        );
      }
      return;
    }

    if (this.data.encryption) {
      this.key = scryptSync(this.encryptionSecret, Buffer.from(this.data.encryption.salt, 'base64'), 32);
      let check: string | undefined;
      try {
        check = this.decrypt(this.data.encryption.check);
      } catch {
        check = undefined;
      }
      if (check !== ENC_CHECK_PLAINTEXT) {
        throw new Error(`CONFIG_ENCRYPTION_KEY does not match the key used to encrypt ${this.path}.`);
      }
    } else {
      this.initEncryption();
    }

    // Migrate any plain-text API keys to encrypted form
    const hasPlainValues = Object.values(this.data.services).some(s => s?.apiKey && !s.apiKey.startsWith(ENC_PREFIX));
    if (hasPlainValues) {
      for (const svc of Object.values(this.data.services)) {
        if (svc?.apiKey && !svc.apiKey.startsWith(ENC_PREFIX)) svc.apiKey = this.encrypt(svc.apiKey);
      }
      this.save();
    } else if (!parsed.encryption) {
      this.save();
    }
  }

  private initEncryption(): void {
    const salt = randomBytes(16);
    this.key = scryptSync(this.encryptionSecret!, salt, 32);
    this.data.encryption = { salt: salt.toString('base64'), check: this.encrypt(ENC_CHECK_PLAINTEXT) };
  }

  private encrypt(plain: string): string {
    if (!this.key) return plain;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${ENC_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
  }

  private decrypt(value: string): string {
    if (!value.startsWith(ENC_PREFIX)) return value;
    if (!this.key) throw new Error('Encrypted value but no encryption key');
    const [ivB64, tagB64, ctB64] = value.slice(ENC_PREFIX.length).split(':');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
  }

  save(): void {
    if (!this.path) throw new Error('No config file configured (set CONFIG_PATH)');
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    renameSync(tmp, this.path);
  }

  // ----- services -----

  getEffective(): EffectiveConfig {
    const result = {} as EffectiveConfig;
    for (const def of SERVICE_DEFS) {
      const envUrl = process.env[`${def.envPrefix}_URL`] || undefined;
      const envKey = process.env[`${def.envPrefix}_API_KEY`] || undefined;
      const stored = this.data.services[def.id] ?? {};
      const fileUrl = stored.url || undefined;
      const fileKey = stored.apiKey ? this.decrypt(stored.apiKey) : undefined;
      result[def.id] = {
        url: envUrl ?? fileUrl,
        apiKey: envKey ?? fileKey,
        urlSource: envUrl ? 'env' : fileUrl ? 'file' : 'none',
        apiKeySource: envKey ? 'env' : fileKey ? 'file' : 'none',
      };
    }
    return result;
  }

  /**
   * Update a service in the config file.
   * - url: '' clears, undefined leaves unchanged
   * - apiKey: '' clears, undefined leaves unchanged
   */
  setService(id: ServiceId, update: { url?: string; apiKey?: string }): void {
    const current = { ...(this.data.services[id] ?? {}) };
    if (update.url !== undefined) {
      const url = update.url.trim().replace(/\/+$/, '');
      if (url) {
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          throw new Error('Invalid URL');
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('URL must start with http:// or https://');
        current.url = url;
      } else {
        delete current.url;
      }
    }
    if (update.apiKey !== undefined) {
      const key = update.apiKey.trim();
      if (key) current.apiKey = this.encrypt(key);
      else delete current.apiKey;
    }
    if (current.url || current.apiKey) this.data.services[id] = current;
    else delete this.data.services[id];
    this.save();
  }

  // ----- admin password -----

  getAdminPasswordHash(): string | undefined {
    return this.data.admin?.passwordHash;
  }

  setAdminPassword(password: string): void {
    this.data.admin = { ...(this.data.admin ?? {}), passwordHash: hashPassword(password) };
    this.save();
  }

  // ----- MCP access tokens -----

  listTokens(): Omit<StoredToken, 'hash'>[] {
    return (this.data.tokens ?? []).map(({ hash: _hash, ...rest }) => rest);
  }

  hasTokens(): boolean {
    return (this.data.tokens ?? []).length > 0;
  }

  /** Create a new token. Returns the plain token (only shown once). */
  createToken(name: string): { token: string; info: Omit<StoredToken, 'hash'> } {
    const token = `marr_${randomBytes(24).toString('base64url')}`;
    const entry: StoredToken = {
      id: randomUUID(),
      name: name.trim().slice(0, 64) || 'MCP client',
      hash: sha256(token),
      hint: token.slice(-4),
      createdAt: new Date().toISOString(),
    };
    this.data.tokens = [...(this.data.tokens ?? []), entry];
    this.save();
    const { hash: _hash, ...info } = entry;
    return { token, info };
  }

  deleteToken(id: string): boolean {
    const before = this.data.tokens?.length ?? 0;
    this.data.tokens = (this.data.tokens ?? []).filter(t => t.id !== id);
    if (this.data.tokens.length === before) return false;
    this.save();
    return true;
  }

  /** Check a presented token against stored tokens; updates lastUsedAt (throttled). */
  verifyToken(token: string): boolean {
    const hash = sha256(token);
    const entry = (this.data.tokens ?? []).find(t =>
      timingSafeEqual(Buffer.from(t.hash, 'hex'), Buffer.from(hash, 'hex'))
    );
    if (!entry) return false;
    const now = Date.now();
    if (!entry.lastUsedAt || now - Date.parse(entry.lastUsedAt) > 60_000) {
      entry.lastUsedAt = new Date(now).toISOString();
      try {
        this.save();
      } catch {
        // non-fatal
      }
    }
    return true;
  }
}
