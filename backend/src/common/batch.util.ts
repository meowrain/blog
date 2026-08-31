import { mapWithConcurrency } from './async.util';

export interface MutationFailureItem {
  path: string;
  reason: string;
}

/**
 * Shared result shape for the many-file category and tag operations. `count`
 * stays the key the admin UI reads, and `failures` exists so a partial success
 * is reportable instead of being swallowed by a catch block.
 */
export interface MutationResultDto {
  total: number;
  count: number;
  /** Articles already in the requested state, so nothing was written. */
  skipped: number;
  failed: number;
  failures: MutationFailureItem[];
}

export type BatchOutcome = 'applied' | 'skipped';

/**
 * Apply `mutate` to every item with bounded concurrency, collecting failures
 * rather than aborting the batch on the first one. Returning nothing counts as
 * `applied`.
 */
export async function runBatch<T>(
  items: readonly T[],
  concurrency: number,
  getPath: (item: T) => string,
  mutate: (item: T) => Promise<BatchOutcome | void>,
  onFailed: (path: string, reason: string) => void = () => undefined,
): Promise<MutationResultDto> {
  const failures: MutationFailureItem[] = [];

  const results = await mapWithConcurrency(items, concurrency, async (item) => {
    try {
      return (await mutate(item)) ?? 'applied';
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failures.push({ path: getPath(item), reason });
      onFailed(getPath(item), reason);
      return 'failed' as const;
    }
  });

  return {
    total: items.length,
    count: results.filter((outcome) => outcome === 'applied').length,
    skipped: results.filter((outcome) => outcome === 'skipped').length,
    failed: failures.length,
    failures,
  };
}
