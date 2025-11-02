'use strict';

const { spawnSync } = require('node:child_process');

const DEFAULT_INTERVAL_MS = 15000;
const DEFAULT_CPU_THRESHOLD = 150;
const DEFAULT_MEM_THRESHOLD_MB = 1024;
const DEFAULT_THROTTLE_MS = 60000;

const psSupport = { checked: false, available: false };
const warnedUnsupported = { windows: false, ps: false };

function parseInteger(value, fallback) {
  if (typeof value !== 'string' || value.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseFloatValue(value, fallback) {
  if (typeof value !== 'string' || value.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function commandExists(command) {
  try {
    const result = spawnSync('which', [command], { stdio: 'ignore' });
    return result.status === 0;
  } catch {
    return false;
  }
}

function ensurePsAvailable(prefix) {
  if (process.platform === 'win32') {
    if (!warnedUnsupported.windows) {
      console.warn(`[${prefix}] Resource monitor disabled: not supported on Windows.`);
      warnedUnsupported.windows = true;
    }
    return false;
  }

  if (!psSupport.checked) {
    psSupport.available = commandExists('ps');
    psSupport.checked = true;
  }

  if (!psSupport.available && !warnedUnsupported.ps) {
    console.warn(`[${prefix}] Resource monitor disabled: unable to locate "ps" on PATH.`);
    warnedUnsupported.ps = true;
  }

  return psSupport.available;
}

function sliceCommand(command) {
  if (!command || typeof command !== 'string') {
    return '';
  }
  return command.length > 80 ? `${command.slice(0, 77)}...` : command;
}

function startResourceMonitor({ commands, prefix = 'dev-runner' }) {
  const intervalMs = parseInteger(process.env.APPHUB_DEV_RESOURCE_MONITOR_INTERVAL_MS, DEFAULT_INTERVAL_MS);
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    return () => undefined;
  }

  if (!ensurePsAvailable(prefix)) {
    return () => undefined;
  }

  const cpuThreshold = parseFloatValue(
    process.env.APPHUB_DEV_RESOURCE_CPU_THRESHOLD,
    DEFAULT_CPU_THRESHOLD
  );
  const memThresholdMb = parseFloatValue(
    process.env.APPHUB_DEV_RESOURCE_MEM_THRESHOLD_MB,
    DEFAULT_MEM_THRESHOLD_MB
  );
  const throttleMs = parseInteger(
    process.env.APPHUB_DEV_RESOURCE_MONITOR_THROTTLE_MS,
    Math.max(DEFAULT_THROTTLE_MS, intervalMs)
  );

  let stopped = false;
  const lastReported = new Map();

  const timer = setInterval(() => {
    if (stopped) {
      return;
    }

    const activeCommands = commands.filter(
      (command) => typeof command.pid === 'number' && command.pid > 0 && !command.exited
    );

    if (activeCommands.length === 0) {
      return;
    }

    const pidList = activeCommands.map((command) => String(command.pid)).join(',');
    if (!pidList) {
      return;
    }

    const result = spawnSync('ps', ['-o', 'pid=,%cpu=,%mem=,rss=', '-p', pidList], { encoding: 'utf8' });
    if (result.status !== 0 || typeof result.stdout !== 'string') {
      return;
    }

    const now = Date.now();
    const lines = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const warnings = [];
    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts.length < 4) {
        continue;
      }
      const [pidValue, cpuValue, memPercentValue, rssValue] = parts;
      const pid = Number.parseInt(pidValue, 10);
      const cpu = Number.parseFloat(cpuValue);
      const rssKb = Number.parseInt(rssValue, 10);
      if (!Number.isFinite(pid) || !Number.isFinite(cpu) || !Number.isFinite(rssKb)) {
        continue;
      }
      const rssMb = rssKb / 1024;
      if (cpu < cpuThreshold && rssMb < memThresholdMb) {
        continue;
      }
      if (now - (lastReported.get(pid) ?? 0) < throttleMs) {
        continue;
      }
      lastReported.set(pid, now);
      const matchingCommand = activeCommands.find((command) => command.pid === pid);
      warnings.push({
        pid,
        cpu,
        rssMb,
        memPercent: Number.parseFloat(memPercentValue),
        label: matchingCommand?.name ?? sliceCommand(matchingCommand?.command) ?? `pid ${pid}`,
        command: sliceCommand(matchingCommand?.command)
      });
    }

    if (warnings.length === 0) {
      return;
    }

    warnings.sort((a, b) => {
      const cpuScore = (b.cpu - a.cpu) / Math.max(cpuThreshold, 1);
      if (Math.abs(cpuScore) > 0.1) {
        return cpuScore;
      }
      return b.rssMb - a.rssMb;
    });

    const message = warnings
      .map((entry) => {
        const cpuText = `${entry.cpu.toFixed(1)}%`;
        const memText = `${entry.rssMb.toFixed(1)} MiB`;
        const memPercentText = Number.isFinite(entry.memPercent)
          ? ` | MEM% ${entry.memPercent.toFixed(1)}`
          : '';
        const commandText = entry.command && entry.command !== entry.label ? ` | ${entry.command}` : '';
        return `- ${entry.label} (pid ${entry.pid}) CPU ${cpuText} | RSS ${memText}${memPercentText}${commandText}`;
      })
      .join('\n');

    console.warn(
      `[${prefix}] High resource usage detected (cpu ≥ ${cpuThreshold}% or rss ≥ ${memThresholdMb} MiB):\n${message}`
    );
  }, intervalMs);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  return () => {
    if (stopped) {
      return;
    }
    stopped = true;
    clearInterval(timer);
  };
}

module.exports = {
  startResourceMonitor
};

