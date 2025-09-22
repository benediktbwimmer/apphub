import type { AiGeneratedBundleSuggestion } from './bundlePublisher';

const directoryFileInfoBundle: AiGeneratedBundleSuggestion = {
  slug: 'directory-file-info',
  version: '1.0.4',
  entryPoint: 'index.js',
  manifest: {
    name: 'directory-file-info',
    version: '1.0.4',
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
      contents: `"use strict";

const fs = require('node:fs/promises');
const path = require('node:path');

async function listDirectory(root, options) {
  const queue = [{ directory: root, depth: 0 }];
  const results = [];
  const seen = new Set();

  async function stat(entryPath) {
    try {
      return options.followSymlinks ? await fs.stat(entryPath) : await fs.lstat(entryPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error('Failed to stat ' + entryPath + ': ' + message);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    const { directory, depth } = current;
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error('Failed to read directory ' + directory + ': ' + message);
    }

    for (const entry of entries) {
      if (!options.includeHidden && entry.name.startsWith('.')) {
        continue;
      }
      const fullPath = path.join(directory, entry.name);
      if (seen.has(fullPath)) {
        continue;
      }
      seen.add(fullPath);

      const stats = await stat(fullPath);
      const isSymlink = stats.isSymbolicLink();
      const isDirectory = stats.isDirectory();
      const type = isDirectory ? 'directory' : stats.isFile() ? 'file' : 'other';
      const relativePath = path.relative(root, fullPath) || '.';

      results.push({
        name: entry.name,
        path: fullPath,
        relativePath,
        type,
        size: stats.size,
        depth,
        modifiedAt: stats.mtime?.toISOString?.() ?? new Date(stats.mtimeMs).toISOString(),
        createdAt:
          stats.birthtime?.toISOString?.() ??
          stats.ctime?.toISOString?.() ??
          new Date(stats.ctimeMs).toISOString(),
        mode: stats.mode ?? null,
        isSymbolicLink: isSymlink
      });

      if (isDirectory && options.recursive && depth < options.maxDepth) {
        if (!options.followSymlinks && isSymlink) {
          continue;
        }
        queue.push({ directory: fullPath, depth: depth + 1 });
      }
    }
  }

  return results;
}

exports.handler = async function handler(context) {
  const params = context?.parameters ?? {};
  const directoryPath = typeof params.directoryPath === 'string' ? params.directoryPath.trim() : '';
  if (!directoryPath) {
    throw new Error('directoryPath parameter is required');
  }

  const recursive = Boolean(params.recursive);
  const includeHidden = Boolean(params.includeHidden);
  const followSymlinks = Boolean(params.followSymlinks);
  const maxDepth = Number.isFinite(params.maxDepth) ? Math.max(0, Number(params.maxDepth)) : 1;

  const resolvedRoot = path.resolve(directoryPath);
  context.logger('Enumerating directory', { directory: resolvedRoot, recursive, maxDepth });

  const files = await listDirectory(resolvedRoot, {
    recursive,
    includeHidden,
    followSymlinks,
    maxDepth
  });

  const fileEntries = files.filter((entry) => entry.type === 'file');
  const directoryCount = files.filter((entry) => entry.type === 'directory').length;
  const skippedEntries = files.length - fileEntries.length;
  if (skippedEntries > 0) {
    context.logger('Skipping non-file entries from directory listing', {
      directory: resolvedRoot,
      skippedEntries,
      originalCount: files.length
    });
  }

  return {
    status: 'succeeded',
    result: {
      root: resolvedRoot,
      fileCount: fileEntries.length,
      files: fileEntries,
      directoryCount,
      skippedEntries
    }
  };
};
`
    }
  ]
};

const fileWordCountBundle: AiGeneratedBundleSuggestion = {
  slug: 'file-word-count',
  version: '1.0.3',
  entryPoint: 'index.js',
  manifest: {
    name: 'file-word-count',
    version: '1.0.3',
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
      contents: `"use strict";

const fs = require('node:fs/promises');
const path = require('node:path');

function countWords(text) {
  if (!text) {
    return 0;
  }
  return text
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean).length;
}

exports.handler = async function handler(context) {
  const params = context?.parameters ?? {};
  const filePath = typeof params.filePath === 'string' ? params.filePath.trim() : '';
  if (!filePath) {
    throw new Error('filePath parameter is required');
  }
  const encoding = typeof params.encoding === 'string' && params.encoding ? params.encoding : 'utf8';
  const resolvedPath = path.resolve(filePath);
  context.logger('Counting words in file', { filePath: resolvedPath, encoding });

  let stats;
  try {
    stats = await fs.stat(resolvedPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error('Failed to stat file ' + resolvedPath + ': ' + message);
  }

  if (!stats.isFile()) {
    const entryType = stats.isDirectory() ? 'directory' : 'other';
    context.logger('Skipping non-file entry', { filePath: resolvedPath, entryType });
    return {
      status: 'succeeded',
      result: {
        path: resolvedPath,
        encoding,
        wordCount: 0,
        skipped: true,
        entryType,
        reason: 'not-regular-file'
      }
    };
  }

  let contents;
  try {
    contents = await fs.readFile(resolvedPath, { encoding });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error('Failed to read file ' + resolvedPath + ': ' + message);
  }

  const wordCount = countWords(contents);
  return {
    status: 'succeeded',
    result: {
      path: resolvedPath,
      encoding,
      wordCount,
      skipped: false
    }
  };
};
`
    }
  ]
};

const sumNumbersBundle: AiGeneratedBundleSuggestion = {
  slug: 'sum-numbers',
  version: '1.0.3',
  entryPoint: 'index.js',
  manifest: {
    name: 'sum-numbers',
    version: '1.0.3',
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
      contents: `"use strict";\n\nfunction toFiniteNumber(value) {\n  if (typeof value === 'number' && Number.isFinite(value)) {\n    return value;\n  }\n  if (value && typeof value === 'object') {\n    const direct = typeof value.wordCount === 'number' ? value.wordCount : null;\n    const directValue = direct ?? (typeof value.value === 'number' ? value.value : null);\n    const nestedOutput = value.output && typeof value.output === 'object' && typeof value.output.wordCount === 'number'\n      ? value.output.wordCount\n      : null;\n    const nestedValue = value.output && typeof value.output === 'object' && typeof value.output.value === 'number'\n      ? value.output.value\n      : null;\n    const candidate = directValue ?? nestedOutput ?? nestedValue;\n    if (typeof candidate === 'number' && Number.isFinite(candidate)) {\n      return candidate;\n    }\n  }\n  return null;\n}\n\nfunction validateNumbers(candidate) {\n  if (!Array.isArray(candidate)) {\n    throw new Error('numbers parameter must be an array');\n  }\n  const numbers = [];\n  for (const value of candidate) {\n    const numeric = toFiniteNumber(value);\n    if (numeric === null) {\n      throw new Error('numbers array must contain only finite numbers');\n    }\n    numbers.push(numeric);\n  }\n  if (numbers.length === 0) {\n    throw new Error('numbers array must contain at least one value');\n  }\n  return numbers;\n}\n\nexports.handler = async function handler(context) {\n  const params = context?.parameters ?? {};\n  const numbers = validateNumbers(params.numbers);\n  const sum = numbers.reduce((total, value) => total + value, 0);\n  const count = numbers.length;\n  const average = sum / count;\n  const minimum = Math.min(...numbers);\n  const maximum = Math.max(...numbers);\n\n  return {\n    status: 'succeeded',\n    result: {\n      sum,\n      count,\n      average,\n      minimum,\n      maximum\n    }\n  };\n};\n`
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
