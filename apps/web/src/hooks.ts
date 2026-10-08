import { useEffect, useRef, useState } from 'react';

/** Flips to true after delayMs; lets a loading state say more once a wait is noticeable. */
export function useDelayedFlag(delayMs: number): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setOn(true), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs]);
  return on;
}

/** Seconds left until `seconds` from mount; calls onDone once at zero. Re-mount (via key) to restart. */
export function useCountdown(seconds: number, onDone: () => void): number {
  const [remaining, setRemaining] = useState(seconds);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });

  useEffect(() => {
    const deadline = Date.now() + seconds * 1000;
    const timer = setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) {
        clearInterval(timer);
        onDoneRef.current();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [seconds]);

  return remaining;
}
