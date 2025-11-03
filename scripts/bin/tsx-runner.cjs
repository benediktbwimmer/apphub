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

function readOutput(buffer) {
  if (!buffer) {
    return '';
  }
  return Buffer.isBuffer(buffer) ? buffer.toString() : String(buffer);
}

function writeResultOutput(result) {
  const stdout = readOutput(result.stdout);
  const stderr = readOutput(result.stderr);
  if (stdout) {
    process.stdout.write(stdout);
  }
  if (stderr) {
    process.stderr.write(stderr);
  }
}

function shouldFallback(result) {
  const combined = `${readOutput(result.stderr)}\n${readOutput(result.stdout)}`.toLowerCase();
  if (!combined) {
    return false;
  }
  return combined.includes('listen eperm') || combined.includes('operation not permitted') || combined.includes('eperm');
}

function runWithNode(args, env) {
  const nodeArgs = ['--enable-source-maps', '--import', 'tsx'];
  let forwarded = args;
  if (forwarded[0] === 'watch') {
    nodeArgs.unshift('--watch');
    forwarded = forwarded.slice(1);
  }
  const result = spawnSync(process.execPath, [...nodeArgs, ...forwarded], {
    stdio: 'inherit',
    env
  });
  exitWithResult(result);
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
    stdio: 'pipe',
    env
  });

  writeResultOutput(result);

  if (result.status === 0) {
    exitWithResult(result);
    return;
  }

  if (shouldFallback(result)) {
    console.warn('[tsx-shim] CLI failed with EPERM, retrying with node --import tsx fallback.');
    runWithNode(adjustedArgs, env);
    return;
  }

  exitWithResult(result);
}

module.exports = { runCli, expandTestArgs };

if (require.main === module) {
  runCli();
}
