# Build stage
FROM node:20-alpine AS builder

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
FROM node:20-alpine

WORKDIR /app

# Copy package files and install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy built output from builder
COPY --from=builder /app/dist ./dist

# Non-root user; writable volumes for the encrypted config and the (fallback) key file.
# Keep /secrets on a different volume/disk than /config - or use a Docker secret instead
# (CONFIG_ENCRYPTION_KEY_FILE=/run/secrets/...).
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs && \
    mkdir -p /config /secrets && chown nodejs:nodejs /config /secrets && chmod 700 /config /secrets

ENV CONFIG_PATH=/config/config.json \
    KEY_FILE_PATH=/secrets/master.key \
    TLS_MODE=internal \
    PORT=3000
VOLUME ["/config", "/secrets"]
EXPOSE 3000

USER nodejs

# Default: stdio (for local MCP clients, e.g. `docker run -i`).
# Set MCP_TRANSPORT=http and PUBLIC_URL to run as an HTTPS server with the web UI (see docker-compose.yml).
ENTRYPOINT ["node", "dist/index.js"]
