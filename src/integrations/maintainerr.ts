/**
 * Maintainerr (rule-based library cleanup). Enabled with MAINTAINERR_URL and
 * MAINTAINERR_API_KEY. Media ids are media server item ids (Plex rating key or
 * Jellyfin/Emby id).
 */

import type { CallToolResult, Tool, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { MaintainerrClient } from "../maintainerr-client.js";
import { IntegrationDefinition, jsonText, textError } from "../integration.js";

const READ_ONLY: ToolAnnotations = { readOnlyHint: true, openWorldHint: true };
// Removes an item (and optionally blocklists the release).
const DELETES: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true };

const mediaIdProp = {
  mediaId: { type: "string", pattern: "^[A-Za-z0-9-]{1,64}$", description: "Media server item id (Plex rating key or Jellyfin/Emby id). Find it with maintainerr_search_media or maintainerr_get_collection_media" },
};
const pageProps = {
  page: { type: "integer", minimum: 1, description: "Page number (default: 1)" },
  size: { type: "integer", minimum: 1, maximum: 100, description: "Items per page (default: 25, max: 100)" },
};

const TOOLS: Tool[] = [
  {
    name: "maintainerr_status",
    annotations: READ_ONLY,
    description: "Get Maintainerr version, health and whether rules are running right now",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "maintainerr_get_collections",
    annotations: READ_ONLY,
    description: "Get Maintainerr collections (media marked for removal): item count, size, days until deletion and the Sonarr/Radarr action taken when the grace period ends",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "maintainerr_get_collection_media",
    annotations: READ_ONLY,
    description: "Get the items in a Maintainerr collection with size, date added and the date each will be deleted",
    inputSchema: {
      type: "object" as const,
      properties: {
        collectionId: { type: "integer", minimum: 1, description: "Collection id from maintainerr_get_collections" },
        ...pageProps,
      },
      required: ["collectionId"],
    },
  },
  {
    name: "maintainerr_get_collection_logs",
    annotations: READ_ONLY,
    description: "Get the activity log of a Maintainerr collection (items added, removed, handled/deleted, postponed), newest first",
    inputSchema: {
      type: "object" as const,
      properties: {
        collectionId: { type: "integer", minimum: 1, description: "Collection id from maintainerr_get_collections" },
        search: { type: "string", maxLength: 200, description: "Only log lines containing this text, e.g. a title" },
        ...pageProps,
      },
      required: ["collectionId"],
    },
  },
  {
    name: "maintainerr_get_rules",
    annotations: READ_ONLY,
    description: "Get Maintainerr rule groups: name, description, library, media type, active state, collection and number of rules",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "maintainerr_get_exclusions",
    annotations: READ_ONLY,
    description: "Get items excluded from Maintainerr rules (never added to a collection). Global exclusions have no ruleGroupId",
    inputSchema: {
      type: "object" as const,
      properties: {
        ruleGroupId: { type: "integer", minimum: 1, description: "Only exclusions for this rule group" },
        mediaId: { ...mediaIdProp.mediaId, description: "Only exclusions for this media server item id" },
      },
      required: [],
    },
  },
  {
    name: "maintainerr_search_media",
    annotations: READ_ONLY,
    description: "Search the media server through Maintainerr by title. Returns the media server item id (mediaId) and which Maintainerr collections the item is in",
    inputSchema: {
      type: "object" as const,
      properties: { query: { type: "string", minLength: 1, maxLength: 200, description: "Title to search for" } },
      required: ["query"],
    },
  },
  {
    name: "maintainerr_get_media_status",
    annotations: READ_ONLY,
    description: "Get the Maintainerr status of one item: which rule groups it is excluded from and which collections it was added to manually",
    inputSchema: { type: "object" as const, properties: { ...mediaIdProp }, required: ["mediaId"] },
  },
  {
    name: "maintainerr_run_rules",
    // Each call queues a new rule run; it updates collections but deletes nothing.
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    description: "Run Maintainerr rules now to update collections (adds/removes items; does not delete anything). Without ruleGroupId all active rule groups run",
    inputSchema: {
      type: "object" as const,
      properties: { ruleGroupId: { type: "integer", minimum: 1, description: "Run only this rule group" } },
      required: [],
    },
  },
  {
    name: "maintainerr_postpone_deletion",
    // Each call with days moves the deletion date out again.
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    description: "Postpone the deletion of an item in a Maintainerr collection. Without days the full grace period restarts from today; with days the deletion date moves out by that many days",
    inputSchema: {
      type: "object" as const,
      properties: {
        collectionId: { type: "integer", minimum: 1, description: "Collection id" },
        ...mediaIdProp,
        days: { type: "integer", minimum: 1, maximum: 3650, description: "Days to push the deletion out (default: restart the grace period)" },
      },
      required: ["collectionId", "mediaId"],
    },
  },
  {
    name: "maintainerr_exclude_media",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    description: "Exclude an item from Maintainerr rules so it is never deleted (removes it from collections). Without collectionId the exclusion is global; with it, only that collection's rule group",
    inputSchema: {
      type: "object" as const,
      properties: {
        ...mediaIdProp,
        collectionId: { type: "integer", minimum: 1, description: "Only exclude from this collection's rule group" },
      },
      required: ["mediaId"],
    },
  },
  {
    name: "maintainerr_remove_exclusion",
    annotations: DELETES,
    description: "Remove a Maintainerr exclusion so rules apply to the item again (it can then be scheduled for deletion). Use the same collectionId as when it was excluded (omit for a global exclusion)",
    inputSchema: {
      type: "object" as const,
      properties: {
        ...mediaIdProp,
        collectionId: { type: "integer", minimum: 1, description: "Collection whose rule group the exclusion belongs to" },
      },
      required: ["mediaId"],
    },
  },
  {
    name: "maintainerr_remove_from_collection",
    annotations: DELETES,
    description: "Remove an item from a Maintainerr collection. The next rule run can add it again; use maintainerr_exclude_media to keep it out for good",
    inputSchema: {
      type: "object" as const,
      properties: {
        collectionId: { type: "integer", minimum: 1, description: "Collection id" },
        ...mediaIdProp,
      },
      required: ["collectionId", "mediaId"],
    },
  },
  {
    name: "maintainerr_handle_collections",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    description: "Run the Maintainerr collection handler now: every item whose grace period is over gets its collection's Sonarr/Radarr action, which usually DELETES the media and its files. Check maintainerr_get_collection_media first. Requires confirmed=true; call only after the user explicitly approves",
    inputSchema: {
      type: "object" as const,
      properties: {
        confirmed: { type: "boolean", description: "True only after the user approves deleting the media whose grace period is over" },
      },
      required: ["confirmed"],
    },
  }
];

async function callTool(client: MaintainerrClient, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  switch (name) {
    case "maintainerr_status": {
      const [app, health, execution] = await Promise.all([
        client.getAppStatus(),
        client.getHealth(),
        client.getExecutionStatus(),
      ]);
      return jsonText({
        version: app.version,
        updateAvailable: app.updateAvailable,
        health: health.status,
        database: health.database,
        uptimeSeconds: health.uptimeSeconds,
        rulesRunning: Boolean(execution.processingQueue || execution.executingRuleGroupId),
        executingRuleGroupId: execution.executingRuleGroupId ?? null,
        pendingRuleGroupIds: execution.pendingRuleGroupIds ?? [],
      });
    }
    case "maintainerr_get_collections": {
      const collections = await client.getCollections();
      return jsonText({
        count: collections.length,
        collections: collections.map(c => ({
          id: c.id,
          title: c.title,
          description: c.description,
          type: c.type,
          libraryId: c.libraryId,
          isActive: c.isActive,
          mediaCount: c.mediaCount ?? c.media?.length ?? 0,
          totalSize: c.totalSizeBytes ? formatBytes(c.totalSizeBytes) : undefined,
          deleteAfterDays: c.deleteAfterDays,
          arrAction: MaintainerrClient.arrActionName(c.arrAction),
          tagInArr: c.tagInArr,
          listExclusions: c.listExclusions,
          manualCollection: c.manualCollection,
          handledMediaAmount: c.handledMediaAmount,
          handledMediaSize: c.handledMediaSizeBytes ? formatBytes(c.handledMediaSizeBytes) : undefined,
        })),
      });
    }
    case "maintainerr_get_collection_media": {
      const a = (args ?? {}) as { collectionId?: unknown; page?: unknown; size?: unknown };
      const collectionId = maintainerrInt(a.collectionId, "collectionId");
      const { page, size } = maintainerrPaging(a);
      const [res, collections] = await Promise.all([
        client.getCollectionMedia(collectionId, page, size),
        client.getCollections(),
      ]);
      const collection = collections.find(c => c.id === collectionId);
      const days = collection?.deleteAfterDays;
      return jsonText({
        collection: collection?.title,
        deleteAfterDays: days,
        total: res.totalSize,
        page,
        returned: res.items.length,
        hasMore: page * size < res.totalSize,
        items: res.items.map(i => {
          const added = i.addDate ? new Date(i.addDate) : undefined;
          const deletionDate = added && days ? new Date(added.getTime() + days * 86_400_000) : undefined;
          return {
            mediaId: i.mediaServerId,
            title: maintainerrTitle(i.mediaData),
            year: i.mediaData?.year,
            type: i.mediaData?.type,
            size: i.sizeBytes ? formatBytes(i.sizeBytes) : undefined,
            addedToCollection: i.addDate,
            deletionDate: deletionDate?.toISOString(),
            manual: i.isManual,
            ruleEvaluationFailed: i.ruleEvaluationFailed || undefined,
            tmdbId: i.tmdbId ?? undefined,
            tvdbId: i.tvdbId ?? undefined,
          };
        }),
      });
    }
    case "maintainerr_get_collection_logs": {
      const a = (args ?? {}) as { collectionId?: unknown; page?: unknown; size?: unknown; search?: unknown };
      const collectionId = maintainerrInt(a.collectionId, "collectionId");
      const { page, size } = maintainerrPaging(a);
      if (a.search !== undefined && (typeof a.search !== "string" || a.search.length > 200)) {
        return textError("search must be a string of at most 200 characters");
      }
      const res = await client.getCollectionLogs(collectionId, page, size, a.search || undefined);
      return jsonText({
        total: res.totalSize,
        page,
        returned: res.items.length,
        hasMore: page * size < res.totalSize,
        logs: res.items.map(l => ({
          timestamp: l.timestamp,
          message: l.message,
          event: l.meta?.type,
        })),
      });
    }
    case "maintainerr_get_rules": {
      const groups = await client.getRuleGroups();
      return jsonText({
        count: groups.length,
        ruleGroups: groups.map(g => ({
          id: g.id,
          name: g.name,
          description: g.description,
          libraryId: g.libraryId,
          dataType: g.dataType,
          isActive: g.isActive,
          collectionId: g.collectionId,
          useRules: g.useRules,
          ruleCount: g.rules?.length ?? 0,
          cronSchedule: g.ruleHandlerCronSchedule ?? undefined,
        })),
      });
    }
    case "maintainerr_get_exclusions": {
      const a = (args ?? {}) as { ruleGroupId?: unknown; mediaId?: unknown };
      const exclusions = await client.getExclusions({
        ruleGroupId: a.ruleGroupId === undefined ? undefined : maintainerrInt(a.ruleGroupId, "ruleGroupId"),
        mediaId: a.mediaId === undefined ? undefined : MaintainerrClient.checkMediaId(a.mediaId),
      });
      return jsonText({
        count: exclusions.length,
        exclusions: exclusions.map(e => ({
          id: e.id,
          mediaId: e.mediaServerId,
          ruleGroupId: e.ruleGroupId ?? null,
          scope: e.ruleGroupId ? 'rule group' : 'global',
          parent: e.parent ?? undefined,
          type: e.type ?? undefined,
        })),
      });
    }
    case "maintainerr_search_media": {
      const query = (args as { query?: unknown } | undefined)?.query;
      if (typeof query !== "string" || !query.trim() || query.length > 200) {
        return textError("query must be a non-empty string of at most 200 characters");
      }
      const results = await client.searchMedia(query);
      return jsonText({
        count: results.length,
        results: results.slice(0, 25).map(r => ({
          mediaId: r.id,
          title: maintainerrTitle(r),
          year: r.year,
          type: r.type,
          library: r.library?.title,
          maintainerrCollections: r.maintainerrCollections ?? [],
        })),
      });
    }
    case "maintainerr_get_media_status": {
      const { mediaId } = (args ?? {}) as { mediaId?: unknown };
      return jsonText(await client.getItemStatus(MaintainerrClient.checkMediaId(mediaId)));
    }
    case "maintainerr_run_rules": {
      const raw = (args as { ruleGroupId?: unknown } | undefined)?.ruleGroupId;
      const ruleGroupId = raw === undefined ? undefined : maintainerrInt(raw, "ruleGroupId");
      await client.executeRules(ruleGroupId);
      return jsonText({
        success: true,
        message: ruleGroupId === undefined
          ? 'All active rule groups queued. Check maintainerr_status for progress.'
          : `Rule group ${ruleGroupId} queued. Check maintainerr_status for progress.`,
      });
    }
    case "maintainerr_postpone_deletion": {
      const a = (args ?? {}) as { collectionId?: unknown; mediaId?: unknown; days?: unknown };
      const collectionId = maintainerrInt(a.collectionId, "collectionId");
      const mediaId = MaintainerrClient.checkMediaId(a.mediaId);
      const days = a.days === undefined ? undefined : maintainerrInt(a.days, "days", 3650);
      const result = await client.postponeMedia(collectionId, mediaId, days);
      return jsonText({ success: true, ...result });
    }
    case "maintainerr_exclude_media":
    case "maintainerr_remove_exclusion": {
      const a = (args ?? {}) as { mediaId?: unknown; collectionId?: unknown };
      const mediaId = MaintainerrClient.checkMediaId(a.mediaId);
      const collectionId = a.collectionId === undefined ? undefined : maintainerrInt(a.collectionId, "collectionId");
      const remove = name === "maintainerr_remove_exclusion";
      await client.setExclusion({ mediaId, collectionId, remove });
      const scope = collectionId === undefined ? 'all rule groups' : `the rule group of collection ${collectionId}`;
      return jsonText({
        success: true,
        message: remove
          ? `Exclusion of ${mediaId} from ${scope} removed`
          : `${mediaId} is now excluded from ${scope}`,
      });
    }
    case "maintainerr_remove_from_collection": {
      const a = (args ?? {}) as { collectionId?: unknown; mediaId?: unknown };
      const collectionId = maintainerrInt(a.collectionId, "collectionId");
      const mediaId = MaintainerrClient.checkMediaId(a.mediaId);
      await client.removeFromCollection(collectionId, mediaId);
      return jsonText({ success: true, message: `${mediaId} removed from collection ${collectionId}` });
    }
    case "maintainerr_handle_collections": {
      if ((args as { confirmed?: unknown } | undefined)?.confirmed !== true) {
        return textError("Explicit user approval is required before running the Maintainerr collection handler");
      }
      await client.handleCollections();
      return jsonText({
        success: true,
        message: 'Collection handler started. Items past their grace period get their collection action. See maintainerr_get_collection_logs for the result.',
      });
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// Maintainerr helpers
function maintainerrInt(value: unknown, name: string, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new Error(max === Number.MAX_SAFE_INTEGER ? `${name} must be a positive integer` : `${name} must be an integer from 1 to ${max}`);
  }
  return value;
}

function maintainerrPaging(a: { page?: unknown; size?: unknown }): { page: number; size: number } {
  return {
    page: a.page === undefined ? 1 : maintainerrInt(a.page, "page"),
    size: a.size === undefined ? 25 : maintainerrInt(a.size, "size", 100),
  };
}

function maintainerrTitle(m?: { title?: string; parentTitle?: string; grandparentTitle?: string; type?: string; index?: number; parentIndex?: number }): string | undefined {
  if (!m) return undefined;
  if (m.type === 'season' && m.parentTitle) return `${m.parentTitle} - ${m.title ?? `Season ${m.index}`}`;
  if (m.type === 'episode' && m.grandparentTitle) {
    const code = m.parentIndex !== undefined && m.index !== undefined
      ? ` S${String(m.parentIndex).padStart(2, '0')}E${String(m.index).padStart(2, '0')}`
      : '';
    return `${m.grandparentTitle}${code} - ${m.title ?? ''}`.trim();
  }
  return m.title;
}

// Helper function to format bytes
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export const maintainerr: IntegrationDefinition = {
  name: "maintainerr",
  displayName: "Maintainerr (Cleanup)",
  envPrefix: "MAINTAINERR",
  create(config) {
    const client = new MaintainerrClient(config);
    return {
      tools: TOOLS,
      getStatus: async () => ({ version: (await client.getAppStatus()).version }),
      callTool: (name, args) => callTool(client, name, args),
    };
  },
};
