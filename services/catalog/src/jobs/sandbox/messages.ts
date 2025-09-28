import type {
  JobDefinitionRecord,
  JobRunRecord,
  JsonValue,
  SecretReference
} from '../../db/types';
import type { JobResult } from '../runtime';
import type { WorkflowEventContext } from '../../workflowEventContext';

export type SandboxCapability = string;

export type SandboxBundleInfo = {
  slug: string;
  version: string;
  checksum: string;
  directory: string;
  entryFile: string;
  manifest: {
    entry: string | null;
    pythonEntry: string | null;
    runtime: string | null;
    capabilities: SandboxCapability[];
  };
  exportName?: string | null;
};

export type SandboxStartPayload = {
  taskId: string;
  bundle: SandboxBundleInfo;
  job: {
    definition: JobDefinitionRecord;
    run: JobRunRecord;
    parameters: JsonValue;
    timeoutMs?: number | null;
  };
  workflowEventContext?: WorkflowEventContext | null;
};

export type SandboxParentMessage =
  | { type: 'start'; payload: SandboxStartPayload }
  | { type: 'cancel'; reason?: string }
  | {
      type: 'update-response';
      requestId: string;
      ok: true;
      run: JobRunRecord;
    }
  | {
      type: 'update-response';
      requestId: string;
      ok: false;
      error: string;
    }
  | {
      type: 'resolve-secret-response';
      requestId: string;
      ok: true;
      value: string | null;
    }
  | {
      type: 'resolve-secret-response';
      requestId: string;
      ok: false;
      error: string;
    };

export type SandboxChildMessage =
  | {
      type: 'log';
      level: 'info' | 'warn' | 'error';
      message: string;
      meta?: Record<string, unknown>;
    }
  | {
      type: 'update-request';
      requestId: string;
      updates: {
        parameters?: JsonValue;
        logsUrl?: string | null;
        metrics?: JsonValue | null;
        context?: JsonValue | null;
        timeoutMs?: number | null;
      };
    }
  | {
      type: 'resolve-secret-request';
      requestId: string;
      reference: SecretReference;
    }
  | {
      type: 'result';
      result: JobResult;
      durationMs: number;
      resourceUsage?: NodeJS.ResourceUsage;
    }
  | {
      type: 'error';
      error: {
        message: string;
        stack?: string;
      };
    };
