import { test, expect, type Page, type Route } from '@playwright/test';
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

async function fulfillJson(route: Route, body: unknown, origin: string) {
  await route.fulfill({
    status: 200,
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

test.describe('Workflow topology explorer', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    const baseURL = testInfo.project.use?.baseURL ?? 'http://127.0.0.1:4173';
    const origin = new URL(baseURL).origin;
    await stubTopologyApi(page, origin);
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
    expect(edgeStroke).toBe('rgb(219, 234, 254)');
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
});
