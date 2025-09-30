# 413 - Ensure BullMQ is packaged for observatory benchmark jobs

## Context
The environmental observatory benchmark now runs far enough to package every example bundle and fire the data generator. The inbox normalizer publishes `observatory.minute.raw-uploaded` events successfully in isolation, but the end-to-end run continues to fail once it executes inside the sandbox. The catalog worker reports `Cannot find module 'bullmq'` when loading the packaged normalizer bundle.

## Current behaviour
- `observatory-inbox-normalizer` depends on `@apphub/event-bus`, which lazily requires BullMQ in queue mode.
- The example bundler copies the repo `node_modules/@apphub/...` tree into the bundle workspace, but BullMQ does not end up in the published tarball.
- During the benchmark, the sandboxed job resolves `@apphub/event-bus`, reaches the dynamic BullMQ require, and crashes before emitting the ingress event. The ingest workflow never launches and the benchmark times out.

## Desired outcome
- The packaged observatory bundles should include the BullMQ runtime dependency (or avoid the require entirely when running inline) so that the inbox normalizer can publish events successfully in the sandbox and unblock the benchmark run.

## Tasks
1. Investigate why `packages/event-bus` still emits `require('bullmq')` in the compiled bundle despite the dynamic loader changes.
2. Ensure BullMQ (and its transitive runtime files) are copied into the example bundle workspace or bundled into `event-bus` so the require succeeds at runtime.
3. Re-run `OBSERVATORY_BENCH_TIMEOUT_MS=180000 npx tsx examples/tests/catalog/environmentalObservatoryEventDrivenBenchmark.e2e.ts` to confirm the ingest workflow triggers and the benchmark completes.

## Notes
- Temporary workspaces are available under `/var/folders/.../apphub-example-observatory-inbox-normalizer-*` when `APPHUB_EXAMPLE_PRESERVE_WORKSPACE=1` is set; they show `node_modules/bullmq` missing from the final tarball.
- Benchmark logs currently show hundreds of retries with `handlerType: 'sandbox', error: "Cannot find module 'bullmq'"`.
