## Context

The current Astro blog uses markdown files with YAML frontmatter for article storage. Articles are organized in `src/content/posts/` with category-based subdirectories (e.g., `Java/JVM/`, `Golang/`, `中间件/MySQL/`). The existing `pnpm new-post` script creates basic markdown files but requires manual work to complete metadata (tags, category, image) and move files to the correct directory.

**Constraints:**
- Must not break existing Astro build process
- Must work with existing markdown/frontmatter format
- No authentication required (local development only)
- No database - file-based storage
- User prefers NestJS framework

## Goals / Non-Goals

**Goals:**
- Provide web-based UI for creating, editing, and deleting articles
- Eliminate manual frontmatter editing and file management
- Auto-discover categories and tags from existing articles
- Enable bulk operations on tags (rename, delete)
- Maintain compatibility with existing Astro content collection

**Non-Goals:**
- Database migration (staying file-based)
- User authentication (local only)
- Multi-user collaboration features
- Deployment to production (local development tool)
- Real-time preview (Astro dev server handles this)

## Decisions

### Framework: NestJS

**Rationale:**
- TypeScript-first with strong typing
- Built-in dependency injection and modular architecture
- Clear separation of controllers, services, and DTOs
- Excellent for CRUD applications
- Large ecosystem and community support

**Alternatives considered:**
- Express: Simpler but requires more manual structure
- Fastify: Faster but less opinionated
- Koa: More modern but smaller ecosystem

### Data Storage: File-based (Markdown + YAML)

**Rationale:**
- Markdown files are already the source of truth
- Git-friendly version control
- No additional infrastructure needed
- Astro reads these files directly - no sync required

**File structure:**
```
src/content/posts/
├── Java/
│   └── Spring/
│       └── SpringBean生命周期.md
├── Golang/
│   └── Gin框架快速入门.md
└── 中间件/
    └── MySQL/
        └── MVCC.md
```

### Frontmatter Parsing: gray-matter

**Rationale:**
- Battle-tested library for YAML frontmatter
- Preserves formatting and comments
- Handles edge cases (empty values, special characters)

**Frontmatter schema:**
```yaml
---
title: string
published: Date | string
description: string
image: string (URL)
tags: string[]
category: string
draft: boolean
lang: string
---
```

### Admin UI: Server-rendered with HTMX

**Rationale:**
- No separate build step required
- Lightweight and fast
- Progressive enhancement
- Easy to integrate with NestJS templates

**Alternatives considered:**
- React/Vue SPA: Better UX but requires build tooling
- Pure vanilla JS: Simpler but more manual DOM manipulation

### Directory Structure

```
backend/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── articles/
│   │   ├── articles.controller.ts
│   │   ├── articles.service.ts
│   │   ├── dto/
│   │   │   ├── create-article.dto.ts
│   │   │   ├── update-article.dto.ts
│   │   │   └── article.dto.ts
│   │   └── articles.module.ts
│   ├── categories/
│   │   ├── categories.controller.ts
│   │   ├── categories.service.ts
│   │   └── categories.module.ts
│   ├── tags/
│   │   ├── tags.controller.ts
│   │   ├── tags.service.ts
│   │   └── tags.module.ts
│   ├── common/
│   │   ├── file.service.ts
│   │   ├── frontmatter.service.ts
│   │   └── constants.ts
│   └── admin/
│       └── public/
│           ├── index.html
│           ├── styles.css
│           └── app.js
├── package.json
└── tsconfig.json
```

## Risks / Trade-offs

### Risk: File corruption during concurrent writes

**Mitigation:** Use file locking (proper file locking libraries) and write to temporary files before atomic rename.

### Risk: Path traversal attacks

**Mitigation:** Validate all file paths, restrict operations to `src/content/posts/` directory, use path normalization.

### Trade-off: No database means slower queries

**Acceptable:** For a personal blog with hundreds of articles, file system operations are fast enough. Pagination will be implemented for large article lists.

### Trade-off: No authentication means anyone with access can modify

**Acceptable:** This is a local development tool. User can bind to localhost only and use firewall for additional protection.

## Open Questions

None - all key decisions have been made.
