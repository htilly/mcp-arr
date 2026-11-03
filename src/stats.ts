/**
 * Usage statistics for MCP tool calls (shown on the web UI status board).
 *
 * - Counts calls, errors and response time per service, per tool and per caller,
 *   plus hourly buckets for the last 24 hours.
 * - Emits 'call' events (phase 'start' / 'end') that the web UI streams live.
 * - Optionally persisted to a small JSON file next to the config (counts only:
 *   never tool arguments or results), so totals survive restarts.
 */

import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

/** Tool name prefixes that belong to a configurable service. Anything else counts as 'core'. */
const SERVICE_PREFIXES = ['sonarr', 'radarr', 'lidarr', 'prowlarr', 'tautulli', 'overseerr', 'bazarr'];

export function serviceForTool(tool: string): string {
  const prefix = tool.split('_')[0];
  return SERVICE_PREFIXES.includes(prefix) ? prefix : 'core';
}

export interface CallEvent {
  id: number;
  phase: 'start' | 'end';
  at: string;
  tool: string;
  service: string;
  caller?: string;
  ok?: boolean;
  ms?: number;
}

interface Counter { calls: number; errors: number; totalMs: number; lastAt?: string }

interface PersistedStats {
  version: 1;
  since: string;
  services: Record<string, Counter>;
  tools: Record<string, Counter>;
  callers: Record<string, Counter>;
  /** hour start (epoch ms) -> calls */
  hours: Record<string, number>;
  /** YYYY-MM-DD (server local time) -> calls */
  days: Record<string, number>;
}

const HOUR = 3_600_000;
const RECENT_MAX = 40;
const KEEP_DAYS = 60;

function emptyCounter(): Counter {
  return { calls: 0, errors: 0, totalMs: 0 };
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export class Stats extends EventEmitter {
  private data: PersistedStats = Stats.empty();
  private recent: CallEvent[] = [];
  private inFlight = 0;
  private nextId = 1;
  private file?: string;
  private saveTimer?: NodeJS.Timeout;
  readonly startedAt = new Date().toISOString();

  constructor() {
    super();
    this.setMaxListeners(200);
  }

  private static empty(): PersistedStats {
    return { version: 1, since: new Date().toISOString(), services: {}, tools: {}, callers: {}, hours: {}, days: {} };
  }

  /** Load totals from (and keep saving them to) a JSON file. Unreadable files are ignored. */
  attachFile(path: string): void {
    this.file = path;
    try {
      if (existsSync(path)) {
        const parsed = JSON.parse(readFileSync(path, 'utf8')) as PersistedStats;
        if (parsed && parsed.version === 1) this.data = { ...Stats.empty(), ...parsed };
      }
    } catch {
      // start fresh
    }
    // 'exit' handlers run synchronously on process.exit() (the HTTP server's SIGTERM/SIGINT shutdown)
    process.once('exit', () => this.saveNow());
  }

  private scheduleSave(): void {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.saveNow(), 15_000);
    this.saveTimer.unref();
  }

  private saveNow(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    if (!this.file) return;
    try {
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
      renameSync(tmp, this.file);
    } catch {
      // statistics are best effort
    }
  }

  private prune(now: number): void {
    const minHour = now - 24 * HOUR;
    for (const k of Object.keys(this.data.hours)) if (Number(k) < minHour) delete this.data.hours[k];
    const minDay = dayKey(new Date(now - KEEP_DAYS * 24 * HOUR));
    for (const k of Object.keys(this.data.days)) if (k < minDay) delete this.data.days[k];
  }

  /** Mark the start of a tool call. Returns a function that records its end. */
  begin(tool: string, caller?: string): (ok: boolean) => void {
    const id = this.nextId++;
    const started = Date.now();
    const service = serviceForTool(tool);
    this.inFlight++;
    this.emit('call', { id, phase: 'start', at: new Date(started).toISOString(), tool, service, caller } satisfies CallEvent);
    let done = false;
    return (ok: boolean) => {
      if (done) return;
      done = true;
      this.inFlight--;
      const now = Date.now();
      const ms = now - started;
      const at = new Date(now).toISOString();
      const bump = (map: Record<string, Counter>, key: string) => {
        const c = (map[key] ??= emptyCounter());
        c.calls++;
        if (!ok) c.errors++;
        c.totalMs += ms;
        c.lastAt = at;
      };
      bump(this.data.services, service);
      bump(this.data.tools, tool);
      if (caller) bump(this.data.callers, caller);
      const hour = String(Math.floor(now / HOUR) * HOUR);
      this.data.hours[hour] = (this.data.hours[hour] ?? 0) + 1;
      const day = dayKey(new Date(now));
      this.data.days[day] = (this.data.days[day] ?? 0) + 1;
      this.prune(now);
      const event: CallEvent = { id, phase: 'end', at, tool, service, caller, ok, ms };
      this.recent.unshift(event);
      if (this.recent.length > RECENT_MAX) this.recent.length = RECENT_MAX;
      this.emit('call', event);
      this.scheduleSave();
    };
  }

  /** Wrap an async tool call. A result with isError: true or a thrown error counts as failed. */
  async track<T>(tool: string, caller: string | undefined, fn: () => Promise<T>): Promise<T> {
    const end = this.begin(tool, caller);
    try {
      const result = await fn();
      end(!(result && typeof result === 'object' && (result as { isError?: boolean }).isError));
      return result;
    } catch (error) {
      end(false);
      throw error;
    }
  }

  /**
   * Snapshot for the web UI. `viewer` limits caller names: admins see everyone,
   * other users only see their own name (others become "someone").
   */
  snapshot(viewer: { name: string; admin: boolean }) {
    const now = Date.now();
    this.prune(now);
    const avg = (c: Counter) => (c.calls ? Math.round(c.totalMs / c.calls) : 0);
    const shape = (c: Counter) => ({ calls: c.calls, errors: c.errors, avgMs: avg(c), lastAt: c.lastAt });
    const total = Object.values(this.data.services).reduce((a, c) => {
      a.calls += c.calls; a.errors += c.errors; a.totalMs += c.totalMs; return a;
    }, emptyCounter());
    const thisHour = Math.floor(now / HOUR) * HOUR;
    const hourly: number[] = [];
    for (let i = 23; i >= 0; i--) hourly.push(this.data.hours[String(thisHour - i * HOUR)] ?? 0);
    const days = Object.entries(this.data.days).sort(([a], [b]) => (a < b ? -1 : 1));
    const busiest = days.reduce<[string, number] | undefined>((best, d) => (!best || d[1] > best[1] ? d : best), undefined);
    return {
      since: this.data.since,
      startedAt: this.startedAt,
      inFlight: this.inFlight,
      totals: { calls: total.calls, errors: total.errors, avgMs: avg(total), today: this.data.days[dayKey(new Date(now))] ?? 0 },
      busiestDay: busiest ? { day: busiest[0], calls: busiest[1] } : null,
      services: Object.fromEntries(Object.entries(this.data.services).map(([k, c]) => [k, shape(c)])),
      tools: Object.entries(this.data.tools)
        .sort((a, b) => b[1].calls - a[1].calls)
        .slice(0, 8)
        .map(([tool, c]) => ({ tool, service: serviceForTool(tool), ...shape(c) })),
      callers: viewer.admin
        ? Object.entries(this.data.callers).sort((a, b) => b[1].calls - a[1].calls).slice(0, 10).map(([name, c]) => ({ name, ...shape(c) }))
        : [],
      hourly,
      hourlyEndsAt: new Date(thisHour + HOUR).toISOString(),
      recent: this.recent.map(e => this.forViewer(e, viewer)),
    };
  }

  /** Hide other users' names from non-admins. */
  forViewer(e: CallEvent, viewer: { name: string; admin: boolean }): CallEvent {
    if (viewer.admin || !e.caller || e.caller === viewer.name) return e;
    return { ...e, caller: 'someone' };
  }
}

/** Process-wide statistics instance. */
export const stats = new Stats();
