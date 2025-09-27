import { useEffect, useRef, useState } from 'react';

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  const latestValueRef = useRef(value);

  useEffect(() => {
    latestValueRef.current = value;
    const timeout = setTimeout(() => {
      setDebouncedValue(latestValueRef.current);
    }, delayMs);

    return () => {
      clearTimeout(timeout);
    };
  }, [value, delayMs]);

  return debouncedValue;
}
