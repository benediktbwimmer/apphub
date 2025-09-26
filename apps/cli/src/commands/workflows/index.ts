import { Command } from 'commander';
import { registerTriggerCommands } from './triggers';

export function registerWorkflowCommands(program: Command): void {
  const workflows = program.command('workflows').description('Manage workflows and event triggers');

  registerTriggerCommands(workflows);
}

