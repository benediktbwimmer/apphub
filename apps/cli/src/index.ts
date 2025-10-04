#!/usr/bin/env node

import { Command } from 'commander';
import { registerWorkflowCommands } from './commands/workflows';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('apphub')
    .description('AppHub developer tooling')
    .version('0.1.0');

  registerWorkflowCommands(program);

  return program;
}

async function main(): Promise<void> {
  const program = createProgram();

  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}
