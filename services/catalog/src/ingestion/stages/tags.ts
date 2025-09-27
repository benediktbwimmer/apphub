import { promises as fs } from 'node:fs';
import path from 'node:path';
import { listNetworksForMemberRepository as listNetworksDefault } from '../../db/index';
import { fileExists } from '../fs';
import { log } from '../logger';
import type { DiscoveredTag, IngestionPipelineContext, PipelineStage } from '../types';

type TagStageDeps = {
  listNetworksForMemberRepository?: (repositoryId: string) => Promise<string[]>;
};

function addTag(map: Map<string, DiscoveredTag>, key: string, value: string, source: string) {
  const normalizedKey = key.trim();
  const normalizedValue = value.trim();
  if (!normalizedKey || !normalizedValue) {
    return;
  }
  const compoundKey = `${normalizedKey.toLowerCase()}:${normalizedValue.toLowerCase()}`;
  if (!map.has(compoundKey)) {
    map.set(compoundKey, { key: normalizedKey, value: normalizedValue, source });
  }
}

function createTagMap(initial: DiscoveredTag[]) {
  const map = new Map<string, DiscoveredTag>();
  for (const tag of initial) {
    addTag(map, tag.key, tag.value, tag.source);
  }
  return map;
}

async function detectTagsFromDockerfile(projectDir: string, relativePath: string | null) {
  if (!relativePath) {
    return [] as DiscoveredTag[];
  }
  const absolute = path.join(projectDir, relativePath);
  if (!(await fileExists(absolute))) {
    return [] as DiscoveredTag[];
  }

  try {
    const contents = await fs.readFile(absolute, 'utf8');
    const tags: DiscoveredTag[] = [];
    const fromMatch = contents.match(/FROM\s+([^\s]+)/i);
    if (fromMatch) {
      const baseImage = fromMatch[1];
      if (/node:?\s*(\d+)/i.test(baseImage)) {
        const version = baseImage.match(/node:?([\d.]+)/i)?.[1] ?? 'latest';
        tags.push({
          key: 'runtime',
          value: `node${version.replace(/\./g, '')}`,
          source: 'ingestion:dockerfile'
        });
        tags.push({ key: 'language', value: 'javascript', source: 'ingestion:dockerfile' });
      }
      if (/python:?/i.test(baseImage)) {
        const version = baseImage.match(/python:?([\d.]+)/i)?.[1];
        tags.push({ key: 'language', value: 'python', source: 'ingestion:dockerfile' });
        if (version) {
          tags.push({
            key: 'runtime',
            value: `python${version.replace(/\./g, '')}`,
            source: 'ingestion:dockerfile'
          });
        }
      }
      if (/nginx/i.test(baseImage)) {
        tags.push({ key: 'runtime', value: 'nginx', source: 'ingestion:dockerfile' });
      }
    }
    if (/streamlit/i.test(contents)) {
      tags.push({ key: 'framework', value: 'streamlit', source: 'ingestion:dockerfile' });
    }
    if (/uvicorn/i.test(contents)) {
      tags.push({ key: 'framework', value: 'fastapi', source: 'ingestion:dockerfile' });
    }
    return tags;
  } catch (err) {
    log('Failed to analyze Dockerfile', { error: (err as Error).message });
    return [];
  }
}

export function createTagAggregationStage(deps: TagStageDeps = {}): PipelineStage {
  const listNetworks = deps.listNetworksForMemberRepository ?? listNetworksDefault;
  return {
    name: 'tags',
    async run(context: IngestionPipelineContext) {
      const tagMap = createTagMap(
        context.repository.tags.map((tag) => ({
          key: tag.key,
          value: tag.value,
          source: tag.source ?? 'author'
        }))
      );

      if (context.shouldAutofillMetadata) {
        for (const tag of context.packageMetadata?.tags ?? []) {
          addTag(tagMap, tag.key, tag.value, tag.source);
        }

        for (const tag of context.declaredTags) {
          addTag(tagMap, tag.key, tag.value, tag.source);
        }

        const dockerTags = await detectTagsFromDockerfile(context.workingDir!, context.dockerfilePath);
        context.dockerTags = dockerTags;
        for (const tag of dockerTags) {
          addTag(tagMap, tag.key, tag.value, tag.source);
        }
      }

      const networkMemberships = await listNetworks(context.repository.id);
      for (const networkId of networkMemberships) {
        addTag(tagMap, 'service-network', networkId, 'manifest:service-network');
      }

      context.tagMap = tagMap;
    }
  };
}

export const tagAggregationStage = createTagAggregationStage();

export { addTag, createTagMap, detectTagsFromDockerfile };
export type { TagStageDeps };
