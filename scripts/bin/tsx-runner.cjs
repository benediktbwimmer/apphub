const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TEST_FILE_PATTERN = /\.(?:test|spec)\.(?:cjs|mjs|js|jsx|ts|tsx)$/i;

function ensureIpcHookPath(env) {
  if (env.TSX_IPC_HOOK_PATH && env.TSX_IPC_HOOK_PATH.trim()) {
    return;
  }
  const baseDir = path.join(os.tmpdir(), `apphub-tsx-ipc-${process.pid}-${Date.now()}`);
  try {
    fs.mkdirSync(baseDir, { recursive: true, mode: 0o700 });
  } catch (error) {
    console.warn('[tsx-shim] unable to prepare IPC directory, falling back to os.tmpdir()', error);
  }
  const targetDir = fs.existsSync(baseDir) ? baseDir : os.tmpdir();
  env.TSX_IPC_HOOK_PATH = path.join(targetDir, `ipc-${Math.random().toString(16).slice(2)}.sock`);
}

function ensureEnvDefaults(env) {
  ensureIpcHookPath(env);
  if (!env.TSX_UNSAFE_HOOKS) {
    env.TSX_UNSAFE_HOOKS = '1';
  }
  if (!env.TSX_DISABLE_CACHE) {
    env.TSX_DISABLE_CACHE = '1';
  }
}

function exitWithResult(result) {
  if (result.error) {
    console.error('[tsx-shim] failed to spawn tsx CLI:', result.error.message);
    process.exit(result.status ?? 1);
  }
  if (typeof result.status === 'number') {
    process.exit(result.status);
  }
  if (result.signal) {
    process.kill(process.pid, result.signal);
  }
  process.exit(1);
}

function expandTestDirectory(dirPath) {
  const collected = [];
  function walk(current) {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (error) {
      console.warn('[tsx-shim] failed to read test directory', current, error);
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && TEST_FILE_PATTERN.test(entry.name)) {
        collected.push(fullPath);
      }
    }
  }
  walk(dirPath);
  return collected;
}

function expandTestArgs(originalArgs) {
  const expanded = [];
  for (let i = 0; i < originalArgs.length; i += 1) {
    const arg = originalArgs[i];
    if (arg === '--test') {
      expanded.push(arg);
      const targets = [];
      let j = i + 1;
      for (; j < originalArgs.length; j += 1) {
        const candidate = originalArgs[j];
        if (candidate.startsWith('-')) {
          break;
        }
        targets.push(candidate);
      }
      if (targets.length === 0) {
        targets.push('.');
      }
      const resolved = [];
      for (const target of targets) {
        const absTarget = path.resolve(target);
        try {
          const stats = fs.statSync(absTarget);
          if (stats.isDirectory()) {
            const files = expandTestDirectory(absTarget);
            if (files.length > 0) {
              resolved.push(...files);
            } else {
              resolved.push(absTarget);
            }
          } else if (stats.isFile()) {
            resolved.push(absTarget);
          } else {
            resolved.push(absTarget);
          }
        } catch (error) {
          console.warn('[tsx-shim] unable to stat test target', target, error);
          resolved.push(target);
        }
      }
      expanded.push(...resolved);
      i = j - 1;
    } else {
      expanded.push(arg);
    }
  }
  return expanded;
}

function runCli(argv = process.argv.slice(2), initialEnv = process.env) {
  const env = { ...initialEnv };
  ensureEnvDefaults(env);
  const adjustedArgs = expandTestArgs(argv);
  let cliEntrypoint;
  try {
    cliEntrypoint = require.resolve('tsx/cli');
  } catch (error) {
    console.error('[tsx-shim] unable to resolve tsx CLI entrypoint:', error.message);
    process.exit(1);
  }

  const result = spawnSync(process.execPath, [cliEntrypoint, ...adjustedArgs], {
    stdio: 'inherit',
    env
  });

  exitWithResult(result);
}

module.exports = { runCli, expandTestArgs };

if (require.main === module) {
  runCli();
}
