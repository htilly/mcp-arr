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

# Set non-root user for security, and a writable config volume (used in HTTP mode)
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs && \
    mkdir -p /config && chown nodejs:nodejs /config

ENV CONFIG_PATH=/config/config.json \
    PORT=3000
VOLUME ["/config"]
EXPOSE 3000

USER nodejs

# Default: stdio (for local MCP clients, e.g. `docker run -i`).
# Set MCP_TRANSPORT=http to run as a remote server with the web UI on port 3000.
ENTRYPOINT ["node", "dist/index.js"]
