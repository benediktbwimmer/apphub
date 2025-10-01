# Filestore Drift Playbooks

The filestore explorer now ships with guided remediation playbooks that adapt to the selected node state. Each playbook sits alongside the existing metadata/children panels and offers quick actions (reconciliation jobs, workflow triggers, or documentation links) so operators no longer have to memorise recovery steps.

## Default mapping

| Node state    | Playbook title              | Primary actions                                                                                           |
| ------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `inconsistent`| Heal inconsistent node      | Queue a drift-scoped reconciliation, trigger the `filestore-drift-audit` workflow, inspect recent commands |
| `missing`     | Investigate missing node    | Run an audit reconciliation (with child detection), trigger `filestore-restore-missing-node`, review audits|
| `unknown`     | Triage unknown state        | Enqueue a manual sweep, trigger `filestore-manual-sweep-report` to capture filesystem snapshots            |

Actions that rely on automation stay disabled when the corresponding workflow has not been registered. The sidebar copies this fact directly so platform owners know which slug to publish.

## Wiring the workflows

The playbooks assume the following workflow slugs are available in the core service:

- `filestore-drift-audit` – compiles watcher signals and recent commands into an audit artefact.
- `filestore-restore-missing-node` – restores or archives paths flagged as missing.
- `filestore-manual-sweep-report` – captures a manual snapshot when watcher coverage is unknown.

Publish or import these slugs through the workflow builder or CLI. Once present they are detected automatically (no additional configuration is needed). Until then, operators see contextual guidance instead of an enabled button.

## Telemetry

Playbook interactions emit analytics events so that remediation flows can be measured:

- `filestore.reconciliation.enqueued` / `filestore.reconciliation.failed`
- `filestore.playbook.workflow_triggered` / `filestore.playbook.workflow_failed`
- `filestore.playbook.link_clicked`

Each payload carries the node id, mount id, node state, playbook id, and action id so dashboard slices remain straightforward.

## Extending or customising

Edit `apps/frontend/src/filestore/playbooks.ts` when you need to add states, swap workflow slugs, or tune copy. The definitions expose straightforward TypeScript objects (titles, summaries, and action builders) so bespoke environments can inject additional workflows without touching service code. Remember to add companion documentation and to keep the workflow slugs aligned with the core.
