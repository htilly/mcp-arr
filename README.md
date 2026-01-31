# MCP *arr Server

![Architecture](docs/images/architecture-diagram.png)

<!-- <p align="center">
  <img src="docs/mcp-arr-logo.png" alt="MCP *arr Server" width="400">
</p> -->

[![npm version](https://img.shields.io/npm/v/mcp-arr-server.svg)](https://www.npmjs.com/package/mcp-arr-server)
[![CI](https://github.com/aplaceforallmystuff/mcp-arr/actions/workflows/ci.yml/badge.svg)](https://github.com/aplaceforallmystuff/mcp-arr/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP](https://img.shields.io/badge/MCP-Compatible-blue)](https://modelcontextprotocol.io)

MCP server for the [*arr media management suite](https://wiki.servarr.com/) - Sonarr, Radarr, Lidarr, Readarr, Prowlarr, plus [Overseerr](https://overseerr.dev/) for request management.

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
| **Cross-Service** | Status check, unified search across all configured services |
| **Configuration** | Quality profiles, download clients, naming conventions, health checks, storage info |
| **TRaSH Guides** | Reference quality profiles, custom formats, naming conventions, compare against recommendations |

## Prerequisites

- Node.js 18+
- At least one of:
  - *arr application(s) with API access: [Sonarr](https://sonarr.tv/), [Radarr](https://radarr.video/), [Lidarr](https://lidarr.audio/), [Readarr](https://readarr.com/), [Prowlarr](https://prowlarr.com/)
  - [Tautulli](https://tautulli.com/) (Plex monitoring and statistics)
  - [Overseerr](https://overseerr.dev/) (request management for Plex)

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
        "OVERSEERR_API_KEY": "your-overseerr-api-key"
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

For `npm run test`, set URL and API key in `test-config.txt` (project root, .env-style) or as environment variables. The script tests Sonarr, Radarr, Lidarr, Readarr, Prowlarr, and Tautulli; Tautulli gets a detailed output (recent history, users) when configured.

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
You tried to use a tool for a service that isn't configured. Add the corresponding URL and API_KEY environment variables.

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
