/** Small display helpers shared by integrations. */

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

/** 3725 -> "1h 2m", 59 -> "59s". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m`;
  return `${s}s`;
}

/** Unix seconds to ISO 8601; undefined for missing / zero / negative values. */
export function unixToIso(seconds?: number): string | undefined {
  return seconds && seconds > 0 ? new Date(seconds * 1000).toISOString() : undefined;
}

/**
 * The short, human-readable part of an upstream error body, or '' when there is none.
 * *arr validation errors ([{ errorMessage }]) and { message } bodies are kept, at most
 * 200 characters; anything else (HTML pages, stack traces, raw dumps) is dropped so file
 * paths and versions of the media hosts do not reach MCP callers. The full body is
 * written to stderr for the server admin.
 */
export function upstreamErrorDetail(service: string, status: number, text: string): string {
  if (text) console.error(`${service} API error ${status}: ${text.slice(0, 2000)}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return '';
  }
  const messages: string[] = [];
  const pick = (v: unknown) => {
    if (v && typeof v === 'object') {
      const o = v as { errorMessage?: unknown; message?: unknown };
      const m = typeof o.errorMessage === 'string' ? o.errorMessage : typeof o.message === 'string' ? o.message : undefined;
      if (m) messages.push(m);
    }
  };
  if (Array.isArray(parsed)) parsed.slice(0, 5).forEach(pick);
  else pick(parsed);
  const detail = messages.join('; ').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 200);
  return detail ? ` - ${detail}` : '';
}
