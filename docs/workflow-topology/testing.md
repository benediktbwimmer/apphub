# Workflow Topology UI Regression Tests

Playwright covers the topology explorer to guard against theme regressions, invisible edges, and virtualization bugs that surface after long sessions.

## Prerequisites
- Install repo dependencies: `npm install`
- Install Playwright browsers once per machine: `npx playwright install`

## Running the suite
```sh
npm run test:ui --workspace @apphub/frontend
```
The command launches the Vite dev server automatically and runs the tests headlessly against a mocked core API. Use `FRONTEND_UI_PORT` to override the server port if the default `4173` is occupied.

## Fixtures and stubs
Topology scenarios reuse the shared `createSmallWorkflowGraph` fixture to seed deterministic responses. Playwright intercepts `/auth/identity`, `/auth/api-keys`, `/workflows/graph`, and `/admin/event-health` so the UI renders without the backend. Update those fixtures in `apps/frontend/tests/topology/topology.spec.ts` when the canonical graph sample changes.

## CI expectations
Pipelines should invoke `npm run test:ui --workspace @apphub/frontend`. The job fails on any visual regression, dark-mode contrast issue, or node virtualization error detected by the suite.
