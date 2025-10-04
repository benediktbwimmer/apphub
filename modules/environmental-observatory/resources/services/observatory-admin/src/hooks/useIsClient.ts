import { useEffect, useState } from 'react';

export function useIsClient(): boolean {
  const [ready, setReady] = useState(() => typeof window !== 'undefined');

  useEffect(() => {
    if (!ready) {
      setReady(true);
    }
  }, [ready]);

  return ready;
}
