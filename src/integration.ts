/**
 * Optional integrations: services next to the *arr apps (download clients,
 * transcoders, media servers, ...) that have their own HTTP API. Each one
 * lives in its own module under src/integrations/ and is listed in
 * src/integrations/index.ts. Nothing else needs to change to add one:
 *
 * - config-store.ts adds it to the service list, so its URL and credentials
 *   come from <ENV_PREFIX>_URL / <ENV_PREFIX>_<FIELD> or the web UI
 *   (encrypted config file), environment variables winning.
 * - http-server.ts shows it in the Services tab (one input per field) and
 *   uses getStatus() for the "Test" button.
 * - index.ts creates the configured ones, appends their tools, routes their
 *   calls after argument validation and read-only filtering, redacts their
 *   secret fields from errors and reports them in arr_status.
 * - stats.ts attributes their tool calls to them on the status board.
 *
 * Integrations must talk to the service over its HTTP API only.
 */

import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";

/** One credential/setting field next to the URL (API key, token, username, ...). */
export interface IntegrationField {
  /** Key in the stored config and in IntegrationConfig.values, e.g. "apiKey". */
  key: string;
  /** Label in the web UI, e.g. "API key". */
  label: string;
  /** Environment variable suffix: <ENV_PREFIX>_<envSuffix>, e.g. "API_KEY". */
  envSuffix: string;
  /** Secret fields are never sent back to the browser and are redacted from errors. */
  secret: boolean;
  /** The integration is enabled only when the URL and every required field are set. */
  required: boolean;
  /** Placeholder / hint in the web UI. */
  placeholder?: string;
}

/** The default single field: <ENV_PREFIX>_API_KEY, required. */
export const API_KEY_FIELD: IntegrationField = {
  key: "apiKey",
  label: "API key",
  envSuffix: "API_KEY",
  secret: true,
  required: true,
};

export interface IntegrationConfig {
  /** Base URL without trailing slash. */
  url: string;
  /** Field values by IntegrationField.key; optional fields may be undefined. */
  values: Record<string, string | undefined>;
}

export interface IntegrationStatus {
  version?: string;
}

/** A configured integration, created by IntegrationDefinition.create(). */
export interface IntegrationInstance {
  /** Tools to advertise. Names must start with "<name>_" and every tool must declare annotations. */
  tools: Tool[];
  /** Used by arr_status and the web UI "Test" button. Throws when the service cannot be reached. */
  getStatus(): Promise<IntegrationStatus>;
  /**
   * Handles a call to one of this integration's tools. The arguments have
   * already been checked against the tool's input schema, read-only mode and
   * `confirm` have already been applied. Thrown errors are redacted by index.ts.
   */
  callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult>;
}

export interface IntegrationDefinition {
  /** Lower-case service id, used as the tool name prefix, in arr_status and in the config file. */
  name: string;
  /** Shown in the web UI and arr_status description, e.g. "qBittorrent (Downloads)". */
  displayName: string;
  /** Environment variable prefix, e.g. "QBITTORRENT" for QBITTORRENT_URL. */
  envPrefix: string;
  /** Placeholder for the URL field, e.g. "http://localhost:8080". */
  exampleUrl: string;
  /** Fields next to the URL. Default: [API_KEY_FIELD]. An empty list means the URL alone enables it. */
  fields?: IntegrationField[];
  /** Hand-drawn SVG for the web UI: drawing about 130x110 centred on 0,0, shown in a 168x176 viewBox (see ICONS in admin-ui.ts). */
  icon?: string;
  /**
   * Destructive tools that must be called with `confirm: true`. They are also
   * treated as write tools.
   */
  confirmTools?: string[];
  /** Tools that change state (hidden and refused in read-only mode). */
  writeTools?: string[];
  create(config: IntegrationConfig): IntegrationInstance;
}

export function integrationFields(definition: { fields?: IntegrationField[] }): IntegrationField[] {
  return definition.fields ?? [API_KEY_FIELD];
}

/** True when the URL and every required field have a value. */
export function hasRequiredValues(
  fields: IntegrationField[],
  url: string | undefined,
  values: Record<string, string | undefined>,
): boolean {
  return Boolean(url) && fields.every(f => !f.required || Boolean(values[f.key]));
}

export interface LoadedIntegration extends IntegrationInstance {
  name: string;
  displayName: string;
}

/**
 * Creates the integration if it is configured. Throws when a tool name does
 * not carry the integration's prefix, so one integration cannot shadow another
 * integration's or a built-in tool.
 */
export function loadIntegration(
  definition: IntegrationDefinition,
  config: IntegrationConfig,
): LoadedIntegration {
  const instance = definition.create(config);
  for (const tool of instance.tools) {
    if (!tool.name.startsWith(`${definition.name}_`)) {
      throw new Error(`${definition.displayName} tool ${tool.name} must start with ${definition.name}_`);
    }
  }
  return { ...instance, name: definition.name, displayName: definition.displayName };
}

export function jsonText(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}
