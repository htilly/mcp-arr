// Optional integrations, in the order their tools are listed. See ../integration.ts.
import type { IntegrationDefinition } from "../integration.js";
import { tautulli } from "./tautulli.js";

export const INTEGRATIONS: IntegrationDefinition[] = [
  tautulli,
];
