# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Fuwari** is a personal blog theme built with Astro 5.7, customized for AcoFork. It's a static site generator focused on technical blogging with Chinese language support.

## Common Commands

```bash
# Install dependencies (uses pnpm)
pnpm install

# Development server
pnpm dev        # or pnpm start

# Build for production
pnpm build

# Preview production build
pnpm preview

# Type checking
pnpm type-check

# Create new blog post (creates file in src/content/posts/)
pnpm new-post <title>

# Clean unused images from src/content/assets/
pnpm clean

# Format code (uses Biome)
pnpm format

# Lint and fix code (uses Biome)
pnpm lint
```

## Architecture

### Framework & Build System
- **Astro 5.7** - Static site generator with component islands architecture
- **Vite** - Build tool (configured via astro.config.mjs)
- **Output**: Static HTML/CSS/JS to `dist/` directory

### Styling Architecture
- **Tailwind CSS** - Utility-first CSS with Nesting plugin
- **Stylus** - Preprocessor for global styles and CSS variables
- **Theme System**: HSL-based color system with configurable hue in `src/config.ts`
  - Uses CSS custom properties defined in `src/styles/variables.styl`
  - Dark/light mode toggle via `data-theme` attribute

### Component Architecture
- **Svelte 5** - Interactive components (`.svelte` files in `src/components/`)
- **Astro components** - Static components (`.astro` files)
- **Layout hierarchy**: `Layout.astro` (root) → page-specific layouts

### Content System
- **Blog posts**: `src/content/posts/*.md` with frontmatter schema validation
- **Assets**: `src/content/assets/` for images/media
- **Content collections**: Defined in Astro config with TypeScript schemas

### Plugin System (src/plugins/)
Custom remark/rehype plugins for Markdown processing:
- `remark-reading-time.mjs` - Calculates reading time
- `remark-excerpt.js` - Generates post excerpts
- `remark-directive-rehype.js` - Parses custom directives
- `rehype-component-admonition.mjs` - GitHub-style callouts (note, tip, warning, etc.)
- `rehype-component-github-card.mjs` - GitHub repo embedding
- `rehype-image-fallback.mjs` - Image fallback on failure
- `expressive-code/custom-copy-button.ts` - Custom code block copy button

## Configuration Files

- **`src/config.ts`** - Main site configuration
  - Site metadata (title, description, lang)
  - Theme colors (hue, dark mode)
  - Navigation links
  - Profile info
  - Banner/background settings
  - License, analytics, edit links

- **`astro.config.mjs`** - Build configuration
  - Integrations (Tailwind, Svelte, Swup, Sitemap, Icon)
  - Markdown remark/rehype plugins pipeline
  - Expressive Code settings
  - Redirects
  - Image service (passthrough mode)

- **`tailwind.config.cjs`** - Tailwind configuration
  - Dark mode (`class` strategy)
  - Typography plugin
  - Font family extensions

## Key Integrations

- **Swup** - Page transitions with SPA-like navigation (configured containers: `main`, `#toc`)
- **astro-icon** - Icon system with multiple icon sets (FontAwesome, Simple Icons, Material Symbols)
- **@astrojs/sitemap** - Automatic sitemap generation
- **Expressive Code** - Code highlighting with GitHub dark theme, collapsible sections, line numbers

## Code Quality

- **Biome** - Primary linter and formatter (replaces ESLint/Prettier)
- **TypeScript** - Strict mode enabled, path aliases configured
- **Type checking**: `pnpm type-check` uses `tsc --noEmit --isolatedDeclarations`

## Content Frontmatter Schema

Posts use this frontmatter format:
```yaml
---
title: Post Title
published: 2024-01-01T12:00:00
description: Post description
image: ./cover.jpg  # Relative to post
tags: [tag1, tag2]
category: Category
draft: false
lang: zh_CN  # Optional, overrides site default
---
```

## Custom Markdown Features

- **GitHub Admonitions**: `> [!NOTE]`, `> [!WARNING]`, etc.
- **Math**: KaTeX support via `$...$` (inline) and `$$...$$` (block)
- **Custom directives**: `:::github[repo](url)` for repo cards
- **Auto TOC**: Generated from headings (configurable depth in `siteConfig.toc.depth`)

## Deployment

- **Static site**: Builds to `dist/` directory
- **CI/CD**: GitHub Actions for Alibaba Cloud ESA deployment
- **Redirects**: Configured in `astro.config.mjs` redirects section
