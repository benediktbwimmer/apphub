import { checkKubectlDiagnostics } from '../kubernetes/toolingDiagnostics';

type CliOptions = {
  source: string;
};

function parseOptions(argv: string[]): CliOptions {
  let source = 'unknown';
  for (const arg of argv) {
    if (arg.startsWith('--source=')) {
      const value = arg.slice('--source='.length).trim();
      if (value) {
        source = value;
      }
    }
  }
  return { source };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const diagnostics = await checkKubectlDiagnostics();
  const prefix = `[core][kubernetes][${options.source}]`;
  const requireTooling = process.env.APPHUB_K8S_REQUIRE_TOOLING === '1';

  if (diagnostics.status === 'ok') {
    const version = diagnostics.version ?? 'unknown';
    console.log(`${prefix} kubectl client detected (version: ${version})`);
  } else {
    const message = diagnostics.error ?? 'kubectl diagnostics failed';
    console.warn(`${prefix} kubectl unavailable: ${message}`);
    if (diagnostics.details) {
      console.warn(`${prefix} kubectl details: ${diagnostics.details}`);
    }
    if (requireTooling) {
      process.exitCode = 1;
    }
  }

  for (const warning of diagnostics.warnings) {
    console.warn(`${prefix} warning: ${warning}`);
  }
}

void main().catch((err) => {
  console.error('[core][kubernetes] smoke script crashed', err);
  process.exitCode = 1;
});
