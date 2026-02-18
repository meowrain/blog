import { Injectable, BadRequestException } from '@nestjs/common';
import matter from 'gray-matter';
import {
  FRONTMATTER_FIELDS,
  FRONTMATTER_DEFAULTS,
} from './constants';

export interface ArticleFrontmatter {
  title: string;
  published: Date | string;
  description: string;
  image: string;
  tags: string[];
  category: string;
  draft: boolean;
  lang: string;
}

export interface ParsedArticle {
  frontmatter: ArticleFrontmatter;
  content: string;
}

@Injectable()
export class FrontmatterService {
  /**
   * Parse frontmatter from markdown content
   */
  parseFrontmatter(markdown: string): ParsedArticle {
    try {
      const { data, content } = matter(markdown);

      return {
        frontmatter: this.normalizeFrontmatter(data),
        content,
      };
    } catch (error) {
      throw new BadRequestException(`Failed to parse frontmatter: ${error.message}`);
    }
  }

  /**
   * Write frontmatter and content to markdown format
   */
  writeFrontmatter(parsedArticle: ParsedArticle): string {
    const { frontmatter, content } = parsedArticle;

    // Validate frontmatter before writing
    this.validateFrontmatter(frontmatter);

    // Convert Date objects to ISO strings for YAML
    const serializedData = this.serializeFrontmatter(frontmatter);

    // Use gray-matter to combine frontmatter and content
    const matterFile = matter.stringify(content, serializedData);
    return matterFile;
  }

  /**
   * Validate frontmatter fields
   */
  validateFrontmatter(frontmatter: Partial<ArticleFrontmatter>): void {
    if (!frontmatter.title || frontmatter.title.trim().length === 0) {
      throw new BadRequestException('Title is required');
    }

    // Validate tags is an array
    if (frontmatter.tags && !Array.isArray(frontmatter.tags)) {
      throw new BadRequestException('Tags must be an array');
    }

    // Validate draft is boolean
    if (frontmatter.draft !== undefined && typeof frontmatter.draft !== 'boolean') {
      throw new BadRequestException('Draft must be a boolean');
    }

    // Validate published date
    if (frontmatter.published) {
      const date = new Date(frontmatter.published);
      if (isNaN(date.getTime())) {
        throw new BadRequestException('Invalid published date');
      }
    }
  }

  /**
   * Get default frontmatter values
   */
  getDefaults(): ArticleFrontmatter {
    return {
      title: '',
      published: new Date().toISOString(),
      description: FRONTMATTER_DEFAULTS.description,
      image: FRONTMATTER_DEFAULTS.image,
      tags: [...FRONTMATTER_DEFAULTS.tags],
      category: '',
      draft: FRONTMATTER_DEFAULTS.draft,
      lang: FRONTMATTER_DEFAULTS.lang,
    };
  }

  /**
   * Normalize frontmatter data from parsed YAML
   */
  private normalizeFrontmatter(data: any): ArticleFrontmatter {
    return {
      title: data[FRONTMATTER_FIELDS.TITLE] || '',
      published: data[FRONTMATTER_FIELDS.PUBLISHED] || new Date().toISOString(),
      description: data[FRONTMATTER_FIELDS.DESCRIPTION] || FRONTMATTER_DEFAULTS.description,
      image: data[FRONTMATTER_FIELDS.IMAGE] || FRONTMATTER_DEFAULTS.image,
      tags: this.normalizeTags(data[FRONTMATTER_FIELDS.TAGS]),
      category: data[FRONTMATTER_FIELDS.CATEGORY] || '',
      draft: data[FRONTMATTER_FIELDS.DRAFT] ?? FRONTMATTER_DEFAULTS.draft,
      lang: data[FRONTMATTER_FIELDS.LANG] || FRONTMATTER_DEFAULTS.lang,
    };
  }

  /**
   * Normalize tags to always be an array
   */
  private normalizeTags(tags: any): string[] {
    if (!tags) {
      return [];
    }

    if (Array.isArray(tags)) {
      return tags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0);
    }

    if (typeof tags === 'string') {
      // Handle comma-separated string format
      return tags.split(',').map(t => t.trim()).filter(t => t.length > 0);
    }

    return [];
  }

  /**
   * Serialize frontmatter for YAML output
   */
  private serializeFrontmatter(frontmatter: ArticleFrontmatter): any {
    return {
      [FRONTMATTER_FIELDS.TITLE]: frontmatter.title,
      [FRONTMATTER_FIELDS.PUBLISHED]: this.serializeDate(frontmatter.published),
      [FRONTMATTER_FIELDS.DESCRIPTION]: frontmatter.description,
      [FRONTMATTER_FIELDS.IMAGE]: frontmatter.image,
      [FRONTMATTER_FIELDS.TAGS]: frontmatter.tags,
      [FRONTMATTER_FIELDS.CATEGORY]: frontmatter.category,
      [FRONTMATTER_FIELDS.DRAFT]: frontmatter.draft,
      [FRONTMATTER_FIELDS.LANG]: frontmatter.lang,
    };
  }

  /**
   * Serialize date to ISO string
   */
  private serializeDate(date: Date | string): string {
    if (typeof date === 'string') {
      return date;
    }
    return date.toISOString();
  }

  /**
   * Merge frontmatter updates (partial update)
   */
  mergeFrontmatter(
    existing: ArticleFrontmatter,
    updates: Partial<ArticleFrontmatter>,
  ): ArticleFrontmatter {
    return {
      title: updates.title ?? existing.title,
      published: updates.published ?? existing.published,
      description: updates.description ?? existing.description,
      image: updates.image ?? existing.image,
      tags: updates.tags ?? existing.tags,
      category: updates.category ?? existing.category,
      draft: updates.draft ?? existing.draft,
      lang: updates.lang ?? existing.lang,
    };
  }

  /**
   * Generate slug from title
   */
  generateSlug(title: string): string {
    // Preserve Chinese characters and other unicode
    return title.trim();
  }

  /**
   * Sanitize tag values
   */
  sanitizeTag(tag: string): string {
    return tag.trim();
  }

  /**
   * Sanitize all tags
   */
  sanitizeTags(tags: string[]): string[] {
    return tags
      .map(t => this.sanitizeTag(t))
      .filter(t => t.length > 0);
  }
}
