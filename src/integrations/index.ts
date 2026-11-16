// Optional integrations, in the order their tools and Services cards are listed.
// See ../integration.ts. To add one: create ./<name>.ts exporting an
// IntegrationDefinition and add it to this list.
import type { IntegrationDefinition } from "../integration.js";
import { plex } from "./plex.js";
import { qbittorrent } from "./qbittorrent.js";
import { sabnzbd } from "./sabnzbd.js";
import { tdarr } from "./tdarr.js";

export const INTEGRATIONS: IntegrationDefinition[] = [
  plex,
  qbittorrent,
  sabnzbd,
  tdarr,
];
