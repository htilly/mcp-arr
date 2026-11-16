/**
 * Optional integrations: services next to the *arr apps (subtitles, requests,
 * Plex monitoring, ...) that use their own APIs. Each one lives in its own
 * module under src/integrations/ and is listed in src/integrations/index.ts.
 * index.ts only loads the configured ones, adds their tools, routes their tool
 * calls and reports them in arr_status, /health and the startup log.
 *
 * An integration is enabled by setting both <ENV_PREFIX>_URL and
 * <ENV_PREFIX>_API_KEY, so nothing changes for anyone who does not set them.
 */

import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { validateServiceUrl } from "./security.js";

export interface IntegrationConfig {
  url: string;
  apiKey: string;
}

export interface IntegrationStatus {
  version?: string;
}

/** A configured integration, created by IntegrationDefinition.create(). */
export interface IntegrationInstance {
  /** Tools to advertise. Every tool must declare annotations. */
  tools: Tool[];
  /** Used by arr_status. Throws when the service cannot be reached. */
  getStatus(): Promise<IntegrationStatus>;
  /**
   * Handles a call to one of this integration's tools. The arguments have
   * already been checked against the tool's input schema, and read-only mode
   * has already been applied. Errors are caught and redacted by index.ts.
   */
  callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult>;
}

export interface IntegrationDefinition {
  /** Lower-case service name, used as the tool name prefix and in arr_status. */
  name: string;
  displayName: string;
  /** Environment variable prefix, e.g. "BAZARR" for BAZARR_URL and BAZARR_API_KEY. */
  envPrefix: string;
  create(config: IntegrationConfig): IntegrationInstance;
}

export interface LoadedIntegration extends IntegrationInstance {
  name: string;
  displayName: string;
  apiKey: string;
}

/**
 * Creates every integration whose URL and API key are both set. Throws on a
 * malformed URL, like the *arr services, before any request can be made.
 */
export function loadIntegrations(
  definitions: IntegrationDefinition[],
  env: NodeJS.ProcessEnv,
): LoadedIntegration[] {
  const loaded: LoadedIntegration[] = [];
  for (const definition of definitions) {
    const url = env[`${definition.envPrefix}_URL`];
    const apiKey = env[`${definition.envPrefix}_API_KEY`];
    if (!url || !apiKey) continue;
    validateServiceUrl(`${definition.envPrefix}_URL`, url);
    const instance = definition.create({ url, apiKey });
    for (const tool of instance.tools) {
      if (!tool.name.startsWith(`${definition.name}_`)) {
        throw new Error(`${definition.displayName} tool ${tool.name} must start with ${definition.name}_`);
      }
    }
    loaded.push({ ...instance, name: definition.name, displayName: definition.displayName, apiKey });
  }
  return loaded;
}

export function jsonText(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

export function textError(message: string): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}
