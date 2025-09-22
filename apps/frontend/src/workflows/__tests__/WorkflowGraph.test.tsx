import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import WorkflowGraph from '../components/WorkflowGraph';
import type { WorkflowDefinition, WorkflowRun, WorkflowRunStep } from '../types';

describe('WorkflowGraph', () => {
  it('renders nodes with statuses, durations, and links', () => {
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
        logsUrl: null
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
  });
});
