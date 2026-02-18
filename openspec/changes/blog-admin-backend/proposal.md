## Why

Creating new blog articles is tedious and error-prone. The current workflow requires running `pnpm new-post`, manually moving files to category directories, and hand-typing tags, categories, and image URLs in frontmatter. This repetitive work slows down content creation and introduces inconsistencies.

## What Changes

- Add NestJS backend in `backend/` directory for article management
- Create REST API for article CRUD operations (create, read, update, delete)
- Build admin panel for visual article and content management
- Implement file-based storage using existing `src/content/posts/**/*.md` structure
- Add category management with auto-discovery from existing articles
- Add tag management with auto-discovery and bulk operations
- Implement frontmatter parsing/writing for article metadata

## Capabilities

### New Capabilities

- `article-management`: Complete CRUD operations for blog articles including create, list, update, delete, draft toggling, and category movement
- `category-management`: Category listing, auto-discovery from articles, and article filtering by category
- `tag-management`: Tag listing, auto-discovery from articles, rename operations across all articles, and delete operations
- `frontmatter-parsing`: Parse and write YAML frontmatter in markdown files (title, published, description, image, tags, category, draft, lang)

### Modified Capabilities

None - this is a new backend system with no changes to existing Astro blog behavior.

## Impact

- New `backend/` directory with NestJS application
- No changes to Astro blog build process - markdown files remain source of truth
- New admin panel served from backend (no authentication, local only)
- File I/O operations on `src/content/posts/**/*.md`
- No database required - file-based storage
- No authentication - localhost development only
