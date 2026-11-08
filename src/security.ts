/**
 * Guards applied at the MCP dispatch boundary and in the API clients.
 *
 * The low-level MCP Server does not enforce a tool's inputSchema, so arguments
 * are checked here before any handler runs.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";

/** Tools that delete data or cannot be undone. These require `confirm: true`. */
const CONFIRM_REQUIRED_TOOLS = new Set([
  "sonarr_delete_series",
  "sonarr_delete_season",
  "sonarr_delete_episode_files",
  "radarr_delete_movie",
  "radarr_delete_queue_item",
  "tautulli_terminate_session",
  "overseerr_approve_request",
  "overseerr_decline_request",
  "maintainerr_handle_collections",
]);

/**
 * Every tool that changes state on a service. A new tool that writes must be
 * added here, or ARR_READ_ONLY will not block it.
 */
const WRITE_TOOLS = new Set([
  ...CONFIRM_REQUIRED_TOOLS,
  "sonarr_search_missing",
  "sonarr_search_episode",
  "sonarr_refresh_series",
  "sonarr_add_series",
  "radarr_search_movie",
  "radarr_search_movies",
  "radarr_refresh_movie",
  "radarr_add_movie",
  "radarr_update_movie",
  "lidarr_search_album",
  "lidarr_search_missing",
  "lidarr_add_artist",
  "prowlarr_test_indexers",
  "bazarr_search_series",
  "bazarr_search_movie",
  "bazarr_download_episode_subtitle",
  "bazarr_download_movie_subtitle",
  "bazarr_reset_providers",
  "maintainerr_run_rules",
  "maintainerr_postpone_deletion",
  "maintainerr_exclude_media",
  "maintainerr_remove_exclusion",
  "maintainerr_remove_from_collection",
]);

export function isWriteTool(name: string): boolean {
  return WRITE_TOOLS.has(name);
}

/** Add MCP annotations and, where required, the `confirm` argument. */
export function applyToolPolicy(tool: Tool): void {
  const needsConfirm = CONFIRM_REQUIRED_TOOLS.has(tool.name);
  tool.annotations = {
    ...tool.annotations,
    readOnlyHint: !WRITE_TOOLS.has(tool.name),
    destructiveHint: needsConfirm,
  };
  if (needsConfirm) {
    tool.inputSchema.properties = {
      ...tool.inputSchema.properties,
      confirm: {
        type: "boolean",
        description: "Must be true. Check the target with the user before setting this.",
      },
    };
    tool.inputSchema.required = [...(tool.inputSchema.required ?? []), "confirm"];
  }
}

interface PropertySchema {
  type?: string;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  items?: PropertySchema;
}

function describeProblem(value: unknown, schema: PropertySchema): string | undefined {
  switch (schema.type) {
    case "integer":
      if (typeof value !== "number" || !Number.isSafeInteger(value)) return "must be an integer";
      if (schema.minimum !== undefined && value < schema.minimum) return `must be at least ${schema.minimum}`;
      if (schema.maximum !== undefined && value > schema.maximum) return `must be at most ${schema.maximum}`;
      break;
    case "string":
      if (typeof value !== "string") return "must be a string";
      break;
    case "boolean":
      if (typeof value !== "boolean") return "must be a boolean";
      break;
    case "array":
      if (!Array.isArray(value)) return "must be an array";
      if (schema.items) {
        for (const item of value) {
          const problem = describeProblem(item, schema.items);
          if (problem) return `items ${problem}`;
        }
      }
      break;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    return `must be one of: ${schema.enum.join(", ")}`;
  }
  return undefined;
}

/** Throw unless `args` satisfies the tool's inputSchema and confirmation rule. */
export function validateToolArgs(tool: Tool, args: Record<string, unknown>): void {
  const fail = (problem: string): never => {
    throw new Error(`Invalid arguments for ${tool.name}: ${problem}`);
  };

  for (const key of tool.inputSchema.required ?? []) {
    if (args[key] === undefined) fail(`${key} is required`);
  }

  const properties = (tool.inputSchema.properties ?? {}) as Record<string, PropertySchema>;
  for (const [key, schema] of Object.entries(properties)) {
    if (args[key] === undefined) continue;
    const problem = describeProblem(args[key], schema);
    if (problem) fail(`${key} ${problem}`);
  }

  if (CONFIRM_REQUIRED_TOOLS.has(tool.name) && args.confirm !== true) {
    fail("confirm must be true");
  }
}

/** A positive integer ID, encoded for use in a URL path or query string. */
export function pathId(id: number): string {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("ID must be a positive integer");
  }
  return encodeURIComponent(id);
}

/**
 * Check a service base URL. The value is left out of the error because a
 * misplaced API key could be part of it.
 */
export function validateServiceUrl(envName: string, url: string): void {
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    protocol = "";
  }
  // "localhost:8181" parses with "localhost:" as its protocol, so check the scheme too.
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error(`${envName} must be a full http:// or https:// URL, for example http://localhost:8989`);
  }
}

/**
 * Cloud metadata and link-local addresses. A service URL never needs these, and
 * pointing one there would hand the response (and the API key) to the metadata API.
 * Loopback and private LAN ranges stay allowed: reaching them is the point.
 */
export function isBlockedServiceHost(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return false;
  }
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(host)) return true; // IPv4 link-local (AWS/GCP/Azure metadata)
  if (/^fe[89ab][0-9a-f]?:/.test(host)) return true; // IPv6 link-local
  if (/^::ffff:(169\.254\.|a9fe:)/.test(host)) return true; // IPv4-mapped link-local
  if (host === "fd00:ec2::254" || host === "100.100.100.200") return true; // AWS IPv6 / Alibaba metadata
  return host === "metadata.google.internal" || host === "metadata" || host === "instance-data";
}

/** Origin of a URL, or undefined when it does not parse. */
export function urlOrigin(url: string | undefined): string | undefined {
  try {
    return url ? new URL(url).origin : undefined;
  } catch {
    return undefined;
  }
}

/** Build a function that removes API keys from text sent back to the client. */
export function createRedactor(secrets: Array<string | undefined>): (text: string) => string {
  const known = secrets.filter((s): s is string => Boolean(s));
  return (text) => {
    let result = text.replace(/([?&]api_?key=)[^&\s"']+/gi, "$1[REDACTED]");
    for (const secret of known) {
      result = result.split(secret).join("[REDACTED]");
    }
    return result;
  };
}
