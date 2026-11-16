/**
 * Overseerr API Client
 *
 * Overseerr is a request management and media discovery tool for the Plex
 * ecosystem. It uses X-Api-Key authentication under /api/v1.
 * API: https://api-docs.overseerr.dev/
 */

export interface OverseerrConfig {
  url: string;
  apiKey: string;
}

export interface OverseerrUser {
  id: number;
  email?: string;
  username?: string;
  plexUsername?: string;
  displayName?: string;
  createdAt?: string;
  requestCount?: number;
}

export interface OverseerrRequest {
  id: number;
  status: number;
  createdAt: string;
  updatedAt: string;
  type: 'movie' | 'tv';
  is4k: boolean;
  media?: {
    tmdbId?: number;
    tvdbId?: number;
    status?: number;
  };
  seasons?: Array<{ seasonNumber: number }>;
  requestedBy?: OverseerrUser;
}

export interface OverseerrPage<T> {
  pageInfo: { pages: number; pageSize: number; results: number; page: number };
  results: T[];
}

export interface OverseerrStatus {
  version: string;
  commitTag?: string;
  updateAvailable?: boolean;
  commitsBehind?: number;
}

export interface OverseerrSearchResult {
  page: number;
  totalPages: number;
  totalResults: number;
  results: Array<{
    id: number;
    mediaType: string;
    title?: string;
    name?: string;
    releaseDate?: string;
    firstAirDate?: string;
    mediaInfo?: { status?: number };
  }>;
}

export type OverseerrRequestFilter = 'all' | 'approved' | 'available' | 'pending' | 'processing' | 'unavailable' | 'failed';

const REQUEST_STATUS: Record<number, string> = {
  1: 'pending',
  2: 'approved',
  3: 'declined',
};

const MEDIA_STATUS: Record<number, string> = {
  1: 'unknown',
  2: 'pending',
  3: 'processing',
  4: 'partially_available',
  5: 'available',
};

export class OverseerrClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(config: OverseerrConfig) {
    this.baseUrl = `${config.url.replace(/\/$/, '')}/api/v1`;
    this.apiKey = config.apiKey;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'X-Api-Key': this.apiKey,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    if (!response.ok) {
      throw new Error(`Overseerr API error: ${response.status} ${response.statusText}`);
    }
    return response.json() as Promise<T>;
  }

  private static query(params: Record<string, string | number | undefined>): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) search.set(key, String(value));
    }
    const text = search.toString();
    return text ? `?${text}` : '';
  }

  async getStatus(): Promise<OverseerrStatus> {
    return this.request('/status');
  }

  async getRequestCount(): Promise<Record<string, number>> {
    return this.request('/request/count');
  }

  async getRequests(params: { take?: number; skip?: number; filter?: OverseerrRequestFilter; requestedBy?: number }): Promise<OverseerrPage<OverseerrRequest>> {
    return this.request(`/request${OverseerrClient.query({ ...params, sort: 'added' })}`);
  }

  async approveRequest(requestId: number): Promise<OverseerrRequest> {
    return this.request(`/request/${requestId}/approve`, { method: 'POST' });
  }

  async declineRequest(requestId: number): Promise<OverseerrRequest> {
    return this.request(`/request/${requestId}/decline`, { method: 'POST' });
  }

  async getUsers(params: { take?: number; skip?: number; sort?: 'created' | 'updated' | 'requests' | 'displayname' }): Promise<OverseerrPage<OverseerrUser>> {
    return this.request(`/user${OverseerrClient.query(params)}`);
  }

  async getUserRequests(userId: number, params: { take?: number; skip?: number }): Promise<OverseerrPage<OverseerrRequest>> {
    return this.request(`/user/${userId}/requests${OverseerrClient.query(params)}`);
  }

  async search(query: string, page?: number): Promise<OverseerrSearchResult> {
    // Encode like the Overseerr web client does (%20, not '+', for spaces).
    const pageParam = page !== undefined ? `&page=${page}` : '';
    return this.request(`/search?query=${encodeURIComponent(query)}${pageParam}`);
  }

  static formatRequestStatus(status: number | undefined): string {
    return (status !== undefined && REQUEST_STATUS[status]) || 'unknown';
  }

  static formatMediaStatus(status: number | undefined): string {
    return (status !== undefined && MEDIA_STATUS[status]) || 'unknown';
  }
}
