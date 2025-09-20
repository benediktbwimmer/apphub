# syntax=docker/dockerfile:1

FROM node:20-slim AS catalog-build
WORKDIR /app/services/catalog
COPY services/catalog/package.json services/catalog/package-lock.json ./
RUN npm ci
COPY services/catalog/ ./
RUN npm run build
RUN npm prune --omit=dev

FROM node:20 AS frontend-build
WORKDIR /app/apps/frontend
ARG VITE_API_BASE_URL=http://localhost:4000
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
COPY apps/frontend/package.json apps/frontend/package-lock.json ./
RUN npm ci
COPY apps/frontend/ ./
RUN npm run build

FROM node:20-slim AS runtime
WORKDIR /app
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
  && install -m 0755 -d /etc/apt/keyrings \
  && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
  && chmod a+r /etc/apt/keyrings/docker.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends git redis-server docker-ce-cli supervisor postgresql postgresql-contrib \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g serve \
  && mkdir -p /app/data /app/services

ENV NODE_ENV=production \
    PORT=4000 \
    HOST=0.0.0.0 \
    CATALOG_DB_PATH=/app/data/catalog.db \
    REDIS_URL=redis://127.0.0.1:6379 \
    SERVICE_MANIFEST_PATH=services/service-manifest.json \
    SERVICE_CONFIG_PATH=services/service-config.docker.json \
    FRONTEND_PORT=4173 \
    DATABASE_URL=postgres://apphub:apphub@127.0.0.1:5432/apphub \
    POSTGRES_USER=apphub \
    POSTGRES_PASSWORD=apphub \
    POSTGRES_DB=apphub \
    POSTGRES_PORT=5432 \
    PGDATA=/app/data/postgres

COPY services/service-config.docker.json services/service-config.docker.json
COPY services/service-manifest.json services/service-manifest.json
COPY --from=catalog-build /app/services/catalog/package.json services/catalog/package.json
COPY --from=catalog-build /app/services/catalog/package-lock.json services/catalog/package-lock.json
COPY --from=catalog-build /app/services/catalog/node_modules services/catalog/node_modules
COPY --from=catalog-build /app/services/catalog/dist services/catalog/dist
COPY --from=frontend-build /app/apps/frontend/dist apps/frontend/dist
COPY scripts/postgres-start.sh scripts/postgres-start.sh
RUN chmod +x scripts/postgres-start.sh

RUN cat <<'SUPERVISOR' > /etc/supervisor/conf.d/apphub.conf
[supervisord]
nodaemon=true
logfile=/dev/stdout
logfile_maxbytes=0

[program:postgres]
command=/app/scripts/postgres-start.sh
priority=5
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:redis]
command=redis-server --protected-mode no --save "" --appendonly no --bind 0.0.0.0
priority=10
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:catalog-api]
command=node services/catalog/dist/server.js
directory=/app
priority=20
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:ingestion-worker]
command=node services/catalog/dist/ingestionWorker.js
directory=/app
priority=30
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:build-worker]
command=node services/catalog/dist/buildWorker.js
directory=/app
priority=40
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:launch-worker]
command=node services/catalog/dist/launchWorker.js
directory=/app
priority=50
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:frontend]
command=serve -s apps/frontend/dist -l tcp://0.0.0.0:%(ENV_FRONTEND_PORT)s --no-port-switching
directory=/app
priority=60
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
SUPERVISOR

EXPOSE 4000 4173 6379

CMD ["supervisord", "-n"]
