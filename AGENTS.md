# AGENTS.md - mcp-arr

MCP server for the *arr media management suite (Sonarr, Radarr, Lidarr, Prowlarr), plus Tautulli, Overseerr, Bazarr and Maintainerr.

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
├── oauth.ts          # OAuth 2.1 server for Claude/OpenAI connectors (only with a publicly trusted cert)
├── tls.ts            # Built-in offline CA, BYO certificate files, ACME mode, renewal / hot reload
├── acme.ts           # ACME client (Let's Encrypt): http-01 listener, dns-01 via cloudflare / acme-dns / exec
├── settings.ts       # Settings editable in the web UI (definitions, env > saved > default, validation)
├── runtime.ts        # Builds TLS manager / OAuth / proxy trust from settings; "Test these settings"
├── admin-ui.ts       # Web UI page (single self-contained HTML string, no external assets)
├── security.ts       # Tool argument validation, confirmation, read-only list, URL checks, key redaction
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
| MAINTAINERR_URL | For Maintainerr | Base URL (e.g., http://localhost:6246) |
| MAINTAINERR_API_KEY | For Maintainerr | API key from Maintainerr Settings → General |
| ARR_READ_ONLY | No | `true` hides and blocks tools that change state |
| MCP_TRANSPORT | No | `stdio` (default) or `http` (HTTPS server + web UI) |
| PUBLIC_URL | HTTP mode | Browser URL, e.g. https://mcp-arr.home.lan:3000 (host name, not IP - passkeys). Also settable in the web UI (restarts in-process); unset = setup mode (temporary cert, passwords only) |
| PORT / HOST / MCP_PATH | No | Listen address and MCP path (default 3000 / 0.0.0.0 / /mcp) |
| TLS_MODE | No | `internal` (built-in CA, default), `file`, `acme` (Let's Encrypt), `off` |
| ACME_* | TLS_MODE=acme | `ACME_EMAIL`, `ACME_STAGING`, `ACME_DOMAINS`, `ACME_CHALLENGE` (http-01/dns-01), `ACME_HTTP_PORT`, `ACME_DNS_PROVIDER` (cloudflare/acme-dns/exec) + provider vars, `ACME_DIRECTORY_URL`, `ACME_EAB_*` - see README |
| TLS_SANS / TLS_CA_NAME_CONSTRAINTS | No | Extra certificate names / CA name constraints |
| TLS_CERT_FILE / TLS_KEY_FILE | TLS_MODE=file | Own certificate + key |
| CONFIG_PATH | No | Encrypted config file (HTTP default ./config/config.json, Docker /config/config.json) |
| CONFIG_ENCRYPTION_KEY(_FILE) | Recommended | Encryption passphrase (or file with it, e.g. Docker secret) |
| CONFIG_ENCRYPTION_KEY_PREVIOUS | No | Old passphrase, for key rotation |
| KEY_FILE_PATH | No | Fallback auto-generated key file (Docker /secrets/master.key) |
| ADMIN_RECOVERY | No | `true` prints a one-time code to register a new admin passkey |
| TRUST_PROXY | No | Use X-Forwarded-For for rate limiting |
| OAUTH | No | `auto` (default; on only with https PUBLIC_URL + public cert / proxy), `on`, `off` |
| OAUTH_ALLOWED_REDIRECT_HOSTS | No | Extra connector redirect hosts (default claude.ai, claude.com, chatgpt.com, openai.com) |

In HTTP mode, service env vars override values from the config file (shown read-only in the UI). The same holds for the server settings in `src/settings.ts` (TLS/ACME/DNS/OAuth/TRUST_PROXY): editable in the Settings tab, applied live without restart, env wins. When adding a setting, add it to `SETTING_DEFS`; startup-only or dangerous ones (e.g. `ACME_DNS_HOOK`) stay env-only (`STARTUP_KEYS`).

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

1. Add tool definition in appropriate `src/tools/{service}.ts`. If it changes state, add it to `WRITE_TOOLS` in `src/security.ts`
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
