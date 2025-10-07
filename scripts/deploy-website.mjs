#!/usr/bin/env node
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const args = parseArgs(process.argv.slice(2))
const ref = args.branch ?? args.ref ?? 'main'
const invalidate = args.invalidate ?? true
const repoRoot = runCapture('git', ['rev-parse', '--show-toplevel']).trim()
const terraformDir = join(repoRoot, 'infra/aws-demo')

ensureCommand('terraform')
ensureCommand('aws')
ensureCommand('git')
ensureCommand('npm')

console.log(`▶ Deploying website from ref "${ref}"`)

run('git', ['fetch', 'origin', ref], { cwd: repoRoot })

const targetRef = resolveRef(ref)
const worktreeDir = mkdtempSync(join(tmpdir(), 'apphub-website-'))
let worktreeAttached = false

try {
  run('git', ['worktree', 'add', '--force', '--detach', worktreeDir, targetRef], {
    cwd: repoRoot
  })
  worktreeAttached = true

  console.log('▶ Installing dependencies (npm ci)')
  run('npm', ['ci'], { cwd: worktreeDir })

  console.log('▶ Building website')
  run('npm', ['run', 'build', '--workspace', '@apphub/website'], { cwd: worktreeDir })

  const distDir = join(worktreeDir, 'apps/website/dist')
  if (!existsSync(distDir)) {
    throw new Error(`Build output not found at ${distDir}`)
  }

  const outputs = JSON.parse(
    runCapture('terraform', ['-chdir', terraformDir, 'output', '-json'])
  )
  const bucket = outputs.website_bucket?.value ?? null
  const distribution = outputs.website_distribution_id?.value ?? null
  const endpoint = outputs.demo_endpoint?.value ?? null
  const publicIp = outputs.ec2_public_ip?.value ?? null
  const host = args.host ?? endpoint ?? publicIp

  if (!bucket && !host) {
    throw new Error(
      'Unable to determine deployment target. Ensure terraform outputs include website_bucket or ec2_public_ip.'
    )
  }

  if (bucket) {
    console.log(`▶ Syncing dist/ to s3://${bucket}`)
    run('aws', ['s3', 'sync', distDir, `s3://${bucket}`, '--delete'], { cwd: repoRoot })
  } else {
    console.log('ℹ website_bucket output not found, skipping S3 sync')
  }

  if (distribution && invalidate) {
    console.log(`▶ Creating CloudFront invalidation for distribution ${distribution}`)
    run('aws', [
      'cloudfront',
      'create-invalidation',
      '--distribution-id',
      distribution,
      '--paths',
      '/*'
    ])
  } else if (distribution && !invalidate) {
    console.log('ℹ Skipping CloudFront invalidation (per --no-invalidate)')
  }

  if (!distribution && host) {
    ensureCommand('ssh')
    ensureCommand('rsync')
    console.log(`▶ Syncing dist/ to ${host}:/opt/apphub/website/dist`)
    run('ssh', [`ec2-user@${host}`, 'mkdir -p /opt/apphub/website/dist'])
    run('rsync', [
      '-az',
      '--delete',
      `${distDir}/`,
      `ec2-user@${host}:/opt/apphub/website/dist/`
    ])
    console.log('▶ Reloading nginx on remote host')
    run('ssh', [`ec2-user@${host}`, 'sudo systemctl reload nginx'])
  }

  console.log('✅ Website deployment complete')
} finally {
  if (worktreeAttached) {
    runSilently('git', ['worktree', 'remove', '--force', worktreeDir], { cwd: repoRoot })
  }
  rmSync(worktreeDir, { recursive: true, force: true })
}

function resolveRef(ref) {
  try {
    runCapture('git', ['rev-parse', '--verify', ref], { cwd: repoRoot })
    return ref
  } catch {
    const remoteRef = `origin/${ref}`
    runCapture('git', ['rev-parse', '--verify', remoteRef], { cwd: repoRoot })
    return remoteRef
  }
}

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
      case '--no-invalidate':
        result.invalidate = false
        break
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return result
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    ...options
  })
  if (result.status !== 0) {
    throw new Error(`[${cmd}] exited with status ${result.status ?? 'unknown'}`)
  }
  return result
}

function runSilently(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    stdio: ['ignore', 'ignore', 'inherit'],
    ...options
  })
  return result
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
