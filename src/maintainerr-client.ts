/**
 * Maintainerr API Client
 *
 * Maintainerr finds media in Plex/Jellyfin/Emby that matches rules (unwatched,
 * old, low rated, ...), puts it in a "leaving soon" collection and deletes it
 * through Sonarr/Radarr after a grace period.
 * API: http://IP:PORT/api/... (auth via X-Api-Key header, key in Settings → General)
 */

export interface MaintainerrConfig {
  url: string;
  apiKey: string;
}

type QueryValue = string | number | boolean | undefined;

export interface MaintainerrAppStatus {
  status?: number;
  version?: string;
  commitTag?: string;
  updateAvailable?: boolean;
}

export interface MaintainerrHealth {
  status?: string;
  uptimeSeconds?: number;
  database?: string;
  [key: string]: unknown;
}

export interface MaintainerrCollection {
  id: number;
  title: string;
  description?: string;
  libraryId?: string;
  type?: string;
  isActive?: boolean;
  arrAction?: number;
  deleteAfterDays?: number | null;
  manualCollection?: boolean;
  listExclusions?: boolean;
  keepInMaintainerrOnly?: boolean;
  tagInArr?: boolean;
  handledMediaAmount?: number;
  lastDurationInSeconds?: number;
  totalSizeBytes?: number | null;
  handledMediaSizeBytes?: number | null;
  addDate?: string;
  mediaCount?: number;
  media?: unknown[];
}

export interface MaintainerrMediaData {
  id?: string;
  title?: string;
  type?: string;
  year?: number;
  path?: string;
  library?: { id?: string; title?: string };
  parentTitle?: string;
  grandparentTitle?: string;
  index?: number;
  parentIndex?: number;
  maintainerrCollections?: string[];
  [key: string]: unknown;
}

export interface MaintainerrCollectionMedia {
  id: number;
  collectionId: number;
  mediaServerId: string;
  tmdbId?: number | null;
  tvdbId?: number | null;
  addDate?: string;
  isManual?: boolean;
  includedByRule?: boolean;
  sizeBytes?: number | null;
  ruleEvaluationFailed?: boolean;
  mediaData?: MaintainerrMediaData;
}

export interface MaintainerrPage<T> {
  totalSize: number;
  items: T[];
}

export interface MaintainerrRuleGroup {
  id: number;
  name: string;
  description?: string;
  libraryId?: string;
  isActive?: boolean;
  collectionId?: number;
  useRules?: boolean;
  dataType?: string;
  ruleHandlerCronSchedule?: string | null;
  rules?: unknown[];
}

export interface MaintainerrLog {
  id: number;
  timestamp: string;
  message: string;
  type?: number;
  meta?: { type?: string } | null;
}

export interface MaintainerrExclusion {
  id: number;
  mediaServerId: string;
  ruleGroupId?: number | null;
  parent?: string | null;
  type?: string | null;
  [key: string]: unknown;
}

export interface MaintainerrExecutionStatus {
  processingQueue?: boolean;
  executingRuleGroupId?: number | null;
  pendingRuleGroupIds?: number[];
  queue?: unknown[];
}

export interface MaintainerrItemStatus {
  excludedFrom?: unknown[];
  manuallyAddedTo?: unknown[];
}

export interface MaintainerrPostponeResult {
  addDate?: string;
  deleteAfterDays?: number;
  deletionDate?: string;
  [key: string]: unknown;
}

interface ReturnStatus {
  code?: number;
  result?: string;
  message?: string;
}

/** Media server item ids are numeric Plex rating keys or hex/GUID Jellyfin/Emby ids. */
const MEDIA_ID = /^[A-Za-z0-9-]{1,64}$/;

export class MaintainerrClient {
  private url: string;
  private apiKey: string;

  constructor(config: MaintainerrConfig) {
    this.url = config.url.replace(/\/$/, '');
    this.apiKey = config.apiKey;
  }

  static checkMediaId(mediaId: unknown): string {
    if (typeof mediaId !== 'string' || !MEDIA_ID.test(mediaId)) {
      throw new Error('mediaId must be a media server item id (letters, digits and dashes only)');
    }
    return mediaId;
  }

  private async request<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    options: { query?: Record<string, QueryValue>; body?: unknown } = {}
  ): Promise<T> {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) search.append(key, String(value));
    }
    const qs = search.toString();
    const url = `${this.url}/api${path}${qs ? `?${qs}` : ''}`;

    const headers: Record<string, string> = {
      'X-Api-Key': this.apiKey,
      Accept: 'application/json',
    };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';

    const response = await fetch(url, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error(`Maintainerr API error: ${response.status} - check MAINTAINERR_API_KEY`);
      }
      // Maintainerr (NestJS) explains conflicts and bad requests in a short message, e.g.
      // "The rule executor is already running". Pass that on for 4xx responses, but
      // never the raw body and nothing from server errors.
      let detail = '';
      if (response.status < 500) {
        try {
          const body = await response.json() as { message?: unknown };
          if (typeof body?.message === 'string') detail = ` - ${body.message.slice(0, 200)}`;
        } catch { /* not JSON */ }
      }
      throw new Error(`Maintainerr API error: ${response.status} ${response.statusText}${detail}`);
    }

    if (response.status === 204) return undefined as T;
    const text = await response.text();
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  private static checkReturnStatus(res: ReturnStatus | undefined): ReturnStatus | undefined {
    if (res && res.code === 0) {
      throw new Error(`Maintainerr refused the change: ${res.result ?? res.message ?? 'unknown reason'}`);
    }
    return res;
  }

  // System

  async getAppStatus(): Promise<MaintainerrAppStatus> {
    return (await this.request<MaintainerrAppStatus>('GET', '/app/status')) ?? {};
  }

  async getHealth(): Promise<MaintainerrHealth> {
    return (await this.request<MaintainerrHealth>('GET', '/health')) ?? {};
  }

  // Collections

  async getCollections(): Promise<MaintainerrCollection[]> {
    return (await this.request<MaintainerrCollection[]>('GET', '/collections')) ?? [];
  }

  async getCollectionMedia(collectionId: number, page: number, size: number): Promise<MaintainerrPage<MaintainerrCollectionMedia>> {
    const res = await this.request<MaintainerrPage<MaintainerrCollectionMedia>>(
      'GET',
      `/collections/media/${collectionId}/content/${page}`,
      { query: { size } }
    );
    return res ?? { totalSize: 0, items: [] };
  }

  async getCollectionLogs(
    collectionId: number,
    page: number,
    size: number,
    search?: string
  ): Promise<MaintainerrPage<MaintainerrLog>> {
    const res = await this.request<MaintainerrPage<MaintainerrLog>>(
      'GET',
      `/collections/logs/${collectionId}/content/${page}`,
      { query: { size, search, sort: 'DESC' } }
    );
    return res ?? { totalSize: 0, items: [] };
  }

  /** Reset the grace period of one item, or push its deletion out by `days`. */
  async postponeMedia(collectionId: number, mediaId: string, days?: number): Promise<MaintainerrPostponeResult> {
    return (await this.request<MaintainerrPostponeResult>('POST', '/collections/media/postpone', {
      body: { collectionId, mediaId: MaintainerrClient.checkMediaId(mediaId), days },
    })) ?? {};
  }

  /** Remove an item from one collection (the next rule run may add it again unless excluded). */
  async removeFromCollection(collectionId: number, mediaId: string): Promise<void> {
    await this.request('DELETE', '/collections/media', {
      query: { mediaId: MaintainerrClient.checkMediaId(mediaId), collectionId },
    });
  }

  /** Run the collection handler: performs the Sonarr/Radarr action on every item whose grace period is over. */
  async handleCollections(): Promise<void> {
    await this.request('POST', '/collections/handle');
  }

  // Rules

  async getRuleGroups(): Promise<MaintainerrRuleGroup[]> {
    return (await this.request<MaintainerrRuleGroup[]>('GET', '/rules')) ?? [];
  }

  async getExecutionStatus(): Promise<MaintainerrExecutionStatus> {
    return (await this.request<MaintainerrExecutionStatus>('GET', '/rules/execute/status')) ?? {};
  }

  async executeRules(ruleGroupId?: number): Promise<void> {
    await this.request('POST', ruleGroupId === undefined ? '/rules/execute' : `/rules/${ruleGroupId}/execute`);
  }

  async getExclusions(params: { ruleGroupId?: number; mediaId?: string } = {}): Promise<MaintainerrExclusion[]> {
    return (await this.request<MaintainerrExclusion[]>('GET', '/rules/exclusion', {
      query: {
        rulegroupId: params.ruleGroupId,
        mediaServerId: params.mediaId === undefined ? undefined : MaintainerrClient.checkMediaId(params.mediaId),
      },
    })) ?? [];
  }

  /**
   * Add or remove an exclusion. Without collectionId the exclusion is global
   * (applies to every rule group); with it, only to that collection's rule group.
   */
  async setExclusion(params: { mediaId: string; collectionId?: number; remove?: boolean }): Promise<ReturnStatus | undefined> {
    const res = await this.request<ReturnStatus>('POST', '/rules/exclusion', {
      body: {
        mediaId: MaintainerrClient.checkMediaId(params.mediaId),
        collectionId: params.collectionId,
        action: params.remove ? 1 : 0,
      },
    });
    return MaintainerrClient.checkReturnStatus(res);
  }

  // Media server (via Maintainerr)

  async searchMedia(query: string): Promise<MaintainerrMediaData[]> {
    return (await this.request<MaintainerrMediaData[]>('GET', `/media-server/search/${encodeURIComponent(query)}`)) ?? [];
  }

  async getItemStatus(mediaId: string): Promise<MaintainerrItemStatus> {
    return (await this.request<MaintainerrItemStatus>(
      'GET',
      `/media-server/meta/${MaintainerrClient.checkMediaId(mediaId)}/maintainerr-status`
    )) ?? {};
  }

  /** Arr action ids as used by Maintainerr collections. */
  static arrActionName(action?: number): string | undefined {
    // ServarrAction in Maintainerr's packages/contracts
    const names = [
      'delete',
      'unmonitor and delete all files',
      'unmonitor and delete existing files',
      'unmonitor (keep files)',
      'do nothing',
      'delete show if empty',
      'unmonitor show if empty',
      'change quality profile',
    ];
    if (action === undefined) return undefined;
    return names[action] ?? String(action);
  }
}
