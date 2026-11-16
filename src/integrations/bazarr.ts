/**
 * Bazarr (subtitles). Enabled with BAZARR_URL and BAZARR_API_KEY.
 * Series and episode IDs are Sonarr IDs; movie IDs are Radarr IDs.
 */

import type { CallToolResult, Tool, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { BazarrClient, BazarrSubtitle } from "../bazarr-client.js";
import { IntegrationDefinition, jsonText, textError } from "../integration.js";

const READ_ONLY: ToolAnnotations = { readOnlyHint: true, openWorldHint: true };
// Starts a subtitle search; may download subtitles.
const TRIGGERS_SEARCH: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
// Downloads a subtitle file, replacing any existing subtitle for that language.
const REPLACES_SUBTITLE: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };
// Clears provider throttling; repeating it leaves the same state.
const RESETS_PROVIDERS: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true };

const pagingProps = {
  start: { type: "integer", minimum: 0, description: "Number of items to skip (default: 0)" },
  length: { type: "integer", minimum: 1, maximum: 200, description: "Maximum number of items to return (default: 50, max: 200)" },
};
const subtitleProps = {
  language: { type: "string", pattern: "^[A-Za-z]{2,3}(-[A-Za-z]{2,4})?$", description: "Language code (ISO 639-1, e.g. 'en', 'sv'). Must be enabled in Bazarr (see bazarr_get_languages)" },
  forced: { type: "boolean", description: "Download a forced subtitle (default: false)" },
  hi: { type: "boolean", description: "Download a hearing-impaired subtitle (default: false)" },
};
const noArgs = { type: "object" as const, properties: {}, required: [] };

const TOOLS: Tool[] = [
  {
    name: "bazarr_status",
    annotations: READ_ONLY,
    description: "Get Bazarr system status (Bazarr, Sonarr and Radarr versions, OS, etc.)",
    inputSchema: noArgs,
  },
  {
    name: "bazarr_get_health",
    annotations: READ_ONLY,
    description: "Get Bazarr health check issues",
    inputSchema: noArgs,
  },
  {
    name: "bazarr_get_badges",
    annotations: READ_ONLY,
    description: "Get Bazarr summary counts: episodes and movies with missing subtitles, provider issues, health issues, Sonarr/Radarr connection state",
    inputSchema: noArgs,
  },
  {
    name: "bazarr_get_series",
    annotations: READ_ONLY,
    description: "Get TV series known to Bazarr with subtitle language profile and missing-subtitle episode counts. Use the returned sonarrSeriesId with other bazarr_* tools.",
    inputSchema: {
      type: "object" as const,
      properties: {
        ...pagingProps,
        seriesIds: { type: "array", items: { type: "integer", minimum: 1 }, minItems: 1, maxItems: 100, description: "Only return these Sonarr series IDs" },
      },
      required: [],
    },
  },
  {
    name: "bazarr_get_episodes",
    annotations: READ_ONLY,
    description: "Get episodes of a series with existing and missing subtitles",
    inputSchema: {
      type: "object" as const,
      properties: {
        seriesId: { type: "integer", minimum: 1, description: "Sonarr series ID" },
        season: { type: "integer", minimum: 0, description: "Only return this season" },
      },
      required: ["seriesId"],
    },
  },
  {
    name: "bazarr_get_movies",
    annotations: READ_ONLY,
    description: "Get movies known to Bazarr with existing and missing subtitles. Use the returned radarrId with other bazarr_* tools.",
    inputSchema: {
      type: "object" as const,
      properties: {
        ...pagingProps,
        radarrIds: { type: "array", items: { type: "integer", minimum: 1 }, minItems: 1, maxItems: 100, description: "Only return these Radarr movie IDs" },
      },
      required: [],
    },
  },
  {
    name: "bazarr_get_wanted_episodes",
    annotations: READ_ONLY,
    description: "Get episodes that are missing subtitles",
    inputSchema: { type: "object" as const, properties: { ...pagingProps }, required: [] },
  },
  {
    name: "bazarr_get_wanted_movies",
    annotations: READ_ONLY,
    description: "Get movies that are missing subtitles",
    inputSchema: { type: "object" as const, properties: { ...pagingProps }, required: [] },
  },
  {
    name: "bazarr_get_history",
    annotations: READ_ONLY,
    description: "Get Bazarr subtitle history (downloads, upgrades, manual actions)",
    inputSchema: {
      type: "object" as const,
      properties: {
        type: { type: "string", enum: ["episodes", "movies"], description: "History type (default: episodes)" },
        ...pagingProps,
      },
      required: [],
    },
  },
  {
    name: "bazarr_search_series",
    annotations: TRIGGERS_SEARCH,
    description: "Trigger Bazarr to search for and download all missing subtitles of a series",
    inputSchema: {
      type: "object" as const,
      properties: { seriesId: { type: "integer", minimum: 1, description: "Sonarr series ID" } },
      required: ["seriesId"],
    },
  },
  {
    name: "bazarr_search_movie",
    annotations: TRIGGERS_SEARCH,
    description: "Trigger Bazarr to search for and download all missing subtitles of a movie",
    inputSchema: {
      type: "object" as const,
      properties: { radarrId: { type: "integer", minimum: 1, description: "Radarr movie ID" } },
      required: ["radarrId"],
    },
  },
  {
    name: "bazarr_download_episode_subtitle",
    annotations: REPLACES_SUBTITLE,
    description: "Search and download a subtitle in a specific language for one episode. Replaces an existing subtitle for that language.",
    inputSchema: {
      type: "object" as const,
      properties: {
        seriesId: { type: "integer", minimum: 1, description: "Sonarr series ID" },
        episodeId: { type: "integer", minimum: 1, description: "Sonarr episode ID" },
        ...subtitleProps,
      },
      required: ["seriesId", "episodeId", "language"],
    },
  },
  {
    name: "bazarr_download_movie_subtitle",
    annotations: REPLACES_SUBTITLE,
    description: "Search and download a subtitle in a specific language for one movie. Replaces an existing subtitle for that language.",
    inputSchema: {
      type: "object" as const,
      properties: {
        radarrId: { type: "integer", minimum: 1, description: "Radarr movie ID" },
        ...subtitleProps,
      },
      required: ["radarrId", "language"],
    },
  },
  {
    name: "bazarr_get_providers",
    annotations: READ_ONLY,
    description: "Get subtitle provider status (throttled providers and when they will be retried)",
    inputSchema: noArgs,
  },
  {
    name: "bazarr_reset_providers",
    annotations: RESETS_PROVIDERS,
    description: "Reset throttled subtitle providers so Bazarr retries them immediately",
    inputSchema: noArgs,
  },
  {
    name: "bazarr_get_languages",
    annotations: READ_ONLY,
    description: "Get enabled subtitle languages and language profiles configured in Bazarr",
    inputSchema: noArgs,
  }
];

async function callTool(client: BazarrClient, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  switch (name) {
    case "bazarr_status": {
      return jsonText(await client.getStatus());
    }

    case "bazarr_get_health": {
      const issues = await client.getHealth();
      return jsonText({ count: issues.length, issues });
    }

    case "bazarr_get_badges": {
      const b = await client.getBadges();
      return jsonText({
        episodesMissingSubtitles: b.episodes,
        moviesMissingSubtitles: b.movies,
        providerIssues: b.providers,
        healthIssues: b.status,
        sonarrSignalR: b.sonarr_signalr,
        radarrSignalR: b.radarr_signalr,
      });
    }

    case "bazarr_get_series": {
      const input = args as { start?: unknown; length?: unknown; seriesIds?: unknown };
      const paging = bazarrPaging(input);
      if (typeof paging === "string") return textError(paging);
      const seriesIds = bazarrIdList(input.seriesIds, "seriesIds");
      if (typeof seriesIds === "string") return textError(seriesIds);
      const res = await client.getSeries({ ...paging, seriesIds });
      return jsonText({
        total: res.total ?? res.data.length,
        returned: res.data.length,
        series: res.data.map(s => ({
          sonarrSeriesId: s.sonarrSeriesId,
          title: s.title,
          year: s.year,
          monitored: s.monitored,
          profileId: s.profileId,
          episodeFileCount: s.episodeFileCount,
          episodesMissingSubtitles: s.episodeMissingCount,
        })),
      });
    }

    case "bazarr_get_episodes": {
      const { seriesId, season } = args as { seriesId: unknown; season?: unknown };
      if (!isPositiveId(seriesId)) return textError("seriesId must be a positive integer");
      if (season !== undefined && (!Number.isSafeInteger(season) || (season as number) < 0)) {
        return textError("season must be a non-negative integer");
      }
      const res = await client.getEpisodes({ seriesIds: [seriesId] });
      const episodes = res.data
        .filter(e => season === undefined || e.season === season)
        .sort((x, y) => x.season - y.season || x.episode - y.episode);
      return jsonText({
        count: episodes.length,
        episodes: episodes.map(e => ({
          sonarrEpisodeId: e.sonarrEpisodeId,
          season: e.season,
          episode: e.episode,
          title: e.title,
          monitored: e.monitored,
          subtitles: formatBazarrSubs(e.subtitles),
          missingSubtitles: formatBazarrSubs(e.missing_subtitles),
        })),
      });
    }

    case "bazarr_get_movies": {
      const input = args as { start?: unknown; length?: unknown; radarrIds?: unknown };
      const paging = bazarrPaging(input);
      if (typeof paging === "string") return textError(paging);
      const radarrIds = bazarrIdList(input.radarrIds, "radarrIds");
      if (typeof radarrIds === "string") return textError(radarrIds);
      const res = await client.getMovies({ ...paging, radarrIds });
      return jsonText({
        total: res.total ?? res.data.length,
        returned: res.data.length,
        movies: res.data.map(m => ({
          radarrId: m.radarrId,
          title: m.title,
          year: m.year,
          monitored: m.monitored,
          profileId: m.profileId,
          subtitles: formatBazarrSubs(m.subtitles),
          missingSubtitles: formatBazarrSubs(m.missing_subtitles),
        })),
      });
    }

    case "bazarr_get_wanted_episodes": {
      const paging = bazarrPaging(args as { start?: unknown; length?: unknown });
      if (typeof paging === "string") return textError(paging);
      const res = await client.getWantedEpisodes(paging);
      return jsonText({
        total: res.total ?? res.data.length,
        returned: res.data.length,
        episodes: res.data.map(e => ({
          seriesTitle: e.seriesTitle,
          episode: e.episode_number,
          episodeTitle: e.episodeTitle,
          sonarrSeriesId: e.sonarrSeriesId,
          sonarrEpisodeId: e.sonarrEpisodeId,
          missingSubtitles: formatBazarrSubs(e.missing_subtitles),
        })),
      });
    }

    case "bazarr_get_wanted_movies": {
      const paging = bazarrPaging(args as { start?: unknown; length?: unknown });
      if (typeof paging === "string") return textError(paging);
      const res = await client.getWantedMovies(paging);
      return jsonText({
        total: res.total ?? res.data.length,
        returned: res.data.length,
        movies: res.data.map(m => ({
          title: m.title,
          radarrId: m.radarrId,
          missingSubtitles: formatBazarrSubs(m.missing_subtitles),
        })),
      });
    }

    case "bazarr_get_history": {
      const input = args as { type?: unknown; start?: unknown; length?: unknown };
      if (input.type !== undefined && input.type !== "episodes" && input.type !== "movies") {
        return textError("type must be episodes or movies");
      }
      const paging = bazarrPaging(input);
      if (typeof paging === "string") return textError(paging);
      const isMovies = input.type === "movies";
      const res = isMovies
        ? await client.getMovieHistory(paging)
        : await client.getEpisodeHistory(paging);
      return jsonText({
        type: isMovies ? "movies" : "episodes",
        total: res.total ?? res.data.length,
        returned: res.data.length,
        history: res.data.map(h => ({
          ...(isMovies
            ? { title: h.title, radarrId: h.radarrId }
            : { seriesTitle: h.seriesTitle, episode: h.episode_number, episodeTitle: h.episodeTitle, sonarrSeriesId: h.sonarrSeriesId, sonarrEpisodeId: h.sonarrEpisodeId }),
          timestamp: h.parsed_timestamp ?? h.timestamp,
          description: h.description,
          language: h.language ? BazarrClient.formatSubtitle(h.language) : undefined,
          provider: h.provider,
          score: h.score,
        })),
      });
    }

    case "bazarr_search_series": {
      const { seriesId } = args as { seriesId: unknown };
      if (!isPositiveId(seriesId)) return textError("seriesId must be a positive integer");
      await client.searchSeries(seriesId);
      return jsonText({ success: true, message: `Search for missing subtitles started for series ${seriesId}` });
    }

    case "bazarr_search_movie": {
      const { radarrId } = args as { radarrId: unknown };
      if (!isPositiveId(radarrId)) return textError("radarrId must be a positive integer");
      await client.searchMovie(radarrId);
      return jsonText({ success: true, message: `Search for missing subtitles started for movie ${radarrId}` });
    }

    case "bazarr_download_episode_subtitle": {
      const input = args as { seriesId: unknown; episodeId: unknown; language: unknown; forced?: unknown; hi?: unknown };
      if (!isPositiveId(input.seriesId) || !isPositiveId(input.episodeId)) {
        return textError("seriesId and episodeId must be positive integers");
      }
      const subtitle = bazarrSubtitleArgs(input);
      if (typeof subtitle === "string") return textError(subtitle);
      await client.downloadEpisodeSubtitle({ seriesId: input.seriesId, episodeId: input.episodeId, ...subtitle });
      return jsonText({ success: true, message: `Subtitle search/download for '${subtitle.language}' completed for episode ${input.episodeId}. Check bazarr_get_episodes or bazarr_get_history for the result.` });
    }

    case "bazarr_download_movie_subtitle": {
      const input = args as { radarrId: unknown; language: unknown; forced?: unknown; hi?: unknown };
      if (!isPositiveId(input.radarrId)) return textError("radarrId must be a positive integer");
      const subtitle = bazarrSubtitleArgs(input);
      if (typeof subtitle === "string") return textError(subtitle);
      await client.downloadMovieSubtitle({ radarrId: input.radarrId, ...subtitle });
      return jsonText({ success: true, message: `Subtitle search/download for '${subtitle.language}' completed for movie ${input.radarrId}. Check bazarr_get_movies or bazarr_get_history for the result.` });
    }

    case "bazarr_get_providers": {
      const providers = await client.getProviders();
      return jsonText({ count: providers.length, providers });
    }

    case "bazarr_reset_providers": {
      await client.resetProviders();
      return jsonText({ success: true, message: "Throttled providers reset" });
    }

    case "bazarr_get_languages": {
      const [languages, profiles] = await Promise.all([
        client.getLanguages(),
        client.getLanguageProfiles(),
      ]);
      return jsonText({
        enabledLanguages: languages.filter(l => l.enabled).map(l => ({ code2: l.code2, name: l.name })),
        profiles: profiles.map(p => ({
          profileId: p.profileId,
          name: p.name,
          cutoff: p.cutoff,
          languages: (p.items ?? []).map(i => ({
            language: i.language,
            forced: i.forced === "True",
            hi: i.hi === "True",
          })),
        })),
      });
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// Bazarr argument checks. Each returns the parsed value or an error message.
function isPositiveId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function bazarrPaging(input: { start?: unknown; length?: unknown }): { start: number; length: number } | string {
  const start = input.start ?? 0;
  const length = input.length ?? 50;
  if (!Number.isSafeInteger(start) || (start as number) < 0 ||
    !Number.isSafeInteger(length) || (length as number) < 1 || (length as number) > 200) {
    return "start must be a non-negative integer and length must be 1-200";
  }
  return { start: start as number, length: length as number };
}

function bazarrIdList(value: unknown, name: string): number[] | undefined | string {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > 100 || !value.every(isPositiveId)) {
    return `${name} must be a list of 1-100 positive integers`;
  }
  return value;
}

function bazarrSubtitleArgs(input: { language: unknown; forced?: unknown; hi?: unknown }): { language: string; forced: boolean; hi: boolean } | string {
  if (typeof input.language !== "string" || !/^[A-Za-z]{2,3}(-[A-Za-z]{2,4})?$/.test(input.language)) {
    return "language must be a language code such as 'en' or 'pt-BR'";
  }
  if ((input.forced !== undefined && typeof input.forced !== "boolean") ||
    (input.hi !== undefined && typeof input.hi !== "boolean")) {
    return "forced and hi must be booleans";
  }
  return { language: input.language, forced: input.forced === true, hi: input.hi === true };
}

function formatBazarrSubs(subs?: BazarrSubtitle[]): string[] {
  return (subs ?? []).map(BazarrClient.formatSubtitle);
}

export const bazarr: IntegrationDefinition = {
  name: "bazarr",
  displayName: "Bazarr (Subtitles)",
  envPrefix: "BAZARR",
  create(config) {
    const client = new BazarrClient(config);
    return {
      tools: TOOLS,
      getStatus: async () => ({ version: (await client.getStatus()).bazarr_version }),
      callTool: (name, args) => callTool(client, name, args),
    };
  },
};
