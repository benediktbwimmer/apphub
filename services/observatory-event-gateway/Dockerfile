# syntax=docker/dockerfile:1

FROM node:20-slim AS build
WORKDIR /app

ARG SERVICE_PATH=services/observatory-event-gateway

COPY ${SERVICE_PATH}/package.json ${SERVICE_PATH}/package-lock.json ./
RUN npm ci

COPY ${SERVICE_PATH}/tsconfig.json ./tsconfig.json
COPY ${SERVICE_PATH}/src ./src
RUN npm run build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

ARG SERVICE_PATH=services/observatory-event-gateway

COPY ${SERVICE_PATH}/package.json ${SERVICE_PATH}/package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
CMD ["node", "dist/index.js"]
