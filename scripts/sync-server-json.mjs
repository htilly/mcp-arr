#!/usr/bin/env node
/**
 * Sync server.json's version fields with package.json.
 *
 * server.json is the MCP registry manifest. It is plain JSON, so unlike
 * SERVER_VERSION in src/index.ts it cannot read package.json at runtime — it
 * has to be written at bump time. This runs from the npm "version" lifecycle
 * script so `npm version patch|minor|major` keeps the two in step without
 * anyone having to remember.
 *
 * Exits non-zero on failure so a broken sync fails the release rather than
 * silently shipping a stale manifest.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = join(repoRoot, "package.json");
const serverPath = join(repoRoot, "server.json");

const { version } = JSON.parse(readFileSync(pkgPath, "utf8"));
if (!version) {
  console.error("sync-server-json: package.json has no version field");
  process.exit(1);
}

const raw = readFileSync(serverPath, "utf8");
const server = JSON.parse(raw);

const before = [server.version, ...(server.packages ?? []).map((p) => p.version)];

server.version = version;
for (const pkg of server.packages ?? []) {
  pkg.version = version;
}

// Preserve the file's trailing newline convention.
const output = `${JSON.stringify(server, null, 2)}\n`;
writeFileSync(serverPath, output);

const stale = before.filter((v) => v !== version);
if (stale.length > 0) {
  console.log(
    `sync-server-json: server.json ${stale.join(", ")} -> ${version}`,
  );
} else {
  console.log(`sync-server-json: server.json already at ${version}`);
}
