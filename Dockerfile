# Build stage
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev)
RUN npm ci

# Copy source code
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293

WORKDIR /app

# A real init as PID 1. Node does not reap orphaned children, so any process
# reparented to PID 1 inside the container stays a zombie for the life of the
# container. tini reaps them. Without it, a container healthcheck that forks a
# helper (BusyBox wget's ssl_client, for HTTPS) leaks one zombie per check.
RUN apk add --no-cache tini

# Copy package files and install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy built output from builder
COPY --from=builder /app/dist ./dist

# Container healthcheck, run by node rather than BusyBox wget (see above)
COPY docker/healthcheck.mjs ./docker/healthcheck.mjs

# Non-root user; writable volumes for the encrypted config and the (fallback) key file.
# Keep /secrets on a different volume/disk than /config - or use a Docker secret instead
# (CONFIG_ENCRYPTION_KEY_FILE=/run/secrets/...).
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs && \
    mkdir -p /config /secrets && chown nodejs:nodejs /config /secrets && chmod 700 /config /secrets

ENV CONFIG_PATH=/config/config.json \
    KEY_FILE_PATH=/secrets/master.key \
    PORT=3000 \
    MCP_ARR_DOCKER=1
VOLUME ["/config", "/secrets"]
# 3000: HTTPS (web UI + MCP). 8080: only with TLS_MODE=acme + http-01 - publish it as port 80 ("80:8080").
EXPOSE 3000 8080

USER nodejs

# Probes the http-mode listener. In stdio mode there is nothing to probe, and
# the script reports healthy rather than leaving the container unhealthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["node", "docker/healthcheck.mjs"]

# Default: stdio (for local MCP clients, e.g. `docker run -i`).
# Set MCP_TRANSPORT=http and PUBLIC_URL to run as an HTTPS server with the web UI (see docker-compose.yml).
# tini (PID 1) reaps orphaned processes and forwards signals to node.
ENTRYPOINT ["/sbin/tini", "--", "node", "dist/index.js"]
