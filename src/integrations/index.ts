// Optional integrations, in the order their tools are listed. See ../integration.ts.
import type { IntegrationDefinition } from "../integration.js";
import { overseerr } from "./overseerr.js";

export const INTEGRATIONS: IntegrationDefinition[] = [
  overseerr,
];
