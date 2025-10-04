#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

async function main(): Promise<void> {
  const composeFile = process.env.APPHUB_STREAMING_COMPOSE_FILE ?? 'docker/demo-stack.compose.yml';
  const composeProject = process.env.APPHUB_STREAMING_COMPOSE_PROJECT;
  const jobManagerService = process.env.APPHUB_STREAMING_FLINK_SERVICE ?? 'flink-jobmanager';
  const broker = process.env.APPHUB_STREAM_BROKER_URL ?? 'redpanda:9092';

  const repoRoot = path.resolve(__dirname, '..', '..');
  const sampleDir = path.resolve(repoRoot, 'services', 'streaming', 'sample-jobs');
  const templatePath = path.join(sampleDir, 'tumbling-window.sql');
  const generatedPath = path.join(sampleDir, 'tumbling-window.generated.sql');

  const template = await fs.readFile(templatePath, 'utf8');
  const sql = template.replace(/\{\{BROKER_BOOTSTRAP_SERVERS\}\}/g, broker);
  await fs.writeFile(generatedPath, sql, 'utf8');

  const args = ['compose', '-f', composeFile];
  if (composeProject && composeProject.trim().length > 0) {
    args.push('-p', composeProject.trim());
  }
  args.push('exec', '-T', jobManagerService, './bin/sql-client.sh', '-f', '/opt/apphub/sample-jobs/tumbling-window.generated.sql');

  await new Promise<void>((resolve, reject) => {
    const child = spawn('docker', args, { stdio: 'inherit' });
    child.once('error', (error) => {
      reject(error);
    });
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`docker ${args.join(' ')} exited with code ${code}`));
      }
    });
  }).finally(async () => {
    await fs.rm(generatedPath).catch(() => undefined);
  });
}

main().catch((err) => {
  console.error('[streaming] Failed to submit sample job:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
