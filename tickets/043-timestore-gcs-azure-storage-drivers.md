# Ticket 043: Timestore GCS & Azure Blob Storage Drivers

## Problem Statement
Timestore's schema and admin APIs already recognize storage targets of kind `gcs` and `azure_blob`, yet the service only ships drivers for local disk and S3. Attempting to register a GCS or Azure target currently fails with an "unsupported storage target" error, blocking teams that rely on those clouds from onboarding to timestore.

## Goals
- Implement first-party partition writers for Google Cloud Storage and Azure Blob Storage that mirror the behavior and checksum guarantees of the existing S3 driver.
- Allow storage target configuration (credentials, endpoints, path style) to be supplied via the existing metadata tables and service config.
- Cover new drivers with integration tests that exercise write + cleanup flows and ensure manifests reference the correct object URIs.
- Document any required environment variables or IAM scopes for running against GCS/Azure in development and production.

## Non-Goals
- Providing a generic pluggable driver marketplace; focus on the two officially supported cloud providers.
- Reworking the storage target schema or migration history—reuse the current table structure.

## Implementation Sketch
1. Extend `services/timestore/src/storage/index.ts` with driver classes for `gcs` (leveraging `@google-cloud/storage`) and `azure_blob` (using `@azure/storage-blob`).
2. Normalize configuration loading so credentials can be sourced either from the storage target record or service env vars, matching the existing S3 precedence rules.
3. Update `resolvePartitionLocation` to emit `gs://` or `azure://` URIs and ensure DuckDB HTTPFS can stream them when querying (introduce any required DuckDB extensions or signed URLs).
4. Add integration tests that run the drivers against fake servers (e.g., `@google-cloud/storage` emulator, `Azurite`) or mocked transports to verify checksum, row count, and manifest wiring.
5. Update documentation (README + `.env.example`) to describe how to configure timestore for GCS/Azure, including permissions and any region/endpoint flags.

## Deliverables
- New storage driver implementations for GCS and Azure blob that pass lint/test suites and slot into the existing `createStorageDriver` factory.
- Automated tests covering partition writes, checksum calculation, and manifest URL generation for both clouds.
- Updated service docs outlining configuration knobs and operational expectations for the new targets.
