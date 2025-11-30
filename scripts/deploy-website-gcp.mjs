#!/usr/bin/env node
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const args = parseArgs(process.argv.slice(2))
const ref = args.branch ?? args.ref ?? 'main'
const invalidate = args.invalidate ?? true
const repoRoot = runCapture('git', ['rev-parse', '--show-toplevel']).trim()
const terraformDir = join(repoRoot, 'infra/gcp-demo')

ensureCommand('terraform')
ensureCommand('gcloud')
ensureCommand('git')
ensureCommand('npm')

console.log(`▶ Deploying website to GCP from ref "${ref}"`)

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
    runCapture('terraform', [`-chdir=${terraformDir}`, 'output', '-json'])
  )
  const bucket = outputs.website_bucket?.value ?? null
  const urlMap = outputs.website_url_map_name?.value ?? null

  if (!bucket) {
    throw new Error('Unable to determine website bucket from terraform outputs')
  }

  console.log(`▶ Syncing dist/ to gs://${bucket} (gsutil rsync)`)
  run('gsutil', ['-m', 'rsync', '-d', '-r', distDir, `gs://${bucket}`], {
    cwd: repoRoot
  })

  if (urlMap && invalidate) {
    console.log(`▶ Invalidating Cloud CDN cache for url-map ${urlMap}`)
    run('gcloud', ['compute', 'url-maps', 'invalidate-cdn-cache', urlMap, '--path', '/*'], {
      cwd: repoRoot
    })
  } else if (urlMap && !invalidate) {
    console.log('ℹ Skipping CDN invalidation (per --no-invalidate)')
  } else {
    console.log('ℹ No url_map output found; skipped CDN invalidation')
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
