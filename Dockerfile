# Multi-stage production Dockerfile for Bun + TypeScript Admin Bot
FROM oven/bun:1.2-alpine AS base
WORKDIR /app

# Set timezone to Asia/Tehran for accurate daily reports and scheduled posts
RUN apk add --no-cache tzdata curl wget
ENV TZ=Asia/Tehran

# Install dependencies
COPY package.json bun.lock* ./
RUN bun install --production

# Copy application code
COPY tsconfig.json ./
COPY src/ ./src/
COPY web/ ./web/

# Create data directory for SQLite database and temporary streaming files
RUN mkdir -p /app/data/temp

# Expose web dashboard port
EXPOSE 5000

ENV NODE_ENV=production

# Health check to ensure web server is responding
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5000/api/auth-check || exit 1

# Start the bot
CMD ["bun", "run", "src/index.ts"]
