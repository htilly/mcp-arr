// Optional integrations, in the order their tools are listed. See ../integration.ts.
import type { IntegrationDefinition } from "../integration.js";
import { bazarr } from "./bazarr.js";

export const INTEGRATIONS: IntegrationDefinition[] = [
  bazarr,
];
