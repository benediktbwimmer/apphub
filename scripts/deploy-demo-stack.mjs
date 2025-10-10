#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const args = parseArgs(process.argv.slice(2))
const branch = validateRef(args.branch ?? args.ref ?? 'main')
const repoRoot = runCapture('git', ['rev-parse', '--show-toplevel']).trim()
const terraformDir = join(repoRoot, 'infra/aws-demo')

ensureCommand('terraform')
ensureCommand('ssh')
ensureCommand('git')

console.log(`▶ Deploying demo stack from branch "${branch}"`)

const outputs = JSON.parse(
  runCapture('terraform', ['-chdir', terraformDir, 'output', '-json'])
)
const endpoint = outputs.demo_endpoint?.value ?? null
const publicIp = outputs.ec2_public_ip?.value ?? null
const host = args.host ?? endpoint ?? publicIp

if (!host) {
  throw new Error(
    'Unable to resolve target host. Provide --host or ensure terraform outputs are up to date.'
  )
}

const script = `
set -euo pipefail
BRANCH="${branch}"
cd /opt/apphub/source
git fetch origin "$BRANCH"
git checkout -B "$BRANCH" "origin/$BRANCH"
git reset --hard "origin/$BRANCH"
git clean -xdf
git pull --ff-only origin "$BRANCH"
COMPOSE_DOCKER_CLI_BUILD=1 DOCKER_BUILDKIT=1 docker compose \\
  --file docker/demo-stack.compose.yml \\
  --file /opt/apphub/docker-compose.override.yml \\
  --env-file /opt/apphub/.env \\
  up -d --remove-orphans --build
docker compose \\
  --file docker/demo-stack.compose.yml \\
  --file /opt/apphub/docker-compose.override.yml \\
  --env-file /opt/apphub/.env \\
  ps
`

const sshResult = spawnSync(
  'ssh',
  [`ec2-user@${host}`, 'bash', '-s'],
  {
    input: script,
    stdio: ['pipe', 'inherit', 'inherit']
  }
)

if (sshResult.status !== 0) {
  throw new Error(`Remote deployment failed with status ${sshResult.status ?? 'unknown'}`)
}

console.log('✅ Demo stack deployment complete')

function parseArgs(input) {
  const result = {}
  const queue = [...input]
  while (queue.length) {
    const arg = queue.shift()
    switch (arg) {
      case '--branch':
      case '--ref': {
        const value = queue.shift()
        if (!value) throw new Error(`${arg} requires a value`)
        result.branch = value
        break
      }
      case '--host': {
        const value = queue.shift()
        if (!value) throw new Error('--host requires a value')
        result.host = value
        break
      }
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return result
}

function validateRef(value) {
  if (!/^[A-Za-z0-9._/-]+$/.test(value)) {
    throw new Error(`Invalid git ref: ${value}`)
  }
  return value
}

function runCapture(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    stdio: ['inherit', 'pipe', 'inherit'],
    encoding: 'utf8',
    ...options
  })
  if (result.status !== 0) {
    throw new Error(`[${cmd}] exited with status ${result.status ?? 'unknown'}`)
  }
  return result.stdout.trim()
}

function ensureCommand(binary) {
  const result = spawnSync(binary, ['--version'], { stdio: 'ignore' })
  if (result.status !== 0) {
    throw new Error(`Required command "${binary}" not found in PATH`)
  }
}
