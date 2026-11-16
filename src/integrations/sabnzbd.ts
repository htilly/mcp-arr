/**
 * SABnzbd (Usenet download client): queue, history (failed jobs), speed,
 * pause/resume, speed limit, removing and retrying jobs.
 * Enabled by SABNZBD_URL + SABNZBD_API_KEY (Config → General → API key).
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { jsonText, type IntegrationDefinition } from "../integration.js";
import { SabnzbdClient, type SabnzbdHistorySlot, type SabnzbdQueue, type SabnzbdQueueSlot } from "../sabnzbd-client.js";
import { formatBytes, unixToIso } from "../format.js";

const nzoIdsProp = {
  nzoIds: {
    type: "array",
    items: { type: "string" },
    description: "Job ids (nzo_id, e.g. SABnzbd_nzo_ab12cd34) from sabnzbd_get_queue or sabnzbd_get_history",
  },
};

const pageProps = {
  start: { type: "integer", minimum: 0, description: "Skip this many jobs (paging)" },
  limit: { type: "integer", minimum: 1, maximum: 200, description: "Max jobs to return (default: 50)" },
};

const TOOLS: Tool[] = [
  {
    name: "sabnzbd_status",
    description: "Get SABnzbd version, whether the queue is downloading/paused/idle (and minutes left of a timed pause), current speed, speed limit, jobs in the queue, total time left and free disk space",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "sabnzbd_get_queue",
    description:
      "List SABnzbd queue jobs with status, progress, size, size left, time left, category and priority. " +
      "Each job has a `stuck` reason when it looks stuck: still grabbing/fetching the NZB, waiting for propagation, " +
      "or downloading at 0 KB/s while the queue is not paused. Use stuckOnly: true to see only those. " +
      "Failed downloads are not in the queue - see sabnzbd_get_history with failedOnly",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Only jobs whose name contains this text" },
        stuckOnly: { type: "boolean", description: "Only jobs that look stuck" },
        ...pageProps,
      },
      required: [],
    },
  },
  {
    name: "sabnzbd_get_history",
    description: "List SABnzbd history (finished jobs, newest first) with status and the failure reason. Use failedOnly: true to find failed downloads (e.g. not enough repair blocks, missing articles, password protected); retry them with sabnzbd_retry_failed",
    inputSchema: {
      type: "object",
      properties: {
        failedOnly: { type: "boolean", description: "Only failed jobs" },
        category: { type: "string", description: "Only this category" },
        search: { type: "string", description: "Only jobs whose name contains this text" },
        ...pageProps,
      },
      required: [],
    },
  },
  {
    name: "sabnzbd_pause",
    description: "Pause SABnzbd. Without nzoIds the whole queue pauses (optionally for a number of minutes, after which it resumes by itself); with nzoIds only those jobs",
    inputSchema: {
      type: "object",
      properties: {
        ...nzoIdsProp,
        minutes: { type: "integer", minimum: 1, maximum: 10080, description: "Pause the whole queue for this many minutes (not with nzoIds)" },
      },
      required: [],
    },
    annotations: { idempotentHint: true },
  },
  {
    name: "sabnzbd_resume",
    description: "Resume SABnzbd: the whole queue without nzoIds, or only those jobs",
    inputSchema: { type: "object", properties: { ...nzoIdsProp }, required: [] },
    annotations: { idempotentHint: true },
  },
  {
    name: "sabnzbd_set_speed_limit",
    description: "Set the SABnzbd download speed limit: a percentage of the maximum line speed configured in SABnzbd (e.g. \"50\"; \"100\" = no limit) or an absolute value like \"800K\" or \"5M\" (bytes per second)",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "string", description: "e.g. \"50\", \"100\", \"800K\", \"5M\"" } },
      required: ["limit"],
    },
    annotations: { idempotentHint: true },
  },
  {
    name: "sabnzbd_retry_failed",
    description: "Retry failed SABnzbd jobs from the history: one job with nzoId, or every failed job without it",
    inputSchema: {
      type: "object",
      properties: { nzoId: { type: "string", description: "Failed job from sabnzbd_get_history (failedOnly: true)" } },
      required: [],
    },
  },
  {
    name: "sabnzbd_delete_queue_item",
    description: "Remove jobs from the SABnzbd queue, e.g. stuck ones found with sabnzbd_get_queue (stuckOnly: true). deleteFiles: true also deletes what was already downloaded",
    inputSchema: {
      type: "object",
      properties: {
        ...nzoIdsProp,
        deleteFiles: { type: "boolean", description: "Also delete downloaded files (default: false)" },
      },
      required: ["nzoIds"],
    },
  },
  {
    name: "sabnzbd_delete_history_item",
    description: "Remove jobs from the SABnzbd history, e.g. failed ones that will not be retried. deleteFiles: true also deletes their files",
    inputSchema: {
      type: "object",
      properties: {
        ...nzoIdsProp,
        deleteFiles: { type: "boolean", description: "Also delete the job's files (default: false)" },
      },
      required: ["nzoIds"],
    },
  },
];

function queueSlotView(slot: SabnzbdQueueSlot, queue: SabnzbdQueue) {
  return {
    nzoId: slot.nzo_id,
    name: slot.filename,
    status: slot.status,
    progress: slot.percentage !== undefined ? `${slot.percentage}%` : undefined,
    size: slot.size,
    sizeLeft: slot.sizeleft,
    timeLeft: slot.timeleft,
    category: slot.cat,
    priority: slot.priority,
    labels: slot.labels?.length ? slot.labels : undefined,
    stuck: SabnzbdClient.queueStuckReason(slot, queue) ?? null,
  };
}

function historySlotView(slot: SabnzbdHistorySlot) {
  return {
    nzoId: slot.nzo_id,
    name: slot.name,
    status: slot.status,
    failMessage: slot.fail_message || undefined,
    category: slot.category,
    size: slot.size ?? (slot.bytes !== undefined ? formatBytes(slot.bytes) : undefined),
    completed: unixToIso(slot.completed),
    canRetry: slot.status === "Failed" ? Boolean(slot.retry) : undefined,
  };
}

function freeSpace(gb?: string): string | undefined {
  return gb !== undefined && gb !== "" ? `${gb} GB` : undefined;
}

export const sabnzbd: IntegrationDefinition = {
  name: "sabnzbd",
  displayName: "SABnzbd (Usenet)",
  envPrefix: "SABNZBD",
  exampleUrl: "http://localhost:8080",
  // A newspaper (Usenet) with a download arrow.
  icon:
    '<path class="ink f-paper" d="M-66 -54 H50 V54 H-56 Q-66 54 -66 44 Z"/>' +
    '<path class="ink f-pale" d="M50 -30 H66 V44 Q66 54 56 54 H50 Z"/>' +
    '<rect x="-54" y="-42" width="92" height="16" rx="3" class="ink f-ink"/>' +
    '<path class="thin" d="M-54 -12 H-6 M-54 4 H-6 M-54 20 H-6 M-54 36 H-6"/>' +
    '<rect x="4" y="-14" width="34" height="34" rx="4" class="ink f-sea"/><rect x="4" y="-14" width="34" height="34" rx="4" fill="url(#hatch)"/>' +
    '<path class="ink f-gold" d="M14 -8 H28 V8 H36 L21 24 L6 8 H14 Z"/>',
  writeTools: ["sabnzbd_pause", "sabnzbd_resume", "sabnzbd_set_speed_limit", "sabnzbd_retry_failed"],
  confirmTools: ["sabnzbd_delete_queue_item", "sabnzbd_delete_history_item"],

  create({ url, values }) {
    const client = new SabnzbdClient({ url, apiKey: values.apiKey ?? "" });
    return {
      tools: TOOLS.map(t => ({ ...t, inputSchema: { ...t.inputSchema } })),
      async getStatus() {
        // mode=version needs no API key, so check the key with a queue call too.
        const [version] = await Promise.all([client.getVersion(), client.getQueue({ limit: 1 })]);
        return { version };
      },
      async callTool(name, args) {
        switch (name) {
          case "sabnzbd_status": {
            const [version, queue] = await Promise.all([client.getVersion(), client.getQueue({ limit: 1 })]);
            const pauseMinutes = Number(queue.pause_int ?? 0);
            return jsonText({
              version,
              status: queue.status,
              paused: queue.paused,
              pauseMinutesLeft: queue.paused && pauseMinutes > 0 ? pauseMinutes : undefined,
              speed: `${queue.kbpersec ?? 0} KB/s`,
              speedLimit: queue.speedlimit_abs
                ? `${formatBytes(Number(queue.speedlimit_abs))}/s (${queue.speedlimit}%)`
                : queue.speedlimit && queue.speedlimit !== "100" ? `${queue.speedlimit}%` : "none",
              jobs: queue.noofslots_total ?? queue.noofslots,
              sizeLeft: queue.sizeleft,
              timeLeft: queue.timeleft,
              freeDiskIncomplete: freeSpace(queue.diskspace1),
              freeDiskComplete: freeSpace(queue.diskspace2),
              warnings: queue.have_warnings && queue.have_warnings !== "0" ? Number(queue.have_warnings) : undefined,
            });
          }
          case "sabnzbd_get_queue": {
            const a = args as { search?: string; stuckOnly?: boolean; start?: number; limit?: number };
            const start = a.start ?? 0;
            const limit = a.limit ?? 50;
            const queue = await client.getQueue(a.stuckOnly ? { search: a.search } : { start, limit, search: a.search });
            let jobs = (queue.slots ?? []).map(s => queueSlotView(s, queue));
            let total = queue.noofslots_total ?? queue.noofslots;
            if (a.stuckOnly) {
              jobs = jobs.filter(j => j.stuck);
              total = jobs.length;
              jobs = jobs.slice(start, start + limit);
            }
            return jsonText({
              queueStatus: queue.status,
              paused: queue.paused,
              speed: `${queue.kbpersec ?? 0} KB/s`,
              total,
              start,
              returned: jobs.length,
              stuckCount: jobs.filter(j => j.stuck).length,
              jobs,
            });
          }
          case "sabnzbd_get_history": {
            const a = args as { failedOnly?: boolean; category?: string; search?: string; start?: number; limit?: number };
            const start = a.start ?? 0;
            const history = await client.getHistory({ ...a, start, limit: a.limit ?? 50 });
            const jobs = (history.slots ?? []).map(historySlotView);
            return jsonText({
              total: history.noofslots,
              start,
              returned: jobs.length,
              failedCount: jobs.filter(j => j.status === "Failed").length,
              jobs,
            });
          }
          case "sabnzbd_pause": {
            const a = args as { nzoIds?: string[]; minutes?: number };
            if (a.nzoIds?.length) {
              if (a.minutes !== undefined) throw new Error("minutes only applies to pausing the whole queue");
              await client.pauseItems(a.nzoIds);
              return jsonText({ success: true, message: `${a.nzoIds.length} job(s) paused` });
            }
            await client.pauseAll(a.minutes);
            return jsonText({ success: true, message: a.minutes ? `Queue paused for ${a.minutes} minutes` : "Queue paused" });
          }
          case "sabnzbd_resume": {
            const a = args as { nzoIds?: string[] };
            if (a.nzoIds?.length) {
              await client.resumeItems(a.nzoIds);
              return jsonText({ success: true, message: `${a.nzoIds.length} job(s) resumed` });
            }
            await client.resumeAll();
            return jsonText({ success: true, message: "Queue resumed" });
          }
          case "sabnzbd_set_speed_limit": {
            const limit = SabnzbdClient.checkSpeedLimit(String(args.limit));
            await client.setSpeedLimit(limit);
            return jsonText({ success: true, message: `Speed limit set to ${/[KM]$/.test(limit) ? `${limit}B/s` : `${limit}%`}` });
          }
          case "sabnzbd_retry_failed": {
            const nzoId = args.nzoId as string | undefined;
            if (nzoId) await client.retry(nzoId);
            else await client.retryAll();
            return jsonText({ success: true, message: nzoId ? `${nzoId} queued for retry` : "All failed jobs queued for retry" });
          }
          case "sabnzbd_delete_queue_item":
          case "sabnzbd_delete_history_item": {
            const ids = args.nzoIds as string[];
            const deleteFiles = args.deleteFiles === true;
            if (name === "sabnzbd_delete_queue_item") await client.deleteQueueItems(ids, deleteFiles);
            else await client.deleteHistoryItems(ids, deleteFiles);
            return jsonText({
              success: true,
              message: `${ids.length} job(s) removed from the ${name === "sabnzbd_delete_queue_item" ? "queue" : "history"}${deleteFiles ? " and their files deleted" : ""}`,
            });
          }
        }
        throw new Error(`Unknown tool: ${name}`);
      },
    };
  },
};
