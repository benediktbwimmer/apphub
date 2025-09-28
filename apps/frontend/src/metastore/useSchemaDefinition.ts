import { useEffect, useState } from 'react';
import type { useAuthorizedFetch } from '../auth/useAuthorizedFetch';
import { fetchSchemaDefinition } from './api';
import type { MetastoreSchemaDefinition } from './types';

export type SchemaDefinitionHookState = {
  status: 'idle' | 'loading' | 'ready' | 'missing' | 'error';
  schema: MetastoreSchemaDefinition | null;
  loading: boolean;
  error: string | null;
  missingMessage: string | null;
};

const INITIAL_STATE: SchemaDefinitionHookState = {
  status: 'idle',
  schema: null,
  loading: false,
  error: null,
  missingMessage: null
};

export function useSchemaDefinition(
  authorizedFetch: ReturnType<typeof useAuthorizedFetch>,
  schemaHash: string | null | undefined
): SchemaDefinitionHookState {
  const [state, setState] = useState<SchemaDefinitionHookState>(INITIAL_STATE);

  useEffect(() => {
    if (!schemaHash) {
      setState({ ...INITIAL_STATE });
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    setState({
      status: 'loading',
      schema: null,
      loading: true,
      error: null,
      missingMessage: null
    });

    fetchSchemaDefinition(authorizedFetch, schemaHash, { signal: controller.signal })
      .then((result) => {
        if (cancelled) {
          return;
        }
        if (result.status === 'found') {
          setState({
            status: 'ready',
            schema: result.schema,
            loading: false,
            error: null,
            missingMessage: null
          });
        } else {
          setState({
            status: 'missing',
            schema: null,
            loading: false,
            error: null,
            missingMessage: result.message
          });
        }
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        const message = err instanceof Error ? err.message : 'Failed to load schema definition';
        setState({
          status: 'error',
          schema: null,
          loading: false,
          error: message,
          missingMessage: null
        });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [authorizedFetch, schemaHash]);

  return state;
}
