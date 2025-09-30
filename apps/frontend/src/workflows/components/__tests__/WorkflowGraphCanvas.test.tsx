import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReactFlowProvider } from 'reactflow';
import { useEffect, type ComponentProps } from 'react';
import {
  createTheme,
  defaultThemeRegistry,
  type ThemeDefinition,
  type ThemeRegistry
} from '@apphub/shared/designTokens';
import WorkflowGraphCanvas from '../WorkflowGraphCanvas';
import { createSmallWorkflowGraphNormalized } from '../../graph/mocks';
import { ThemeProvider, useTheme } from '../../../theme';
import { createWorkflowGraphTheme } from '../../../theme/integrations/workflowGraphTheme';

type RenderCanvasOptions = {
  themeId?: ThemeDefinition['id'];
  themes?: ThemeRegistry;
  storageKey?: string;
};

function simplifyGradient(value: string): string {
  return value.replace(/ 0%/g, '').replace(/ 100%/g, '').replace(/\s+/g, ' ').trim();
}

function ThemePreferenceSetter({ themeId }: { themeId: ThemeDefinition['id'] }) {
  const { setPreference } = useTheme();
  useEffect(() => {
    setPreference(themeId);
  }, [setPreference, themeId]);
  return null;
}

function renderCanvas(
  props: ComponentProps<typeof WorkflowGraphCanvas>,
  options: RenderCanvasOptions = {}
) {
  const { themeId = 'apphub-light', themes, storageKey = `workflow-graph-test-${themeId}` } = options;
  return render(
    <ThemeProvider themes={themes} storageKey={storageKey}>
      <ThemePreferenceSetter themeId={themeId} />
      <ReactFlowProvider>
        <WorkflowGraphCanvas {...props} />
      </ReactFlowProvider>
    </ThemeProvider>
  );
}

const highContrastTheme = createTheme({
  base: defaultThemeRegistry['apphub-dark'],
  id: 'tenant-high-contrast',
  label: 'Tenant High Contrast',
  overrides: {
    semantics: {
      surface: {
        canvas: '#000000',
        canvasMuted: '#0f0f0f',
        raised: '#080808',
        sunken: '#000000',
        accent: 'rgba(255, 255, 255, 0.08)',
        backdrop: 'rgba(0, 0, 0, 0.75)'
      },
      text: {
        primary: '#ffffff',
        secondary: '#f4f4f5',
        muted: '#e4e4e7',
        inverse: '#000000',
        accent: '#ff66ff',
        onAccent: '#000000',
        success: '#00ff88',
        warning: '#ffed4a',
        danger: '#ff4d6d'
      },
      border: {
        subtle: 'rgba(255, 255, 255, 0.45)',
        default: '#f4f4f5',
        strong: '#f8fafc',
        accent: '#ff66ff',
        focus: 'rgba(255, 255, 0, 0.7)',
        inverse: '#000000'
      },
      status: {
        info: '#66ccff',
        infoOn: '#00121c',
        success: '#00ff88',
        successOn: '#002b1f',
        warning: '#ffed4a',
        warningOn: '#322800',
        danger: '#ff4d6d',
        dangerOn: '#2a000b',
        neutral: '#f8fafc',
        neutralOn: '#000000'
      },
      overlay: {
        hover: 'rgba(255, 255, 255, 0.2)',
        pressed: 'rgba(255, 255, 255, 0.35)',
        scrim: 'rgba(0, 0, 0, 0.65)'
      },
      accent: {
        default: '#ff66ff',
        emphasis: '#ffffff',
        muted: 'rgba(255, 102, 255, 0.28)',
        onAccent: '#000000'
      }
    }
  }
});

const highContrastRegistry = {
  ...defaultThemeRegistry,
  [highContrastTheme.id]: highContrastTheme
} as ThemeRegistry;

beforeEach(() => {
  window.localStorage.clear();
});

describe('WorkflowGraphCanvas', () => {
  it('renders workflow nodes using normalized topology', async () => {
    const graph = createSmallWorkflowGraphNormalized();
    renderCanvas({ graph, interactionMode: 'static' });

    expect(await screen.findByText(/Orders Pipeline/)).toBeInTheDocument();
    expect(screen.getByText(/orders-pipeline/i)).toBeInTheDocument();
  });

  it('exposes node selection callback', async () => {
    const graph = createSmallWorkflowGraphNormalized();
    const onNodeSelect = vi.fn();
    renderCanvas({ graph, onNodeSelect, interactionMode: 'static' });

    const nodeLabel = await screen.findByText(/Orders Pipeline/);
    const node = nodeLabel.closest('[role="button"]');
    expect(node).not.toBeNull();
    await userEvent.click(node as Element);

    expect(onNodeSelect).toHaveBeenCalledTimes(1);
    expect(onNodeSelect.mock.calls[0][1].refId).toBe('wf-orders');
  });

  it('shows loading overlay', () => {
    renderCanvas({ graph: null, loading: true, interactionMode: 'static' });
    expect(screen.getByText(/Rendering workflow topology/i)).toBeInTheDocument();
  });

  it('renders filtered empty state message', async () => {
    const graph = createSmallWorkflowGraphNormalized();
    renderCanvas({ graph, filters: { workflowIds: ['missing-workflow'] } });

    expect(
      await screen.findByText(/No matches for the current filters/i)
    ).toBeInTheDocument();
  });

  it('applies semantic theme colors for workflow nodes in light mode', async () => {
    const graph = createSmallWorkflowGraphNormalized();
    const lightTheme = defaultThemeRegistry['apphub-light'];
    const expectedTheme = createWorkflowGraphTheme(lightTheme);

    renderCanvas({ graph, interactionMode: 'static' }, { themeId: lightTheme.id, storageKey: 'workflow-graph-light' });

    const workflowLabel = await screen.findByText(/Orders Pipeline/);
    const nodeElement = workflowLabel.parentElement?.parentElement?.parentElement as HTMLElement | null;
    expect(nodeElement).not.toBeNull();
    if (!nodeElement) {
      throw new Error('Expected workflow node element to be present');
    }
    const backgroundValue = simplifyGradient(nodeElement.style.background);
    expect(backgroundValue).toBe(simplifyGradient(expectedTheme.nodes.workflow.background));
    expect(nodeElement).toHaveStyle({ borderColor: expectedTheme.nodes.workflow.border });
    expect(nodeElement).toHaveStyle({ color: expectedTheme.nodes.workflow.text });

    const canvasRegion = screen.getByRole('region', { name: /Workflow topology graph canvas/i });
    expect(canvasRegion).toHaveStyle({ background: expectedTheme.surface });
  });

  it('applies semantic theme colors for workflow nodes in dark mode', async () => {
    const graph = createSmallWorkflowGraphNormalized();
    const darkTheme = defaultThemeRegistry['apphub-dark'];
    const expectedTheme = createWorkflowGraphTheme(darkTheme);

    renderCanvas({ graph, interactionMode: 'static' }, { themeId: darkTheme.id, storageKey: 'workflow-graph-dark' });

    const workflowLabel = await screen.findByText(/Orders Pipeline/);
    const nodeElement = workflowLabel.parentElement?.parentElement?.parentElement as HTMLElement | null;
    expect(nodeElement).not.toBeNull();
    if (!nodeElement) {
      throw new Error('Expected workflow node element to be present');
    }
    const backgroundValue = simplifyGradient(nodeElement.style.background);
    expect(backgroundValue).toBe(simplifyGradient(expectedTheme.nodes.workflow.background));
    expect(nodeElement).toHaveStyle({ borderColor: expectedTheme.nodes.workflow.border });
    expect(nodeElement).toHaveStyle({ color: expectedTheme.nodes.workflow.text });

    const canvasRegion = screen.getByRole('region', { name: /Workflow topology graph canvas/i });
    expect(canvasRegion).toHaveStyle({ background: expectedTheme.surface });
  });

  it('respects tenant high-contrast theme overrides', async () => {
    const graph = createSmallWorkflowGraphNormalized();
    const expectedTheme = createWorkflowGraphTheme(highContrastTheme);

    renderCanvas(
      { graph, interactionMode: 'static' },
      {
        themeId: highContrastTheme.id,
        themes: highContrastRegistry,
        storageKey: 'workflow-graph-contrast'
      }
    );

    const workflowLabel = await screen.findByText(/Orders Pipeline/);
    const nodeElement = workflowLabel.parentElement?.parentElement?.parentElement as HTMLElement | null;
    expect(nodeElement).not.toBeNull();
    if (!nodeElement) {
      throw new Error('Expected workflow node element to be present');
    }
    const backgroundValue = simplifyGradient(nodeElement.style.background);
    expect(backgroundValue).toBe(simplifyGradient(expectedTheme.nodes.workflow.background));
    expect(nodeElement).toHaveStyle({ borderColor: expectedTheme.nodes.workflow.border });
    expect(nodeElement).toHaveStyle({ color: expectedTheme.nodes.workflow.text });
    expect(nodeElement).toHaveStyle({ boxShadow: expectedTheme.nodes.workflow.shadow });

    const canvasRegion = screen.getByRole('region', { name: /Workflow topology graph canvas/i });
    expect(canvasRegion).toHaveStyle({ background: expectedTheme.surface });
  });
});
