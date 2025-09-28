# Event Sampling Replay Runbook

Legacy workflow events published before metadata enrichment can leave the event sampling store sparse, which in turn hides producer relationships for topology overlays and stale-edge alerts. The replay worker hydrates the sampling table by inspecting historical events, resolving workflow context via `correlationId`, and upserting missing sample counters.

## When To Run
- Event sampling totals suddenly drop after a deployment.
- Stale edges alert without any recent workflow runtime changes.
- The `/admin/event-sampling` snapshot reports large `replay.pending` counts or repeated failures.

## Automated Worker
- Start the background worker locally: `npm run event-sampling:worker --workspace @apphub/catalog`.
- Environment knobs:
  - `EVENT_SAMPLING_REPLAY_LOOKBACK_MS` (default 7 days)
  - `EVENT_SAMPLING_REPLAY_CHUNK_SIZE` (default 200 events per cycle)
  - `EVENT_SAMPLING_REPLAY_INTERVAL_MS` (default 60s between idle cycles)
  - `EVENT_SAMPLING_REPLAY_MAX_ATTEMPTS` (default 5 retries per event)
- The worker logs cycle summaries and honours `SIGINT`/`SIGTERM` for clean shutdowns.

## Ad-hoc Replay
- CLI: `npm run event-sampling:replay --workspace @apphub/catalog -- --lookback-minutes 60 --limit 250`
  - `--dry-run` evaluates candidates without writing samples or replay state.
  - `--include-processed` lists already-succeeded events (skipped by default).
- Admin API (requires operator scopes):
  ```http
  POST /admin/event-sampling/replay
  {
    "lookbackMinutes": 120,
    "limit": 250,
    "maxAttempts": 5,
    "dryRun": false
  }
  ```
  The response mirrors the CLI summary (`processed`, `succeeded`, `failed`, `skipped`, `pending`, `errors`).

## Observability
- `GET /admin/event-sampling` now returns:
  - `staleCount` alongside `stale` sample records.
  - `replay.metrics` (`total`, `succeeded`, `failed`, `skipped`, `lastProcessedAt`, `lastFailure`).
  - `replay.pending` with the current lookback window bounds.
- Failures persist in `workflow_event_sampling_replay_state`; replays honour the per-event attempt ceiling and surface the last error for triage.

## Troubleshooting
1. **Replay pending stays non-zero** — check `replay.metrics.lastFailure` for the most recent error and inspect the referenced workflow run/step for lifecycle anomalies.
2. **Events missing correlation** — legacy publishers that never set `correlationId` cannot be backfilled automatically; patch the events at-source or inject context through targeted scripts.
3. **Double counting risk** — the replay stores per-event progress. Re-running the CLI with the default flags skips already-succeeded events, preserving sample counts.
