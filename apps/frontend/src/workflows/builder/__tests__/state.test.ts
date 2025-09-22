import { describe, expect, it } from 'vitest';
import {
  createEmptyDraft,
  workflowDefinitionToDraft,
  draftToCreateInput,
  draftToUpdateInput,
  validateWorkflowDraft,
  computeDraftDiff
} from '../state';
import type { WorkflowDefinition } from '../../types';
import type { JobDefinitionSummary } from '../../api';

const baseWorkflow: WorkflowDefinition = {
  id: 'wf-1',
  slug: 'deploy-app',
  name: 'Deploy app',
  description: 'Deploy the main service',
  version: 1,
  steps: [
    {
      id: 'build',
      name: 'Build job',
      type: 'job',
      jobSlug: 'build-app',
      dependsOn: [],
      parameters: { branch: 'main' },
      timeoutMs: null,
      retryPolicy: null,
      description: 'Compile application'
    },
    {
      id: 'deploy',
      name: 'Deploy service',
      type: 'service',
      serviceSlug: 'deployment-api',
      dependsOn: ['build'],
      request: { path: '/deploy', method: 'POST', body: { version: 'latest' } },
      captureResponse: true
    }
  ],
  triggers: [{ type: 'manual' }],
  parametersSchema: { type: 'object', properties: { env: { type: 'string' } } },
  defaultParameters: { env: 'staging' },
  outputSchema: {
    type: 'object',
    properties: {
      deploymentId: { type: 'string' }
    }
  },
  metadata: {
    owner: { name: 'Release team', contact: 'release@apphub.test' },
    tags: ['deployment', 'critical'],
    versionNote: 'Initial creation'
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

const jobs: JobDefinitionSummary[] = [
  {
    id: 'job-1',
    slug: 'build-app',
    name: 'Build app',
    version: 1,
    type: 'batch',
    entryPoint: 'jobs/build.ts',
    registryRef: null,
    parametersSchema: {
      type: 'object',
      required: ['branch'],
      properties: {
        branch: { type: 'string' }
      }
    },
    defaultParameters: {},
    outputSchema: {},
    timeoutMs: null,
    retryPolicy: null,
    metadata: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

describe('workflow builder state helpers', () => {
  it('creates an empty draft with defaults', () => {
    const draft = createEmptyDraft();
    expect(draft.slug).toBe('');
    expect(draft.version).toBe(1);
    expect(draft.steps).toHaveLength(0);
    expect(draft.parametersSchema).toEqual({});
    expect(draft.defaultParameters).toEqual({});
  });

  it('converts workflow definition metadata into draft fields', () => {
    const draft = workflowDefinitionToDraft(baseWorkflow);
    expect(draft.ownerName).toBe('Release team');
    expect(draft.ownerContact).toBe('release@apphub.test');
    expect(draft.tags).toEqual(['deployment', 'critical']);
    expect(draft.steps).toHaveLength(2);
    expect(draft.steps[1].type).toBe('service');
    expect(draft.steps[1].requestBodyText).toContain('version');
  });

  it('serializes draft into create payload', () => {
    const draft = workflowDefinitionToDraft(baseWorkflow);
    const payload = draftToCreateInput(draft);
    expect(payload.slug).toBe('deploy-app');
    expect(payload.steps).toHaveLength(2);
    expect(payload.steps[1]).toMatchObject({ type: 'service', serviceSlug: 'deployment-api' });
    expect(payload.metadata).toMatchObject({ ownerName: 'Release team', tags: ['deployment', 'critical'] });
  });

  it('computes minimal update payload', () => {
    const draft = workflowDefinitionToDraft(baseWorkflow);
    draft.name = 'Deploy app v2';
    draft.steps[0].parameters = { branch: 'release' };
    const update = draftToUpdateInput(draft, baseWorkflow);
    expect(update.name).toBe('Deploy app v2');
    expect(update.steps).toBeDefined();
    expect(update.description).toBeUndefined();
  });

  it('validates missing fields and schema mismatches', () => {
    const draft = createEmptyDraft();
    const result = validateWorkflowDraft(draft, jobs);
    expect(result.valid).toBe(false);
    expect(result.errors.some((issue) => issue.path === 'slug')).toBe(true);

    const populated = workflowDefinitionToDraft(baseWorkflow);
    populated.steps[0].parametersText = '{"branch": 42}';
    populated.steps[0].parametersError = 'Invalid JSON';
    const schemaResult = validateWorkflowDraft(populated, jobs);
    expect(schemaResult.valid).toBe(false);
    expect(schemaResult.stepErrors.build?.[0].message ?? '').toContain('Invalid JSON');
  });

  it('computes diff entries for changed fields', () => {
    const draft = workflowDefinitionToDraft(baseWorkflow);
    draft.description = 'Updated description';
    draft.steps[0].name = 'Build job v2';
    const diff = computeDraftDiff(baseWorkflow, draft);
    const paths = diff.map((entry) => entry.path);
    expect(paths).toContain('description');
    expect(paths).toContain('steps');
  });
});
