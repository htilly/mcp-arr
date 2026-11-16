/**
 * Overseerr (media requests). Enabled with OVERSEERR_URL and OVERSEERR_API_KEY.
 */

import type { CallToolResult, Tool, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { OverseerrClient, OverseerrRequest, OverseerrRequestFilter } from "../overseerr-client.js";
import { IntegrationDefinition, jsonText, textError } from "../integration.js";

const READ_ONLY: ToolAnnotations = { readOnlyHint: true, openWorldHint: true };
const OVERSEERR_REQUEST_FILTERS = ["all", "approved", "available", "pending", "processing", "unavailable", "failed"];
const OVERSEERR_USER_SORTS = ["created", "updated", "requests", "displayname"];

const paging = {
  take: { type: "integer", minimum: 1, maximum: 100, description: "Number of results to return (default 20, max 100)" },
  skip: { type: "integer", minimum: 0, description: "Number of results to skip for pagination (default 0)" },
};
const requestDecision = (verb: string) => ({
  type: "object" as const,
  properties: {
    requestId: { type: "integer", minimum: 1, description: `Request ID to ${verb} (from overseerr_get_requests)` },
    confirmed: { type: "boolean", description: `True only after the user approves the decision to ${verb} this exact request` },
  },
  required: ["requestId", "confirmed"],
});

const TOOLS: Tool[] = [
  {
    name: "overseerr_get_requests",
    annotations: READ_ONLY,
    description: "Get media requests from Overseerr, newest first: who requested what, request status (pending/approved/declined) and media status.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filter: { type: "string", enum: OVERSEERR_REQUEST_FILTERS, description: "Filter by request or media state (default all)" },
        requestedBy: { type: "integer", minimum: 1, description: "Only requests made by this Overseerr user ID" },
        ...paging,
      },
      required: [],
    },
  },
  {
    name: "overseerr_get_request_count",
    annotations: READ_ONLY,
    description: "Get Overseerr request counts by type and status (pending, approved, declined, processing, available)",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "overseerr_get_users",
    annotations: READ_ONLY,
    description: "Get Overseerr users with their request counts",
    inputSchema: {
      type: "object" as const,
      properties: {
        sort: { type: "string", enum: OVERSEERR_USER_SORTS, description: "Sort order (default created)" },
        ...paging,
      },
      required: [],
    },
  },
  {
    name: "overseerr_get_user_requests",
    annotations: READ_ONLY,
    description: "Get the requests made by one Overseerr user",
    inputSchema: {
      type: "object" as const,
      properties: {
        userId: { type: "integer", minimum: 1, description: "Overseerr user ID (from overseerr_get_users)" },
        ...paging,
      },
      required: ["userId"],
    },
  },
  {
    name: "overseerr_approve_request",
    // Approval sends the request on to Sonarr/Radarr, which add and search for it.
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    description: "Approve a pending Overseerr request. Overseerr then adds it to Sonarr/Radarr, which may start downloads. Requires confirmed=true after the user approves this exact request.",
    inputSchema: requestDecision("approve"),
  },
  {
    name: "overseerr_decline_request",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    description: "Decline a pending Overseerr request. Requires confirmed=true after the user approves declining this exact request.",
    inputSchema: requestDecision("decline"),
  },
  {
    name: "overseerr_search",
    annotations: READ_ONLY,
    description: "Search movies and TV shows through Overseerr (TMDB), including whether each is already requested or available",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", minLength: 1, maxLength: 200, description: "Search term" },
        page: { type: "integer", minimum: 1, maximum: 100, description: "Result page (default 1)" },
      },
      required: ["query"],
    },
  },
  {
    name: "overseerr_status",
    annotations: READ_ONLY,
    description: "Get Overseerr version and update status",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  }
];

async function callTool(client: OverseerrClient, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    return await handle(client, name, args);
  } catch {
    // Never pass on Overseerr's error text; it can include response details.
    return textError("Error: Service request failed; check the service logs and current state before retrying");
  }
}

async function handle(client: OverseerrClient, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  switch (name) {
    case "overseerr_get_requests": {
      const input = args as { filter?: OverseerrRequestFilter; requestedBy?: number; take?: number; skip?: number };
      if ((input.filter !== undefined && !OVERSEERR_REQUEST_FILTERS.includes(input.filter)) ||
        (input.requestedBy !== undefined && !isIntInRange(input.requestedBy, 1)) ||
        !validPaging(input)) {
        return textError(`filter must be one of ${OVERSEERR_REQUEST_FILTERS.join(", ")}; requestedBy must be a positive integer; take must be 1-100 and skip non-negative`);
      }
      const data = await client.getRequests({ take: input.take ?? 20, skip: input.skip, filter: input.filter, requestedBy: input.requestedBy });
      return jsonText({
        totalRequests: data.pageInfo.results,
        returned: data.results.length,
        requests: data.results.map(formatOverseerrRequest),
      });
    }
    case "overseerr_get_request_count": {
      return jsonText(await client.getRequestCount());
    }
    case "overseerr_get_users": {
      const input = args as { sort?: "created" | "updated" | "requests" | "displayname"; take?: number; skip?: number };
      if ((input.sort !== undefined && !OVERSEERR_USER_SORTS.includes(input.sort)) || !validPaging(input)) {
        return textError(`sort must be one of ${OVERSEERR_USER_SORTS.join(", ")}; take must be 1-100 and skip non-negative`);
      }
      const data = await client.getUsers({ take: input.take ?? 20, skip: input.skip, sort: input.sort });
      return jsonText({
        totalUsers: data.pageInfo.results,
        returned: data.results.length,
        users: data.results.map(u => ({
          id: u.id,
          displayName: u.displayName || u.username || u.plexUsername || null,
          requestCount: u.requestCount,
          createdAt: u.createdAt,
        })),
      });
    }
    case "overseerr_get_user_requests": {
      const input = args as { userId: number; take?: number; skip?: number };
      if (!isIntInRange(input.userId, 1) || !validPaging(input)) {
        return textError("userId must be a positive integer; take must be 1-100 and skip non-negative");
      }
      const data = await client.getUserRequests(input.userId, { take: input.take ?? 20, skip: input.skip });
      return jsonText({
        userId: input.userId,
        totalRequests: data.pageInfo.results,
        returned: data.results.length,
        requests: data.results.map(formatOverseerrRequest),
      });
    }
    case "overseerr_approve_request":
    case "overseerr_decline_request": {
      const input = args as { requestId: number; confirmed?: boolean };
      const approve = name === "overseerr_approve_request";
      if (!isIntInRange(input.requestId, 1)) return textError("requestId must be a positive integer");
      if (input.confirmed !== true) {
        return textError(`Explicit user approval is required before ${approve ? "approving" : "declining"} a request`);
      }
      const data = approve
        ? await client.approveRequest(input.requestId)
        : await client.declineRequest(input.requestId);
      return jsonText({
        requestId: input.requestId,
        decision: approve ? "approved" : "declined",
        newStatus: OverseerrClient.formatRequestStatus(data?.status),
      });
    }
    case "overseerr_search": {
      const input = args as { query: string; page?: number };
      if (typeof input.query !== "string" || !input.query.trim() || input.query.length > 200 ||
        (input.page !== undefined && !isIntInRange(input.page, 1, 100))) {
        return textError("query must be 1-200 characters and page must be 1-100");
      }
      const data = await client.search(input.query.trim(), input.page);
      return jsonText({
        page: data.page,
        totalPages: data.totalPages,
        totalResults: data.totalResults,
        results: (data.results ?? []).map(r => ({
          tmdbId: r.id,
          mediaType: r.mediaType,
          title: r.title ?? r.name,
          year: (r.releaseDate || r.firstAirDate || "").slice(0, 4) || null,
          ...(r.mediaType !== "person" && { status: OverseerrClient.formatMediaStatus(r.mediaInfo?.status) }),
        })),
      });
    }
    case "overseerr_status": {
      return jsonText(await client.getStatus());
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function isIntInRange(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): boolean {
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
}

function validPaging(input: { take?: unknown; skip?: unknown }): boolean {
  return (input.take === undefined || isIntInRange(input.take, 1, 100)) &&
    (input.skip === undefined || isIntInRange(input.skip, 0));
}

function formatOverseerrRequest(r: OverseerrRequest) {
  return {
    id: r.id,
    type: r.type,
    status: OverseerrClient.formatRequestStatus(r.status),
    is4k: r.is4k,
    requestedBy: r.requestedBy ? (r.requestedBy.displayName || r.requestedBy.username || r.requestedBy.plexUsername || null) : null,
    requestedById: r.requestedBy?.id ?? null,
    requestedAt: r.createdAt,
    media: {
      tmdbId: r.media?.tmdbId,
      tvdbId: r.media?.tvdbId,
      status: OverseerrClient.formatMediaStatus(r.media?.status),
    },
    ...(r.seasons?.length && { seasons: r.seasons.map(season => season.seasonNumber) }),
  };
}

export const overseerr: IntegrationDefinition = {
  name: "overseerr",
  displayName: "Overseerr (Requests)",
  envPrefix: "OVERSEERR",
  create(config) {
    const client = new OverseerrClient(config);
    return {
      tools: TOOLS,
      getStatus: async () => {
        try {
          return { version: (await client.getStatus()).version };
        } catch {
          throw new Error("Overseerr request failed; check OVERSEERR_URL and OVERSEERR_API_KEY");
        }
      },
      callTool: (name, args) => callTool(client, name, args),
    };
  },
};
