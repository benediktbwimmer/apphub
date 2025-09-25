# syntax=docker/dockerfile:1

FROM node:20-slim AS build
WORKDIR /app

# Limit the build context to the service directory so npm
# installs and the compiler only see the files they need.
ARG SERVICE_PATH=examples/environmental-observatory/services/observatory-file-watcher

COPY ${SERVICE_PATH}/package.json ${SERVICE_PATH}/package-lock.json ./
RUN npm ci

COPY ${SERVICE_PATH}/tsconfig.json ./tsconfig.json
COPY ${SERVICE_PATH}/src ./src
RUN npm run build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

ARG SERVICE_PATH=examples/environmental-observatory/services/observatory-file-watcher

COPY ${SERVICE_PATH}/package.json ${SERVICE_PATH}/package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
CMD ["node", "dist/index.js"]
