import { readFileSync } from "node:fs";

// Every service the server can be configured with, taken from the *_URL
// variables in server.json, so the shared tests also cover optional
// integrations (src/integrations/) without listing them here.
const serverJson = JSON.parse(readFileSync(new URL("../../server.json", import.meta.url), "utf8"));
const variables = serverJson.packages.flatMap((pkg) => pkg.environmentVariables ?? []);

export const BUILT_IN_SERVICES = ["SONARR", "RADARR", "LIDARR", "PROWLARR"];
export const SERVICES = variables
  .map((variable) => variable.name.match(/^([A-Z]+)_URL$/)?.[1])
  .filter((prefix) => prefix && variables.some((variable) => variable.name === `${prefix}_API_KEY`));
export const INTEGRATIONS = SERVICES.filter((prefix) => !BUILT_IN_SERVICES.includes(prefix));
