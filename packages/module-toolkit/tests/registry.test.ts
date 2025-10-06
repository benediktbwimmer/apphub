import { describe, expect, test } from 'vitest';
import {
  defineTrigger,
  event,
  literal,
  fromConfig,
  createTriggerRegistry,
  defineJobParameters,
  createJobRegistry,
  createTargetRegistry,
  createTargetRegistryFromArray
} from '../src/index';

interface EventPayload {
  payload: {
    value?: string;
  };
}

interface TriggerMeta {
  hint: string;
}

interface Settings {
  baseUrl: string;
}

describe('registry helpers', () => {
  const trigger = defineTrigger<EventPayload, TriggerMeta, Settings>({
    workflowSlug: 'workflow-a',
    slug: 'event-trigger',
    name: 'Event trigger',
    eventType: 'foo',
    predicates: [],
    parameters: {
      value: event<EventPayload>('payload.value').default('fallback'),
      baseUrl: fromConfig<Settings>((settings) => settings.baseUrl)
    }
  });

  test('createTriggerRegistry exposes typed lookup', () => {
    const registry = createTriggerRegistry({
      'event-trigger': trigger
    });

    expect(registry.slugs).toEqual(['event-trigger']);
    const built = registry.buildAll({ settings: { baseUrl: 'http://localhost' } });
    expect(built).toHaveLength(1);
    expect(built[0]?.parameterTemplate?.baseUrl).toBe('http://localhost');
  });

  test('createJobRegistry compiles definitions', () => {
    const job = defineJobParameters<Settings>({
      slug: 'job-a',
      parameters: {
        baseUrl: fromConfig((settings) => settings.baseUrl),
        constant: literal('value')
      }
    });

    const registry = createJobRegistry({
      'job-a': job
    });

    const [params] = registry.buildAll({ settings: { baseUrl: 'http://localhost' } });
    expect(params.baseUrl).toBe('http://localhost');
    expect(params.constant).toBe('value');
  });

  test('createTargetRegistry aggregates arbitrary targets', () => {
    const targetA = { name: 'target-a' };
    const targetB = { name: 'target-b' };

    const registry = createTargetRegistryFromArray([targetA, targetB]);

    expect(registry.slugs).toEqual(['target-a', 'target-b']);
    expect(registry.get('target-a')).toBe(targetA);
    expect(registry.values()).toEqual([targetA, targetB]);
  });
});
