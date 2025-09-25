import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export type DockerMockConfig = {
  mappedPort?: number;
  containerIp?: string;
};

export class DockerMock {
  private readonly config: DockerMockConfig;
  private tempDir: string | null = null;
  private running = false;

  constructor(config: DockerMockConfig = {}) {
    this.config = config;
  }

  async start(): Promise<{ pathPrefix: string }> {
    if (this.running) {
      throw new Error('DockerMock already running');
    }

    const dir = await mkdtemp(path.join(os.tmpdir(), 'docker-mock-'));
    this.tempDir = dir;

    const port = this.config.mappedPort ?? 32768;
    const containerIp = this.config.containerIp ?? '172.18.0.2';
    const inspectResponse = {
      bridge: {
        IPAddress: containerIp
      }
    } satisfies Record<string, unknown>;

    const script = `#!/bin/sh
cmd="$1"
shift
case "$cmd" in
  run)
    while [ "$#" -gt 0 ]; do
      if [ "$1" = "-p" ]; then
        shift 2
        continue
      fi
      if [ "$1" = "-e" ]; then
        shift 2
        continue
      fi
      shift
    done
    echo fake-container-$$
    exit 0
    ;;
  port)
    echo "3000/tcp -> 0.0.0.0:${port}"
    exit 0
    ;;
  inspect)
    echo '${JSON.stringify(inspectResponse)}'
    exit 0
    ;;
  stop|rm)
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
`;

    const scriptPath = path.join(dir, 'docker');
    await writeFile(scriptPath, script, 'utf8');
    await chmod(scriptPath, 0o755);

    this.running = true;

    return { pathPrefix: dir };
  }

  async stop(): Promise<void> {
    if (this.tempDir) {
      await rm(this.tempDir, { recursive: true, force: true });
      this.tempDir = null;
    }
    this.running = false;
  }
}
