/**
 * Plex Media Server API Client
 *
 * Direct control of a Plex Media Server (library scans, metadata refresh,
 * sessions and transcode decisions, background activities). Tautulli covers
 * history and statistics; this client is about the server itself.
 *
 * API: http://IP:32400/... Auth via the X-Plex-Token header (never as a query
 * parameter, so the token cannot end up in a logged or echoed URL). Responses
 * are requested as JSON (Accept: application/json) and wrapped in MediaContainer.
 */

import { TlsTrustError, type FetchLike } from './tls-trust.js';

export interface PlexConfig {
  url: string;
  /** X-Plex-Token (PLEX_TOKEN). */
  token: string;
  /** fetch to use, e.g. pinned to a self-signed certificate (tls-trust.ts). */
  fetch?: FetchLike;
}

type QueryValue = string | number | boolean | undefined;

export interface PlexStream {
  id?: number;
  /** 1 = video, 2 = audio, 3 = subtitle */
  streamType?: number;
  codec?: string;
  displayTitle?: string;
  extendedDisplayTitle?: string;
  language?: string;
  languageCode?: string;
  channels?: number;
  audioChannelLayout?: string;
  bitrate?: number;
  height?: number;
  width?: number;
  bitDepth?: number;
  profile?: string;
  DOVIPresent?: boolean;
  colorTrc?: string;
  selected?: boolean;
  default?: boolean;
  forced?: boolean;
  /** Only in sessions: copy / transcode / burn */
  decision?: string;
  location?: string;
  [key: string]: unknown;
}

export interface PlexPart {
  id?: number;
  file?: string;
  size?: number;
  container?: string;
  duration?: number;
  decision?: string;
  selected?: boolean;
  Stream?: PlexStream[];
}

export interface PlexMedia {
  id?: number;
  duration?: number;
  bitrate?: number;
  width?: number;
  height?: number;
  container?: string;
  videoCodec?: string;
  audioCodec?: string;
  audioChannels?: number;
  videoResolution?: string;
  videoDynamicRange?: string;
  selected?: boolean;
  Part?: PlexPart[];
}

export interface PlexTranscodeSession {
  key?: string;
  throttled?: boolean;
  complete?: boolean;
  progress?: number;
  speed?: number;
  duration?: number;
  context?: string;
  sourceVideoCodec?: string;
  sourceAudioCodec?: string;
  videoDecision?: string;
  audioDecision?: string;
  subtitleDecision?: string;
  protocol?: string;
  container?: string;
  sourceContainer?: string;
  videoCodec?: string;
  audioCodec?: string;
  audioChannels?: number;
  width?: number;
  height?: number;
  transcodeHwRequested?: boolean;
  transcodeHwDecoding?: string;
  transcodeHwEncoding?: string;
  transcodeHwFullPipeline?: boolean;
  timeStamp?: number;
  maxOffsetAvailable?: number;
  minOffsetAvailable?: number;
}

export interface PlexMetadata {
  ratingKey?: string;
  key?: string;
  guid?: string;
  type?: string;
  title?: string;
  parentTitle?: string;
  grandparentTitle?: string;
  index?: number;
  parentIndex?: number;
  year?: number;
  summary?: string;
  librarySectionID?: number;
  librarySectionTitle?: string;
  duration?: number;
  viewOffset?: number;
  addedAt?: number;
  updatedAt?: number;
  originallyAvailableAt?: string;
  contentRating?: string;
  rating?: number;
  audienceRating?: number;
  studio?: string;
  leafCount?: number;
  childCount?: number;
  Guid?: { id: string }[];
  Genre?: { tag: string }[];
  Media?: PlexMedia[];
  // Session-only fields (/status/sessions)
  sessionKey?: string;
  User?: { id?: string; title?: string };
  Player?: {
    title?: string;
    product?: string;
    platform?: string;
    platformVersion?: string;
    device?: string;
    model?: string;
    state?: string;
    local?: boolean;
    relayed?: boolean;
    secure?: boolean;
    machineIdentifier?: string;
    address?: string;
  };
  Session?: { id?: string; bandwidth?: number; location?: string };
  TranscodeSession?: PlexTranscodeSession;
  [key: string]: unknown;
}

export interface PlexServerIdentity {
  friendlyName?: string;
  machineIdentifier?: string;
  version?: string;
  platform?: string;
  platformVersion?: string;
  myPlex?: boolean;
  myPlexUsername?: string;
  myPlexSubscription?: boolean;
  transcoderActiveVideoSessions?: number;
  transcoderVideo?: boolean;
  transcoderAudio?: boolean;
  transcoderVideoBitrates?: string;
  transcoderVideoQualities?: string;
  transcoderVideoResolutions?: string;
  streamingBrainVersion?: number;
  updatedAt?: number;
  [key: string]: unknown;
}

export interface PlexSection {
  key: string;
  type?: string;
  title?: string;
  agent?: string;
  scanner?: string;
  language?: string;
  uuid?: string;
  refreshing?: boolean;
  scannedAt?: number;
  updatedAt?: number;
  createdAt?: number;
  contentChangedAt?: number;
  hidden?: number;
  Location?: { id?: number; path: string }[];
}

export interface PlexHub {
  type?: string;
  hubIdentifier?: string;
  title?: string;
  size?: number;
  Metadata?: PlexMetadata[];
  Directory?: PlexMetadata[];
}

export interface PlexActivity {
  uuid: string;
  type?: string;
  cancellable?: boolean;
  userID?: number;
  title?: string;
  subtitle?: string;
  progress?: number;
  Context?: { librarySectionID?: string; [key: string]: unknown };
}

export interface PlexButlerTask {
  name: string;
  title?: string;
  description?: string;
  enabled?: boolean;
  interval?: number;
  scheduleRandomized?: boolean;
}

interface MediaContainer<T = unknown> {
  MediaContainer?: T & { size?: number; totalSize?: number };
}

/** Plex rating keys and library section ids are plain integers. */
const NUMERIC_ID = /^[0-9]{1,12}$/;
/** Session.id from /status/sessions (letters and digits). */
const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;
/** Activity uuids. */
const ACTIVITY_ID = /^[A-Za-z0-9-]{1,64}$/;

/** Remove an X-Plex-Token that ended up in a URL or message. */
export function redactPlexToken(text: string, token?: string): string {
  let result = text.replace(/(x-plex-token[=:]\s*)[^&\s"']+/gi, '$1[REDACTED]');
  if (token) result = result.split(token).join('[REDACTED]');
  return result;
}

export class PlexClient {
  private url: string;
  private token: string;
  private readonly fetch: FetchLike;

  constructor(config: PlexConfig) {
    this.url = config.url.replace(/\/+$/, '');
    this.token = config.token;
    this.fetch = config.fetch ?? fetch;
  }

  static checkNumericId(value: string | number, what: string): string {
    const s = String(value);
    if (!NUMERIC_ID.test(s)) throw new Error(`${what} must be a number (Plex ${what})`);
    return s;
  }

  static checkSessionId(value: string): string {
    if (!SESSION_ID.test(value)) throw new Error('sessionId must be the Session.id from plex_get_sessions (letters and digits only)');
    return value;
  }

  static checkActivityId(value: string): string {
    if (!ACTIVITY_ID.test(value)) throw new Error('activity uuid must contain letters, digits and dashes only');
    return value;
  }

  private async request<T = unknown>(
    method: 'GET' | 'PUT' | 'POST' | 'DELETE',
    path: string,
    options: { query?: Record<string, QueryValue>; headers?: Record<string, string> } = {}
  ): Promise<T> {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) search.append(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value));
    }
    const qs = search.toString();
    const url = `${this.url}${path}${qs ? `?${qs}` : ''}`;

    let response: Response;
    try {
      response = await this.fetch(url, {
        method,
        headers: {
          'X-Plex-Token': this.token,
          'X-Plex-Product': 'mcp-arr',
          'X-Plex-Client-Identifier': 'mcp-arr',
          Accept: 'application/json',
          ...options.headers,
        },
      });
    } catch (error) {
      if (error instanceof TlsTrustError) throw error;
      // Keep the cause code (ECONNREFUSED, ...) for callers, never the URL.
      const err = error as Error & { cause?: { code?: string } };
      const wrapped = new Error(`Plex request failed${err.cause?.code ? ` (${err.cause.code})` : ''}`) as Error & { cause?: unknown };
      wrapped.cause = err.cause;
      throw wrapped;
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error(`Plex API error: ${response.status} - check PLEX_TOKEN`);
      }
      if (response.status === 404) throw new Error('Plex API error: 404 Not Found - no such item, section or session');
      // Plex error bodies are HTML/XML pages; never pass them on.
      throw new Error(`Plex API error: ${response.status} ${response.statusText}`);
    }

    const text = await response.text();
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      // Some write endpoints answer with an empty XML container.
      return undefined as T;
    }
  }

  private async container<T>(path: string, query?: Record<string, QueryValue>, headers?: Record<string, string>) {
    const res = await this.request<MediaContainer<T>>('GET', path, { query, headers });
    return (res?.MediaContainer ?? {}) as T & { size?: number; totalSize?: number };
  }

  // Server

  /** GET / - server identity, version, platform and transcoder capabilities. */
  async getIdentity(): Promise<PlexServerIdentity> {
    return this.container<PlexServerIdentity>('/');
  }

  // Libraries

  /** GET /library/sections */
  async getSections(): Promise<PlexSection[]> {
    return (await this.container<{ Directory?: PlexSection[] }>('/library/sections')).Directory ?? [];
  }

  /** Number of top-level items in a section (movies, shows, artists): GET /library/sections/{id}/all with a container size of 0. */
  async getSectionItemCount(sectionId: string | number): Promise<number | undefined> {
    const id = PlexClient.checkNumericId(sectionId, 'section id');
    const mc = await this.container(`/library/sections/${id}/all`, undefined, {
      'X-Plex-Container-Start': '0',
      'X-Plex-Container-Size': '0',
    });
    return mc.totalSize ?? mc.size;
  }

  /**
   * GET /library/sections/{id}/refresh[?path=...][&force=1]
   * A path must lie inside one of the section's folders (checked against /library/sections),
   * so a scan cannot be pointed at an arbitrary directory.
   */
  async scanSection(sectionId: string | number, options: { path?: string; force?: boolean } = {}): Promise<void> {
    const id = PlexClient.checkNumericId(sectionId, 'section id');
    let path: string | undefined;
    if (options.path !== undefined) {
      path = options.path.trim();
      // eslint-disable-next-line no-control-regex
      if (!path || path.length > 1024 || /[\u0000-\u001f]/.test(path)) throw new Error('path must be a folder path inside the library');
      const segments = path.split(/[\\/]+/);
      if (segments.includes('..')) throw new Error('path must not contain ".."');
      const section = (await this.getSections()).find(s => String(s.key) === id);
      if (!section) throw new Error(`Plex library section ${id} not found`);
      const roots = (section.Location ?? []).map(l => l.path.replace(/[\\/]+$/, ''));
      const inside = roots.some(root => path === root || path!.startsWith(`${root}/`) || path!.startsWith(`${root}\\`));
      if (!inside) {
        throw new Error(`path is not inside library "${section.title ?? id}" (folders: ${roots.join(', ') || 'none'})`);
      }
    }
    await this.request('GET', `/library/sections/${id}/refresh`, { query: { path, force: options.force ? 1 : undefined } });
  }

  /** PUT /library/sections/{id}/emptyTrash - permanently removes items whose files are gone. */
  async emptyTrash(sectionId: string | number): Promise<void> {
    const id = PlexClient.checkNumericId(sectionId, 'section id');
    await this.request('PUT', `/library/sections/${id}/emptyTrash`);
  }

  /** GET /library/recentlyAdded or /library/sections/{id}/recentlyAdded */
  async getRecentlyAdded(options: { sectionId?: string | number; limit?: number } = {}): Promise<PlexMetadata[]> {
    const path = options.sectionId === undefined
      ? '/library/recentlyAdded'
      : `/library/sections/${PlexClient.checkNumericId(options.sectionId, 'section id')}/recentlyAdded`;
    const size = String(Math.min(Math.max(1, options.limit ?? 20), 100));
    const mc = await this.container<{ Metadata?: PlexMetadata[] }>(path, undefined, {
      'X-Plex-Container-Start': '0',
      'X-Plex-Container-Size': size,
    });
    return (mc.Metadata ?? []).slice(0, Number(size));
  }

  // Items

  /** GET /library/metadata/{ratingKey} - includes Media/Part/Stream (codecs, audio and subtitle tracks). */
  async getItem(ratingKey: string | number): Promise<PlexMetadata | undefined> {
    const key = PlexClient.checkNumericId(ratingKey, 'ratingKey');
    return (await this.container<{ Metadata?: PlexMetadata[] }>(`/library/metadata/${key}`)).Metadata?.[0];
  }

  /** GET /library/metadata/{ratingKey}/children - seasons of a show, episodes of a season, tracks of an album. */
  async getChildren(ratingKey: string | number): Promise<PlexMetadata[]> {
    const key = PlexClient.checkNumericId(ratingKey, 'ratingKey');
    return (await this.container<{ Metadata?: PlexMetadata[] }>(`/library/metadata/${key}/children`)).Metadata ?? [];
  }

  /** PUT /library/metadata/{ratingKey}/refresh[?force=1] - re-read metadata from the agents (and local files). */
  async refreshItem(ratingKey: string | number, force = false): Promise<void> {
    const key = PlexClient.checkNumericId(ratingKey, 'ratingKey');
    await this.request('PUT', `/library/metadata/${key}/refresh`, { query: { force: force ? 1 : undefined } });
  }

  /** GET /hubs/search?query=&limit= - results grouped by type (movie, show, episode, artist, ...). */
  async search(query: string, limit = 10): Promise<PlexHub[]> {
    const mc = await this.container<{ Hub?: PlexHub[] }>('/hubs/search', {
      query,
      limit: Math.min(Math.max(1, limit), 50),
      includeCollections: 0,
      includeExternalMedia: 0,
    });
    return mc.Hub ?? [];
  }

  // Playback

  /** GET /status/sessions - what is playing now, with Player, User, Session and TranscodeSession. */
  async getSessions(): Promise<PlexMetadata[]> {
    return (await this.container<{ Metadata?: PlexMetadata[] }>('/status/sessions')).Metadata ?? [];
  }

  /** GET /transcode/sessions */
  async getTranscodeSessions(): Promise<PlexTranscodeSession[]> {
    return (await this.container<{ TranscodeSession?: PlexTranscodeSession[] }>('/transcode/sessions')).TranscodeSession ?? [];
  }

  /**
   * GET /status/sessions/terminate?sessionId=&reason= - stops a stream and shows the reason
   * on the player. Needs Plex Pass on the server owner's account.
   */
  async terminateSession(sessionId: string, reason?: string): Promise<void> {
    const id = PlexClient.checkSessionId(sessionId);
    const text = (reason ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200) || undefined;
    await this.request('GET', '/status/sessions/terminate', { query: { sessionId: id, reason: text } });
  }

  // Background work

  /** GET /activities - running scans, metadata refreshes, media analysis, ... */
  async getActivities(): Promise<PlexActivity[]> {
    return (await this.container<{ Activity?: PlexActivity[] }>('/activities')).Activity ?? [];
  }

  /** DELETE /activities/{uuid} - cancel a cancellable activity. */
  async cancelActivity(uuid: string): Promise<void> {
    await this.request('DELETE', `/activities/${PlexClient.checkActivityId(uuid)}`);
  }

  /** GET /butler - scheduled maintenance tasks. Answers with { ButlerTasks: { ButlerTask: [...] } }. */
  async getButlerTasks(): Promise<PlexButlerTask[]> {
    const res = await this.request<{ ButlerTasks?: { ButlerTask?: PlexButlerTask[] } }>('GET', '/butler');
    return res?.ButlerTasks?.ButlerTask ?? [];
  }

  // Output shaping (shared by tool handlers)

  static title(m: PlexMetadata): string | undefined {
    if (m.type === 'episode' && m.grandparentTitle) {
      const code = m.parentIndex !== undefined && m.index !== undefined
        ? ` S${String(m.parentIndex).padStart(2, '0')}E${String(m.index).padStart(2, '0')}`
        : '';
      return `${m.grandparentTitle}${code} - ${m.title ?? ''}`.trim();
    }
    if (m.type === 'season' && m.parentTitle) return `${m.parentTitle} - ${m.title ?? `Season ${m.index}`}`;
    if (m.type === 'track' && m.grandparentTitle) return `${m.grandparentTitle} - ${m.title ?? ''}`;
    return m.title;
  }

  static plexDate(seconds?: number): string | undefined {
    return seconds ? new Date(seconds * 1000).toISOString() : undefined;
  }

  static streamSummary(s: PlexStream) {
    const kind = s.streamType === 1 ? 'video' : s.streamType === 2 ? 'audio' : s.streamType === 3 ? 'subtitle' : String(s.streamType);
    return {
      kind,
      codec: s.codec,
      title: s.extendedDisplayTitle ?? s.displayTitle,
      language: s.languageCode ?? s.language,
      ...(kind === 'video' ? { resolution: s.height ? `${s.width}x${s.height}` : undefined, bitDepth: s.bitDepth, profile: s.profile, dolbyVision: s.DOVIPresent || undefined, hdr: s.colorTrc === 'smpte2084' || s.colorTrc === 'arib-std-b67' || undefined } : {}),
      ...(kind === 'audio' ? { channels: s.channels, layout: s.audioChannelLayout } : {}),
      ...(kind === 'subtitle' ? { forced: s.forced || undefined, external: s.location === 'sidecar' || undefined } : {}),
      selected: s.selected || undefined,
      decision: s.decision,
    };
  }

  static mediaSummary(m: PlexMedia) {
    return {
      container: m.container,
      videoCodec: m.videoCodec,
      audioCodec: m.audioCodec,
      audioChannels: m.audioChannels,
      resolution: m.videoResolution,
      dynamicRange: m.videoDynamicRange,
      bitrateKbps: m.bitrate,
      parts: (m.Part ?? []).map(p => ({
        file: p.file,
        sizeBytes: p.size,
        streams: (p.Stream ?? []).map(PlexClient.streamSummary),
      })),
    };
  }

  /**
   * Explain a session's playback decision. Plex does not report a reason code in
   * /status/sessions, so this compares source and target codecs and containers.
   */
  static playbackReasons(m: PlexMetadata): string[] {
    const ts = m.TranscodeSession;
    if (!ts) return [];
    const reasons: string[] = [];
    if (ts.videoDecision === 'transcode') {
      if (ts.sourceVideoCodec && ts.videoCodec && ts.sourceVideoCodec !== ts.videoCodec) {
        reasons.push(`video codec ${ts.sourceVideoCodec} transcoded to ${ts.videoCodec} (client cannot play ${ts.sourceVideoCodec}, or a quality/bitrate limit applies)`);
      } else {
        reasons.push('video transcoded without a codec change: usually a quality/bitrate limit, burned-in subtitles or HDR tone mapping');
      }
    }
    if (ts.audioDecision === 'transcode') {
      reasons.push(ts.sourceAudioCodec && ts.audioCodec && ts.sourceAudioCodec !== ts.audioCodec
        ? `audio codec ${ts.sourceAudioCodec} transcoded to ${ts.audioCodec} (client or its audio output cannot play ${ts.sourceAudioCodec})`
        : 'audio transcoded (channel count or bitrate limit)');
    }
    if (ts.subtitleDecision === 'burn') reasons.push('subtitles burned into the video (format not supported by the client), which forces a video transcode');
    if (ts.videoDecision === 'copy' && ts.sourceContainer && ts.container && ts.sourceContainer !== ts.container) {
      reasons.push(`container ${ts.sourceContainer} remuxed to ${ts.container} (direct stream)`);
    }
    return reasons;
  }

  static sessionSummary(m: PlexMetadata) {
    const ts = m.TranscodeSession;
    const media = m.Media?.[0];
    const part = media?.Part?.[0];
    const decision = !ts
      ? 'direct play'
      : ts.videoDecision === 'transcode' || ts.audioDecision === 'transcode' || ts.subtitleDecision === 'burn'
        ? 'transcode'
        : 'direct stream';
    return {
      sessionId: m.Session?.id,
      sessionKey: m.sessionKey,
      user: m.User?.title,
      title: PlexClient.title(m),
      ratingKey: m.ratingKey,
      type: m.type,
      state: m.Player?.state,
      progressPercent: m.duration && m.viewOffset !== undefined ? Math.round((m.viewOffset / m.duration) * 100) : undefined,
      player: {
        name: m.Player?.title,
        product: m.Player?.product,
        platform: m.Player?.platform,
        platformVersion: m.Player?.platformVersion,
        device: m.Player?.device,
        model: m.Player?.model,
        local: m.Player?.local,
        relayed: m.Player?.relayed || undefined,
      },
      bandwidthKbps: m.Session?.bandwidth,
      location: m.Session?.location,
      decision,
      reasons: PlexClient.playbackReasons(m),
      video: ts
        ? { decision: ts.videoDecision ?? 'copy', from: ts.sourceVideoCodec, to: ts.videoCodec, hwDecoding: ts.transcodeHwDecoding, hwEncoding: ts.transcodeHwEncoding }
        : { decision: 'direct play', codec: media?.videoCodec },
      audio: ts
        ? { decision: ts.audioDecision ?? 'copy', from: ts.sourceAudioCodec, to: ts.audioCodec, channels: ts.audioChannels }
        : { decision: 'direct play', codec: media?.audioCodec },
      subtitles: ts?.subtitleDecision,
      transcode: ts ? { progress: ts.progress, speed: ts.speed, throttled: ts.throttled, container: ts.container, protocol: ts.protocol } : undefined,
      source: media ? {
        container: media.container,
        resolution: media.videoResolution,
        bitrateKbps: media.bitrate,
        streams: (part?.Stream ?? []).map(PlexClient.streamSummary),
      } : undefined,
    };
  }
}
