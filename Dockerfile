# syntax=docker/dockerfile:1

FROM node:24 AS builder
WORKDIR /app

ARG TARGETPLATFORM

COPY package.json package-lock.json ./
COPY tsconfig.json tsconfig.json
COPY tsconfig.base.json tsconfig.base.json

COPY apps/frontend/package.json apps/frontend/package-lock.json apps/frontend/
COPY apps/cli/package.json apps/cli/package-lock.json apps/cli/
COPY services/catalog/package.json services/catalog/package-lock.json services/catalog/
COPY services/metastore/package.json services/metastore/
COPY services/timestore/package.json services/timestore/
COPY services/filestore/package.json services/filestore/
COPY packages/filestore-client/package.json packages/filestore-client/
COPY packages/example-bundler/package.json packages/example-bundler/
COPY packages/examples/package.json packages/examples/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=npm-${TARGETPLATFORM},target=/root/.npm npm ci
RUN set -eux; \
    install_optional() { \
      parent_pkg="$1"; \
      optional_pkg="$2"; \
      dest_dir="node_modules/${optional_pkg}"; \
      if [ -d "${dest_dir}" ]; then \
        return 0; \
      fi; \
      version="$(PARENT_NAME="${parent_pkg}" OPTIONAL_NAME="${optional_pkg}" node -e "const lock = require('./package-lock.json'); const entry = lock.packages['node_modules/' + process.env.PARENT_NAME]; const version = entry && entry.optionalDependencies && entry.optionalDependencies[process.env.OPTIONAL_NAME]; if (!version) { throw new Error('Missing optional dependency metadata for ' + process.env.OPTIONAL_NAME); } process.stdout.write(version);")"; \
      tarball_url="https://registry.npmjs.org/${optional_pkg}/-/$(basename "${optional_pkg}")-${version}.tgz"; \
      temp_dir="$(mktemp -d)"; \
      curl -fsSL "${tarball_url}" | tar -xz -C "${temp_dir}"; \
      mkdir -p "$(dirname "${dest_dir}")"; \
      rm -rf "${dest_dir}"; \
      mv "${temp_dir}/package" "${dest_dir}"; \
      rm -rf "${temp_dir}"; \
    }; \
    case "${TARGETPLATFORM}" in \
      "linux/arm64") \
        install_optional "rollup" "@rollup/rollup-linux-arm64-gnu"; \
        install_optional "lightningcss" "lightningcss-linux-arm64-gnu"; \
        ;; \
      "linux/amd64") \
        install_optional "rollup" "@rollup/rollup-linux-x64-gnu"; \
        install_optional "lightningcss" "lightningcss-linux-x64-gnu"; \
        ;; \
    esac

COPY . .

ARG VITE_API_BASE_URL=http://localhost:4000
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN npm run build --workspace @apphub/catalog
RUN npm run build --workspace @apphub/metastore
RUN npm run build --workspace @apphub/frontend
RUN npm run build --workspace @apphub/timestore
RUN npm run build --workspace @apphub/filestore
RUN npm run build --workspace @apphub/filestore-client
RUN npm prune --omit=dev
RUN rm -rf services/catalog/node_modules && ln -s ../../node_modules services/catalog/node_modules
RUN rm -rf services/metastore/node_modules && ln -s ../../node_modules services/metastore/node_modules
RUN rm -rf services/timestore/node_modules && ln -s ../../node_modules services/timestore/node_modules
RUN rm -rf services/filestore/node_modules && ln -s ../../node_modules services/filestore/node_modules
RUN rm -rf apps/frontend/node_modules && ln -s ../../node_modules apps/frontend/node_modules
RUN rm -rf apps/cli/node_modules && ln -s ../../node_modules apps/cli/node_modules
RUN rm -rf packages/example-bundler/node_modules && ln -s ../../node_modules packages/example-bundler/node_modules
RUN rm -rf packages/examples/node_modules && ln -s ../../node_modules packages/examples/node_modules
RUN rm -rf packages/shared/node_modules && ln -s ../../node_modules packages/shared/node_modules
RUN rm -rf packages/filestore-client/node_modules && ln -s ../../node_modules packages/filestore-client/node_modules

FROM node:24-slim AS runtime
WORKDIR /app
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
  && install -m 0755 -d /etc/apt/keyrings \
  && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
  && chmod a+r /etc/apt/keyrings/docker.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    git \
    redis-server \
    docker-ce \
    docker-ce-cli \
    containerd.io \
    docker-buildx-plugin \
    docker-compose-plugin \
    supervisor \
    postgresql \
    postgresql-contrib \
    python3 \
    python3-pip \
    python3-venv \
    python-is-python3 \
  && rm -rf /var/lib/apt/lists/* \
  && python3 --version \
  && pip3 --version \
  && npm install -g serve \
  && mkdir -p /app/data /app/data/docker /app/data/timestore /app/services

ENV NODE_ENV=production \
    PORT=4000 \
    HOST=0.0.0.0 \
    CATALOG_DB_PATH=/app/data/catalog.db \
    REDIS_URL=redis://127.0.0.1:6379 \
    FRONTEND_PORT=4173 \
    DATABASE_URL=postgres://apphub:apphub@127.0.0.1:5432/apphub \
    POSTGRES_USER=apphub \
    POSTGRES_PASSWORD=apphub \
    POSTGRES_DB=apphub \
    POSTGRES_PORT=5432 \
    PGDATA=/app/data/postgres \
    TIMESTORE_DATABASE_URL=postgres://apphub:apphub@127.0.0.1:5432/apphub \
    TIMESTORE_PG_SCHEMA=timestore \
    TIMESTORE_STORAGE_ROOT=/app/data/timestore \
    TIMESTORE_HOST=0.0.0.0 \
    TIMESTORE_PORT=4200 \
    FILESTORE_DATABASE_URL=postgres://apphub:apphub@127.0.0.1:5432/apphub \
    FILESTORE_PG_SCHEMA=filestore \
    FILESTORE_HOST=0.0.0.0 \
    FILESTORE_PORT=4300 \
    FILESTORE_REDIS_URL=redis://127.0.0.1:6379

COPY --from=builder /app/node_modules node_modules
COPY --from=builder /app/packages packages
COPY --from=builder /app/services/catalog/package.json services/catalog/package.json
COPY --from=builder /app/services/catalog/package-lock.json services/catalog/package-lock.json
COPY --from=builder /app/services/catalog/node_modules services/catalog/node_modules
COPY --from=builder /app/services/catalog/dist services/catalog/dist
COPY --from=builder /app/services/metastore/package.json services/metastore/package.json
COPY --from=builder /app/services/metastore/node_modules services/metastore/node_modules
COPY --from=builder /app/services/metastore/dist services/metastore/dist
COPY --from=builder /app/services/timestore/package.json services/timestore/package.json
COPY --from=builder /app/services/timestore/node_modules services/timestore/node_modules
COPY --from=builder /app/services/timestore/dist services/timestore/dist
COPY --from=builder /app/services/filestore/package.json services/filestore/package.json
COPY --from=builder /app/services/filestore/node_modules services/filestore/node_modules
COPY --from=builder /app/services/filestore/dist services/filestore/dist
COPY --from=builder /app/apps/cli apps/cli
COPY --from=builder /app/examples examples
COPY --from=builder /app/apps/frontend/dist apps/frontend/dist
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

[program:docker]
command=/usr/bin/dockerd --log-level=warn --host=unix:///var/run/docker.sock --data-root=/app/data/docker
priority=15
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

[program:metastore-api]
command=node services/metastore/dist/server.js
directory=/app
environment=PORT=4100,HOST=0.0.0.0
priority=25
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:filestore-api]
command=node services/filestore/dist/server.js
directory=/app
environment=FILESTORE_HOST=0.0.0.0,FILESTORE_PORT=4300
priority=26
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:filestore-reconcile]
command=node services/filestore/dist/reconciliation/worker.js
directory=/app
priority=27
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:timestore-api]
command=node services/timestore/dist/server.js
directory=/app
environment=TIMESTORE_HOST=0.0.0.0,TIMESTORE_PORT=4200,TIMESTORE_STORAGE_ROOT=/app/data/timestore
priority=30
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:timestore-ingest]
command=node services/timestore/dist/workers/ingestionWorker.js
directory=/app
priority=31
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:timestore-lifecycle]
command=node services/timestore/dist/workers/lifecycleWorker.js
directory=/app
priority=32
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:ingestion-worker]
command=node services/catalog/dist/ingestionWorker.js
directory=/app
priority=35
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:build-worker]
command=node services/catalog/dist/buildWorker.js
directory=/app
priority=45
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:example-bundle-worker]
command=node services/catalog/dist/exampleBundleWorker.js
directory=/app
priority=47
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:event-ingress-worker]
command=node services/catalog/dist/eventIngressWorker.js
directory=/app
priority=48
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:event-trigger-worker]
command=node services/catalog/dist/eventTriggerWorker.js
directory=/app
priority=49
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:workflow-worker]
command=node services/catalog/dist/workflowWorker.js
directory=/app
priority=50
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:launch-worker]
command=node services/catalog/dist/launchWorker.js
directory=/app
priority=55
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:auto-materializer-worker]
command=node services/catalog/dist/assetMaterializerWorker.js
directory=/app
priority=60
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:frontend]
command=serve -s apps/frontend/dist -l tcp://0.0.0.0:%(ENV_FRONTEND_PORT)s --no-port-switching
directory=/app
priority=65
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
SUPERVISOR

EXPOSE 4000 4173 4200 4300 6379

CMD ["supervisord", "-n"]
