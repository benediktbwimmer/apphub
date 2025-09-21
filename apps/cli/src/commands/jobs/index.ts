import { Command } from 'commander';
import { registerPackageCommand } from './package';
import { registerPublishCommand } from './publish';
import { registerTestCommand } from './test';

export function registerJobsCommands(program: Command): void {
  const jobs = program.command('jobs').description('Work with job bundles');

  registerPackageCommand(jobs);
  registerPublishCommand(jobs);
  registerTestCommand(jobs);
}
