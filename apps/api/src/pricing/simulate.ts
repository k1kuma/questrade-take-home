import type { FetchFn } from './http';

export type SimulatedFailure = '429' | 'timeout';

/** Replaces fetch so the failure path can be demonstrated on demand via SIMULATE_COINGECKO. */
export function simulatedFailureFetch(failure: SimulatedFailure): FetchFn {
  return (_url, init) => {
    if (failure === '429') {
      return Promise.resolve(
        new Response('{"status":{"error_code":429,"error_message":"simulated"}}', {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '60' },
        }),
      );
    }
    // Hangs until the client's timeout aborts it, exactly like an unresponsive upstream.
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    });
  };
}
