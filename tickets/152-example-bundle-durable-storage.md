# Ticket 152: Move Example Bundle Status & Artifacts to Durable Storage

## Problem
Example bundle progress and packaged artifacts currently live on the catalog pod filesystem (`services/catalog/data/example-bundles`). In a multi-pod setup—including local minikube—we lose visibility into job status and cache reuse whenever traffic lands on a different pod.

## Scope
Persist bundle status metadata in Postgres and push bundle archives to object storage so every pod (remote or minikube) sees the same state.

## Implementation
- Create tables `example_bundle_status` and `example_bundle_artifacts` with fields for slug, fingerprint, stage, state, jobId, timestamps, storage URL, checksum, size.
- Integrate MinIO/S3 support: add a storage client abstraction (S3-compatible API). For minikube, provision a MinIO instance via Helm chart and document access credentials.
- Refactor `exampleBundles/statusStore.ts` and `exampleBundles/manager.ts` to read/write through the database + storage client. Remove filesystem persistence except for transient temp directories during bundling.
- Implement a migration CLI (`npm run migrate:example-bundles`) that reads existing status files, uploads any archived bundles to object storage, and stores metadata in the new tables.
- Update event emission to include storage URLs accessible from both environments (signed or internal service URL).

## Acceptance Criteria
- Running two catalog pods in minikube shows consistent bundle progress and allows reusing cached bundles.
- Upload, retry, and failure paths are covered by integration tests (including storage mocks).
- Old filesystem directory is no longer required; health checks warn if the directory contains stale data post-migration.
- Documentation instructs developers to start MinIO in minikube and set `APPHUB_BUNDLE_STORAGE_ENDPOINT` etc.

## Rollout & Risks
- Dual-write during migration: gate new persistence behind a feature flag, run the migration, validate counts, then cut over reads.
- Ensure storage credentials are scoped per environment; add security review for signed URL exposure.
