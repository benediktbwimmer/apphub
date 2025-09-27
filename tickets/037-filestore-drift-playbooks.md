# Ticket 037: Deliver Filestore Drift Playbooks

## Problem
When filestore nodes enter drift or inconsistent states, operators must manually reconcile the steps needed to heal them. The UI exposes events and reconciliation enqueue actions, but there is no guided playbook tying drift states to remediation workflows.

## Proposal
- Map drift states to recommended actions (e.g., run reconciliation workflow, inspect recent commands) and surface these in the explorer sidebar.
- Provide one-click triggers for associated workflows/bundles using existing enqueue helpers.
- Capture playbook outcomes in telemetry to evaluate effectiveness and iterate on guidance.
- Author documentation describing the automated playbooks and how to extend them.

## Deliverables
- UI updates presenting state-specific playbooks within the filestore explorer.
- Backend wiring (if needed) to look up associated workflows/bundles.
- Documentation outlining default playbooks and extension points.

## Risks & Mitigations
- **Workflow availability:** Ensure recommended workflows exist in the environment; fall back to manual guidance when missing.
- **Operator overload:** Keep the guidance contextual and concise to avoid overwhelming the UI.
