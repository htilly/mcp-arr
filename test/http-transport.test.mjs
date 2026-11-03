import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";

// Regression test for the HTTP transport. mcp-arr runs HTTP in *stateless* mode
// (a fresh transport per request, no Mcp-Session-Id issued) so that MCP clients
// which do not echo a session header back — e.g. Claude Code — work. Prior to
// 1.6.5 the server ran stateful and rejected any post-initialize request that
// omitted the session header with `400 Mcp-Session-Id header is required`.
test("HTTP transport serves clients that omit the session header (stateless)", async () => {
  const port = String(33000 + Math.floor(Math.random() * 1000));
  const child = spawn(process.execPath, ["dist/index.js"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      MCP_TRANSPORT: "http",
      HOST: "127.0.0.1",
      PORT: port,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });

  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  try {
    await waitForHealth(port);

    // initialize WITHOUT any session id (a stateless client)
    const initializeResponse = await postMcp(port, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "mcp-arr-test", version: "0.0.0" },
      },
    });
    assert.equal(initializeResponse.status, 200);

    // tools/list WITHOUT the Mcp-Session-Id header — the exact request the old
    // stateful transport rejected with 400. Must now succeed.
    const toolsResponse = await postMcp(port, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    assert.equal(
      toolsResponse.status,
      200,
      "a post-initialize request without a session header must succeed in stateless mode",
    );
    const body = await toolsResponse.text();
    assert.match(body, /"tools"/);
    assert.doesNotMatch(body, /Mcp-Session-Id header is required/);
    assert.doesNotMatch(body, /Stateless transport cannot be reused/);

    // a second independent request must also succeed (the shared server is
    // reconnected to a fresh transport per request)
    const secondResponse = await postMcp(port, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/list",
      params: {},
    });
    assert.equal(secondResponse.status, 200);
  } finally {
    child.kill("SIGTERM");
    await once(child, "exit").catch(() => {});
  }

  assert.doesNotMatch(stderr, /Fatal error/);
});

async function waitForHealth(port) {
  const deadline = Date.now() + 5000;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) {
        return;
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`HTTP server did not become healthy: ${lastError}`);
}

function postMcp(port, payload, sessionId) {
  return fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
    },
    body: JSON.stringify(payload),
  });
}
