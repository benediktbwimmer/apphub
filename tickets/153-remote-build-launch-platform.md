# Ticket 153: Adopt Remote Build & Launch Platform

## Problem
`buildRunner` and `launchRunner` rely on the local Docker daemon and host volumes. Scaling beyond one node—or even running multiple catalog pods in minikube—causes contention on `/var/run/docker.sock` and inconsistent artifact paths.

## Scope
Shift builds and launches onto a Kubernetes-native workflow so both the remote cluster and the minikube environment use the same orchestration path.

## Implementation
- Decommission the Docker-in-Docker services and the existing custom Docker job runner; remove their Helm manifests, compose snippets, and catalog service wiring so new workloads no longer mount `/var/run/docker.sock` or depend on local Docker sockets.
- Introduce a builder service that spawns BuildKit pods/jobs in Kubernetes. Define a custom resource or Job template that clones repos, runs builds, and pushes images to the configured registry (local: minikube registry; prod: managed registry).
- Replace `buildRunner.ts` with a client that submits build jobs to the cluster, streams logs via Kubernetes API, and updates Postgres records accordingly.
- Rework `launchRunner.ts` to create Deployment/Service (or ephemeral Pods) in the cluster instead of `docker run`. Capture runtime metadata (service URL, pod name) and expose preview URLs through an ingress controller (Traefik/NGINX) that works in minikube.
- Add configuration/Helm charts for builder and launcher components, ensuring local values (minikube namespace) mirror production defaults.
- Implement cleanup controllers to garbage collect completed Jobs/Pods and deregister preview routes.

## Acceptance Criteria
- Builds launched from the catalog UI succeed via Kubernetes jobs in minikube and remote clusters, pushing images to the respective registries.
- Launch requests produce reachable preview URLs through the ingress controller in both environments, and metadata updates propagate to the service registry.
- Integration tests (can be marked e2e) cover build submission, log streaming, and launch lifecycle.
- Documentation provides step-by-step setup for minikube (enabling ingress, local registry) and production configuration.

## Rollout & Risks
- Keep legacy Docker path behind a feature flag during migration; compare build durations and success rates before deprecating.
- Monitor cluster resource usage; add quotas/limits to prevent runaway builds.
