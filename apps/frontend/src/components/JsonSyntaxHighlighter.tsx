import { useMemo } from 'react';
import type { ReactNode } from 'react';

type JsonSyntaxHighlighterProps = {
  value: unknown;
  className?: string;
  ariaLabel?: string;
};

type PreparedValue = {
  text: string;
  isJson: boolean;
};

const JSON_TOKEN_REGEX =
  /("(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(?:\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

function prepareValue(value: unknown): PreparedValue {
  if (value === null || value === undefined) {
    return { text: '', isJson: false };
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return { text: value, isJson: false };
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const pretty = JSON.stringify(parsed, null, 2);
      return { text: pretty, isJson: true };
    } catch {
      return { text: value, isJson: false };
    }
  }

  try {
    const pretty = JSON.stringify(value, null, 2);
    return { text: pretty, isJson: true };
  } catch {
    return { text: String(value), isJson: false };
  }
}

function highlightJson(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  for (const match of text.matchAll(JSON_TOKEN_REGEX)) {
    const token = match[0];
    const index = match.index ?? 0;

    if (index > lastIndex) {
      nodes.push(text.slice(lastIndex, index));
    }

    let tokenClass = '';
    if (token.startsWith('"')) {
      tokenClass = token.endsWith(':') ? 'text-sky-300' : 'text-emerald-300';
    } else if (token === 'true' || token === 'false') {
      tokenClass = 'text-violet-300';
    } else if (token === 'null') {
      tokenClass = 'text-rose-300';
    } else {
      tokenClass = 'text-amber-200';
    }

    nodes.push(
      <span key={`json-token-${key++}`} className={tokenClass}>
        {token}
      </span>
    );

    lastIndex = index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

export default function JsonSyntaxHighlighter({
  value,
  className,
  ariaLabel
}: JsonSyntaxHighlighterProps) {
  const prepared = useMemo(() => prepareValue(value), [value]);
  const highlighted = useMemo(
    () => (prepared.isJson ? highlightJson(prepared.text) : null),
    [prepared.isJson, prepared.text]
  );

  return (
    <pre aria-label={ariaLabel} className={className}>
      <code className="block font-mono" style={{ whiteSpace: 'inherit' }}>
        {prepared.isJson ? highlighted : prepared.text}
      </code>
    </pre>
  );
}
