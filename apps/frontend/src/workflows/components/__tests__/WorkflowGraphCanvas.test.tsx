import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ReactFlowProvider } from 'reactflow';
import WorkflowGraphCanvas from '../WorkflowGraphCanvas';
import { createSmallWorkflowGraphNormalized } from '../../graph/mocks';
import type { ComponentProps } from 'react';
import { ThemeProvider } from '../../../theme';

function renderCanvas(props: ComponentProps<typeof WorkflowGraphCanvas>) {
  return render(
    <ThemeProvider>
      <ReactFlowProvider>
        <WorkflowGraphCanvas {...props} />
      </ReactFlowProvider>
    </ThemeProvider>
  );
}

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
});
