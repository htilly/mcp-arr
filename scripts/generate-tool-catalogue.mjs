#!/usr/bin/env node
// Regenerates tools.json and docker-registry/tools.json: the tools advertised
// with every service in server.json configured. Listing tools makes no API
// calls, so the URLs are unreachable placeholders. Run after `npm run build`:
//   node scripts/generate-tool-catalogue.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = new URL("..", import.meta.url);
const serverJson = JSON.parse(readFileSync(new URL("server.json", root), "utf8"));
const names = serverJson.packages.flatMap((pkg) => pkg.environmentVariables ?? []).map((v) => v.name);

const env = { PATH: process.env.PATH, MCP_TRANSPORT: "stdio" };
for (const name of names) {
  const prefix = name.match(/^([A-Z]+)_URL$/)?.[1];
  if (prefix && names.includes(`${prefix}_API_KEY`)) {
    env[`${prefix}_URL`] = "http://127.0.0.1:9";
    env[`${prefix}_API_KEY`] = "catalogue";
  }
}

const client = new Client({ name: "tool-catalogue", version: "1.0.0" });
await client.connect(new StdioClientTransport({
  command: process.execPath,
  args: [new URL("dist/index.js", root).pathname],
  env,
  stderr: "ignore",
}));
const { tools } = await client.listTools();
await client.close();

const text = `${JSON.stringify(tools, null, 2)}\n`;
for (const file of ["tools.json", "docker-registry/tools.json"]) {
  writeFileSync(new URL(file, root), text);
}
console.error(`Wrote ${tools.length} tools to tools.json and docker-registry/tools.json`);
