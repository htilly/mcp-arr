// Container healthcheck for mcp-arr: GET /health on the local listener.
//
// Deliberately not BusyBox wget. The image is Alpine-based, so `wget` is
// BusyBox, and its HTTPS path forks an `ssl_client` helper. That helper
// outlives wget, is reparented to PID 1, and with node as PID 1 nothing reaps
// it - so each healthcheck left one zombie behind (one per interval, forever).
// node is already in the image, so this costs no extra layer.

// stdio mode has no listener to probe, so there is nothing to check.
if ((process.env.MCP_TRANSPORT || "stdio").toLowerCase() !== "http") {
  process.exit(0);
}

const port = Number(process.env.PORT) || 3000;
// TLS_MODE=off serves plain HTTP behind a TLS-terminating reverse proxy.
const plain = (process.env.TLS_MODE || "").toLowerCase() === "off";
const { request } = await import(plain ? "node:http" : "node:https");

const req = request(
  {
    host: "127.0.0.1",
    port,
    path: "/health",
    timeout: 5000,
    // The built-in CA issues the server's own certificate, and this probe
    // talks to 127.0.0.1 and sends no credentials, so verification would only
    // mean teaching the probe about the CA for no gain.
    rejectUnauthorized: false,
  },
  (res) => {
    res.resume();
    process.exit(res.statusCode === 200 ? 0 : 1);
  },
);

req.on("error", () => process.exit(1));
req.on("timeout", () => {
  req.destroy();
  process.exit(1);
});
req.end();
