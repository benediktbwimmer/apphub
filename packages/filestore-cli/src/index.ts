#!/usr/bin/env node
import { createInterface } from './program';

async function main(): Promise<void> {
  const program = createInterface();
  await program.parseAsync(process.argv);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exitCode = 1;
});
