# Blog Admin Backend

A NestJS-based admin panel for managing blog articles stored as markdown files. This backend provides a REST API and a web interface for creating, editing, and managing blog posts with category and tag support.

## Features

- **Article Management**: Create, read, update, delete articles with markdown content
- **Category Management**: Auto-discover categories from directory structure
- **Tag Management**: Auto-discover tags from frontmatter, bulk operations
- **Frontmatter Handling**: Parse and write YAML frontmatter for article metadata
- **Backups**: Every write and delete keeps the previous file, listable and restorable
- **Request Correlation**: One id per request, echoed in a header and stamped on every log line
- **Admin Panel**: Web UI for visual article management
- **File-based Storage**: No database required - uses markdown files directly

## Setup

### Prerequisites

- Node.js 18+ and pnpm
- Existing Astro blog with markdown articles in `src/content/posts/`

### Installation

1. Navigate to the backend directory:
```bash
cd backend
```

2. Install dependencies:
```bash
pnpm install
```

3. Start the development server:
```bash
pnpm run start:dev
```

The backend will start on `http://localhost:3009` (override with `PORT`).

### Access the Admin Panel

Open your browser and navigate to:
- **Admin Panel**: `http://localhost:3009/admin/`
- **API Base URL**: `http://localhost:3009/api/`

## Frontmatter Schema

Articles use the following YAML frontmatter format:

```yaml
---
title: Article Title
published: 2025-01-19T12:00:00
description: Article description
image: https://example.com/image.jpg
tags: [tag1, tag2, tag3]
category: Category/Subcategory
draft: false
lang: zh_CN
---
```

### Field Descriptions

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `title` | string | Yes | - | Article title |
| `published` | Date/string | Yes | Current time | Publication timestamp (ISO format) |
| `description` | string | No | `""` | Article description/summary |
| `image` | string | No | `""` | Cover image URL |
| `tags` | string[] | No | `[]` | Article tags |
| `category` | string | No | `""` | Category path (e.g., "Java/Spring") |
| `draft` | boolean | No | `false` | Draft status |
| `lang` | string | No | `""` | Language code (e.g., "zh_CN") |

## API Endpoints

### Articles

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/articles` | List all articles (pagination, filtering) |
| GET | `/api/articles/*path` | Get single article |
| POST | `/api/articles` | Create new article |
| PATCH | `/api/articles/*path` | Update article |
| DELETE | `/api/articles/*path` | Delete article (returns its `backupPath`) |
| PATCH | `/api/articles/*path/toggle-draft` | Toggle draft status |
| POST | `/api/articles/bulk` | Bulk operations |

`*path` is the article's path relative to `POSTS_DIR`, and may contain slashes
(`/api/articles/Java/Spring/Article.md`). Clients may also send it as one
`encodeURIComponent`-escaped segment (`/api/articles/Java%2FSpring%2FArticle.md`),
which is what the admin panel does.

Notes:
- `POST /api/articles` answers **409 Conflict** when the generated path already
  exists; send `overwrite: true` to replace it (the previous file is backed up first).
- In an update, `category` only rewrites frontmatter; **`newCategory` moves the file**,
  and `newTitle` renames it. Moving onto an existing article answers 409.

#### Query Parameters (GET /api/articles)

| Parameter | Type | Description |
|-----------|------|-------------|
| `page` | number | Page number (default: 1) |
| `limit` | number | Items per page (default: 20, max: 100) |
| `category` | string | Filter by category |
| `tag` | string | Filter by tag |
| `search` | string | Search in titles |
| `draft` | string | Filter by status ("true", "false", or "all") |

Unknown query parameters are rejected with 400.

### Backup, Health and Meta

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Liveness plus whether `POSTS_DIR` is readable (always unauthenticated) |
| GET | `/api/meta` | Version, category separators, backup retention |
| GET | `/` | Backend name/version/status |
| GET | `/api/backups` | List stored backups (`page`, `limit`) |
| POST | `/api/backups/restore` | Restore one backup by `backupPath` |
| POST | `/api/backups/prune` | Delete backups older than `retentionDays` (1-3650) |

Every write (create, update, move, delete) stores the previous file under
`BACKUPS_DIR/YYYYMMDD/<action>/`, and a retention sweep runs at startup and then
once a day.

### Response Envelopes

Paged reads:

```json
{ "data": [], "total": 138, "page": 1, "limit": 20, "totalPages": 7 }
```

Mutations - `POST /api/articles/bulk` reports `success`, while the tag and category
endpoints report `count`; in both cases `total === success|count + skipped + failed`
always holds:

```json
{ "total": 3, "success": 1, "skipped": 1, "failed": 1, "failures": [{ "path": "Missing.md", "reason": "File not found: Missing.md" }] }
```

Errors:

```json
{ "code": "NOT_FOUND", "message": "...", "details": {}, "requestId": "…", "timestamp": "…", "path": "…" }
```

Every response carries an `x-request-id` header (echoing a client-supplied one when
sanitary), and the same id appears in every log line produced while handling it.

### Categories

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/categories` | List all categories with article counts |
| GET | `/api/categories/tree` | Nested category tree |
| GET | `/api/categories/:name` | Get category details |
| GET | `/api/categories/:name/articles` | Paged articles in a category |
| PATCH | `/api/categories/rename` | Rename or move a category (`oldName`, `newName`) |
| DELETE | `/api/categories/:name` | Delete a category |

`:name` accepts a full path (`Java/Spring`, or `Java%2FSpring`) or just its last
segment; the latter must be unique, otherwise the request is rejected with a list of
the matching paths. Category matching is case-sensitive. An article counts towards
each of its ancestor directories.

`DELETE` refuses to silently drop articles: send `?deleteArticles=true` or
`?moveTo=<category>`, and nothing happens without one of the two (400).

### Tags

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/tags` | List all tags |
| GET | `/api/tags/popular` | Get popular tags (`limit`) |
| GET | `/api/tags/suggest` | Tag suggestions (`q`, `limit`) |
| GET | `/api/tags/:name` | Get tag details |
| GET | `/api/tags/:name/articles` | Paged articles by tag (`page`, `limit`) |
| GET | `/api/tags/:name/related` | Co-occurring tags (`limit`) |
| PATCH | `/api/tags/:name` | Rename tag (`newName`) |
| DELETE | `/api/tags/:name` | Remove the tag from every article |
| POST | `/api/tags/bulk/add` | Add a tag to `articlePaths` |
| POST | `/api/tags/bulk/remove` | Remove a tag from `articlePaths` |

Tag names are compared case-insensitively but stored with their original casing, so
`PATCH /api/tags/java` with `newName: "Java"` merges both spellings into one tag.

Both article-list endpoints return the same paged envelope as `GET /api/articles`.

## Example API Requests

All examples assume no `API_TOKEN` is set. When it is, add
`-H "Authorization: Bearer $API_TOKEN"` to every request except `/api/health`.

### Create an Article

```bash
curl -X POST http://localhost:3009/api/articles \
  -H "Content-Type: application/json" \
  -d '{
    "title": "My New Article",
    "content": "# Introduction\n\nThis is my article content.",
    "category": "Programming",
    "tags": ["JavaScript", "Node.js"],
    "description": "A tutorial on Node.js",
    "draft": false
  }'
```

The article is written to `Programming/My-New-Article.md`; if that path already exists
the call returns 409 unless the body also has `"overwrite": true`.

### List Articles

```bash
curl "http://localhost:3009/api/articles?page=1&limit=10&category=Java"
```

### Update an Article

```bash
# Moves the file to Linux/Docker-Guide.md and syncs its frontmatter
curl -X PATCH "http://localhost:3009/api/articles/Programming/My-New-Article.md" \
  -H "Content-Type: application/json" \
  -d '{
    "newTitle": "Docker Guide",
    "newCategory": "Linux/Docker",
    "tags": ["JavaScript", "Node.js", "Tutorial"]
  }'
```

### Get Categories

```bash
curl http://localhost:3009/api/categories/tree
```

### Rename a Tag

```bash
curl -X PATCH "http://localhost:3009/api/tags/oldName" \
  -H "Content-Type: application/json" \
  -d '{"newName": "newName"}'
```

### Restore a Deleted Article

```bash
curl "http://localhost:3009/api/backups?limit=5"
curl -X POST http://localhost:3009/api/backups/restore \
  -H "Content-Type: application/json" \
  -d '{"backupPath": "20260101/delete/My-New-Article.md.20260101T000000Z.bak"}'
```

## Development

### Available Scripts

| Command | Description |
|---------|-------------|
| `pnpm run start:dev` | Start development server with hot reload |
| `pnpm run build` | Build for production |
| `pnpm run start:prod` | Start production server |
| `pnpm run lint` | Run linter |
| `pnpm run format` | Format code with Prettier |
| `pnpm test` | Run the unit test suite |

### Project Structure

```
backend/
├── src/
│   ├── admin/              # Admin panel static assets
│   │   └── public/
│   ├── articles/           # Articles module
│   │   ├── dto/
│   │   ├── articles.controller.ts
│   │   ├── articles.service.ts
│   │   └── articles.module.ts
│   ├── categories/         # Categories module
│   ├── common/             # Shared, globally registered services and helpers
│   │   ├── app-logger.ts            # attaches the active requestId to every log line
│   │   ├── api-auth.middleware.ts   # optional bearer gate
│   │   ├── batch.util.ts            # concurrency-limited bulk execution
│   │   ├── constants.ts             # every environment variable lives here
│   │   ├── content-index.service.ts # mtime-keyed index of POSTS_DIR
│   │   ├── file.service.ts          # sole writer to POSTS_DIR, backups, locking
│   │   ├── frontmatter.service.ts
│   │   ├── pagination.util.ts
│   │   ├── path.util.ts             # category path helpers
│   │   └── request-context.ts       # AsyncLocalStorage request scope
│   ├── tags/               # Tags module
│   ├── app.module.ts       # Root module
│   └── main.ts             # Entry point
├── test/
│   └── jest.setup.js       # points the suites at temporary directories
├── package.json
└── tsconfig.json
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3009` | Server port |
| `POSTS_DIR` | `../src/content/posts` | Markdown content root; relative values resolve against the process cwd |
| `BACKUPS_DIR` | `./backups` | Where every write keeps a copy of the previous file |
| `API_TOKEN` | unset | When set, every `/api` route except `/api/health` requires `Authorization: Bearer <token>` |
| `MAX_BODY_SIZE` | `10485760` | Request body ceiling in bytes; larger payloads are rejected with 413 |
| `CORS_ORIGINS` | localhost dev origins | Comma-separated allow-list |
| `INDEX_TTL_MS` | `30000` | How long the built content index may be served before a rebuild |
| `BULK_CONCURRENCY` | `8` | Parallel file operations inside a bulk request |
| `SLOW_REQUEST_MS` | `500` | Requests at or above this duration are logged as warnings |
| `BACKUP_RETENTION_DAYS` | `30` | Age after which backups are pruned |
| `BACKUP_PRUNE_INTERVAL_MS` | `86400000` | Interval between retention sweeps (also runs at startup) |
| `BACKUP_PRUNE_ENABLED` | `true` | Set to `false` to disable the sweep entirely |

`API_TOKEN` protects the API, but the bundled admin panel has no way to send a bearer
token, so enabling it takes `/admin` out of action. Either leave it unset on a trusted
network or serve the panel behind a reverse proxy that authenticates.

## Compatibility

This backend is designed to work with:
- Astro 5.7+ static blog
- Markdown files with YAML frontmatter
- File-based content in `src/content/posts/`

**Note**: The backend does not modify your Astro blog's build process. Articles remain as markdown files and are read directly by Astro's content collections.

## Troubleshooting

### Port Already in Use

If port 3009 is already in use, either:
1. Stop the conflicting process, or
2. Set a different port: `PORT=3010 pnpm run start:dev`

### Articles Not Appearing

- Ensure markdown files are in `src/content/posts/` directory
- Check that files have valid YAML frontmatter
- Verify file permissions
- A wrong `POSTS_DIR` used to look exactly like an empty blog. It now logs
  `Posts directory is missing or unreadable: <path>` at startup - check for that line.
  `GET /api/health` reports the directories the running process is using.

### Empty Category or Tag Lists

Categories and tags are derived from the article index, which is rebuilt when a write
lands, when `POSTS_DIR` changes on disk, or after `INDEX_TTL_MS`. Articles at the root
of `POSTS_DIR` have no category and contribute to no category count.

### 401 on Every Request

`API_TOKEN` is set. Either unset it, send `Authorization: Bearer <token>`, or remember
that the bundled admin panel cannot send one.

### Build Errors

- Run `pnpm install` to ensure all dependencies are installed
- Check Node.js version: `node --version` (should be 18+)
- Clear cache: `rm -rf dist` and rebuild

## License

MIT
