/**
 * Plex Media Server: direct server control (library scans, metadata refresh,
 * playback sessions and their transcode decisions, background activities).
 * Tautulli (tautulli_* tools) covers watch history and statistics.
 *
 * Configured with PLEX_URL + PLEX_TOKEN (X-Plex-Token), or the web UI.
 */

import type { Tool, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { jsonText, type IntegrationDefinition } from "../integration.js";
import { PlexClient, type PlexMetadata } from "../plex-client.js";

const READ: ToolAnnotations = { readOnlyHint: true, openWorldHint: true };
// Queues server work (scan, refresh, cancel); repeating it just queues it again.
const TRIGGERS: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
// Removes library entries / stops a viewer's stream.
const DESTRUCTIVE: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };

const sectionIdProp = {
  sectionId: { type: "integer", minimum: 1, description: "Library section id from plex_get_libraries" },
};
const ratingKeyProp = {
  ratingKey: { type: "string", description: "Plex item id (ratingKey), e.g. from plex_search or plex_get_recently_added" },
};
const noArgs = { type: "object" as const, properties: {}, required: [] };

const TOOLS: Tool[] = [
  {
    name: "plex_status",
    annotations: READ,
    description: "Get Plex Media Server name, version, platform, Plex Pass state, transcoder capabilities and how many streams are playing / transcoding now",
    inputSchema: noArgs,
  },
  {
    name: "plex_get_libraries",
    annotations: READ,
    description: "Get Plex libraries (sections): id, type, item count, folders, agent/scanner, when last scanned and whether a scan is running now",
    inputSchema: noArgs,
  },
  {
    name: "plex_get_sessions",
    annotations: READ,
    description: "Get what is playing on Plex right now: user, title, player device/app, progress, bandwidth and the playback decision (direct play, direct stream or transcode) with video/audio codecs from -> to and inferred reasons for the transcode. Use the sessionId with plex_terminate_session",
    inputSchema: noArgs,
  },
  {
    name: "plex_get_transcode_sessions",
    annotations: READ,
    description: "Get the Plex transcoder sessions: source and target codecs, container, progress, speed, throttling and hardware decoding/encoding",
    inputSchema: noArgs,
  },
  {
    name: "plex_search",
    annotations: READ,
    description: "Search Plex by title across all libraries. Returns items grouped by type with their ratingKey",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Title (or part of it) to search for" },
        limit: { type: "integer", minimum: 1, maximum: 50, description: "Results per type (default: 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "plex_get_recently_added",
    annotations: READ,
    description: "Get items recently added to Plex, for all libraries or one",
    inputSchema: {
      type: "object" as const,
      properties: {
        sectionId: { type: "integer", minimum: 1, description: "Only this library section" },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "Number of items (default: 20)" },
      },
      required: [],
    },
  },
  {
    name: "plex_get_item",
    annotations: READ,
    description: "Get one Plex item by ratingKey: metadata, files, and per file the video/audio/subtitle streams with codecs, resolution, HDR/Dolby Vision, channels and languages. For shows, seasons and albums also lists the children",
    inputSchema: { type: "object" as const, properties: { ...ratingKeyProp }, required: ["ratingKey"] },
  },
  {
    name: "plex_get_activities",
    annotations: READ,
    description: "Get background work running on the Plex server (library scans, metadata refreshes, media analysis, ...) with progress and whether it can be cancelled",
    inputSchema: noArgs,
  },
  {
    name: "plex_get_butler_tasks",
    annotations: READ,
    description: "Get the Plex scheduled maintenance (Butler) tasks and whether each is enabled",
    inputSchema: noArgs,
  },
  {
    name: "plex_scan_library",
    annotations: TRIGGERS,
    description: "Scan a Plex library for new, changed or removed files. Optionally only one folder inside the library (much faster), e.g. right after a download was imported",
    inputSchema: {
      type: "object" as const,
      properties: {
        ...sectionIdProp,
        path: { type: "string", description: "Folder inside one of the library's folders to scan (as Plex sees it, see plex_get_libraries)" },
        force: { type: "boolean", description: "Re-read every file, even unchanged ones (slow; default: false)" },
      },
      required: ["sectionId"],
    },
  },
  {
    name: "plex_refresh_metadata",
    annotations: TRIGGERS,
    description: "Refresh the metadata (posters, descriptions, ...) of one Plex item from its agents and local files",
    inputSchema: {
      type: "object" as const,
      properties: {
        ...ratingKeyProp,
        force: { type: "boolean", description: "Replace existing metadata, not only fill in missing fields (default: false)" },
      },
      required: ["ratingKey"],
    },
  },
  {
    name: "plex_cancel_activity",
    annotations: TRIGGERS,
    description: "Cancel a running Plex background activity (e.g. a scan) by its uuid from plex_get_activities",
    inputSchema: {
      type: "object" as const,
      properties: { uuid: { type: "string", description: "Activity uuid from plex_get_activities" } },
      required: ["uuid"],
    },
  },
  {
    name: "plex_empty_trash",
    annotations: DESTRUCTIVE,
    description: "Empty the trash of a Plex library: permanently removes the entries (and their watch state) of items whose files are gone. Files on disk are not touched",
    inputSchema: { type: "object" as const, properties: { ...sectionIdProp }, required: ["sectionId"] },
  },
  {
    name: "plex_terminate_session",
    annotations: DESTRUCTIVE,
    description: "Stop a Plex stream. The viewer sees the reason on their screen. Needs Plex Pass. Get the sessionId from plex_get_sessions",
    inputSchema: {
      type: "object" as const,
      properties: {
        sessionId: { type: "string", description: "sessionId from plex_get_sessions" },
        reason: { type: "string", description: "Message shown to the viewer (max 200 characters)" },
      },
      required: ["sessionId"],
    },
  },
];

function itemSummary(m: PlexMetadata) {
  return {
    ratingKey: m.ratingKey,
    title: PlexClient.title(m),
    type: m.type,
    year: m.year,
    library: m.librarySectionTitle,
    addedAt: PlexClient.plexDate(m.addedAt),
  };
}

export const plex: IntegrationDefinition = {
  name: "plex",
  displayName: "Plex (Media Server)",
  envPrefix: "PLEX",
  exampleUrl: "http://localhost:32400",
  fields: [
    { key: "token", label: "Plex token", envSuffix: "TOKEN", secret: true, required: true, placeholder: "X-Plex-Token" },
  ],
  // A rounded dark tile with the Plex chevron, hatched.
  icon: '<rect x="-62" y="-62" width="124" height="124" rx="24" class="ink f-ink"/>'
    + '<rect x="-54" y="-54" width="108" height="108" rx="18" class="thin"/>'
    + '<path class="ink f-gold" d="M-30 -46 H2 L36 0 L2 46 H-30 L4 0 Z"/>'
    + '<path fill="url(#hatch)" d="M-30 -46 H2 L36 0 L2 46 H-30 L4 0 Z"/>',
  writeTools: ["plex_scan_library", "plex_refresh_metadata", "plex_cancel_activity"],
  confirmTools: ["plex_empty_trash", "plex_terminate_session"],

  create({ url, values }) {
    const client = new PlexClient({ url, token: values.token ?? "" });

    return {
      tools: TOOLS.map(t => ({ ...t, inputSchema: { ...t.inputSchema }, annotations: { ...t.annotations } })),

      async getStatus() {
        return { version: (await client.getIdentity()).version };
      },

      async callTool(name, args) {
        switch (name) {
          case "plex_status": {
            const [id, sessions] = await Promise.all([
              client.getIdentity(),
              client.getSessions().catch(() => undefined),
            ]);
            return jsonText({
              name: id.friendlyName,
              version: id.version,
              platform: id.platform,
              platformVersion: id.platformVersion,
              machineIdentifier: id.machineIdentifier,
              signedInToPlex: id.myPlex,
              plexAccount: id.myPlexUsername,
              plexPass: id.myPlexSubscription,
              transcoder: {
                video: id.transcoderVideo,
                audio: id.transcoderAudio,
                activeVideoTranscodes: id.transcoderActiveVideoSessions,
              },
              activeSessions: sessions?.length,
            });
          }

          case "plex_get_libraries": {
            const sections = await client.getSections();
            const counts = await Promise.all(sections.map(s => client.getSectionItemCount(s.key).catch(() => undefined)));
            return jsonText({
              count: sections.length,
              libraries: sections.map((s, i) => ({
                sectionId: Number(s.key),
                title: s.title,
                type: s.type,
                itemCount: counts[i],
                folders: (s.Location ?? []).map(l => l.path),
                agent: s.agent,
                scanner: s.scanner,
                language: s.language,
                scanningNow: Boolean(s.refreshing),
                lastScanned: PlexClient.plexDate(s.scannedAt),
                contentChanged: PlexClient.plexDate(s.contentChangedAt),
              })),
            });
          }

          case "plex_get_sessions": {
            const sessions = await client.getSessions();
            return jsonText({
              count: sessions.length,
              transcoding: sessions.filter(s => PlexClient.sessionSummary(s).decision === "transcode").length,
              note: sessions.some(s => s.TranscodeSession)
                ? "inferredReasons are worked out from the source and target codecs; Plex does not report its exact reason here"
                : undefined,
              sessions: sessions.map(s => {
                const { reasons, ...summary } = PlexClient.sessionSummary(s);
                return { ...summary, inferredReasons: reasons };
              }),
            });
          }

          case "plex_get_transcode_sessions": {
            const sessions = await client.getTranscodeSessions();
            return jsonText({
              count: sessions.length,
              sessions: sessions.map(t => ({
                video: { decision: t.videoDecision, from: t.sourceVideoCodec, to: t.videoCodec, size: t.height ? `${t.width}x${t.height}` : undefined },
                audio: { decision: t.audioDecision, from: t.sourceAudioCodec, to: t.audioCodec, channels: t.audioChannels },
                subtitles: t.subtitleDecision,
                container: { from: t.sourceContainer, to: t.container },
                protocol: t.protocol,
                progress: t.progress,
                speed: t.speed,
                throttled: t.throttled,
                complete: t.complete,
                hardware: {
                  requested: t.transcodeHwRequested,
                  decoding: t.transcodeHwDecoding,
                  encoding: t.transcodeHwEncoding,
                  fullPipeline: t.transcodeHwFullPipeline,
                },
              })),
            });
          }

          case "plex_search": {
            const { query, limit } = args as { query: string; limit?: number };
            const hubs = await client.search(query, limit ?? 10);
            const groups = hubs
              .map(h => ({ type: h.type, title: h.title, items: [...(h.Metadata ?? []), ...(h.Directory ?? [])] }))
              .filter(h => h.items.length > 0);
            return jsonText({
              count: groups.reduce((n, g) => n + g.items.length, 0),
              results: groups.map(g => ({ type: g.type, title: g.title, items: g.items.map(itemSummary) })),
            });
          }

          case "plex_get_recently_added": {
            const { sectionId, limit } = args as { sectionId?: number; limit?: number };
            const items = await client.getRecentlyAdded({ sectionId, limit });
            return jsonText({ count: items.length, items: items.map(itemSummary) });
          }

          case "plex_get_item": {
            const { ratingKey } = args as { ratingKey: string };
            const item = await client.getItem(ratingKey);
            if (!item) throw new Error(`Plex item ${ratingKey} not found`);
            const parent = ["show", "season", "artist", "album"].includes(item.type ?? "");
            const children = parent ? await client.getChildren(ratingKey) : [];
            return jsonText({
              ...itemSummary(item),
              summary: item.summary,
              originallyAvailableAt: item.originallyAvailableAt,
              contentRating: item.contentRating,
              rating: item.rating,
              audienceRating: item.audienceRating,
              studio: item.studio,
              durationMinutes: item.duration ? Math.round(item.duration / 60_000) : undefined,
              genres: item.Genre?.map(g => g.tag),
              externalIds: item.Guid?.map(g => g.id),
              episodes: item.leafCount,
              media: (item.Media ?? []).map(PlexClient.mediaSummary),
              children: parent
                ? children.map(c => ({ ratingKey: c.ratingKey, title: c.title, index: c.index, type: c.type, items: c.leafCount }))
                : undefined,
            });
          }

          case "plex_get_activities": {
            const activities = await client.getActivities();
            return jsonText({
              count: activities.length,
              activities: activities.map(a => ({
                uuid: a.uuid,
                type: a.type,
                title: a.title,
                subtitle: a.subtitle,
                progress: a.progress,
                cancellable: a.cancellable,
                sectionId: a.Context?.librarySectionID,
              })),
            });
          }

          case "plex_get_butler_tasks": {
            const tasks = await client.getButlerTasks();
            return jsonText({
              count: tasks.length,
              tasks: tasks.map(t => ({ name: t.name, title: t.title, description: t.description, enabled: t.enabled, intervalDays: t.interval })),
            });
          }

          case "plex_scan_library": {
            const a = args as { sectionId: number; path?: string; force?: boolean };
            await client.scanSection(a.sectionId, { path: a.path || undefined, force: a.force });
            return jsonText({
              success: true,
              message: `Scan of library ${a.sectionId}${a.path ? ` (${a.path})` : ""} started. Check plex_get_activities for progress.`,
            });
          }

          case "plex_refresh_metadata": {
            const a = args as { ratingKey: string; force?: boolean };
            await client.refreshItem(a.ratingKey, a.force);
            return jsonText({ success: true, message: `Metadata refresh of ${a.ratingKey} started` });
          }

          case "plex_cancel_activity": {
            const { uuid } = args as { uuid: string };
            PlexClient.checkActivityId(uuid);
            const activity = (await client.getActivities()).find(a => a.uuid === uuid);
            if (!activity) throw new Error(`No running Plex activity with uuid ${uuid}`);
            if (activity.cancellable === false) throw new Error(`Plex activity "${activity.title ?? uuid}" cannot be cancelled`);
            await client.cancelActivity(uuid);
            return jsonText({ success: true, message: `Cancelled "${activity.title ?? uuid}"` });
          }

          case "plex_empty_trash": {
            const { sectionId } = args as { sectionId: number };
            await client.emptyTrash(sectionId);
            return jsonText({ success: true, message: `Trash of library ${sectionId} is being emptied` });
          }

          case "plex_terminate_session": {
            const { sessionId, reason } = args as { sessionId: string; reason?: string };
            PlexClient.checkSessionId(sessionId);
            const session = (await client.getSessions()).find(s => s.Session?.id === sessionId);
            if (!session) throw new Error(`No active Plex session with sessionId ${sessionId}`);
            await client.terminateSession(sessionId, reason);
            return jsonText({
              success: true,
              stopped: { user: session.User?.title, title: PlexClient.title(session), player: session.Player?.title ?? session.Player?.product },
            });
          }

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      },
    };
  },
};
