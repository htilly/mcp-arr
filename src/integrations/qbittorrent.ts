/**
 * qBittorrent (torrent download client): queue, transfer speed, pause/resume,
 * speed limits, recheck/reannounce and removal of stuck torrents.
 *
 * Enabled by QBITTORRENT_URL alone (qBittorrent can bypass auth for whitelisted
 * subnets); add QBITTORRENT_USERNAME + QBITTORRENT_PASSWORD for a WebUI login,
 * or QBITTORRENT_API_KEY on qBittorrent 5.2+.
 */

import { fetchFor, TLS_FINGERPRINT_FIELD } from "../tls-trust.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { jsonText, type IntegrationDefinition } from "../integration.js";
import {
  QBittorrentClient,
  QBITTORRENT_FILTERS,
  QBT_ETA_INFINITY,
  type QBittorrentFilter,
  type QBittorrentTorrent,
} from "../qbittorrent-client.js";
import { formatBytes, formatDuration, formatSpeed, unixToIso } from "../format.js";

const SORT_FIELDS = ["added_on", "name", "progress", "dlspeed", "upspeed", "eta", "size", "ratio", "state", "last_activity", "category"];
const STALLED_STATES = new Set(["stalledDL", "metaDL", "forcedMetaDL"]);

const hashesProp = {
  hashes: {
    type: "array",
    items: { type: "string" },
    description: "Torrent hashes from qbittorrent_get_torrents",
  },
};

const TOOLS: Tool[] = [
  {
    name: "qbittorrent_status",
    description: "Get qBittorrent version, connection status (connected/firewalled/disconnected), current download/upload speed, global and alternative speed limits, DHT nodes and free disk space",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "qbittorrent_get_torrents",
    description:
      "List qBittorrent torrents with state, progress, size, speed, ETA, ratio, seeds/peers and category. " +
      "Each torrent has a `stalled` flag (stalledDL or still fetching metadata) and a `stuck` reason when it looks stuck: " +
      "error, missing files, no metadata or no data for longer than stuckMinutes, or 0 B/s while running. " +
      "Use stuckOnly: true to find downloads that need attention, or filter: 'stalled_downloading' / 'errored'",
    inputSchema: {
      type: "object",
      properties: {
        filter: { type: "string", enum: QBITTORRENT_FILTERS, description: "State filter (default: all). 'stopped' and 'running' on qBittorrent 5, 'paused' and 'resumed' before" },
        category: { type: "string", description: "Only this category (empty string = no category)" },
        tag: { type: "string", description: "Only torrents with this tag" },
        stuckOnly: { type: "boolean", description: "Only torrents that look stuck (see description)" },
        stuckMinutes: { type: "integer", minimum: 5, maximum: 10080, description: "How long without data/metadata counts as stuck (default: 60)" },
        sort: { type: "string", enum: SORT_FIELDS, description: "Sort field (default: added_on)" },
        reverse: { type: "boolean", description: "Reverse the sort order" },
        limit: { type: "integer", minimum: 1, maximum: 200, description: "Max torrents to return (default: 50)" },
        offset: { type: "integer", minimum: 0, description: "Skip this many torrents (paging)" },
      },
      required: [],
    },
  },
  {
    name: "qbittorrent_pause",
    description: "Pause (stop) qBittorrent torrents by hash, or all torrents with all: true. Works on qBittorrent 4 (pause) and 5 (stop)",
    inputSchema: {
      type: "object",
      properties: { ...hashesProp, all: { type: "boolean", description: "Pause every torrent" } },
      required: [],
    },
    annotations: { idempotentHint: true },
  },
  {
    name: "qbittorrent_resume",
    description: "Resume (start) qBittorrent torrents by hash, or all torrents with all: true",
    inputSchema: {
      type: "object",
      properties: { ...hashesProp, all: { type: "boolean", description: "Resume every torrent" } },
      required: [],
    },
    annotations: { idempotentHint: true },
  },
  {
    name: "qbittorrent_set_speed_limits",
    description: "Set qBittorrent global download/upload limits in KiB/s (0 = unlimited) and/or switch the alternative (\"turtle\") speed limits on or off",
    inputSchema: {
      type: "object",
      properties: {
        downloadKiBps: { type: "integer", minimum: 0, maximum: 10_000_000, description: "Global download limit in KiB/s, 0 = unlimited" },
        uploadKiBps: { type: "integer", minimum: 0, maximum: 10_000_000, description: "Global upload limit in KiB/s, 0 = unlimited" },
        altSpeedLimits: { type: "boolean", description: "true = use the alternative speed limits, false = normal limits" },
      },
      required: [],
    },
    annotations: { idempotentHint: true },
  },
  {
    name: "qbittorrent_recheck",
    description: "Force qBittorrent to recheck the data of torrents (e.g. after missing files or errors)",
    inputSchema: { type: "object", properties: { ...hashesProp }, required: ["hashes"] },
  },
  {
    name: "qbittorrent_reannounce",
    description: "Reannounce torrents to their trackers now - can revive stalled downloads that have no peers",
    inputSchema: { type: "object", properties: { ...hashesProp }, required: ["hashes"] },
  },
  {
    name: "qbittorrent_delete_torrents",
    description:
      "Remove torrents from qBittorrent by hash, e.g. stuck or stalled ones found with qbittorrent_get_torrents (stuckOnly: true). " +
      "deleteFiles: true also deletes the downloaded data. Sonarr/Radarr will not search again by themselves; use their queue tools to blocklist and re-search instead",
    inputSchema: {
      type: "object",
      properties: {
        ...hashesProp,
        deleteFiles: { type: "boolean", description: "Also delete downloaded files (default: false)" },
      },
      required: ["hashes"],
    },
  },
];

function hashesArg(args: Record<string, unknown>): string[] | "all" {
  if (args.all === true) {
    if (Array.isArray(args.hashes) && args.hashes.length) throw new Error("Use either hashes or all: true, not both");
    return "all";
  }
  if (!Array.isArray(args.hashes) || args.hashes.length === 0) throw new Error("Give hashes, or all: true");
  return args.hashes as string[];
}

function torrentView(t: QBittorrentTorrent, nowSeconds: number, stuckMinutes: number) {
  const stuck = QBittorrentClient.stuckReason(t, nowSeconds, stuckMinutes);
  return {
    hash: t.hash,
    name: t.name,
    state: t.state,
    progress: `${Math.floor((t.progress ?? 0) * 1000) / 10}%`,
    size: formatBytes(t.size ?? 0),
    remaining: t.amount_left !== undefined ? formatBytes(t.amount_left) : undefined,
    downloadSpeed: formatSpeed(t.dlspeed ?? 0),
    uploadSpeed: formatSpeed(t.upspeed ?? 0),
    eta: t.eta === undefined || t.eta >= QBT_ETA_INFINITY ? null : formatDuration(t.eta),
    ratio: Math.round((t.ratio ?? 0) * 100) / 100,
    category: t.category || undefined,
    tags: t.tags || undefined,
    seeds: t.num_seeds,
    peers: t.num_leechs,
    availability: t.availability !== undefined && t.availability >= 0 ? Math.round(t.availability * 100) / 100 : undefined,
    addedOn: unixToIso(t.added_on),
    lastActivity: unixToIso(t.last_activity),
    stalled: STALLED_STATES.has(t.state),
    stuck: stuck ?? null,
  };
}

export const qbittorrent: IntegrationDefinition = {
  name: "qbittorrent",
  displayName: "qBittorrent (Torrents)",
  envPrefix: "QBITTORRENT",
  exampleUrl: "http://localhost:8080",
  fields: [
    { key: "username", label: "Username", envSuffix: "USERNAME", secret: false, required: false, placeholder: "WebUI username (empty if auth is bypassed)" },
    { key: "password", label: "Password", envSuffix: "PASSWORD", secret: true, required: false, placeholder: "WebUI password" },
    { key: "apiKey", label: "API key (qBittorrent 5.2+)", envSuffix: "API_KEY", secret: true, required: false, placeholder: "Optional, instead of username/password" },
    TLS_FINGERPRINT_FIELD,
  ],
  // A magnet: horseshoe body with a lightning bolt through it.
  icon:
    '<path class="ink f-clay" d="M-58 -60 V4 A58 58 0 0 0 58 4 V-60 H24 V4 A24 24 0 0 1 -24 4 V-60 Z"/>' +
    '<path fill="url(#hatch)" d="M-58 -60 V4 A58 58 0 0 0 58 4 V-60 H24 V4 A24 24 0 0 1 -24 4 V-60 Z"/>' +
    '<rect x="-58" y="-74" width="34" height="22" rx="4" class="ink f-paper"/><rect x="24" y="-74" width="34" height="22" rx="4" class="ink f-paper"/>' +
    '<path class="ink f-gold" d="M8 -34 L-14 6 H2 L-8 44 L18 -2 H2 Z"/>',
  writeTools: ["qbittorrent_pause", "qbittorrent_resume", "qbittorrent_set_speed_limits", "qbittorrent_recheck", "qbittorrent_reannounce"],
  confirmTools: ["qbittorrent_delete_torrents"],

  create({ url, values }) {
    const client = new QBittorrentClient({ url, username: values.username, password: values.password, apiKey: values.apiKey, fetch: fetchFor(values.tlsFingerprint) });
    return {
      tools: TOOLS.map(t => ({ ...t, inputSchema: { ...t.inputSchema } })),
      async getStatus() {
        return { version: await client.getVersion() };
      },
      async callTool(name, args) {
        switch (name) {
          case "qbittorrent_status": {
            const [version, webApiVersion, info, alt, server] = await Promise.all([
              client.getVersion(),
              client.getWebApiVersion(),
              client.getTransferInfo(),
              client.getAltSpeedLimitsEnabled(),
              client.getServerState().catch(() => ({} as { free_space_on_disk?: number })),
            ]);
            return jsonText({
              version,
              webApiVersion,
              auth: client.authMode,
              connectionStatus: info.connection_status,
              downloadSpeed: formatSpeed(info.dl_info_speed),
              uploadSpeed: formatSpeed(info.up_info_speed),
              downloadedThisSession: formatBytes(info.dl_info_data),
              uploadedThisSession: formatBytes(info.up_info_data),
              downloadLimit: info.dl_rate_limit ? formatSpeed(info.dl_rate_limit) : "unlimited",
              uploadLimit: info.up_rate_limit ? formatSpeed(info.up_rate_limit) : "unlimited",
              alternativeSpeedLimits: alt,
              dhtNodes: info.dht_nodes,
              freeDiskSpace: server.free_space_on_disk !== undefined ? formatBytes(server.free_space_on_disk) : undefined,
            });
          }
          case "qbittorrent_get_torrents": {
            const a = args as {
              filter?: QBittorrentFilter; category?: string; tag?: string; stuckOnly?: boolean; stuckMinutes?: number;
              sort?: string; reverse?: boolean; limit?: number; offset?: number;
            };
            const limit = a.limit ?? 50;
            const offset = a.offset ?? 0;
            const stuckMinutes = a.stuckMinutes ?? 60;
            const now = Date.now() / 1000;
            // Stuck filtering happens here, so page locally in that case.
            const list = await client.getTorrents({
              filter: a.filter,
              category: a.category,
              tag: a.tag,
              sort: a.sort ?? "added_on",
              reverse: a.reverse,
              limit: a.stuckOnly ? undefined : limit,
              offset: a.stuckOnly ? undefined : offset,
            });
            let views = list.map(t => torrentView(t, now, stuckMinutes));
            let total: number | undefined;
            if (a.stuckOnly) {
              views = views.filter(v => v.stuck);
              total = views.length;
              views = views.slice(offset, offset + limit);
            }
            return jsonText({
              returned: views.length,
              total,
              offset,
              stuckCount: views.filter(v => v.stuck).length,
              torrents: views,
            });
          }
          case "qbittorrent_pause":
          case "qbittorrent_resume": {
            const target = hashesArg(args);
            if (name === "qbittorrent_pause") await client.pause(target);
            else await client.resume(target);
            const what = target === "all" ? "All torrents" : `${target.length} torrent(s)`;
            return jsonText({ success: true, message: `${what} ${name === "qbittorrent_pause" ? "paused" : "resumed"}` });
          }
          case "qbittorrent_set_speed_limits": {
            const a = args as { downloadKiBps?: number; uploadKiBps?: number; altSpeedLimits?: boolean };
            if (a.downloadKiBps === undefined && a.uploadKiBps === undefined && a.altSpeedLimits === undefined) {
              throw new Error("Give downloadKiBps, uploadKiBps and/or altSpeedLimits");
            }
            if (a.downloadKiBps !== undefined) await client.setGlobalDownloadLimit(a.downloadKiBps * 1024);
            if (a.uploadKiBps !== undefined) await client.setGlobalUploadLimit(a.uploadKiBps * 1024);
            if (a.altSpeedLimits !== undefined) await client.setAltSpeedLimitsEnabled(a.altSpeedLimits);
            const info = await client.getTransferInfo();
            return jsonText({
              success: true,
              downloadLimit: info.dl_rate_limit ? formatSpeed(info.dl_rate_limit) : "unlimited",
              uploadLimit: info.up_rate_limit ? formatSpeed(info.up_rate_limit) : "unlimited",
              alternativeSpeedLimits: await client.getAltSpeedLimitsEnabled(),
            });
          }
          case "qbittorrent_recheck":
          case "qbittorrent_reannounce": {
            const hashes = args.hashes as string[];
            if (name === "qbittorrent_recheck") await client.recheck(hashes);
            else await client.reannounce(hashes);
            return jsonText({ success: true, message: `${name === "qbittorrent_recheck" ? "Recheck" : "Reannounce"} started for ${hashes.length} torrent(s)` });
          }
          case "qbittorrent_delete_torrents": {
            const hashes = args.hashes as string[];
            const deleteFiles = args.deleteFiles === true;
            await client.deleteTorrents(hashes, deleteFiles);
            return jsonText({
              success: true,
              message: `${hashes.length} torrent(s) removed${deleteFiles ? " and their files deleted" : " (files kept)"}`,
            });
          }
        }
        throw new Error(`Unknown tool: ${name}`);
      },
    };
  },
};
