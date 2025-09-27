# Ticket 082: Descriptor-Driven Example Bundler

## Problem Statement
The example bundler (`@apphub/example-bundler`) only supports slugs defined in the static registry and reads sources directly from the monorepo. External example repositories cannot package themselves without upstream code changes, blocking full decoupling. With descriptors providing manifest locations and metadata, the bundler should resolve examples dynamically and support remote descriptors.

## Goals
- Teach the bundler to accept a descriptor (local path or git reference) and produce bundles using the manifest/job paths it declares, without relying on `@apphub/examples-registry`.
- Allow the catalog service to trigger bundling for any descriptor-resolved example, including ones pulled at runtime via import.
- Preserve caching and packaging behaviours while broadening input sources beyond hard-coded slugs.

## Non-Goals
- Rewriting package assembly logic or altering the bundle format; focus on input discovery.
- Implementing descriptor signing or trust policies (can be tackled separately once dynamic loading is in place).

## Implementation Sketch
1. Introduce a descriptor parser inside the bundler that can resolve file paths relative to a provided workspace (local dir or cloned git repo). Support the legacy slug pathway during migration by adapting slugs to descriptors discovered from Ticket 081.
2. Update bundler APIs (`ExampleBundler.packageExampleBySlug`, catalog manager) to accept descriptor references (path/repo/ref) and hydrate the job/workflow artifacts listed in the descriptor.
3. Add caching fingerprints based on descriptor contents (hash of config + manifests) so existing cache behaviour continues to work for remote sources.
4. Extend catalog integrations to pass descriptor references when queueing bundle jobs, removing the hard dependency on static slugs.
5. Create tests covering local and remote descriptor inputs, cache hits, and failure cases (missing manifests, invalid descriptors).

## Deliverables
- Bundler accepting descriptor-based inputs with backward-compatible slug support.
- Catalog queue/manager updated to queue bundling jobs using descriptor references.
- Automated tests verifying packaging from local and git-sourced descriptors, including cache reuse.
- Migration notes for CLI or automation tooling relying on the old slug-only interface.
