import { render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { JobBundleVersionSummary, JobDefinitionSummary, ServiceSummary } from '../../api';
import type { WorkflowDraftStep } from '../../types';
import { WorkflowStepCard, type BundleVersionState } from '../WorkflowStepCard';

describe('WorkflowStepCard', () => {
  it('auto-selects the first pinned bundle version when none is set', async () => {
    const timestamp = new Date().toISOString();
    const jobDefinition: JobDefinitionSummary = {
      id: 'job-asset',
      slug: 'asset-job',
      name: 'Asset Job',
      version: 1,
      type: 'batch',
      runtime: 'node',
      entryPoint: 'bundle:asset.bundle@1.0.0#handler',
      registryRef: null,
      parametersSchema: {},
      defaultParameters: {},
      outputSchema: {},
      timeoutMs: null,
      retryPolicy: null,
      metadata: null,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    const initialStep: WorkflowDraftStep = {
      id: 'asset-step',
      name: 'Asset Step',
      type: 'job',
      jobSlug: 'asset-job',
      description: null,
      dependsOn: [],
      parameters: {},
      timeoutMs: null,
      retryPolicy: null,
      parametersText: '',
      parametersError: null,
      bundle: {
        strategy: 'pinned',
        slug: 'asset.bundle',
        version: '',
        exportName: null
      }
    };

    const versionSummary: JobBundleVersionSummary = {
      id: 'asset.bundle@1.2.3',
      version: '1.2.3',
      status: 'released',
      immutable: false,
      publishedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    const bundleVersionState: Record<string, BundleVersionState> = {
      'asset.bundle': {
        versions: [versionSummary],
        loading: false,
        error: null
      }
    };

    const onLoadBundleVersions = vi.fn(async () => undefined);
    const onUpdateSpy = vi.fn<(next: WorkflowDraftStep) => void>();

    function Harness() {
      const [step, setStep] = useState<WorkflowDraftStep>(initialStep);
      return (
        <WorkflowStepCard
          step={step}
          index={0}
          allSteps={[step]}
          jobs={[jobDefinition]}
          services={[] as ServiceSummary[]}
          bundleVersionState={bundleVersionState}
          onLoadBundleVersions={onLoadBundleVersions}
          errors={[]}
          onUpdate={(updater) => {
            setStep((current) => {
              const next = updater(current);
              onUpdateSpy(next);
              return next;
            });
          }}
          onRemove={() => undefined}
          onMoveUp={() => undefined}
          onMoveDown={() => undefined}
        />
      );
    }

    render(<Harness />);

    await waitFor(() => expect(onUpdateSpy).toHaveBeenCalled());
    expect(onLoadBundleVersions).toHaveBeenCalledWith('asset.bundle');

    const updatedStep = onUpdateSpy.mock.calls.at(-1)?.[0];
    expect(updatedStep?.bundle?.strategy).toBe('pinned');
    expect(updatedStep?.bundle?.version).toBe('1.2.3');
  });

  it('renders validation feedback for missing service request paths', () => {
    const timestamp = new Date().toISOString();
    const service: ServiceSummary = {
      id: 'svc-1',
      slug: 'webhook-service',
      displayName: 'Webhook service',
      kind: 'http',
      baseUrl: 'https://example.invalid',
      status: 'healthy',
      statusMessage: null,
      metadata: null,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    const step: WorkflowDraftStep = {
      id: 'notify',
      name: 'Notify external system',
      type: 'service',
      serviceSlug: 'webhook-service',
      description: null,
      dependsOn: [],
      parameters: {},
      timeoutMs: null,
      retryPolicy: null,
      parametersText: '',
      parametersError: null,
      request: { method: 'POST', path: '' },
      requestBodyText: '',
      requestBodyError: null
    };

    render(
      <WorkflowStepCard
        step={step}
        index={0}
        allSteps={[step]}
        jobs={[] as JobDefinitionSummary[]}
        services={[service]}
        bundleVersionState={{}}
        onLoadBundleVersions={async () => undefined}
        errors={[{ path: 'notify.request.path', message: 'Provide a request path for the service step.' }]}
        onUpdate={() => undefined}
        onRemove={() => undefined}
        onMoveUp={() => undefined}
        onMoveDown={() => undefined}
      />
    );

    expect(screen.getByText('Provide a request path for the service step.')).toBeInTheDocument();
  });
});
