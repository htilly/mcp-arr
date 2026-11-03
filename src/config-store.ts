/**
 * Encrypted configuration store for mcp-arr.
 *
 * The whole config file is encrypted at rest with AES-256-GCM: service URLs and API keys,
 * users and their passkey credentials, invites, MCP access-token hashes and the private keys
 * of the built-in certificate authority. Plaintext is only ever held in memory.
 *
 * Encryption key sources (first match wins):
 *   1. CONFIG_ENCRYPTION_KEY       - passphrase (scrypt-derived key)
 *   2. CONFIG_ENCRYPTION_KEY_FILE  - file containing the passphrase (e.g. a Docker secret)
 *   3. KEY_FILE_PATH               - auto-generated random key file (fallback, created on first run)
 *
 * If a provided passphrase can't decrypt the file, CONFIG_ENCRYPTION_KEY_PREVIOUS and the auto key
 * file are tried; on success the file is re-encrypted with the current key (key migration/rotation).
 *
 * Service URLs / API keys from environment variables (e.g. SONARR_URL) always win over the file and
 * are read-only in the web UI.
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
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type ServiceId =
  | 'sonarr'
  | 'radarr'
  | 'lidarr'
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

export type Role = 'admin' | 'user';

export interface StoredCredential {
  id: string; // base64url credential ID
  publicKey: string; // base64url COSE public key
  counter: number;
  transports?: string[];
  name: string;
  createdAt: string;
  lastUsedAt?: string;
}

export interface StoredUser {
  id: string;
  handle: string; // base64url WebAuthn user handle (random, not personally identifying)
  name: string;
  role: Role;
  createdAt: string;
  credentials: StoredCredential[];
  passwordHash?: string; // "scrypt$<salt b64>$<hash b64>" - optional name/password sign-in
}

export interface StoredInvite {
  id: string;
  hash: string; // sha256 hex of the invite token
  role: Role;
  createdBy: string; // user id
  createdAt: string;
  expiresAt: string;
}

export interface StoredToken {
  id: string;
  userId: string;
  name: string;
  hash: string; // sha256 hex of the token
  hint: string; // last 4 characters
  createdAt: string;
  lastUsedAt?: string;
  /** OAuth access tokens expire; manually created tokens never do. */
  expiresAt?: string;
  /** Set for tokens issued through OAuth (the registered client). */
  clientId?: string;
}

export interface StoredOAuthClient {
  id: string;
  name: string;
  redirectUris: string[];
  /** sha256 of the client secret; absent for public clients (PKCE only). */
  secretHash?: string;
  createdAt: string;
}

export interface StoredRefreshToken {
  hash: string;
  tokenId: string; // the access token it currently belongs to
  userId: string;
  clientId: string;
  createdAt: string;
  expiresAt: string;
}

export interface StoredKeyPair {
  certPem: string;
  keyPem: string;
}

export interface StoredTls {
  ca?: StoredKeyPair & { permitted: string[] };
  leaf?: StoredKeyPair & { sans: string[] };
}

interface ConfigData {
  services: Partial<Record<ServiceId, { url?: string; apiKey?: string }>>;
  users: StoredUser[];
  invites: StoredInvite[];
  tokens: StoredToken[];
  tls: StoredTls;
  oauthClients: StoredOAuthClient[];
  oauthRefresh: StoredRefreshToken[];
}

interface EncryptedEnvelope {
  format: 'mcp-arr-config';
  version: 2;
  kdf: 'scrypt' | 'raw';
  salt?: string;
  iv: string;
  tag: string;
  data: string;
}

export type KeySource = 'env' | 'env-file' | 'key-file';

const AAD = Buffer.from('mcp-arr-config-v2');
const SCRYPT_PARAMS = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 256;
const PASSWORD_SCRYPT = { N: 1 << 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32, PASSWORD_SCRYPT);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function checkPassword(password: string, stored: string | undefined): boolean {
  const [kind, saltB64, hashB64] = (stored ?? '').split('$');
  if (kind !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, PASSWORD_SCRYPT);
  return timingSafeEqual(actual, expected);
}

const DUMMY_PASSWORD_HASH = hashPassword(randomBytes(16).toString('hex'));

export function validatePassword(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH) throw new Error(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
  if (password.length > PASSWORD_MAX_LENGTH) throw new Error('Password is too long');
}

function emptyData(): ConfigData {
  return { services: {}, users: [], invites: [], tokens: [], tls: {}, oauthClients: [], oauthRefresh: [] };
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Constant-time string comparison (via hashing so lengths don't leak). */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(Buffer.from(sha256(a), 'hex'), Buffer.from(sha256(b), 'hex'));
}

function hashMatches(hashHex: string, value: string): boolean {
  const a = Buffer.from(hashHex, 'hex');
  const b = Buffer.from(sha256(value), 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

interface KeyCandidate {
  source: KeySource | 'previous';
  kind: 'passphrase' | 'raw';
  secret: Buffer; // passphrase bytes or raw 32-byte key
}

export interface ConfigStoreOptions {
  path?: string;
  /** Create the auto key file if no key is configured (HTTP mode). */
  allowAutoKey: boolean;
  env?: NodeJS.ProcessEnv;
}

export class ConfigStore {
  readonly path: string | undefined;
  readonly keyFilePath: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly allowAutoKey: boolean;
  private data: ConfigData = emptyData();
  private key?: Buffer;
  private kdf: 'scrypt' | 'raw' = 'raw';
  private salt?: Buffer;
  private _keySource?: KeySource;
  private _warnings: string[] = [];

  constructor(opts: ConfigStoreOptions) {
    this.path = opts.path;
    this.env = opts.env ?? process.env;
    this.allowAutoKey = opts.allowAutoKey;
    this.keyFilePath = this.env.KEY_FILE_PATH || resolve(process.cwd(), 'secrets', 'master.key');
  }

  get writable(): boolean {
    return Boolean(this.path);
  }

  get keySource(): KeySource | undefined {
    return this._keySource;
  }

  get warnings(): string[] {
    return [...this._warnings];
  }

  // ---------- key handling ----------

  private providedKey(): KeyCandidate | undefined {
    if (this.env.CONFIG_ENCRYPTION_KEY) {
      return { source: 'env', kind: 'passphrase', secret: Buffer.from(this.env.CONFIG_ENCRYPTION_KEY, 'utf8') };
    }
    if (this.env.CONFIG_ENCRYPTION_KEY_FILE) {
      const file = this.env.CONFIG_ENCRYPTION_KEY_FILE;
      if (!existsSync(file)) throw new Error(`CONFIG_ENCRYPTION_KEY_FILE ${file} does not exist`);
      const value = readFileSync(file, 'utf8').trim();
      if (!value) throw new Error(`CONFIG_ENCRYPTION_KEY_FILE ${file} is empty`);
      return { source: 'env-file', kind: 'passphrase', secret: Buffer.from(value, 'utf8') };
    }
    return undefined;
  }

  private keyFileKey(): KeyCandidate | undefined {
    if (!existsSync(this.keyFilePath)) return undefined;
    const raw = Buffer.from(readFileSync(this.keyFilePath, 'utf8').trim(), 'base64');
    if (raw.length !== 32) throw new Error(`Key file ${this.keyFilePath} is invalid (expected 32 random bytes, base64)`);
    return { source: 'key-file', kind: 'raw', secret: raw };
  }

  private createKeyFile(): KeyCandidate {
    mkdirSync(dirname(this.keyFilePath), { recursive: true, mode: 0o700 });
    const raw = randomBytes(32);
    writeFileAtomic(this.keyFilePath, raw.toString('base64') + '\n');
    return { source: 'key-file', kind: 'raw', secret: raw };
  }

  private deriveKey(candidate: KeyCandidate, salt?: Buffer): Buffer {
    if (candidate.kind === 'raw') return candidate.secret;
    if (!salt) throw new Error('Missing salt');
    return scryptSync(candidate.secret, salt, 32, SCRYPT_PARAMS);
  }

  /** Use the candidate as the active key for future saves. */
  private activate(candidate: KeyCandidate): void {
    if (candidate.kind === 'raw') {
      this.kdf = 'raw';
      this.salt = undefined;
      this.key = candidate.secret;
    } else {
      this.kdf = 'scrypt';
      this.salt = randomBytes(16);
      this.key = this.deriveKey(candidate, this.salt);
    }
    this._keySource = candidate.source === 'previous' ? 'env' : candidate.source;
    this._warnings = [];
    if (this._keySource === 'key-file') {
      this._warnings.push(
        `The encryption key is an auto-generated key file (${this.keyFilePath}). ` +
        'Anyone who can read both this file and the config file can decrypt it. ' +
        'Keep it on a separate volume, or set CONFIG_ENCRYPTION_KEY / CONFIG_ENCRYPTION_KEY_FILE (e.g. a Docker secret).'
      );
      if (this.path && dirname(resolve(this.keyFilePath)) === dirname(resolve(this.path))) {
        this._warnings.push('The key file is in the same directory as the config file - move it to a separate volume (KEY_FILE_PATH).');
      }
    }
  }

  // ---------- load / save ----------

  /** Load the config file (or initialise an empty one). Throws with a clear message on key problems. */
  load(): void {
    const provided = this.providedKey();

    if (!this.path || !existsSync(this.path)) {
      this.data = emptyData();
      if (provided) this.activate(provided);
      else if (this.allowAutoKey) this.activate(this.keyFileKey() ?? this.createKeyFile());
      return;
    }

    let envelope: EncryptedEnvelope;
    try {
      envelope = JSON.parse(readFileSync(this.path, 'utf8')) as EncryptedEnvelope;
    } catch (error) {
      throw new Error(`Could not read config file ${this.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (envelope.format !== 'mcp-arr-config' || envelope.version !== 2) {
      throw new Error(`Config file ${this.path} has an unknown format. Move it away to start with a fresh configuration.`);
    }

    // Candidate keys, in order of preference
    const candidates: KeyCandidate[] = [];
    if (provided) candidates.push(provided);
    if (this.env.CONFIG_ENCRYPTION_KEY_PREVIOUS) {
      candidates.push({ source: 'previous', kind: 'passphrase', secret: Buffer.from(this.env.CONFIG_ENCRYPTION_KEY_PREVIOUS, 'utf8') });
    }
    const fileKey = this.keyFileKey();
    if (fileKey) candidates.push(fileKey);
    if (candidates.length === 0) {
      throw new Error(
        `Config file ${this.path} is encrypted but no key is available. Set CONFIG_ENCRYPTION_KEY or ` +
        `CONFIG_ENCRYPTION_KEY_FILE, or restore the key file ${this.keyFilePath}.`
      );
    }

    for (const candidate of candidates) {
      if ((envelope.kdf === 'raw') !== (candidate.kind === 'raw')) continue;
      const salt = envelope.salt ? Buffer.from(envelope.salt, 'base64') : undefined;
      let plain: string;
      try {
        plain = decrypt(envelope, this.deriveKey(candidate, salt));
      } catch {
        continue;
      }
      this.data = { ...emptyData(), ...(JSON.parse(plain) as Partial<ConfigData>) };
      const active = provided ?? candidate;
      this.activate(active);
      if (candidate !== active) {
        this.save();
        console.error(`Config file re-encrypted with the key from ${describeSource(active.source)}.`);
      } else if (candidate.kind === 'passphrase') {
        // keep the existing salt so the derived key matches the file
        this.salt = salt;
        this.key = this.deriveKey(candidate, salt);
      }
      return;
    }

    throw new Error(
      `Could not decrypt ${this.path}: the encryption key does not match ` +
      `(tried ${candidates.map(c => describeSource(c.source)).join(', ')}). ` +
      'Set CONFIG_ENCRYPTION_KEY to the key used when the file was written ' +
      '(to change keys, set the old one as CONFIG_ENCRYPTION_KEY_PREVIOUS).'
    );
  }

  save(): void {
    if (!this.path) throw new Error('No config file configured (set CONFIG_PATH)');
    if (!this.key) throw new Error('No encryption key available');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(AAD);
    const ct = Buffer.concat([cipher.update(JSON.stringify(this.data), 'utf8'), cipher.final()]);
    const envelope: EncryptedEnvelope = {
      format: 'mcp-arr-config',
      version: 2,
      kdf: this.kdf,
      ...(this.salt ? { salt: this.salt.toString('base64') } : {}),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: ct.toString('base64'),
    };
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    writeFileAtomic(this.path, JSON.stringify(envelope));
  }

  // ---------- services ----------

  getEffective(): EffectiveConfig {
    const result = {} as EffectiveConfig;
    for (const def of SERVICE_DEFS) {
      const envUrl = this.env[`${def.envPrefix}_URL`] || undefined;
      const envKey = this.env[`${def.envPrefix}_API_KEY`] || undefined;
      const stored = this.data.services[def.id] ?? {};
      result[def.id] = {
        url: envUrl ?? (stored.url || undefined),
        apiKey: envKey ?? (stored.apiKey || undefined),
        urlSource: envUrl ? 'env' : stored.url ? 'file' : 'none',
        apiKeySource: envKey ? 'env' : stored.apiKey ? 'file' : 'none',
      };
    }
    return result;
  }

  /** url/apiKey: '' clears, undefined leaves unchanged. */
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
      if (key) current.apiKey = key;
      else delete current.apiKey;
    }
    if (current.url || current.apiKey) this.data.services[id] = current;
    else delete this.data.services[id];
    this.save();
  }

  // ---------- users & passkeys ----------

  listUsers(): StoredUser[] {
    return this.data.users;
  }

  getUser(id: string): StoredUser | undefined {
    return this.data.users.find(u => u.id === id);
  }

  getUserByHandle(handle: string): StoredUser | undefined {
    return this.data.users.find(u => u.handle === handle);
  }

  findCredential(credentialId: string): { user: StoredUser; credential: StoredCredential } | undefined {
    for (const user of this.data.users) {
      const credential = user.credentials.find(c => c.id === credentialId);
      if (credential) return { user, credential };
    }
    return undefined;
  }

  adminCount(): number {
    return this.data.users.filter(u => u.role === 'admin').length;
  }

  isNameTaken(name: string): boolean {
    const lower = cleanName(name, 'User').toLowerCase();
    return this.data.users.some(u => u.name.toLowerCase() === lower);
  }

  private assertNameFree(name: string, exceptId?: string): void {
    const lower = name.toLowerCase();
    if (this.data.users.some(u => u.id !== exceptId && u.name.toLowerCase() === lower)) {
      throw new Error('That name is already taken');
    }
  }

  /** Create a user with a passkey credential and/or a password (at least one). */
  createUser(
    name: string,
    role: Role,
    credential: Omit<StoredCredential, 'createdAt'> | undefined,
    handle: string,
    password?: string
  ): StoredUser {
    if (!credential && password === undefined) throw new Error('A passkey or password is required');
    const cleaned = cleanName(name, 'User');
    this.assertNameFree(cleaned);
    if (password !== undefined) validatePassword(password);
    const user: StoredUser = {
      id: randomUUID(),
      handle,
      name: cleaned,
      role,
      createdAt: new Date().toISOString(),
      credentials: credential ? [{ ...credential, createdAt: new Date().toISOString() }] : [],
      ...(password !== undefined ? { passwordHash: hashPassword(password) } : {}),
    };
    this.data.users.push(user);
    this.save();
    return user;
  }

  setPassword(userId: string, password: string): void {
    validatePassword(password);
    this.requireUser(userId).passwordHash = hashPassword(password);
    this.save();
  }

  clearPassword(userId: string): void {
    const user = this.requireUser(userId);
    if (user.credentials.length === 0) throw new Error('Add a passkey before removing your password');
    user.passwordHash = undefined;
    this.save();
  }

  /** Check name + password. Always spends the same hashing work so unknown names are not detectable by timing. */
  verifyPassword(name: string, password: string): StoredUser | undefined {
    const lower = name.trim().toLowerCase();
    const user = this.data.users.find(u => u.passwordHash && u.name.toLowerCase() === lower);
    const ok = checkPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
    return user && ok ? user : undefined;
  }

  addCredential(userId: string, credential: Omit<StoredCredential, 'createdAt'>): void {
    const user = this.requireUser(userId);
    user.credentials.push({ ...credential, name: cleanName(credential.name, 'Passkey'), createdAt: new Date().toISOString() });
    this.save();
  }

  touchCredential(userId: string, credentialId: string, counter: number): void {
    const cred = this.requireUser(userId).credentials.find(c => c.id === credentialId);
    if (!cred) return;
    cred.counter = counter;
    cred.lastUsedAt = new Date().toISOString();
    this.save();
  }

  renameCredential(userId: string, credentialId: string, name: string): void {
    const cred = this.requireUser(userId).credentials.find(c => c.id === credentialId);
    if (!cred) throw new Error('Passkey not found');
    cred.name = cleanName(name, 'Passkey');
    this.save();
  }

  removeCredential(userId: string, credentialId: string): void {
    const user = this.requireUser(userId);
    if (!user.credentials.some(c => c.id === credentialId)) throw new Error('Passkey not found');
    if (user.credentials.length <= 1 && !user.passwordHash) throw new Error('You cannot remove your last passkey (set a password first)');
    user.credentials = user.credentials.filter(c => c.id !== credentialId);
    this.save();
  }

  setUserRole(userId: string, role: Role): void {
    const user = this.requireUser(userId);
    if (user.role === 'admin' && role !== 'admin' && this.adminCount() <= 1) throw new Error('There must be at least one admin');
    user.role = role;
    this.save();
  }

  renameUser(userId: string, name: string): void {
    const cleaned = cleanName(name, 'User');
    this.assertNameFree(cleaned, userId);
    this.requireUser(userId).name = cleaned;
    this.save();
  }

  /** Delete a user and everything they own (tokens, invites they created stay valid only if unexpired). */
  deleteUser(userId: string): void {
    const user = this.requireUser(userId);
    if (user.role === 'admin' && this.adminCount() <= 1) throw new Error('There must be at least one admin');
    this.data.users = this.data.users.filter(u => u.id !== userId);
    this.data.tokens = this.data.tokens.filter(t => t.userId !== userId);
    this.data.oauthRefresh = this.data.oauthRefresh.filter(r => r.userId !== userId);
    this.save();
  }

  private requireUser(userId: string): StoredUser {
    const user = this.getUser(userId);
    if (!user) throw new Error('User not found');
    return user;
  }

  // ---------- invites ----------

  createInvite(role: Role, createdBy: string, ttlHours = 24): { token: string; invite: StoredInvite } {
    this.pruneInvites();
    const token = randomBytes(24).toString('base64url');
    const invite: StoredInvite = {
      id: randomUUID(),
      hash: sha256(token),
      role,
      createdBy,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + ttlHours * 3600_000).toISOString(),
    };
    this.data.invites.push(invite);
    this.save();
    return { token, invite };
  }

  listInvites(): StoredInvite[] {
    return this.data.invites.filter(i => Date.parse(i.expiresAt) > Date.now());
  }

  findInvite(token: string): StoredInvite | undefined {
    return this.listInvites().find(i => hashMatches(i.hash, token));
  }

  deleteInvite(id: string): boolean {
    const before = this.data.invites.length;
    this.data.invites = this.data.invites.filter(i => i.id !== id);
    if (this.data.invites.length === before) return false;
    this.save();
    return true;
  }

  private pruneInvites(): void {
    this.data.invites = this.listInvites();
  }

  // ---------- MCP access tokens ----------

  listTokens(userId?: string): Omit<StoredToken, 'hash'>[] {
    return this.data.tokens
      .filter(t => !userId || t.userId === userId)
      .map(({ hash: _hash, ...rest }) => rest);
  }

  createToken(userId: string, name: string): { token: string; info: Omit<StoredToken, 'hash'> } {
    this.requireUser(userId);
    const token = `marr_${randomBytes(24).toString('base64url')}`;
    const entry: StoredToken = {
      id: randomUUID(),
      userId,
      name: cleanName(name, 'MCP client'),
      hash: sha256(token),
      hint: token.slice(-4),
      createdAt: new Date().toISOString(),
    };
    this.data.tokens.push(entry);
    this.save();
    const { hash: _hash, ...info } = entry;
    return { token, info };
  }

  /** Delete a token. If ownerId is given, only that user's token can be deleted. */
  deleteToken(id: string, ownerId?: string): boolean {
    const before = this.data.tokens.length;
    this.data.tokens = this.data.tokens.filter(t => !(t.id === id && (!ownerId || t.userId === ownerId)));
    if (this.data.tokens.length === before) return false;
    this.data.oauthRefresh = this.data.oauthRefresh.filter(r => r.tokenId !== id);
    this.save();
    return true;
  }

  /** Returns the owning user if the token is valid. Updates lastUsedAt (throttled). */
  verifyToken(token: string): StoredUser | undefined {
    return this.resolveToken(token)?.user;
  }

  /** Like verifyToken, but also returns the token's name (used to attribute usage statistics). */
  resolveToken(token: string): { user: StoredUser; tokenName: string } | undefined {
    const entry = this.data.tokens.find(t => hashMatches(t.hash, token));
    if (!entry) return undefined;
    if (entry.expiresAt && Date.parse(entry.expiresAt) <= Date.now()) return undefined;
    const user = this.getUser(entry.userId);
    if (!user) return undefined;
    const now = Date.now();
    if (!entry.lastUsedAt || now - Date.parse(entry.lastUsedAt) > 60_000) {
      entry.lastUsedAt = new Date(now).toISOString();
      try {
        this.save();
      } catch {
        // non-fatal
      }
    }
    return { user, tokenName: entry.name };
  }

  // ---------- OAuth (clients, access + refresh tokens) ----------

  private static readonly MAX_OAUTH_CLIENTS = 200;

  registerOAuthClient(client: Omit<StoredOAuthClient, 'id' | 'createdAt'>): StoredOAuthClient {
    const entry: StoredOAuthClient = { ...client, id: `marr-client-${randomBytes(12).toString('base64url')}`, createdAt: new Date().toISOString() };
    this.data.oauthClients.push(entry);
    if (this.data.oauthClients.length > ConfigStore.MAX_OAUTH_CLIENTS) {
      this.data.oauthClients = this.data.oauthClients.slice(-ConfigStore.MAX_OAUTH_CLIENTS);
    }
    this.save();
    return entry;
  }

  getOAuthClient(id: string): StoredOAuthClient | undefined {
    return this.data.oauthClients.find(c => c.id === id);
  }

  /** Issue an access token (+ refresh token) for an OAuth client. */
  issueOAuthTokens(
    userId: string,
    client: StoredOAuthClient,
    ttlSeconds: number,
    refreshTtlSeconds: number,
    replaceTokenId?: string
  ): { accessToken: string; refreshToken: string } {
    this.requireUser(userId);
    if (replaceTokenId) {
      this.data.tokens = this.data.tokens.filter(t => t.id !== replaceTokenId);
    }
    const now = Date.now();
    const accessToken = `marr_${randomBytes(24).toString('base64url')}`;
    const refreshToken = `marr_rt_${randomBytes(32).toString('base64url')}`;
    const entry: StoredToken = {
      id: randomUUID(),
      userId,
      name: cleanName(`OAuth: ${client.name}`, 'OAuth client'),
      hash: sha256(accessToken),
      hint: accessToken.slice(-4),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlSeconds * 1000).toISOString(),
      clientId: client.id,
    };
    this.data.tokens.push(entry);
    this.data.oauthRefresh.push({
      hash: sha256(refreshToken),
      tokenId: entry.id,
      userId,
      clientId: client.id,
      createdAt: entry.createdAt,
      expiresAt: new Date(now + refreshTtlSeconds * 1000).toISOString(),
    });
    this.pruneOAuth();
    this.save();
    return { accessToken, refreshToken };
  }

  /** Consume a refresh token (single use). Returns its owner, or undefined if unknown/expired. */
  takeRefreshToken(refreshToken: string): StoredRefreshToken | undefined {
    const entry = this.data.oauthRefresh.find(r => hashMatches(r.hash, refreshToken));
    if (!entry) return undefined;
    this.data.oauthRefresh = this.data.oauthRefresh.filter(r => r !== entry);
    this.save();
    if (Date.parse(entry.expiresAt) <= Date.now() || !this.getUser(entry.userId)) return undefined;
    return entry;
  }

  /** Revoke an OAuth access or refresh token (RFC 7009). Unknown tokens are ignored. */
  revokeOAuthToken(token: string, clientId: string): void {
    const access = this.data.tokens.find(t => t.clientId === clientId && hashMatches(t.hash, token));
    const refresh = this.data.oauthRefresh.find(r => r.clientId === clientId && hashMatches(r.hash, token));
    const tokenId = access?.id ?? refresh?.tokenId;
    if (!tokenId) return;
    this.data.tokens = this.data.tokens.filter(t => t.id !== tokenId);
    this.data.oauthRefresh = this.data.oauthRefresh.filter(r => r.tokenId !== tokenId);
    this.save();
  }

  private pruneOAuth(): void {
    const now = Date.now();
    this.data.oauthRefresh = this.data.oauthRefresh.filter(r => Date.parse(r.expiresAt) > now);
    const live = new Set(this.data.oauthRefresh.map(r => r.tokenId));
    // expired access tokens without a live refresh token are dead weight
    this.data.tokens = this.data.tokens.filter(t => !t.expiresAt || Date.parse(t.expiresAt) > now || live.has(t.id));
  }

  // ---------- TLS material ----------

  getTls(): StoredTls {
    return this.data.tls;
  }

  setTls(tls: StoredTls): void {
    this.data.tls = tls;
    this.save();
  }
}

function decrypt(envelope: EncryptedEnvelope, key: Buffer): string {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAAD(AAD);
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8');
}

function writeFileAtomic(path: string, content: string): void {
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  const fd = openSync(tmp, 'w', 0o600);
  try {
    writeSync(fd, content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}

function cleanName(name: string | undefined, fallback: string): string {
  return (name ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 64) || fallback;
}

function describeSource(source: KeyCandidate['source']): string {
  switch (source) {
    case 'env': return 'CONFIG_ENCRYPTION_KEY';
    case 'env-file': return 'CONFIG_ENCRYPTION_KEY_FILE';
    case 'previous': return 'CONFIG_ENCRYPTION_KEY_PREVIOUS';
    case 'key-file': return 'the key file';
  }
}
