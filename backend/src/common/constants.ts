import path from 'path';

/**
 * Path constants for the blog backend
 */
export const PATHS = {
  /**
   * Root directory of the project
   */
  ROOT: path.resolve(process.cwd(), '..'),

  /**
   * Directory containing blog posts (markdown files)
   */
  POSTS_DIR: path.resolve(process.cwd(), '..', 'src', 'content', 'posts'),

  /**
   * Allowed file extensions for markdown files
   */
  MARKDOWN_EXTENSIONS: ['.md', '.mdx'],

  /**
   * Maximum file size for article uploads (10MB)
   */
  MAX_FILE_SIZE: 10 * 1024 * 1024,

  /**
   * Default pagination limit
   */
  DEFAULT_PAGE_LIMIT: 20,

  /**
   * Maximum pagination limit
   */
  MAX_PAGE_LIMIT: 100,
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
 * Invalid characters for file/directory names
 */
export const INVALID_PATH_CHARS = /[<>:"|?*]/;

/**
 * CORS configuration
 */
export const CORS_CONFIG = {
  origin: ['http://localhost:4321', 'http://127.0.0.1:4321', 'http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true,
};
