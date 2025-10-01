import { materializeObservatoryConfig } from './lib/config';

materializeObservatoryConfig()
  .then(({ outputPath }) => {
    console.log(`Observatory config written to ${outputPath}`);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
