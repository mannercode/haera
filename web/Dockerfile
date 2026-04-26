# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund

FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runner
RUN apt-get update \
 && apt-get install -y --no-install-recommends cron curl ca-certificates tini tzdata bsdmainutils \
 && rm -rf /var/lib/apt/lists/*
ENV TZ=Asia/Seoul

# Install Claude Code CLI globally so cron + auth subprocesses can call `claude`.
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Cron job + entrypoint
COPY cron/organize.sh /opt/haera/organize.sh
COPY cron/prompt.md /opt/haera/prompt.md
COPY cron/crontab /etc/cron.d/haera
COPY cron/entrypoint.sh /entrypoint.sh
RUN chmod +x /opt/haera/organize.sh /entrypoint.sh \
 && chmod 0644 /etc/cron.d/haera \
 && touch /var/log/haera.log

EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]
