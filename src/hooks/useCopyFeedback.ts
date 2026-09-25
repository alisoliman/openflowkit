import { useEffect, useRef, useState } from 'react';

/** Reports clipboard completion, including unavailable permissions, and ignores work after unmount. */
export function useCopyFeedback(copy: () => Promise<boolean>): {
  status: 'idle' | 'copying' | 'copied' | 'error';
  copyNow: () => Promise<void>;
} {
  const [status, setStatus] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle');
  const requestId = useRef(0);
  const pending = useRef(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => {
    requestId.current += 1;
    clearTimeout(resetTimer.current);
  }, []);

  async function copyNow(): Promise<void> {
    if (pending.current) return;
    pending.current = true;
    const request = ++requestId.current;
    clearTimeout(resetTimer.current);
    setStatus('copying');
    try {
      const copied = await copy();
      if (request !== requestId.current) return;
      setStatus(copied ? 'copied' : 'error');
      if (copied) resetTimer.current = setTimeout(() => setStatus('idle'), 2000);
    } catch {
      if (request === requestId.current) setStatus('error');
    } finally {
      if (request === requestId.current) pending.current = false;
    }
  }

  return { status, copyNow };
}
