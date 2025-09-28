# Retry Operations Observability

Operators can now monitor and control durable retries across event ingress, trigger deliveries, and workflow steps directly from the admin experience.

## UI Controls

The **Admin → Event Triggers** panel surfaces three retry backlogs:

- **Event retries** show queued event-ingress replays with attempt counts, upcoming run times, and overdue badges.
- **Trigger retries** list delayed workflow trigger deliveries, including workflow slug and dedupe context.
- **Workflow step retries** reveal pending step resumptions for running workflows.

Each entry exposes two actions:

- **Cancel** – marks the retry state as `cancelled`, removes any queued job, and keeps metadata for audit trails.
- **Run now** – requeues the retry with zero delay, emitting a lifecycle event so dashboards and logs reflect the manual intervention.

Buttons are disabled when the current session lacks `workflows:run` scope or while an action is pending.

## Metrics & Dashboards

The `/metrics` endpoint now embeds a `retries` block summarising backlog totals, overdue counts, and the oldest scheduled timestamp for each category. Default dashboards track:

- Pending vs. overdue retries for events, triggers, and workflow steps.
- The oldest scheduled timestamp per backlog to highlight prolonged stalls.
- Lifecycle events (`retry.*`) emitted whenever retries are cancelled or queued manually.

Use these series to annotate existing workflow health dashboards or build dedicated retry views.

## Alerts

Configure backlog alerts via environment variables:

- `RETRY_BACKLOG_ALERT_THRESHOLD` (default `25`) – triggers when any backlog meets/exceeds this count.
- `RETRY_BACKLOG_ALERT_WINDOW_MINUTES` (default `10`) – suppresses repeat alerts for the same category within the window.

Alerts reuse `WORKFLOW_ALERT_WEBHOOK_URL`/`WORKFLOW_ALERT_WEBHOOK_TOKEN` and emit `retry.backlog.threshold` payloads summarising totals, overdue count, and oldest scheduled retry.

## API Reference

Use the following endpoints for scripted interventions:

- `POST /admin/retries/events/:eventId/cancel`
- `POST /admin/retries/events/:eventId/force`
- `POST /admin/retries/deliveries/:deliveryId/cancel`
- `POST /admin/retries/deliveries/:deliveryId/force`
- `POST /admin/retries/workflow-steps/:stepId/cancel`
- `POST /admin/retries/workflow-steps/:stepId/force`

All endpoints require `workflows:run` scope and respond with `200` (cancel) or `202` (force) on success.

## Checklist

1. Review retry backlogs from **Admin → Event Triggers** for overdue entries.
2. Use dashboard panels to confirm backlog trendlines and oldest scheduled timings.
3. Verify alert receipts through the shared workflow webhook channel.
4. Cancel or rerun retries as needed via UI or API; document interventions with emitted lifecycle events.
