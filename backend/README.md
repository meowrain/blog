# Blog Admin Backend

A NestJS-based admin panel for managing blog articles stored as markdown files. This backend provides a REST API and a web interface for creating, editing, and managing blog posts with category and tag support.

## Features

- **Article Management**: Create, read, update, delete articles with markdown content
- **Category Management**: Auto-discover categories from directory structure
- **Tag Management**: Auto-discover tags from frontmatter, bulk operations
- **Frontmatter Handling**: Parse and write YAML frontmatter for article metadata
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

The backend will start on `http://localhost:3001`

### Access the Admin Panel

Open your browser and navigate to:
- **Admin Panel**: `http://localhost:3001/admin/`
- **API Base URL**: `http://localhost:3001/api/`

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
| GET | `/api/articles/:path` | Get single article |
| POST | `/api/articles` | Create new article |
| PATCH | `/api/articles/:path` | Update article |
| DELETE | `/api/articles/:path` | Delete article |
| PATCH | `/api/articles/:path/toggle-draft` | Toggle draft status |
| POST | `/api/articles/bulk` | Bulk operations |

#### Query Parameters (GET /api/articles)

| Parameter | Type | Description |
|-----------|------|-------------|
| `page` | number | Page number (default: 1) |
| `limit` | number | Items per page (default: 20, max: 100) |
| `category` | string | Filter by category |
| `tag` | string | Filter by tag |
| `search` | string | Search in titles |
| `draft` | string | Filter by status ("true", "false", or "all") |

### Categories

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/categories` | List all categories |
| GET | `/api/categories/tree` | Get category tree |
| GET | `/api/categories/:name` | Get category details |
| GET | `/api/categories/:name/articles` | Get articles by category |
| PATCH | `/api/categories/rename` | Rename category |
| DELETE | `/api/categories/:name` | Delete category |

### Tags

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/tags` | List all tags |
| GET | `/api/tags/popular` | Get popular tags |
| GET | `/api/tags/suggest` | Tag suggestions |
| GET | `/api/tags/:name` | Get tag details |
| GET | `/api/tags/:name/articles` | Get articles by tag |
| GET | `/api/tags/:name/related` | Get related tags |
| PATCH | `/api/tags/:name` | Rename tag |
| DELETE | `/api/tags/:name` | Delete tag |
| POST | `/api/tags/bulk/add` | Bulk add tag |
| POST | `/api/tags/bulk/remove` | Bulk remove tag |

## Example API Requests

### Create an Article

```bash
curl -X POST http://localhost:3001/api/articles \
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

### List Articles

```bash
curl "http://localhost:3001/api/articles?page=1&limit=10&category=Java"
```

### Update an Article

```bash
curl -X PATCH "http://localhost:3001/api/articles/Programming/My-New-Article.md" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Updated Title",
    "tags": ["JavaScript", "Node.js", "Tutorial"]
  }'
```

### Get Categories

```bash
curl http://localhost:3001/api/categories/tree
```

### Rename a Tag

```bash
curl -X PATCH "http://localhost:3001/api/tags/oldName" \
  -H "Content-Type: application/json" \
  -d '{"newName": "newName"}'
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
│   ├── common/             # Shared services
│   │   ├── constants.ts
│   │   ├── file.service.ts
│   │   └── frontmatter.service.ts
│   ├── tags/               # Tags module
│   ├── app.module.ts       # Root module
│   └── main.ts             # Entry point
├── package.json
└── tsconfig.json
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3001 | Server port |

### CORS Configuration

By default, the backend accepts requests from:
- `http://localhost:4321` (Astro dev server)
- `http://127.0.0.1:4321`
- `http://localhost:3000`
- `http://127.0.0.1:3000`

To modify CORS settings, edit `src/common/constants.ts`.

## Compatibility

This backend is designed to work with:
- Astro 5.7+ static blog
- Markdown files with YAML frontmatter
- File-based content in `src/content/posts/`

**Note**: The backend does not modify your Astro blog's build process. Articles remain as markdown files and are read directly by Astro's content collections.

## Troubleshooting

### Port Already in Use

If port 3001 is already in use, either:
1. Stop the conflicting process, or
2. Set a different port: `PORT=3002 pnpm run start:dev`

### Articles Not Appearing

- Ensure markdown files are in `src/content/posts/` directory
- Check that files have valid YAML frontmatter
- Verify file permissions

### Build Errors

- Run `pnpm install` to ensure all dependencies are installed
- Check Node.js version: `node --version` (should be 18+)
- Clear cache: `rm -rf dist` and rebuild

## License

MIT
