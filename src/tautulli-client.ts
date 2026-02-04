/**
 * Tautulli API v2 Client
 *
 * Tautulli monitors Plex and provides statistics, activity, and history.
 * API: http://IP:PORT/api/v2?apikey=KEY&cmd=COMMAND
 */

export interface TautulliConfig {
  url: string;
  apiKey: string;
}

export interface TautulliResponse<T = unknown> {
  response: {
    result: string;
    message: string | null;
    data: T;
  };
}

export class TautulliClient {
  private config: TautulliConfig;
  private baseUrl: string;

  constructor(config: TautulliConfig) {
    this.config = {
      url: config.url.replace(/\/$/, ''),
      apiKey: config.apiKey,
    };
    this.baseUrl = `${this.config.url}/api/v2`;
  }

  async request<T = unknown>(cmd: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
    const entries: [string, string][] = [
      ['apikey', this.config.apiKey],
      ['cmd', cmd],
      ...Object.entries(params)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)] as [string, string]),
    ];
    const search = new URLSearchParams(entries);
    const url = `${this.baseUrl}?${search.toString()}`;
    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Tautulli API error: ${response.status} ${response.statusText} - ${text}`);
    }
    const json = (await response.json()) as TautulliResponse<T>;
    if (json.response?.result === 'error') {
      throw new Error(json.response.message || 'Tautulli API error');
    }
    return json.response.data as T;
  }

  /**
   * Get current Plex activity (active streams).
   */
  async getActivity(): Promise<unknown> {
    return this.request('get_activity');
  }

  /**
   * Search Plex library for a title (movies, series, etc.).
   * Returns whether the title exists in the library regardless of watch history.
   */
  async searchLibrary(query: string, limit?: number): Promise<{ results_count: number; results_list: Record<string, unknown[]> }> {
    const params: Record<string, string | number> = { query };
    if (limit != null && limit > 0) params.limit = limit;
    return this.request('search', params) as Promise<{ results_count: number; results_list: Record<string, unknown[]> }>;
  }

  /**
   * Get watch history with optional filters.
   * @param params.user_id - Filter by user ID
   * @param params.rating_key - Filter by media rating key
   * @param params.start - Starting row for pagination
   * @param params.length - Number of rows to return
   * @param params.search - Search string to filter results
   * @param params.media_type - Filter by media type (movie, episode, etc.)
   * @param params.order_column - Column to sort by (e.g., 'date')
   * @param params.order_dir - Sort direction ('asc' or 'desc')
   */
  async getHistory(params?: {
    user_id?: number;
    rating_key?: number;
    start?: number;
    length?: number;
    search?: string;
    media_type?: string;
    order_column?: string;
    order_dir?: 'asc' | 'desc';
  }): Promise<unknown> {
    const p = params ? Object.fromEntries(
      Object.entries(params)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)])
    ) : {};
    return this.request('get_history', p);
  }

  /**
   * Get all Plex libraries with details (section ID, name, type, etc.).
   */
  async getLibraries(): Promise<unknown> {
    return this.request('get_libraries');
  }

  /**
   * Get library names only (lightweight version of getLibraries).
   */
  async getLibraryNames(): Promise<unknown> {
    return this.request('get_library_names');
  }

  /**
   * Get Plex server information (name, version, platform, etc.).
   */
  async getServerInfo(): Promise<unknown> {
    return this.request('get_server_info');
  }

  /**
   * Get home statistics (top users, most watched, etc.).
   * @param params.time_range - Number of days to include (default: 30)
   * @param params.stats_count - Number of items per stat category
   */
  async getHomeStats(params?: { time_range?: number; stats_count?: number }): Promise<unknown> {
    const p = params ? Object.fromEntries(
      Object.entries(params)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)])
    ) : {};
    return this.request('get_home_stats', p);
  }

  /**
   * Get all Plex users known to Tautulli.
   */
  async getUsers(): Promise<unknown> {
    return this.request('get_users');
  }

  /**
   * Get recently added media to Plex.
   * @param params.count - Number of items to return
   * @param params.start - Starting index for pagination
   * @param params.section_id - Filter by library section ID
   */
  async getRecentlyAdded(params?: { count?: number; start?: number; section_id?: string }): Promise<unknown> {
    const p = params ? Object.fromEntries(
      Object.entries(params)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)])
    ) : {};
    return this.request('get_recently_added', p);
  }

  /**
   * Get Tautulli and Plex server status.
   */
  async getServerStatus(): Promise<unknown> {
    return this.request('server_status');
  }

  /**
   * Terminate an active Plex stream.
   * @param sessionKey - The session key of the stream
   * @param sessionId - The session ID of the stream
   */
  async terminateSession(sessionKey: string, sessionId: string): Promise<unknown> {
    return this.request('terminate_session', {
      session_key: sessionKey,
      session_id: sessionId,
    });
  }
}
