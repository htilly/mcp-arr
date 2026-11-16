/**
 * Tdarr API Client
 *
 * Tdarr scans media libraries (ffprobe/MediaInfo per file) and runs each file
 * through the library's flow or plugin stack on worker nodes, e.g. to transcode
 * AV1/DTS to H.264/AAC.
 * API: http://IP:8265/api/v2/... Auth is optional: when it is enabled in Tdarr,
 * requests need an `x-api-key` header (key from Tools -> API Keys).
 *
 * Tdarr's server is closed source. Request shapes come from the Swagger spec a
 * Tdarr instance serves at /api/v2/public/api-docs/json; most response shapes
 * are untyped there and are taken from community clients (see field comments).
 */

import type { FetchLike } from './tls-trust.js';

export interface TdarrConfig {
  url: string;
  /** Only needed when authentication is enabled in Tdarr. */
  apiKey?: string;
  /** fetch to use, e.g. pinned to a self-signed certificate (tls-trust.ts). */
  fetch?: FetchLike;
}

/** GET /api/v2/status (typed in the Swagger spec). */
export interface TdarrStatus {
  status?: string;
  isProduction?: boolean;
  os?: string;
  version?: string;
  buildDate?: string;
  uptime?: number;
  serverEngine?: string;
}

export interface TdarrFfprobeStream {
  codec_type?: string;
  codec_name?: string;
  channels?: number;
  width?: number;
  height?: number;
  tags?: { language?: string; [key: string]: unknown };
  [key: string]: unknown;
}

/** A FileJSONDB document. _id is the full path as the Tdarr server sees it. */
export interface TdarrFile {
  _id: string;
  file?: string;
  DB?: string;
  container?: string;
  file_size?: number; // MB
  video_codec_name?: string;
  video_resolution?: string;
  audio_codec_name?: string;
  TranscodeDecisionMaker?: string;
  HealthCheck?: string;
  ffProbeData?: { streams?: TdarrFfprobeStream[]; format?: Record<string, unknown> };
  [key: string]: unknown;
}

export interface TdarrWorker {
  _id?: string;
  file?: string;
  fps?: number;
  percentage?: number;
  ETA?: string;
  status?: string;
  workerType?: string;
  job?: { type?: string; [key: string]: unknown };
  lastPluginDetails?: { number?: string; [key: string]: unknown };
  originalfileSizeInGbytes?: number;
  estSize?: number;
  outputFileSizeInGbytes?: number;
  isFlowWorker?: boolean;
  [key: string]: unknown;
}

export interface TdarrNode {
  _id?: string;
  nodeName?: string;
  nodePaused?: boolean;
  workers?: Record<string, TdarrWorker>;
  workerLimits?: Record<string, number>;
  [key: string]: unknown;
}

export interface TdarrLibrary {
  _id: string;
  name?: string;
  folder?: string;
  cache?: string;
  output?: string;
  processLibrary?: boolean;
  folderWatching?: boolean;
  scanOnStart?: boolean;
  flowId?: string;
  pluginIDs?: Array<{ _id?: string; checked?: boolean; priority?: number; [key: string]: unknown }>;
  [key: string]: unknown;
}

export interface TdarrPieSlice {
  name: string;
  value: number;
}

/** POST /api/v2/stats/get-pies -> pieStats (shape from Homarr's Tdarr integration). */
export interface TdarrPieStats {
  totalFiles?: number;
  totalTranscodeCount?: number;
  totalHealthCheckCount?: number;
  sizeDiff?: number; // GB, positive = space saved
  status?: { transcode?: TdarrPieSlice[]; healthcheck?: TdarrPieSlice[] };
  video?: { codecs?: TdarrPieSlice[]; containers?: TdarrPieSlice[]; resolutions?: TdarrPieSlice[] };
  audio?: { codecs?: TdarrPieSlice[]; containers?: TdarrPieSlice[] };
  [key: string]: unknown;
}

/** StatisticsJSONDB document (fields from homeylab/tdarr-exporter). */
export interface TdarrStatistics {
  totalFileCount?: number;
  totalTranscodeCount?: number;
  totalHealthCheckCount?: number;
  sizeDiff?: number;
  healthCheckScore?: string;
  table0Count?: number;
  table1Count?: number;
  table2Count?: number;
  table3Count?: number;
  table4Count?: number;
  table5Count?: number;
  table6Count?: number;
  [key: string]: unknown;
}

export interface TdarrTablePage {
  array: TdarrFile[];
  totalCount: number;
}

/**
 * The file tables behind the Tdarr UI, for POST /api/v2/client/status-tables.
 * table1 transcode queue, table2 transcode success / not required, table3 transcode error,
 * table4 health check queue, table5 health check success, table6 health check error.
 */
export const TDARR_TABLES = {
  transcodeQueue: 'table1',
  transcodeSuccess: 'table2',
  transcodeError: 'table3',
  healthQueue: 'table4',
  healthSuccess: 'table5',
  healthError: 'table6',
} as const;
export type TdarrTable = (typeof TDARR_TABLES)[keyof typeof TDARR_TABLES];

/** Filter for searchFiles / requeue. Every field is validated before use. */
export interface TdarrFileFilter {
  /** Video codec names (ffprobe codec_name), e.g. ["av1", "hevc"]. Matches any. */
  videoCodecs?: string[];
  /** Audio codec names (ffprobe codec_name), e.g. ["dts", "truehd"]. Matches a file with any audio stream in the list. */
  audioCodecs?: string[];
  /** How video and audio filters combine when both are given (default "any": AV1 OR DTS). */
  match?: 'any' | 'all';
  containers?: string[];
  libraryId?: string;
  /** Substring of the file path. */
  path?: string;
  /** Transcode status, e.g. "Transcode success", "Not required", "Queued", "Transcode error". */
  transcodeStatus?: string;
  healthCheckStatus?: string;
  minSizeGB?: number;
  maxSizeGB?: number;
}

export interface TdarrFileSummary {
  id: string;
  path: string;
  libraryId?: string;
  container?: string;
  sizeMB?: number;
  videoCodec?: string;
  resolution?: string;
  audioCodecs: string[];
  transcodeStatus?: string;
  healthCheckStatus?: string;
}

export interface TdarrSearchResult {
  /** Number of files the filter matched (before the limit). */
  matched: number;
  /** Number of files in the database that were checked. */
  scanned: number;
  files: TdarrFileSummary[];
}

export interface TdarrRequeueResult {
  matched: number;
  requeued: number;
  fileIds: string[];
  /** Files left out because of the per-call cap. */
  skipped: number;
}

export const TDARR_REQUEUE_MAX = 100;

const CODEC = /^[A-Za-z0-9_.-]{1,32}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const STATUS = /^[A-Za-z ]{1,40}$/;
// Control characters are never part of a real path and could confuse Tdarr's matcher or logs.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
const MAX_LIST = 20;
const MAX_PATH = 1024;

function checkList(name: string, values: unknown, pattern: RegExp): string[] | undefined {
  if (values === undefined) return undefined;
  if (!Array.isArray(values) || values.length === 0 || values.length > MAX_LIST) {
    throw new Error(`${name} must be a list of 1-${MAX_LIST} names`);
  }
  return values.map((v) => {
    if (typeof v !== 'string' || !pattern.test(v)) {
      throw new Error(`${name} entries may only contain letters, digits, dot, dash and underscore`);
    }
    return v.toLowerCase();
  });
}

function checkPath(name: string, value: unknown, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value) || value.length > MAX_PATH || CONTROL.test(value)) {
    throw new Error(`${name} must be a file path of at most ${MAX_PATH} characters`);
  }
  return value;
}

/** Validate a filter coming from a tool call. Throws on anything unexpected. */
export function checkFileFilter(f: TdarrFileFilter): TdarrFileFilter {
  if (typeof f !== 'object' || f === null) throw new Error('filter must be an object');
  const out: TdarrFileFilter = {
    videoCodecs: checkList('videoCodecs', f.videoCodecs, CODEC),
    audioCodecs: checkList('audioCodecs', f.audioCodecs, CODEC),
    containers: checkList('containers', f.containers, CODEC),
  };
  if (f.match !== undefined) {
    if (f.match !== 'any' && f.match !== 'all') throw new Error('match must be "any" or "all"');
    out.match = f.match;
  }
  if (f.libraryId !== undefined) out.libraryId = TdarrClient.checkId('libraryId', f.libraryId);
  if (f.path !== undefined && f.path !== '') out.path = checkPath('path', f.path);
  for (const key of ['transcodeStatus', 'healthCheckStatus'] as const) {
    const v = f[key];
    if (v === undefined) continue;
    if (typeof v !== 'string' || !STATUS.test(v)) throw new Error(`${key} must be a status such as "Transcode success"`);
    out[key] = v;
  }
  for (const key of ['minSizeGB', 'maxSizeGB'] as const) {
    const v = f[key];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1_000_000) throw new Error(`${key} must be a number of GB`);
    out[key] = v;
  }
  return out;
}

export function audioCodecsOf(file: TdarrFile): string[] {
  const fromStreams = (file.ffProbeData?.streams ?? [])
    .filter((s) => s?.codec_type === 'audio' && typeof s.codec_name === 'string')
    .map((s) => (s.codec_name as string).toLowerCase());
  if (fromStreams.length) return [...new Set(fromStreams)];
  return typeof file.audio_codec_name === 'string' && file.audio_codec_name ? [file.audio_codec_name.toLowerCase()] : [];
}

export function videoCodecOf(file: TdarrFile): string | undefined {
  if (typeof file.video_codec_name === 'string' && file.video_codec_name) return file.video_codec_name.toLowerCase();
  const stream = (file.ffProbeData?.streams ?? []).find((s) => s?.codec_type === 'video' && typeof s.codec_name === 'string'
    // cover art is stored as a video stream (mjpeg/png); skip it
    && !['mjpeg', 'png', 'bmp', 'gif'].includes((s.codec_name as string).toLowerCase()));
  return stream ? (stream.codec_name as string).toLowerCase() : undefined;
}

/** True when the (already validated) filter matches the file. */
export function matchesFilter(file: TdarrFile, f: TdarrFileFilter): boolean {
  if (f.libraryId && file.DB !== f.libraryId) return false;
  const path = String(file.file ?? file._id ?? '');
  if (f.path && !path.toLowerCase().includes(f.path.toLowerCase())) return false;
  if (f.containers && !f.containers.includes(String(file.container ?? '').toLowerCase().replace(/^\./, ''))) return false;
  if (f.transcodeStatus && String(file.TranscodeDecisionMaker ?? '').toLowerCase() !== f.transcodeStatus.toLowerCase()) return false;
  if (f.healthCheckStatus && String(file.HealthCheck ?? '').toLowerCase() !== f.healthCheckStatus.toLowerCase()) return false;
  const sizeGB = typeof file.file_size === 'number' ? file.file_size / 1000 : undefined;
  if (f.minSizeGB !== undefined && (sizeGB === undefined || sizeGB < f.minSizeGB)) return false;
  if (f.maxSizeGB !== undefined && (sizeGB === undefined || sizeGB > f.maxSizeGB)) return false;

  const checks: boolean[] = [];
  if (f.videoCodecs) {
    const v = videoCodecOf(file);
    checks.push(v !== undefined && f.videoCodecs.includes(v));
  }
  if (f.audioCodecs) {
    const a = audioCodecsOf(file);
    checks.push(a.some((c) => f.audioCodecs!.includes(c)));
  }
  if (!checks.length) return true;
  return f.match === 'all' ? checks.every(Boolean) : checks.some(Boolean);
}

export function summarizeFile(file: TdarrFile): TdarrFileSummary {
  return {
    id: file._id,
    path: String(file.file ?? file._id),
    libraryId: file.DB,
    container: file.container,
    sizeMB: typeof file.file_size === 'number' ? Math.round(file.file_size) : undefined,
    videoCodec: videoCodecOf(file),
    resolution: file.video_resolution,
    audioCodecs: audioCodecsOf(file),
    transcodeStatus: file.TranscodeDecisionMaker,
    healthCheckStatus: file.HealthCheck,
  };
}

export class TdarrClient {
  private url: string;
  private apiKey?: string;
  private readonly fetch: FetchLike;

  constructor(config: TdarrConfig) {
    this.url = config.url.replace(/\/+$/, '');
    this.apiKey = config.apiKey?.trim() || undefined;
    this.fetch = config.fetch ?? fetch;
  }

  static checkId(name: string, value: unknown): string {
    if (typeof value !== 'string' || !ID.test(value)) {
      throw new Error(`${name} must be a Tdarr id (letters, digits, dash and underscore only)`);
    }
    return value;
  }

  private async request<T = unknown>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.apiKey) headers['x-api-key'] = this.apiKey;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const response = await this.fetch(`${this.url}/api/v2${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error(`Tdarr API error: ${response.status} - ${this.apiKey
          ? 'check TDARR_API_KEY'
          : 'authentication is enabled in Tdarr, set TDARR_API_KEY (Tdarr: Tools -> API Keys)'}`);
      }
      // Tdarr answers errors with free text (sometimes stack traces); never pass the body on.
      throw new Error(`Tdarr API error: ${response.status} ${response.statusText}`.trim());
    }

    const text = await response.text();
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  private cruddb<T>(collection: string, mode: 'getAll' | 'getById', docID?: string): Promise<T> {
    return this.request<T>('POST', '/cruddb', { data: { collection, mode, ...(docID ? { docID } : {}) } });
  }

  // Server

  async getStatus(): Promise<TdarrStatus> {
    return (await this.request<TdarrStatus>('GET', '/status')) ?? {};
  }

  async getNodes(): Promise<Record<string, TdarrNode>> {
    const res = await this.request<Record<string, TdarrNode>>('GET', '/get-nodes');
    return res && typeof res === 'object' ? res : {};
  }

  /** Pause or resume a node (no new jobs start while paused; running ones finish). */
  async setNodePaused(nodeId: string, paused: boolean): Promise<void> {
    await this.request('POST', '/update-node', {
      data: { nodeID: TdarrClient.checkId('nodeId', nodeId), nodeUpdates: { nodePaused: paused } },
    });
  }

  // Libraries and statistics

  async getLibraries(): Promise<TdarrLibrary[]> {
    const res = await this.cruddb<TdarrLibrary[]>('LibrarySettingsJSONDB', 'getAll');
    return Array.isArray(res) ? res : [];
  }

  /** Pie stats (counts per codec/container/resolution/status). Empty libraryId = all libraries. */
  async getPieStats(libraryId = ''): Promise<TdarrPieStats> {
    const id = libraryId === '' ? '' : TdarrClient.checkId('libraryId', libraryId);
    const res = await this.request<{ pieStats?: TdarrPieStats }>('POST', '/stats/get-pies', { data: { libraryId: id } });
    return res?.pieStats ?? {};
  }

  async getStatistics(): Promise<TdarrStatistics> {
    const res = await this.cruddb<TdarrStatistics[] | TdarrStatistics>('StatisticsJSONDB', 'getAll');
    if (Array.isArray(res)) return res[0] ?? {};
    return res ?? {};
  }

  // Files

  async getFile(fileId: string): Promise<TdarrFile | undefined> {
    const res = await this.cruddb<TdarrFile>('FileJSONDB', 'getById', checkPath('fileId', fileId));
    return res && typeof res === 'object' && res._id ? res : undefined;
  }

  /** One page of a UI file table (transcode/health queue, success, error). */
  async getTable(table: TdarrTable, start: number, pageSize: number, libraryId?: string): Promise<TdarrTablePage> {
    if (!Object.values(TDARR_TABLES).includes(table)) throw new Error('unknown Tdarr table');
    const res = await this.request<TdarrTablePage>('POST', '/client/status-tables', {
      data: {
        start: Math.max(0, Math.floor(start)),
        pageSize: Math.min(Math.max(1, Math.floor(pageSize)), 500),
        filters: [],
        sorts: [],
        opts: { table, ...(libraryId ? { dbID: TdarrClient.checkId('libraryId', libraryId) } : {}) },
      },
    });
    return { array: Array.isArray(res?.array) ? res.array : [], totalCount: Number(res?.totalCount ?? 0) };
  }

  /** Files waiting for the user to accept or reject a transcode result. */
  async getStaged(): Promise<TdarrFile[]> {
    const res = await this.cruddb<TdarrFile[]>('StagedJSONDB', 'getAll');
    return Array.isArray(res) ? res : [];
  }

  /**
   * Search the file database. Tdarr has no server-side codec filter, so the files whose
   * path contains filter.path (all files without it) are loaded with search-db and filtered here.
   * Only the validated path string and fixed size bounds are sent to Tdarr.
   */
  async searchFiles(filter: TdarrFileFilter, limit = 50): Promise<TdarrSearchResult> {
    const f = checkFileFilter(filter);
    const res = await this.request<TdarrFile[]>('POST', '/search-db', {
      data: { string: f.path ?? '', greaterThanGB: 0, lessThanGB: 1_000_000 },
    });
    const all = Array.isArray(res) ? res.filter((x) => x && typeof x._id === 'string') : [];
    const matched = all.filter((file) => matchesFilter(file, f));
    return {
      matched: matched.length,
      scanned: all.length,
      files: matched.slice(0, Math.max(0, limit)).map(summarizeFile),
    };
  }

  /**
   * Put files back in the transcode (or health check) queue so the library's flow / plugin
   * stack processes them again. Touches at most `max` (<= TDARR_REQUEUE_MAX) files per call.
   */
  async requeueFiles(
    target: { fileIds?: string[]; filter?: TdarrFileFilter },
    options: { max?: number; healthCheck?: boolean } = {}
  ): Promise<TdarrRequeueResult> {
    const max = Math.min(Math.max(1, Math.floor(options.max ?? TDARR_REQUEUE_MAX)), TDARR_REQUEUE_MAX);
    let ids: string[];
    if (target.fileIds !== undefined) {
      if (target.filter !== undefined) throw new Error('give either fileIds or a filter, not both');
      if (!Array.isArray(target.fileIds) || target.fileIds.length === 0) throw new Error('fileIds must be a non-empty list');
      ids = [...new Set(target.fileIds.map((id) => checkPath('fileIds entry', id)))];
    } else if (target.filter !== undefined) {
      const f = checkFileFilter(target.filter);
      if (!f.videoCodecs && !f.audioCodecs && !f.containers && !f.path && !f.libraryId && !f.transcodeStatus && !f.healthCheckStatus) {
        throw new Error('the filter must narrow the files down (codec, container, path, library or status)');
      }
      const res = await this.searchFiles(f, Number.MAX_SAFE_INTEGER);
      ids = res.files.map((file) => file.id);
    } else {
      throw new Error('fileIds or filter is required');
    }

    const selected = ids.slice(0, max);
    if (selected.length) {
      await this.request('POST', '/bulk-update-files', {
        data: {
          fileIds: selected,
          updatedObj: options.healthCheck ? { HealthCheck: 'Queued' } : { TranscodeDecisionMaker: 'Queued' },
        },
      });
    }
    return { matched: ids.length, requeued: selected.length, fileIds: selected, skipped: ids.length - selected.length };
  }
}
