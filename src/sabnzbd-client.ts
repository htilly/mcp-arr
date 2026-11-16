/**
 * SABnzbd API client
 *
 * Docs: https://sabnzbd.org/wiki/configuration/4.5/api
 * Every call is GET {url}/api?mode=...&output=json&apikey=... (API key from Config → General).
 * SABnzbd reports errors (including a wrong API key) as HTTP 200 with {"status": false, "error": "..."};
 * those are turned into "SABnzbd API error: <status>" errors. The API key travels in the query string,
 * so request URLs never go into error messages.
 */

import type { FetchLike } from './tls-trust.js';

export interface SabnzbdConfig {
  url: string;
  apiKey: string;
  /** fetch to use, e.g. pinned to a self-signed certificate (tls-trust.ts). */
  fetch?: FetchLike;
}

export interface SabnzbdQueueSlot {
  nzo_id: string;
  filename: string;
  status: string; // Downloading, Queued, Paused, Fetching, Grabbing, Propagating, Checking, ...
  index?: number;
  cat?: string;
  priority?: string;
  percentage?: string; // "42"
  mb?: string;
  mbleft?: string;
  size?: string; // "1.2 GB"
  sizeleft?: string;
  timeleft?: string; // "0:12:34"
  eta?: string;
  avg_age?: string;
  labels?: string[];
  [key: string]: unknown;
}

export interface SabnzbdQueue {
  status: string; // Downloading, Paused, Idle
  paused: boolean;
  paused_all?: boolean;
  pause_int?: string; // minutes left of a timed pause, "0" when none
  speed?: string; // "1.2 M"
  kbpersec?: string;
  speedlimit?: string; // percent of the configured line speed
  speedlimit_abs?: string; // bytes/s, "" when unlimited
  diskspace1?: string; // GB free, incomplete folder
  diskspace2?: string; // GB free, complete folder
  diskspacetotal1?: string;
  diskspacetotal2?: string;
  diskspace1_norm?: string;
  diskspace2_norm?: string;
  have_warnings?: string;
  noofslots: number;
  noofslots_total?: number;
  mbleft?: string;
  mb?: string;
  sizeleft?: string;
  size?: string;
  timeleft?: string;
  version?: string;
  slots: SabnzbdQueueSlot[];
  [key: string]: unknown;
}

export interface SabnzbdHistorySlot {
  nzo_id: string;
  name: string;
  status: string; // Completed, Failed, Queued, Verifying, Repairing, Extracting, Moving, Running
  fail_message?: string;
  category?: string;
  bytes?: number;
  size?: string;
  completed?: number; // unix seconds
  download_time?: number;
  storage?: string;
  retry?: number; // 1 when SABnzbd can retry the job
  [key: string]: unknown;
}

export interface SabnzbdHistory {
  noofslots: number;
  slots: SabnzbdHistorySlot[];
  [key: string]: unknown;
}

type Params = Record<string, string | number | undefined>;

/** nzo ids look like SABnzbd_nzo_ab12cd34; accept letters, digits, '_' and '-'. */
const NZO_ID = /^[A-Za-z0-9_-]{1,80}$/;

/** Percent of the configured maximum line speed (e.g. "50"), or an absolute value like "800K" / "5M". */
const SPEED_LIMIT = /^(?:\d{1,3}(?:\.\d+)?%?|\d+(?:\.\d+)?[KkMm])$/;

class SabnzbdError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export class SabnzbdClient {
  private readonly url: string;
  private readonly apiKey: string;
  private readonly fetch: FetchLike;

  constructor(config: SabnzbdConfig) {
    this.url = config.url.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.fetch = config.fetch ?? fetch;
  }

  static joinIds(ids: string[]): string {
    if (!Array.isArray(ids) || ids.length === 0) throw new Error('At least one nzo_id is required');
    if (ids.length > 500) throw new Error('At most 500 nzo_ids at a time');
    for (const id of ids) {
      if (typeof id !== 'string' || !NZO_ID.test(id)) {
        throw new Error('nzo_id must look like SABnzbd_nzo_xxxxxxxx (get it from sabnzbd_get_queue or sabnzbd_get_history)');
      }
    }
    return ids.join(',');
  }

  /** Normalise a speed limit: "50" / "50%" = percent of the line speed, "800K" / "5M" = absolute. */
  static checkSpeedLimit(value: string): string {
    const v = String(value).trim();
    if (!SPEED_LIMIT.test(v)) {
      throw new Error('Speed limit must be a percentage of the configured line speed (e.g. 50 or 50%) or an absolute value like 800K or 5M');
    }
    return v.replace('%', '').toUpperCase();
  }

  private async request<T>(mode: string, params: Params = {}): Promise<T> {
    const search = new URLSearchParams({ mode, output: 'json', apikey: this.apiKey });
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) search.append(key, String(value));
    }
    const response = await this.fetch(`${this.url}/api?${search.toString()}`, { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403) {
        throw new SabnzbdError(response.status, `SABnzbd API error: ${response.status} - check SABNZBD_API_KEY`);
      }
      throw new SabnzbdError(response.status, `SABnzbd API error: ${response.status} ${response.statusText}`);
    }
    const text = await response.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      // Old versions answer some errors in plain text ("API Key Incorrect") even with output=json.
      if (/api key/i.test(text)) throw new SabnzbdError(401, 'SABnzbd API error: 401 - check SABNZBD_API_KEY');
      const err = new SyntaxError('SABnzbd answered with something that is not JSON');
      throw err;
    }
    const obj = data as { status?: unknown; error?: unknown };
    if (obj && obj.status === false) {
      const error = typeof obj.error === 'string' ? obj.error : 'request refused';
      if (/api key/i.test(error)) throw new SabnzbdError(401, 'SABnzbd API error: 401 - check SABNZBD_API_KEY');
      // SABnzbd's own error strings are short and fixed ("Not implemented", "Missing argument"); cap anyway.
      throw new SabnzbdError(400, `SABnzbd API error: 400 - ${error.slice(0, 200)}`);
    }
    return data as T;
  }

  // ---------- status ----------

  async getVersion(): Promise<string> {
    return (await this.request<{ version: string }>('version')).version;
  }

  /** Queue with speed, pause state, speed limit and free disk space. */
  async getQueue(opts: { start?: number; limit?: number; search?: string; nzoIds?: string[] } = {}): Promise<SabnzbdQueue> {
    const res = await this.request<{ queue: SabnzbdQueue }>('queue', {
      start: opts.start,
      limit: opts.limit,
      search: opts.search || undefined,
      nzo_ids: opts.nzoIds?.length ? SabnzbdClient.joinIds(opts.nzoIds) : undefined,
    });
    return res.queue;
  }

  async getHistory(opts: { start?: number; limit?: number; failedOnly?: boolean; category?: string; search?: string } = {}): Promise<SabnzbdHistory> {
    const res = await this.request<{ history: SabnzbdHistory }>('history', {
      start: opts.start,
      limit: opts.limit,
      failed_only: opts.failedOnly ? 1 : undefined,
      category: opts.category || undefined,
      search: opts.search || undefined,
    });
    return res.history;
  }

  // ---------- pause / resume ----------

  /** Pause the whole queue; with minutes, SABnzbd resumes by itself afterwards. */
  async pauseAll(minutes?: number): Promise<void> {
    if (minutes !== undefined) {
      await this.request('config', { name: 'set_pause', value: Math.max(1, Math.round(minutes)) });
    } else {
      await this.request('pause');
    }
  }

  async resumeAll(): Promise<void> {
    await this.request('resume');
  }

  async pauseItems(ids: string[]): Promise<void> {
    await this.request('queue', { name: 'pause', value: SabnzbdClient.joinIds(ids) });
  }

  async resumeItems(ids: string[]): Promise<void> {
    await this.request('queue', { name: 'resume', value: SabnzbdClient.joinIds(ids) });
  }

  // ---------- speed ----------

  /** See checkSpeedLimit. "100" (percent) removes the limit. */
  async setSpeedLimit(value: string): Promise<void> {
    await this.request('config', { name: 'speedlimit', value: SabnzbdClient.checkSpeedLimit(value) });
  }

  // ---------- remove / retry ----------

  /** Remove jobs from the queue; deleteFiles also removes what was already downloaded. */
  async deleteQueueItems(ids: string[], deleteFiles: boolean): Promise<void> {
    await this.request('queue', { name: 'delete', value: SabnzbdClient.joinIds(ids), del_files: deleteFiles ? 1 : 0 });
  }

  /** Remove jobs from the history (e.g. failed ones); deleteFiles also removes their files. */
  async deleteHistoryItems(ids: string[], deleteFiles: boolean): Promise<void> {
    await this.request('history', { name: 'delete', value: SabnzbdClient.joinIds(ids), del_files: deleteFiles ? 1 : 0 });
  }

  /** Retry a failed job from the history. */
  async retry(id: string): Promise<void> {
    await this.request('retry', { value: SabnzbdClient.joinIds([id]) });
  }

  async retryAll(): Promise<void> {
    await this.request('retry_all');
  }

  // ---------- stuck detection ----------

  /**
   * Why a queue slot looks stuck, or undefined: the queue is downloading (not paused) at 0 speed
   * while this job is the active one, or the job sits in a grabbing/fetching/propagating state.
   */
  static queueStuckReason(slot: SabnzbdQueueSlot, queue: Pick<SabnzbdQueue, 'paused' | 'kbpersec' | 'status'>): string | undefined {
    if (/^(Grabbing|Fetching)$/i.test(slot.status)) return `waiting for the NZB (${slot.status})`;
    if (/^Propagating$/i.test(slot.status)) return 'waiting for propagation delay';
    if (!queue.paused && /^Downloading$/i.test(slot.status) && Number(queue.kbpersec ?? 0) === 0) return 'downloading at 0 KB/s';
    return undefined;
  }
}
