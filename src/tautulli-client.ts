/**
 * Tautulli API v2 Client
 *
 * Tautulli monitors Plex and provides activity, history and statistics.
 * Every call is GET {url}/api/v2?apikey=KEY&cmd=COMMAND; Tautulli wraps the
 * result in { response: { result, message, data } }.
 */

export interface TautulliConfig {
  url: string;
  apiKey: string;
}

interface TautulliResponse<T> {
  response?: {
    result?: string;
    message?: string | null;
    data?: T;
  };
}

export interface TautulliInfo {
  tautulli_version?: string;
  [key: string]: unknown;
}

export interface TautulliHistory {
  recordsFiltered?: number;
  recordsTotal?: number;
  data?: Array<Record<string, unknown>>;
}

export interface TautulliSearchResult {
  results_count?: number;
  results_list?: Record<string, unknown[]>;
}

type Params = Record<string, string | number | undefined>;

export class TautulliClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(config: TautulliConfig) {
    this.baseUrl = `${config.url.replace(/\/$/, '')}/api/v2`;
    this.apiKey = config.apiKey;
  }

  private async request<T>(cmd: string, params: Params = {}): Promise<T> {
    const search = new URLSearchParams({ apikey: this.apiKey, cmd });
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) search.set(key, String(value));
    }
    const response = await fetch(`${this.baseUrl}?${search.toString()}`);
    if (!response.ok) {
      throw new Error(`Tautulli API error: ${response.status} ${response.statusText}`);
    }
    const json = (await response.json()) as TautulliResponse<T>;
    if (json.response?.result !== 'success') {
      throw new Error(`Tautulli API error: ${json.response?.message || 'unexpected response'}`);
    }
    return json.response.data as T;
  }

  async getTautulliInfo(): Promise<TautulliInfo> {
    return this.request('get_tautulli_info');
  }

  async getServerStatus(): Promise<unknown> {
    return this.request('server_status');
  }

  async getServerInfo(): Promise<unknown> {
    return this.request('get_server_info');
  }

  async getActivity(): Promise<unknown> {
    return this.request('get_activity');
  }

  async getHistory(params: {
    user_id?: number;
    section_id?: number;
    search?: string;
    media_type?: string;
    order_column?: string;
    order_dir?: string;
    start?: number;
    length?: number;
  }): Promise<TautulliHistory> {
    return this.request('get_history', params);
  }

  async searchLibrary(query: string, limit: number): Promise<TautulliSearchResult> {
    return this.request('search', { query, limit });
  }

  async getLibraries(): Promise<unknown> {
    return this.request('get_libraries');
  }

  async getHomeStats(params: { time_range?: number; stats_count?: number }): Promise<unknown> {
    return this.request('get_home_stats', params);
  }

  async getUsers(): Promise<unknown> {
    return this.request('get_users');
  }

  async getRecentlyAdded(params: { count: number; start?: number; section_id?: number }): Promise<unknown> {
    return this.request('get_recently_added', params);
  }

  async terminateSession(params: { session_key?: number; session_id?: string; message?: string }): Promise<unknown> {
    return this.request('terminate_session', params);
  }
}
