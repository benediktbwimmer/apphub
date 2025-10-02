import { createService, type ServiceLifecycle } from '@apphub/module-sdk';
import Fastify, { type FastifyInstance } from 'fastify';

import type { ObservatoryModuleSecrets, ObservatoryModuleSettings } from '../runtime/settings';
import { defaultObservatorySettings } from '../runtime/settings';

export const adminService = createService<
  ObservatoryModuleSettings,
  ObservatoryModuleSecrets,
  ServiceLifecycle
>({
  name: 'observatory-admin-service',
  registration: {
    slug: 'observatory-admin',
    kind: 'admin-ui',
    healthEndpoint: '/healthz',
    defaultPort: 4322,
    basePath: '/',
    tags: ['observatory', 'admin'],
    env: {
      HOST: '0.0.0.0',
      PORT: '{{port}}',
      VITE_API_BASE_URL: '${VITE_API_BASE_URL}',
      VITE_API_TOKEN: '${VITE_API_TOKEN}'
    },
    ui: {
      previewPath: '/',
      spa: true
    }
  },
  settings: {
    defaults: defaultObservatorySettings
  },
  handler: (context) => {
    const fastify: FastifyInstance = Fastify({ logger: false });

    const defaultConfig = {
      baseUrl: context.settings.core.baseUrl,
      token: context.secrets.coreApiToken ?? ''
    } as const;

    fastify.get('/healthz', async () => ({ status: 'ok' }));

    fastify.get('/', async (_, reply) => {
      reply.header('Cache-Control', 'no-store');
      reply.header('Content-Type', 'text/html; charset=utf-8');
      reply.send(buildAdminHtml(defaultConfig));
    });

    const lifecycle: ServiceLifecycle = {
      async start() {
        const host = process.env.HOST ?? '0.0.0.0';
        const port = Number(process.env.PORT ?? '4322');
        await fastify.listen({ host, port });
        context.logger.info('Observatory admin service listening', { host, port });
      },
      async stop() {
        await fastify.close();
      }
    };

    return lifecycle;
  }
});

function buildAdminHtml(defaults: { baseUrl: string; token: string }): string {
  const script = buildAdminScript(defaults);
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Observatory Admin</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root { color-scheme: light dark; }
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f4f6fb; color: #0f172a; margin: 0; }
      header { background: linear-gradient(135deg, #2563eb, #1e293b); color: white; padding: 2.5rem 2rem 2rem; }
      header h1 { margin: 0 0 0.75rem; font-size: 2rem; }
      header p { margin: 0; opacity: 0.9; }
      main { padding: 2rem; display: grid; gap: 1.75rem; max-width: 1080px; margin: 0 auto; }
      section { background: white; border-radius: 14px; box-shadow: 0 20px 50px rgba(15, 23, 42, 0.08); padding: 1.75rem; border: 1px solid rgba(15, 23, 42, 0.08); display: flex; flex-direction: column; gap: 1rem; }
      h2 { margin: 0; font-size: 1.25rem; color: #0f172a; }
      .muted { color: #475569; font-size: 0.95rem; }
      label { font-size: 0.9rem; font-weight: 600; color: #0f172a; display: flex; flex-direction: column; gap: 0.4rem; }
      input, textarea, select { font-family: inherit; font-size: 0.95rem; border-radius: 8px; border: 1px solid rgba(15, 23, 42, 0.15); padding: 0.6rem 0.75rem; background: #f8fafc; color: #0f172a; }
      textarea { min-height: 110px; resize: vertical; }
      button { font-family: inherit; font-size: 0.9rem; font-weight: 600; padding: 0.6rem 1rem; border-radius: 8px; border: none; cursor: pointer; transition: transform 0.15s ease, box-shadow 0.15s ease; }
      button.primary { background: #2563eb; color: white; box-shadow: 0 10px 25px rgba(37, 99, 235, 0.25); }
      button.secondary { background: rgba(15, 23, 42, 0.08); color: #1e293b; }
      button:disabled { opacity: 0.6; cursor: not-allowed; }
      button:not(:disabled):active { transform: translateY(1px); box-shadow: none; }
      table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
      th, td { text-align: left; padding: 0.55rem 0.6rem; border-bottom: 1px solid rgba(15, 23, 42, 0.08); }
      th { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; color: #475569; }
      tbody tr:hover { background: rgba(37, 99, 235, 0.08); }
      .list { border: 1px solid rgba(15, 23, 42, 0.08); border-radius: 10px; overflow: hidden; display: grid; }
      .list-item { padding: 0.75rem 0.95rem; border-bottom: 1px solid rgba(15, 23, 42, 0.05); display: flex; justify-content: space-between; align-items: center; }
      .list-item.active { background: rgba(37, 99, 235, 0.12); }
      .list-item:last-child { border-bottom: none; }
      .actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
      .toast { position: fixed; top: 1rem; right: 1rem; background: #1e293b; color: white; padding: 0.75rem 1rem; border-radius: 8px; box-shadow: 0 20px 40px rgba(15, 23, 42, 0.25); min-width: 260px; font-size: 0.9rem; display:none; }
      .danger { color: #dc2626; }
      .checkbox-grid { display: grid; gap: 0.45rem; max-height: 220px; overflow: auto; padding: 0.4rem; border: 1px solid rgba(15, 23, 42, 0.08); border-radius: 8px; background: #f8fafc; }
      .checkbox-grid label { font-weight: 500; }
      @media (max-width: 720px) {
        main { padding: 1.25rem; }
        header { padding: 1.75rem 1.25rem; }
      }
    </style>
  </head>
  <body>
    <header>
      <h1>Observatory Operations Admin</h1>
      <p>Manage calibration uploads and reprocessing plans against an AppHub Core API instance.</p>
    </header>
    <main>
      <section aria-labelledby="connection-heading">
        <div>
          <h2 id="connection-heading">Connection</h2>
          <p class="muted">Configure the AppHub Core API endpoint and operator token used for requests.</p>
        </div>
        <form id="connection-form" class="grid two">
          <label>
            API base URL
            <input type="url" name="baseUrl" placeholder="http://localhost:4000" required />
          </label>
          <label>
            Operator token
            <input type="password" name="token" placeholder="Bearer token" />
          </label>
          <button class="primary" type="submit">Save connection</button>
          <button class="secondary" type="button" id="test-connection">Test connectivity</button>
        </form>
        <div class="status" id="connection-status">Disconnected</div>
      </section>

      <section aria-labelledby="calibration-heading">
        <div>
          <h2 id="calibration-heading">Calibrations</h2>
          <p class="muted">Review active calibrations and upload new calibration payloads.</p>
        </div>
        <div class="actions">
          <button class="secondary" type="button" id="refresh-calibrations">Refresh calibrations</button>
        </div>
        <div class="list" id="calibration-list"></div>
        <details>
          <summary><strong>Upload calibration</strong></summary>
          <form id="calibration-upload" class="grid" style="margin-top: 1rem;">
            <div class="grid two">
              <label>Instrument ID<input name="instrumentId" required /></label>
              <label>Effective at (ISO minute)<input name="effectiveAt" placeholder="2025-01-01T00:00" required /></label>
              <label>Created at (ISO)<input name="createdAt" placeholder="2025-01-01T00:00" /></label>
              <label>Revision<input name="revision" type="number" min="0" /></label>
            </div>
            <label>Offsets (JSON)<textarea name="offsets">{"temperature_c":0,"relative_humidity_pct":0,"pm2_5_ug_m3":0,"battery_voltage":0}</textarea></label>
            <label>Scales (JSON)<textarea name="scales"></textarea></label>
            <label>Metadata (JSON)<textarea name="metadata">{}</textarea></label>
            <label>Notes<textarea name="notes"></textarea></label>
            <div class="grid two">
              <label>Filename<input name="filename" placeholder="calibration.json" /></label>
              <label class="flex" style="align-items:center;gap:0.5rem"><input type="checkbox" name="overwrite" />Overwrite existing</label>
            </div>
            <button class="primary" type="submit">Upload calibration</button>
            <div class="muted" id="upload-feedback"></div>
          </form>
        </details>
      </section>

      <section aria-labelledby="plans-heading">
        <div>
          <h2 id="plans-heading">Calibration plans</h2>
          <p class="muted">Inspect existing reprocess plans and trigger reprocessing for stale partitions.</p>
        </div>
        <div class="actions">
          <button class="secondary" type="button" id="refresh-plans">Refresh plans</button>
        </div>
        <div class="list" id="plan-list"></div>
        <div id="plan-detail" class="grid" style="display:none;">
          <div>
            <h3 style="margin:0 0 0.5rem;">Plan summary</h3>
            <div id="plan-summary" class="muted"></div>
          </div>
          <div>
            <h3 style="margin: 1rem 0 0.5rem;">Partitions</h3>
            <div class="checkbox-grid" id="plan-partitions"></div>
          </div>
          <form id="plan-reprocess" class="grid">
            <div class="grid two">
              <label>Mode<select name="mode"><option value="all">All pending</option><option value="selected">Selected only</option></select></label>
              <label>Poll interval ms<input name="pollIntervalMs" type="number" min="250" placeholder="1500" /></label>
              <label>Max concurrency<input name="maxConcurrency" type="number" min="1" /></label>
              <label>Run key<input name="runKey" /></label>
              <label>Triggered by<input name="triggeredBy" placeholder="observatory-admin" /></label>
            </div>
            <button class="primary" type="submit">Queue reprocess</button>
            <div class="muted" id="plan-feedback"></div>
          </form>
        </div>
      </section>
    </main>

    <div id="toast" class="toast"></div>

    <script>${script}</script>
  </body>
</html>`;
}

function buildAdminScript(defaults: { baseUrl: string; token: string }): string {
  const script = String.raw`(function(){
    const DEFAULT_CONFIG = __DEFAULT_CONFIG__;
    const connectionForm = document.getElementById('connection-form');
    const testConnectionBtn = document.getElementById('test-connection');
    const connectionStatus = document.getElementById('connection-status');
    const calibrationList = document.getElementById('calibration-list');
    const calibrationUploadForm = document.getElementById('calibration-upload');
    const uploadFeedback = document.getElementById('upload-feedback');
    const refreshCalibrationsBtn = document.getElementById('refresh-calibrations');
    const refreshPlansBtn = document.getElementById('refresh-plans');
    const planList = document.getElementById('plan-list');
    const planDetail = document.getElementById('plan-detail');
    const planSummary = document.getElementById('plan-summary');
    const planPartitions = document.getElementById('plan-partitions');
    const planFeedback = document.getElementById('plan-feedback');
    const planReprocessForm = document.getElementById('plan-reprocess');
    const toastEl = document.getElementById('toast');

    const state = {
      config: loadConfig(),
      plans: [],
      selectedPlan: null
    };

    function loadConfig(){
      try {
        const saved = window.localStorage.getItem('observatory-admin-config');
        if (!saved) return { baseUrl: DEFAULT_CONFIG.baseUrl, token: DEFAULT_CONFIG.token };
        const parsed = JSON.parse(saved);
        return {
          baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : DEFAULT_CONFIG.baseUrl,
          token: typeof parsed.token === 'string' ? parsed.token : DEFAULT_CONFIG.token
        };
      } catch {
        return { baseUrl: DEFAULT_CONFIG.baseUrl, token: DEFAULT_CONFIG.token };
      }
    }

    function saveConfig(config){
      state.config = config;
      window.localStorage.setItem('observatory-admin-config', JSON.stringify(config));
      updateConnectionStatus('Saved configuration', true);
    }

    function updateConnectionStatus(message, ok){
      connectionStatus.textContent = message;
      connectionStatus.style.background = ok ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)';
      connectionStatus.style.color = ok ? '#047857' : '#b91c1c';
    }

    function showToast(message, tone){
      toastEl.textContent = message;
      toastEl.style.display = 'block';
      toastEl.style.background = tone === 'error' ? '#b91c1c' : '#1e293b';
      toastEl.style.color = '#ffffff';
      setTimeout(() => toastEl.style.display = 'none', 3200);
    }

    connectionForm.baseUrl.value = state.config.baseUrl;
    connectionForm.token.value = state.config.token;
    updateConnectionStatus('Loaded configuration', true);

    connectionForm.addEventListener('submit', function(event){
      event.preventDefault();
      const form = new FormData(connectionForm);
      const baseUrl = String(form.get('baseUrl') || '').trim();
      const token = String(form.get('token') || '');
      if (!baseUrl) {
        updateConnectionStatus('Base URL is required', false);
        return;
      }
      saveConfig({ baseUrl: baseUrl, token: token });
    });

    testConnectionBtn.addEventListener('click', async function(){
      try {
        await apiRequest('/healthz');
        updateConnectionStatus('Connection successful', true);
      } catch (error) {
        updateConnectionStatus(error instanceof Error ? error.message : 'Connection failed', false);
      }
    });

    refreshCalibrationsBtn.addEventListener('click', loadCalibrations);
    refreshPlansBtn.addEventListener('click', loadPlans);

    calibrationUploadForm.addEventListener('submit', async function(event){
      event.preventDefault();
      uploadFeedback.textContent = '';
      const form = new FormData(calibrationUploadForm);
      try {
        const payload = {
          instrumentId: String(form.get('instrumentId') || '').trim(),
          effectiveAt: String(form.get('effectiveAt') || '').trim(),
          createdAt: String(form.get('createdAt') || '').trim() || undefined,
          revision: parseOptionalNumber(form.get('revision')),
          offsets: parseJsonField(form.get('offsets')),
          scales: parseJsonField(form.get('scales')),
          metadata: parseJsonField(form.get('metadata')),
          notes: String(form.get('notes') || '').trim() || undefined,
          filename: String(form.get('filename') || '').trim() || undefined,
          overwrite: form.get('overwrite') === 'on'
        };
        if (!payload.instrumentId || !payload.effectiveAt) {
          throw new Error('Instrument ID and effectiveAt are required');
        }
        const response = await apiRequest('/observatory/calibrations/upload', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        const calibrationId = response && response.calibrationId ? response.calibrationId : '';
        uploadFeedback.textContent = 'Uploaded calibration ' + calibrationId;
        showToast('Calibration uploaded', 'info');
        loadCalibrations();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Upload failed';
        uploadFeedback.textContent = message;
        showToast(message, 'error');
      }
    });

    planReprocessForm.addEventListener('submit', async function(event){
      event.preventDefault();
      if (!state.selectedPlan) {
        showToast('Select a plan first', 'error');
        return;
      }
      const form = new FormData(planReprocessForm);
      const mode = String(form.get('mode') || 'all');
      const pollIntervalMs = parseOptionalNumber(form.get('pollIntervalMs'));
      const maxConcurrency = parseOptionalNumber(form.get('maxConcurrency'));
      const runKey = String(form.get('runKey') || '').trim() || undefined;
      const triggeredBy = String(form.get('triggeredBy') || '').trim() || undefined;
      const selected = Array.from(planPartitions.querySelectorAll('input[type="checkbox"]:checked')).map(function(input){ return input.value; });
      try {
        const payload = {
          mode: mode,
          selectedPartitions: mode === 'selected' ? selected : undefined,
          pollIntervalMs: pollIntervalMs === undefined ? undefined : pollIntervalMs,
          maxConcurrency: maxConcurrency === undefined ? undefined : maxConcurrency,
          runKey: runKey,
          triggeredBy: triggeredBy
        };
        const response = await apiRequest('/observatory/plans/' + state.selectedPlan + '/reprocess', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        const runId = response && response.run && response.run.id ? response.run.id : '';
        planFeedback.textContent = 'Queued reprocess run ' + runId;
        showToast('Plan reprocess queued', 'info');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to queue plan';
        planFeedback.textContent = message;
        showToast(message, 'error');
      }
    });

    function renderCalibrationTable(calibrations){
      return '<table><thead><tr><th>Calibration ID</th><th>Instrument</th><th>Effective at</th><th>Version</th><th>Created at</th></tr></thead><tbody>' +
        calibrations.map(function(cal){
          return '<tr><td>' + cal.calibrationId + '</td><td>' + cal.instrumentId + '</td><td>' + cal.effectiveAt + '</td><td>' + (cal.metastoreVersion ?? '—') + '</td><td>' + (cal.createdAt ?? '—') + '</td></tr>';
        }).join('') + '</tbody></table>';
    }

    async function loadCalibrations(){
      calibrationList.innerHTML = '<div class="muted">Loading calibrations…</div>';
      try {
        const response = await apiRequest('/observatory/calibrations?limit=50');
        const calibrations = response && Array.isArray(response.calibrations) ? response.calibrations : [];
        if (calibrations.length === 0) {
          calibrationList.innerHTML = '<div class="muted">No calibrations found.</div>';
          return;
        }
        calibrationList.innerHTML = renderCalibrationTable(calibrations);
      } catch (error) {
        calibrationList.innerHTML = '<div class="danger">' + (error instanceof Error ? error.message : 'Failed to load calibrations') + '</div>';
      }
    }

    async function loadPlans(){
      planList.innerHTML = '<div class="muted">Loading plans…</div>';
      try {
        const response = await apiRequest('/observatory/plans?limit=20');
        state.plans = response && Array.isArray(response.plans) ? response.plans : [];
        if (state.plans.length === 0) {
          planList.innerHTML = '<div class="muted">No plans found.</div>';
          planDetail.style.display = 'none';
          return;
        }
        planList.innerHTML = state.plans.map(function(plan){
          const active = state.selectedPlan === plan.planId ? ' active' : '';
          const updatedAt = plan.updatedAt ?? '';
          return '<div class="list-item' + active + '" data-plan="' + plan.planId + '"><div><div><strong>' + plan.planId + '</strong></div><div class="muted">' + updatedAt + '</div></div><button class="secondary" data-plan="' + plan.planId + '">View</button></div>';
        }).join('');
        planList.querySelectorAll('button').forEach(function(button){
          button.addEventListener('click', function(event){
            const planId = event.currentTarget.getAttribute('data-plan');
            if (planId) selectPlan(planId);
          });
        });
        if (!state.selectedPlan && state.plans.length > 0) {
          selectPlan(state.plans[0].planId);
        }
      } catch (error) {
        planList.innerHTML = '<div class="danger">' + (error instanceof Error ? error.message : 'Failed to load plans') + '</div>';
      }
    }

    async function selectPlan(planId){
      state.selectedPlan = planId;
      planDetail.style.display = 'block';
      planSummary.textContent = 'Loading…';
      planPartitions.innerHTML = '';
      planFeedback.textContent = '';
      try {
        const response = await apiRequest('/observatory/plans/' + encodeURIComponent(planId));
        const plan = response ? response.plan : null;
        const summary = response ? response.summary : null;
        const counts = response && response.computed ? response.computed.partitionStateCounts || {} : {};
        if (!plan || !summary) {
          throw new Error('Plan detail not available');
        }
        planSummary.innerHTML = '<div>State: <strong>' + summary.state + '</strong></div><div>Calibrations: <strong>' + summary.calibrationCount + '</strong></div><div>Partitions: <strong>' + summary.partitionCount + '</strong></div>';
        const items = [];
        plan.calibrations.forEach(function(calibration){
          calibration.partitions.forEach(function(partition){
            const key = partition.partitionKey || (partition.instrumentId + '-' + partition.minute);
            const stateValue = partition.status && partition.status.state ? partition.status.state : 'unknown';
            items.push('<label><input type="checkbox" value="' + key + '" /> ' + key + ' — <span class="muted">' + stateValue + '</span></label>');
          });
        });
        planPartitions.innerHTML = items.join('');
        if (Object.keys(counts).length > 0) {
          planSummary.innerHTML += '<div class="muted">State counts: ' + Object.entries(counts).map(function(entry){ return entry[0] + ': ' + entry[1]; }).join(', ') + '</div>';
        }
      } catch (error) {
        planSummary.textContent = error instanceof Error ? error.message : 'Failed to load plan detail';
        planPartitions.innerHTML = '';
      }
    }

    function parseOptionalNumber(value){
      if (value === undefined || value === null) return undefined;
      const text = String(value).trim();
      if (!text) return undefined;
      const numeric = Number(text);
      return Number.isFinite(numeric) ? numeric : undefined;
    }

    function parseJsonField(value){
      const text = typeof value === 'string' ? value.trim() : '';
      if (!text) return undefined;
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object') {
          return parsed;
        }
        throw new Error('JSON must resolve to an object');
      } catch (error) {
        throw new Error('Invalid JSON: ' + (error instanceof Error ? error.message : String(error)));
      }
    }

    async function apiRequest(path, options){
      const baseUrl = state.config.baseUrl ? state.config.baseUrl.replace(/\/$/, '') : '';
      if (!baseUrl) {
        throw new Error('Set a base URL first');
      }
      const url = new URL(path, baseUrl);
      const init = {
        method: options && options.method ? options.method : 'GET',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json'
        },
        body: options && options.body ? options.body : undefined
      };
      if (state.config.token) {
        init.headers.authorization = 'Bearer ' + state.config.token;
      }
      const response = await fetch(url.toString(), init);
      if (!response.ok) {
        const detail = await response.text().catch(function(){ return response.statusText; });
        throw new Error(response.status + ' ' + response.statusText + ': ' + detail);
      }
      if (response.status === 204) {
        return null;
      }
      return await response.json().catch(function(){ return {}; });
    }

    loadCalibrations();
    loadPlans();
  })();`;

  return script.replace('__DEFAULT_CONFIG__', JSON.stringify(defaults));
}
