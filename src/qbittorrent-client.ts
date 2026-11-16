/**
 * qBittorrent WebUI API v2 client
 *
 * Docs: https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-5.0)
 *
 * Authentication, first match wins:
 *   1. API key (qBittorrent 5.2+, Options → WebUI → API key): sent as `Authorization: Bearer <key>`
 *      and `X-API-Key: <key>` (the latter is checked first by newer builds, so a reverse proxy can
 *      keep using the Authorization header for Basic auth). No cookie, no CSRF check, no login.
 *   2. Username + password: POST /api/v2/auth/login, keep the session cookie (named `SID` by
 *      default, but configurable, so every cookie the login sets is kept). On 403 the client logs
 *      in again once and retries.
 *   3. Nothing: for setups where qBittorrent bypasses authentication for whitelisted subnets or
 *      localhost.
 *
 * Every request carries Referer and Origin matching the configured URL, which qBittorrent's CSRF
 * protection requires for cookie sessions. Credentials and cookies never appear in error messages.
 *
 * WebAPI 2.11 (qBittorrent 5.0) renamed torrents/pause → torrents/stop and torrents/resume →
 * torrents/start. The client reads /api/v2/app/webapiVersion once and uses the right endpoint.
 */

import type { FetchLike } from './tls-trust.js';

export interface QBittorrentConfig {
  url: string;
  username?: string;
  password?: string;
  apiKey?: string;
  /** fetch to use, e.g. pinned to a self-signed certificate (tls-trust.ts). */
  fetch?: FetchLike;
}

export type QBittorrentAuthMode = 'apiKey' | 'login' | 'none';

export interface QBittorrentTransferInfo {
  dl_info_speed: number; // bytes/s
  dl_info_data: number; // bytes this session
  up_info_speed: number;
  up_info_data: number;
  dl_rate_limit: number; // bytes/s, 0 = unlimited
  up_rate_limit: number;
  dht_nodes: number;
  connection_status: 'connected' | 'firewalled' | 'disconnected' | string;
  [key: string]: unknown;
}

export type QBittorrentState =
  | 'error' | 'missingFiles' | 'uploading' | 'pausedUP' | 'stoppedUP' | 'queuedUP' | 'stalledUP'
  | 'checkingUP' | 'forcedUP' | 'allocating' | 'downloading' | 'metaDL' | 'forcedMetaDL'
  | 'pausedDL' | 'stoppedDL' | 'queuedDL' | 'stalledDL' | 'checkingDL' | 'forcedDL'
  | 'checkingResumeData' | 'moving' | 'unknown';

export interface QBittorrentTorrent {
  hash: string;
  name: string;
  state: QBittorrentState | string;
  progress: number; // 0..1
  size: number; // bytes selected for download
  total_size?: number;
  downloaded?: number;
  uploaded?: number;
  amount_left?: number;
  dlspeed: number; // bytes/s
  upspeed: number;
  eta: number; // seconds, 8640000 = infinity
  ratio: number;
  category?: string;
  tags?: string;
  added_on?: number; // unix seconds
  completion_on?: number;
  last_activity?: number; // unix seconds of last up/download activity
  time_active?: number; // seconds
  num_seeds?: number;
  num_leechs?: number;
  num_complete?: number;
  num_incomplete?: number;
  availability?: number;
  tracker?: string;
  save_path?: string;
  dl_limit?: number;
  up_limit?: number;
  force_start?: boolean;
  [key: string]: unknown;
}

export type QBittorrentFilter =
  | 'all' | 'downloading' | 'seeding' | 'completed' | 'paused' | 'stopped' | 'active' | 'inactive'
  | 'resumed' | 'running' | 'stalled' | 'stalled_uploading' | 'stalled_downloading' | 'errored';

export const QBITTORRENT_FILTERS: QBittorrentFilter[] = [
  'all', 'downloading', 'seeding', 'completed', 'paused', 'stopped', 'active', 'inactive',
  'resumed', 'running', 'stalled', 'stalled_uploading', 'stalled_downloading', 'errored',
];

export interface QBittorrentTorrentQuery {
  filter?: QBittorrentFilter;
  /** '' = torrents without a category; undefined = any category. */
  category?: string;
  tag?: string;
  sort?: string;
  reverse?: boolean;
  limit?: number;
  offset?: number;
  hashes?: string[];
}

export interface QBittorrentServerState {
  free_space_on_disk?: number;
  use_alt_speed_limits?: boolean;
  queueing?: boolean;
  [key: string]: unknown;
}

/** Infinite ETA as reported by qBittorrent. */
export const QBT_ETA_INFINITY = 8640000;

/** v1 info hashes are 40 hex chars, v2 (BitTorrent v2) 64. */
const HASH = /^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/;

/** Stuck-detection threshold: no activity for this long while incomplete counts as stuck. */
const DEFAULT_STUCK_MINUTES = 60;

type Form = Record<string, string | number | boolean | undefined>;

class QBittorrentHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export class QBittorrentClient {
  private readonly url: string;
  private readonly origin: string;
  private readonly username?: string;
  private readonly password?: string;
  private readonly apiKey?: string;
  private cookie?: string;
  private loggedIn = false;
  private loginPromise?: Promise<void>;
  private webApiVersion?: string;
  private readonly fetch: FetchLike;

  constructor(config: QBittorrentConfig) {
    this.url = config.url.replace(/\/+$/, '');
    this.origin = new URL(this.url).origin;
    this.username = config.username || undefined;
    this.password = config.password ?? undefined;
    this.apiKey = config.apiKey || undefined;
    this.fetch = config.fetch ?? fetch;
  }

  get authMode(): QBittorrentAuthMode {
    if (this.apiKey) return 'apiKey';
    if (this.username) return 'login';
    return 'none';
  }

  /** Validate and join torrent hashes; 'all' only when allowAll is set. */
  static joinHashes(hashes: string[] | 'all', allowAll: boolean): string {
    if (hashes === 'all') {
      if (!allowAll) throw new Error('"all" is not allowed here - list the torrent hashes');
      return 'all';
    }
    if (!Array.isArray(hashes) || hashes.length === 0) throw new Error('At least one torrent hash is required');
    if (hashes.length > 500) throw new Error('At most 500 torrent hashes at a time');
    for (const h of hashes) {
      if (typeof h !== 'string' || !HASH.test(h)) {
        throw new Error('Torrent hashes must be 40 or 64 hex characters (get them from qbittorrent_get_torrents)');
      }
    }
    return hashes.map(h => h.toLowerCase()).join('|');
  }

  // ---------- transport ----------

  private baseHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Referer: `${this.url}/`,
      Origin: this.origin,
      Accept: 'application/json, text/plain, */*',
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
      headers['X-API-Key'] = this.apiKey;
    } else if (this.cookie) {
      headers.Cookie = this.cookie;
    }
    return headers;
  }

  private async login(): Promise<void> {
    if (!this.loginPromise) {
      this.loginPromise = (async () => {
        const body = new URLSearchParams({ username: this.username ?? '', password: this.password ?? '' });
        const response = await this.fetch(`${this.url}/api/v2/auth/login`, {
          method: 'POST',
          headers: {
            Referer: `${this.url}/`,
            Origin: this.origin,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body,
        });
        const text = (await response.text()).trim();
        if (response.status === 403) {
          throw new QBittorrentHttpError(403, 'qBittorrent API error: 403 - login refused (too many failed attempts, this IP is banned for a while)');
        }
        if (!response.ok) {
          throw new QBittorrentHttpError(response.status, `qBittorrent API error: ${response.status} ${response.statusText} on login`);
        }
        if (text !== 'Ok.') {
          throw new QBittorrentHttpError(401, 'qBittorrent API error: 401 - login failed, check QBITTORRENT_USERNAME / QBITTORRENT_PASSWORD');
        }
        const cookies = response.headers.getSetCookie?.() ?? [];
        const pairs = cookies.map(c => c.split(';')[0].trim()).filter(p => p.includes('='));
        // "Ok." without a cookie happens when auth is bypassed for this client (whitelisted subnet).
        this.cookie = pairs.length ? pairs.join('; ') : undefined;
        this.loggedIn = true;
      })();
      this.loginPromise.catch(() => { /* handled by the awaiting caller */ }).finally(() => { this.loginPromise = undefined; });
    }
    return this.loginPromise;
  }

  private async request(method: 'GET' | 'POST', path: string, params: Form = {}, retried = false): Promise<string> {
    if (this.authMode === 'login' && !this.loggedIn && !retried) await this.login();

    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) search.append(key, String(value));
    }
    const headers = this.baseHeaders();
    let url = `${this.url}/api/v2${path}`;
    let body: URLSearchParams | undefined;
    if (method === 'GET') {
      const qs = search.toString();
      if (qs) url += `?${qs}`;
    } else {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = search;
    }

    const response = await this.fetch(url, { method, headers, body });

    if (response.status === 403 && this.authMode === 'login' && !retried) {
      // Session expired or was dropped (qBittorrent restart): log in again once.
      await response.body?.cancel();
      this.cookie = undefined;
      this.loggedIn = false;
      await this.login();
      return this.request(method, path, params, true);
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403) {
        const hint = this.authMode === 'apiKey'
          ? 'check QBITTORRENT_API_KEY'
          : this.authMode === 'login'
            ? 'check QBITTORRENT_USERNAME / QBITTORRENT_PASSWORD'
            : 'qBittorrent wants a login - set QBITTORRENT_USERNAME / QBITTORRENT_PASSWORD or QBITTORRENT_API_KEY';
        throw new QBittorrentHttpError(response.status, `qBittorrent API error: ${response.status} - ${hint}`);
      }
      if (response.status === 404) {
        throw new QBittorrentHttpError(404, `qBittorrent API error: 404 - ${path} not found (torrent unknown, or this qBittorrent version lacks the endpoint)`);
      }
      // 400/409/415 come with short plain-text reasons from qBittorrent, but never pass raw bodies on.
      throw new QBittorrentHttpError(response.status, `qBittorrent API error: ${response.status} ${response.statusText}`);
    }
    return response.text();
  }

  private async getJson<T>(path: string, params: Form = {}): Promise<T> {
    const text = await this.request('GET', path, params);
    return JSON.parse(text) as T;
  }

  private async post(path: string, params: Form = {}): Promise<void> {
    await this.request('POST', path, params);
  }

  // ---------- app ----------

  async getVersion(): Promise<string> {
    return (await this.request('GET', '/app/version')).trim();
  }

  async getWebApiVersion(): Promise<string> {
    if (!this.webApiVersion) this.webApiVersion = (await this.request('GET', '/app/webapiVersion')).trim();
    return this.webApiVersion;
  }

  /** WebAPI >= 2.11 (qBittorrent 5.0) uses torrents/stop + torrents/start instead of pause/resume. */
  async usesStopStart(): Promise<boolean> {
    const [major, minor] = (await this.getWebApiVersion()).split('.').map(n => parseInt(n, 10) || 0);
    return major > 2 || (major === 2 && minor >= 11);
  }

  // ---------- transfer ----------

  async getTransferInfo(): Promise<QBittorrentTransferInfo> {
    return this.getJson<QBittorrentTransferInfo>('/transfer/info');
  }

  /** true when the alternative ("turtle") speed limits are active. */
  async getAltSpeedLimitsEnabled(): Promise<boolean> {
    return (await this.request('GET', '/transfer/speedLimitsMode')).trim() === '1';
  }

  async setAltSpeedLimitsEnabled(enabled: boolean): Promise<void> {
    // qBittorrent 5.1 added an explicit setSpeedLimitsMode; toggling works on every version.
    if ((await this.getAltSpeedLimitsEnabled()) !== enabled) await this.post('/transfer/toggleSpeedLimitsMode');
  }

  /** Global limits in bytes/s; 0 = unlimited. */
  async setGlobalDownloadLimit(bytesPerSecond: number): Promise<void> {
    await this.post('/transfer/setDownloadLimit', { limit: Math.max(0, Math.round(bytesPerSecond)) });
  }

  async setGlobalUploadLimit(bytesPerSecond: number): Promise<void> {
    await this.post('/transfer/setUploadLimit', { limit: Math.max(0, Math.round(bytesPerSecond)) });
  }

  /** Free disk space and other session-wide state (sync/maindata server_state). */
  async getServerState(): Promise<QBittorrentServerState> {
    const data = await this.getJson<{ server_state?: QBittorrentServerState }>('/sync/maindata', { rid: 0 });
    return data.server_state ?? {};
  }

  // ---------- torrents ----------

  async getTorrents(query: QBittorrentTorrentQuery = {}): Promise<QBittorrentTorrent[]> {
    if (query.filter !== undefined && !QBITTORRENT_FILTERS.includes(query.filter)) {
      throw new Error(`filter must be one of: ${QBITTORRENT_FILTERS.join(', ')}`);
    }
    return this.getJson<QBittorrentTorrent[]>('/torrents/info', {
      filter: query.filter,
      category: query.category,
      tag: query.tag,
      sort: query.sort,
      reverse: query.reverse,
      limit: query.limit,
      offset: query.offset,
      hashes: query.hashes?.length ? QBittorrentClient.joinHashes(query.hashes, false) : undefined,
    });
  }

  async getCategories(): Promise<Record<string, { name: string; savePath?: string }>> {
    return this.getJson('/torrents/categories');
  }

  async pause(hashes: string[] | 'all'): Promise<void> {
    const joined = QBittorrentClient.joinHashes(hashes, true);
    await this.post((await this.usesStopStart()) ? '/torrents/stop' : '/torrents/pause', { hashes: joined });
  }

  async resume(hashes: string[] | 'all'): Promise<void> {
    const joined = QBittorrentClient.joinHashes(hashes, true);
    await this.post((await this.usesStopStart()) ? '/torrents/start' : '/torrents/resume', { hashes: joined });
  }

  /** Remove torrents; deleteFiles also deletes the downloaded data. 'all' is deliberately not accepted. */
  async deleteTorrents(hashes: string[], deleteFiles: boolean): Promise<void> {
    await this.post('/torrents/delete', { hashes: QBittorrentClient.joinHashes(hashes, false), deleteFiles });
  }

  async recheck(hashes: string[]): Promise<void> {
    await this.post('/torrents/recheck', { hashes: QBittorrentClient.joinHashes(hashes, false) });
  }

  async reannounce(hashes: string[]): Promise<void> {
    await this.post('/torrents/reannounce', { hashes: QBittorrentClient.joinHashes(hashes, false) });
  }

  // ---------- stuck detection ----------

  /**
   * Why a torrent looks stuck, or undefined. Stuck means one of:
   * - state error / missingFiles
   * - stalledDL (no peers sending data) or metaDL/forcedMetaDL (still fetching metadata) for longer than the threshold
   * - incomplete, not paused/stopped/queued/checking, and no activity for longer than the threshold
   */
  static stuckReason(t: QBittorrentTorrent, nowSeconds = Date.now() / 1000, thresholdMinutes = DEFAULT_STUCK_MINUTES): string | undefined {
    const threshold = thresholdMinutes * 60;
    const age = t.added_on ? nowSeconds - t.added_on : Infinity;
    const idle = t.last_activity ? nowSeconds - t.last_activity : age;
    const complete = t.progress >= 1;
    switch (t.state) {
      case 'error': return 'error';
      case 'missingFiles': return 'missing files';
      case 'metaDL':
      case 'forcedMetaDL':
        return age > threshold ? `no metadata after ${Math.round(age / 60)} min` : undefined;
      case 'stalledDL':
        return idle > threshold ? `stalled, no data for ${Math.round(idle / 60)} min` : undefined;
    }
    if (complete) return undefined;
    if (/^(paused|stopped|queued|checking)/.test(t.state) || t.state === 'allocating' || t.state === 'moving') return undefined;
    if (t.dlspeed === 0 && idle > threshold) return `0 B/s, no activity for ${Math.round(idle / 60)} min`;
    return undefined;
  }
}
