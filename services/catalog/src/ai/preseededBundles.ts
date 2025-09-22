import type { AiGeneratedBundleSuggestion } from './bundlePublisher';

const directoryFileInfoBundle: AiGeneratedBundleSuggestion = {
  slug: 'directory-file-info',
  version: '1.0.0',
  entryPoint: 'index.js',
  manifest: {
    name: 'directory-file-info',
    version: '1.0.0',
    description: 'Lists metadata for files in a directory with optional recursion and symlink handling.',
    main: 'index.js',
    entry: 'index.js',
    engines: {
      node: '>=18.0.0'
    },
    capabilities: ['fs']
  },
  capabilityFlags: ['fs'],
  metadata: {
    runtime: 'node18',
    language: 'nodejs',
    source: 'preseeded'
  },
  files: [
    {
      path: 'index.js',
      contents: `"use strict";\n\nconst fs = require('node:fs/promises');\nconst path = require('node:path');\n\nasync function listDirectory(root, options) {\n  const queue = [{ directory: root, depth: 0 }];\n  const results = [];\n  const seen = new Set();\n\n  async function stat(entryPath) {\n    try {\n      return options.followSymlinks ? await fs.stat(entryPath) : await fs.lstat(entryPath);\n    } catch (error) {\n      const message = error instanceof Error ? error.message : String(error);\n      throw new Error(\`Failed to stat \${entryPath}: \${message}\`);\n    }\n  }\n\n  while (queue.length > 0) {\n    const current = queue.shift();\n    if (!current) {\n      break;\n    }\n    const { directory, depth } = current;\n    let entries;\n    try {\n      entries = await fs.readdir(directory, { withFileTypes: true });\n    } catch (error) {\n      const message = error instanceof Error ? error.message : String(error);\n      throw new Error(\`Failed to read directory \${directory}: \${message}\`);\n    }\n\n    for (const entry of entries) {\n      if (!options.includeHidden && entry.name.startsWith('.')) {\n        continue;\n      }\n      const fullPath = path.join(directory, entry.name);\n      if (seen.has(fullPath)) {\n        continue;\n      }\n      seen.add(fullPath);\n\n      const stats = await stat(fullPath);\n      const isSymlink = stats.isSymbolicLink();\n      const isDirectory = stats.isDirectory();\n      const type = isDirectory ? 'directory' : stats.isFile() ? 'file' : 'other';\n      const relativePath = path.relative(root, fullPath) || '.';\n\n      results.push({\n        name: entry.name,\n        path: fullPath,\n        relativePath,\n        type,\n        size: stats.size,\n        depth,\n        modifiedAt: stats.mtime?.toISOString?.() ?? new Date(stats.mtimeMs).toISOString(),\n        createdAt: stats.birthtime?.toISOString?.() ?? stats.ctime?.toISOString?.() ?? new Date(stats.ctimeMs).toISOString(),\n        mode: stats.mode ?? null,\n        isSymbolicLink: isSymlink\n      });\n\n      if (isDirectory && options.recursive && depth < options.maxDepth) {\n        if (!options.followSymlinks && isSymlink) {\n          continue;\n        }\n        queue.push({ directory: fullPath, depth: depth + 1 });\n      }\n    }\n  }\n\n  return results;\n}\n\nexports.handler = async function handler(context) {\n  const params = context?.parameters ?? {};\n  const directoryPath = typeof params.directoryPath === 'string' ? params.directoryPath.trim() : '';\n  if (!directoryPath) {\n    throw new Error('directoryPath parameter is required');\n  }\n\n  const recursive = Boolean(params.recursive);\n  const includeHidden = Boolean(params.includeHidden);\n  const followSymlinks = Boolean(params.followSymlinks);\n  const maxDepth = Number.isFinite(params.maxDepth) ? Math.max(0, Number(params.maxDepth)) : 1;\n\n  const resolvedRoot = path.resolve(directoryPath);\n  context.logger('Enumerating directory', { directory: resolvedRoot, recursive, maxDepth });\n\n  const files = await listDirectory(resolvedRoot, {\n    recursive,\n    includeHidden,\n    followSymlinks,\n    maxDepth\n  });\n\n  return {\n    status: 'succeeded',\n    result: {\n      root: resolvedRoot,\n      fileCount: files.length,\n      files\n    }\n  };\n};\n`
    }
  ]
};

const fileWordCountBundle: AiGeneratedBundleSuggestion = {
  slug: 'file-word-count',
  version: '1.0.0',
  entryPoint: 'index.js',
  manifest: {
    name: 'file-word-count',
    version: '1.0.0',
    description: 'Counts the number of words in a text file.',
    main: 'index.js',
    entry: 'index.js',
    engines: {
      node: '>=18.0.0'
    },
    capabilities: ['fs']
  },
  capabilityFlags: ['fs'],
  metadata: {
    runtime: 'node18',
    language: 'nodejs',
    source: 'preseeded'
  },
  files: [
    {
      path: 'index.js',
      contents: `"use strict";\n\nconst fs = require('node:fs/promises');\nconst path = require('node:path');\n\nfunction countWords(text) {\n  if (!text) {\n    return 0;\n  }\n  return text\n    .split(/\s+/)\n    .map((token) => token.trim())\n    .filter(Boolean).length;\n}\n\nexports.handler = async function handler(context) {\n  const params = context?.parameters ?? {};\n  const filePath = typeof params.filePath === 'string' ? params.filePath.trim() : '';\n  if (!filePath) {\n    throw new Error('filePath parameter is required');\n  }\n  const encoding = typeof params.encoding === 'string' && params.encoding ? params.encoding : 'utf8';\n  const resolvedPath = path.resolve(filePath);\n  context.logger('Counting words in file', { filePath: resolvedPath, encoding });\n\n  let contents;\n  try {\n    contents = await fs.readFile(resolvedPath, { encoding });\n  } catch (error) {\n    const message = error instanceof Error ? error.message : String(error);\n    throw new Error(\`Failed to read file \${resolvedPath}: \${message}\`);\n  }\n\n  const wordCount = countWords(contents);\n  return {\n    status: 'succeeded',\n    result: {\n      path: resolvedPath,\n      encoding,\n      wordCount\n    }\n  };\n};\n`
    }
  ]
};

const sumNumbersBundle: AiGeneratedBundleSuggestion = {
  slug: 'sum-numbers',
  version: '1.0.0',
  entryPoint: 'index.js',
  manifest: {
    name: 'sum-numbers',
    version: '1.0.0',
    description: 'Computes basic aggregates for an array of numbers.',
    main: 'index.js',
    entry: 'index.js',
    engines: {
      node: '>=18.0.0'
    }
  },
  metadata: {
    runtime: 'node18',
    language: 'nodejs',
    source: 'preseeded'
  },
  files: [
    {
      path: 'index.js',
      contents: `"use strict";\n\nfunction validateNumbers(candidate) {\n  if (!Array.isArray(candidate)) {\n    throw new Error('numbers parameter must be an array');\n  }\n  const numbers = [];\n  for (const value of candidate) {\n    if (typeof value !== 'number' || !Number.isFinite(value)) {\n      throw new Error('numbers array must contain only finite numbers');\n    }\n    numbers.push(value);\n  }\n  if (numbers.length === 0) {\n    throw new Error('numbers array must contain at least one value');\n  }\n  return numbers;\n}\n\nexports.handler = async function handler(context) {\n  const params = context?.parameters ?? {};\n  const numbers = validateNumbers(params.numbers);\n  const sum = numbers.reduce((total, value) => total + value, 0);\n  const count = numbers.length;\n  const average = sum / count;\n  const minimum = Math.min(...numbers);\n  const maximum = Math.max(...numbers);\n\n  return {\n    status: 'succeeded',\n    result: {\n      sum,\n      count,\n      average,\n      minimum,\n      maximum\n    }\n  };\n};\n`
    }
  ]
};

type PreseededMap = Record<string, AiGeneratedBundleSuggestion>;

const PRESEEDED_BUNDLES: PreseededMap = {
  'directory-file-info': directoryFileInfoBundle,
  'file-word-count': fileWordCountBundle,
  'sum-numbers': sumNumbersBundle
};

export function getPreseededBundleSuggestion(slug: string): AiGeneratedBundleSuggestion | null {
  const key = slug.trim().toLowerCase();
  const suggestion = PRESEEDED_BUNDLES[key];
  return suggestion ? { ...suggestion, files: suggestion.files.map((file) => ({ ...file })) } : null;
}
