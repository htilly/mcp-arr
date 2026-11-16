/**
 * Tautulli (Plex monitoring). Enabled with TAUTULLI_URL and TAUTULLI_API_KEY.
 */

import type { CallToolResult, Tool, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { TautulliClient } from "../tautulli-client.js";
import { IntegrationDefinition, jsonText, textError } from "../integration.js";

const READ_ONLY: ToolAnnotations = { readOnlyHint: true, openWorldHint: true };

const TOOLS: Tool[] = [
  {
    name: "tautulli_get_activity",
    annotations: READ_ONLY,
    description: "Get current Plex activity (active streams, with session_key/session_id) from Tautulli",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "tautulli_get_history",
    annotations: READ_ONLY,
    description: "Get Plex watch history from Tautulli. With title: report whether the title exists in the Plex library, how many plays match, and who watched it when. Without title: most recent history records.",
    inputSchema: {
      type: "object" as const,
      properties: {
        title: { type: "string", maxLength: 200, description: "Title to look up (e.g. 'Dune: Prophecy')" },
        user_id: { type: "integer", minimum: 0, description: "Filter by Tautulli user ID (0 is the local Plex user)" },
        media_type: { type: "string", enum: ["movie", "episode", "track", "live"], description: "Filter by media type" },
        length: { type: "integer", minimum: 1, maximum: 100, description: "Number of records to return (default 25)" },
        start: { type: "integer", minimum: 0, description: "Record offset for pagination (default 0)" },
      },
      required: [],
    },
  },
  {
    name: "tautulli_get_libraries",
    annotations: READ_ONLY,
    description: "Get Plex libraries (section IDs, names, item counts) from Tautulli",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "tautulli_get_server_info",
    annotations: READ_ONLY,
    description: "Get Plex server info (name, version, platform) from Tautulli",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "tautulli_get_home_stats",
    annotations: READ_ONLY,
    description: "Get Tautulli home statistics (most watched, most active users, platforms)",
    inputSchema: {
      type: "object" as const,
      properties: {
        time_range: { type: "integer", minimum: 1, maximum: 3650, description: "Days to look back (default 30)" },
        stats_count: { type: "integer", minimum: 1, maximum: 100, description: "Items per statistic (default 10)" },
      },
      required: [],
    },
  },
  {
    name: "tautulli_get_users",
    annotations: READ_ONLY,
    description: "Get Plex users known to Tautulli",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "tautulli_get_recently_added",
    annotations: READ_ONLY,
    description: "Get recently added Plex media from Tautulli",
    inputSchema: {
      type: "object" as const,
      properties: {
        count: { type: "integer", minimum: 1, maximum: 100, description: "Number of items (default 25)" },
        section_id: { type: "integer", minimum: 1, description: "Limit to one library section ID" },
      },
      required: [],
    },
  },
  {
    name: "tautulli_server_status",
    annotations: READ_ONLY,
    description: "Check whether Tautulli can reach the Plex server",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "tautulli_terminate_session",
    // Stops someone's stream; repeating it has no further effect.
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    description: "Stop an active Plex stream via Tautulli. Requires confirmed=true after the user approves stopping this exact stream. Identify it with session_key or session_id from tautulli_get_activity.",
    inputSchema: {
      type: "object" as const,
      properties: {
        session_key: { type: "integer", minimum: 1, description: "Session key from tautulli_get_activity" },
        session_id: { type: "string", minLength: 1, maxLength: 128, description: "Session ID from tautulli_get_activity" },
        message: { type: "string", maxLength: 500, description: "Optional message shown to the viewer" },
        confirmed: { type: "boolean", description: "True only after the user approves stopping this stream" },
      },
      required: ["confirmed"],
    },
  },
];

async function handleTool(client: TautulliClient, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  switch (name) {
    case "tautulli_get_activity":
    case "tautulli_get_libraries":
    case "tautulli_get_server_info":
    case "tautulli_get_users":
    case "tautulli_server_status": {
      const data = name === "tautulli_get_activity" ? await client.getActivity()
        : name === "tautulli_get_libraries" ? await client.getLibraries()
        : name === "tautulli_get_server_info" ? await client.getServerInfo()
        : name === "tautulli_get_users" ? await client.getUsers()
        : await client.getServerStatus();
      return jsonText(data);
    }
    case "tautulli_get_history": {
      const input = args as { title?: string; user_id?: number; media_type?: string; length?: number; start?: number };
      if ((input.title !== undefined && (typeof input.title !== "string" || input.title.length > 200)) ||
        (input.user_id !== undefined && !isIntInRange(input.user_id, 0)) ||
        (input.media_type !== undefined && !["movie", "episode", "track", "live"].includes(input.media_type)) ||
        (input.length !== undefined && !isIntInRange(input.length, 1, 100)) ||
        (input.start !== undefined && !isIntInRange(input.start, 0))) {
        return textError("Invalid arguments: title is a string up to 200 characters, user_id and start are non-negative integers, length is 1-100, media_type is movie, episode, track or live");
      }
      const title = input.title?.trim();
      const query = {
        user_id: input.user_id,
        media_type: input.media_type,
        start: input.start ?? 0,
        length: input.length ?? 25,
        order_column: "date",
        order_dir: "desc",
      };
      if (!title) return jsonText(await client.getHistory(query));
      const [library, history] = await Promise.all([
        client.searchLibrary(title, 10).catch(() => null),
        client.getHistory({ ...query, search: title }),
      ]);
      const rows = Array.isArray(history.data) ? history.data : [];
      const libraryMatches = library
        ? Math.max(library.results_count ?? 0, Object.values(library.results_list ?? {}).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0))
        : null;
      return jsonText({
        searchedFor: title,
        existsInLibrary: libraryMatches === null ? null : libraryMatches > 0,
        ...(libraryMatches === null && { librarySearch: "failed; existsInLibrary is unknown" }),
        watchedCount: history.recordsFiltered ?? rows.length,
        returned: rows.length,
        history: rows.map(row => ({
          who: row.friendly_name ?? row.user ?? null,
          when: typeof row.date === "number" ? new Date(row.date * 1000).toISOString() : null,
          title: row.full_title ?? row.title ?? null,
          mediaType: row.media_type ?? null,
        })),
      });
    }
    case "tautulli_get_home_stats": {
      const input = args as { time_range?: number; stats_count?: number };
      if ((input.time_range !== undefined && !isIntInRange(input.time_range, 1, 3650)) ||
        (input.stats_count !== undefined && !isIntInRange(input.stats_count, 1, 100))) {
        return textError("time_range must be 1-3650 and stats_count must be 1-100");
      }
      return jsonText(await client.getHomeStats({ time_range: input.time_range, stats_count: input.stats_count }));
    }
    case "tautulli_get_recently_added": {
      const input = args as { count?: number; section_id?: number };
      if ((input.count !== undefined && !isIntInRange(input.count, 1, 100)) ||
        (input.section_id !== undefined && !isIntInRange(input.section_id, 1))) {
        return textError("count must be 1-100 and section_id must be a positive integer");
      }
      return jsonText(await client.getRecentlyAdded({ count: input.count ?? 25, section_id: input.section_id }));
    }
    case "tautulli_terminate_session": {
      const input = args as { session_key?: number; session_id?: string; message?: string; confirmed?: boolean };
      const hasKey = input.session_key !== undefined;
      const hasId = input.session_id !== undefined;
      if ((!hasKey && !hasId) ||
        (hasKey && !isIntInRange(input.session_key, 1)) ||
        (hasId && (typeof input.session_id !== "string" || !input.session_id.trim() || input.session_id.length > 128)) ||
        (input.message !== undefined && (typeof input.message !== "string" || input.message.length > 500))) {
        return textError("Provide a valid session_key or session_id from tautulli_get_activity (message up to 500 characters)");
      }
      if (input.confirmed !== true) {
        return textError("Explicit user approval is required before terminating a stream");
      }
      await client.terminateSession({ session_key: input.session_key, session_id: input.session_id, message: input.message });
      return jsonText({ terminated: true, session_key: input.session_key, session_id: input.session_id });
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// Tautulli error text can include response details, so failures are reported generically.
async function callTool(client: TautulliClient, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    return await handleTool(client, name, args);
  } catch {
    return textError("Error: Service request failed; check the service logs and current state before retrying");
  }
}

function isIntInRange(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): boolean {
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
}

export const tautulli: IntegrationDefinition = {
  name: "tautulli",
  displayName: "Tautulli (Plex)",
  envPrefix: "TAUTULLI",
  create(config) {
    const client = new TautulliClient(config);
    return {
      tools: TOOLS,
      async getStatus() {
        try {
          return { version: (await client.getTautulliInfo()).tautulli_version };
        } catch {
          throw new Error("Tautulli request failed; check TAUTULLI_URL and TAUTULLI_API_KEY");
        }
      },
      callTool: (name, args) => callTool(client, name, args),
    };
  },
};
