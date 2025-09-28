# Ticket 185: Document and Validate the Minikube Kubernetes Stack

## Problem
Even after automation exists, teams need authoritative documentation and validation to trust the Kubernetes transition. Currently README content focuses on Docker-in-Docker workflows, and `docs/runbooks/remote-build-launch.md` only sketches the minikube steps without covering the new infrastructure, helm commands, or troubleshooting for the full stack. Lack of cohesive documentation and automated smoke tests leaves gaps for onboarding and regression prevention.

## Scope
- Update repository documentation (README, docs/ runbooks) to reflect the Kubernetes-first workflow and turnkey command introduced in Ticket 184.
- Provide validation scripts/tests that confirm key functionality after deployment (API health, worker queues, MinIO bucket readiness, frontend availability).
- Capture troubleshooting playbooks for common failure modes (image load issues, Pending pods due to storage, build job RBAC errors).

## Implementation
- Rewrite the README “Docker Images” section to point to the new Kubernetes workflow, demote the legacy monolithic container to an appendix, and add high-level steps for minikube + production clusters.
- Expand `docs/runbooks/remote-build-launch.md` with exact commands using the new charts and turnkey script, including service account creation, registry configuration, and cleanup.
- Create `docs/runbooks/minikube-bootstrap.md` (or similar) covering prerequisites, the bootstrap command, verifying pods, and port-forwarding/Ingress guidance.
- Add an automated smoke test script (Node or shell) under `scripts/` that runs after deployment to hit `/healthz` endpoints, ensure queues are connected (via Redis INFO), and confirm MinIO bucket contents. Integrate it into the turnkey command or provide `npm run minikube:verify`.
- Update CHANGELOG or migration notes calling out the shift from Docker runtime to Kubernetes.

## Acceptance Criteria
- Documentation changes reviewed by platform + developer experience stakeholders; instructions are copy/paste friendly and accurate.
- A fresh engineer can follow the updated docs to bootstrap minikube without referring to external notes.
- Automated smoke test exits zero when all services are healthy, and fails with actionable messages otherwise.
- Legacy Docker workflow remains documented but clearly marked deprecated, with pointers to the new path.

## Rollout & Risks
- Docs must stay synchronized with automation; include a maintenance note referencing the relevant scripts to avoid drift.
- Automated smoke tests depend on services being healthy—ensure they honor timeouts/retries to reduce flakiness.
- Communicate documentation updates broadly (Slack/email) so teams know the new source of truth.
