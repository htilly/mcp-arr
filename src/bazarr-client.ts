/**
 * Bazarr API Client
 *
 * Bazarr is a companion application to Sonarr and Radarr that manages and
 * downloads subtitles.
 * API: http://IP:PORT/api/... (auth via X-API-KEY header)
 */

export interface BazarrConfig {
  url: string;
  apiKey: string;
}

type QueryValue = string | number | boolean | undefined | Array<string | number>;

export interface BazarrSubtitle {
  name?: string;
  code2?: string;
  code3?: string;
  path?: string | null;
  forced?: boolean;
  hi?: boolean;
  file_size?: number | null;
}

export interface BazarrSeries {
  sonarrSeriesId: number;
  title: string;
  year?: string;
  monitored?: boolean;
  profileId?: number | null;
  episodeFileCount?: number;
  episodeMissingCount?: number;
  path?: string;
  tags?: string[];
  seriesType?: string;
  ended?: boolean;
}

export interface BazarrEpisode {
  sonarrSeriesId: number;
  sonarrEpisodeId: number;
  title: string;
  season: number;
  episode: number;
  monitored?: boolean;
  path?: string;
  sceneName?: string | null;
  subtitles?: BazarrSubtitle[];
  missing_subtitles?: BazarrSubtitle[];
}

export interface BazarrMovie {
  radarrId: number;
  title: string;
  year?: string;
  monitored?: boolean;
  profileId?: number | null;
  path?: string;
  sceneName?: string | null;
  subtitles?: BazarrSubtitle[];
  missing_subtitles?: BazarrSubtitle[];
  tags?: string[];
}

export interface BazarrWantedEpisode {
  seriesTitle: string;
  episode_number: string;
  episodeTitle: string;
  sonarrSeriesId: number;
  sonarrEpisodeId: number;
  missing_subtitles?: BazarrSubtitle[];
  sceneName?: string | null;
}

export interface BazarrWantedMovie {
  title: string;
  radarrId: number;
  missing_subtitles?: BazarrSubtitle[];
  sceneName?: string | null;
}

export interface BazarrHistoryItem {
  action?: number;
  title?: string;
  seriesTitle?: string;
  episode_number?: string;
  episodeTitle?: string;
  sonarrSeriesId?: number;
  sonarrEpisodeId?: number;
  radarrId?: number;
  timestamp?: string;
  parsed_timestamp?: string;
  description?: string;
  language?: BazarrSubtitle;
  provider?: string;
  score?: string | null;
  upgradable?: boolean;
}

export interface BazarrProvider {
  name: string;
  status: string;
  retry: string;
}

export interface BazarrLanguage {
  code2: string;
  code3?: string;
  name: string;
  enabled: boolean;
}

export interface BazarrLanguageProfile {
  profileId: number;
  name: string;
  cutoff?: number | null;
  items?: Array<{ id: number; language: string; forced: string; hi: string; audio_exclude?: string }>;
  mustContain?: string[];
  mustNotContain?: string[];
  originalFormat?: boolean | null;
}

export interface BazarrStatus {
  bazarr_version?: string;
  sonarr_version?: string;
  radarr_version?: string;
  operating_system?: string;
  python_version?: string;
  bazarr_directory?: string;
  bazarr_config_directory?: string;
  start_time?: number;
  timezone?: string;
  [key: string]: unknown;
}

export interface BazarrBadges {
  episodes?: number;
  movies?: number;
  providers?: number;
  status?: number;
  sonarr_signalr?: string;
  radarr_signalr?: string;
  announcements?: number;
  [key: string]: unknown;
}

export interface BazarrPaged<T> {
  data: T[];
  total?: number;
}

export class BazarrClient {
  private url: string;
  private apiKey: string;

  constructor(config: BazarrConfig) {
    this.url = config.url.replace(/\/$/, '');
    this.apiKey = config.apiKey;
  }

  private async request<T = unknown>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    query: Record<string, QueryValue> = {}
  ): Promise<T> {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        // Bazarr expects repeated "key[]=value" for list parameters
        for (const v of value) search.append(`${key}[]`, String(v));
      } else {
        search.append(key, String(value));
      }
    }
    const qs = search.toString();
    const url = `${this.url}/api${path}${qs ? `?${qs}` : ''}`;

    const response = await fetch(url, {
      method,
      headers: {
        'X-API-KEY': this.apiKey,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Bazarr API error: 401 Unauthorized - check BAZARR_API_KEY');
      }
      throw new Error(`Bazarr API error: ${response.status} ${response.statusText}`);
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

  private static bool(value: boolean | undefined): string {
    return value ? 'True' : 'False';
  }

  // System

  async getStatus(): Promise<BazarrStatus> {
    const res = await this.request<{ data: BazarrStatus }>('GET', '/system/status');
    return res?.data ?? {};
  }

  async getHealth(): Promise<unknown[]> {
    const res = await this.request<{ data: unknown[] }>('GET', '/system/health');
    return res?.data ?? [];
  }

  async getBadges(): Promise<BazarrBadges> {
    return (await this.request<BazarrBadges>('GET', '/badges')) ?? {};
  }

  async getLanguages(): Promise<BazarrLanguage[]> {
    return (await this.request<BazarrLanguage[]>('GET', '/system/languages')) ?? [];
  }

  async getLanguageProfiles(): Promise<BazarrLanguageProfile[]> {
    return (await this.request<BazarrLanguageProfile[]>('GET', '/system/languages/profiles')) ?? [];
  }

  // Series / episodes

  async getSeries(params: { start?: number; length?: number; seriesIds?: number[] } = {}): Promise<BazarrPaged<BazarrSeries>> {
    const res = await this.request<BazarrPaged<BazarrSeries>>('GET', '/series', {
      start: params.start,
      length: params.length,
      seriesid: params.seriesIds,
    });
    return res ?? { data: [] };
  }

  async getEpisodes(params: { seriesIds?: number[]; episodeIds?: number[] }): Promise<BazarrPaged<BazarrEpisode>> {
    const res = await this.request<BazarrPaged<BazarrEpisode>>('GET', '/episodes', {
      seriesid: params.seriesIds,
      episodeid: params.episodeIds,
    });
    return res ?? { data: [] };
  }

  async getWantedEpisodes(params: { start?: number; length?: number } = {}): Promise<BazarrPaged<BazarrWantedEpisode>> {
    const res = await this.request<BazarrPaged<BazarrWantedEpisode>>('GET', '/episodes/wanted', params);
    return res ?? { data: [] };
  }

  async getEpisodeHistory(params: { start?: number; length?: number } = {}): Promise<BazarrPaged<BazarrHistoryItem>> {
    const res = await this.request<BazarrPaged<BazarrHistoryItem>>('GET', '/episodes/history', params);
    return res ?? { data: [] };
  }

  /** Trigger a search for missing subtitles for a whole series. */
  async searchSeries(seriesId: number): Promise<void> {
    await this.request('PATCH', '/series', { seriesid: seriesId, action: 'search-missing' });
  }

  /** Search and download a subtitle in the given language for one episode. */
  async downloadEpisodeSubtitle(params: {
    seriesId: number;
    episodeId: number;
    language: string;
    forced?: boolean;
    hi?: boolean;
  }): Promise<void> {
    await this.request('PATCH', '/episodes/subtitles', {
      seriesid: params.seriesId,
      episodeid: params.episodeId,
      language: params.language,
      forced: BazarrClient.bool(params.forced),
      hi: BazarrClient.bool(params.hi),
    });
  }

  // Movies

  async getMovies(params: { start?: number; length?: number; radarrIds?: number[] } = {}): Promise<BazarrPaged<BazarrMovie>> {
    const res = await this.request<BazarrPaged<BazarrMovie>>('GET', '/movies', {
      start: params.start,
      length: params.length,
      radarrid: params.radarrIds,
    });
    return res ?? { data: [] };
  }

  async getWantedMovies(params: { start?: number; length?: number } = {}): Promise<BazarrPaged<BazarrWantedMovie>> {
    const res = await this.request<BazarrPaged<BazarrWantedMovie>>('GET', '/movies/wanted', params);
    return res ?? { data: [] };
  }

  async getMovieHistory(params: { start?: number; length?: number } = {}): Promise<BazarrPaged<BazarrHistoryItem>> {
    const res = await this.request<BazarrPaged<BazarrHistoryItem>>('GET', '/movies/history', params);
    return res ?? { data: [] };
  }

  /** Trigger a search for missing subtitles for a movie. */
  async searchMovie(radarrId: number): Promise<void> {
    await this.request('PATCH', '/movies', { radarrid: radarrId, action: 'search-missing' });
  }

  /** Search and download a subtitle in the given language for one movie. */
  async downloadMovieSubtitle(params: {
    radarrId: number;
    language: string;
    forced?: boolean;
    hi?: boolean;
  }): Promise<void> {
    await this.request('PATCH', '/movies/subtitles', {
      radarrid: params.radarrId,
      language: params.language,
      forced: BazarrClient.bool(params.forced),
      hi: BazarrClient.bool(params.hi),
    });
  }

  // Providers

  async getProviders(): Promise<BazarrProvider[]> {
    const res = await this.request<{ data: BazarrProvider[] }>('GET', '/providers');
    return res?.data ?? [];
  }

  /** Reset throttled providers so Bazarr retries them immediately. */
  async resetProviders(): Promise<void> {
    await this.request('POST', '/providers', { action: 'reset' });
  }

  /** Compact representation of a subtitle entry, e.g. "en", "en:forced", "en:hi". */
  static formatSubtitle(sub: BazarrSubtitle): string {
    const code = sub.code2 || sub.code3 || sub.name || '?';
    return `${code}${sub.forced ? ':forced' : ''}${sub.hi ? ':hi' : ''}`;
  }
}
