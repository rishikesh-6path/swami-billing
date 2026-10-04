import { useEffect, useState } from 'react';
import type { Channel, Req, Res } from '../../ipc/contract.ts';

/** Calls the main process. Rejects with a message that is already written for shop staff. */
/** An error from the main side: its message is written for shop staff; `code` is for the screen. */
export class CallError extends Error {
  readonly code: string | undefined;
  constructor(message: string, code: string | undefined) {
    super(message);
    this.code = code;
  }
}

export async function call<C extends Channel>(channel: C, request: Req<C>): Promise<Res<C>> {
  const result = await window.shopledger.invokeResult(channel, request);
  if (!result.ok) throw new CallError(result.message, result.code);
  return result.data;
}

/**
 * The most recent loaded data, kept on screen while a newer request (for example after the bill
 * date changed) is still loading, so the form never disappears and loses focus.
 */
export function useKept<T>(loaded: Loaded<T>): T | null {
  const [kept, setKept] = useState<T | null>(null);
  if (loaded.status === 'ready' && loaded.data !== kept) setKept(loaded.data);
  return loaded.status === 'ready' ? loaded.data : kept;
}

export type Loaded<T> =
  { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; message: string };

/**
 * Loads data when the screen opens and whenever the request changes. `reload()` fetches it again
 * (for example after saving). While a new request is loading, the status is 'loading'.
 */
export function useCall<C extends Channel>(
  channel: C,
  request: Req<C>,
): Loaded<Res<C>> & { reload: () => void } {
  const [tick, setTick] = useState(0);
  const key = JSON.stringify([channel, request, tick]);
  const [done, setDone] = useState<{
    key: string;
    outcome: { data: Res<C> } | { message: string };
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const [ch, req] = JSON.parse(key) as [C, Req<C>, number];
    call(ch, req).then(
      (data) => {
        if (!cancelled) setDone({ key, outcome: { data } });
      },
      (error: unknown) => {
        if (!cancelled) {
          setDone({
            key,
            outcome: { message: error instanceof Error ? error.message : 'Something went wrong.' },
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key]);

  const reload = () => setTick((t) => t + 1);
  if (done?.key !== key) return { status: 'loading', reload };
  return 'data' in done.outcome
    ? { status: 'ready', data: done.outcome.data, reload }
    : { status: 'error', message: done.outcome.message, reload };
}
