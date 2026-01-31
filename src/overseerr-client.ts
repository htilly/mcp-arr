/**
 * Overseerr API Client
 *
 * Overseerr is a request management and media discovery tool for the Plex ecosystem.
 * API: https://api-docs.overseerr.dev/
 */

export interface OverseerrConfig {
  url: string;
  apiKey: string;
}

export interface OverseerrUser {
  id: number;
  email: string;
  username?: string;
  plexUsername?: string;
  userType: number;
  permissions: number;
  avatar?: string;
  createdAt: string;
  updatedAt: string;
  requestCount: number;
}

export interface OverseerrMediaInfo {
  id: number;
  tmdbId?: number;
  tvdbId?: number;
  status: number;
  status4k: number;
  createdAt: string;
  updatedAt: string;
  mediaType: string;
}

export interface OverseerrRequest {
  id: number;
  status: number; // 1=pending, 2=approved, 3=declined
  createdAt: string;
  updatedAt: string;
  type: 'movie' | 'tv';
  is4k: boolean;
  serverId?: number;
  profileId?: number;
  rootFolder?: string;
  languageProfileId?: number;
  tags?: number[];
  media: {
    id: number;
    tmdbId?: number;
    tvdbId?: number;
    status: number;
    status4k: number;
    mediaType: string;
    externalServiceId?: number;
    externalServiceId4k?: number;
    externalServiceSlug?: string;
    externalServiceSlug4k?: string;
    ratingKey?: string;
    ratingKey4k?: string;
  };
  seasons?: Array<{
    id: number;
    seasonNumber: number;
    status: number;
    status4k: number;
    createdAt: string;
    updatedAt: string;
  }>;
  modifiedBy?: OverseerrUser;
  requestedBy: OverseerrUser;
  seasonCount?: number;
}

export interface OverseerrRequestsResponse {
  pageInfo: {
    pages: number;
    pageSize: number;
    results: number;
    page: number;
  };
  results: OverseerrRequest[];
}

export interface OverseerrUsersResponse {
  pageInfo: {
    pages: number;
    pageSize: number;
    results: number;
    page: number;
  };
  results: OverseerrUser[];
}

export interface OverseerrStatus {
  version: string;
  commitTag: string;
  updateAvailable: boolean;
  commitsBehind: number;
}

export interface OverseerrRequestCount {
  total: number;
  movie: number;
  tv: number;
  pending: number;
  approved: number;
  declined: number;
  processing: number;
  available: number;
}

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
  private config: OverseerrConfig;
  private baseUrl: string;

  constructor(config: OverseerrConfig) {
    this.config = {
      url: config.url.replace(/\/$/, ''),
      apiKey: config.apiKey,
    };
    this.baseUrl = `${this.config.url}/api/v1`;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'X-Api-Key': this.config.apiKey,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Overseerr API error: ${response.status} ${response.statusText} - ${text}`
      );
    }

    return response.json() as Promise<T>;
  }

  /**
   * Get Overseerr status
   */
  async getStatus(): Promise<OverseerrStatus> {
    return this.request<OverseerrStatus>('/status');
  }

  /**
   * Get request counts
   */
  async getRequestCount(): Promise<OverseerrRequestCount> {
    return this.request<OverseerrRequestCount>('/request/count');
  }

  /**
   * Get all requests with optional filters
   */
  async getRequests(params?: {
    take?: number;
    skip?: number;
    filter?: 'all' | 'pending' | 'approved' | 'declined' | 'processing' | 'available';
    sort?: 'added' | 'modified';
    requestedBy?: number;
  }): Promise<OverseerrRequestsResponse> {
    const searchParams = new URLSearchParams();
    if (params?.take) searchParams.set('take', String(params.take));
    if (params?.skip) searchParams.set('skip', String(params.skip));
    if (params?.filter) searchParams.set('filter', params.filter);
    if (params?.sort) searchParams.set('sort', params.sort);
    if (params?.requestedBy) searchParams.set('requestedBy', String(params.requestedBy));

    const query = searchParams.toString();
    return this.request<OverseerrRequestsResponse>(
      `/request${query ? `?${query}` : ''}`
    );
  }

  /**
   * Get a specific request by ID
   */
  async getRequest(requestId: number): Promise<OverseerrRequest> {
    return this.request<OverseerrRequest>(`/request/${requestId}`);
  }

  /**
   * Approve a request
   */
  async approveRequest(requestId: number): Promise<OverseerrRequest> {
    return this.request<OverseerrRequest>(`/request/${requestId}/approve`, {
      method: 'POST',
    });
  }

  /**
   * Decline a request
   */
  async declineRequest(requestId: number): Promise<OverseerrRequest> {
    return this.request<OverseerrRequest>(`/request/${requestId}/decline`, {
      method: 'POST',
    });
  }

  /**
   * Delete a request
   */
  async deleteRequest(requestId: number): Promise<void> {
    await this.request<void>(`/request/${requestId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Get all users
   */
  async getUsers(params?: {
    take?: number;
    skip?: number;
    sort?: 'displayname' | 'requestcount' | 'created';
  }): Promise<OverseerrUsersResponse> {
    const searchParams = new URLSearchParams();
    if (params?.take) searchParams.set('take', String(params.take));
    if (params?.skip) searchParams.set('skip', String(params.skip));
    if (params?.sort) searchParams.set('sort', params.sort);

    const query = searchParams.toString();
    return this.request<OverseerrUsersResponse>(
      `/user${query ? `?${query}` : ''}`
    );
  }

  /**
   * Get a specific user
   */
  async getUser(userId: number): Promise<OverseerrUser> {
    return this.request<OverseerrUser>(`/user/${userId}`);
  }

  /**
   * Get requests for a specific user
   */
  async getUserRequests(
    userId: number,
    params?: { take?: number; skip?: number }
  ): Promise<OverseerrRequestsResponse> {
    const searchParams = new URLSearchParams();
    if (params?.take) searchParams.set('take', String(params.take));
    if (params?.skip) searchParams.set('skip', String(params.skip));

    const query = searchParams.toString();
    return this.request<OverseerrRequestsResponse>(
      `/user/${userId}/requests${query ? `?${query}` : ''}`
    );
  }

  /**
   * Get movie details from TMDB via Overseerr
   */
  async getMovie(tmdbId: number): Promise<unknown> {
    return this.request<unknown>(`/movie/${tmdbId}`);
  }

  /**
   * Get TV show details from TMDB via Overseerr
   */
  async getTv(tmdbId: number): Promise<unknown> {
    return this.request<unknown>(`/tv/${tmdbId}`);
  }

  /**
   * Search for movies and TV shows
   */
  async search(
    query: string,
    params?: { page?: number; language?: string }
  ): Promise<unknown> {
    const searchParams = new URLSearchParams({ query });
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.language) searchParams.set('language', params.language);

    return this.request<unknown>(`/search?${searchParams.toString()}`);
  }

  // Helper methods
  static formatRequestStatus(status: number): string {
    return REQUEST_STATUS[status] || 'unknown';
  }

  static formatMediaStatus(status: number): string {
    return MEDIA_STATUS[status] || 'unknown';
  }
}
