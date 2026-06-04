// Per-key in-memory async mutex to serialize the cap-check→reservation critical
// section against concurrent POSTs. Single-process only; no cross-process guard.
const chains = new Map<string, Promise<unknown>>();

export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  // Swallow rejections on the stored chain so one failure doesn't poison the next waiter.
  chains.set(key, next.catch(() => undefined));
  return next;
}
