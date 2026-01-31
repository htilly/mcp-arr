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

  async getActivity(): Promise<unknown> {
    return this.request('get_activity');
  }

  async getHistory(params?: {
    user_id?: number;
    rating_key?: number;
    start?: number;
    length?: number;
    media_type?: string;
    order_column?: string;
    order_dir?: 'asc' | 'desc';
  }): Promise<unknown> {
    const p = params ? Object.fromEntries(
      Object.entries(params).map(([k, v]) => [k, String(v)])
    ) : {};
    return this.request('get_history', p);
  }

  async getLibraries(): Promise<unknown> {
    return this.request('get_libraries');
  }

  async getLibraryNames(): Promise<unknown> {
    return this.request('get_library_names');
  }

  async getServerInfo(): Promise<unknown> {
    return this.request('get_server_info');
  }

  async getHomeStats(params?: { time_range?: number; stats_count?: number }): Promise<unknown> {
    const p = params ? Object.fromEntries(
      Object.entries(params).map(([k, v]) => [k, String(v)])
    ) : {};
    return this.request('get_home_stats', p);
  }

  async getUsers(): Promise<unknown> {
    return this.request('get_users');
  }

  async getRecentlyAdded(params?: { count?: number; start?: number; section_id?: string }): Promise<unknown> {
    const p = params ? Object.fromEntries(
      Object.entries(params).map(([k, v]) => [k, String(v)])
    ) : {};
    return this.request('get_recently_added', p);
  }

  async getServerStatus(): Promise<unknown> {
    return this.request('server_status');
  }

  async terminateSession(sessionKey: string, sessionId: string): Promise<unknown> {
    return this.request('terminate_session', {
      session_key: sessionKey,
      session_id: sessionId,
    });
  }
}
