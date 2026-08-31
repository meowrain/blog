import { IndexedArticle } from './content-index.service';
import { LIMITS } from './constants';

export interface PageQuery {
  page?: number;
  limit?: number;
}

export interface PagedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

function clampInt(
  value: number | string | undefined,
  fallback: number,
  max: number,
): number {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.min(parsed, max);
}

/** A query-string `limit` that fails to parse falls back instead of returning everything. */
export function clampLimit(
  value: number | string | undefined,
  fallback: number,
  max: number,
): number {
  return clampInt(value, fallback, max);
}

/** Caller-supplied paging, clamped so a bad query string cannot ask for the whole store. */
export function resolvePage(query: PageQuery): { page: number; limit: number } {
  return {
    page: clampInt(query.page, 1, Number.MAX_SAFE_INTEGER),
    limit: clampInt(query.limit, LIMITS.DEFAULT_PAGE_LIMIT, LIMITS.MAX_PAGE_LIMIT),
  };
}

export function paginate<T>(items: T[], page: number, limit: number): PagedResult<T> {
  const startIndex = (page - 1) * limit;
  return {
    data: items.slice(startIndex, startIndex + limit),
    total: items.length,
    page,
    limit,
    totalPages: Math.ceil(items.length / limit),
  };
}

/**
 * Newest first. Timestamps are parsed once up front instead of on every
 * comparison, and the path breaks ties so two pages never disagree.
 */
export function sortByPublishedDesc(items: IndexedArticle[]): IndexedArticle[] {
  const ranks = new Map<string, number>();
  for (const item of items) {
    ranks.set(item.relativePath, new Date(item.frontmatter.published).getTime() || 0);
  }

  return items.sort((a, b) => {
    const delta = (ranks.get(b.relativePath) ?? 0) - (ranks.get(a.relativePath) ?? 0);
    return delta || a.relativePath.localeCompare(b.relativePath);
  });
}
