#!/usr/bin/env node
/**
 * MCP Server for *arr Media Management Suite + Tautulli + Overseerr
 *
 * Environment variables:
 * - SONARR_URL, SONARR_API_KEY, RADARR_URL, RADARR_API_KEY, etc.
 * - TAUTULLI_URL, TAUTULLI_API_KEY
 * - OVERSEERR_URL, OVERSEERR_API_KEY
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import {
  SonarrClient,
  RadarrClient,
  LidarrClient,
  ReadarrClient,
  ProwlarrClient,
  ArrService,
} from "./arr-client.js";
import { trashClient, TrashService } from "./trash-client.js";
import { TautulliClient } from "./tautulli-client.js";
import { OverseerrClient } from "./overseerr-client.js";

// Configuration from environment
interface ServiceConfig {
  name: ArrService;
  displayName: string;
  url?: string;
  apiKey?: string;
}

const services: ServiceConfig[] = [
  { name: 'sonarr', displayName: 'Sonarr (TV)', url: process.env.SONARR_URL, apiKey: process.env.SONARR_API_KEY },
  { name: 'radarr', displayName: 'Radarr (Movies)', url: process.env.RADARR_URL, apiKey: process.env.RADARR_API_KEY },
  { name: 'lidarr', displayName: 'Lidarr (Music)', url: process.env.LIDARR_URL, apiKey: process.env.LIDARR_API_KEY },
  { name: 'readarr', displayName: 'Readarr (Books)', url: process.env.READARR_URL, apiKey: process.env.READARR_API_KEY },
  { name: 'prowlarr', displayName: 'Prowlarr (Indexers)', url: process.env.PROWLARR_URL, apiKey: process.env.PROWLARR_API_KEY },
];

const configuredServices = services.filter(s => s.url && s.apiKey);
const tautulliUrl = process.env.TAUTULLI_URL;
const tautulliApiKey = process.env.TAUTULLI_API_KEY;
const tautulliConfigured = Boolean(tautulliUrl && tautulliApiKey);
const overseerrUrl = process.env.OVERSEERR_URL;
const overseerrApiKey = process.env.OVERSEERR_API_KEY;
const overseerrConfigured = Boolean(overseerrUrl && overseerrApiKey);

if (configuredServices.length === 0 && !tautulliConfigured && !overseerrConfigured) {
  console.error("Error: No services configured. Set at least one of: *arr (SONARR_URL+API_KEY, etc.), Tautulli (TAUTULLI_URL+TAUTULLI_API_KEY), or Overseerr (OVERSEERR_URL+OVERSEERR_API_KEY)");
  process.exit(1);
}

const clients: {
  sonarr?: SonarrClient;
  radarr?: RadarrClient;
  lidarr?: LidarrClient;
  readarr?: ReadarrClient;
  prowlarr?: ProwlarrClient;
} = {};

let tautulliClient: TautulliClient | undefined;
if (tautulliConfigured) {
  tautulliClient = new TautulliClient({ url: tautulliUrl!, apiKey: tautulliApiKey! });
}

let overseerrClient: OverseerrClient | undefined;
if (overseerrConfigured) {
  overseerrClient = new OverseerrClient({ url: overseerrUrl!, apiKey: overseerrApiKey! });
}

for (const service of configuredServices) {
  const config = { url: service.url!, apiKey: service.apiKey! };
  switch (service.name) {
    case 'sonarr':
      clients.sonarr = new SonarrClient(config);
      break;
    case 'radarr':
      clients.radarr = new RadarrClient(config);
      break;
    case 'lidarr':
      clients.lidarr = new LidarrClient(config);
      break;
    case 'readarr':
      clients.readarr = new ReadarrClient(config);
      break;
    case 'prowlarr':
      clients.prowlarr = new ProwlarrClient(config);
      break;
  }
}

const statusParts = configuredServices.map(s => s.displayName);
if (tautulliConfigured) statusParts.push('Tautulli (Plex)');
if (overseerrConfigured) statusParts.push('Overseerr (Requests)');
const TOOLS: Tool[] = [
  {
    name: "arr_status",
    description: `Get status of all configured services. Currently configured: ${statusParts.join(', ')}`,
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
];

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
if (clients.readarr) addConfigTools('readarr', 'Readarr (Books)');

// Sonarr tools
if (clients.sonarr) {
  TOOLS.push(
    {
      name: "sonarr_get_series",
      description: "Get all TV series in Sonarr library. Optional sortBy: 'dateAdded' or 'sizeOnDisk'. Optional sortDir: 'asc' or 'desc'. Optional limit: return only the first N items.",
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
            description: "Return only the first N series (e.g. 100). Omit for all. Max 1000.",
          },
        },
        required: [],
      },
    },
    {
      name: "sonarr_search",
      description: "Search for TV series to add to Sonarr",
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
      description: "Get Sonarr download queue",
      inputSchema: {
        type: "object" as const,
        properties: {},
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
    }
  );
}

// Radarr tools
if (clients.radarr) {
  TOOLS.push(
    {
      name: "radarr_get_movies",
      description: "Get all movies in Radarr library. Optional sortBy: 'dateAdded' or 'sizeOnDisk'. Optional sortDir: 'asc' or 'desc'. Optional limit: return only the first N movies.",
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
            description: "Return only the first N movies (e.g. 100). Omit for all. Max 1000.",
          },
        },
        required: [],
      },
    },
    {
      name: "radarr_search",
      description: "Search for movies to add to Radarr",
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
      description: "Get Radarr download queue",
      inputSchema: {
        type: "object" as const,
        properties: {},
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
    }
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
      description: "Search for artists to add to Lidarr",
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
      description: "Get Lidarr download queue",
      inputSchema: {
        type: "object" as const,
        properties: {},
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
    }
  );
}

// Readarr tools
if (clients.readarr) {
  TOOLS.push(
    {
      name: "readarr_get_authors",
      description: "Get all authors in Readarr library",
      inputSchema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: "readarr_search",
      description: "Search for authors to add to Readarr",
      inputSchema: {
        type: "object" as const,
        properties: {
          term: {
            type: "string",
            description: "Search term (author name)",
          },
        },
        required: ["term"],
      },
    },
    {
      name: "readarr_get_queue",
      description: "Get Readarr download queue",
      inputSchema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: "readarr_get_books",
      description: "Get books for an author in Readarr. Shows which books are available and which are missing.",
      inputSchema: {
        type: "object" as const,
        properties: {
          authorId: {
            type: "number",
            description: "Author ID to get books for",
          },
        },
        required: ["authorId"],
      },
    },
    {
      name: "readarr_search_book",
      description: "Trigger a search for a specific book to download",
      inputSchema: {
        type: "object" as const,
        properties: {
          bookIds: {
            type: "array",
            items: { type: "number" },
            description: "Book ID(s) to search for",
          },
        },
        required: ["bookIds"],
      },
    },
    {
      name: "readarr_search_missing",
      description: "Trigger a search for all missing books for an author",
      inputSchema: {
        type: "object" as const,
        properties: {
          authorId: {
            type: "number",
            description: "Author ID to search missing books for",
          },
        },
        required: ["authorId"],
      },
    },
    {
      name: "readarr_get_calendar",
      description: "Get upcoming book releases from Readarr",
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

// Create server instance
const server = new Server(
  {
    name: "mcp-arr",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
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
        return {
          content: [{ type: "text", text: JSON.stringify(statuses, null, 2) }],
        };
      }

      // Dynamic config tool handlers
      // Quality Profiles
      case "sonarr_get_quality_profiles":
      case "radarr_get_quality_profiles":
      case "lidarr_get_quality_profiles":
      case "readarr_get_quality_profiles": {
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
      case "lidarr_get_health":
      case "readarr_get_health": {
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
      case "lidarr_get_root_folders":
      case "readarr_get_root_folders": {
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
      case "lidarr_get_download_clients":
      case "readarr_get_download_clients": {
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
      case "lidarr_get_naming":
      case "readarr_get_naming": {
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
      case "lidarr_get_tags":
      case "readarr_get_tags": {
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
      case "lidarr_review_setup":
      case "readarr_review_setup": {
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

        // For Lidarr/Readarr, also get metadata profiles
        let metadataProfiles = null;
        if (serviceName === 'lidarr' && clients.lidarr) {
          metadataProfiles = await clients.lidarr.getMetadataProfiles();
        } else if (serviceName === 'readarr' && clients.readarr) {
          metadataProfiles = await clients.readarr.getMetadataProfiles();
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
        const a = args as { sortBy?: string; sortDir?: string; limit?: number };
        const raw = a.sortBy;
        const sortBy = raw === 'dateAdded' || raw === 'sizeOnDisk' ? raw : undefined;
        const sortDir = a.sortDir === 'asc' || a.sortDir === 'desc' ? a.sortDir : undefined;
        const limitRaw = a.limit != null ? Number(a.limit) : NaN;
        const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 1000) : undefined;
        let series = await clients.sonarr.getSeries();
        if (sortBy === 'dateAdded') {
          const dir = sortDir ?? 'asc';
          series = [...series].sort((a, b) => {
            const cmp = (a.added ?? '').localeCompare(b.added ?? '');
            return dir === 'desc' ? -cmp : cmp;
          });
        } else if (sortBy === 'sizeOnDisk') {
          const dir = sortDir ?? 'desc';
          series = [...series].sort((a, b) => {
            const cmp = (b.statistics?.sizeOnDisk ?? 0) - (a.statistics?.sizeOnDisk ?? 0);
            return dir === 'asc' ? -cmp : cmp;
          });
        }
        const totalCount = series.length;
        if (limit != null) series = series.slice(0, limit);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              totalCount,
              ...(limit != null && { limitedTo: limit }),
              count: series.length,
              sortBy: sortBy ?? undefined,
              sortDir: sortBy ? (sortDir ?? (sortBy === 'dateAdded' ? 'asc' : 'desc')) : undefined,
              series: series.map(s => ({
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
        const queue = await clients.sonarr.getQueue();
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              totalRecords: queue.totalRecords,
              items: queue.records.map(q => ({
                title: q.title,
                status: q.status,
                progress: ((1 - q.sizeleft / q.size) * 100).toFixed(1) + '%',
                timeLeft: q.timeleft,
                downloadClient: q.downloadClient,
              })),
            }, null, 2),
          }],
        };
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

      // Radarr handlers
      case "radarr_get_movies": {
        if (!clients.radarr) throw new Error("Radarr not configured");
        const a = args as { sortBy?: string; sortDir?: string; limit?: number };
        const raw = a.sortBy;
        const sortBy = raw === 'dateAdded' || raw === 'added' ? 'dateAdded' : raw === 'sizeOnDisk' ? 'sizeOnDisk' : undefined;
        const sortDir = a.sortDir === 'asc' || a.sortDir === 'desc' ? a.sortDir : undefined;
        const limitRaw = a.limit != null ? Number(a.limit) : NaN;
        const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 1000) : undefined;
        let movies = await clients.radarr.getMovies();
        if (sortBy === 'dateAdded') {
          const dir = sortDir ?? 'asc';
          movies = [...movies].sort((a, b) => {
            const da = a.dateAdded ?? a.added ?? '';
            const db = b.dateAdded ?? b.added ?? '';
            const cmp = da.localeCompare(db);
            return dir === 'desc' ? -cmp : cmp;
          });
        } else if (sortBy === 'sizeOnDisk') {
          const dir = sortDir ?? 'desc';
          movies = [...movies].sort((a, b) => {
            const cmp = (b.sizeOnDisk ?? 0) - (a.sizeOnDisk ?? 0);
            return dir === 'asc' ? -cmp : cmp;
          });
        }
        const totalCount = movies.length;
        if (limit != null) movies = movies.slice(0, limit);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              totalCount,
              ...(limit != null && { limitedTo: limit }),
              count: movies.length,
              sortBy: sortBy ?? undefined,
              sortDir: sortBy ? (sortDir ?? (sortBy === 'dateAdded' ? 'asc' : 'desc')) : undefined,
              movies: movies.map(m => ({
                id: m.id,
                title: m.title,
                year: m.year,
                status: m.status,
                hasFile: m.hasFile,
                sizeOnDisk: formatBytes(m.sizeOnDisk),
                monitored: m.monitored,
                studio: m.studio,
                dateAdded: m.dateAdded ?? m.added,
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
                overview: r.overview?.substring(0, 200) + (r.overview && r.overview.length > 200 ? '...' : ''),
              })),
            }, null, 2),
          }],
        };
      }

      case "radarr_get_queue": {
        if (!clients.radarr) throw new Error("Radarr not configured");
        const queue = await clients.radarr.getQueue();
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              totalRecords: queue.totalRecords,
              items: queue.records.map(q => ({
                title: q.title,
                status: q.status,
                progress: ((1 - q.sizeleft / q.size) * 100).toFixed(1) + '%',
                timeLeft: q.timeleft,
                downloadClient: q.downloadClient,
              })),
            }, null, 2),
          }],
        };
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
        const term = (args as { term: string }).term;
        const results = await clients.lidarr.searchArtists(term);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              count: results.length,
              results: results.slice(0, 10).map(r => ({
                title: r.title,
                foreignArtistId: r.foreignArtistId,
                overview: r.overview?.substring(0, 200) + (r.overview && r.overview.length > 200 ? '...' : ''),
              })),
            }, null, 2),
          }],
        };
      }

      case "lidarr_get_queue": {
        if (!clients.lidarr) throw new Error("Lidarr not configured");
        const queue = await clients.lidarr.getQueue();
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              totalRecords: queue.totalRecords,
              items: queue.records.map(q => ({
                title: q.title,
                status: q.status,
                progress: ((1 - q.sizeleft / q.size) * 100).toFixed(1) + '%',
                timeLeft: q.timeleft,
                downloadClient: q.downloadClient,
              })),
            }, null, 2),
          }],
        };
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

      // Readarr handlers
      case "readarr_get_authors": {
        if (!clients.readarr) throw new Error("Readarr not configured");
        const authors = await clients.readarr.getAuthors();
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              count: authors.length,
              authors: authors.map(a => ({
                id: a.id,
                authorName: a.authorName,
                status: a.status,
                books: a.statistics?.bookFileCount + '/' + a.statistics?.totalBookCount,
                sizeOnDisk: formatBytes(a.statistics?.sizeOnDisk || 0),
                monitored: a.monitored,
                dateAdded: a.added,
              })),
            }, null, 2),
          }],
        };
      }

      case "readarr_search": {
        if (!clients.readarr) throw new Error("Readarr not configured");
        const term = (args as { term: string }).term;
        const results = await clients.readarr.searchAuthors(term);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              count: results.length,
              results: results.slice(0, 10).map(r => ({
                title: r.title,
                foreignAuthorId: r.foreignAuthorId,
                overview: r.overview?.substring(0, 200) + (r.overview && r.overview.length > 200 ? '...' : ''),
              })),
            }, null, 2),
          }],
        };
      }

      case "readarr_get_queue": {
        if (!clients.readarr) throw new Error("Readarr not configured");
        const queue = await clients.readarr.getQueue();
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              totalRecords: queue.totalRecords,
              items: queue.records.map(q => ({
                title: q.title,
                status: q.status,
                progress: ((1 - q.sizeleft / q.size) * 100).toFixed(1) + '%',
                timeLeft: q.timeleft,
                downloadClient: q.downloadClient,
              })),
            }, null, 2),
          }],
        };
      }

      case "readarr_get_books": {
        if (!clients.readarr) throw new Error("Readarr not configured");
        const authorId = (args as { authorId: number }).authorId;
        const books = await clients.readarr.getBooks(authorId);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              count: books.length,
              books: books.map(b => ({
                id: b.id,
                title: b.title,
                releaseDate: b.releaseDate,
                pageCount: b.pageCount,
                monitored: b.monitored,
                hasFile: b.statistics ? b.statistics.bookFileCount > 0 : false,
                sizeOnDisk: formatBytes(b.statistics?.sizeOnDisk || 0),
                grabbed: b.grabbed,
                dateAdded: (b as { added?: string }).added,
              })),
            }, null, 2),
          }],
        };
      }

      case "readarr_search_book": {
        if (!clients.readarr) throw new Error("Readarr not configured");
        const bookIds = (args as { bookIds: number[] }).bookIds;
        const result = await clients.readarr.searchBook(bookIds);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: `Search triggered for ${bookIds.length} book(s)`,
              commandId: result.id,
            }, null, 2),
          }],
        };
      }

      case "readarr_search_missing": {
        if (!clients.readarr) throw new Error("Readarr not configured");
        const authorId = (args as { authorId: number }).authorId;
        const result = await clients.readarr.searchMissingBooks(authorId);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: `Search triggered for missing books`,
              commandId: result.id,
            }, null, 2),
          }],
        };
      }

      case "readarr_get_calendar": {
        if (!clients.readarr) throw new Error("Readarr not configured");
        const days = (args as { days?: number })?.days || 30;
        const start = new Date().toISOString().split('T')[0];
        const end = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const calendar = await clients.readarr.getCalendar(start, end);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              count: calendar.length,
              books: calendar.map(b => ({
                id: b.id,
                title: b.title,
                authorId: b.authorId,
                releaseDate: b.releaseDate,
                monitored: b.monitored,
              })),
            }, null, 2),
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

        if (clients.readarr) {
          try {
            const readarrResults = await clients.readarr.searchAuthors(term);
            results.readarr = { count: readarrResults.length, results: readarrResults.slice(0, 5) };
          } catch (e) {
            results.readarr = { error: e instanceof Error ? e.message : String(e) };
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
});

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
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`*arr MCP server running - configured services: ${configuredServices.map(s => s.name).join(', ')}`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
