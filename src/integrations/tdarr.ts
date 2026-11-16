/**
 * Tdarr (transcoding) integration. Tdarr keeps ffprobe data for every file in
 * its libraries and runs files through each library's flow or plugin stack.
 * Typical use: find AV1 video / DTS audio that a TV cannot direct-play (so Plex
 * transcodes on the fly) and send those files back through Tdarr.
 */

import { fetchFor, TLS_FINGERPRINT_FIELD } from "../tls-trust.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { jsonText, type IntegrationDefinition } from "../integration.js";
import {
  TdarrClient,
  TDARR_REQUEUE_MAX,
  TDARR_TABLES,
  summarizeFile,
  type TdarrFileFilter,
  type TdarrNode,
  type TdarrPieSlice,
  type TdarrPieStats,
  type TdarrTable,
} from "../tdarr-client.js";

const SEARCH_LIMIT_MAX = 200;

const TABLE_NAMES: Record<string, TdarrTable> = {
  transcode_queue: TDARR_TABLES.transcodeQueue,
  transcode_success: TDARR_TABLES.transcodeSuccess,
  transcode_error: TDARR_TABLES.transcodeError,
  health_check_queue: TDARR_TABLES.healthQueue,
  health_check_success: TDARR_TABLES.healthSuccess,
  health_check_error: TDARR_TABLES.healthError,
};

const codecList = (what: string, example: string) => ({
  type: "array",
  items: { type: "string" },
  description: `${what} codec names as ffprobe reports them (lower case), e.g. ${example}. A file matches if it has any of them`,
});

const FILTER_PROPS = {
  videoCodecs: codecList("Video", '["av1"] or ["av1", "hevc"]'),
  audioCodecs: codecList("Audio", '["dts"] or ["dts", "truehd"]. Every audio track counts, so a DTS second track matches too'),
  match: {
    type: "string",
    enum: ["any", "all"],
    description: 'With both videoCodecs and audioCodecs: "any" (default) = video OR audio matches, "all" = both',
  },
  containers: { type: "array", items: { type: "string" }, description: 'Containers, e.g. ["mkv"]' },
  libraryId: { type: "string", description: "Only this library (id from tdarr_get_libraries)" },
  path: { type: "string", description: "Only files whose path contains this text, e.g. a folder or title" },
  transcodeStatus: {
    type: "string",
    description: 'Tdarr transcode status, e.g. "Not required", "Transcode success", "Transcode error", "Queued"',
  },
  healthCheckStatus: { type: "string", description: 'Tdarr health check status, e.g. "Success", "Error", "Queued"' },
  minSizeGB: { type: "number", minimum: 0, description: "Only files at least this large (GB)" },
  maxSizeGB: { type: "number", minimum: 0, description: "Only files at most this large (GB)" },
};

const TOOLS: Tool[] = [
  {
    name: "tdarr_status",
    description: "Get Tdarr server version and uptime, nodes online/paused, active workers and the transcode and health check queue sizes",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "tdarr_get_libraries",
    description: "Get Tdarr libraries: folder, whether processing is on, the flow or plugin stack it uses, file count, transcode/health check status counts and video/audio codecs in it",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "tdarr_get_nodes",
    description: "Get Tdarr worker nodes (paused or not) and their running jobs: file, job type, progress %, fps and ETA",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "tdarr_search_files",
    description:
      "Search the Tdarr file database by codec, container, library, path, status or size. Use it to find files a TV cannot direct-play " +
      '(so Plex transcodes them), e.g. AV1 video or DTS/TrueHD audio: videoCodecs ["av1"], audioCodecs ["dts"]. ' +
      "Returns path, size, container, video codec, resolution, all audio codecs and Tdarr status per file, plus how many matched. " +
      "Send the results back through Tdarr with tdarr_requeue_files",
    inputSchema: {
      type: "object",
      properties: {
        ...FILTER_PROPS,
        limit: { type: "integer", minimum: 1, maximum: SEARCH_LIMIT_MAX, description: `Files to return (default 50, max ${SEARCH_LIMIT_MAX}); matched always gives the full count` },
      },
      required: [],
    },
  },
  {
    name: "tdarr_get_file",
    description: "Get one file from the Tdarr database with all its streams (codec, channels, language) and Tdarr status",
    inputSchema: {
      type: "object",
      properties: { fileId: { type: "string", description: "File id = full path as Tdarr sees it (from tdarr_search_files)" } },
      required: ["fileId"],
    },
  },
  {
    name: "tdarr_requeue_files",
    description:
      "Put files back in the Tdarr transcode queue so their library's flow / plugin stack processes them again, e.g. the AV1 or DTS files " +
      "found with tdarr_search_files so they become something the TV can direct-play. The target format (e.g. H.264 video / AAC audio) " +
      "comes from the library's configured flow or plugins, not from this tool, so check the library with tdarr_get_libraries first. " +
      `Give fileIds, or the same filter as tdarr_search_files. At most ${TDARR_REQUEUE_MAX} files per call (max); the result says how many matched ` +
      "and how many were left out. The flow usually replaces the original files. healthCheck: true queues a health check instead",
    inputSchema: {
      type: "object",
      properties: {
        fileIds: { type: "array", items: { type: "string" }, description: "File ids (full paths) from tdarr_search_files" },
        ...FILTER_PROPS,
        max: { type: "integer", minimum: 1, maximum: TDARR_REQUEUE_MAX, description: `Most files to queue in this call (default and max ${TDARR_REQUEUE_MAX})` },
        healthCheck: { type: "boolean", description: "Queue a health check instead of a transcode (default false)" },
      },
      required: [],
    },
  },
  {
    name: "tdarr_get_queue",
    description: "Get one of Tdarr's file tables: the transcode or health check queue, or the files that succeeded or failed",
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string", enum: Object.keys(TABLE_NAMES), description: "Which table (default transcode_queue)" },
        libraryId: { type: "string", description: "Only this library" },
        start: { type: "integer", minimum: 0, description: "Offset (default 0)" },
        pageSize: { type: "integer", minimum: 1, maximum: 100, description: "Rows (default 25, max 100)" },
      },
      required: [],
    },
  },
  {
    name: "tdarr_get_staged",
    description: "Get files in Tdarr's staging section: transcoded output waiting for the user to accept or reject it",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "tdarr_get_stats",
    description: "Get Tdarr statistics: space saved, transcodes and health checks done, and file counts per video codec, audio codec, container, resolution and status. Without libraryId for all libraries",
    inputSchema: {
      type: "object",
      properties: { libraryId: { type: "string", description: "Only this library" } },
      required: [],
    },
  },
  {
    name: "tdarr_set_node_paused",
    description: "Pause or resume a Tdarr node. A paused node starts no new jobs; running jobs finish",
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string", description: "Node id from tdarr_get_nodes" },
        paused: { type: "boolean", description: "true = pause, false = resume" },
      },
      required: ["nodeId", "paused"],
    },
  },
];

function filterFrom(args: Record<string, unknown>): TdarrFileFilter {
  const f: Record<string, unknown> = {};
  for (const key of Object.keys(FILTER_PROPS)) {
    if (args[key] !== undefined) f[key] = args[key];
  }
  return f as TdarrFileFilter;
}

function slices(list?: TdarrPieSlice[]): Record<string, number> | undefined {
  if (!Array.isArray(list) || !list.length) return undefined;
  return Object.fromEntries([...list].sort((a, b) => b.value - a.value).map(s => [s.name, s.value]));
}

function pieSummary(p: TdarrPieStats) {
  return {
    totalFiles: p.totalFiles,
    transcodesDone: p.totalTranscodeCount,
    healthChecksDone: p.totalHealthCheckCount,
    spaceSavedGB: typeof p.sizeDiff === "number" ? Math.round(p.sizeDiff * 100) / 100 : undefined,
    transcodeStatus: slices(p.status?.transcode),
    healthCheckStatus: slices(p.status?.healthcheck),
    videoCodecs: slices(p.video?.codecs),
    videoContainers: slices(p.video?.containers),
    videoResolutions: slices(p.video?.resolutions),
    audioCodecs: slices(p.audio?.codecs),
  };
}

function workersOf(node: TdarrNode) {
  return Object.values(node.workers ?? {}).map(w => ({
    id: w._id,
    type: w.workerType,
    job: w.job?.type,
    status: w.status,
    file: w.file,
    progressPercent: typeof w.percentage === "number" ? Math.round(w.percentage * 10) / 10 : undefined,
    fps: w.fps,
    eta: w.ETA,
    flowStep: w.lastPluginDetails?.number,
  }));
}

function nodeList(nodes: Record<string, TdarrNode>) {
  return Object.entries(nodes).map(([id, n]) => ({
    id: n._id ?? id,
    name: n.nodeName,
    paused: n.nodePaused ?? false,
    workerLimits: n.workerLimits,
    workers: workersOf(n),
  }));
}

export const tdarr: IntegrationDefinition = {
  name: "tdarr",
  displayName: "Tdarr (Transcoding)",
  envPrefix: "TDARR",
  exampleUrl: "http://localhost:8265",
  fields: [
    { key: "apiKey", label: "API key", envSuffix: "API_KEY", secret: true, required: false, placeholder: "Only if authentication is on in Tdarr" },
    TLS_FINGERPRINT_FIELD,
  ],
  // Film frame turning into a second frame: transcoding.
  icon:
    '<rect x="-74" y="-62" width="100" height="78" rx="8" class="ink f-paper"/>' +
    '<path class="thin" d="M-62 -50 H-54 M-44 -50 H-36 M-26 -50 H-18 M-8 -50 H0 M10 -50 H18 M-62 4 H-54 M-44 4 H-36 M-26 4 H-18 M-8 4 H0 M10 4 H18"/>' +
    '<path class="ink f-clay" d="M-36 -36 L-6 -23 L-36 -10 Z"/>' +
    '<rect x="-26" y="-6" width="100" height="78" rx="8" class="ink f-sea"/>' +
    '<rect x="-26" y="-6" width="100" height="78" rx="8" fill="url(#hatch)"/>' +
    '<rect x="-8" y="14" width="64" height="38" rx="4" class="ink f-paper"/>' +
    '<path class="ink thick f-none" d="M40 -54 Q70 -54 70 -22"/>' +
    '<path class="ink f-ink" d="M60 -26 L70 -12 L80 -26 Z"/>' +
    '<path class="ink thick f-none" d="M-40 66 Q-70 66 -70 34"/>' +
    '<path class="ink f-ink" d="M-80 38 L-70 24 L-60 38 Z"/>',
  writeTools: ["tdarr_set_node_paused"],
  // Requeueing sends up to 100 files through the library's flow, which usually replaces the originals.
  confirmTools: ["tdarr_requeue_files"],
  create({ url, values }) {
    const client = new TdarrClient({ url, apiKey: values.apiKey, fetch: fetchFor(values.tlsFingerprint) });
    return {
      tools: TOOLS.map(t => structuredClone(t)),
      async getStatus() {
        return { version: (await client.getStatus()).version };
      },
      async callTool(name, args) {
        switch (name) {
          case "tdarr_status": {
            const [status, nodes, transcodeQueue, healthQueue] = await Promise.all([
              client.getStatus(),
              client.getNodes(),
              client.getTable(TDARR_TABLES.transcodeQueue, 0, 1),
              client.getTable(TDARR_TABLES.healthQueue, 0, 1),
            ]);
            const list = Object.values(nodes);
            return jsonText({
              version: status.version,
              status: status.status,
              os: status.os,
              uptimeSeconds: status.uptime,
              nodes: list.length,
              nodesPaused: list.filter(n => n.nodePaused).length,
              activeWorkers: list.reduce((sum, n) => sum + Object.keys(n.workers ?? {}).length, 0),
              transcodeQueue: transcodeQueue.totalCount,
              healthCheckQueue: healthQueue.totalCount,
            });
          }
          case "tdarr_get_libraries": {
            const libraries = await client.getLibraries();
            const pies = await Promise.all(libraries.map(l =>
              client.getPieStats(l._id).catch(() => undefined)));
            return jsonText({
              count: libraries.length,
              libraries: libraries.map((l, i) => {
                const pie = pies[i];
                return {
                  id: l._id,
                  name: l.name,
                  folder: l.folder,
                  output: l.output || undefined,
                  processLibrary: l.processLibrary,
                  folderWatching: l.folderWatching,
                  flowId: l.flowId || undefined,
                  plugins: Array.isArray(l.pluginIDs)
                    ? l.pluginIDs.filter(p => p?.checked !== false).map(p => p._id).filter(Boolean)
                    : undefined,
                  ...(pie ? {
                    totalFiles: pie.totalFiles,
                    transcodeStatus: slices(pie.status?.transcode),
                    healthCheckStatus: slices(pie.status?.healthcheck),
                    videoCodecs: slices(pie.video?.codecs),
                    audioCodecs: slices(pie.audio?.codecs),
                    spaceSavedGB: typeof pie.sizeDiff === "number" ? Math.round(pie.sizeDiff * 100) / 100 : undefined,
                  } : {}),
                };
              }),
            });
          }
          case "tdarr_get_nodes":
            return jsonText({ nodes: nodeList(await client.getNodes()) });
          case "tdarr_search_files": {
            const limit = Math.min(Number(args.limit ?? 50), SEARCH_LIMIT_MAX);
            const res = await client.searchFiles(filterFrom(args), limit);
            return jsonText({
              matched: res.matched,
              scanned: res.scanned,
              returned: res.files.length,
              hasMore: res.matched > res.files.length,
              files: res.files,
            });
          }
          case "tdarr_get_file": {
            const file = await client.getFile(String(args.fileId));
            if (!file) throw new Error("Tdarr has no file with that id (use the full path from tdarr_search_files)");
            return jsonText({
              ...summarizeFile(file),
              streams: (file.ffProbeData?.streams ?? []).map(s => ({
                type: s.codec_type,
                codec: s.codec_name,
                channels: s.channels,
                width: s.width,
                height: s.height,
                language: s.tags?.language,
              })),
            });
          }
          case "tdarr_requeue_files": {
            const fileIds = args.fileIds as string[] | undefined;
            const filter = filterFrom(args);
            const hasFilter = Object.keys(filter).length > 0;
            const res = await client.requeueFiles(
              fileIds !== undefined ? { fileIds, ...(hasFilter ? { filter } : {}) } : { filter: hasFilter ? filter : undefined },
              { max: args.max as number | undefined, healthCheck: args.healthCheck === true },
            );
            const what = args.healthCheck === true ? "health check" : "transcode";
            return jsonText({
              success: true,
              ...res,
              message: `${res.requeued} of ${res.matched} matching files queued for ${what}` +
                (res.skipped ? `; ${res.skipped} left out (call again to queue more)` : "") +
                ". The library's flow / plugin stack decides the output format.",
            });
          }
          case "tdarr_get_queue": {
            const table = TABLE_NAMES[String(args.table ?? "transcode_queue")];
            const start = Number(args.start ?? 0);
            const pageSize = Math.min(Number(args.pageSize ?? 25), 100);
            const libraryId = args.libraryId === undefined ? undefined : TdarrClient.checkId("libraryId", args.libraryId);
            const page = await client.getTable(table, start, pageSize, libraryId);
            return jsonText({
              table: args.table ?? "transcode_queue",
              total: page.totalCount,
              start,
              returned: page.array.length,
              hasMore: start + page.array.length < page.totalCount,
              files: page.array.filter(f => f && typeof f._id === "string").map(summarizeFile),
            });
          }
          case "tdarr_get_staged": {
            const staged = await client.getStaged();
            return jsonText({
              count: staged.length,
              files: staged.slice(0, 100).filter(f => f && typeof f._id === "string").map(summarizeFile),
            });
          }
          case "tdarr_get_stats": {
            const libraryId = args.libraryId === undefined ? "" : TdarrClient.checkId("libraryId", args.libraryId);
            const [pie, global] = await Promise.all([
              client.getPieStats(libraryId),
              libraryId ? Promise.resolve(undefined) : client.getStatistics(),
            ]);
            return jsonText({
              scope: libraryId ? `library ${libraryId}` : "all libraries",
              ...pieSummary(pie),
              ...(global ? {
                global: {
                  totalFiles: global.totalFileCount,
                  transcodesDone: global.totalTranscodeCount,
                  healthChecksDone: global.totalHealthCheckCount,
                  spaceSavedGB: typeof global.sizeDiff === "number" ? Math.round(global.sizeDiff * 100) / 100 : undefined,
                  healthCheckScore: global.healthCheckScore,
                },
              } : {}),
            });
          }
          case "tdarr_set_node_paused": {
            const paused = args.paused === true;
            await client.setNodePaused(String(args.nodeId), paused);
            return jsonText({ success: true, message: `Node ${args.nodeId} ${paused ? "paused" : "resumed"}` });
          }
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      },
    };
  },
};
