# MCP *arr Server

![Architecture](docs/images/architecture-diagram.png)

<!-- <p align="center">
  <img src="docs/mcp-arr-logo.png" alt="MCP *arr Server" width="400">
</p> -->

[![npm version](https://img.shields.io/npm/v/mcp-arr-server.svg)](https://www.npmjs.com/package/mcp-arr-server)
[![CI](https://github.com/aplaceforallmystuff/mcp-arr/actions/workflows/ci.yml/badge.svg)](https://github.com/aplaceforallmystuff/mcp-arr/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP](https://img.shields.io/badge/MCP-Compatible-blue)](https://modelcontextprotocol.io)

MCP server for the [*arr media management suite](https://wiki.servarr.com/) - Sonarr, Radarr, Lidarr, Readarr, Prowlarr, plus [Overseerr](https://overseerr.dev/) for request management and [Bazarr](https://www.bazarr.media/) for subtitles.

## Why Use This?

- **Unified media management** - Control all your *arr applications from one interface
- **Natural language queries** - Ask about your library in plain English
- **Cross-service search** - Find content across TV, movies, music, and books simultaneously
- **Download monitoring** - Check queue status and progress across all services
- **Calendar integration** - See upcoming releases for all media types
- **Configuration review** - Get AI-powered suggestions for optimizing your setup
- **Flexible configuration** - Enable only the services you use

## Features

| Category | Capabilities |
|----------|-------------|
| **Sonarr (TV)** | List series, view episodes, search shows, trigger downloads, check queue, view calendar, review setup |
| **Radarr (Movies)** | List movies, search films, trigger downloads, check queue, view releases, review setup |
| **Lidarr (Music)** | List artists, view albums, search musicians, trigger downloads, check queue, view calendar, review setup |
| **Readarr (Books)** | List authors, view books, search writers, trigger downloads, check queue, view calendar, review setup |
| **Prowlarr (Indexers)** | List indexers, search across all trackers, test health, view statistics |
| **Tautulli (Plex)** | Activity, history, libraries, users, recently added, server status, terminate session |
| **Overseerr (Requests)** | List requests, approve/decline, view users, search media, request management |
| **Bazarr (Subtitles)** | Missing subtitles, series/episode/movie subtitle status, search & download subtitles, history, providers, languages |
| **Remote server** | Optional HTTPS server with web UI: passkey login per user, encrypted config, offline certificates |
| **Cross-Service** | Status check, unified search across all configured services |
| **Configuration** | Quality profiles, download clients, naming conventions, health checks, storage info |
| **TRaSH Guides** | Reference quality profiles, custom formats, naming conventions, compare against recommendations |

## Prerequisites

- Node.js 20+
- At least one of:
  - *arr application(s) with API access: [Sonarr](https://sonarr.tv/), [Radarr](https://radarr.video/), [Lidarr](https://lidarr.audio/), [Readarr](https://readarr.com/), [Prowlarr](https://prowlarr.com/)
  - [Tautulli](https://tautulli.com/) (Plex monitoring and statistics)
  - [Overseerr](https://overseerr.dev/) (request management for Plex)
  - [Bazarr](https://www.bazarr.media/) (subtitle management for Sonarr/Radarr)

## Installation

### Using npm (Recommended)

```bash
npx mcp-arr-server
```

### From Source

```bash
git clone https://github.com/aplaceforallmystuff/mcp-arr.git
cd mcp-arr
npm install
npm run build
```

## Configuration

### Getting API Keys

Each *arr application has an API key in Settings > General > Security:

1. Open your *arr application's web interface
2. Go to **Settings** > **General**
3. Find the **API Key** under the Security section
4. Copy the API key for use in configuration

### For Claude Desktop

Add to your Claude Desktop config file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "arr": {
      "command": "npx",
      "args": ["-y", "mcp-arr-server"],
      "env": {
        "SONARR_URL": "http://localhost:8989",
        "SONARR_API_KEY": "your-sonarr-api-key",
        "RADARR_URL": "http://localhost:7878",
        "RADARR_API_KEY": "your-radarr-api-key",
        "LIDARR_URL": "http://localhost:8686",
        "LIDARR_API_KEY": "your-lidarr-api-key",
        "READARR_URL": "http://localhost:8787",
        "READARR_API_KEY": "your-readarr-api-key",
        "PROWLARR_URL": "http://localhost:9696",
        "PROWLARR_API_KEY": "your-prowlarr-api-key",
        "TAUTULLI_URL": "http://localhost:8181",
        "TAUTULLI_API_KEY": "your-tautulli-api-key",
        "OVERSEERR_URL": "http://localhost:5055",
        "OVERSEERR_API_KEY": "your-overseerr-api-key",
        "BAZARR_URL": "http://localhost:6767",
        "BAZARR_API_KEY": "your-bazarr-api-key"
      }
    }
  }
}
```

### For Claude Code

Add to `~/.claude.json`:

```json
{
  "mcpServers": {
    "arr": {
      "command": "npx",
      "args": ["-y", "mcp-arr-server"],
      "env": {
        "SONARR_URL": "http://localhost:8989",
        "SONARR_API_KEY": "your-sonarr-api-key",
        "RADARR_URL": "http://localhost:7878",
        "RADARR_API_KEY": "your-radarr-api-key"
      }
    }
  }
}
```

**Note**: Only configure the services you have running. The server automatically detects which services are available based on the environment variables you provide.

### Remote server (Docker, HTTPS, web UI with passkeys)

Run mcp-arr **once** on your server (e.g. next to Sonarr/Radarr) and point all MCP clients at one HTTPS URL. A web UI manages service URLs and API keys, users and access tokens. It is built for networks **without internet access**:

- **HTTPS without Let's Encrypt** – a built-in certificate authority issues and renews the server certificate offline. You install its root certificate once per device. The CA is *name-constrained* to your server's names, so it cannot be abused to impersonate other websites. You can also bring your own certificate (step-ca, Caddy, your router, …).
- **Encrypted at rest** – the whole config file (API keys, users, passkeys, token hashes, CA private keys) is AES-256-GCM encrypted.
- **Per-user login with passkeys** – no passwords. Roles: *admin* (services, users, invites, certificates) and *user* (own passkeys and access tokens).
- **Per-user MCP access tokens** – every client gets its own token, revocable at any time.

> **Claude custom connectors** (claude.ai, mobile, Desktop "Connectors") are called from Anthropic's cloud and need a public internet address with OAuth, so they can't reach an offline server. Use **Claude Code** or **Claude Desktop via `mcp-remote`** – both connect from your own machine.

#### Setup

1. **Pick a host name** and make it resolve on your LAN (router / Pi-hole / AdGuard DNS entry, or the hosts file), e.g. `mcp-arr.home.lan`. Passkeys require a host name — an IP address does not work.
2. **Create the encryption key** (used as a Docker secret):
   ```bash
   openssl rand -base64 32 > mcp-arr-key.txt
   ```
3. Set `PUBLIC_URL` in `docker-compose.yml` (e.g. `https://mcp-arr.home.lan:3000`) and start:
   ```bash
   docker compose up -d
   docker compose logs mcp-arr     # setup code + CA fingerprint
   ```
4. Open `https://mcp-arr.home.lan:3000/ca.crt` (accept the browser warning this once), check that the SHA-256 fingerprint matches the log, and **install the root certificate** (the web UI's *Certificates* tab has steps for macOS, Windows, iOS, Android and Linux).
5. Open `https://mcp-arr.home.lan:3000/admin`, enter the setup code and **register your passkey** — you are the first admin.
6. Add your services (**Test**, then **Save** — tools are enabled immediately), invite other people from **Users** (single-use links, 24 h), and create an **access token** per MCP client.

#### Connect MCP clients

Node.js-based clients don't use the system certificate store, so point them at the root certificate with `NODE_EXTRA_CA_CERTS` (not needed with `TLS_MODE=file` and a certificate your system already trusts):

```bash
# Claude Code (set NODE_EXTRA_CA_CERTS in the shell/profile that starts claude)
export NODE_EXTRA_CA_CERTS=/path/to/mcp-arr-ca.crt
claude mcp add --transport http arr https://mcp-arr.home.lan:3000/mcp --header "Authorization: Bearer <token>"
```

```json
// Claude Desktop (claude_desktop_config.json), via the local mcp-remote bridge
{
  "mcpServers": {
    "arr": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://mcp-arr.home.lan:3000/mcp", "--header", "Authorization: Bearer <token>"],
      "env": { "NODE_EXTRA_CA_CERTS": "/path/to/mcp-arr-ca.crt" }
    }
  }
}
```

Clients that can't send headers can use `https://…/mcp?token=<token>`. On an offline machine, install `mcp-remote` once while online (`npm i -g mcp-remote`) and use `"command": "mcp-remote"`.

#### Certificates (`TLS_MODE`)

| Mode | Use when |
|------|----------|
| `internal` (default) | No other CA on your network. Root CA (10 years) + server certificate (397 days, renewed automatically and hot-swapped, no restart). Changing host names outside the CA's name constraints generates a new CA (you'll need to reinstall it) — set `TLS_CA_NAME_CONSTRAINTS=home.lan` to allow any name under a domain. |
| `file` | You already run a LAN CA, e.g. [step-ca](https://smallstep.com/docs/step-ca/) (which also offers ACME for automatic renewal on an offline network), Caddy's internal CA, your router/NAS, or a certificate obtained elsewhere via DNS-01. Set `TLS_CERT_FILE` / `TLS_KEY_FILE`; files are reloaded automatically when they change. |
| `off` | A reverse proxy in front terminates HTTPS. Set `TRUST_PROXY=true` so rate limiting uses `X-Forwarded-For`. `PUBLIC_URL` must still be the proxy's `https://` address. |

#### Encryption key

Resolved in this order:

1. `CONFIG_ENCRYPTION_KEY` – passphrase in an environment variable
2. `CONFIG_ENCRYPTION_KEY_FILE` – file containing the passphrase (recommended: a Docker secret, see `docker-compose.yml`)
3. Otherwise a random key file is created at `KEY_FILE_PATH` (Docker: `/secrets/master.key`). This protects a copied config file, but not someone who has both volumes — the UI and log show a warning. Keep it on a separate volume.

Switching from the key file to a passphrase is automatic (the file is re-encrypted on start). To change passphrases, start once with the old one in `CONFIG_ENCRYPTION_KEY_PREVIOUS`. Without the right key the server refuses to start — **back up your key**; there is no way to recover the data without it.

#### HTTP mode settings

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_TRANSPORT` | `stdio` | Set to `http` for the remote server |
| `PUBLIC_URL` | – (required) | The URL you open in the browser, e.g. `https://mcp-arr.home.lan:3000` (passkey origin + certificate name) |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Listen address |
| `TLS_MODE` | `internal` | `internal`, `file` or `off` (see above) |
| `TLS_SANS` | – | Extra names/IPs for the certificate, comma-separated |
| `TLS_CA_NAME_CONSTRAINTS` | names from `PUBLIC_URL` + `TLS_SANS` | Domains/IPs the built-in CA may issue for |
| `TLS_CERT_FILE` / `TLS_KEY_FILE` | – | Certificate and key for `TLS_MODE=file` |
| `CONFIG_PATH` | `/config/config.json` (Docker) | Encrypted config file |
| `CONFIG_ENCRYPTION_KEY` / `_FILE` / `_PREVIOUS` | – | Encryption key (see above) |
| `KEY_FILE_PATH` | `/secrets/master.key` (Docker) | Fallback auto-generated key file |
| `ADMIN_RECOVERY` | `false` | `true` prints a one-time recovery code to register a new admin passkey |
| `TRUST_PROXY` | `false` | Trust `X-Forwarded-For` (only behind your own reverse proxy) |

Service variables (`SONARR_URL`, `SONARR_API_KEY`, …) still work and take precedence over the web UI, where they show as read-only.

**Offline notes:** everything works without internet except the TRaSH Guides tools, which fetch guide data from GitHub and return an error when offline. To install on an air-gapped host, build the image elsewhere and move it with `docker save` / `docker load`.

### Using the local build (Cursor / Claude)

If you develop from source and run `npm run build`, the **published npm package** used by `npx mcp-arr-server` is an older version. To use your local build and latest code (e.g. Tautulli history with pagination):

1. **Point the MCP server at your built file** and pass env vars in your MCP config.

2. **Cursor**: In Cursor Settings → MCP (or the MCP config file Cursor uses), add or edit the mcp-arr server so it runs the local build and has env vars:

```json
{
  "mcpServers": {
    "arr": {
      "command": "node",
      "args": ["/Users/Henrik.Tilly/Documents/dev/private/mcp-arr/dist/index.js"],
      "env": {
        "TAUTULLI_URL": "http://localhost:8181",
        "TAUTULLI_API_KEY": "your-tautulli-api-key",
        "SONARR_URL": "http://localhost:8989",
        "SONARR_API_KEY": "your-sonarr-api-key"
      }
    }
  }
}
```

Use your actual paths and API keys. Only include the services you use.

3. **Restart the MCP server** (e.g. restart Cursor or use “Restart” on the mcp-arr server in Cursor’s MCP list) after each `npm run build` so the new code is loaded.

4. **Claude Desktop**: Same idea — set `"command": "node"` and `"args": ["/absolute/path/to/mcp-arr/dist/index.js"]` with `env` in `claude_desktop_config.json`.

## Usage Examples

### Library Management
- "Show me all my TV series"
- "What movies do I have in Radarr?"
- "List all artists in my music library"
- "How many books do I have by this author?"

### Searching for Content
- "Search for sci-fi shows on Sonarr"
- "Find action movies from the 90s"
- "Search for jazz albums"
- "Look up fantasy book series"

### Download Queue
- "What's downloading right now?"
- "Check the Sonarr queue"
- "Show Radarr download progress"

### Upcoming Releases
- "What TV episodes are coming this week?"
- "Show upcoming movie releases"
- "Any new albums coming out this month?"
- "Show me upcoming book releases"

### Downloading Content
- "What episodes of this show am I missing?"
- "Download the missing episodes for that series"
- "Search for this specific movie"
- "Grab that album I'm missing"
- "Download all missing books for this author"

### Indexer Management
- "Are my indexers healthy?"
- "How are my indexers performing?"
- "Test all my Prowlarr indexers"

### Configuration Review
- "Review my Sonarr setup and suggest improvements"
- "Show me my quality profiles in Radarr"
- "Are there any health issues with my Lidarr?"
- "What naming convention am I using for TV shows?"
- "Help me understand my quality profiles - why am I not getting 4K?"
- "Check my download client configuration"
- "How much free space do I have on my root folders?"

### Cross-Service
- "Check status of all my *arr services"
- "Search for 'comedy' across all services"

## Discovering tools and options

The MCP server exposes every tool with its full **inputSchema** (parameters, types, enums, descriptions). When your client connects, it receives this via **ListTools**, so the AI already knows what each tool does and which options it accepts.

You can ask in plain language, for example:
- *"What tools does the arr server have?"*
- *"What parameters does radarr_get_movies accept?"*
- *"How do I get only the first 100 movies from Radarr?"*
- *"Can I sort Sonarr series by size on disk?"*

The AI will answer from the tool definitions (sortBy, limit, etc.) without needing to read this README.

## Available Tools

### General Tools

| Tool | Description |
|------|-------------|
| `arr_status` | Get connection status for all configured *arr services |
| `arr_search_all` | Search across all configured services simultaneously |

**Note:** `radarr_get_movies`, `radarr_search`, and `sonarr_get_series` include `imdbId`, `rating` (TMDB/TVDB), and `ratingVotes` from the connected *arr services.

### Sonarr Tools (TV)

| Tool | Description |
|------|-------------|
| `sonarr_get_series` | List all TV series. Optional: sortBy (dateAdded, sizeOnDisk), sortDir (asc, desc), limit (e.g. 100) |
| `sonarr_search` | Search for TV series to add |
| `sonarr_get_queue` | View current download queue |
| `sonarr_get_calendar` | See upcoming episodes |
| `sonarr_get_episodes` | List episodes for a series (shows missing vs available; includes episodeFileId for delete) |
| `sonarr_search_missing` | Trigger search for all missing episodes in a series |
| `sonarr_search_episode` | Trigger search for specific episode(s) |
| `sonarr_delete_series` | Delete a whole series (optionally delete files, add import list exclusion) |
| `sonarr_delete_season` | Delete all episode files for a specific season |
| `sonarr_delete_episode_files` | Delete specific episode file(s) by episode file ID |

### Radarr Tools (Movies)

| Tool | Description |
|------|-------------|
| `radarr_get_movies` | List all movies. Optional: sortBy (dateAdded, sizeOnDisk), sortDir (asc, desc), limit (e.g. 100) |
| `radarr_search` | Search for movies to add |
| `radarr_get_queue` | View current download queue |
| `radarr_get_calendar` | See upcoming releases |
| `radarr_search_movie` | Trigger search to download a movie in your library |
| `radarr_delete_movie` | Delete a movie (optionally delete files from disk, add import exclusion) |

### Lidarr Tools (Music)

| Tool | Description |
|------|-------------|
| `lidarr_get_artists` | List all artists in your library |
| `lidarr_search` | Search for artists to add |
| `lidarr_get_queue` | View current download queue |
| `lidarr_get_albums` | List albums for an artist (shows missing vs available) |
| `lidarr_search_album` | Trigger search for a specific album |
| `lidarr_search_missing` | Trigger search for all missing albums for an artist |
| `lidarr_get_calendar` | See upcoming album releases |

### Readarr Tools (Books)

| Tool | Description |
|------|-------------|
| `readarr_get_authors` | List all authors in your library |
| `readarr_search` | Search for authors to add |
| `readarr_get_queue` | View current download queue |
| `readarr_get_books` | List books for an author (shows missing vs available) |
| `readarr_search_book` | Trigger search for specific book(s) |
| `readarr_search_missing` | Trigger search for all missing books for an author |
| `readarr_get_calendar` | See upcoming book releases |

### Prowlarr Tools (Indexers)

| Tool | Description |
|------|-------------|
| `prowlarr_get_indexers` | List all configured indexers |
| `prowlarr_search` | Search across all indexers |
| `prowlarr_test_indexers` | Test all indexers and return health status |
| `prowlarr_get_stats` | Get indexer statistics (queries, grabs, failures) |

### Tautulli Tools (Plex)

When `TAUTULLI_URL` and `TAUTULLI_API_KEY` are set:

| Tool | Description |
|------|-------------|
| `tautulli_get_activity` | Current Plex activity (now playing) |
| `tautulli_get_history` | Watch history. With title: search by movie/series – shows who watched and when (or empty if no one in last ~2000 plays) |
| `tautulli_get_libraries` | Plex libraries |
| `tautulli_get_server_info` | Plex server info |
| `tautulli_get_home_stats` | Home stats (plays, duration) |
| `tautulli_get_users` | Plex users |
| `tautulli_get_recently_added` | Recently added media |
| `tautulli_server_status` | Tautulli/Plex server status |
| `tautulli_terminate_session` | Terminate a streaming session |

`arr_status` includes Tautulli connection status when configured.

### Overseerr Tools (Requests)

When `OVERSEERR_URL` and `OVERSEERR_API_KEY` are set:

| Tool | Description |
|------|-------------|
| `overseerr_get_requests` | List media requests with status, requester, and media details. Filter by status (pending, approved, etc.) |
| `overseerr_get_request_count` | Get request counts by status (pending, approved, declined, etc.) |
| `overseerr_get_users` | List Overseerr users with their request counts |
| `overseerr_get_user_requests` | Get all requests made by a specific user |
| `overseerr_approve_request` | Approve a pending media request |
| `overseerr_decline_request` | Decline a pending media request |
| `overseerr_search` | Search for movies and TV shows (uses TMDB) |
| `overseerr_status` | Get Overseerr server status and version |

`arr_status` includes Overseerr connection status when configured.

### Bazarr Tools (Subtitles)

When `BAZARR_URL` and `BAZARR_API_KEY` are set (API key: Bazarr → Settings → General → Security):

| Tool | Description |
|------|-------------|
| `bazarr_status` | Bazarr system status (Bazarr/Sonarr/Radarr versions) |
| `bazarr_get_health` | Health check issues |
| `bazarr_get_badges` | Counts of episodes/movies missing subtitles and provider/health issues |
| `bazarr_get_series` | Series with language profile and missing-subtitle counts |
| `bazarr_get_episodes` | Episodes of a series with existing and missing subtitles (optional season filter) |
| `bazarr_get_movies` | Movies with existing and missing subtitles |
| `bazarr_get_wanted_episodes` | Episodes missing subtitles |
| `bazarr_get_wanted_movies` | Movies missing subtitles |
| `bazarr_get_history` | Subtitle history for episodes or movies |
| `bazarr_search_series` | Search all missing subtitles for a series |
| `bazarr_search_movie` | Search all missing subtitles for a movie |
| `bazarr_download_episode_subtitle` | Search & download a subtitle in a given language for an episode (forced/HI optional) |
| `bazarr_download_movie_subtitle` | Search & download a subtitle in a given language for a movie (forced/HI optional) |
| `bazarr_get_providers` | Subtitle provider status (throttled providers) |
| `bazarr_reset_providers` | Reset throttled providers |
| `bazarr_get_languages` | Enabled languages and language profiles |

Series and episode IDs are Sonarr IDs; movie IDs are Radarr IDs. `arr_status` includes Bazarr connection status when configured.

### Configuration Review Tools

These tools are available for Sonarr, Radarr, Lidarr, and Readarr. Replace `{service}` with the service name (e.g., `sonarr_get_quality_profiles`).

| Tool | Description |
|------|-------------|
| `{service}_get_quality_profiles` | Detailed quality profile information with allowed qualities and custom format scores |
| `{service}_get_health` | Health check warnings and issues detected by the application |
| `{service}_get_root_folders` | Storage paths, free space, and accessibility status |
| `{service}_get_download_clients` | Download client configurations and settings |
| `{service}_get_naming` | File and folder naming conventions |
| `{service}_get_tags` | Tag definitions for content organization |
| `{service}_review_setup` | **Comprehensive configuration dump for AI-assisted setup analysis** |

The `{service}_review_setup` tool returns all configuration in a single call, enabling natural language conversations about optimizing your setup. Claude can analyze your quality profiles, suggest improvements, explain why certain content isn't being grabbed, and help configure complex settings like custom formats.

> **⚠️ Disclaimer**: The configuration review tools provide **read-only** access to your *arr settings. Any changes to your configuration must be made directly in the *arr application interfaces. The AI's suggestions are recommendations only - always back up your configuration before making significant changes. The maintainers are not responsible for any configuration changes, data loss, or other issues that may arise from following AI-generated recommendations.

### TRaSH Guides Tools

Access community-curated quality profiles, custom formats, and naming conventions from [TRaSH Guides](https://trash-guides.info/) directly through Claude. These tools work without any *arr configuration - they fetch reference data from the TRaSH Guides GitHub repository.

| Tool | Description |
|------|-------------|
| `trash_list_profiles` | List available TRaSH quality profiles for Radarr or Sonarr |
| `trash_get_profile` | Get detailed profile with custom formats, scores, and quality settings |
| `trash_list_custom_formats` | List custom formats with optional category filter (hdr, audio, resolution, etc.) |
| `trash_get_naming` | Get recommended naming conventions for Plex, Emby, Jellyfin, or standard |
| `trash_get_quality_sizes` | Get recommended min/max/preferred sizes for each quality level |
| `trash_compare_profile` | Compare your profile against TRaSH recommendations (requires *arr configured) |
| `trash_compare_naming` | Compare your naming config against TRaSH recommendations (requires *arr configured) |

**Example usage:**
- "What quality profiles does TRaSH recommend for 4K movies?"
- "Show me the remux-web-1080p profile details"
- "Compare my Radarr profile 4 against the TRaSH uhd-bluray-web profile"
- "What naming convention should I use for Plex?"
- "List HDR-related custom formats for Radarr"

Data is cached for 1 hour to minimize GitHub API calls.

## Development

```bash
# Watch mode for development
npm run watch

# Build TypeScript
npm run build

# Test connections to all configured services (reads test-config.txt or env)
npm run test

# Run locally
SONARR_URL="http://localhost:8989" SONARR_API_KEY="your-key" node dist/index.js
```

For `npm run test`, set URL and API key in `test-config.txt` (project root, .env-style) or as environment variables. The script tests Sonarr, Radarr, Lidarr, Readarr, Prowlarr, Tautulli, Overseerr, and Bazarr; Tautulli gets a detailed output (recent history, users) when configured.

## Troubleshooting

### "No *arr services configured"
Ensure you have set at least one pair of URL and API_KEY environment variables:
```bash
SONARR_URL="http://localhost:8989"
SONARR_API_KEY="your-api-key"
```

### "API error: 401 Unauthorized"
The API key is incorrect. Verify it in your *arr application under Settings > General > Security.

### "fetch failed" or "ECONNREFUSED"
The *arr application is not running or the URL is incorrect. Verify:
- The application is running
- The URL and port are correct
- There's no firewall blocking the connection

### "Sonarr/Radarr/etc not configured"
You tried to use a tool for a service that isn't configured. Add the corresponding URL and API_KEY environment variables (or configure it in the web UI in HTTP mode).

### HTTP mode: "Unauthorized" from `/mcp`
Create an access token in the web UI (**Access tokens**) and send it as `Authorization: Bearer <token>`. Tokens stop working when they are revoked or their user is deleted.

### HTTP mode: certificate errors (`self-signed certificate in certificate chain`, `UNABLE_TO_VERIFY_LEAF_SIGNATURE`)
Install the root certificate from `/ca.crt` on the device, and for Node.js clients (Claude Code, `mcp-remote`) set `NODE_EXTRA_CA_CERTS=/path/to/mcp-arr-ca.crt`. Connect using a name that is in the certificate (`PUBLIC_URL` host or `TLS_SANS`).

### HTTP mode: passkey prompt fails or "Passkeys unavailable"
Passkeys only work over trusted HTTPS on the exact host name in `PUBLIC_URL` (not an IP address, not a different alias). Install the root certificate and open the configured URL.

### HTTP mode: lost all admin passkeys
Start the server once with `ADMIN_RECOVERY=true`. The log shows a one-time recovery code; on the sign-in page choose "Lost your passkey?" to register a new admin. Remove the variable afterwards.

### HTTP mode: "encryption key does not match" / "no key is available"
The config file was encrypted with a different key. Start with the original `CONFIG_ENCRYPTION_KEY` (or restore the key file). To change keys, put the old one in `CONFIG_ENCRYPTION_KEY_PREVIOUS` for one start. Without the key the data can't be recovered — move the config file away to start fresh.

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT - see [LICENSE](LICENSE) for details.

## Links

- [Servarr Wiki](https://wiki.servarr.com/) - Documentation for all *arr applications
- [TRaSH Guides](https://trash-guides.info/) - Quality profiles, custom formats, and setup guides
- [Sonarr API Docs](https://sonarr.tv/docs/api/)
- [Model Context Protocol](https://modelcontextprotocol.io)
- [GitHub Repository](https://github.com/aplaceforallmystuff/mcp-arr)
