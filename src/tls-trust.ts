/**
 * Trusting one self-signed certificate for an integration.
 *
 * Services on a LAN often serve HTTPS with a self-signed certificate (e.g.
 * SABnzbd's built-in HTTPS). Turning certificate checks off would let anyone
 * on the path read the API key, so instead the integration can pin the
 * certificate's SHA-256 fingerprint (TLS_FINGERPRINT_FIELD):
 *
 * - With a fingerprint, fetchFor() does the TLS handshake itself, compares the
 *   server certificate's SHA-256 fingerprint and only then sends the request.
 *   Nothing (no header, no URL with an API key) is written before the check.
 * - Without one, the normal fetch() is used. When it fails because the
 *   certificate is not trusted, the error says so and includes the
 *   fingerprint the server presented, so it can be checked and pasted in.
 */

import { connect as tlsConnect, type TLSSocket } from "node:tls";
import { request as httpRequest } from "node:http";
import { isIP } from "node:net";
import type { IntegrationField } from "./integration.js";

/** Optional field: SHA-256 fingerprint of a self-signed certificate to trust. */
export const TLS_FINGERPRINT_FIELD: IntegrationField = {
  key: "tlsFingerprint",
  label: "Trusted certificate (SHA-256 fingerprint)",
  envSuffix: "TLS_FINGERPRINT",
  secret: false,
  required: false,
  placeholder: "Only for a self-signed HTTPS certificate - Test shows the value",
};

/** Certificate problems. The message is safe to show: it never contains a URL or credentials. */
export class TlsTrustError extends Error {
  constructor(message: string, readonly fingerprint?: string) {
    super(message);
    this.name = "TlsTrustError";
  }
}

export interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string | URLSearchParams;
  signal?: AbortSignal;
}

export type FetchLike = (url: string, init?: FetchInit) => Promise<Response>;

/** Error codes for a certificate that is valid TLS but not trusted. */
const UNTRUSTED_CODES = new Set([
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_GET_ISSUER_CERT",
  "CERT_UNTRUSTED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "CERT_HAS_EXPIRED",
]);

const TIMEOUT_MS = 30_000;

/** "ab cd:EF..." -> "AB:CD:EF:..." (64 hex digits), or throws. */
export function normaliseFingerprint(value: string): string {
  const hex = value.replace(/^sha-?256[:=\s]*/i, "").replace(/[\s:]/g, "").toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(hex)) {
    throw new TlsTrustError("The trusted certificate must be a SHA-256 fingerprint: 64 hex digits, colons optional");
  }
  return hex.match(/../g)!.join(":");
}

function tlsOptions(target: URL) {
  const host = target.hostname.replace(/^\[|\]$/g, "");
  return {
    host,
    port: Number(target.port || 443),
    // SNI must not be an IP address.
    servername: isIP(host) ? undefined : host,
  };
}

/** Handshake without trust checks and return the server certificate's SHA-256 fingerprint. */
function presentedFingerprint(target: URL, timeoutMs = 10_000): Promise<{ socket: TLSSocket; fingerprint: string }> {
  return new Promise((resolve, reject) => {
    const socket = tlsConnect({ ...tlsOptions(target), rejectUnauthorized: false });
    const timer = setTimeout(() => socket.destroy(new Error("TLS handshake timed out")), timeoutMs);
    socket.once("secureConnect", () => {
      clearTimeout(timer);
      const fingerprint = socket.getPeerCertificate()?.fingerprint256;
      if (!fingerprint) {
        socket.destroy();
        reject(new TlsTrustError("The server sent no certificate"));
        return;
      }
      resolve({ socket, fingerprint });
    });
    socket.once("error", error => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function errorCode(error: unknown): string | undefined {
  const err = error as { code?: string; cause?: { code?: string } };
  return err?.cause?.code ?? err?.code;
}

/** fetch() for an integration: pinned to a fingerprint when one is set. */
export function fetchFor(fingerprint: string | undefined): FetchLike {
  const pinned = fingerprint?.trim() ? normaliseFingerprint(fingerprint) : undefined;
  if (!pinned) return explainUntrusted;
  return (url, init) => pinnedFetch(pinned, url, init);
}

/** The global fetch, with a helpful error for an untrusted certificate. */
async function explainUntrusted(url: string, init?: FetchInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    const code = errorCode(error);
    if (!code || !UNTRUSTED_CODES.has(code) || !url.startsWith("https:")) throw error;
    let presented: string | undefined;
    try {
      const probe = await presentedFingerprint(new URL(url));
      probe.socket.destroy();
      presented = probe.fingerprint;
    } catch {
      // Keep the original problem if the probe fails too.
    }
    throw new TlsTrustError(
      `The service's HTTPS certificate is not trusted (${code})` +
        (presented ? `. To trust exactly this certificate, set the trusted certificate fingerprint to ${presented}` : ""),
      presented,
    );
  }
}

async function pinnedFetch(pinned: string, url: string, init: FetchInit = {}): Promise<Response> {
  const target = new URL(url);
  if (target.protocol !== "https:") return fetch(url, init);
  if (init.signal?.aborted) throw init.signal.reason ?? new Error("Aborted");

  // Verify the certificate before a single byte of the request is sent.
  const { socket, fingerprint } = await presentedFingerprint(target);
  if (fingerprint.toUpperCase() !== pinned) {
    socket.destroy();
    throw new TlsTrustError(
      `The service's HTTPS certificate does not match the trusted fingerprint (it now presents ${fingerprint}). ` +
        "If the certificate was renewed on purpose, update the trusted certificate fingerprint",
      fingerprint,
    );
  }

  const body = init.body === undefined ? undefined : String(init.body);
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.body instanceof URLSearchParams && !Object.keys(headers).some(h => h.toLowerCase() === "content-type")) {
    headers["Content-Type"] = "application/x-www-form-urlencoded;charset=UTF-8";
  }
  if (body !== undefined) headers["Content-Length"] = String(Buffer.byteLength(body));

  return new Promise<Response>((resolve, reject) => {
    // The already verified TLS socket carries the request (no agent, so no
    // second connection with its own certificate check is opened).
    const req = httpRequest(
      {
        host: target.hostname.replace(/^\[|\]$/g, ""),
        port: Number(target.port || 443),
        path: `${target.pathname}${target.search}`,
        method: init.method ?? "GET",
        headers: { Host: target.host, ...headers },
        createConnection: () => socket,
      },
      res => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("error", reject);
        res.on("end", () => {
          const out = new Headers();
          for (const [name, value] of Object.entries(res.headers)) {
            if (value === undefined) continue;
            for (const v of Array.isArray(value) ? value : [value]) out.append(name, v);
          }
          const status = res.statusCode ?? 502;
          const noBody = status === 204 || status === 304 || (init.method ?? "GET").toUpperCase() === "HEAD";
          resolve(new Response(noBody ? null : Buffer.concat(chunks), { status, statusText: res.statusMessage ?? "", headers: out }));
        });
      },
    );
    const timer = setTimeout(() => req.destroy(new Error(`Timed out after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS);
    req.on("close", () => clearTimeout(timer));
    req.on("error", reject);
    init.signal?.addEventListener("abort", () => req.destroy(init.signal?.reason ?? new Error("Aborted")), { once: true });
    if (body !== undefined) req.write(body);
    req.end();
  });
}
