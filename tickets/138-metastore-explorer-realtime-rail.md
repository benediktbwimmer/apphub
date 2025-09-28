# Ticket 138 – Metastore Explorer Realtime Activity & Health Rail

## Summary
Wire the explorer UI into the new realtime stream and filestore health APIs to surface live record activity, sync lag warnings, and stream connection status alongside search results.

## Motivation
Operators monitor ingestion and sync behavior by repeatedly refreshing the page. Providing a live feed and health indicators reduces toil, shortens issue detection time, and demonstrates platform responsiveness.

## Scope
- Establish an SSE client (with reconnect/backoff) that subscribes to metastore record events; display a live ticker or timeline showing recent mutations for the selected namespace.
- Add a health rail component that polls `GET /filestore/health` on an interval, displaying current lag, last event timestamp, and warning states when thresholds are exceeded.
- Surface stream status (connected, reconnecting, disconnected) with guidance (e.g., copy curl command) for debugging.
- Allow users to pause the live feed to inspect historical entries without auto-scrolling; resumed playback should catch up.
- Cover the new components with Vitest and interaction tests (mocked EventSource and fetch).

## Acceptance Criteria
- Live feed only shows events relevant to the active namespace (filter client-side or request namespace-scope on subscribe).
- Health rail transitions between OK/Warn/Critical states based on thresholds provided by Ticket 137.
- Stream reconnect logic handles server restarts without overwhelming the backend.
- Tests verify event rendering, pause/resume, and health status visuals.

## Dependencies / Notes
- Depends on Ticket 137 for backend streaming and health endpoints.
- Coordinate with design on live feed visual style and accessibility considerations for motion.
