import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import WorkflowGraph from '../components/WorkflowGraph';
import type { WorkflowDefinition, WorkflowRun, WorkflowRunStep } from '../types';

describe('WorkflowGraph', () => {
  it('renders nodes with statuses, durations, and links', async () => {
    const workflow: WorkflowDefinition = {
      id: 'wf-graph',
      slug: 'graph',
      name: 'Graph Workflow',
      description: null,
      version: 1,
      steps: [
        {
          id: 'extract',
          name: 'Extract',
          jobSlug: 'job.extract',
          dependents: ['transform']
        },
        {
          id: 'transform',
          name: 'Transform',
          jobSlug: 'job.transform',
          dependsOn: ['extract'],
          dependents: ['load']
        },
        {
          id: 'load',
          name: 'Load',
          serviceSlug: 'svc.load',
          dependsOn: ['transform'],
          dependents: []
        }
      ],
      triggers: [{ type: 'manual' }],
      parametersSchema: {},
      defaultParameters: {},
      outputSchema: {},
      metadata: {},
      dag: {
        roots: ['extract'],
        adjacency: {
          extract: ['transform'],
          transform: ['load'],
          load: []
        },
        topologicalOrder: ['extract', 'transform', 'load'],
        edges: 2
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const run: WorkflowRun = {
      id: 'run-graph',
      workflowDefinitionId: workflow.id,
      status: 'running',
      currentStepId: 'transform',
      currentStepIndex: 1,
      startedAt: new Date().toISOString(),
      completedAt: null,
      durationMs: null,
      errorMessage: null,
      triggeredBy: 'tester@apphub.test',
      partitionKey: null,
      metrics: { totalSteps: 3, completedSteps: 1 },
      parameters: {},
      context: {
        steps: {
          extract: { status: 'succeeded', startedAt: new Date().toISOString(), completedAt: new Date().toISOString() },
          transform: { status: 'running' }
        }
      },
      output: null,
      trigger: { type: 'manual' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const steps: WorkflowRunStep[] = [
      {
        id: 'step-run-extract',
        workflowRunId: run.id,
        stepId: 'extract',
        status: 'succeeded',
        attempt: 1,
        jobRunId: 'jobrun-extract',
        startedAt: new Date(Date.now() - 5000).toISOString(),
        completedAt: new Date(Date.now() - 3000).toISOString(),
        errorMessage: null,
        logsUrl: 'https://example.com/extract/logs',
        metrics: { durationMs: 2000 }
      },
      {
        id: 'step-run-transform',
        workflowRunId: run.id,
        stepId: 'transform',
        status: 'running',
        attempt: 1,
        jobRunId: 'jobrun-transform',
        startedAt: new Date(Date.now() - 2000).toISOString(),
        completedAt: null,
        errorMessage: null,
        logsUrl: 'https://example.com/transform/logs',
        parameters: { foo: 'bar' },
        result: { recordsProcessed: 12 }
      },
      {
        id: 'step-run-load',
        workflowRunId: run.id,
        stepId: 'load',
        status: 'pending',
        attempt: 0,
        jobRunId: null,
        startedAt: null,
        completedAt: null,
        errorMessage: null,
        logsUrl: null
      }
    ];

    render(<WorkflowGraph workflow={workflow} run={run} steps={steps} runtimeSummary={undefined} />);

    const extractCard = screen.getByText('Extract').closest('article');
    expect(extractCard).not.toBeNull();
    const extract = within(extractCard as HTMLElement);
    expect(extract.getByText(/job.extract/)).toBeVisible();
    expect(extract.getByText(/succeeded/i)).toBeVisible();
    expect(extract.getByRole('link', { name: /view logs/i })).toHaveAttribute('href', 'https://example.com/extract/logs');

    const transformCard = screen.getByText('Transform').closest('article');
    expect(transformCard).not.toBeNull();
    expect(within(transformCard as HTMLElement).getByText(/running/i)).toBeVisible();

    const loadCard = screen.getByText('Load').closest('article');
    expect(loadCard).not.toBeNull();
    expect(within(loadCard as HTMLElement).getByText(/pending/i)).toBeVisible();

    const connectors = document.querySelectorAll('svg path');
    expect(connectors.length).toBeGreaterThanOrEqual(2);

    const detailsPanel = screen.getByTestId('workflow-step-details');
    expect(detailsPanel).toHaveTextContent('Select a step to inspect its run details.');

    const user = userEvent.setup();
    await user.click(screen.getByText('Transform'));

    expect(detailsPanel).toHaveTextContent('Transform');
    expect(detailsPanel).toHaveTextContent('job.transform');
    expect(detailsPanel).toHaveTextContent(/"foo": "bar"/);
    expect(detailsPanel).toHaveTextContent(/"recordsProcessed": 12/);
    const logsLink = within(detailsPanel).getByRole('link', { name: /open logs/i });
    expect(logsLink).toHaveAttribute('href', 'https://example.com/transform/logs');
  });

  it('renders fan-out nodes with child summaries and details', async () => {
    const workflow: WorkflowDefinition = {
      id: 'wf-fanout',
      slug: 'fanout',
      name: 'Fanout Workflow',
      description: null,
      version: 1,
      steps: [
        {
          id: 'seed',
          name: 'Seed Items',
          type: 'job',
          jobSlug: 'job.seed'
        },
        {
          id: 'expand',
          name: 'Expand Items',
          type: 'fanout',
          dependsOn: ['seed'],
          collection: '{{ steps.seed.result.items }}',
          maxItems: 10,
          maxConcurrency: 2,
          storeResultsAs: 'processedItems',
          template: {
            id: 'process-item',
            name: 'Process Item',
            type: 'job',
            jobSlug: 'job.process'
          }
        },
        {
          id: 'collect',
          name: 'Collect Items',
          type: 'job',
          jobSlug: 'job.collect',
          dependsOn: ['expand']
        }
      ],
      triggers: [{ type: 'manual' }],
      parametersSchema: {},
      defaultParameters: {},
      outputSchema: {},
      metadata: {},
      dag: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const startedAt = new Date(Date.now() - 5000).toISOString();
    const completedAt = new Date(Date.now() - 3000).toISOString();

    const run: WorkflowRun = {
      id: 'run-fanout',
      workflowDefinitionId: workflow.id,
      status: 'succeeded',
      currentStepId: null,
      currentStepIndex: null,
      startedAt,
      completedAt,
      durationMs: 5000,
      errorMessage: null,
      triggeredBy: 'tester@apphub.test',
      partitionKey: null,
      metrics: { totalSteps: 3, completedSteps: 3 },
      parameters: {},
      context: {
        steps: {
          expand: { status: 'succeeded', output: { totalChildren: 2 } }
        }
      },
      output: null,
      trigger: { type: 'manual' },
      createdAt: startedAt,
      updatedAt: completedAt
    };

    const steps: WorkflowRunStep[] = [
      {
        id: 'step-seed',
        workflowRunId: run.id,
        stepId: 'seed',
        status: 'succeeded',
        attempt: 1,
        jobRunId: 'jobrun-seed',
        startedAt,
        completedAt,
        errorMessage: null,
        logsUrl: null
      },
      {
        id: 'step-expand',
        workflowRunId: run.id,
        stepId: 'expand',
        status: 'succeeded',
        attempt: 1,
        jobRunId: 'jobrun-expand',
        startedAt,
        completedAt,
        errorMessage: null,
        logsUrl: null,
        output: { totalChildren: 2 }
      },
      {
        id: 'step-collect',
        workflowRunId: run.id,
        stepId: 'collect',
        status: 'pending',
        attempt: 0,
        jobRunId: null,
        startedAt: null,
        completedAt: null,
        errorMessage: null,
        logsUrl: null
      },
      {
        id: 'step-expand-child-0',
        workflowRunId: run.id,
        stepId: 'expand#0',
        status: 'succeeded',
        attempt: 1,
        jobRunId: 'jobrun-child-0',
        startedAt,
        completedAt,
        errorMessage: null,
        logsUrl: null,
        parentStepId: 'expand',
        fanoutIndex: 0,
        templateStepId: 'process-item'
      },
      {
        id: 'step-expand-child-1',
        workflowRunId: run.id,
        stepId: 'expand#1',
        status: 'succeeded',
        attempt: 1,
        jobRunId: 'jobrun-child-1',
        startedAt,
        completedAt,
        errorMessage: null,
        logsUrl: null,
        parentStepId: 'expand',
        fanoutIndex: 1,
        templateStepId: 'process-item'
      }
    ];

    render(<WorkflowGraph workflow={workflow} run={run} steps={steps} runtimeSummary={undefined} />);

    const expandCard = screen.getByText('Expand Items').closest('article');
    expect(expandCard).not.toBeNull();
    const expand = within(expandCard as HTMLElement);
    expect(expand.getByText(/Fan Out/i)).toBeVisible();
    expect(expand.getByText('Children')).toBeVisible();
    expect(expand.getByText('2', { selector: 'dd' })).toBeVisible();
    expect(expand.getByText(/Template: Process Item/i)).toBeVisible();

    const user = userEvent.setup();
    await user.click(screen.getByText('Expand Items'));

    const details = within(screen.getByTestId('workflow-step-details'));
    expect(details.getByText('Child runs')).toBeVisible();
    const childList = details.getByRole('list');
    const childItems = within(childList).getAllByRole('listitem');
    expect(childItems).toHaveLength(2);
    expect(details.getByText(/Index #0/)).toBeVisible();
    expect(details.getByText(/Index #1/)).toBeVisible();
    expect(details.getByText(/Process Item/)).toBeVisible();
  });

  it('limits rendered fan-out children and shows overflow notice', async () => {
    const workflow: WorkflowDefinition = {
      id: 'wf-fanout-overflow',
      slug: 'fanout-overflow',
      name: 'Fanout Overflow',
      description: null,
      version: 1,
      steps: [
        { id: 'seed', name: 'Seed', type: 'job', jobSlug: 'job.seed' },
        {
          id: 'expand',
          name: 'Expand',
          type: 'fanout',
          dependsOn: ['seed'],
          collection: [],
          template: { id: 'process', name: 'Process', type: 'job', jobSlug: 'job.process' }
        }
      ],
      triggers: [{ type: 'manual' }],
      parametersSchema: {},
      defaultParameters: {},
      outputSchema: {},
      metadata: {},
      dag: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const run: WorkflowRun = {
      id: 'run-overflow',
      workflowDefinitionId: workflow.id,
      status: 'succeeded',
      currentStepId: null,
      currentStepIndex: null,
      startedAt: null,
      completedAt: null,
      durationMs: null,
      errorMessage: null,
      triggeredBy: null,
      partitionKey: null,
      metrics: null,
      parameters: {},
      context: {},
      output: null,
      trigger: { type: 'manual' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const parentStep: WorkflowRunStep = {
      id: 'run-expand',
      workflowRunId: run.id,
      stepId: 'expand',
      status: 'running',
      attempt: 1,
      jobRunId: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
      errorMessage: null,
      logsUrl: null
    };

    const fanoutChildren: WorkflowRunStep[] = Array.from({ length: 205 }, (_, index) => ({
      id: `run-expand-child-${index}`,
      workflowRunId: run.id,
      stepId: `expand#${index}`,
      status: index % 3 === 0 ? 'failed' : index % 2 === 0 ? 'running' : 'succeeded',
      attempt: 1,
      jobRunId: null,
      startedAt: new Date().toISOString(),
      completedAt: index % 2 === 1 ? new Date().toISOString() : null,
      errorMessage: index % 3 === 0 ? `Failure ${index}` : null,
      logsUrl: null,
      parentStepId: 'expand',
      fanoutIndex: index,
      templateStepId: 'process'
    }));

    render(
      <WorkflowGraph
        workflow={workflow}
        run={run}
        steps={[parentStep, ...fanoutChildren]}
        runtimeSummary={undefined}
      />
    );

    const user = userEvent.setup();
    await user.click(screen.getByText('Expand'));

    const details = within(screen.getByTestId('workflow-step-details'));
    const childList = details.getByRole('list');
    const childItems = within(childList).getAllByRole('listitem');
    expect(childItems.length).toBe(200);
    expect(details.getByText(/Showing first 200 of 205 child runs/i)).toBeVisible();
  });
});
