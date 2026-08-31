import path from 'path';

/** Relative env values are resolved against the process cwd, absolute ones are only normalized. */
function resolveDir(value: string | undefined, fallback: string): string {
  if (!value || value.trim().length === 0) {
    return fallback;
  }
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(process.cwd(), value);
}

function readPositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Filesystem locations. POSTS_DIR / BACKUPS_DIR are overridable so tests can point
 * the whole service at a temporary directory without patching module internals.
 */
export const PATHS = {
  /**
   * Root directory of the project
   */
  ROOT: path.resolve(process.cwd(), '..'),

  /**
   * Directory containing blog posts (markdown files)
   */
  POSTS_DIR: resolveDir(
    process.env.POSTS_DIR,
    path.resolve(process.cwd(), '..', 'src', 'content', 'posts'),
  ),

  /**
   * Directory containing automatic file backups
   */
  BACKUPS_DIR: resolveDir(process.env.BACKUPS_DIR, path.resolve(process.cwd(), 'backups')),

  /**
   * Allowed file extensions for markdown files
   */
  MARKDOWN_EXTENSIONS: ['.md', '.mdx'],
};

/** Local Astro dev server and admin origins, used when CORS_ORIGINS is unset. */
const DEFAULT_CORS_ORIGINS = [
  'http://localhost:4321',
  'http://127.0.0.1:4321',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

/**
 * HTTP / transport configuration
 */
export const HTTP = {
  PORT: readPositiveNumber(process.env.PORT, 3009),

  /**
   * Body size ceiling, also the practical cap on a single article payload.
   */
  MAX_BODY_SIZE: readPositiveNumber(process.env.MAX_BODY_SIZE, 10 * 1024 * 1024),

  CORS_CONFIG: {
    origin: (process.env.CORS_ORIGINS ?? DEFAULT_CORS_ORIGINS.join(','))
      .split(',')
      .map((o) => o.trim())
      .filter((o) => o.length > 0),
    credentials: true,
  },

  /**
   * When set, every /api route requires `Authorization: Bearer <token>`.
   * Unset means the API stays open (local development default).
   */
  API_TOKEN: process.env.API_TOKEN?.trim() ?? '',
};

/**
 * Frontmatter field names
 */
export const FRONTMATTER_FIELDS = {
  TITLE: 'title',
  PUBLISHED: 'published',
  DESCRIPTION: 'description',
  IMAGE: 'image',
  TAGS: 'tags',
  CATEGORY: 'category',
  DRAFT: 'draft',
  LANG: 'lang',
} as const;

/**
 * Default values for frontmatter fields
 */
export const FRONTMATTER_DEFAULTS = {
  description: '',
  image: '',
  tags: [] as string[],
  draft: false,
  lang: '',
} as const;

/**
 * Operational tuning knobs
 */
export const LIMITS = {
  DEFAULT_PAGE_LIMIT: 20,

  MAX_PAGE_LIMIT: 100,

  /**
   * How long a built content index may be served before it is rebuilt.
   */
  INDEX_TTL_MS: readPositiveNumber(process.env.INDEX_TTL_MS, 30_000),

  /**
   * Bytes read from the head of a file when only the frontmatter is needed.
   */
  FRONTMATTER_HEAD_BYTES: 16 * 1024,

  /**
   * Concurrent file operations for bulk endpoints.
   */
  BULK_CONCURRENCY: readPositiveNumber(process.env.BULK_CONCURRENCY, 8),

  /**
   * Requests at or above this duration are logged as warnings.
   */
  SLOW_REQUEST_MS: readPositiveNumber(process.env.SLOW_REQUEST_MS, 500),

  /**
   * Backups older than this are pruned on startup and then on an interval.
   */
  BACKUP_RETENTION_DAYS: readPositiveNumber(process.env.BACKUP_RETENTION_DAYS, 30),

  BACKUP_PRUNE_INTERVAL_MS: readPositiveNumber(
    process.env.BACKUP_PRUNE_INTERVAL_MS,
    24 * 60 * 60 * 1000,
  ),
};
