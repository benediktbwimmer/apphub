import { test, expect, type Locator, type Page, type Route } from '@playwright/test';
import { createSmallWorkflowGraph } from '../../src/workflows/graph/mocks';

const graphFixture = createSmallWorkflowGraph();
const totalNodeCount = Object.values(graphFixture.nodes).reduce((total, group) => total + group.length, 0);
const totalEdgeCount = Object.values(graphFixture.edges).reduce((total, group) => total + group.length, 0);

const identityResponse = {
  data: {
    id: 'user-ops',
    email: 'ops@apphub.example',
    name: 'Workflow Operator',
    scopes: ['workflows:read', 'workflows:write', 'workflows:run'],
    authDisabled: false
  }
};

const apiKeysResponse = {
  data: {
    keys: []
  }
};

const eventHealthResponse = {
  data: {
    queues: {
      ingress: {},
      triggers: {}
    },
    metrics: {
      generatedAt: '2024-04-02T00:00:00.000Z',
      triggers: [],
      sources: []
    },
    pausedTriggers: [],
    pausedSources: [],
    rateLimits: []
  }
};

let topologyOrigin: string;

declare global {
  interface Window {
    __apphubSocketEmit?: (message: unknown) => void;
  }
}

async function fulfillJson(route: Route, body: unknown, origin: string, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
    },
    body: JSON.stringify(body)
  });
}

async function stubTopologyApi(page: Page, origin: string) {
  await page.route('**/auth/identity', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await fulfillJson(route, {}, origin);
      return;
    }
    await fulfillJson(route, identityResponse, origin);
  });

  await page.route('**/auth/api-keys', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await fulfillJson(route, apiKeysResponse, origin);
      return;
    }
    await fulfillJson(route, apiKeysResponse, origin);
  });

  await page.route('**/workflows/graph', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await fulfillJson(route, { data: graphFixture }, origin);
      return;
    }
    await fulfillJson(route, { data: graphFixture }, origin);
  });

  await page.route('**/admin/event-health', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await fulfillJson(route, eventHealthResponse, origin);
      return;
    }
    await fulfillJson(route, eventHealthResponse, origin);
  });
}

async function waitForTopologyRender(page: Page) {
  await page.getByRole('heading', { name: 'Workflow topology', exact: true }).waitFor();
  await page.getByText('Rendering workflow topology…').waitFor({ state: 'hidden' }).catch(() => {});
  const canvasRegion = page.getByRole('region', { name: 'Workflow topology graph canvas' });
  await expect(canvasRegion).toBeVisible();
  return canvasRegion;
}

function getErrorOverlayLocator(page: Page) {
  return page.locator('[data-testid="workflow-topology-error-overlay"]');
}

type ViewportState = {
  x: number;
  y: number;
  zoom: number;
};

async function readViewportState(canvasRegion: Locator): Promise<ViewportState> {
  return canvasRegion.locator('.react-flow__viewport').evaluate((element) => {
    const computed = window.getComputedStyle(element);
    const matrix = new DOMMatrixReadOnly(computed.transform);
    return {
      x: Math.round(matrix.m41 * 100) / 100,
      y: Math.round(matrix.m42 * 100) / 100,
      zoom: Math.round(matrix.a * 1000) / 1000
    } as ViewportState;
  });
}

test.describe('Workflow topology explorer', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    await page.addInitScript(() => {
      const globalWindow = window as unknown as Record<string, unknown>;

      class MockWebSocket {
        constructor(url: string) {
          this.url = url;
          this.readyState = MockWebSocket.CONNECTING;
          this.onopen = null;
          this.onclose = null;
          this.onerror = null;
          this.onmessage = null;
          globalWindow.__apphubActiveSocket = this;
          setTimeout(() => {
            this.readyState = MockWebSocket.OPEN;
            if (typeof this.onopen === 'function') {
              this.onopen({ target: this });
            }
            if (typeof this.onmessage === 'function') {
              this.onmessage({ data: JSON.stringify({ type: 'connection.ack' }) });
            }
          }, 0);
        }

        url: string;

        readyState: number;

        onopen: ((event: { target: MockWebSocket }) => void) | null;

        onclose: ((event: { target: MockWebSocket }) => void) | null;

        onerror: ((event: { target: MockWebSocket }) => void) | null;

        onmessage: ((event: { data: string }) => void) | null;

        send(data: string) {
          if (data === 'ping' && typeof this.onmessage === 'function') {
            setTimeout(() => {
              this.onmessage?.({ data: JSON.stringify({ type: 'pong' }) });
            }, 0);
          }
        }

        close() {
          if (this.readyState === MockWebSocket.CLOSED) {
            return;
          }
          this.readyState = MockWebSocket.CLOSED;
          if (typeof this.onclose === 'function') {
            this.onclose({ target: this });
          }
        }
      }

      MockWebSocket.CONNECTING = 0;
      MockWebSocket.OPEN = 1;
      MockWebSocket.CLOSING = 2;
      MockWebSocket.CLOSED = 3;

      globalWindow.WebSocket = MockWebSocket;
      globalWindow.__apphubSocketEmit = (message: unknown) => {
        const socket = (globalWindow.__apphubActiveSocket ?? null) as MockWebSocket | null;
        if (!socket || typeof socket.onmessage !== 'function') {
          return;
        }
        socket.onmessage({ data: JSON.stringify(message) });
      };
    });

    const baseURL = testInfo.project.use?.baseURL ?? 'http://127.0.0.1:4173';
    topologyOrigin = new URL(baseURL).origin;
    await stubTopologyApi(page, topologyOrigin);
  });

  test('renders topology graph in light mode', async ({ page }) => {
    await page.goto('/topology');
    const canvasRegion = await waitForTopologyRender(page);

    const nodes = canvasRegion.locator('.react-flow__node');
    await expect(nodes).toHaveCount(totalNodeCount);

    const edges = canvasRegion.locator('path.react-flow__edge-path');
    await expect(edges).toHaveCount(totalEdgeCount);

    const ordersNode = canvasRegion.locator('[data-id="workflow:wf-orders"]');
    await expect(ordersNode).toBeVisible();
    await ordersNode.hover();

    const tooltip = page.locator('[role="presentation"]');
    await expect(tooltip).toContainText('Orders Pipeline');

    const edgeStroke = await edges.first().evaluate((element) => getComputedStyle(element).stroke);
    expect(edgeStroke).not.toBe('rgba(0, 0, 0, 0)');
  });

  test('applies dark theme styling without losing edges', async ({ page }) => {
    await page.addInitScript(() => {
      document.documentElement.classList.add('dark');
    });
    await page.emulateMedia({ colorScheme: 'dark' });

    await page.goto('/topology');
    const canvasRegion = await waitForTopologyRender(page);

    const nodes = canvasRegion.locator('.react-flow__node');
    await expect(nodes).toHaveCount(totalNodeCount);

    const edges = canvasRegion.locator('path.react-flow__edge-path');
    await expect(edges).toHaveCount(totalEdgeCount);

    const ordersNode = canvasRegion.locator('[data-id="workflow:wf-orders"]');
    await expect(ordersNode).toBeVisible();
    const nodeColor = await ordersNode.evaluate((element) => getComputedStyle(element).color);
    expect(nodeColor).not.toBe('rgb(15, 23, 42)');

    const edgeStroke = await edges.first().evaluate((element) => getComputedStyle(element).stroke);
    expect(edgeStroke).toBe('rgb(168, 85, 247)');
  });

  test('retains node count after idle period and fit reset', async ({ page }) => {
    await page.goto('/topology');
    const canvasRegion = await waitForTopologyRender(page);

    const nodes = canvasRegion.locator('.react-flow__node');
    await expect(nodes).toHaveCount(totalNodeCount);

    await page.waitForTimeout(1500);

    await page.getByRole('button', { name: 'Reset view' }).click();

    await expect(nodes).toHaveCount(totalNodeCount);

    const edges = canvasRegion.locator('path.react-flow__edge-path');
    await expect(edges).toHaveCount(totalEdgeCount);
  });

  test('keeps topology visible after unauthorized refresh', async ({ page }) => {
    await page.unroute('**/workflows/graph');
    let requestCount = 0;
    await page.route('**/workflows/graph', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await fulfillJson(route, { data: graphFixture }, topologyOrigin);
        return;
      }
      requestCount += 1;
      if (requestCount === 1) {
        await fulfillJson(route, { data: graphFixture }, topologyOrigin);
        return;
      }
      await fulfillJson(route, { error: 'unauthorized' }, topologyOrigin, 401);
    });

    await page.goto('/topology');
    const canvasRegion = await waitForTopologyRender(page);

    const nodes = canvasRegion.locator('.react-flow__node');
    await expect(nodes).toHaveCount(totalNodeCount);

    await page.getByRole('button', { name: 'Refresh' }).click();
    await page.getByText('Topology fetch failed').waitFor();

    await expect(nodes).toHaveCount(totalNodeCount);
    const edges = canvasRegion.locator('path.react-flow__edge-path');
    await expect(edges).toHaveCount(totalEdgeCount);
    await expect(getErrorOverlayLocator(page)).toHaveCount(0);
  });

  test('keeps topology visible when background refresh fails', async ({ page }) => {
    await page.unroute('**/workflows/graph');
    let requestCount = 0;
    await page.route('**/workflows/graph', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await fulfillJson(route, { data: graphFixture }, topologyOrigin);
        return;
      }
      requestCount += 1;
      if (requestCount === 1) {
        await fulfillJson(route, { data: graphFixture }, topologyOrigin);
        return;
      }
      await fulfillJson(route, { error: 'internal server error' }, topologyOrigin, 500);
    });

    await page.goto('/topology');
    const canvasRegion = await waitForTopologyRender(page);
    const nodes = canvasRegion.locator('.react-flow__node');
    await expect(nodes).toHaveCount(totalNodeCount);

    await page.evaluate(() => {
      window.__apphubSocketEmit?.({
        type: 'workflow.definition.updated',
        data: { workflowId: 'wf-orders' }
      });
    });

    await expect.poll(() => requestCount).toBe(2);
    await page.getByText('Topology fetch failed').waitFor();

    await expect(nodes).toHaveCount(totalNodeCount);
    const edges = canvasRegion.locator('path.react-flow__edge-path');
    await expect(edges).toHaveCount(totalEdgeCount);
    await expect(getErrorOverlayLocator(page)).toHaveCount(0);
  });

  test('keeps canvas visible during background refresh', async ({ page }) => {
    await page.unroute('**/workflows/graph');
    let requestCount = 0;
    let resolveRefresh: (() => void) | null = null;
    const refreshGate = new Promise<void>((resolve) => {
      resolveRefresh = resolve;
    });

    await page.route('**/workflows/graph', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await fulfillJson(route, { data: graphFixture }, topologyOrigin);
        return;
      }
      requestCount += 1;
      if (requestCount === 1) {
        await fulfillJson(route, { data: graphFixture }, topologyOrigin);
        return;
      }
      await refreshGate;
      await fulfillJson(route, { data: graphFixture }, topologyOrigin);
    });

    await page.goto('/topology');
    const canvasRegion = await waitForTopologyRender(page);
    const nodes = canvasRegion.locator('.react-flow__node');
    await expect(nodes).toHaveCount(totalNodeCount);

    const initialViewport = await readViewportState(canvasRegion);
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.waitForTimeout(150);
    const zoomedViewport = await readViewportState(canvasRegion);
    expect(zoomedViewport.zoom).toBeGreaterThan(initialViewport.zoom);

    await page.evaluate(() => {
      window.__apphubSocketEmit?.({
        type: 'workflow.definition.updated',
        data: { workflowId: 'wf-orders' }
      });
    });

    await expect.poll(() => requestCount).toBe(2);

    const loadingBanner = page.getByText('Rendering workflow topology…');

    try {
      await expect(loadingBanner).not.toBeVisible();
    } finally {
      resolveRefresh?.();
    }

    await page.waitForTimeout(120);

    await expect(nodes).toHaveCount(totalNodeCount);
    const finalViewport = await readViewportState(canvasRegion);
    expect(finalViewport.zoom).toBeCloseTo(zoomedViewport.zoom, 3);
    expect(finalViewport.x).toBeCloseTo(zoomedViewport.x, 1);
    expect(finalViewport.y).toBeCloseTo(zoomedViewport.y, 1);
  });
});
