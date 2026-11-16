import assert from "node:assert/strict";
import test from "node:test";
import { loadIntegrations } from "../dist/integration.js";

const READ_ONLY = { readOnlyHint: true, openWorldHint: true };

function definition(toolName = "demo_status") {
  return {
    name: "demo",
    displayName: "Demo",
    envPrefix: "DEMO",
    create: (config) => ({
      config,
      tools: [{ name: toolName, annotations: READ_ONLY, inputSchema: { type: "object", properties: {} } }],
      getStatus: async () => ({ version: "1" }),
      callTool: async () => ({ content: [] }),
    }),
  };
}

test("integrations load only when both URL and API key are set", () => {
  assert.deepEqual(loadIntegrations([definition()], {}), []);
  assert.deepEqual(loadIntegrations([definition()], { DEMO_URL: "http://127.0.0.1:1" }), []);
  const [loaded] = loadIntegrations([definition()], { DEMO_URL: "http://127.0.0.1:1", DEMO_API_KEY: "k" });
  assert.equal(loaded.name, "demo");
  assert.equal(loaded.displayName, "Demo");
  assert.equal(loaded.apiKey, "k");
  assert.deepEqual(loaded.config, { url: "http://127.0.0.1:1", apiKey: "k" });
});

test("integrations reject malformed URLs and unprefixed tool names", () => {
  assert.throws(
    () => loadIntegrations([definition()], { DEMO_URL: "localhost:1", DEMO_API_KEY: "k" }),
    /DEMO_URL must be a full http/,
  );
  assert.throws(
    () => loadIntegrations([definition("status")], { DEMO_URL: "http://127.0.0.1:1", DEMO_API_KEY: "k" }),
    /must start with demo_/,
  );
});
