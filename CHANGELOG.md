# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed
- **BREAKING (HTTP mode):** `MCP_TRANSPORT=http` now serves **HTTPS with authentication**. It requires `PUBLIC_URL` and a writable `CONFIG_PATH`, and every MCP request needs a per-user access token created in the web UI. Existing unauthenticated plain-HTTP setups (e.g. n8n pointing at `http://host:3000/mcp`) must be updated - see README "Remote server". `TLS_MODE=off` keeps plain HTTP for use behind a TLS-terminating reverse proxy, but tokens are still required. stdio mode is unchanged.
- **Deploy workflow** (`deploy.yml`): the post-deploy check now works with the authenticated HTTPS server. It accepts `200` (older unauthenticated image, e.g. after a rollback) or `401` + `WWW-Authenticate: Bearer` (auth enforced), and, when `MCP_CHECK_TOKEN` is set on the runner, also runs an authenticated `initialize` over verified HTTPS (`MCP_ARR_CA_FILE`). An untrusted certificate falls back to an unverified liveness check with a warning (the token is never sent over it), and the rollback step also accepts a plain-HTTP older image behind an `https://` `APP_URL`. When the check fails it names the likely cause from curl's exit code (host does not resolve, connection refused, timeout, http/https scheme mismatch, untrusted certificate) without printing any host name. Responses and the token are never printed. The host compose file must run the HTTPS mode - see README "Self-hosted deploy".
- **Synced with upstream `aplaceforallmystuff/mcp-arr` v1.7.3.** Fork-only features are kept; where both sides changed the same tool, the result is a superset:
  - `sonarr_get_series` and `radarr_get_movies` accept upstream's `limit` / `offset` / `search` **and** the fork's `sortBy` / `sortDir`. Sorting is applied before pagination. **Behaviour change for fork users:** `limit` now defaults to 25 (max 100) instead of returning everything, and the response uses upstream's pagination fields (`total`, `returned`, `hasMore`, `nextOffset`, ...) instead of `totalCount` / `count` / `limitedTo`.
  - The server starts in TRaSH-only mode when nothing is configured, instead of exiting.
  - Readarr support is gone (removed upstream in 1.6.1); the Readarr tools no longer exist.

### Added
- **Web UI: Settings tab** (admins). Certificate mode (built-in CA / Let's Encrypt / own files / reverse proxy) and all certificate, ACME, DNS-provider (Cloudflare, acme-dns), OAuth and `TRUST_PROXY` settings can be changed in the browser and are **applied live without a restart** - including switching the listener between HTTPS and plain HTTP on the same port. **Test these settings** checks the form without applying it and shows a live log; for Let's Encrypt it requests a real test certificate from Let's Encrypt staging. Values are stored in the encrypted config file, secrets are never sent back to the browser, environment variables still win (shown read-only). Switching to Let's Encrypt keeps serving the current certificate until the new one is issued. `ACME_DNS_HOOK`, `PUBLIC_URL`, `PORT`, `HOST` and `MCP_PATH` stay environment-only.
- Docker image: `TLS_MODE` is no longer preset in the image (so it can be managed in the UI; the default is still `internal`), and the http-01 port default of 8080 comes from `MCP_ARR_DOCKER=1`.
- **`TLS_MODE=acme`: built-in Let's Encrypt** (or any ACME CA) for HTTP mode. A publicly trusted certificate is obtained and renewed automatically (when a third of its lifetime is left) and hot-swapped without a restart - no root certificate to install, and OAuth for Claude/ChatGPT connectors turns on by itself. Two ways to validate: **http-01** for servers reachable from the internet (a small listener on `ACME_HTTP_PORT` answers the check and redirects everything else to https) and **dns-01** for **LAN-only servers** and wildcards, with the providers `cloudflare` (API token), `acme-dns` (one-time CNAME, works with every DNS provider without handing out DNS credentials; the CNAME to create is shown in the log and the Certificates tab) and `exec` (your own script, lego-compatible). Also: `ACME_STAGING`, `ACME_DOMAINS`, `ACME_DIRECTORY_URL` with external account binding (ZeroSSL, step-ca ...), `ACME_PROFILE`. Account, certificate keys and acme-dns credentials are stored in the encrypted config. Failed requests back off from 15 minutes to 12 hours to respect rate limits. No new dependencies; tested end-to-end against Pebble in CI.
- Web UI: **live status board** on the Services tab. Every MCP tool call is counted per connection (Sonarr, Radarr, ... and "Claude tools" for TRaSH/search/status), per tool and per user: calls today / all time, success rate, average response time, a 24-hour chart, a live feed and the most-used tools (admins also see "Who is asking"; other users only see their own name). Calls stream in live over Server-Sent Events (`/admin/api/activity`) and animate on the hub sketch: ink flows along the arrow while a call runs, the brain wiggles, and the service hops with a "+1" (or shakes with a "!" on failure). Honours "reduce motion". Totals are kept in `stats.json` next to the config file (counts only - never tool arguments or results).
- Web UI: **My activity** tab for every user: personal calls today / all time, success rate, calls per connection, a 30-day chart with streaks, calls per app (access token or connected app; OAuth tokens are grouped by client name), favourite tools, recent calls (live), and sign-ins (count, method, last 20 with browser/OS, and a warning when wrong passwords were entered for the account). Deleting a user removes their personal statistics.
- Web UI: **Brand** tab - a brand guide for the sketchbook look: logo usage (light/dark, clear space, don'ts) with SVG download, colour palette with light and dark values (click to copy), typography, shapes and lines, service illustrations, components, motion (with a demo), voice and copyable CSS design tokens.
- **OAuth 2.1 sign-in for Claude and OpenAI/ChatGPT connectors** (HTTP mode). Connectors register themselves (dynamic client registration), send the user to the web UI to sign in with their passkey/password and approve, and then use short-lived access tokens with rotating refresh tokens (PKCE S256 required). Tokens appear as `OAuth: <client>` under "Access tokens" and can be revoked. Enabled automatically (`OAUTH=auto`) only when an https `PUBLIC_URL` is combined with a publicly trusted certificate setup (`TLS_MODE=file` with a non-self-signed certificate covering the host, or `TLS_MODE=off` behind a proxy); never with the built-in CA. New settings `OAUTH` (`auto|on|off`) and `OAUTH_ALLOWED_REDIRECT_HOSTS`. `/mcp` 401 responses now carry `resource_metadata` for discovery; manual tokens keep working.
- Web UI: phone layout. The page detects a narrow screen (and touch input) and adapts: swipeable tab row, a separate phone version of the Services sketch, tables that turn into stacked rows with the column name on each line, full-width buttons, 44 px touch targets and 16 px inputs (no zoom on iOS), and safe-area padding for notches.
- Web UI: simple **name + password** sign-in as an alternative to passkeys. Available in setup, recovery and invite flows, and under "My sign-in" for existing users (set / change / remove). Passwords are scrypt-hashed, minimum 8 characters, rate-limited like other sign-in attempts. User names are now unique (case-insensitive). The UI works on pages where passkeys are unavailable (untrusted certificate).

### Fixed
- Passkey errors in the web UI now show the browser's error name/message and a hint about the usual cause (untrusted root certificate, wrong host name) instead of only "cancelled or timed out".
- `@modelcontextprotocol/sdk` is a runtime dependency again (as upstream). It sat in `devDependencies`, so a production install (`npm ci --omit=dev`, as the Dockerfile does) left it out and the container crashed on start with `ERR_MODULE_NOT_FOUND`.
- `radarr_get_movies` reads `rating` / `ratingVotes` from the TMDB entry of Radarr's per-source `ratings` map. It read `ratings.value`, which does not exist on a Radarr movie, so the rating was never populated. The per-source `ratings` map from upstream is returned alongside.

### Added
- **Remote HTTPS server + web UI** (`MCP_TRANSPORT=http`, `PUBLIC_URL`), designed for networks without internet access:
  - Streamable HTTP MCP endpoint (`MCP_PATH`, default `/mcp`) over HTTPS, still stateless (fresh server per request, no session id) so Claude Code works
  - Built-in offline certificate authority (`TLS_MODE=internal`): name-constrained root CA, server certificate auto-renewed and hot-swapped; or bring your own certificate (`TLS_MODE=file`, reloaded on change), or `TLS_MODE=off` behind a reverse proxy
  - Whole config file encrypted at rest (AES-256-GCM): API keys, users, passkeys, token hashes, CA keys. Key from `CONFIG_ENCRYPTION_KEY` / `CONFIG_ENCRYPTION_KEY_FILE` (Docker secret) or an auto-generated key file (with warning); key migration and rotation (`CONFIG_ENCRYPTION_KEY_PREVIOUS`)
  - Per-user login with passkeys (WebAuthn), roles admin/user, single-use invite links, multiple passkeys per user, `ADMIN_RECOVERY` for lost passkeys
  - Per-user MCP access tokens (`Authorization: Bearer` or `?token=`), revoked when the user is deleted
  - Web UI: services (with connection test; tools reload live, no restart), users & invites, tokens, passkeys, certificates (download + install guide), security status
  - `docker-compose.yml` example with Docker secret; Dockerfile with `/config` and `/secrets` volumes
- Node.js 20+ is now required
- **Bazarr (subtitles) integration** – optional, enabled with `BAZARR_URL` + `BAZARR_API_KEY`; server can run with only Bazarr configured:
  - `bazarr_status`, `bazarr_get_health`, `bazarr_get_badges` – System status, health, missing-subtitle counts
  - `bazarr_get_series`, `bazarr_get_episodes`, `bazarr_get_movies` – Subtitle status per series/episode/movie
  - `bazarr_get_wanted_episodes`, `bazarr_get_wanted_movies` – Items missing subtitles
  - `bazarr_get_history` – Subtitle history (episodes or movies)
  - `bazarr_search_series`, `bazarr_search_movie` – Search missing subtitles
  - `bazarr_download_episode_subtitle`, `bazarr_download_movie_subtitle` – Download a subtitle in a specific language
  - `bazarr_get_providers`, `bazarr_reset_providers` – Provider status and reset throttling
  - `bazarr_get_languages` – Enabled languages and language profiles
  - `arr_status` now reports Bazarr connection status
- **Ratings and IMDB IDs in tool responses** (from connected *arr services):
  - `radarr_get_movies` and `radarr_search` now include `imdbId`, `rating` (TMDB), `ratingVotes`, and `ratingSource: 'tmdb'`
  - `sonarr_get_series` now includes `imdbId`, `rating` (TVDB), `ratingVotes`, and `ratingSource: 'tvdb'`
- **Tautulli (Plex) integration** – optional; server can run with only Tautulli configured:
  - `tautulli_get_activity` – Current Plex activity (now playing)
  - `tautulli_get_history` – Watch history (optional filters)
  - `tautulli_get_libraries` – Plex libraries
  - `tautulli_get_server_info` – Plex server info
  - `tautulli_get_home_stats` – Home stats (plays, duration)
  - `tautulli_get_users` – Plex users
  - `tautulli_get_recently_added` – Recently added media
  - `tautulli_server_status` – Tautulli/Plex server status
  - `tautulli_terminate_session` – Terminate a streaming session
- **Delete tools** for Radarr and Sonarr:
  - `radarr_delete_movie` – Delete a movie (optionally delete files from disk, add import exclusion)
  - `sonarr_delete_series` – Delete a whole series (optionally delete files, add import list exclusion)
  - `sonarr_delete_season` – Delete all episode files for a specific season
  - `sonarr_delete_episode_files` – Delete specific episode file(s) by episode file ID
- `sonarr_get_episodes` response now includes `episodeFileId` (when the episode has a file) for use with `sonarr_delete_episode_files`
- **Sorting options** for `sonarr_get_series` and `radarr_get_movies`:
  - `sortDir` parameter: 'asc' (ascending) or 'desc' (descending)
  - Default: 'asc' for dateAdded, 'desc' for sizeOnDisk
- **Overseerr integration** – request management for Plex:
  - `overseerr_get_requests` – List media requests with status, requester, and media details
  - `overseerr_get_request_count` – Get request counts by status
  - `overseerr_get_users` – List Overseerr users with request counts
  - `overseerr_get_user_requests` – Get all requests made by a specific user
  - `overseerr_approve_request` – Approve a pending media request
  - `overseerr_decline_request` – Decline a pending media request
  - `overseerr_search` – Search for movies and TV shows (uses TMDB)
  - `overseerr_status` – Get Overseerr server status and version

## [1.7.3] - 2026-07-29

### Fixed
- **Server no longer reports a stale version to clients.** `SERVER_VERSION` was hardcoded to `1.6.3` and had not been updated for three releases, so every client saw `1.6.3` in the `initialize` response regardless of the version actually running. It is now read from `package.json` at startup, which cannot drift. Falls back to `0.0.0-unknown` with a diagnostic on stderr if the file is unreadable, rather than failing startup.
- **`server.json` no longer drifts from the released version.** The MCP registry manifest was also stuck at `1.6.3`, in both its top-level `version` and its npm package entry. Because it is plain JSON it cannot read `package.json` at runtime, so it is now rewritten at bump time by `scripts/sync-server-json.mjs`, wired into the npm `version` lifecycle script. Running `npm version patch|minor|major` keeps the manifest in step automatically.

### Documentation
- Documented `sonarr_refresh_series` and `radarr_refresh_movie` in the README tool tables. Both shipped in 1.6.1 (via [#9](https://github.com/aplaceforallmystuff/mcp-arr/pull/9)) but were never listed, leaving 43 of 45 tools documented.

### Security
- Bumped `@modelcontextprotocol/sdk` from 1.29.0 to **1.30.0** and refreshed `package-lock.json` to clear seven Dependabot advisories in transitive dependencies. All were pulled in via the SDK; none are direct dependencies of this project, and none are reachable from the code paths this server uses (it imports only `Server`, `StdioServerTransport` and `StreamableHTTPServerTransport`, and builds its own listener on `node:http`). The lockfile still matters because the Docker image installs with `npm ci`.
  - `fast-uri` 3.1.2 → **3.1.4** (via `ajv`) — host confusion via literal backslash authority delimiter (GHSA-v2hh-gcrm-f6hx, high) and via failed IDN canonicalization (GHSA-4c8g-83qw-93j6, high).
  - `hono` 4.12.26 → **4.12.32** — server-side XSS via JSX escaping bypass in `cx()` (GHSA-w62v-xxxg-mg59), `hono/jsx` cross-request context disclosure (GHSA-hvrm-45r6-mjfj), and API Gateway v1 adapter dropping a repeated request header during de-duplication (GHSA-xgm2-5f3f-mvvc). This server uses no JSX and no Lambda adapter.
  - `@hono/node-server` 1.19.14 → **2.0.12** — `serve-static` path traversal on Windows via encoded backslash `%5C` (GHSA-frvp-7c67-39w9). Required the SDK bump: 1.29.0 pinned `^1.19.9`, which cannot reach the patched 2.0.5; 1.30.0 widens the range to `^1.19.9 || ^2.0.5`. This server does not use `serve-static`.
  - `body-parser` 2.2.2 → **2.3.0** (via `express`) — denial of service when an invalid limit value silently disables size enforcement (GHSA-v422-hmwv-36x6). This server does not use Express.

## [1.7.2] - 2026-06-30

### Fixed
- **HTTP transport no longer deadlocks behind a gateway/proxy** ([#22](https://github.com/aplaceforallmystuff/mcp-arr/pull/22), by [@rwlove](https://github.com/rwlove); fixes [#21](https://github.com/aplaceforallmystuff/mcp-arr/issues/21)). The previous implementation shared a single module-level `Server` and serialized every request through a queue, because one `Server` can only be connected to one transport at a time. The moment a streamable-HTTP client (e.g. an MCP gateway/proxy such as n8n) opened its long-lived `GET` SSE stream, that request never completed and blocked the queue permanently — every subsequent `POST` (`initialize`, `tools/list`, `tools/call`, …) hung with no response. The transport now builds a **fresh `Server` + `StreamableHTTPServerTransport` per request** (the SDK's documented stateless pattern) and tears them down on response close, so a long-lived stream can no longer block other requests. The stdio transport is unchanged. Verified: with a GET stream held open, a concurrent POST went from timing out at 8 s to returning in ~2 ms.

## [1.7.1] - 2026-06-30

### Security
- Bumped `hono` from 4.12.22 to **4.12.26** ([#26](https://github.com/aplaceforallmystuff/mcp-arr/pull/26)) to clear five advisories affecting `hono <= 4.12.24`: CORS middleware reflecting any origin with credentials (GHSA-88fw-hqm2-52qc), `serve-static` path traversal via encoded backslash on Windows (GHSA-wwfh-h76j-fc44), body-limit bypass on AWS Lambda (GHSA-rv63-4mwf-qqc2), and `Set-Cookie` / repeated-header dropping in the Lambda adapters (GHSA-j6c9-x7qj-28xf, GHSA-wgpf-jwqj-8h8p). Thanks to [@acesplit](https://github.com/acesplit) (#25) for the early report.

## [1.7.0] - 2026-06-30

### Added
- **Radarr feature expansion** ([#12](https://github.com/aplaceforallmystuff/mcp-arr/pull/12), by [@rappo](https://github.com/rappo)):
  - `radarr_update_movie` — update an existing movie's monitored state, quality profile, and other editable fields
  - `radarr_search_movies` — bulk-trigger searches across multiple movies at once
  - `radarr_delete_queue_item` — remove a stuck or unwanted item from the Radarr download queue
  - Quality-profile and quality fields surfaced on movie responses
- **Tag-triggered release pipeline** ([#20](https://github.com/aplaceforallmystuff/mcp-arr/pull/20), based on [#11](https://github.com/aplaceforallmystuff/mcp-arr/pull/11) by [@alejandrosnz](https://github.com/alejandrosnz)):
  - Multi-arch Docker images (`linux/amd64` + `linux/arm64`) built and pushed to **GHCR** on every `vX.Y.Z` tag, tagged `latest` / major / minor / exact
  - GitHub Release created automatically with notes pulled from this CHANGELOG
  - Hardened: every action pinned to a commit SHA, `workflow_dispatch` inputs passed via env vars, per-job least-privilege permissions, strict semver + package.json + CHANGELOG validation guards
  - **No npm publish and no stored `NPM_TOKEN`** — the pipeline uses only the per-run, auto-expiring `GITHUB_TOKEN`. npm publishing stays manual and passkey-gated.
- **`docker-compose.yml`** for self-hosters (n8n etc.) to run the server in HTTP mode in one command. Note: the compose HTTP endpoint is unauthenticated — intended for LAN / behind a reverse proxy only. Addresses the public-image request in [#5](https://github.com/aplaceforallmystuff/mcp-arr/issues/5).

## [1.6.5] - 2026-06-11

### Fixed
- HTTP transport now runs in **stateless mode** — a fresh `StreamableHTTPServerTransport` per request with no `Mcp-Session-Id` issued — fixing `400 Bad Request: Mcp-Session-Id header is required` for MCP clients that do not echo the session header back (notably **Claude Code**). The stateful implementation in 1.6.3/1.6.4 only worked for clients that round-tripped the session id. Request handling is serialized so the shared server is only ever connected to one transport at a time, and a fresh transport per request still sidesteps the SDK 1.27.x stateless-reuse guard. Added a regression test that exercises the no-session-header path. Thanks to [@jakefriz](https://github.com/jakefriz) (#15) and [@alejandrosnz](https://github.com/alejandrosnz) (#11) for independently identifying the stateless fix.

## [1.6.4] - 2026-06-10

### Security
- Bumped `@modelcontextprotocol/sdk` to `^1.29.0` to clear transitive CVEs in nested dependencies

### Note
- Supersedes the never-published-to-npm 1.6.3 (which was tagged but not released); 1.6.4 includes all 1.6.3 changes plus the dependency security update.

## [1.6.3] - 2026-04-27

### Fixed
- Fixed remote HTTP MCP mode failing after initialization with `@modelcontextprotocol/sdk` 1.27.x by enabling stateful HTTP sessions with generated MCP session IDs (#5, reported by [@michaelheyman](https://github.com/michaelheyman))

## [1.6.2] - 2026-04-22

### Fixed
- Upgraded `hono` and `path-to-regexp` to resolve 1 high and 2 moderate severity vulnerabilities (cookie name handling, path traversal in `toSSG`, static-serve middleware bypass, JSX SSR injection, IPv6 matching in `ipRestriction`, and ReDoS in `path-to-regexp`)

## [1.6.1] - 2026-04-22

### Added
- Remote HTTP MCP mode via `MCP_TRANSPORT=http` (with `HOST`, `PORT`, `MCP_PATH` env vars)
- Generic `search` and `fetch` tools for hosted/remote MCP clients (e.g. ChatGPT connectors)
- Docker usage examples in the README for both stdio and HTTP mode
- `limit` / `offset` pagination for:
  - `sonarr_get_queue`
  - `radarr_get_queue`
  - `lidarr_get_queue`
- `sonarr_refresh_series` and `radarr_refresh_movie` tools for triggering targeted metadata refresh ([#9](https://github.com/aplaceforallmystuff/mcp-arr/pull/9), contributed by [@ismael9291](https://github.com/ismael9291))
- `limit` / `offset` / `search` pagination for `sonarr_get_series` and `radarr_get_movies` ([#9](https://github.com/aplaceforallmystuff/mcp-arr/pull/9), contributed by [@ismael9291](https://github.com/ismael9291))

### Changed
- The server now starts in TRaSH-only mode even when no local *arr services are configured
- Queue responses now include pagination metadata (`total`, `returned`, `hasMore`, `nextOffset`, etc.)
- Refresh tool responses validate that the target exists before dispatching the command, and echo the resolved `id` / `title` / `year`
- README and server metadata updated to reflect remote MCP support and current versioning

### Fixed
- Broken README architecture image path
- Version drift between `package.json`, `server.json`, and runtime version metadata

### Removed
- Readarr (Books) support — replaced by Booklore + Shelfmark in Docker stack

## [1.5.4] - 2026-03-19

### Fixed
- Duplicate tool registrations for `sonarr_get_quality_profiles`, `sonarr_get_root_folders`, `radarr_get_quality_profiles`, and `radarr_get_root_folders` — each was registered twice (via `addConfigTools()` and manually), causing 8 duplicate entries ([#6](https://github.com/aplaceforallmystuff/mcp-arr/issues/6), reported by [@a1ad](https://github.com/a1ad))
- Updated dependencies to fix 3 high severity vulnerabilities (hono, @hono/node-server, express-rate-limit)

## [1.5.3] - 2026-02-27

### Fixed
- `lidarr_search` now returns `artistName` and `disambiguation` instead of generic `title` field
- `lidarr_search` accepts `term`, `query`, `artist`, or `name` parameters with validation
- Fixed null safety on `overview` field truncation in Lidarr search results

Based on [PR #2](https://github.com/aplaceforallmystuff/mcp-arr/pull/2) by [@bndlfm](https://github.com/bndlfm).

## [1.5.2] - 2026-02-27

### Fixed
- `@modelcontextprotocol/sdk` moved from devDependencies to dependencies — fixes `ERR_MODULE_NOT_FOUND` when installed via `npx` (#3)

## [1.5.1] - 2026-02-27

### Added
- Optional `tags` parameter on all add tools (`sonarr_add_series`, `radarr_add_movie`, `lidarr_add_artist`, `readarr_add_author`) - accepts array of tag IDs from the corresponding `*_get_tags` tool

## [1.5.0] - 2026-02-25

### Added
- `sonarr_add_series` - Add TV series to Sonarr library
- `radarr_add_movie` - Add movies to Radarr library
- `lidarr_add_artist` - Add artists to Lidarr library
- `readarr_add_author` - Add authors to Readarr library
- Helper tools for each service: `*_get_root_folders`, `*_get_quality_profiles`
- `lidarr_get_metadata_profiles` and `readarr_get_metadata_profiles` helpers

### Changed
- Search tool descriptions now reference the add workflow (e.g., "returns tvdbId needed for sonarr_add_series")

### Fixed
- Dependency vulnerabilities in @modelcontextprotocol/sdk, ajv, hono, and qs

## [1.4.1] - 2026-01-13

### Changed
- Updated `@modelcontextprotocol/sdk` to 1.25.2
- Updated `@types/node` to 20.19.29

### Fixed
- Security vulnerability in `qs` dependency (GHSA-6rw7-vpxm-498p)

### Added
- `CLAUDE.md` for Claude Code contributors

## [1.4.0] - 2025-12-01

### Added
- **TRaSH Guides Integration** - Access community-curated quality profiles, custom formats, and naming conventions directly through Claude:
  - `trash_list_profiles` - List available TRaSH quality profiles for Radarr or Sonarr
  - `trash_get_profile` - Get detailed profile with custom formats, scores, and quality settings
  - `trash_list_custom_formats` - List custom formats with optional category filter (hdr, audio, resolution, source, streaming, anime, unwanted, release, language)
  - `trash_get_naming` - Get recommended naming conventions for Plex, Emby, Jellyfin, or standard
  - `trash_get_quality_sizes` - Get recommended min/max/preferred sizes for each quality level
  - `trash_compare_profile` - Compare your profile against TRaSH recommendations
  - `trash_compare_naming` - Compare your naming config against TRaSH recommendations

- New `trash-client.ts` module for fetching and caching TRaSH Guides data from GitHub
- 1-hour cache for TRaSH data to minimize GitHub API calls
- Custom format categorization (HDR, audio, resolution, source, streaming, anime, etc.)

### Purpose
TRaSH Guides tools enable users to reference community best practices for *arr configuration without leaving Claude. Compare your current setup against TRaSH recommendations to identify missing custom formats, quality settings differences, and naming improvements.

## [1.3.0] - 2025-11-29

### Added
- **Configuration Review Tools** - New tools to inspect and analyze *arr service configurations:
  - `{service}_get_quality_profiles` - Detailed quality profile information including allowed qualities, upgrade settings, and custom format scores
  - `{service}_get_health` - Health check warnings and issues detected by the application
  - `{service}_get_root_folders` - Storage paths, free space, and accessibility status
  - `{service}_get_download_clients` - Download client configurations and settings
  - `{service}_get_naming` - File and folder naming conventions
  - `{service}_get_tags` - Tag definitions for content organization
  - `{service}_review_setup` - Comprehensive configuration dump for AI-assisted setup analysis

  These tools are available for Sonarr, Radarr, Lidarr, and Readarr (replace `{service}` with service name).

- New API client methods for configuration retrieval:
  - `getQualityProfiles()` - Full quality profile details
  - `getQualityDefinitions()` - Size limits per quality level
  - `getDownloadClients()` - Download client configurations
  - `getNamingConfig()` - Naming conventions
  - `getMediaManagement()` - File handling settings
  - `getHealth()` - Health check warnings
  - `getTags()` - Tag definitions
  - `getIndexers()` - Per-app indexer configs
  - `getMetadataProfiles()` - Metadata profiles (Lidarr/Readarr only)

### Purpose
The new configuration review tools enable natural language conversations about *arr setup optimization. Users can ask Claude to review their configuration and suggest improvements, especially helpful for understanding complex quality profiles and media management settings.

## [1.2.0] - 2025-11-28

### Added
- Sonarr episode management tools:
  - `sonarr_get_episodes` - List episodes for a series with availability status
  - `sonarr_search_missing` - Trigger search for missing episodes
  - `sonarr_search_episode` - Search for specific episodes
- Radarr download tools:
  - `radarr_search_movie` - Trigger search for a movie
- Lidarr album management tools:
  - `lidarr_get_albums` - List albums for an artist with availability status
  - `lidarr_search_album` - Trigger search for a specific album
  - `lidarr_search_missing` - Search for all missing albums for an artist
  - `lidarr_get_calendar` - View upcoming album releases
- Readarr book management tools:
  - `readarr_get_books` - List books for an author
  - `readarr_search_book` - Trigger search for specific books
  - `readarr_search_missing` - Search for missing books
  - `readarr_get_calendar` - View upcoming book releases
- Prowlarr indexer tools:
  - `prowlarr_test_indexers` - Health check all indexers
  - `prowlarr_get_stats` - Indexer statistics

## [1.1.0] - 2025-11-28

### Fixed
- Corrected API version for Lidarr, Readarr, and Prowlarr (use `/api/v1` instead of `/api/v3`)
- Added configurable `apiVersion` property to base ArrClient class

### Added
- `server.json` for MCP registry compatibility

## [1.0.0] - 2025-11-28

### Added
- Initial release with MCP tools for *arr media management suite
- **Sonarr** (TV) tools:
  - `sonarr_get_series` - List all TV series in library
  - `sonarr_search` - Search for TV series to add
  - `sonarr_get_queue` - View download queue
  - `sonarr_get_calendar` - View upcoming episodes
- **Radarr** (Movies) tools:
  - `radarr_get_movies` - List all movies in library
  - `radarr_search` - Search for movies to add
  - `radarr_get_queue` - View download queue
  - `radarr_get_calendar` - View upcoming releases
- **Lidarr** (Music) tools:
  - `lidarr_get_artists` - List all artists in library
  - `lidarr_search` - Search for artists to add
  - `lidarr_get_queue` - View download queue
- **Readarr** (Books) tools:
  - `readarr_get_authors` - List all authors in library
  - `readarr_search` - Search for authors to add
  - `readarr_get_queue` - View download queue
- **Prowlarr** (Indexers) tools:
  - `prowlarr_get_indexers` - List configured indexers
  - `prowlarr_search` - Search across all indexers
- **Cross-service** tools:
  - `arr_status` - Check health of all configured services
  - `arr_search_all` - Search across all media types
