/**
 * "Sign in with Plex" for the web UI (the PIN flow Tautulli and Overseerr use).
 *
 * 1. start(): POST plex.tv/api/v2/pins?strong=true gives a PIN id + code; the
 *    browser opens app.plex.tv/auth with that code. A user who is already
 *    signed in to plex.tv only clicks Allow.
 * 2. poll(): GET plex.tv/api/v2/pins/{id} until it carries an authToken.
 * 3. With that account token, GET plex.tv/api/v2/resources lists the servers
 *    the account can use. Each one becomes a result with the server's own
 *    access token (narrower than the account token) and its local URL.
 *
 * The account token is used only for that one request and never stored.
 * PLEX_TV_URL / PLEX_APP_URL override the plex.tv addresses (tests).
 */

import type { IntegrationSignIn, SignInResult } from "./integration.js";

const PRODUCT = "mcp-arr";
const TIMEOUT_MS = 15_000;
/** Plex PINs live about 15 minutes; stop earlier. */
const MAX_AGE_MS = 10 * 60_000;

interface PinState {
  id: number;
  code: string;
  createdAt: number;
}

interface PlexPin {
  id?: number;
  code?: string;
  authToken?: string | null;
  expiresIn?: number;
}

interface PlexConnection {
  protocol?: string;
  address?: string;
  port?: number;
  uri?: string;
  local?: boolean;
  relay?: boolean;
  IPv6?: boolean;
}

interface PlexResource {
  name?: string;
  provides?: string;
  owned?: boolean;
  accessToken?: string;
  clientIdentifier?: string;
  connections?: PlexConnection[];
}

function plexTv(): string {
  return (process.env.PLEX_TV_URL || "https://plex.tv").replace(/\/+$/, "");
}

function plexApp(): string {
  return (process.env.PLEX_APP_URL || "https://app.plex.tv").replace(/\/+$/, "");
}

function headers(clientId: string, token?: string): Record<string, string> {
  return {
    Accept: "application/json",
    "X-Plex-Product": PRODUCT,
    "X-Plex-Client-Identifier": clientId,
    "X-Plex-Device-Name": PRODUCT,
    ...(token ? { "X-Plex-Token": token } : {}),
  };
}

async function plexTvJson<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${plexTv()}${path}`, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    const code = (error as { cause?: { code?: string } }).cause?.code;
    throw new Error(`Could not reach plex.tv${code ? ` (${code})` : ""} - this server needs internet access for Plex sign-in; enter the token by hand instead`);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`plex.tv API error: ${response.status} ${response.statusText}`.trim());
  }
  return (await response.json()) as T;
}

/** Best address for mcp-arr: a local plain address, then any local, then remote; never a relay. */
export function pickConnection(connections: PlexConnection[] = []): string | undefined {
  const usable = connections.filter(c => !c.relay && c.address && c.port);
  const rank = (c: PlexConnection) => (c.local ? 0 : 2) + (c.IPv6 ? 1 : 0);
  const best = [...usable].sort((a, b) => rank(a) - rank(b))[0];
  if (!best) return undefined;
  // http to the IP: the plex.direct https names often do not resolve on LANs
  // with DNS rebinding protection. A remote address keeps the https uri.
  if (best.local) {
    const host = best.IPv6 ? `[${best.address}]` : best.address;
    return `http://${host}:${best.port}`;
  }
  return best.uri?.replace(/\/+$/, "") || `https://${best.address}:${best.port}`;
}

export function resourcesToResults(resources: PlexResource[]): SignInResult[] {
  const servers = resources.filter(r => (r.provides ?? "").split(",").includes("server") && r.accessToken);
  // Owned servers first.
  servers.sort((a, b) => Number(b.owned === true) - Number(a.owned === true));
  return servers.map(r => ({
    label: `${r.name ?? "Plex server"}${r.owned === false ? " (shared with you)" : ""}`,
    url: pickConnection(r.connections),
    values: { token: r.accessToken! },
  }));
}

export const plexSignIn: IntegrationSignIn = {
  label: "Sign in with Plex",

  async start({ clientId, returnUrl }) {
    const pin = await plexTvJson<PlexPin>("/api/v2/pins?strong=true", { method: "POST", headers: headers(clientId) });
    if (!pin.id || !pin.code) throw new Error("plex.tv did not return a sign-in PIN");
    const params = new URLSearchParams({
      clientID: clientId,
      code: pin.code,
      "context[device][product]": PRODUCT,
    });
    // Plex sends the browser back after Allow. Without it a phone stays on Plex's page.
    if (returnUrl) params.set("forwardUrl", returnUrl);
    const state: PinState = { id: pin.id, code: pin.code, createdAt: Date.now() };
    return { authUrl: `${plexApp()}/auth#?${params.toString()}`, state };
  },

  async poll(raw, { clientId }) {
    const state = raw as PinState;
    if (Date.now() - state.createdAt > MAX_AGE_MS) throw new Error("The Plex sign-in expired - start again");
    const pin = await plexTvJson<PlexPin>(`/api/v2/pins/${encodeURIComponent(String(state.id))}?code=${encodeURIComponent(state.code)}`, {
      headers: headers(clientId),
    });
    if (!pin.authToken) return { status: "pending" };
    const resources = await plexTvJson<PlexResource[]>("/api/v2/resources?includeHttps=1&includeRelay=0", {
      headers: headers(clientId, pin.authToken),
    });
    const results = resourcesToResults(Array.isArray(resources) ? resources : []);
    if (results.length === 0) throw new Error("Signed in, but this Plex account has no servers it can use");
    return { status: "done", results };
  },
};
