import { materializeObservatoryConfig } from './lib/config';

async function main() {
  const { config } = await materializeObservatoryConfig({ logger: { debug(){}, error(){}} });
  console.log(typeof config.filestore.forcePathStyle, config.filestore.forcePathStyle);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
