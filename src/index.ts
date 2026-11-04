#!/usr/bin/env node
/**
 * MCP Server for *arr Media Management Suite + Tautulli + Overseerr + Bazarr
 *
 * Provides tools for managing Sonarr (TV), Radarr (Movies), Lidarr (Music),
 * and Prowlarr (Indexers) through Claude Code, plus optional Tautulli (Plex),
 * Overseerr (requests) and Bazarr (subtitles).
 *
 * Environment variables:
 * - SONARR_URL, SONARR_API_KEY, RADARR_URL, RADARR_API_KEY, etc.
 * - LIDARR_URL, LIDARR_API_KEY
 * - PROWLARR_URL, PROWLARR_API_KEY
 * - TAUTULLI_URL, TAUTULLI_API_KEY
 * - OVERSEERR_URL, OVERSEERR_API_KEY
 * - BAZARR_URL, BAZARR_API_KEY
 *
 * Remote / Docker mode (HTTPS + web UI with passkey login), see README:
 * - MCP_TRANSPORT=http (default: stdio), PUBLIC_URL, PORT, HOST
 * - TLS_MODE (internal|file|acme|off), TLS_SANS, TLS_CA_NAME_CONSTRAINTS, TLS_CERT_FILE, TLS_KEY_FILE, ACME_* (see acme.ts)
 *   - these and OAUTH / TRUST_PROXY can also be changed in the web UI (settings.ts); environment variables win
 * - CONFIG_PATH, CONFIG_ENCRYPTION_KEY, CONFIG_ENCRYPTION_KEY_FILE, CONFIG_ENCRYPTION_KEY_PREVIOUS, KEY_FILE_PATH
 * - ADMIN_RECOVERY, TRUST_PROXY
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "node:fs";
import {
  SonarrClient,
  RadarrClient,
  LidarrClient,
  ProwlarrClient,
  ArrService,
} from "./arr-client.js";
import { trashClient, TrashService } from "./trash-client.js";
import { TautulliClient } from "./tautulli-client.js";
import { OverseerrClient } from "./overseerr-client.js";
import { BazarrClient, BazarrSubtitle } from "./bazarr-client.js";
import { ConfigStore, EffectiveConfig, SERVICE_DEFS } from "./config-store.js";
import { resolve as resolvePath, dirname, join as joinPath } from "node:path";
import { hostname as osHostname, networkInterfaces } from "node:os";
import { stats, CallContext } from "./stats.js";

// Read from package.json rather than hardcoding, so the version reported to
// clients can never drift from the released version. package.json sits at the
// package root in every distribution: npm always ships it, and the Dockerfile
// copies it alongside dist/.
function readServerVersion(): string {
  try {
    const pkgUrl = new URL("../package.json", import.meta.url);
    const pkg = JSON.parse(readFileSync(pkgUrl, "utf8")) as { version?: string };
    if (pkg.version) return pkg.version;
    console.error("[mcp-arr] package.json has no version field");
  } catch (error) {
    console.error(
      `[mcp-arr] could not read version from package.json: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return "0.0.0-unknown";
}

const SERVER_VERSION = readServerVersion();

// Configuration (environment variables and/or config file, see config-store.ts)
interface ServiceConfig {
  name: ArrService;
  displayName: string;
  url?: string;
  apiKey?: string;
}

const ARR_SERVICE_IDS: ArrService[] = ['sonarr', 'radarr', 'lidarr', 'prowlarr'];

let services: ServiceConfig[] = [];
let configuredServices: ServiceConfig[] = [];
let tautulliConfigured = false;
let overseerrConfigured = false;
let bazarrConfigured = false;

const clients: {
  sonarr?: SonarrClient;
  radarr?: RadarrClient;
  lidarr?: LidarrClient;
  prowlarr?: ProwlarrClient;
} = {};

let tautulliClient: TautulliClient | undefined;
let overseerrClient: OverseerrClient | undefined;
let bazarrClient: BazarrClient | undefined;
let statusParts: string[] = [];

const TOOLS: Tool[] = [];

/** True when at least one service has both a URL and an API key. */
function anyServiceConfigured(): boolean {
  return configuredServices.length > 0 || tautulliConfigured || overseerrConfigured || bazarrConfigured;
}

/**
 * (Re)build all service clients and the tool list from the effective configuration.
 * Called at startup and whenever the configuration changes via the web UI.
 */
function applyConfig(config: EffectiveConfig): void {
  services = ARR_SERVICE_IDS.map(id => ({
    name: id,
    displayName: SERVICE_DEFS.find(d => d.id === id)!.displayName,
    url: config[id].url,
    apiKey: config[id].apiKey,
  }));
  configuredServices = services.filter(s => s.url && s.apiKey);

  for (const key of Object.keys(clients) as (keyof typeof clients)[]) delete clients[key];
  for (const service of configuredServices) {
    const cfg = { url: service.url!, apiKey: service.apiKey! };
    switch (service.name) {
      case 'sonarr': clients.sonarr = new SonarrClient(cfg); break;
      case 'radarr': clients.radarr = new RadarrClient(cfg); break;
      case 'lidarr': clients.lidarr = new LidarrClient(cfg); break;
      case 'prowlarr': clients.prowlarr = new ProwlarrClient(cfg); break;
    }
  }

  const t = config.tautulli, o = config.overseerr, b = config.bazarr;
  tautulliConfigured = Boolean(t.url && t.apiKey);
  overseerrConfigured = Boolean(o.url && o.apiKey);
  bazarrConfigured = Boolean(b.url && b.apiKey);
  tautulliClient = tautulliConfigured ? new TautulliClient({ url: t.url!, apiKey: t.apiKey! }) : undefined;
  overseerrClient = overseerrConfigured ? new OverseerrClient({ url: o.url!, apiKey: o.apiKey! }) : undefined;
  bazarrClient = bazarrConfigured ? new BazarrClient({ url: b.url!, apiKey: b.apiKey! }) : undefined;

  statusParts = configuredServices.map(s => s.displayName);
  if (tautulliConfigured) statusParts.push('Tautulli (Plex)');
  if (overseerrConfigured) statusParts.push('Overseerr (Requests)');
  if (bazarrConfigured) statusParts.push('Bazarr (Subtitles)');

  buildTools();
}

function buildTools(): void {
TOOLS.length = 0;
TOOLS.push(
  {
    name: "arr_status",
    description: statusParts.length > 0
      ? `Get status of all configured services. Currently configured: ${statusParts.join(', ')}`
      : "Get status of all supported services. No local services are currently configured, but TRaSH reference tools remain available.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "search",
    description: "Search across configured *arr libraries plus TRaSH Guides reference profiles. This is the primary discovery tool for remote MCP clients such as ChatGPT.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Natural-language search query",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "fetch",
    description: "Fetch a specific item returned by search. Accepts an opaque item id from the search tool.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "Opaque result id returned by search",
        },
      },
      required: ["id"],
    },
  },
);

// Configuration review tools for each service
// These are added dynamically based on configured services

// Helper function to create config tools for a service
function addConfigTools(serviceName: string, displayName: string) {
  TOOLS.push(
    {
      name: `${serviceName}_get_quality_profiles`,
      description: `Get detailed quality profiles from ${displayName}. Shows allowed qualities, upgrade settings, and custom format scores.`,
      inputSchema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: `${serviceName}_get_health`,
      description: `Get health check warnings and issues from ${displayName}. Shows any problems detected by the application.`,
      inputSchema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: `${serviceName}_get_root_folders`,
      description: `Get root folders and storage info from ${displayName}. Shows paths, free space, and unmapped folders.`,
      inputSchema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: `${serviceName}_get_download_clients`,
      description: `Get download client configurations from ${displayName}. Shows configured clients and their settings.`,
      inputSchema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: `${serviceName}_get_naming`,
      description: `Get file naming configuration from ${displayName}. Shows naming patterns for files and folders.`,
      inputSchema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: `${serviceName}_get_tags`,
      description: `Get all tags defined in ${displayName}. Tags can be used to organize and filter content.`,
      inputSchema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: `${serviceName}_review_setup`,
      description: `Get comprehensive configuration review for ${displayName}. Returns all settings for analysis: quality profiles, download clients, naming, storage, indexers, health warnings, and more. Use this to analyze the setup and suggest improvements.`,
      inputSchema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    }
  );
}

// Add config tools for each configured service (except Prowlarr which has different config)
if (clients.sonarr) addConfigTools('sonarr', 'Sonarr (TV)');
if (clients.radarr) addConfigTools('radarr', 'Radarr (Movies)');
if (clients.lidarr) addConfigTools('lidarr', 'Lidarr (Music)');

// Sonarr tools
if (clients.sonarr) {
  TOOLS.push(
    {
      name: "sonarr_get_series",
      description: "Get TV series from Sonarr library with optional pagination, title filtering and sorting. Defaults to limit=25 to avoid very large responses. Use offset to fetch additional pages. Optional sortBy: 'dateAdded' or 'sizeOnDisk' (applied before pagination). Optional sortDir: 'asc' or 'desc'.",
      inputSchema: {
        type: "object" as const,
        properties: {
          sortBy: {
            type: "string",
            enum: ["dateAdded", "sizeOnDisk"],
            description: "Sort by date added or size on disk. Omit for default order.",
          },
          sortDir: {
            type: "string",
            enum: ["asc", "desc"],
            description: "Sort direction: 'asc' (ascending) or 'desc' (descending). Default: 'asc' for dateAdded, 'desc' for sizeOnDisk.",
          },
          limit: {
            type: "number",
            description: "Maximum number of series to return (default: 25, max: 100)",
          },
          offset: {
            type: "number",
            description: "Number of series to skip before returning results (default: 0)",
          },
          search: {
            type: "string",
            description: "Optional case-insensitive title filter",
          },
        },
        required: [],
      },
    },
    {
      name: "sonarr_search",
      description: "Search for TV series by name. Returns results with tvdbId needed for sonarr_add_series.",
      inputSchema: {
        type: "object" as const,
        properties: {
          term: {
            type: "string",
            description: "Search term (show name)",
          },
        },
        required: ["term"],
      },
    },
    {
      name: "sonarr_get_queue",
      description: "Get Sonarr download queue. Supports pagination with limit and offset.",
      inputSchema: {
        type: "object" as const,
        properties: {
          limit: {
            type: "number",
            description: "Maximum number of queue items to return (default: 25, max: 100)",
          },
          offset: {
            type: "number",
            description: "Number of queue items to skip before returning results (default: 0)",
          },
        },
        required: [],
      },
    },
    {
      name: "sonarr_get_calendar",
      description: "Get upcoming TV episodes from Sonarr",
      inputSchema: {
        type: "object" as const,
        properties: {
          days: {
            type: "number",
            description: "Number of days to look ahead (default: 7)",
          },
        },
        required: [],
      },
    },
    {
      name: "sonarr_get_episodes",
      description: "Get episodes for a TV series. Shows which episodes are available and which are missing.",
      inputSchema: {
        type: "object" as const,
        properties: {
          seriesId: {
            type: "number",
            description: "Series ID to get episodes for",
          },
          seasonNumber: {
            type: "number",
            description: "Optional: filter to a specific season",
          },
        },
        required: ["seriesId"],
      },
    },
    {
      name: "sonarr_search_missing",
      description: "Trigger a search for all missing episodes in a series",
      inputSchema: {
        type: "object" as const,
        properties: {
          seriesId: {
            type: "number",
            description: "Series ID to search for missing episodes",
          },
        },
        required: ["seriesId"],
      },
    },
    {
      name: "sonarr_search_episode",
      description: "Trigger a search for specific episode(s)",
      inputSchema: {
        type: "object" as const,
        properties: {
          episodeIds: {
            type: "array",
            items: { type: "number" },
            description: "Episode ID(s) to search for",
          },
        },
        required: ["episodeIds"],
      },
    },
    {
      name: "sonarr_delete_series",
      description: "Delete a TV series from Sonarr (optionally delete files from disk)",
      inputSchema: {
        type: "object" as const,
        properties: {
          seriesId: { type: "number", description: "Series ID to delete" },
          deleteFiles: { type: "boolean", description: "Delete files from disk (default: true)" },
          addImportListExclusion: { type: "boolean", description: "Add to import list exclusion (default: false)" },
        },
        required: ["seriesId"],
      },
    },
    {
      name: "sonarr_refresh_series",
      description: "Trigger a metadata refresh for a specific series in Sonarr",
      inputSchema: {
        type: "object" as const,
        properties: {
          seriesId: {
            type: "number",
            description: "Series ID to refresh",
          },
        },
        required: ["seriesId"],
      },
    },
    {
      name: "sonarr_delete_season",
      description: "Delete all episode files for a specific season of a series",
      inputSchema: {
        type: "object" as const,
        properties: {
          seriesId: { type: "number", description: "Series ID" },
          seasonNumber: { type: "number", description: "Season number to delete" },
        },
        required: ["seriesId", "seasonNumber"],
      },
    },
    {
      name: "sonarr_delete_episode_files",
      description: "Delete specific episode file(s). Use episodeFileId from sonarr_get_episodes.",
      inputSchema: {
        type: "object" as const,
        properties: {
          episodeFileIds: {
            type: "array",
            items: { type: "number" },
            description: "Episode file ID(s) to delete",
          },
        },
        required: ["episodeFileIds"],
      },
    },
    {
      name: "sonarr_add_series",
      description: "Add a TV series to Sonarr. Use sonarr_search first to find the tvdbId, and sonarr_get_root_folders / sonarr_get_quality_profiles to get valid values for rootFolderPath and qualityProfileId. Use sonarr_get_tags to get valid tag IDs.",
      inputSchema: {
        type: "object" as const,
        properties: {
          tvdbId: {
            type: "number",
            description: "TVDB ID from sonarr_search results",
          },
          title: {
            type: "string",
            description: "Series title",
          },
          qualityProfileId: {
            type: "number",
            description: "Quality profile ID from sonarr_get_quality_profiles",
          },
          rootFolderPath: {
            type: "string",
            description: "Root folder path from sonarr_get_root_folders",
          },
          monitored: {
            type: "boolean",
            description: "Whether to monitor the series (default: true)",
          },
          seasonFolder: {
            type: "boolean",
            description: "Whether to use season folders (default: true)",
          },
          tags: {
            type: "array",
            items: { type: "number" },
            description: "Array of tag IDs from sonarr_get_tags (optional)",
          },
        },
        required: ["tvdbId", "title", "qualityProfileId", "rootFolderPath"],
      },
    },
  );
}

// Radarr tools
if (clients.radarr) {
  TOOLS.push(
    {
      name: "radarr_get_movies",
      description: "Get movies from Radarr library with optional pagination, title filtering and sorting. Defaults to limit=25 to avoid very large responses. Use offset to fetch additional pages. Optional sortBy: 'dateAdded' or 'sizeOnDisk' (applied before pagination). Optional sortDir: 'asc' or 'desc'.",
      inputSchema: {
        type: "object" as const,
        properties: {
          sortBy: {
            type: "string",
            enum: ["dateAdded", "sizeOnDisk"],
            description: "Sort by date added or size on disk. Omit for default order.",
          },
          sortDir: {
            type: "string",
            enum: ["asc", "desc"],
            description: "Sort direction: 'asc' (ascending) or 'desc' (descending). Default: 'asc' for dateAdded, 'desc' for sizeOnDisk.",
          },
          limit: {
            type: "number",
            description: "Maximum number of movies to return (default: 25, max: 100)",
          },
          offset: {
            type: "number",
            description: "Number of movies to skip before returning results (default: 0)",
          },
          search: {
            type: "string",
            description: "Optional case-insensitive title filter",
          },
        },
        required: [],
      },
    },
    {
      name: "radarr_search",
      description: "Search for movies by name. Returns results with tmdbId needed for radarr_add_movie.",
      inputSchema: {
        type: "object" as const,
        properties: {
          term: {
            type: "string",
            description: "Search term (movie name)",
          },
        },
        required: ["term"],
      },
    },
    {
      name: "radarr_get_queue",
      description: "Get Radarr download queue. Supports pagination with limit and offset.",
      inputSchema: {
        type: "object" as const,
        properties: {
          limit: {
            type: "number",
            description: "Maximum number of queue items to return (default: 25, max: 100)",
          },
          offset: {
            type: "number",
            description: "Number of queue items to skip before returning results (default: 0)",
          },
        },
        required: [],
      },
    },
    {
      name: "radarr_get_calendar",
      description: "Get upcoming movie releases from Radarr",
      inputSchema: {
        type: "object" as const,
        properties: {
          days: {
            type: "number",
            description: "Number of days to look ahead (default: 30)",
          },
        },
        required: [],
      },
    },
    {
      name: "radarr_search_movie",
      description: "Trigger a search to download a movie that's already in your library",
      inputSchema: {
        type: "object" as const,
        properties: {
          movieId: {
            type: "number",
            description: "Movie ID to search for",
          },
        },
        required: ["movieId"],
      },
    },
    {
      name: "radarr_refresh_movie",
      description: "Trigger a metadata refresh for a specific movie in Radarr",
      inputSchema: {
        type: "object" as const,
        properties: {
          movieId: {
            type: "number",
            description: "Movie ID to refresh",
          },
        },
        required: ["movieId"],
      },
    },
    {
      name: "radarr_add_movie",
      description: "Add a movie to Radarr. Use radarr_search first to find the tmdbId, and radarr_get_root_folders / radarr_get_quality_profiles to get valid values. Use radarr_get_tags to get valid tag IDs.",
      inputSchema: {
        type: "object" as const,
        properties: {
          tmdbId: {
            type: "number",
            description: "TMDB ID from radarr_search results",
          },
          title: {
            type: "string",
            description: "Movie title",
          },
          qualityProfileId: {
            type: "number",
            description: "Quality profile ID from radarr_get_quality_profiles",
          },
          rootFolderPath: {
            type: "string",
            description: "Root folder path from radarr_get_root_folders",
          },
          monitored: {
            type: "boolean",
            description: "Whether to monitor the movie (default: true)",
          },
          minimumAvailability: {
            type: "string",
            enum: ["announced", "inCinemas", "released", "tba"],
            description: "When to consider the movie available (default: announced)",
          },
          tags: {
            type: "array",
            items: { type: "number" },
            description: "Array of tag IDs from radarr_get_tags (optional)",
          },
        },
        required: ["tmdbId", "title", "qualityProfileId", "rootFolderPath"],
      },
    },
    {
      name: "radarr_update_movie",
      description: "Update a movie in Radarr. Can change qualityProfileId, monitored status, minimumAvailability, tags, and path. Fetches the full movie object, applies your changes, and PUTs it back.",
      inputSchema: {
        type: "object" as const,
        properties: {
          movieId: {
            type: "number",
            description: "Movie ID to update",
          },
          qualityProfileId: {
            type: "number",
            description: "New quality profile ID (from radarr_get_quality_profiles)",
          },
          monitored: {
            type: "boolean",
            description: "Whether to monitor the movie",
          },
          minimumAvailability: {
            type: "string",
            enum: ["announced", "inCinemas", "released", "tba"],
            description: "When to consider the movie available",
          },
          tags: {
            type: "array",
            items: { type: "number" },
            description: "Replace all tags with this list of tag IDs",
          },
          path: {
            type: "string",
            description: "New file path for the movie",
          },
        },
        required: ["movieId"],
      },
    },
    {
      name: "radarr_delete_queue_item",
      description: "Remove an item from the Radarr download queue. Use radarr_get_queue to find queue item IDs. Can optionally blocklist the release to prevent re-grabbing.",
      inputSchema: {
        type: "object" as const,
        properties: {
          queueId: {
            type: "number",
            description: "Queue item ID (from radarr_get_queue)",
          },
          removeFromClient: {
            type: "boolean",
            description: "Also remove from download client (default: true)",
          },
          blocklist: {
            type: "boolean",
            description: "Add release to blocklist to prevent re-grabbing (default: false)",
          },
        },
        required: ["queueId"],
      },
    },
    {
      name: "radarr_search_movies",
      description: "Trigger a search for multiple movies at once. Accepts an array of movie IDs. Use this for bulk upgrade requests instead of calling radarr_search_movie one at a time.",
      inputSchema: {
        type: "object" as const,
        properties: {
          movieIds: {
            type: "array",
            items: { type: "number" },
            description: "Array of movie IDs to search for",
          },
        },
        required: ["movieIds"],
      },
    },
    {
      name: "radarr_delete_movie",
      description: "Delete a movie from Radarr (optionally delete files from disk)",
      inputSchema: {
        type: "object" as const,
        properties: {
          movieId: { type: "number", description: "Movie ID to delete" },
          deleteFiles: { type: "boolean", description: "Delete files from disk (default: true)" },
          addImportExclusion: { type: "boolean", description: "Add to import exclusion (default: false)" },
        },
        required: ["movieId"],
      },
    },
  );
}

// Lidarr tools
if (clients.lidarr) {
  TOOLS.push(
    {
      name: "lidarr_get_artists",
      description: "Get all artists in Lidarr library",
      inputSchema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: "lidarr_search",
      description: "Search for artists by name. Returns results with foreignArtistId needed for lidarr_add_artist.",
      inputSchema: {
        type: "object" as const,
        properties: {
          term: {
            type: "string",
            description: "Search term (artist name)",
          },
        },
        required: ["term"],
      },
    },
    {
      name: "lidarr_get_queue",
      description: "Get Lidarr download queue. Supports pagination with limit and offset.",
      inputSchema: {
        type: "object" as const,
        properties: {
          limit: {
            type: "number",
            description: "Maximum number of queue items to return (default: 25, max: 100)",
          },
          offset: {
            type: "number",
            description: "Number of queue items to skip before returning results (default: 0)",
          },
        },
        required: [],
      },
    },
    {
      name: "lidarr_get_albums",
      description: "Get albums for an artist in Lidarr. Shows which albums are available and which are missing.",
      inputSchema: {
        type: "object" as const,
        properties: {
          artistId: {
            type: "number",
            description: "Artist ID to get albums for",
          },
        },
        required: ["artistId"],
      },
    },
    {
      name: "lidarr_search_album",
      description: "Trigger a search for a specific album to download",
      inputSchema: {
        type: "object" as const,
        properties: {
          albumId: {
            type: "number",
            description: "Album ID to search for",
          },
        },
        required: ["albumId"],
      },
    },
    {
      name: "lidarr_search_missing",
      description: "Trigger a search for all missing albums for an artist",
      inputSchema: {
        type: "object" as const,
        properties: {
          artistId: {
            type: "number",
            description: "Artist ID to search missing albums for",
          },
        },
        required: ["artistId"],
      },
    },
    {
      name: "lidarr_get_calendar",
      description: "Get upcoming album releases from Lidarr",
      inputSchema: {
        type: "object" as const,
        properties: {
          days: {
            type: "number",
            description: "Number of days to look ahead (default: 30)",
          },
        },
        required: [],
      },
    },
    {
      name: "lidarr_add_artist",
      description: "Add an artist to Lidarr. Use lidarr_search first to find the foreignArtistId, and lidarr_get_root_folders / lidarr_get_quality_profiles / lidarr_get_metadata_profiles to get valid values. Use lidarr_get_tags to get valid tag IDs.",
      inputSchema: {
        type: "object" as const,
        properties: {
          foreignArtistId: {
            type: "string",
            description: "Foreign artist ID (MusicBrainz ID) from lidarr_search results",
          },
          artistName: {
            type: "string",
            description: "Artist name",
          },
          qualityProfileId: {
            type: "number",
            description: "Quality profile ID from lidarr_get_quality_profiles",
          },
          metadataProfileId: {
            type: "number",
            description: "Metadata profile ID from lidarr_get_metadata_profiles",
          },
          rootFolderPath: {
            type: "string",
            description: "Root folder path from lidarr_get_root_folders",
          },
          monitored: {
            type: "boolean",
            description: "Whether to monitor the artist (default: true)",
          },
          tags: {
            type: "array",
            items: { type: "number" },
            description: "Array of tag IDs from lidarr_get_tags (optional)",
          },
        },
        required: ["foreignArtistId", "artistName", "qualityProfileId", "metadataProfileId", "rootFolderPath"],
      },
    },
    {
      name: "lidarr_get_root_folders",
      description: "Get available root folders for Lidarr. Use this to find valid rootFolderPath values when adding an artist.",
      inputSchema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: "lidarr_get_quality_profiles",
      description: "Get available quality profiles for Lidarr. Use this to find valid qualityProfileId values when adding an artist.",
      inputSchema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: "lidarr_get_metadata_profiles",
      description: "Get available metadata profiles for Lidarr. Use this to find valid metadataProfileId values when adding an artist.",
      inputSchema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    }
  );
}

// Prowlarr tools
if (clients.prowlarr) {
  TOOLS.push(
    {
      name: "prowlarr_get_indexers",
      description: "Get all configured indexers in Prowlarr",
      inputSchema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: "prowlarr_search",
      description: "Search across all Prowlarr indexers",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description: "Search query",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "prowlarr_test_indexers",
      description: "Test all indexers and return their health status",
      inputSchema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: "prowlarr_get_stats",
      description: "Get indexer statistics (queries, grabs, failures)",
      inputSchema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    }
  );
}

// Tautulli tools (Plex monitoring)
if (tautulliClient) {
  TOOLS.push(
    {
      name: "tautulli_get_activity",
      description: "Get current Plex activity (now playing) from Tautulli",
      inputSchema: { type: "object" as const, properties: {}, required: [] },
    },
    {
      name: "tautulli_get_history",
      description: "Get Plex watch history from Tautulli. With title: (1) Check if the film/series exists in Plex library (search, regardless of watch history). (2) Return how many have watched it and who/when. Without title: returns recent history. Optional: user_id, length, media_type, order_column, order_dir",
      inputSchema: {
        type: "object" as const,
        properties: {
          title: { type: "string", description: "Search by title (e.g. 'Dune: Prophecy'). Response: existsInLibrary, watchedCount, history (who and when)." },
          user_id: { type: "number", description: "Filter by Tautulli user ID" },
          length: { type: "number", description: "Without title: number of history records (default 25). With title: max watch-history rows to return (default 100, max 100)." },
          media_type: { type: "string", description: "movie, episode, track, etc." },
          order_column: { type: "string", description: "Column to sort by" },
          order_dir: { type: "string", enum: ["asc", "desc"], description: "Sort direction" },
        },
        required: [],
      },
    },
    {
      name: "tautulli_get_libraries",
      description: "Get Plex libraries from Tautulli",
      inputSchema: { type: "object" as const, properties: {}, required: [] },
    },
    {
      name: "tautulli_get_server_info",
      description: "Get Plex server info from Tautulli",
      inputSchema: { type: "object" as const, properties: {}, required: [] },
    },
    {
      name: "tautulli_get_home_stats",
      description: "Get home stats (plays, duration) from Tautulli. Optional: time_range, stats_count",
      inputSchema: {
        type: "object" as const,
        properties: {
          time_range: { type: "number", description: "Days to look back" },
          stats_count: { type: "number", description: "Number of top items" },
        },
        required: [],
      },
    },
    {
      name: "tautulli_get_users",
      description: "Get Plex users from Tautulli",
      inputSchema: { type: "object" as const, properties: {}, required: [] },
    },
    {
      name: "tautulli_get_recently_added",
      description: "Get recently added media from Tautulli. Optional: count, section_id",
      inputSchema: {
        type: "object" as const,
        properties: {
          count: { type: "number", description: "Number of items" },
          section_id: { type: "string", description: "Library/section ID" },
        },
        required: [],
      },
    },
    {
      name: "tautulli_server_status",
      description: "Get Tautulli/Plex server status",
      inputSchema: { type: "object" as const, properties: {}, required: [] },
    },
    {
      name: "tautulli_terminate_session",
      description: "Terminate a Plex streaming session",
      inputSchema: {
        type: "object" as const,
        properties: {
          session_key: { type: "string", description: "Session key from activity" },
          session_id: { type: "string", description: "Session ID from activity" },
        },
        required: ["session_key", "session_id"],
      },
    }
  );
}

// Overseerr tools (request management)
if (overseerrClient) {
  TOOLS.push(
    {
      name: "overseerr_get_requests",
      description: "Get media requests from Overseerr. Shows who requested what, status (pending/approved/declined), and media details.",
      inputSchema: {
        type: "object" as const,
        properties: {
          filter: {
            type: "string",
            enum: ["all", "pending", "approved", "declined", "processing", "available"],
            description: "Filter by request status (default: all)",
          },
          take: {
            type: "number",
            description: "Number of requests to return (default: 20, max: 100)",
          },
          requestedBy: {
            type: "number",
            description: "Filter by user ID who made the request",
          },
        },
        required: [],
      },
    },
    {
      name: "overseerr_get_request_count",
      description: "Get request counts by status (pending, approved, declined, etc.)",
      inputSchema: { type: "object" as const, properties: {}, required: [] },
    },
    {
      name: "overseerr_get_users",
      description: "Get all Overseerr users with their request counts",
      inputSchema: {
        type: "object" as const,
        properties: {
          take: { type: "number", description: "Number of users to return (default: 20)" },
          sort: {
            type: "string",
            enum: ["displayname", "requestcount", "created"],
            description: "Sort by field (default: displayname)",
          },
        },
        required: [],
      },
    },
    {
      name: "overseerr_get_user_requests",
      description: "Get all requests made by a specific user",
      inputSchema: {
        type: "object" as const,
        properties: {
          userId: { type: "number", description: "User ID to get requests for" },
          take: { type: "number", description: "Number of requests to return (default: 20)" },
        },
        required: ["userId"],
      },
    },
    {
      name: "overseerr_approve_request",
      description: "Approve a pending media request",
      inputSchema: {
        type: "object" as const,
        properties: {
          requestId: { type: "number", description: "Request ID to approve" },
        },
        required: ["requestId"],
      },
    },
    {
      name: "overseerr_decline_request",
      description: "Decline a pending media request",
      inputSchema: {
        type: "object" as const,
        properties: {
          requestId: { type: "number", description: "Request ID to decline" },
        },
        required: ["requestId"],
      },
    },
    {
      name: "overseerr_search",
      description: "Search for movies and TV shows in Overseerr (uses TMDB)",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "Search term" },
        },
        required: ["query"],
      },
    },
    {
      name: "overseerr_status",
      description: "Get Overseerr server status and version",
      inputSchema: { type: "object" as const, properties: {}, required: [] },
    }
  );
}

// Bazarr tools (subtitle management)
if (bazarrClient) {
  const pagingProps = {
    start: { type: "number", description: "Offset for pagination (default: 0)" },
    length: { type: "number", description: "Number of items to return (default: 50, max: 200)" },
  };
  const subtitleProps = {
    language: { type: "string", description: "Language code (ISO 639-1, e.g. 'en', 'sv'). Must be enabled in Bazarr (see bazarr_get_languages)" },
    forced: { type: "boolean", description: "Download a forced subtitle (default: false)" },
    hi: { type: "boolean", description: "Download a hearing-impaired subtitle (default: false)" },
  };
  TOOLS.push(
    {
      name: "bazarr_status",
      description: "Get Bazarr system status (Bazarr, Sonarr and Radarr versions, OS, etc.)",
      inputSchema: { type: "object" as const, properties: {}, required: [] },
    },
    {
      name: "bazarr_get_health",
      description: "Get Bazarr health check issues",
      inputSchema: { type: "object" as const, properties: {}, required: [] },
    },
    {
      name: "bazarr_get_badges",
      description: "Get Bazarr summary counts: episodes and movies with missing subtitles, provider issues, health issues, Sonarr/Radarr connection state",
      inputSchema: { type: "object" as const, properties: {}, required: [] },
    },
    {
      name: "bazarr_get_series",
      description: "Get TV series known to Bazarr with subtitle language profile and missing-subtitle episode counts. Use the returned sonarrSeriesId with other bazarr_* tools.",
      inputSchema: {
        type: "object" as const,
        properties: {
          ...pagingProps,
          seriesIds: { type: "array", items: { type: "number" }, description: "Only return these Sonarr series IDs" },
        },
        required: [],
      },
    },
    {
      name: "bazarr_get_episodes",
      description: "Get episodes of a series with existing and missing subtitles",
      inputSchema: {
        type: "object" as const,
        properties: {
          seriesId: { type: "number", description: "Sonarr series ID" },
          season: { type: "number", description: "Only return this season" },
        },
        required: ["seriesId"],
      },
    },
    {
      name: "bazarr_get_movies",
      description: "Get movies known to Bazarr with existing and missing subtitles. Use the returned radarrId with other bazarr_* tools.",
      inputSchema: {
        type: "object" as const,
        properties: {
          ...pagingProps,
          radarrIds: { type: "array", items: { type: "number" }, description: "Only return these Radarr movie IDs" },
        },
        required: [],
      },
    },
    {
      name: "bazarr_get_wanted_episodes",
      description: "Get episodes that are missing subtitles",
      inputSchema: { type: "object" as const, properties: { ...pagingProps }, required: [] },
    },
    {
      name: "bazarr_get_wanted_movies",
      description: "Get movies that are missing subtitles",
      inputSchema: { type: "object" as const, properties: { ...pagingProps }, required: [] },
    },
    {
      name: "bazarr_get_history",
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
      description: "Trigger Bazarr to search for all missing subtitles of a series",
      inputSchema: {
        type: "object" as const,
        properties: { seriesId: { type: "number", description: "Sonarr series ID" } },
        required: ["seriesId"],
      },
    },
    {
      name: "bazarr_search_movie",
      description: "Trigger Bazarr to search for all missing subtitles of a movie",
      inputSchema: {
        type: "object" as const,
        properties: { radarrId: { type: "number", description: "Radarr movie ID" } },
        required: ["radarrId"],
      },
    },
    {
      name: "bazarr_download_episode_subtitle",
      description: "Search and download a subtitle in a specific language for one episode",
      inputSchema: {
        type: "object" as const,
        properties: {
          seriesId: { type: "number", description: "Sonarr series ID" },
          episodeId: { type: "number", description: "Sonarr episode ID" },
          ...subtitleProps,
        },
        required: ["seriesId", "episodeId", "language"],
      },
    },
    {
      name: "bazarr_download_movie_subtitle",
      description: "Search and download a subtitle in a specific language for one movie",
      inputSchema: {
        type: "object" as const,
        properties: {
          radarrId: { type: "number", description: "Radarr movie ID" },
          ...subtitleProps,
        },
        required: ["radarrId", "language"],
      },
    },
    {
      name: "bazarr_get_providers",
      description: "Get subtitle provider status (throttled providers and when they will be retried)",
      inputSchema: { type: "object" as const, properties: {}, required: [] },
    },
    {
      name: "bazarr_reset_providers",
      description: "Reset throttled subtitle providers so Bazarr retries them immediately",
      inputSchema: { type: "object" as const, properties: {}, required: [] },
    },
    {
      name: "bazarr_get_languages",
      description: "Get enabled subtitle languages and language profiles configured in Bazarr",
      inputSchema: { type: "object" as const, properties: {}, required: [] },
    }
  );
}

// Cross-service search tool
TOOLS.push({
  name: "arr_search_all",
  description: "Search across all configured *arr services for any media",
  inputSchema: {
    type: "object" as const,
    properties: {
      term: {
        type: "string",
        description: "Search term",
      },
    },
    required: ["term"],
  },
});

// TRaSH Guides tools (always available - no *arr config required)
TOOLS.push(
  {
    name: "trash_list_profiles",
    description: "List available TRaSH Guides quality profiles for Radarr or Sonarr. Shows recommended profiles for different use cases (1080p, 4K, Remux, etc.)",
    inputSchema: {
      type: "object" as const,
      properties: {
        service: {
          type: "string",
          enum: ["radarr", "sonarr"],
          description: "Which service to get profiles for",
        },
      },
      required: ["service"],
    },
  },
  {
    name: "trash_get_profile",
    description: "Get a specific TRaSH Guides quality profile with all custom format scores, quality settings, and implementation details",
    inputSchema: {
      type: "object" as const,
      properties: {
        service: {
          type: "string",
          enum: ["radarr", "sonarr"],
          description: "Which service",
        },
        profile: {
          type: "string",
          description: "Profile name (e.g., 'remux-web-1080p', 'uhd-bluray-web', 'hd-bluray-web')",
        },
      },
      required: ["service", "profile"],
    },
  },
  {
    name: "trash_list_custom_formats",
    description: "List available TRaSH Guides custom formats. Can filter by category: hdr, audio, resolution, source, streaming, anime, unwanted, release, language",
    inputSchema: {
      type: "object" as const,
      properties: {
        service: {
          type: "string",
          enum: ["radarr", "sonarr"],
          description: "Which service",
        },
        category: {
          type: "string",
          description: "Optional filter by category",
        },
      },
      required: ["service"],
    },
  },
  {
    name: "trash_get_naming",
    description: "Get TRaSH Guides recommended naming conventions for your media server (Plex, Emby, Jellyfin, or standard)",
    inputSchema: {
      type: "object" as const,
      properties: {
        service: {
          type: "string",
          enum: ["radarr", "sonarr"],
          description: "Which service",
        },
        mediaServer: {
          type: "string",
          enum: ["plex", "emby", "jellyfin", "standard"],
          description: "Which media server you use",
        },
      },
      required: ["service", "mediaServer"],
    },
  },
  {
    name: "trash_get_quality_sizes",
    description: "Get TRaSH Guides recommended min/max/preferred sizes for each quality level",
    inputSchema: {
      type: "object" as const,
      properties: {
        service: {
          type: "string",
          enum: ["radarr", "sonarr"],
          description: "Which service",
        },
        type: {
          type: "string",
          description: "Content type: 'movie', 'anime' for Radarr; 'series', 'anime' for Sonarr",
        },
      },
      required: ["service"],
    },
  },
  {
    name: "trash_compare_profile",
    description: "Compare your quality profile against TRaSH Guides recommendations. Shows missing custom formats, scoring differences, and quality settings. Requires the corresponding *arr service to be configured.",
    inputSchema: {
      type: "object" as const,
      properties: {
        service: {
          type: "string",
          enum: ["radarr", "sonarr"],
          description: "Which service",
        },
        profileId: {
          type: "number",
          description: "Your quality profile ID to compare",
        },
        trashProfile: {
          type: "string",
          description: "TRaSH profile name to compare against",
        },
      },
      required: ["service", "profileId", "trashProfile"],
    },
  },
  {
    name: "trash_compare_naming",
    description: "Compare your naming configuration against TRaSH Guides recommendations. Requires the corresponding *arr service to be configured.",
    inputSchema: {
      type: "object" as const,
      properties: {
        service: {
          type: "string",
          enum: ["radarr", "sonarr"],
          description: "Which service",
        },
        mediaServer: {
          type: "string",
          enum: ["plex", "emby", "jellyfin", "standard"],
          description: "Which media server you use",
        },
      },
      required: ["service", "mediaServer"],
    },
  }
);

} // end buildTools

// Build a fresh MCP server instance with all request handlers registered.
// The HTTP transport builds a new instance per request (see startHttpServer)
// so concurrent / long-lived transports never share a single server. A shared
// server can only be connected to one transport at a time, which is why the
// old code funnelled every request through a serialized queue — and that queue
// deadlocked the moment a streamable client opened its long-lived GET (SSE)
// stream, since that request never completes.
function buildServer(caller?: CallContext): Server {
  const server = new Server(
    {
      name: "mcp-arr",
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );
  registerHandlers(server, caller);
  return server;
}


type SearchEntry = {
  id: string;
  title: string;
  url: string;
  type: string;
  service: string;
  summary?: string;
};

function buildResourceUrl(path: string): string {
  return `mcp-arr://${path}`;
}

function jsonText(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function textError(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

async function runUnifiedSearch(query: string): Promise<SearchEntry[]> {
  const results: SearchEntry[] = [];
  const trimmedQuery = query.trim();

  if (trimmedQuery.length === 0) {
    return results;
  }

  const lowerQuery = trimmedQuery.toLowerCase();

  for (const service of ["radarr", "sonarr"] as const) {
    const profiles = await trashClient.listProfiles(service);
    results.push(
      ...profiles
        .filter((profile) =>
          profile.name.toLowerCase().includes(lowerQuery) ||
          profile.description?.toLowerCase().includes(lowerQuery)
        )
        .slice(0, 8)
        .map((profile) => ({
          id: `trash-profile:${service}:${profile.name}`,
          title: `${profile.name} (${service})`,
          url: buildResourceUrl(`trash/profile/${service}/${encodeURIComponent(profile.name)}`),
          type: "trash_profile",
          service,
          summary: profile.description?.replace(/<br>/g, " "),
        }))
    );
  }

  if (clients.sonarr) {
    const series = await clients.sonarr.searchSeries(trimmedQuery);
    results.push(
      ...series.slice(0, 5).map((item) => ({
        id: `arr:sonarr:series:${item.tvdbId}`,
        title: `${item.title}${item.year ? ` (${item.year})` : ""}`,
        url: buildResourceUrl(`arr/sonarr/series/${item.tvdbId}`),
        type: "series",
        service: "sonarr",
        summary: item.overview?.slice(0, 220),
      }))
    );
  }

  if (clients.radarr) {
    const movies = await clients.radarr.searchMovies(trimmedQuery);
    results.push(
      ...movies.slice(0, 5).map((item) => ({
        id: `arr:radarr:movie:${item.tmdbId}`,
        title: `${item.title}${item.year ? ` (${item.year})` : ""}`,
        url: buildResourceUrl(`arr/radarr/movie/${item.tmdbId}`),
        type: "movie",
        service: "radarr",
        summary: item.overview?.slice(0, 220),
      }))
    );
  }

  if (clients.lidarr) {
    const artists = await clients.lidarr.searchArtists(trimmedQuery);
    results.push(
      ...artists.slice(0, 5).map((item) => ({
        id: `arr:lidarr:artist:${item.foreignArtistId}`,
        title: item.artistName || item.title,
        url: buildResourceUrl(`arr/lidarr/artist/${item.foreignArtistId}`),
        type: "artist",
        service: "lidarr",
        summary: item.overview?.slice(0, 220),
      }))
    );
  }

  return results;
}

async function fetchSearchEntry(id: string): Promise<unknown> {
  const [kind, service, subtype, rawId] = id.split(":");

  if (kind === "trash-profile" && (service === "radarr" || service === "sonarr")) {
    const profile = await trashClient.getProfile(service, rawId);
    if (!profile) {
      throw new Error(`TRaSH profile '${rawId}' not found for ${service}`);
    }

    return {
      id,
      title: `${profile.name} (${service})`,
      url: buildResourceUrl(`trash/profile/${service}/${encodeURIComponent(profile.name)}`),
      service,
      type: "trash_profile",
      data: {
        name: profile.name,
        description: profile.trash_description?.replace(/<br>/g, "\n"),
        upgradeAllowed: profile.upgradeAllowed,
        cutoff: profile.cutoff,
        minFormatScore: profile.minFormatScore,
        cutoffFormatScore: profile.cutoffFormatScore,
        language: profile.language,
        qualities: profile.items,
        customFormats: Object.entries(profile.formatItems || {}).map(([name, trashId]) => ({
          name,
          trash_id: trashId,
        })),
      },
    };
  }

  if (kind !== "arr") {
    throw new Error(`Unsupported fetch id '${id}'`);
  }

  if (service === "sonarr" && subtype === "series" && clients.sonarr) {
    const tvdbId = Number(rawId);
    const matches = (await clients.sonarr.searchSeries(rawId)).filter((item) => item.tvdbId === tvdbId);
    return {
      id,
      title: matches[0]?.title || rawId,
      url: buildResourceUrl(`arr/sonarr/series/${rawId}`),
      service,
      type: subtype,
      data: matches.slice(0, 10),
    };
  }

  if (service === "radarr" && subtype === "movie" && clients.radarr) {
    const tmdbId = Number(rawId);
    const matches = (await clients.radarr.searchMovies(rawId)).filter((item) => item.tmdbId === tmdbId);
    return {
      id,
      title: matches[0]?.title || rawId,
      url: buildResourceUrl(`arr/radarr/movie/${rawId}`),
      service,
      type: subtype,
      data: matches.slice(0, 10),
    };
  }

  if (service === "lidarr" && subtype === "artist" && clients.lidarr) {
    const matches = (await clients.lidarr.searchArtists(rawId)).filter((item) => item.foreignArtistId === rawId);
    return {
      id,
      title: matches[0]?.artistName || matches[0]?.title || rawId,
      url: buildResourceUrl(`arr/lidarr/artist/${rawId}`),
      service,
      type: subtype,
      data: matches.slice(0, 10),
    };
  }

  throw new Error(`Unsupported or unavailable fetch target '${id}'`);
}

type QueueCapableClient = SonarrClient | RadarrClient | LidarrClient;

async function getPaginatedQueue(
  client: QueueCapableClient,
  args: { limit?: number; offset?: number } | undefined
) {
  const limit = Math.min(Math.max(Math.floor(args?.limit ?? 25), 1), 100);
  const offset = Math.max(Math.floor(args?.offset ?? 0), 0);
  const pageSize = 100;
  const records = [];
  let totalRecords = 0;
  let page = 1;

  while (true) {
    const queuePage = await client.getQueue(page, pageSize);
    totalRecords = queuePage.totalRecords;
    records.push(...queuePage.records);

    if (records.length >= totalRecords || queuePage.records.length === 0) {
      break;
    }

    page += 1;
  }

  const items = records.slice(offset, offset + limit).map((q) => ({
    id: q.id,
    title: q.title,
    status: q.status,
    progress: q.size > 0 ? ((1 - q.sizeleft / q.size) * 100).toFixed(1) + "%" : "unknown",
    timeLeft: q.timeleft,
    downloadClient: q.downloadClient,
    protocol: q.protocol,
    trackedDownloadStatus: q.trackedDownloadStatus,
    trackedDownloadState: q.trackedDownloadState,
  }));

  return {
    total: totalRecords,
    returned: items.length,
    offset,
    limit,
    hasMore: offset + items.length < totalRecords,
    nextOffset: offset + items.length < totalRecords ? offset + items.length : null,
    items,
  };
}

// Registers the MCP request handlers on a server instance. Called by
// buildServer() for every server created (one per HTTP request, plus one for
// stdio).
function registerHandlers(server: Server, caller?: CallContext): void {
// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// Handle tool calls
// Every call is counted for the web UI status board (see stats.ts).
server.setRequestHandler(CallToolRequestSchema, (request) =>
  stats.track(request.params.name, caller, () => callTool(request.params))
);
}

async function callTool(params: { name: string; arguments?: Record<string, unknown> }) {
  const { name, arguments: args } = params;

  try {
    switch (name) {
      case "search": {
        const query = (args as { query: string }).query;
        const results = await runUnifiedSearch(query);
        return jsonText({ results });
      }

      case "fetch": {
        const id = (args as { id: string }).id;
        const result = await fetchSearchEntry(id);
        return jsonText(result);
      }

      case "arr_status": {
        const statuses: Record<string, unknown> = {};
        for (const service of configuredServices) {
          try {
            const client = clients[service.name];
            if (client) {
              const status = await client.getStatus();
              statuses[service.name] = {
                configured: true,
                connected: true,
                version: status.version,
                appName: status.appName,
              };
            }
          } catch (error) {
            statuses[service.name] = {
              configured: true,
              connected: false,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        }
        // Add unconfigured services
        for (const service of services) {
          if (!statuses[service.name]) {
            statuses[service.name] = { configured: false };
          }
        }
        if (tautulliConfigured) {
          try {
            if (tautulliClient) {
              const serverInfo = await tautulliClient.getServerStatus();
              statuses.tautulli = {
                configured: true,
                connected: true,
                data: serverInfo,
              };
            } else {
              statuses.tautulli = { configured: true, connected: false };
            }
          } catch (error) {
            statuses.tautulli = {
              configured: true,
              connected: false,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        } else {
          statuses.tautulli = { configured: false };
        }
        if (overseerrConfigured) {
          try {
            if (overseerrClient) {
              const status = await overseerrClient.getStatus();
              statuses.overseerr = {
                configured: true,
                connected: true,
                version: status.version,
                updateAvailable: status.updateAvailable,
              };
            } else {
              statuses.overseerr = { configured: true, connected: false };
            }
          } catch (error) {
            statuses.overseerr = {
              configured: true,
              connected: false,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        } else {
          statuses.overseerr = { configured: false };
        }
        if (bazarrConfigured) {
          try {
            if (bazarrClient) {
              const status = await bazarrClient.getStatus();
              statuses.bazarr = {
                configured: true,
                connected: true,
                version: status.bazarr_version,
              };
            } else {
              statuses.bazarr = { configured: true, connected: false };
            }
          } catch (error) {
            statuses.bazarr = {
              configured: true,
              connected: false,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        } else {
          statuses.bazarr = { configured: false };
        }
        return jsonText(statuses);
      }

      // Dynamic config tool handlers
      // Quality Profiles
      case "sonarr_get_quality_profiles":
      case "radarr_get_quality_profiles":
      case "lidarr_get_quality_profiles": {
        const serviceName = name.split('_')[0] as keyof typeof clients;
        const client = clients[serviceName];
        if (!client) throw new Error(`${serviceName} not configured`);
        const profiles = await client.getQualityProfiles();
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              count: profiles.length,
              profiles: profiles.map(p => ({
                id: p.id,
                name: p.name,
                upgradeAllowed: p.upgradeAllowed,
                cutoff: p.cutoff,
                allowedQualities: p.items
                  .filter(i => i.allowed)
                  .map(i => i.quality?.name || i.name || (i.items?.map(q => q.quality.name).join(', ')))
                  .filter(Boolean),
                customFormats: p.formatItems?.filter(f => f.score !== 0).map(f => ({
                  name: f.name,
                  score: f.score,
                })) || [],
                minFormatScore: p.minFormatScore,
                cutoffFormatScore: p.cutoffFormatScore,
              })),
            }, null, 2),
          }],
        };
      }

      // Health checks
      case "sonarr_get_health":
      case "radarr_get_health":
      case "lidarr_get_health": {
        const serviceName = name.split('_')[0] as keyof typeof clients;
        const client = clients[serviceName];
        if (!client) throw new Error(`${serviceName} not configured`);
        const health = await client.getHealth();
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              issueCount: health.length,
              issues: health.map(h => ({
                source: h.source,
                type: h.type,
                message: h.message,
                wikiUrl: h.wikiUrl,
              })),
              status: health.length === 0 ? 'healthy' : 'issues detected',
            }, null, 2),
          }],
        };
      }

      // Root folders
      case "sonarr_get_root_folders":
      case "radarr_get_root_folders":
      case "lidarr_get_root_folders": {
        const serviceName = name.split('_')[0] as keyof typeof clients;
        const client = clients[serviceName];
        if (!client) throw new Error(`${serviceName} not configured`);

        // For Sonarr/Radarr, use diskspace endpoint which includes totalSpace
        // For Lidarr/Readarr, use rootfolder endpoint (they may have totalSpace in rootfolder)
        const useDiskspace = serviceName === 'sonarr' || serviceName === 'radarr';
        const folders = useDiskspace ? await client.getDiskSpace() : await client.getRootFoldersDetailed();

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              count: folders.length,
              folders: folders.map(f => {
                const total = f.totalSpace ?? 0;
                const percentFree = total > 0 ? Math.round((f.freeSpace / total) * 100) : null;
                const percentUsed = total > 0 ? Math.round(((total - f.freeSpace) / total) * 100) : null;
                return {
                  id: f.id,
                  path: f.path,
                  accessible: f.accessible,
                  freeSpace: formatBytes(f.freeSpace),
                  freeSpaceBytes: f.freeSpace,
                  ...(total > 0 && {
                    totalSpace: formatBytes(total),
                    totalSpaceBytes: total,
                    percentFree,
                    percentUsed,
                  }),
                  unmappedFolders: f.unmappedFolders?.length || 0,
                };
              }),
            }, null, 2),
          }],
        };
      }

      // Download clients
      case "sonarr_get_download_clients":
      case "radarr_get_download_clients":
      case "lidarr_get_download_clients": {
        const serviceName = name.split('_')[0] as keyof typeof clients;
        const client = clients[serviceName];
        if (!client) throw new Error(`${serviceName} not configured`);
        const downloadClients = await client.getDownloadClients();
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              count: downloadClients.length,
              clients: downloadClients.map(c => ({
                id: c.id,
                name: c.name,
                implementation: c.implementationName,
                protocol: c.protocol,
                enabled: c.enable,
                priority: c.priority,
                removeCompletedDownloads: c.removeCompletedDownloads,
                removeFailedDownloads: c.removeFailedDownloads,
                tags: c.tags,
              })),
            }, null, 2),
          }],
        };
      }

      // Naming config
      case "sonarr_get_naming":
      case "radarr_get_naming":
      case "lidarr_get_naming": {
        const serviceName = name.split('_')[0] as keyof typeof clients;
        const client = clients[serviceName];
        if (!client) throw new Error(`${serviceName} not configured`);
        const naming = await client.getNamingConfig();
        return {
          content: [{
            type: "text",
            text: JSON.stringify(naming, null, 2),
          }],
        };
      }

      // Tags
      case "sonarr_get_tags":
      case "radarr_get_tags":
      case "lidarr_get_tags": {
        const serviceName = name.split('_')[0] as keyof typeof clients;
        const client = clients[serviceName];
        if (!client) throw new Error(`${serviceName} not configured`);
        const tags = await client.getTags();
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              count: tags.length,
              tags: tags.map(t => ({ id: t.id, label: t.label })),
            }, null, 2),
          }],
        };
      }

      // Comprehensive setup review
      case "sonarr_review_setup":
      case "radarr_review_setup":
      case "lidarr_review_setup": {
        const serviceName = name.split('_')[0] as keyof typeof clients;
        const client = clients[serviceName];
        if (!client) throw new Error(`${serviceName} not configured`);

        // Gather all configuration data
        const [status, health, qualityProfiles, qualityDefinitions, downloadClients, naming, mediaManagement, rootFolders, tags, indexers] = await Promise.all([
          client.getStatus(),
          client.getHealth(),
          client.getQualityProfiles(),
          client.getQualityDefinitions(),
          client.getDownloadClients(),
          client.getNamingConfig(),
          client.getMediaManagement(),
          client.getRootFoldersDetailed(),
          client.getTags(),
          client.getIndexers(),
        ]);

        // For Lidarr, also get metadata profiles
        let metadataProfiles = null;
        if (serviceName === 'lidarr' && clients.lidarr) {
          metadataProfiles = await clients.lidarr.getMetadataProfiles();
        }

        const review = {
          service: serviceName,
          version: status.version,
          appName: status.appName,
          platform: {
            os: status.osName,
            isDocker: status.isDocker,
          },
          health: {
            issueCount: health.length,
            issues: health,
          },
          storage: {
            rootFolders: rootFolders.map(f => ({
              path: f.path,
              accessible: f.accessible,
              freeSpace: formatBytes(f.freeSpace),
              freeSpaceBytes: f.freeSpace,
              unmappedFolderCount: f.unmappedFolders?.length || 0,
            })),
          },
          qualityProfiles: qualityProfiles.map(p => ({
            id: p.id,
            name: p.name,
            upgradeAllowed: p.upgradeAllowed,
            cutoff: p.cutoff,
            allowedQualities: p.items
              .filter(i => i.allowed)
              .map(i => i.quality?.name || i.name || (i.items?.map(q => q.quality.name).join(', ')))
              .filter(Boolean),
            customFormatsWithScores: p.formatItems?.filter(f => f.score !== 0).length || 0,
            minFormatScore: p.minFormatScore,
          })),
          qualityDefinitions: qualityDefinitions.map(d => ({
            quality: d.quality.name,
            minSize: d.minSize + ' MB/min',
            maxSize: d.maxSize === 0 ? 'unlimited' : d.maxSize + ' MB/min',
            preferredSize: d.preferredSize + ' MB/min',
          })),
          downloadClients: downloadClients.map(c => ({
            name: c.name,
            type: c.implementationName,
            protocol: c.protocol,
            enabled: c.enable,
            priority: c.priority,
          })),
          indexers: indexers.map(i => ({
            name: i.name,
            protocol: i.protocol,
            enableRss: i.enableRss,
            enableAutomaticSearch: i.enableAutomaticSearch,
            enableInteractiveSearch: i.enableInteractiveSearch,
            priority: i.priority,
          })),
          naming: naming,
          mediaManagement: {
            recycleBin: mediaManagement.recycleBin || 'not set',
            recycleBinCleanupDays: mediaManagement.recycleBinCleanupDays,
            downloadPropersAndRepacks: mediaManagement.downloadPropersAndRepacks,
            deleteEmptyFolders: mediaManagement.deleteEmptyFolders,
            copyUsingHardlinks: mediaManagement.copyUsingHardlinks,
            importExtraFiles: mediaManagement.importExtraFiles,
            extraFileExtensions: mediaManagement.extraFileExtensions,
          },
          tags: tags.map(t => t.label),
          ...(metadataProfiles && { metadataProfiles }),
        };

        return {
          content: [{
            type: "text",
            text: JSON.stringify(review, null, 2),
          }],
        };
      }

      // Sonarr handlers
      case "sonarr_get_series": {
        if (!clients.sonarr) throw new Error("Sonarr not configured");
        const { limit = 25, offset = 0, search, sortBy: sortByArg, sortDir: sortDirArg } = args as {
          limit?: number;
          offset?: number;
          search?: string;
          sortBy?: string;
          sortDir?: string;
        };
        const sortBy = sortByArg === 'dateAdded' || sortByArg === 'sizeOnDisk' ? sortByArg : undefined;
        const sortDir = sortDirArg === 'asc' || sortDirArg === 'desc' ? sortDirArg : undefined;
        const normalizedLimit = Math.max(1, Math.min(limit, 100));
        const normalizedOffset = Math.max(0, offset);
        const filter = search?.trim().toLowerCase();

        const allSeries = await clients.sonarr.getSeries();
        const filteredSeries = filter
          ? allSeries.filter(s => s.title.toLowerCase().includes(filter))
          : allSeries;
        // Sorting happens before pagination, so offset/limit page through the sorted order.
        let sortedSeries = filteredSeries;
        if (sortBy === 'dateAdded') {
          const dir = sortDir ?? 'asc';
          sortedSeries = [...filteredSeries].sort((a, b) => {
            const cmp = (a.added ?? '').localeCompare(b.added ?? '');
            return dir === 'desc' ? -cmp : cmp;
          });
        } else if (sortBy === 'sizeOnDisk') {
          const dir = sortDir ?? 'desc';
          sortedSeries = [...filteredSeries].sort((a, b) => {
            const cmp = (b.statistics?.sizeOnDisk ?? 0) - (a.statistics?.sizeOnDisk ?? 0);
            return dir === 'asc' ? -cmp : cmp;
          });
        }
        const pagedSeries = sortedSeries.slice(normalizedOffset, normalizedOffset + normalizedLimit);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              total: allSeries.length,
              filteredCount: filteredSeries.length,
              returned: pagedSeries.length,
              offset: normalizedOffset,
              limit: normalizedLimit,
              hasMore: normalizedOffset + normalizedLimit < filteredSeries.length,
              nextOffset: normalizedOffset + normalizedLimit < filteredSeries.length
                ? normalizedOffset + normalizedLimit
                : null,
              search: search ?? null,
              sortBy: sortBy ?? null,
              sortDir: sortBy ? (sortDir ?? (sortBy === 'dateAdded' ? 'asc' : 'desc')) : null,
              series: pagedSeries.map(s => ({
                id: s.id,
                title: s.title,
                year: s.year,
                status: s.status,
                network: s.network,
                seasons: s.statistics?.seasonCount,
                episodes: s.statistics?.episodeFileCount + '/' + s.statistics?.totalEpisodeCount,
                sizeOnDisk: formatBytes(s.statistics?.sizeOnDisk || 0),
                monitored: s.monitored,
                dateAdded: s.added,
                imdbId: s.imdbId || undefined,
                rating: s.ratings?.value != null ? Number(s.ratings.value.toFixed(1)) : undefined,
                ratingVotes: s.ratings?.votes,
                ratingSource: s.ratings ? 'tvdb' : undefined,
              })),
            }, null, 2),
          }],
        };
      }

      case "sonarr_search": {
        if (!clients.sonarr) throw new Error("Sonarr not configured");
        const term = (args as { term: string }).term;
        const results = await clients.sonarr.searchSeries(term);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              count: results.length,
              results: results.slice(0, 10).map(r => ({
                title: r.title,
                year: r.year,
                tvdbId: r.tvdbId,
                overview: r.overview?.substring(0, 200) + (r.overview && r.overview.length > 200 ? '...' : ''),
              })),
            }, null, 2),
          }],
        };
      }

      case "sonarr_get_queue": {
        if (!clients.sonarr) throw new Error("Sonarr not configured");
        return jsonText(await getPaginatedQueue(clients.sonarr, args as { limit?: number; offset?: number }));
      }

      case "sonarr_get_calendar": {
        if (!clients.sonarr) throw new Error("Sonarr not configured");
        const days = (args as { days?: number })?.days || 7;
        const start = new Date().toISOString().split('T')[0];
        const end = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const calendar = await clients.sonarr.getCalendar(start, end);
        return {
          content: [{ type: "text", text: JSON.stringify(calendar, null, 2) }],
        };
      }

      case "sonarr_get_episodes": {
        if (!clients.sonarr) throw new Error("Sonarr not configured");
        const { seriesId, seasonNumber } = args as { seriesId: number; seasonNumber?: number };
        const episodes = await clients.sonarr.getEpisodes(seriesId, seasonNumber);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              count: episodes.length,
              episodes: episodes.map(e => ({
                id: e.id,
                episodeFileId: e.hasFile ? e.episodeFileId : undefined,
                seasonNumber: e.seasonNumber,
                episodeNumber: e.episodeNumber,
                title: e.title,
                airDate: e.airDate,
                hasFile: e.hasFile,
                monitored: e.monitored,
                dateAdded: e.episodeFile?.dateAdded,
              })),
            }, null, 2),
          }],
        };
      }

      case "sonarr_search_missing": {
        if (!clients.sonarr) throw new Error("Sonarr not configured");
        const seriesId = (args as { seriesId: number }).seriesId;
        const result = await clients.sonarr.searchMissing(seriesId);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: `Search triggered for missing episodes`,
              commandId: result.id,
            }, null, 2),
          }],
        };
      }

      case "sonarr_search_episode": {
        if (!clients.sonarr) throw new Error("Sonarr not configured");
        const episodeIds = (args as { episodeIds: number[] }).episodeIds;
        const result = await clients.sonarr.searchEpisode(episodeIds);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: `Search triggered for ${episodeIds.length} episode(s)`,
              commandId: result.id,
            }, null, 2),
          }],
        };
      }

      case "sonarr_delete_series": {
        if (!clients.sonarr) throw new Error("Sonarr not configured");
        const { seriesId, deleteFiles = true, addImportListExclusion = false } = args as {
          seriesId: number;
          deleteFiles?: boolean;
          addImportListExclusion?: boolean;
        };
        await clients.sonarr.deleteSeries(seriesId, { deleteFiles, addImportListExclusion });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: `Series deleted successfully`,
              seriesId,
              deleteFiles,
              addImportListExclusion,
            }, null, 2),
          }],
        };
      }

      case "sonarr_refresh_series": {
        if (!clients.sonarr) throw new Error("Sonarr not configured");
        const seriesId = (args as { seriesId: number }).seriesId;
        const series = await clients.sonarr.getSeriesById(seriesId);
        const result = await clients.sonarr.refreshSeries(seriesId);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: `Refresh triggered for series`,
              series: {
                id: series.id,
                title: series.title,
                year: series.year,
              },
              commandId: result.id,
            }, null, 2),
          }],
        };
      }

      case "sonarr_delete_season": {
        if (!clients.sonarr) throw new Error("Sonarr not configured");
        const { seriesId, seasonNumber } = args as { seriesId: number; seasonNumber: number };
        const episodeFileIds = await clients.sonarr.getEpisodeFileIds(seriesId, seasonNumber);
        if (episodeFileIds.length === 0) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: true,
                message: `No episode files found for season ${seasonNumber}`,
                seriesId,
                seasonNumber,
                deletedFiles: 0,
              }, null, 2),
            }],
          };
        }
        await clients.sonarr.deleteEpisodeFiles(episodeFileIds);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: `Deleted ${episodeFileIds.length} episode file(s) from season ${seasonNumber}`,
              seriesId,
              seasonNumber,
              deletedFiles: episodeFileIds.length,
            }, null, 2),
          }],
        };
      }

      case "sonarr_delete_episode_files": {
        if (!clients.sonarr) throw new Error("Sonarr not configured");
        const { episodeFileIds } = args as { episodeFileIds: number[] };
        await clients.sonarr.deleteEpisodeFiles(episodeFileIds);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: `Deleted ${episodeFileIds.length} episode file(s)`,
              deletedFiles: episodeFileIds.length,
            }, null, 2),
          }],
        };
      }

      case "sonarr_add_series": {
        if (!clients.sonarr) throw new Error("Sonarr not configured");
        const { tvdbId, title, qualityProfileId, rootFolderPath, monitored, seasonFolder, tags } = args as {
          tvdbId: number; title: string; qualityProfileId: number; rootFolderPath: string;
          monitored?: boolean; seasonFolder?: boolean; tags?: number[];
        };
        const added = await clients.sonarr.addSeries({
          tvdbId, title, qualityProfileId, rootFolderPath, monitored, seasonFolder, tags: tags ?? [],
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: `Added "${added.title}" (${added.year}) to Sonarr`,
              id: added.id,
              path: added.path,
              monitored: added.monitored,
            }, null, 2),
          }],
        };
      }

      // Radarr handlers
      case "radarr_get_movies": {
        if (!clients.radarr) throw new Error("Radarr not configured");
        const { limit = 25, offset = 0, search, sortBy: sortByArg, sortDir: sortDirArg } = args as {
          limit?: number;
          offset?: number;
          search?: string;
          sortBy?: string;
          sortDir?: string;
        };
        const sortBy = sortByArg === 'dateAdded' || sortByArg === 'added' ? 'dateAdded' : sortByArg === 'sizeOnDisk' ? 'sizeOnDisk' : undefined;
        const sortDir = sortDirArg === 'asc' || sortDirArg === 'desc' ? sortDirArg : undefined;
        const normalizedLimit = Math.max(1, Math.min(limit, 100));
        const normalizedOffset = Math.max(0, offset);
        const filter = search?.trim().toLowerCase();

        const allMovies = await clients.radarr.getMovies();
        const filteredMovies = filter
          ? allMovies.filter(m => m.title.toLowerCase().includes(filter))
          : allMovies;
        // Sorting happens before pagination, so offset/limit page through the sorted order.
        let sortedMovies = filteredMovies;
        if (sortBy === 'dateAdded') {
          const dir = sortDir ?? 'asc';
          sortedMovies = [...filteredMovies].sort((a, b) => {
            const da = a.dateAdded ?? a.added ?? '';
            const db = b.dateAdded ?? b.added ?? '';
            const cmp = da.localeCompare(db);
            return dir === 'desc' ? -cmp : cmp;
          });
        } else if (sortBy === 'sizeOnDisk') {
          const dir = sortDir ?? 'desc';
          sortedMovies = [...filteredMovies].sort((a, b) => {
            const cmp = (b.sizeOnDisk ?? 0) - (a.sizeOnDisk ?? 0);
            return dir === 'asc' ? -cmp : cmp;
          });
        }
        const pagedMovies = sortedMovies.slice(normalizedOffset, normalizedOffset + normalizedLimit);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              total: allMovies.length,
              filteredCount: filteredMovies.length,
              returned: pagedMovies.length,
              offset: normalizedOffset,
              limit: normalizedLimit,
              hasMore: normalizedOffset + normalizedLimit < filteredMovies.length,
              nextOffset: normalizedOffset + normalizedLimit < filteredMovies.length
                ? normalizedOffset + normalizedLimit
                : null,
              search: search ?? null,
              sortBy: sortBy ?? null,
              sortDir: sortBy ? (sortDir ?? (sortBy === 'dateAdded' ? 'asc' : 'desc')) : null,
              movies: pagedMovies.map(m => ({
                id: m.id,
                title: m.title,
                year: m.year,
                status: m.status,
                hasFile: m.hasFile,
                sizeOnDisk: formatBytes(m.sizeOnDisk),
                monitored: m.monitored,
                studio: m.studio,
                dateAdded: m.dateAdded ?? m.added,
                imdbId: m.imdbId || undefined,
                rating: m.ratings?.tmdb?.value != null ? Number(m.ratings.tmdb.value.toFixed(1)) : undefined,
                ratingVotes: m.ratings?.tmdb?.votes,
                ratingSource: m.ratings?.tmdb ? 'tmdb' : undefined,
                qualityProfileId: m.qualityProfileId,
                ...(m.movieFile ? {
                  quality: m.movieFile.quality?.quality?.name ?? null,
                  resolution: m.movieFile.mediaInfo?.resolution ?? null,
                  videoCodec: m.movieFile.mediaInfo?.videoCodec ?? null,
                  videoDynamicRange: m.movieFile.mediaInfo?.videoDynamicRange ?? null,
                  audioCodec: m.movieFile.mediaInfo?.audioCodec ?? null,
                  audioChannels: m.movieFile.mediaInfo?.audioChannels ?? null,
                } : {}),
                ratings: Object.fromEntries(
                  Object.entries(m.ratings || {})
                    .filter(([, v]) => v && v.value > 0)
                    .map(([k, v]) => [k, v.value])
                ),
              })),
            }, null, 2),
          }],
        };
      }

      case "radarr_search": {
        if (!clients.radarr) throw new Error("Radarr not configured");
        const term = (args as { term: string }).term;
        const results = await clients.radarr.searchMovies(term);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              count: results.length,
              results: results.slice(0, 10).map(r => ({
                title: r.title,
                year: r.year,
                tmdbId: r.tmdbId,
                imdbId: r.imdbId,
                rating: r.ratings?.value != null ? Number(r.ratings.value.toFixed(1)) : undefined,
                ratingVotes: r.ratings?.votes,
                ratingSource: r.ratings ? 'tmdb' : undefined,
                overview: r.overview?.substring(0, 200) + (r.overview && r.overview.length > 200 ? '...' : ''),
              })),
            }, null, 2),
          }],
        };
      }

      case "radarr_get_queue": {
        if (!clients.radarr) throw new Error("Radarr not configured");
        return jsonText(await getPaginatedQueue(clients.radarr, args as { limit?: number; offset?: number }));
      }

      case "radarr_get_calendar": {
        if (!clients.radarr) throw new Error("Radarr not configured");
        const days = (args as { days?: number })?.days || 30;
        const start = new Date().toISOString().split('T')[0];
        const end = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const calendar = await clients.radarr.getCalendar(start, end);
        return {
          content: [{ type: "text", text: JSON.stringify(calendar, null, 2) }],
        };
      }

      case "radarr_search_movie": {
        if (!clients.radarr) throw new Error("Radarr not configured");
        const movieId = (args as { movieId: number }).movieId;
        const result = await clients.radarr.searchMovie(movieId);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: `Search triggered for movie`,
              commandId: result.id,
            }, null, 2),
          }],
        };
      }

      case "radarr_delete_movie": {
        if (!clients.radarr) throw new Error("Radarr not configured");
        const { movieId, deleteFiles = true, addImportExclusion = false } = args as {
          movieId: number;
          deleteFiles?: boolean;
          addImportExclusion?: boolean;
        };
        await clients.radarr.deleteMovie(movieId, { deleteFiles, addImportExclusion });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: `Movie deleted successfully`,
              movieId,
              deleteFiles,
              addImportExclusion,
            }, null, 2),
          }],
        };
      }

      case "radarr_refresh_movie": {
        if (!clients.radarr) throw new Error("Radarr not configured");
        const movieId = (args as { movieId: number }).movieId;
        const movie = await clients.radarr.getMovieById(movieId);
        const result = await clients.radarr.refreshMovie(movieId);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: `Refresh triggered for movie`,
              movie: {
                id: movie.id,
                title: movie.title,
                year: movie.year,
              },
              commandId: result.id,
            }, null, 2),
          }],
        };
      }

      case "radarr_add_movie": {
        if (!clients.radarr) throw new Error("Radarr not configured");
        const { tmdbId, title, qualityProfileId, rootFolderPath, monitored, minimumAvailability, tags } = args as {
          tmdbId: number; title: string; qualityProfileId: number; rootFolderPath: string;
          monitored?: boolean; minimumAvailability?: string; tags?: number[];
        };
        const added = await clients.radarr.addMovie({
          tmdbId, title, qualityProfileId, rootFolderPath, monitored, minimumAvailability, tags: tags ?? [],
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: `Added "${added.title}" (${added.year}) to Radarr`,
              id: added.id,
              path: added.path,
              monitored: added.monitored,
            }, null, 2),
          }],
        };
      }

      case "radarr_update_movie": {
        if (!clients.radarr) throw new Error("Radarr not configured");
        const { movieId, qualityProfileId, monitored, minimumAvailability, tags, path } = args as {
          movieId: number; qualityProfileId?: number; monitored?: boolean;
          minimumAvailability?: string; tags?: number[]; path?: string;
        };
        // Fetch the full movie object first
        const movie = await clients.radarr.getMovieById(movieId);
        // Apply updates
        if (qualityProfileId !== undefined) movie.qualityProfileId = qualityProfileId;
        if (monitored !== undefined) movie.monitored = monitored;
        if (minimumAvailability !== undefined) movie.minimumAvailability = minimumAvailability;
        if (tags !== undefined) movie.tags = tags;
        if (path !== undefined) movie.path = path;
        const updated = await clients.radarr.updateMovie(movie);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: `Updated "${updated.title}" (${updated.year})`,
              movie: {
                id: updated.id,
                title: updated.title,
                year: updated.year,
                qualityProfileId: updated.qualityProfileId,
                monitored: updated.monitored,
                minimumAvailability: updated.minimumAvailability,
                tags: updated.tags,
                path: updated.path,
              },
            }, null, 2),
          }],
        };
      }

      case "radarr_delete_queue_item": {
        if (!clients.radarr) throw new Error("Radarr not configured");
        const { queueId, removeFromClient = true, blocklist = false } = args as {
          queueId: number; removeFromClient?: boolean; blocklist?: boolean;
        };
        await clients.radarr.deleteQueueItem(queueId, { removeFromClient, blocklist });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: `Removed queue item ${queueId}${blocklist ? ' and added to blocklist' : ''}`,
              queueId,
              removedFromClient: removeFromClient,
              blocklisted: blocklist,
            }, null, 2),
          }],
        };
      }

      case "radarr_search_movies": {
        if (!clients.radarr) throw new Error("Radarr not configured");
        const { movieIds } = args as { movieIds: number[] };
        if (!movieIds || movieIds.length === 0) throw new Error("movieIds array is required and must not be empty");
        const result = await clients.radarr.searchMoviesBulk(movieIds);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: `Search triggered for ${movieIds.length} movie(s)`,
              commandId: result.id,
              movieIds,
            }, null, 2),
          }],
        };
      }

      // Lidarr handlers
      case "lidarr_get_artists": {
        if (!clients.lidarr) throw new Error("Lidarr not configured");
        const artists = await clients.lidarr.getArtists();
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              count: artists.length,
              artists: artists.map(a => ({
                id: a.id,
                artistName: a.artistName,
                status: a.status,
                albums: a.statistics?.albumCount,
                tracks: a.statistics?.trackFileCount + '/' + a.statistics?.totalTrackCount,
                sizeOnDisk: formatBytes(a.statistics?.sizeOnDisk || 0),
                monitored: a.monitored,
                dateAdded: a.added,
              })),
            }, null, 2),
          }],
        };
      }

      case "lidarr_search": {
        if (!clients.lidarr) throw new Error("Lidarr not configured");
        const a = args as { term?: string; query?: string; artist?: string; name?: string };
        const term = a.term ?? a.query ?? a.artist ?? a.name;
        if (!term) throw new Error("term required (artist name)");
        const results = await clients.lidarr.searchArtists(term);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              count: results.length,
              results: results.slice(0, 10).map(r => ({
                artistName: r.artistName ?? r.title,
                disambiguation: r.disambiguation,
                foreignArtistId: r.foreignArtistId,
                overview: r.overview ? (r.overview.substring(0, 200) + (r.overview.length > 200 ? '...' : '')) : undefined,
              })),
            }, null, 2),
          }],
        };
      }

      case "lidarr_get_queue": {
        if (!clients.lidarr) throw new Error("Lidarr not configured");
        return jsonText(await getPaginatedQueue(clients.lidarr, args as { limit?: number; offset?: number }));
      }

      case "lidarr_get_albums": {
        if (!clients.lidarr) throw new Error("Lidarr not configured");
        const artistId = (args as { artistId: number }).artistId;
        const albums = await clients.lidarr.getAlbums(artistId);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              count: albums.length,
              albums: albums.map(a => ({
                id: a.id,
                title: a.title,
                releaseDate: a.releaseDate,
                albumType: a.albumType,
                monitored: a.monitored,
                tracks: a.statistics ? `${a.statistics.trackFileCount}/${a.statistics.totalTrackCount}` : 'unknown',
                sizeOnDisk: formatBytes(a.statistics?.sizeOnDisk || 0),
                percentComplete: a.statistics?.percentOfTracks || 0,
                grabbed: a.grabbed,
                dateAdded: (a as { added?: string }).added,
              })),
            }, null, 2),
          }],
        };
      }

      case "lidarr_search_album": {
        if (!clients.lidarr) throw new Error("Lidarr not configured");
        const albumId = (args as { albumId: number }).albumId;
        const result = await clients.lidarr.searchAlbum(albumId);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: `Search triggered for album`,
              commandId: result.id,
            }, null, 2),
          }],
        };
      }

      case "lidarr_search_missing": {
        if (!clients.lidarr) throw new Error("Lidarr not configured");
        const artistId = (args as { artistId: number }).artistId;
        const result = await clients.lidarr.searchMissingAlbums(artistId);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: `Search triggered for missing albums`,
              commandId: result.id,
            }, null, 2),
          }],
        };
      }

      case "lidarr_get_calendar": {
        if (!clients.lidarr) throw new Error("Lidarr not configured");
        const days = (args as { days?: number })?.days || 30;
        const start = new Date().toISOString().split('T')[0];
        const end = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const calendar = await clients.lidarr.getCalendar(start, end);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              count: calendar.length,
              albums: calendar.map(a => ({
                id: a.id,
                title: a.title,
                artistId: a.artistId,
                releaseDate: a.releaseDate,
                albumType: a.albumType,
                monitored: a.monitored,
              })),
            }, null, 2),
          }],
        };
      }

      case "lidarr_add_artist": {
        if (!clients.lidarr) throw new Error("Lidarr not configured");
        const { foreignArtistId, artistName, qualityProfileId, metadataProfileId, rootFolderPath, monitored, tags } = args as {
          foreignArtistId: string; artistName: string; qualityProfileId: number;
          metadataProfileId: number; rootFolderPath: string; monitored?: boolean; tags?: number[];
        };
        const added = await clients.lidarr.addArtist({
          foreignArtistId, artistName, qualityProfileId, metadataProfileId, rootFolderPath, monitored, tags: tags ?? [],
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: `Added "${added.artistName}" to Lidarr`,
              id: added.id,
              path: added.path,
              monitored: added.monitored,
            }, null, 2),
          }],
        };
      }

      case "lidarr_get_root_folders": {
        if (!clients.lidarr) throw new Error("Lidarr not configured");
        const folders = await clients.lidarr.getRootFolders();
        return {
          content: [{
            type: "text",
            text: JSON.stringify(folders, null, 2),
          }],
        };
      }

      case "lidarr_get_quality_profiles": {
        if (!clients.lidarr) throw new Error("Lidarr not configured");
        const profiles = await clients.lidarr.getQualityProfiles();
        return {
          content: [{
            type: "text",
            text: JSON.stringify(profiles.map(p => ({ id: p.id, name: p.name })), null, 2),
          }],
        };
      }

      case "lidarr_get_metadata_profiles": {
        if (!clients.lidarr) throw new Error("Lidarr not configured");
        const profiles = await clients.lidarr.getMetadataProfiles();
        return {
          content: [{
            type: "text",
            text: JSON.stringify(profiles.map(p => ({ id: p.id, name: p.name })), null, 2),
          }],
        };
      }

      // Prowlarr handlers
      case "prowlarr_get_indexers": {
        if (!clients.prowlarr) throw new Error("Prowlarr not configured");
        const indexers = await clients.prowlarr.getIndexers();
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              count: indexers.length,
              indexers: indexers.map(i => ({
                id: i.id,
                name: i.name,
                protocol: i.protocol,
                enableRss: i.enableRss,
                enableAutomaticSearch: i.enableAutomaticSearch,
                enableInteractiveSearch: i.enableInteractiveSearch,
                priority: i.priority,
              })),
            }, null, 2),
          }],
        };
      }

      case "prowlarr_search": {
        if (!clients.prowlarr) throw new Error("Prowlarr not configured");
        const query = (args as { query: string }).query;
        const results = await clients.prowlarr.search(query);
        return {
          content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
        };
      }

      case "prowlarr_test_indexers": {
        if (!clients.prowlarr) throw new Error("Prowlarr not configured");
        const results = await clients.prowlarr.testAllIndexers();
        const indexers = await clients.prowlarr.getIndexers();
        const indexerMap = new Map(indexers.map(i => [i.id, i.name]));
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              count: results.length,
              indexers: results.map(r => ({
                id: r.id,
                name: indexerMap.get(r.id) || 'Unknown',
                isValid: r.isValid,
                errors: r.validationFailures.map(f => f.errorMessage),
              })),
              healthy: results.filter(r => r.isValid).length,
              failed: results.filter(r => !r.isValid).length,
            }, null, 2),
          }],
        };
      }

      case "prowlarr_get_stats": {
        if (!clients.prowlarr) throw new Error("Prowlarr not configured");
        const stats = await clients.prowlarr.getIndexerStats();
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              count: stats.indexers.length,
              indexers: stats.indexers.map(s => ({
                name: s.indexerName,
                queries: s.numberOfQueries,
                grabs: s.numberOfGrabs,
                failedQueries: s.numberOfFailedQueries,
                failedGrabs: s.numberOfFailedGrabs,
                avgResponseTime: s.averageResponseTime + 'ms',
              })),
              totals: {
                queries: stats.indexers.reduce((sum, s) => sum + s.numberOfQueries, 0),
                grabs: stats.indexers.reduce((sum, s) => sum + s.numberOfGrabs, 0),
                failedQueries: stats.indexers.reduce((sum, s) => sum + s.numberOfFailedQueries, 0),
                failedGrabs: stats.indexers.reduce((sum, s) => sum + s.numberOfFailedGrabs, 0),
              },
            }, null, 2),
          }],
        };
      }

      // Tautulli (Plex)
      case "tautulli_get_activity": {
        if (!tautulliClient) throw new Error("Tautulli not configured");
        const data = await tautulliClient.getActivity();
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      case "tautulli_get_history": {
        if (!tautulliClient) throw new Error("Tautulli not configured");
        const a = args as { title?: string; user_id?: number; length?: number; media_type?: string; order_column?: string; order_dir?: 'asc' | 'desc' };
        const hasTitle = typeof a.title === 'string' && a.title.trim().length > 0;
        if (!hasTitle) {
          const apiLength = a.length ?? 25;
          const data = await tautulliClient.getHistory({
            user_id: a.user_id,
            length: apiLength,
            media_type: a.media_type,
            order_column: a.order_column ?? 'date',
            order_dir: a.order_dir ?? 'desc',
          });
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        const title = a.title!.trim();
        const mcpStart = Date.now();
        const returnLimit = typeof a.length === 'number' && a.length > 0 ? Math.min(a.length, 100) : 100;

        // Run library search and history search in parallel
        const libStartTime = Date.now();
        const historyStartTime = Date.now();
        const [libraryResult, historyResult] = await Promise.all([
          tautulliClient.searchLibrary(title, 10).then(res => ({ data: res, ms: Date.now() - libStartTime })).catch(() => ({ data: null, ms: Date.now() - libStartTime })),
          tautulliClient.getHistory({
            user_id: a.user_id,
            media_type: a.media_type,
            order_column: a.order_column ?? 'date',
            order_dir: a.order_dir ?? 'desc',
            length: 1000,
            search: title,
          }).then(res => ({ data: res, ms: Date.now() - historyStartTime })),
        ]);

        // Process library search result
        let existsInLibrary = false;
        const librarySearchMs = libraryResult.ms;
        if (libraryResult.data) {
          const count = libraryResult.data.results_count ?? 0;
          const list = libraryResult.data.results_list ?? {};
          const totalFromList = Object.values(list).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
          existsInLibrary = count > 0 || totalFromList > 0;
        }

        // Process history result
        const historySearchMs = historyResult.ms;
        const first = historyResult.data;
        const firstRaw = (first as { data?: unknown[] })?.data ?? (Array.isArray(first) ? first : []);
        const rows = Array.isArray(firstRaw) ? firstRaw : [];
        const watchedCount = rows.length;
        const history = rows.slice(0, returnLimit).map((row: unknown) => {
          const r = row as { friendly_name?: string; user?: string; date?: number; full_title?: string; title?: string; grandparent_title?: string };
          return {
            who: r.friendly_name ?? r.user ?? '-',
            when: r.date != null ? new Date(r.date * 1000).toISOString() : '-',
            title: r.full_title ?? r.title ?? r.grandparent_title ?? '-',
          };
        });
        const mcpTotalMs = Date.now() - mcpStart;
        const result = {
          searchedFor: title,
          existsInLibrary,
          summary: existsInLibrary ? "The film/series is in the Plex library." : "The film/series is not in the Plex library.",
          watchedCount,
          watchedSummary: watchedCount === 0 ? "No one has watched it (according to history)." : `${watchedCount} play(s).`,
          returned: history.length,
          history,
          responseTime: {
            totalMs: mcpTotalMs,
            librarySearchMs,
            historySearchMs,
          },
        };
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      case "tautulli_get_libraries": {
        if (!tautulliClient) throw new Error("Tautulli not configured");
        const data = await tautulliClient.getLibraries();
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      case "tautulli_get_server_info": {
        if (!tautulliClient) throw new Error("Tautulli not configured");
        const data = await tautulliClient.getServerInfo();
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      case "tautulli_get_home_stats": {
        if (!tautulliClient) throw new Error("Tautulli not configured");
        const a = args as { time_range?: number; stats_count?: number };
        const data = await tautulliClient.getHomeStats({ time_range: a.time_range, stats_count: a.stats_count });
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      case "tautulli_get_users": {
        if (!tautulliClient) throw new Error("Tautulli not configured");
        const data = await tautulliClient.getUsers();
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      case "tautulli_get_recently_added": {
        if (!tautulliClient) throw new Error("Tautulli not configured");
        const a = args as { count?: number; section_id?: string };
        const data = await tautulliClient.getRecentlyAdded({ count: a.count, section_id: a.section_id });
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      case "tautulli_server_status": {
        if (!tautulliClient) throw new Error("Tautulli not configured");
        const data = await tautulliClient.getServerStatus();
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      case "tautulli_terminate_session": {
        if (!tautulliClient) throw new Error("Tautulli not configured");
        const { session_key, session_id } = args as { session_key: string; session_id: string };
        const data = await tautulliClient.terminateSession(session_key, session_id);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      // Overseerr handlers
      case "overseerr_get_requests": {
        if (!overseerrClient) throw new Error("Overseerr not configured");
        const a = args as {
          filter?: 'all' | 'pending' | 'approved' | 'declined' | 'processing' | 'available';
          take?: number;
          requestedBy?: number;
        };
        const take = Math.min(a.take ?? 20, 100);
        const data = await overseerrClient.getRequests({
          take,
          filter: a.filter,
          requestedBy: a.requestedBy,
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              totalRequests: data.pageInfo.results,
              returned: data.results.length,
              requests: data.results.map(r => ({
                id: r.id,
                type: r.type,
                status: OverseerrClient.formatRequestStatus(r.status),
                is4k: r.is4k,
                requestedBy: r.requestedBy?.username || r.requestedBy?.plexUsername || r.requestedBy?.email,
                requestedAt: r.createdAt,
                media: {
                  tmdbId: r.media?.tmdbId,
                  tvdbId: r.media?.tvdbId,
                  status: OverseerrClient.formatMediaStatus(r.media?.status ?? 1),
                },
                ...(r.seasonCount && { seasons: r.seasonCount }),
              })),
            }, null, 2),
          }],
        };
      }

      case "overseerr_get_request_count": {
        if (!overseerrClient) throw new Error("Overseerr not configured");
        const data = await overseerrClient.getRequestCount();
        return {
          content: [{
            type: "text",
            text: JSON.stringify(data, null, 2),
          }],
        };
      }

      case "overseerr_get_users": {
        if (!overseerrClient) throw new Error("Overseerr not configured");
        const a = args as { take?: number; sort?: 'displayname' | 'requestcount' | 'created' };
        const data = await overseerrClient.getUsers({
          take: a.take ?? 20,
          sort: a.sort,
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              totalUsers: data.pageInfo.results,
              returned: data.results.length,
              users: data.results.map(u => ({
                id: u.id,
                username: u.username || u.plexUsername || u.email,
                email: u.email,
                requestCount: u.requestCount,
                createdAt: u.createdAt,
              })),
            }, null, 2),
          }],
        };
      }

      case "overseerr_get_user_requests": {
        if (!overseerrClient) throw new Error("Overseerr not configured");
        const { userId, take } = args as { userId: number; take?: number };
        const data = await overseerrClient.getUserRequests(userId, { take: take ?? 20 });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              userId,
              totalRequests: data.pageInfo.results,
              returned: data.results.length,
              requests: data.results.map(r => ({
                id: r.id,
                type: r.type,
                status: OverseerrClient.formatRequestStatus(r.status),
                is4k: r.is4k,
                requestedAt: r.createdAt,
                media: {
                  tmdbId: r.media?.tmdbId,
                  tvdbId: r.media?.tvdbId,
                  status: OverseerrClient.formatMediaStatus(r.media?.status ?? 1),
                },
              })),
            }, null, 2),
          }],
        };
      }

      case "overseerr_approve_request": {
        if (!overseerrClient) throw new Error("Overseerr not configured");
        const { requestId } = args as { requestId: number };
        const data = await overseerrClient.approveRequest(requestId);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: "Request approved",
              requestId,
              newStatus: OverseerrClient.formatRequestStatus(data.status),
            }, null, 2),
          }],
        };
      }

      case "overseerr_decline_request": {
        if (!overseerrClient) throw new Error("Overseerr not configured");
        const { requestId } = args as { requestId: number };
        const data = await overseerrClient.declineRequest(requestId);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: "Request declined",
              requestId,
              newStatus: OverseerrClient.formatRequestStatus(data.status),
            }, null, 2),
          }],
        };
      }

      case "overseerr_search": {
        if (!overseerrClient) throw new Error("Overseerr not configured");
        const { query } = args as { query: string };
        const data = await overseerrClient.search(query);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(data, null, 2),
          }],
        };
      }

      case "overseerr_status": {
        if (!overseerrClient) throw new Error("Overseerr not configured");
        const data = await overseerrClient.getStatus();
        return {
          content: [{
            type: "text",
            text: JSON.stringify(data, null, 2),
          }],
        };
      }

      // Cross-service search
      case "arr_search_all": {
        const term = (args as { term: string }).term;
        const results: Record<string, unknown> = {};

        if (clients.sonarr) {
          try {
            const sonarrResults = await clients.sonarr.searchSeries(term);
            results.sonarr = { count: sonarrResults.length, results: sonarrResults.slice(0, 5) };
          } catch (e) {
            results.sonarr = { error: e instanceof Error ? e.message : String(e) };
          }
        }

        if (clients.radarr) {
          try {
            const radarrResults = await clients.radarr.searchMovies(term);
            results.radarr = { count: radarrResults.length, results: radarrResults.slice(0, 5) };
          } catch (e) {
            results.radarr = { error: e instanceof Error ? e.message : String(e) };
          }
        }

        if (clients.lidarr) {
          try {
            const lidarrResults = await clients.lidarr.searchArtists(term);
            results.lidarr = { count: lidarrResults.length, results: lidarrResults.slice(0, 5) };
          } catch (e) {
            results.lidarr = { error: e instanceof Error ? e.message : String(e) };
          }
        }

        return {
          content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
        };
      }

      // TRaSH Guides handlers
      case "trash_list_profiles": {
        const service = (args as { service: TrashService }).service;
        const profiles = await trashClient.listProfiles(service);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              service,
              count: profiles.length,
              profiles: profiles.map(p => ({
                name: p.name,
                description: p.description?.replace(/<br>/g, ' ') || 'No description',
              })),
              usage: "Use trash_get_profile to see full details for a specific profile",
            }, null, 2),
          }],
        };
      }

      case "trash_get_profile": {
        const { service, profile: profileName } = args as { service: TrashService; profile: string };
        const profile = await trashClient.getProfile(service, profileName);
        if (!profile) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: `Profile '${profileName}' not found for ${service}`,
                hint: "Use trash_list_profiles to see available profiles",
              }, null, 2),
            }],
            isError: true,
          };
        }
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              name: profile.name,
              description: profile.trash_description?.replace(/<br>/g, '\n'),
              trash_id: profile.trash_id,
              upgradeAllowed: profile.upgradeAllowed,
              cutoff: profile.cutoff,
              minFormatScore: profile.minFormatScore,
              cutoffFormatScore: profile.cutoffFormatScore,
              language: profile.language,
              qualities: profile.items.map(i => ({
                name: i.name,
                allowed: i.allowed,
                items: i.items,
              })),
              customFormats: Object.entries(profile.formatItems || {}).map(([name, trashId]) => ({
                name,
                trash_id: trashId,
              })),
            }, null, 2),
          }],
        };
      }

      case "trash_list_custom_formats": {
        const { service, category } = args as { service: TrashService; category?: string };
        const formats = await trashClient.listCustomFormats(service, category);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              service,
              category: category || 'all',
              count: formats.length,
              formats: formats.slice(0, 50).map(f => ({
                name: f.name,
                categories: f.categories,
                defaultScore: f.defaultScore,
              })),
              note: formats.length > 50 ? `Showing first 50 of ${formats.length}. Use category filter to narrow results.` : undefined,
              availableCategories: ['hdr', 'audio', 'resolution', 'source', 'streaming', 'anime', 'unwanted', 'release', 'language'],
            }, null, 2),
          }],
        };
      }

      case "trash_get_naming": {
        const { service, mediaServer } = args as { service: TrashService; mediaServer: string };
        const naming = await trashClient.getNaming(service);
        if (!naming) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ error: `Could not fetch naming conventions for ${service}` }, null, 2),
            }],
            isError: true,
          };
        }

        // Map media server to naming key
        const serverMap: Record<string, { folder: string; file: string }> = {
          plex: { folder: 'plex-imdb', file: 'plex-imdb' },
          emby: { folder: 'emby-imdb', file: 'emby-imdb' },
          jellyfin: { folder: 'jellyfin-imdb', file: 'jellyfin-imdb' },
          standard: { folder: 'default', file: 'standard' },
        };

        const keys = serverMap[mediaServer] || serverMap.standard;

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              service,
              mediaServer,
              recommended: {
                folder: naming.folder[keys.folder] || naming.folder.default,
                file: naming.file[keys.file] || naming.file.standard,
                ...(naming.season && { season: naming.season[keys.folder] || naming.season.default }),
                ...(naming.series && { series: naming.series[keys.folder] || naming.series.default }),
              },
              allFolderOptions: Object.keys(naming.folder),
              allFileOptions: Object.keys(naming.file),
            }, null, 2),
          }],
        };
      }

      case "trash_get_quality_sizes": {
        const { service, type } = args as { service: TrashService; type?: string };
        const sizes = await trashClient.getQualitySizes(service, type);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              service,
              type: type || 'all',
              profiles: sizes.map(s => ({
                type: s.type,
                qualities: s.qualities.map(q => ({
                  quality: q.quality,
                  min: q.min + ' MB/min',
                  preferred: q.preferred === 1999 ? 'unlimited' : q.preferred + ' MB/min',
                  max: q.max === 2000 ? 'unlimited' : q.max + ' MB/min',
                })),
              })),
            }, null, 2),
          }],
        };
      }

      case "trash_compare_profile": {
        const { service, profileId, trashProfile } = args as {
          service: TrashService;
          profileId: number;
          trashProfile: string;
        };

        // Get client
        const client = service === 'radarr' ? clients.radarr : clients.sonarr;
        if (!client) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ error: `${service} not configured. Cannot compare profiles.` }, null, 2),
            }],
            isError: true,
          };
        }

        // Fetch both profiles
        const [userProfiles, trashProfileData] = await Promise.all([
          client.getQualityProfiles(),
          trashClient.getProfile(service, trashProfile),
        ]);

        const userProfile = userProfiles.find(p => p.id === profileId);
        if (!userProfile) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: `Profile ID ${profileId} not found`,
                availableProfiles: userProfiles.map(p => ({ id: p.id, name: p.name })),
              }, null, 2),
            }],
            isError: true,
          };
        }

        if (!trashProfileData) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: `TRaSH profile '${trashProfile}' not found`,
                hint: "Use trash_list_profiles to see available profiles",
              }, null, 2),
            }],
            isError: true,
          };
        }

        // Compare qualities
        const userQualities = new Set<string>(
          userProfile.items
            .filter(i => i.allowed)
            .map(i => i.quality?.name || i.name)
            .filter((n): n is string => n !== undefined)
        );
        const trashQualities = new Set<string>(
          trashProfileData.items
            .filter(i => i.allowed)
            .map(i => i.name)
        );

        const qualityComparison = {
          matching: [...userQualities].filter(q => trashQualities.has(q)),
          missingFromYours: [...trashQualities].filter(q => !userQualities.has(q)),
          extraInYours: [...userQualities].filter(q => !trashQualities.has(q)),
        };

        // Compare custom formats
        const userCFNames = new Set(
          (userProfile.formatItems || [])
            .filter(f => f.score !== 0)
            .map(f => f.name)
        );
        const trashCFNames = new Set(Object.keys(trashProfileData.formatItems || {}));

        const cfComparison = {
          matching: [...userCFNames].filter(cf => trashCFNames.has(cf)),
          missingFromYours: [...trashCFNames].filter(cf => !userCFNames.has(cf)),
          extraInYours: [...userCFNames].filter(cf => !trashCFNames.has(cf)),
        };

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              yourProfile: {
                name: userProfile.name,
                id: userProfile.id,
                upgradeAllowed: userProfile.upgradeAllowed,
                cutoff: userProfile.cutoff,
              },
              trashProfile: {
                name: trashProfileData.name,
                upgradeAllowed: trashProfileData.upgradeAllowed,
                cutoff: trashProfileData.cutoff,
              },
              qualityComparison,
              customFormatComparison: cfComparison,
              recommendations: [
                ...(qualityComparison.missingFromYours.length > 0
                  ? [`Enable these qualities: ${qualityComparison.missingFromYours.join(', ')}`]
                  : []),
                ...(cfComparison.missingFromYours.length > 0
                  ? [`Add these custom formats: ${cfComparison.missingFromYours.slice(0, 5).join(', ')}${cfComparison.missingFromYours.length > 5 ? ` and ${cfComparison.missingFromYours.length - 5} more` : ''}`]
                  : []),
                ...(userProfile.upgradeAllowed !== trashProfileData.upgradeAllowed
                  ? [`Set upgradeAllowed to ${trashProfileData.upgradeAllowed}`]
                  : []),
              ],
            }, null, 2),
          }],
        };
      }

      case "trash_compare_naming": {
        const { service, mediaServer } = args as { service: TrashService; mediaServer: string };

        // Get client
        const client = service === 'radarr' ? clients.radarr : clients.sonarr;
        if (!client) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ error: `${service} not configured. Cannot compare naming.` }, null, 2),
            }],
            isError: true,
          };
        }

        // Fetch both
        const [userNaming, trashNaming] = await Promise.all([
          client.getNamingConfig(),
          trashClient.getNaming(service),
        ]);

        if (!trashNaming) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ error: `Could not fetch TRaSH naming for ${service}` }, null, 2),
            }],
            isError: true,
          };
        }

        // Map media server to naming key
        const serverMap: Record<string, { folder: string; file: string }> = {
          plex: { folder: 'plex-imdb', file: 'plex-imdb' },
          emby: { folder: 'emby-imdb', file: 'emby-imdb' },
          jellyfin: { folder: 'jellyfin-imdb', file: 'jellyfin-imdb' },
          standard: { folder: 'default', file: 'standard' },
        };

        const keys = serverMap[mediaServer] || serverMap.standard;
        const recommendedFolder = trashNaming.folder[keys.folder] || trashNaming.folder.default;
        const recommendedFile = trashNaming.file[keys.file] || trashNaming.file.standard;

        // Extract user's current naming (field names vary by service)
        const namingRecord = userNaming as unknown as Record<string, unknown>;
        const userFolder = namingRecord.movieFolderFormat ||
          namingRecord.seriesFolderFormat ||
          namingRecord.standardMovieFormat;
        const userFile = namingRecord.standardMovieFormat ||
          namingRecord.standardEpisodeFormat;

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              mediaServer,
              yourNaming: {
                folder: userFolder,
                file: userFile,
              },
              trashRecommended: {
                folder: recommendedFolder,
                file: recommendedFile,
              },
              folderMatch: userFolder === recommendedFolder,
              fileMatch: userFile === recommendedFile,
              recommendations: [
                ...(userFolder !== recommendedFolder ? [`Update folder format to: ${recommendedFolder}`] : []),
                ...(userFile !== recommendedFile ? [`Update file format to: ${recommendedFile}`] : []),
              ],
            }, null, 2),
          }],
        };
      }

      // Bazarr handlers
      case "bazarr_status": {
        if (!bazarrClient) throw new Error("Bazarr not configured");
        const data = await bazarrClient.getStatus();
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      case "bazarr_get_health": {
        if (!bazarrClient) throw new Error("Bazarr not configured");
        const issues = await bazarrClient.getHealth();
        return { content: [{ type: "text", text: JSON.stringify({ count: issues.length, issues }, null, 2) }] };
      }
      case "bazarr_get_badges": {
        if (!bazarrClient) throw new Error("Bazarr not configured");
        const b = await bazarrClient.getBadges();
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              episodesMissingSubtitles: b.episodes,
              moviesMissingSubtitles: b.movies,
              providerIssues: b.providers,
              healthIssues: b.status,
              sonarrSignalR: b.sonarr_signalr,
              radarrSignalR: b.radarr_signalr,
            }, null, 2),
          }],
        };
      }
      case "bazarr_get_series": {
        if (!bazarrClient) throw new Error("Bazarr not configured");
        const a = args as { start?: number; length?: number; seriesIds?: number[] };
        const paging = bazarrPaging(a);
        const res = await bazarrClient.getSeries({ ...paging, seriesIds: a.seriesIds });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
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
            }, null, 2),
          }],
        };
      }
      case "bazarr_get_episodes": {
        if (!bazarrClient) throw new Error("Bazarr not configured");
        const { seriesId, season } = args as { seriesId: number; season?: number };
        const res = await bazarrClient.getEpisodes({ seriesIds: [seriesId] });
        const episodes = res.data
          .filter(e => season === undefined || e.season === season)
          .sort((x, y) => x.season - y.season || x.episode - y.episode);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
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
            }, null, 2),
          }],
        };
      }
      case "bazarr_get_movies": {
        if (!bazarrClient) throw new Error("Bazarr not configured");
        const a = args as { start?: number; length?: number; radarrIds?: number[] };
        const paging = bazarrPaging(a);
        const res = await bazarrClient.getMovies({ ...paging, radarrIds: a.radarrIds });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
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
            }, null, 2),
          }],
        };
      }
      case "bazarr_get_wanted_episodes": {
        if (!bazarrClient) throw new Error("Bazarr not configured");
        const res = await bazarrClient.getWantedEpisodes(bazarrPaging(args as { start?: number; length?: number }));
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
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
            }, null, 2),
          }],
        };
      }
      case "bazarr_get_wanted_movies": {
        if (!bazarrClient) throw new Error("Bazarr not configured");
        const res = await bazarrClient.getWantedMovies(bazarrPaging(args as { start?: number; length?: number }));
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              total: res.total ?? res.data.length,
              returned: res.data.length,
              movies: res.data.map(m => ({
                title: m.title,
                radarrId: m.radarrId,
                missingSubtitles: formatBazarrSubs(m.missing_subtitles),
              })),
            }, null, 2),
          }],
        };
      }
      case "bazarr_get_history": {
        if (!bazarrClient) throw new Error("Bazarr not configured");
        const a = args as { type?: 'episodes' | 'movies'; start?: number; length?: number };
        const paging = bazarrPaging(a);
        const isMovies = a.type === 'movies';
        const res = isMovies
          ? await bazarrClient.getMovieHistory(paging)
          : await bazarrClient.getEpisodeHistory(paging);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              type: isMovies ? 'movies' : 'episodes',
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
            }, null, 2),
          }],
        };
      }
      case "bazarr_search_series": {
        if (!bazarrClient) throw new Error("Bazarr not configured");
        const { seriesId } = args as { seriesId: number };
        await bazarrClient.searchSeries(seriesId);
        return { content: [{ type: "text", text: JSON.stringify({ success: true, message: `Search for missing subtitles started for series ${seriesId}` }, null, 2) }] };
      }
      case "bazarr_search_movie": {
        if (!bazarrClient) throw new Error("Bazarr not configured");
        const { radarrId } = args as { radarrId: number };
        await bazarrClient.searchMovie(radarrId);
        return { content: [{ type: "text", text: JSON.stringify({ success: true, message: `Search for missing subtitles started for movie ${radarrId}` }, null, 2) }] };
      }
      case "bazarr_download_episode_subtitle": {
        if (!bazarrClient) throw new Error("Bazarr not configured");
        const a = args as { seriesId: number; episodeId: number; language: string; forced?: boolean; hi?: boolean };
        await bazarrClient.downloadEpisodeSubtitle(a);
        return { content: [{ type: "text", text: JSON.stringify({ success: true, message: `Subtitle search/download for '${a.language}' completed for episode ${a.episodeId}. Check bazarr_get_episodes or bazarr_get_history for the result.` }, null, 2) }] };
      }
      case "bazarr_download_movie_subtitle": {
        if (!bazarrClient) throw new Error("Bazarr not configured");
        const a = args as { radarrId: number; language: string; forced?: boolean; hi?: boolean };
        await bazarrClient.downloadMovieSubtitle(a);
        return { content: [{ type: "text", text: JSON.stringify({ success: true, message: `Subtitle search/download for '${a.language}' completed for movie ${a.radarrId}. Check bazarr_get_movies or bazarr_get_history for the result.` }, null, 2) }] };
      }
      case "bazarr_get_providers": {
        if (!bazarrClient) throw new Error("Bazarr not configured");
        const providers = await bazarrClient.getProviders();
        return { content: [{ type: "text", text: JSON.stringify({ count: providers.length, providers }, null, 2) }] };
      }
      case "bazarr_reset_providers": {
        if (!bazarrClient) throw new Error("Bazarr not configured");
        await bazarrClient.resetProviders();
        return { content: [{ type: "text", text: JSON.stringify({ success: true, message: "Throttled providers reset" }, null, 2) }] };
      }
      case "bazarr_get_languages": {
        if (!bazarrClient) throw new Error("Bazarr not configured");
        const [languages, profiles] = await Promise.all([
          bazarrClient.getLanguages(),
          bazarrClient.getLanguageProfiles(),
        ]);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              enabledLanguages: languages.filter(l => l.enabled).map(l => ({ code2: l.code2, name: l.name })),
              profiles: profiles.map(p => ({
                profileId: p.profileId,
                name: p.name,
                cutoff: p.cutoff,
                languages: (p.items ?? []).map(i => ({
                  language: i.language,
                  forced: i.forced === 'True',
                  hi: i.hi === 'True',
                })),
              })),
            }, null, 2),
          }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error: ${errorMessage}` }],
      isError: true,
    };
  }
}

// Bazarr helpers
function bazarrPaging(a: { start?: number; length?: number }): { start: number; length: number } {
  const start = Math.max(0, a.start ?? 0);
  const length = Math.min(Math.max(1, a.length ?? 50), 200);
  return { start, length };
}

function formatBazarrSubs(subs?: BazarrSubtitle[]): string[] {
  return (subs ?? []).map(BazarrClient.formatSubtitle);
}

// Helper function to format bytes
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Start the server
async function main() {
  const transportMode = (process.env.MCP_TRANSPORT || 'stdio').toLowerCase();
  const isHttp = transportMode === 'http';
  if (!isHttp && transportMode !== 'stdio') {
    throw new Error(`Unknown MCP_TRANSPORT '${transportMode}' (use 'stdio' or 'http')`);
  }

  if (!isHttp) {
    // stdio: env vars, plus an (encrypted) config file only when CONFIG_PATH is set explicitly
    const store = new ConfigStore({ path: process.env.CONFIG_PATH || undefined, allowAutoKey: false });
    store.load();
    applyConfig(store.getEffective());
    const server = buildServer();
    await server.connect(new StdioServerTransport());
    console.error(`*arr MCP server running over stdio - configured services: ${statusParts.join(', ') || 'none (TRaSH-only mode)'}`);
    return;
  }

  // ----- HTTP(S) mode -----
  const store = new ConfigStore({
    path: process.env.CONFIG_PATH || resolvePath(process.cwd(), 'config', 'config.json'),
    allowAutoKey: true,
  });
  store.load();
  applyConfig(store.getEffective());
  if (store.path) stats.attachFile(joinPath(dirname(store.path), 'stats.json'));

  const [{ startHttpServer }, { Auth }, { buildRuntime, buildRuntimeOrFallback, testSettings, validateSettings }, { mergedEnv, validatePublicUrl }] = await Promise.all([
    import("./http-server.js"),
    import("./auth.js"),
    import("./runtime.js"),
    import("./settings.js"),
  ]);
  const port = Number(process.env.PORT || 3000);
  const listenHost = process.env.HOST || '0.0.0.0';
  const mcpPath = process.env.MCP_PATH || '/mcp';

  // Runs until PUBLIC_URL is changed in the web UI, then starts again with the new address
  for (;;) {
    // Settings from the web UI (encrypted config), overridden by environment variables
    const env = mergedEnv(store.getSettings(), process.env);
    let publicUrl: URL | undefined;
    let setupReason = '';
    if (env.PUBLIC_URL) {
      try {
        publicUrl = validatePublicUrl(env.PUBLIC_URL);
      } catch (error) {
        setupReason = `${error instanceof Error ? error.message : String(error)}${process.env.PUBLIC_URL ? ' (environment variable PUBLIC_URL)' : ''}`;
      }
    } else {
      setupReason = 'PUBLIC_URL is not set';
    }
    const setup = !publicUrl;
    if (setup) {
      // Setup mode: reachable by IP / container name with a temporary certificate and password
      // sign-in, so the admin can set PUBLIC_URL in the web UI.
      publicUrl = new URL(`https://localhost:${port}`);
    }
    const hostname = publicUrl!.hostname.replace(/^\[|\]$/g, '');
    const ctx = { store, publicUrl: publicUrl!, hostname, listenHost, mcpPath, setup, setupNames: localNames() };
    const runtime = await buildRuntimeOrFallback(ctx, env);

    const auth = new Auth({
      store,
      rpID: hostname,
      origin: publicUrl!.origin,
      recoveryEnabled: process.env.ADMIN_RECOVERY === 'true',
    });

    let restart!: () => void;
    const restartRequested = new Promise<void>(resolve => (restart = resolve));
    const handle = await startHttpServer({
      store,
      auth,
      runtime,
      setupReason: setup ? setupReason : undefined,
      reconfigure: (stored, previous) => buildRuntime(ctx, mergedEnv(stored, process.env), previous),
      validateForUrl: (stored, url) => validateSettings({ ...ctx, setup: false, publicUrl: url, hostname: url.hostname }, mergedEnv(stored, process.env)),
      testSettings: (stored, log) => testSettings(ctx, mergedEnv(stored, process.env), log),
      requestRestart: () => restart(),
      env: process.env,
      publicUrl: publicUrl!,
      port,
      host: listenHost,
      createServer: (caller?: CallContext) => buildServer(caller),
      mcpPath,
      serverVersion: SERVER_VERSION,
      onConfigChanged: () => applyConfig(store.getEffective()),
      getConfiguredSummary: () => statusParts,
    });
    await restartRequested;
    await handle.stop();
    console.error('Restarting with the new PUBLIC_URL ...');
  }
}

/** This machine's host name, localhost and its IP addresses (for the setup-mode certificate). */
function localNames(): string[] {
  const names = new Set<string>(['localhost', osHostname().toLowerCase(), '127.0.0.1', '::1']);
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (!a.internal && !a.address.startsWith('fe80')) names.add(a.address);
  }
  return [...names].filter(Boolean);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
