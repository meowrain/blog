import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { FileService } from '../common/file.service';
import { FrontmatterService } from '../common/frontmatter.service';
import { ContentIndexService, IndexedArticle } from '../common/content-index.service';
import { LIMITS } from '../common/constants';
import { BatchOutcome, MutationResultDto, runBatch } from '../common/batch.util';
import {
  clampLimit,
  paginate,
  PagedResult,
  resolvePage,
  sortByPublishedDesc,
} from '../common/pagination.util';
import { PageQueryDto } from '../common/page-query.dto';
import { toPosix } from '../common/path.util';
import { ArticleListItemDto, toArticleListItem } from '../articles/dto/article.dto';
import { TagDto } from './dto/tag.dto';

/** Tags are compared case-insensitively but stored with their original casing. */
function isSameTag(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function replaceTag(tags: string[], from: string, to: string): string[] {
  let replaced = false;
  const next: string[] = [];

  for (const tag of tags) {
    if (!replaced && isSameTag(tag, from)) {
      replaced = true;
      if (!next.some((existing) => isSameTag(existing, to))) {
        next.push(to);
      }
      continue;
    }
    if (!next.some((existing) => isSameTag(existing, tag))) {
      next.push(tag);
    }
  }

  return next;
}

function removeTag(tags: string[], name: string): string[] {
  return tags.filter((tag) => !isSameTag(tag, name));
}

function addTag(tags: string[], name: string): string[] {
  return tags.some((tag) => isSameTag(tag, name)) ? tags : [...tags, name];
}

/** Exact, order-sensitive equality: a rename or reorder is still a real change. */
function sameTags(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((tag, index) => tag === b[index]);
}

/**
 * Tags come from article frontmatter, so the article set is the tag set.
 *
 * Counts and matching articles are read from ContentIndexService instead of a
 * private cache that stayed warm for the life of the process, and mutations
 * only touch the articles the index already says carry the tag rather than
 * re-reading every document in POSTS_DIR.
 */
@Injectable()
export class TagsService {
  private readonly logger = new Logger(TagsService.name);

  constructor(
    private readonly fileService: FileService,
    private readonly frontmatterService: FrontmatterService,
    private readonly contentIndexService: ContentIndexService,
  ) {}

  /**
   * Get all tags
   */
  async findAll(sortBy = 'name'): Promise<TagDto[]> {
    const { tags } = await this.contentIndexService.aggregate();
    return this.toDtos(tags, sortBy === 'count' ? 'count' : 'name');
  }

  /**
   * Get popular tags
   */
  async findPopular(limit?: number | string): Promise<TagDto[]> {
    const { tags } = await this.contentIndexService.aggregate();
    return this.toDtos(tags, 'count').slice(0, this.resolveLimit(limit, 20));
  }

  /**
   * Get one tag, matched case-insensitively.
   */
  async findOne(name: string): Promise<TagDto> {
    const target = name.trim();
    if (!target) {
      throw new NotFoundException(`Tag not found: ${name}`);
    }

    const { tags } = await this.contentIndexService.aggregate();
    for (const [tagName, count] of tags) {
      if (isSameTag(tagName, target)) {
        return { name: tagName, count };
      }
    }

    throw new NotFoundException(`Tag not found: ${name}`);
  }

  /**
   * Get articles by tag, newest first, with the metadata callers need to render
   * a row (bare paths forced a follow-up request per article).
   */
  async getArticles(
    tagName: string,
    query: PageQueryDto = {},
  ): Promise<PagedResult<ArticleListItemDto>> {
    const items = await this.matching(tagName);
    const { page, limit } = resolvePage(query);
    return paginate(sortByPublishedDesc(items).map(toArticleListItem), page, limit);
  }

  /**
   * Rename a tag: rewrite the frontmatter of every article carrying it, and
   * collapse duplicates the rename creates.
   */
  async rename(oldName: string, newName: string): Promise<MutationResultDto> {
    const from = await this.findOne(oldName);
    const to = newName.trim();

    if (!to) {
      throw new BadRequestException('New tag name must not be empty');
    }

    const items = await this.matching(from.name);
    return this.run(items, (item) =>
      this.rewriteTags(item.relativePath, (tags) => replaceTag(tags, from.name, to)),
    );
  }

  /**
   * Delete a tag from every article carrying it. The tag disappears with the
   * last article, because tags have no storage of their own.
   */
  async delete(tagName: string): Promise<MutationResultDto> {
    const tag = await this.findOne(tagName);
    const items = await this.matching(tag.name);

    return this.run(items, (item) =>
      this.rewriteTags(item.relativePath, (tags) => removeTag(tags, tag.name)),
    );
  }

  /**
   * Get tag suggestions, most used first.
   */
  async suggest(query?: string, limit?: number | string): Promise<TagDto[]> {
    const target = (query ?? '').trim().toLowerCase();
    if (!target) {
      return [];
    }

    const { tags } = await this.contentIndexService.aggregate();
    const matches = new Map<string, number>();
    for (const [name, count] of tags) {
      if (name.toLowerCase().includes(target)) {
        matches.set(name, count);
      }
    }

    return this.toDtos(matches, 'count').slice(0, this.resolveLimit(limit, 10));
  }

  /**
   * Get related tags (frequently co-occurring)
   */
  async getRelated(tagName: string, limit?: number | string): Promise<TagDto[]> {
    const tag = await this.findOne(tagName);
    const items = await this.matching(tag.name);
    const coOccurrences = new Map<string, number>();

    for (const item of items) {
      for (const other of item.frontmatter.tags) {
        if (!isSameTag(other, tag.name)) {
          coOccurrences.set(other, (coOccurrences.get(other) ?? 0) + 1);
        }
      }
    }

    return this.toDtos(coOccurrences, 'count').slice(0, this.resolveLimit(limit, 10));
  }

  /**
   * Bulk tag operations
   */
  async bulkAdd(tagName: string, articlePaths: string[]): Promise<MutationResultDto> {
    const tag = this.requireTag(tagName);
    return this.bulkApply(articlePaths, (relativePath) =>
      this.rewriteTags(relativePath, (tags) => addTag(tags, tag)),
    );
  }

  async bulkRemove(tagName: string, articlePaths: string[]): Promise<MutationResultDto> {
    const tag = this.requireTag(tagName);
    return this.bulkApply(articlePaths, (relativePath) =>
      this.rewriteTags(relativePath, (tags) => removeTag(tags, tag)),
    );
  }

  private requireTag(tagName: string): string {
    const tag = (tagName ?? '').trim();
    if (!tag) {
      throw new BadRequestException('Tag name must not be empty');
    }
    return tag;
  }

  private async bulkApply(
    articlePaths: readonly string[],
    mutate: (relativePath: string) => Promise<BatchOutcome>,
  ): Promise<MutationResultDto> {
    return runBatch(
      articlePaths,
      LIMITS.BULK_CONCURRENCY,
      (rawPath) => toPosix(rawPath),
      (rawPath) => mutate(toPosix(rawPath)),
      (failedPath, reason) => this.logger.warn(`Failed on ${failedPath}: ${reason}`),
    );
  }

  /** Articles whose frontmatter carries a tag. */
  private async matching(tagName: string): Promise<IndexedArticle[]> {
    const items = await this.contentIndexService.getItems();
    return items.filter((item) => item.frontmatter.tags.some((tag) => isSameTag(tag, tagName)));
  }

  /**
   * Rewrite `tags` only, with the transform applied to the content read under
   * the file lock, so an unrelated concurrent edit cannot be dropped by a stale
   * body. Returning the document untouched means nothing is written and counted.
   */
  private async rewriteTags(
    relativePath: string,
    transform: (tags: string[]) => string[],
  ): Promise<BatchOutcome> {
    let changed = false;

    await this.fileService.updateFile(relativePath, (markdown) => {
      const parsed = this.frontmatterService.parseFrontmatter(markdown);
      const tags = transform(parsed.frontmatter.tags);
      if (sameTags(parsed.frontmatter.tags, tags)) {
        return markdown;
      }
      changed = true;
      parsed.frontmatter.tags = tags;
      return this.frontmatterService.writeFrontmatter(parsed);
    });

    return changed ? 'applied' : 'skipped';
  }

  /** Query-string limits arrive as text that may not parse; never let that mean "all" or "none". */
  private resolveLimit(limit: number | string | undefined, fallback: number): number {
    return clampLimit(limit, fallback, LIMITS.MAX_PAGE_LIMIT);
  }

  private toDtos(counts: Map<string, number>, sortBy: 'name' | 'count'): TagDto[] {
    const tags = Array.from(counts, ([name, count]) => ({ name, count }));
    return sortBy === 'count'
      ? tags.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      : tags.sort((a, b) => a.name.localeCompare(b.name));
  }

  private run(
    items: IndexedArticle[],
    mutate: (item: IndexedArticle) => Promise<BatchOutcome>,
  ): Promise<MutationResultDto> {
    return runBatch(
      items,
      LIMITS.BULK_CONCURRENCY,
      (item) => item.relativePath,
      mutate,
      (failedPath, reason) => this.logger.warn(`Failed on ${failedPath}: ${reason}`),
    );
  }
}
