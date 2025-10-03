import {
  deployEnvironmentalObservatoryModule,
  type DeployObservatoryOptions,
  type DeployObservatoryResult
} from '../../../modules/environmental-observatory/scripts/deploy';

export type { DeployObservatoryOptions, DeployObservatoryResult };
export {
  deployEnvironmentalObservatoryModule,
  deployEnvironmentalObservatoryModule as deployEnvironmentalObservatoryExample
};

async function main(): Promise<void> {
  await deployEnvironmentalObservatoryModule();
  console.log('Observatory module deployment complete.');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
