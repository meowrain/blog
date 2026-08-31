import { Injectable, BadRequestException } from '@nestjs/common';
import matter from 'gray-matter';
import { FRONTMATTER_FIELDS, FRONTMATTER_DEFAULTS } from './constants';

const FRONTMATTER_DELIMITER = '---';

/** Built via fromCharCode: a literal U+FEFF in source is invisible and gets eaten by BOM-stripping tooling. */
const BOM = String.fromCharCode(0xfeff);

/** Characters that cannot appear in a file name: path separators plus the Windows-illegal set. */
const SLUG_ILLEGAL_CHARS = /[<>:"|?*\\/]+/g;

/** Control and format characters (zero-width, bidi marks, ...) carry no meaning in a slug. */
const SLUG_INVISIBLE_CHARS = /[\p{Cc}\p{Cf}]/gu;

const SLUG_MAX_LENGTH = 100;
const SLUG_FALLBACK = 'untitled';

export interface ArticleFrontmatter {
  title: string;
  /** Always an ISO-8601 string; YAML date scalars are normalized on parse. */
  published: string;
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
   * Parse only the frontmatter block of a markdown document.
   *
   * The body is located but never copied or handed to the YAML parser, which
   * makes this considerably cheaper than `parseFrontmatter` when only the
   * metadata matters (article lists, tag/category checks).
   */
  parseFrontmatterOnly(markdown: string): ArticleFrontmatter {
    const block = this.extractFrontmatterBlock(markdown);
    if (block === null) {
      // No (or unterminated) frontmatter block: fall back to the defaults.
      return this.normalizeFrontmatter({});
    }

    try {
      const { data } = matter(block);
      return this.normalizeFrontmatter(data);
    } catch (error) {
      throw new BadRequestException(`Failed to parse frontmatter: ${error.message}`);
    }
  }

  /**
   * True when the document opens a frontmatter block.
   *
   * `extractFrontmatterBlock` returns null both for "no frontmatter" and for a
   * block that is not closed inside a partial read; callers that work on a head
   * slice need this to tell the two apart.
   */
  startsFrontmatter(markdown: string): boolean {
    const start = markdown.startsWith(BOM) ? 1 : 0;
    return markdown.startsWith(FRONTMATTER_DELIMITER, start);
  }

  /**
   * Return the leading `--- ... ---` block, or null when the document has none.
   * Callers use this to tell "no frontmatter" apart from "empty frontmatter".
   */
  extractFrontmatterBlock(markdown: string): string | null {
    const start = markdown.startsWith(BOM) ? 1 : 0;
    if (!this.startsFrontmatter(markdown)) {
      return null;
    }

    const openingLineEnd = markdown.indexOf('\n', start + FRONTMATTER_DELIMITER.length);
    if (openingLineEnd === -1) {
      return null;
    }

    const closingStart = this.findClosingDelimiter(markdown, openingLineEnd + 1);
    if (closingStart === -1) {
      return null;
    }

    return markdown.slice(start, closingStart + FRONTMATTER_DELIMITER.length);
  }

  /**
   * Write frontmatter and content to markdown format
   */
  writeFrontmatter(parsedArticle: ParsedArticle): string {
    const { frontmatter, content } = parsedArticle;

    // Validate frontmatter before writing
    this.validateFrontmatter(frontmatter);

    // Use gray-matter to combine frontmatter and content
    return matter.stringify(content, this.serializeFrontmatter(frontmatter));
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
    if (frontmatter.published && isNaN(new Date(frontmatter.published).getTime())) {
      throw new BadRequestException('Invalid published date');
    }
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
    const slug = title
      // Fold compatibility variants first so full-width punctuation normalizes
      // to its ASCII form and gets stripped below.
      .normalize('NFKC')
      .replace(SLUG_ILLEGAL_CHARS, ' ')
      .replace(SLUG_INVISIBLE_CHARS, ' ')
      .replace(/\s+/g, '-')
      .replace(/-{2,}/g, '-')
      // Windows rejects names ending with a dot or a space
      .replace(/^[-.]+|[-.\s]+$/g, '');

    if (slug.length === 0) {
      return SLUG_FALLBACK;
    }

    // Truncate on code points so surrogate pairs are never split in half
    const codePoints = Array.from(slug);
    if (codePoints.length <= SLUG_MAX_LENGTH) {
      return slug;
    }

    return codePoints.slice(0, SLUG_MAX_LENGTH).join('').replace(/[-.\s]+$/, '') || SLUG_FALLBACK;
  }

  /**
   * Normalize frontmatter data from parsed YAML
   */
  private normalizeFrontmatter(data: any): ArticleFrontmatter {
    return {
      title: data[FRONTMATTER_FIELDS.TITLE] || '',
      published: this.normalizePublished(data[FRONTMATTER_FIELDS.PUBLISHED]),
      description: data[FRONTMATTER_FIELDS.DESCRIPTION] || FRONTMATTER_DEFAULTS.description,
      image: data[FRONTMATTER_FIELDS.IMAGE] || FRONTMATTER_DEFAULTS.image,
      tags: this.normalizeTags(data[FRONTMATTER_FIELDS.TAGS]),
      category: data[FRONTMATTER_FIELDS.CATEGORY] || '',
      draft: data[FRONTMATTER_FIELDS.DRAFT] ?? FRONTMATTER_DEFAULTS.draft,
      lang: data[FRONTMATTER_FIELDS.LANG] || FRONTMATTER_DEFAULTS.lang,
    };
  }

  /**
   * Collapse every way a date can arrive from YAML into a single ISO string.
   *
   * Unquoted YAML scalars such as `published: 2024-05-01` are parsed into Date
   * objects, so this is the only place the type union has to be handled.
   */
  private normalizePublished(value: unknown): string {
    if (value instanceof Date) {
      return isNaN(value.getTime()) ? new Date().toISOString() : value.toISOString();
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }

    return new Date().toISOString();
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
      return tags.split(',').map((t) => t.trim()).filter((t) => t.length > 0);
    }

    return [];
  }

  /**
   * Serialize frontmatter for YAML output
   */
  private serializeFrontmatter(frontmatter: ArticleFrontmatter): Record<string, unknown> {
    return {
      [FRONTMATTER_FIELDS.TITLE]: frontmatter.title,
      [FRONTMATTER_FIELDS.PUBLISHED]: frontmatter.published,
      [FRONTMATTER_FIELDS.DESCRIPTION]: frontmatter.description,
      [FRONTMATTER_FIELDS.IMAGE]: frontmatter.image,
      [FRONTMATTER_FIELDS.TAGS]: frontmatter.tags,
      [FRONTMATTER_FIELDS.CATEGORY]: frontmatter.category,
      [FRONTMATTER_FIELDS.DRAFT]: frontmatter.draft,
      [FRONTMATTER_FIELDS.LANG]: frontmatter.lang,
    };
  }

  /**
   * Find the offset of the line that closes the frontmatter block, or -1
   */
  private findClosingDelimiter(markdown: string, from: number): number {
    let lineStart = from;

    while (lineStart < markdown.length) {
      const lineEnd = markdown.indexOf('\n', lineStart);

      // Only slice when the line can actually be the closing delimiter
      if (markdown.startsWith(FRONTMATTER_DELIMITER, lineStart)) {
        const line =
          lineEnd === -1 ? markdown.slice(lineStart) : markdown.slice(lineStart, lineEnd);
        if (line.trimEnd() === FRONTMATTER_DELIMITER) {
          return lineStart;
        }
      }

      if (lineEnd === -1) {
        return -1;
      }
      lineStart = lineEnd + 1;
    }

    return -1;
  }
}
