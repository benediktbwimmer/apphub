import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ImportWorkspace from '../ImportWorkspace';
import type { ExampleScenario } from '../examples';
import type { ExampleBundleStatus } from '../exampleBundles';

const exampleScenarios: ExampleScenario[] = [
  {
    id: 'observatory-inbox-normalizer-job',
    type: 'job',
    title: 'Observatory inbox normalizer',
    summary: 'Normalize inbox CSVs and fan out downstream ingest.',
    description: 'Test fixture job scenario for the observatory pipeline.',
    form: { source: 'upload' },
    moduleId: 'observatory-inbox-normalizer',
    exampleSlug: 'observatory-inbox-normalizer'
  },
  {
    id: 'observatory-timestore-loader-job',
    type: 'job',
    title: 'Observatory timestore loader',
    summary: 'Stream normalized readings into timestore.',
    description: 'Test fixture job scenario for the observatory pipeline.',
    form: { source: 'upload' },
    moduleId: 'observatory-timestore-loader',
    exampleSlug: 'observatory-timestore-loader'
  },
  {
    id: 'observatory-minute-ingest-workflow',
    type: 'workflow',
    title: 'Observatory minute ingest',
    summary: 'Full minute ingest DAG.',
    description: 'Test fixture workflow scenario for the observatory pipeline.',
    form: {
      slug: 'observatory-minute-ingest',
      name: 'Observatory minute ingest',
      steps: []
    },
    includes: ['observatory-inbox-normalizer-job', 'observatory-timestore-loader-job']
  }
] satisfies ExampleScenario[];

const authorizedFetchMock = vi.fn<(url: string, options?: RequestInit) => Promise<Response>>();
const pushToastMock = vi.fn();
const appHubEventMock = vi.fn();
const fetchMock = vi.fn<typeof fetch>();

vi.mock('../../auth/useAuthorizedFetch', () => ({
  useAuthorizedFetch: () => authorizedFetchMock
}));

vi.mock('../../utils/useAnalytics', () => ({
  useAnalytics: () => ({ trackEvent: vi.fn() })
}));

vi.mock('../../components/toast', () => ({
  useToasts: () => ({ pushToast: pushToastMock })
}));

vi.mock('../../events/context', () => ({
  useAppHubEvent: () => {
    appHubEventMock();
  }
}));

vi.mock('../../utils/fileEncoding', () => ({
  fileToEncodedPayload: async () => ({ data: 'ZmlsZQ==', filename: 'bundle.tgz' })
}));

let bundleStatuses: ExampleBundleStatus[] = [];

beforeEach(() => {
  bundleStatuses = [];
  authorizedFetchMock.mockImplementation(async (url: string) => {
    if (url.includes('/modules/catalog')) {
      return new Response(
        JSON.stringify({ data: { catalog: { scenarios: exampleScenarios } } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.includes('/examples/bundles/status')) {
      return new Response(
        JSON.stringify({ data: { statuses: bundleStatuses } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(JSON.stringify({ data: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  });
  pushToastMock.mockReset();
  appHubEventMock.mockReset();
  fetchMock.mockResolvedValue(
    new Response('fake-archive', {
      status: 200,
      headers: { 'Content-Type': 'application/gzip' }
    })
  );
  vi.stubGlobal('fetch', fetchMock);
});

describe('ImportWorkspace wizard', () => {
  it('displays workflow dependencies with bundle status feedback', async () => {
    const now = new Date().toISOString();
    bundleStatuses = [
      {
        slug: 'observatory-inbox-normalizer',
        fingerprint: 'abc',
        stage: 'packaging',
        state: 'running',
        message: 'Packaging bundle',
        error: null,
        updatedAt: now,
        createdAt: now
      }
    ];

    const user = userEvent.setup();
    render(<ImportWorkspace />);

    const loadExampleButton = await screen.findByRole('button', { name: /load example/i });
    await waitFor(() =>
      expect(authorizedFetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/modules/catalog')
      )
    );
    await waitFor(() => expect(loadExampleButton).toBeEnabled());
    await user.click(loadExampleButton);
    const picker = await screen.findByRole('dialog');
    const workflowFilter = within(picker).getAllByRole('button', { name: /Workflows/i })[0];
    await user.click(workflowFilter);

    const workflowCard = screen.getByRole('heading', { name: 'Observatory minute ingest' }).closest('article');
    expect(workflowCard).toBeTruthy();
    const loadButton = within(workflowCard as HTMLElement).getByRole('button', { name: /Load this scenario|Reload scenario/i });
    await user.click(loadButton);

    await waitFor(() => {
      expect(screen.getByText('Dependencies')).toBeInTheDocument();
    });

    expect(screen.getByText('Observatory inbox normalizer')).toBeInTheDocument();
    expect(screen.getByText('Observatory timestore loader')).toBeInTheDocument();
    expect(screen.getByText('Packaging')).toBeInTheDocument();
    expect(screen.getByText('Packaging bundle')).toBeInTheDocument();
  });

  it('allows retrying failed example bundle packaging', async () => {
    const now = new Date().toISOString();
    bundleStatuses = [
      {
        slug: 'observatory-inbox-normalizer',
        fingerprint: 'xyz',
        stage: 'failed',
        state: 'failed',
        message: 'Packaging failed',
        error: 'npm install exited with 1',
        updatedAt: now,
        createdAt: now
      }
    ];

    const user = userEvent.setup();
    render(<ImportWorkspace />);

    const loadExampleButton = await screen.findByRole('button', { name: /load example/i });
    await waitFor(() =>
      expect(authorizedFetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/modules/catalog')
      )
    );
    await waitFor(() => expect(loadExampleButton).toBeEnabled());
    await user.click(loadExampleButton);
    const picker = await screen.findByRole('dialog');
    const workflowFilter = within(picker).getAllByRole('button', { name: /Workflows/i })[0];
    await user.click(workflowFilter);

    const workflowCard = screen.getByRole('heading', { name: 'Observatory minute ingest' }).closest('article');
    const loadButton = within(workflowCard as HTMLElement).getByRole('button', { name: /Load this scenario|Reload scenario/i });
    await user.click(loadButton);

    await waitFor(() => {
      expect(screen.getByText('npm install exited with 1')).toBeInTheDocument();
    });

    const retryButton = screen.getByRole('button', { name: /Retry packaging/i });
    await user.click(retryButton);

    await waitFor(() => {
      expect(authorizedFetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/job-imports/example'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    expect(pushToastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tone: 'success',
        title: 'Packaging retried'
      })
    );
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
