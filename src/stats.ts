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
const SERVICE_PREFIXES = ['sonarr', 'radarr', 'lidarr', 'prowlarr', 'tautulli', 'overseerr', 'bazarr', 'maintainerr'];

export function serviceForTool(tool: string): string {
  const prefix = tool.split('_')[0];
  return SERVICE_PREFIXES.includes(prefix) ? prefix : 'core';
}

/** Who made a tool call (HTTP mode): the token owner and the token's name. */
export interface CallContext {
  userId: string;
  name: string;
  /** Access token name, e.g. "Claude Desktop" or "OAuth: Claude". */
  client?: string;
}

export interface CallEvent {
  id: number;
  phase: 'start' | 'end';
  at: string;
  tool: string;
  service: string;
  caller?: string;
  callerId?: string;
  client?: string;
  ok?: boolean;
  ms?: number;
}

interface Counter { calls: number; errors: number; totalMs: number; lastAt?: string }

export type LoginMethod = 'passkey' | 'password' | 'new account' | 'connected app';

interface LoginEntry { at: string; method: LoginMethod; device: string }

interface UserStats {
  name: string;
  calls: Counter;
  services: Record<string, Counter>;
  tools: Record<string, Counter>;
  /** access token name -> usage */
  clients: Record<string, Counter>;
  hours: Record<string, number>;
  days: Record<string, number>;
  logins: {
    count: number;
    lastAt?: string;
    methods: Record<string, number>;
    failed: number;
    lastFailedAt?: string;
    recent: LoginEntry[];
  };
}

interface PersistedStats {
  version: 1;
  since: string;
  services: Record<string, Counter>;
  tools: Record<string, Counter>;
  /** user id -> personal statistics */
  users: Record<string, UserStats>;
  /** hour start (epoch ms) -> calls */
  hours: Record<string, number>;
  /** YYYY-MM-DD (server local time) -> calls */
  days: Record<string, number>;
}

const HOUR = 3_600_000;
const RECENT_MAX = 40;
const USER_RECENT_MAX = 25;
const LOGINS_KEPT = 20;
const DAILY_DAYS = 30;
const KEEP_DAYS = 60;

function emptyCounter(): Counter {
  return { calls: 0, errors: 0, totalMs: 0 };
}

/** Coarse device label from a User-Agent ("Safari on iOS"). Never stores the raw string. */
export function deviceFromUserAgent(ua: string | undefined): string {
  if (!ua) return 'unknown device';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
    : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'unknown OS';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari' : 'a browser';
  return `${browser} on ${os}`;
}

function emptyUser(name: string): UserStats {
  return {
    name, calls: emptyCounter(), services: {}, tools: {}, clients: {}, hours: {}, days: {},
    logins: { count: 0, methods: {}, failed: 0, recent: [] },
  };
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export class Stats extends EventEmitter {
  private data: PersistedStats = Stats.empty();
  private recent: CallEvent[] = [];
  private userRecent = new Map<string, CallEvent[]>();
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
    return { version: 1, since: new Date().toISOString(), services: {}, tools: {}, users: {}, hours: {}, days: {} };
  }

  /** Load totals from (and keep saving them to) a JSON file. Unreadable files are ignored. */
  attachFile(path: string): void {
    this.file = path;
    try {
      if (existsSync(path)) {
        const parsed = JSON.parse(readFileSync(path, 'utf8')) as PersistedStats;
        if (parsed && parsed.version === 1) this.data = { ...Stats.empty(), ...parsed, users: parsed.users ?? {} };
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
    const minDay = dayKey(new Date(now - KEEP_DAYS * 24 * HOUR));
    const pruneMaps = (hours: Record<string, number>, days: Record<string, number>) => {
      for (const k of Object.keys(hours)) if (Number(k) < minHour) delete hours[k];
      for (const k of Object.keys(days)) if (k < minDay) delete days[k];
    };
    pruneMaps(this.data.hours, this.data.days);
    for (const u of Object.values(this.data.users)) pruneMaps(u.hours, u.days);
  }

  private userEntry(userId: string, name: string): UserStats {
    const u = (this.data.users[userId] ??= emptyUser(name));
    u.name = name;
    return u;
  }

  /** Record a successful sign-in to the web UI (or a connector approval). */
  recordLogin(userId: string, name: string, method: LoginMethod, userAgent?: string): void {
    const u = this.userEntry(userId, name);
    const at = new Date().toISOString();
    u.logins.count++;
    u.logins.lastAt = at;
    u.logins.methods[method] = (u.logins.methods[method] ?? 0) + 1;
    u.logins.recent.unshift({ at, method, device: deviceFromUserAgent(userAgent) });
    if (u.logins.recent.length > LOGINS_KEPT) u.logins.recent.length = LOGINS_KEPT;
    this.scheduleSave();
  }

  /** Record a wrong password for an existing account. */
  recordLoginFailure(userId: string, name: string): void {
    const u = this.userEntry(userId, name);
    u.logins.failed++;
    u.logins.lastFailedAt = new Date().toISOString();
    this.scheduleSave();
  }

  /** Forget a deleted user's personal statistics (global totals are kept). */
  removeUser(userId: string): void {
    delete this.data.users[userId];
    this.userRecent.delete(userId);
    this.recent = this.recent.map(e => (e.callerId === userId ? { ...e, caller: 'deleted user', callerId: undefined, client: undefined } : e));
    this.scheduleSave();
  }

  /** Mark the start of a tool call. Returns a function that records its end. */
  begin(tool: string, ctx?: CallContext): (ok: boolean) => void {
    const id = this.nextId++;
    const started = Date.now();
    const service = serviceForTool(tool);
    const who = { caller: ctx?.name, callerId: ctx?.userId, client: ctx?.client };
    this.inFlight++;
    this.emit('call', { id, phase: 'start', at: new Date(started).toISOString(), tool, service, ...who } satisfies CallEvent);
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
      const hour = String(Math.floor(now / HOUR) * HOUR);
      const day = dayKey(new Date(now));
      bump(this.data.services, service);
      bump(this.data.tools, tool);
      this.data.hours[hour] = (this.data.hours[hour] ?? 0) + 1;
      this.data.days[day] = (this.data.days[day] ?? 0) + 1;
      const event: CallEvent = { id, phase: 'end', at, tool, service, ...who, ok, ms };
      if (ctx) {
        const u = this.userEntry(ctx.userId, ctx.name);
        bump({ c: u.calls }, 'c');
        bump(u.services, service);
        bump(u.tools, tool);
        bump(u.clients, ctx.client || 'unknown client');
        u.hours[hour] = (u.hours[hour] ?? 0) + 1;
        u.days[day] = (u.days[day] ?? 0) + 1;
        const mine = this.userRecent.get(ctx.userId) ?? [];
        mine.unshift(event);
        if (mine.length > USER_RECENT_MAX) mine.length = USER_RECENT_MAX;
        this.userRecent.set(ctx.userId, mine);
      }
      this.prune(now);
      this.recent.unshift(event);
      if (this.recent.length > RECENT_MAX) this.recent.length = RECENT_MAX;
      this.emit('call', event);
      this.scheduleSave();
    };
  }

  /** Wrap an async tool call. A result with isError: true or a thrown error counts as failed. */
  async track<T>(tool: string, ctx: CallContext | undefined, fn: () => Promise<T>): Promise<T> {
    const end = this.begin(tool, ctx);
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
  snapshot(viewer: { id?: string; name: string; admin: boolean }) {
    const now = Date.now();
    this.prune(now);
    const total = Object.values(this.data.services).reduce((a, c) => {
      a.calls += c.calls; a.errors += c.errors; a.totalMs += c.totalMs; return a;
    }, emptyCounter());
    const thisHour = Math.floor(now / HOUR) * HOUR;
    const busiest = Object.entries(this.data.days).reduce<[string, number] | undefined>((best, d) => (!best || d[1] > best[1] ? d : best), undefined);
    return {
      since: this.data.since,
      startedAt: this.startedAt,
      inFlight: this.inFlight,
      totals: { calls: total.calls, errors: total.errors, avgMs: avg(total), today: this.data.days[dayKey(new Date(now))] ?? 0 },
      busiestDay: busiest ? { day: busiest[0], calls: busiest[1] } : null,
      services: shapeMap(this.data.services),
      tools: topTools(this.data.tools),
      callers: viewer.admin
        ? Object.entries(this.data.users).filter(([, u]) => u.calls.calls > 0).sort((a, b) => b[1].calls.calls - a[1].calls.calls).slice(0, 10)
          .map(([id, u]) => ({ id, name: u.name, ...shape(u.calls) }))
        : [],
      hourly: last24(this.data.hours, thisHour),
      hourlyEndsAt: new Date(thisHour + HOUR).toISOString(),
      recent: this.recent.map(e => this.forViewer(e, viewer)),
    };
  }

  /** Personal statistics for one user: their calls, apps (access tokens) and sign-ins. */
  userSnapshot(userId: string, name: string) {
    const now = Date.now();
    this.prune(now);
    const u = this.data.users[userId] ?? emptyUser(name);
    const thisHour = Math.floor(now / HOUR) * HOUR;
    const today = new Date(now);
    const daily: { day: string; calls: number }[] = [];
    for (let i = DAILY_DAYS - 1; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      daily.push({ day: dayKey(d), calls: u.days[dayKey(d)] ?? 0 });
    }
    const activeDays = Object.values(u.days).filter(n => n > 0).length;
    return {
      since: this.data.since,
      name: u.name,
      totals: { ...shape(u.calls), today: u.days[dayKey(today)] ?? 0, activeDays },
      services: shapeMap(u.services),
      tools: topTools(u.tools),
      clients: Object.entries(u.clients).sort((a, b) => b[1].calls - a[1].calls).map(([client, c]) => ({ name: client, ...shape(c) })),
      hourly: last24(u.hours, thisHour),
      hourlyEndsAt: new Date(thisHour + HOUR).toISOString(),
      daily,
      recent: this.userRecent.get(userId) ?? [],
      logins: { ...u.logins, recent: u.logins.recent.slice() },
    };
  }

  /** Hide other users' names from non-admins. */
  forViewer(e: CallEvent, viewer: { id?: string; name: string; admin: boolean }): CallEvent {
    if (viewer.admin || !e.caller) return e;
    if (viewer.id ? e.callerId === viewer.id : e.caller === viewer.name) return e;
    return { ...e, caller: 'someone', callerId: undefined, client: undefined };
  }
}

function avg(c: Counter): number {
  return c.calls ? Math.round(c.totalMs / c.calls) : 0;
}
function shape(c: Counter) {
  return { calls: c.calls, errors: c.errors, avgMs: avg(c), lastAt: c.lastAt };
}
function shapeMap(map: Record<string, Counter>) {
  return Object.fromEntries(Object.entries(map).map(([k, c]) => [k, shape(c)]));
}
function topTools(map: Record<string, Counter>) {
  return Object.entries(map)
    .sort((a, b) => b[1].calls - a[1].calls)
    .slice(0, 8)
    .map(([tool, c]) => ({ tool, service: serviceForTool(tool), ...shape(c) }));
}
function last24(hours: Record<string, number>, thisHour: number): number[] {
  const out: number[] = [];
  for (let i = 23; i >= 0; i--) out.push(hours[String(thisHour - i * HOUR)] ?? 0);
  return out;
}

/** Process-wide statistics instance. */
export const stats = new Stats();
