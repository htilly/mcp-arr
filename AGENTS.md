# AGENTS.md - mcp-arr

MCP server for the *arr media management suite (Sonarr, Radarr, Lidarr, Prowlarr), plus Tautulli, Overseerr and Bazarr.

## Tech Stack

- **Language:** TypeScript
- **Runtime:** Node.js (ES modules)
- **Protocol:** Model Context Protocol (MCP)
- **Build:** TypeScript compiler (tsc)

## Architecture

```
src/
├── index.ts          # Server entry point, tool registration (applyConfig/buildTools/buildServer)
├── http-server.ts    # HTTP(S) mode: /mcp (stateless Streamable HTTP), /admin API with roles, /ca.crt
├── auth.ts           # Passkey (WebAuthn) registration/login, sessions, setup/recovery codes
├── tls.ts            # Built-in offline CA, BYO certificate files, renewal / hot reload
├── admin-ui.ts       # Web UI page (single self-contained HTML string, no external assets)
├── config-store.ts   # Encrypted config file (AES-256-GCM), env merge, users/tokens/invites
├── tools/            # Tool implementations by service
│   ├── sonarr.ts     # TV show management
│   ├── radarr.ts     # Movie management
│   ├── lidarr.ts     # Music management
│   └── prowlarr.ts   # Indexer management
└── types.ts          # Shared TypeScript types
```

## Development Commands

```bash
# Build
npm run build

# Watch mode
npm run watch

# Test locally (requires env vars)
node dist/index.js
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| SONARR_URL | For Sonarr | Base URL (e.g., http://localhost:8989) |
| SONARR_API_KEY | For Sonarr | API key from Sonarr settings |
| RADARR_URL | For Radarr | Base URL |
| RADARR_API_KEY | For Radarr | API key |
| LIDARR_URL | For Lidarr | Base URL |
| LIDARR_API_KEY | For Lidarr | API key |
| PROWLARR_URL | For Prowlarr | Base URL |
| PROWLARR_API_KEY | For Prowlarr | API key |
| BAZARR_URL | For Bazarr | Base URL (e.g., http://localhost:6767) |
| BAZARR_API_KEY | For Bazarr | API key from Bazarr settings |
| MCP_TRANSPORT | No | `stdio` (default) or `http` (HTTPS server + web UI) |
| PUBLIC_URL | HTTP mode | Browser URL, e.g. https://mcp-arr.home.lan:3000 (host name, not IP - passkeys) |
| PORT / HOST / MCP_PATH | No | Listen address and MCP path (default 3000 / 0.0.0.0 / /mcp) |
| TLS_MODE | No | `internal` (built-in CA, default), `file`, `off` |
| TLS_SANS / TLS_CA_NAME_CONSTRAINTS | No | Extra certificate names / CA name constraints |
| TLS_CERT_FILE / TLS_KEY_FILE | TLS_MODE=file | Own certificate + key |
| CONFIG_PATH | No | Encrypted config file (HTTP default ./config/config.json, Docker /config/config.json) |
| CONFIG_ENCRYPTION_KEY(_FILE) | Recommended | Encryption passphrase (or file with it, e.g. Docker secret) |
| CONFIG_ENCRYPTION_KEY_PREVIOUS | No | Old passphrase, for key rotation |
| KEY_FILE_PATH | No | Fallback auto-generated key file (Docker /secrets/master.key) |
| ADMIN_RECOVERY | No | `true` prints a one-time code to register a new admin passkey |
| TRUST_PROXY | No | Use X-Forwarded-For for rate limiting |

In HTTP mode, service env vars override values from the config file (shown read-only in the UI).

## Constraints

```yaml
rules:
  - id: no-hardcoded-urls
    description: Never hardcode service URLs or API keys
    check: All service access via environment variables

  - id: consistent-tool-naming
    description: Tool names follow pattern {service}_{action}
    examples:
      - sonarr_get_series
      - radarr_search
      - lidarr_get_albums

  - id: error-handling
    description: All API calls must handle errors gracefully
    requirements:
      - Check for missing env vars before API call
      - Return meaningful error messages
      - Don't expose raw API errors to users

  - id: trash-guides-integration
    description: TRaSH Guides tools use embedded guide data
    note: Guide data fetched from trash-guides.info at runtime
```

## Common Tasks

### Adding a New Tool

1. Add tool definition in appropriate `src/tools/{service}.ts`
2. Register in `src/index.ts` tool list
3. Update README.md "Available Tools" section
4. Update CHANGELOG.md

### Testing Changes

```bash
# Build first
npm run build

# Test with timeout (needs env vars set)
timeout 10 node dist/index.js
```

### Publishing

1. Update CHANGELOG.md
2. `npm version patch|minor|major`
3. `git push && git push --tags`
4. `npm publish`

## API Patterns

All *arr services follow similar REST patterns:
- GET `/api/v3/{resource}` - List all
- GET `/api/v3/{resource}/{id}` - Get one
- POST `/api/v3/{resource}` - Create
- PUT `/api/v3/{resource}/{id}` - Update
- DELETE `/api/v3/{resource}/{id}` - Delete
- POST `/api/v3/command` - Trigger actions (search, refresh, etc.)

## Pre-Publish

Run `/publish-mcp` before any `npm publish` — mandatory pipeline that handles tests, secret scan, sanitize, docs check, version bump, tag, push, and publish in strict order. Do not run `npm publish` directly.
