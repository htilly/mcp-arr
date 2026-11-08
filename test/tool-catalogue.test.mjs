import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";

const services = ["sonarr", "radarr", "lidarr", "prowlarr"];
const configurations = [[], ...services.map((service) => [service]), services];

for (const configured of configurations) {
  const label = configured.join(", ") || "TRaSH-only";
  test(`tools/list advertises unique names (${label})`, async (t) => {
    // Use stdio: this fork's HTTP mode requires HTTPS and per-user tokens.
    const env = { ...process.env, MCP_TRANSPORT: "stdio", ARR_READ_ONLY: "" };
    // Never inherit real service configuration or contact a live *arr instance.
    // Listing tools only requires that a URL and API key are configured.
    for (const service of [...services, "bazarr", "tautulli", "overseerr"]) {
      const prefix = service.toUpperCase();
      env[`${prefix}_URL`] = configured.includes(service) ? "http://127.0.0.1:1" : "";
      env[`${prefix}_API_KEY`] = configured.includes(service) ? "test-key" : "";
    }

    const child = spawn(process.execPath, ["dist/index.js"], {
      cwd: new URL("..", import.meta.url),
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const exited = once(child, "exit");
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    try {
      const message = await listTools(child);
      assert.equal(message.error, undefined);
      const names = message.result.tools.map((tool) => tool.name);
      assert.ok(names.length > 0);
      assert.ok(names.every((name) => typeof name === "string" && name.trim().length > 0));
      const duplicates = [...new Set(names.filter((name, index) => names.indexOf(name) !== index))];
      t.diagnostic(`${names.length} tools, ${new Set(names).size} unique names`);
      assert.deepEqual(duplicates, [], "duplicate tool names advertised");

      // Removing duplicate registrations must not remove the tools themselves.
      for (const service of ["sonarr", "radarr", "lidarr"]) {
        for (const action of ["get_quality_profiles", "get_root_folders"]) {
          const name = `${service}_${action}`;
          assert.equal(
            names.filter((toolName) => toolName === name).length,
            configured.includes(service) ? 1 : 0,
            name,
          );
        }
      }
      assert.equal(
        names.filter((name) => name === "lidarr_get_metadata_profiles").length,
        configured.includes("lidarr") ? 1 : 0,
        "lidarr_get_metadata_profiles",
      );
    } finally {
      child.kill("SIGTERM");
      await exited;
    }

    assert.doesNotMatch(stderr, /Fatal error/);
  });
}

async function listTools(child) {
  child.stdout.setEncoding("utf8");
  let buffer = "";
  const response = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no tools/list response within 5s")), 5000);
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      for (const line of buffer.split("\n")) {
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === 2) { clearTimeout(timer); resolve(msg); }
      }
    });
  });
  const send = (msg) => child.stdin.write(JSON.stringify(msg) + "\n");
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "0" } } });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  return response;
}
