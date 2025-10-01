import { encoding_for_model, type TiktokenModel } from '@dqbd/tiktoken';

export type TokenizableMessage = {
  content: string;
};

type TokenBreakdown = {
  total: number | null;
  perMessage: Array<number | null>;
};

const DEFAULT_MODEL: TiktokenModel = 'gpt-4o-mini';

export function estimateTokenBreakdown(
  messages: TokenizableMessage[],
  model: TiktokenModel = DEFAULT_MODEL
): TokenBreakdown {
  if (messages.length === 0) {
    return { total: 0, perMessage: [] };
  }

  try {
    const encoding = encoding_for_model(model);
    try {
      const counts = messages.map((message) => encoding.encode(message.content ?? '').length);
      const total = counts.reduce((sum, count) => sum + count, 0);
      return { total, perMessage: counts };
    } finally {
      encoding.free();
    }
  } catch {
    return { total: null, perMessage: messages.map(() => null) };
  }
}

export function estimateTokenCount(text: string, model: TiktokenModel = DEFAULT_MODEL): number | null {
  try {
    const encoding = encoding_for_model(model);
    try {
      return encoding.encode(text ?? '').length;
    } finally {
      encoding.free();
    }
  } catch {
    return null;
  }
}
