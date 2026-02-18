## 1. Setup and Configuration

- [x] 1.1 Initialize NestJS project in `backend/` directory with CLI
- [x] 1.2 Install dependencies: `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `gray-matter`, `reflect-metadata`, `rxjs`
- [x] 1.3 Configure TypeScript (`tsconfig.json`) for NestJS
- [x] 1.4 Create `backend/src/common/constants.ts` with path constants (`POSTS_DIR`, etc.)
- [x] 1.5 Configure CORS to allow requests from Astro dev server
- [x] 1.6 Set up development scripts in `package.json` (dev, build, start)

## 2. Common Services

- [x] 2.1 Create `FileService` in `common/file.service.ts` with methods: `readFile`, `writeFile`, `deleteFile`, `moveFile`, `listFiles`, `ensureDir`
- [x] 2.2 Add path validation and sanitization to `FileService` (prevent path traversal)
- [x] 2.3 Create `FrontmatterService` in `common/frontmatter.service.ts` using `gray-matter`
- [x] 2.4 Implement `parseFrontmatter` method to extract metadata from markdown
- [x] 2.5 Implement `writeFrontmatter` method to serialize metadata to YAML
- [x] 2.6 Add frontmatter validation schema (required fields, types)

## 3. Article Module

- [x] 3.1 Create `articles.module.ts` with imports of `CommonModule`
- [x] 3.2 Create DTOs: `CreateArticleDto`, `UpdateArticleDto`, `ArticleDto`, `ListArticlesDto`
- [x] 3.3 Create `ArticlesService` with CRUD methods: `create`, `findAll`, `findOne`, `update`, `delete`, `toggleDraft`
- [x] 3.4 Implement article discovery logic (scan `src/content/posts/` recursively)
- [x] 3.5 Implement article creation with slug generation and category directory handling
- [x] 3.6 Implement article update with category move support
- [x] 3.7 Implement article deletion with file cleanup
- [x] 3.8 Create `ArticlesController` with REST endpoints: GET /articles, GET /articles/:path, POST /articles, PATCH /articles/:path, DELETE /articles/:path
- [x] 3.9 Add pagination, filtering by category/tag, search by title
- [x] 3.10 Add bulk operations endpoint (POST /articles/bulk)

## 4. Category Module

- [x] 4.1 Create `categories.module.ts` with imports of `CommonModule`
- [x] 4.2 Create `CategoriesService` with methods: `findAll`, `findOne`, `getArticles`, `rename`, `delete`
- [x] 4.3 Implement category auto-discovery from directory structure
- [x] 4.4 Implement category tree building (parent-child relationships)
- [x] 4.5 Implement article count aggregation per category
- [x] 4.6 Implement category rename (directory move + frontmatter update)
- [x] 4.7 Implement category delete with move/delete options for contained articles
- [x] 4.8 Create `CategoriesController` with REST endpoints: GET /categories, GET /categories/tree, GET /categories/:name/articles, PATCH /categories/:name, DELETE /categories/:name
- [x] 4.9 Add category validation (prevent invalid characters in paths)

## 5. Tag Module

- [x] 5.1 Create `tags.module.ts` with imports of `CommonModule`
- [x] 5.2 Create `TagsService` with methods: `findAll`, `findOne`, `getArticles`, `rename`, `delete`, `suggest`
- [x] 5.3 Implement tag auto-discovery from article frontmatter
- [x] 5.4 Implement tag count tracking and updates on article CRUD
- [x] 5.5 Implement tag rename (update all affected articles)
- [x] 5.6 Implement tag delete (remove from all affected articles)
- [x] 5.7 Implement tag search/suggestions (partial match, case-insensitive)
- [x] 5.8 Implement related tags discovery (frequently co-occurring)
- [x] 5.9 Create `TagsController` with REST endpoints: GET /tags, GET /tags/popular, GET /tags/:name/articles, PATCH /tags/:name, DELETE /tags/:name, GET /tags/suggest
- [x] 5.10 Add bulk tag operations endpoint (POST /tags/bulk)

## 6. Admin Panel

- [x] 6.1 Create `backend/src/admin/public/` directory for static assets
- [x] 6.2 Create admin panel HTML (`index.html`) with responsive layout
- [x] 6.3 Implement article list view with pagination and filters
- [x] 6.4 Implement article editor with markdown input and frontmatter form
- [x] 6.5 Add category/tag autocomplete in article editor
- [x] 6.6 Implement category management view
- [x] 6.7 Implement tag management view with bulk operations
- [x] 6.8 Add CSS styling (`styles.css`) for modern, clean UI
- [x] 6.9 Create client-side JavaScript (`app.js`) for API interactions
- [x] 6.10 Integrate markdown editor library (CodeMirror or EasyMDE)
- [x] 6.11 Add live preview for markdown content
- [x] 6.12 Configure NestJS to serve static files from admin/public

## 7. App Module Integration

- [x] 7.1 Create `app.module.ts` importing ArticlesModule, CategoriesModule, TagsModule
- [x] 7.2 Configure global prefix for API routes (e.g., `/api`)
- [x] 7.3 Enable validation pipe with class-validator
- [x] 7.4 Create `main.ts` with NestFactory bootstrap
- [x] 7.5 Configure port (default 3001 or from environment variable)

## 8. Testing and Validation

- [x] 8.1 Test article CRUD operations via REST API
- [x] 8.2 Test category discovery and management
- [x] 8.3 Test tag discovery and management
- [x] 8.4 Test frontmatter parsing and writing (include edge cases)
- [x] 8.5 Test file path validation and sanitization
- [x] 8.6 Test admin panel UI functionality
- [x] 8.7 Verify compatibility with existing Astro blog (no build breakage)
- [x] 8.8 Test with existing markdown files (Chinese characters, special paths)

## 9. Documentation

- [x] 9.1 Create `backend/README.md` with setup instructions
- [x] 9.2 Document API endpoints (methods, paths, request/response formats)
- [x] 9.3 Document frontmatter schema and field defaults
- [x] 9.4 Add example API requests (curl or Postman)
- [x] 9.5 Document admin panel usage
