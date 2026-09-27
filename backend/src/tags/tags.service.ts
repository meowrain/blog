import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import path from 'path';
import { FileService } from '../common/file.service';
import { FrontmatterService } from '../common/frontmatter.service';
import { ContentIndexService, IndexedArticle } from '../common/content-index.service';
import { LIMITS, PATHS } from '../common/constants';
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

/**
 * Characters that would break the frontmatter tags array (or the input that
 * feeds it): list separators, YAML flow brackets, line breaks.
 */
const ILLEGAL_TAG_CHARS = /[,，[\]{}\n\r]/;

/** Keep the first occurrence of every case-insensitive name, preserving order. */
function dedupeTags(names: string[]): string[] {
  const seen = new Set<string>();
  return names.filter((name) => {
    const key = name.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
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
 * Tags come from article frontmatter, so the used tag set is the article set.
 * A tag pre-created before any article uses it is kept in a small registry
 * file (`.tags.json` in POSTS_DIR) and shows a count of 0 until picked up.
 *
 * Counts and matching articles are read from ContentIndexService instead of a
 * private cache that stayed warm for the life of the process, and mutations
 * only touch the articles the index already says carry the tag rather than
 * re-reading every document in POSTS_DIR.
 */
@Injectable()
export class TagsService {
  private readonly logger = new Logger(TagsService.name);

  /**
   * Tags pre-created before any article uses them live here, inside POSTS_DIR
   * so they travel with the content. The dot prefix keeps them out of every
   * markdown listing and out of the Astro content collection.
   */
  private static readonly REGISTRY_FILE = '.tags.json';

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
    return this.toDtos(await this.withRegistryTags(tags), sortBy === 'count' ? 'count' : 'name');
  }

  /**
   * Get popular tags
   */
  async findPopular(limit?: number | string): Promise<TagDto[]> {
    const { tags } = await this.contentIndexService.aggregate();
    return this.toDtos(await this.withRegistryTags(tags), 'count').slice(
      0,
      this.resolveLimit(limit, 20),
    );
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
    const merged = await this.withRegistryTags(tags);
    for (const [tagName, count] of merged) {
      if (isSameTag(tagName, target)) {
        return { name: tagName, count };
      }
    }

    throw new NotFoundException(`Tag not found: ${name}`);
  }

  /**
   * Pre-create a tag. Tags normally live only in article frontmatter, so an
   * unused one is kept in the registry: it stays listed (count 0) and shows up
   * in suggestions until an article picks it up.
   */
  async create(tagName: string): Promise<TagDto> {
    const name = this.requireTag(tagName);
    if (name.length > 128 || ILLEGAL_TAG_CHARS.test(name)) {
      throw new BadRequestException(
        'Tag name must be at most 128 characters without commas, brackets or line breaks',
      );
    }

    const { tags } = await this.contentIndexService.aggregate();
    const existing = Array.from(tags.keys()).find((tag) => isSameTag(tag, name));
    if (existing) {
      throw new ConflictException(`Tag already exists: ${existing}`);
    }

    const registry = await this.readRegistry();
    const registered = registry.find((tag) => isSameTag(tag, name));
    if (registered) {
      throw new ConflictException(`Tag already exists: ${registered}`);
    }

    await this.writeRegistry([...registry, name]);
    return { name, count: 0 };
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
   * collapse duplicates the rename creates. A registry entry follows along.
   */
  async rename(oldName: string, newName: string): Promise<MutationResultDto> {
    const from = await this.findOne(oldName);
    const to = newName.trim();

    if (!to) {
      throw new BadRequestException('New tag name must not be empty');
    }

    const items = await this.matching(from.name);
    const result = await this.run(items, (item) =>
      this.rewriteTags(item.relativePath, (tags) => replaceTag(tags, from.name, to)),
    );

    await this.renameInRegistry(from.name, to);
    return result;
  }

  /**
   * Delete a tag from every article carrying it. The tag disappears with the
   * last article, and so does its registry entry, if one exists.
   */
  async delete(tagName: string): Promise<MutationResultDto> {
    const tag = await this.findOne(tagName);
    const items = await this.matching(tag.name);

    const result = await this.run(items, (item) =>
      this.rewriteTags(item.relativePath, (tags) => removeTag(tags, tag.name)),
    );

    const registry = await this.readRegistry();
    const next = registry.filter((name) => !isSameTag(name, tag.name));
    if (next.length !== registry.length) {
      await this.writeRegistry(next);
    }
    return result;
  }

  /**
   * Get tag suggestions, most used first. Pre-created (count 0) tags are
   * included, so a freshly registered tag is suggestible right away.
   */
  async suggest(query?: string, limit?: number | string): Promise<TagDto[]> {
    const target = (query ?? '').trim().toLowerCase();
    if (!target) {
      return [];
    }

    const { tags } = await this.contentIndexService.aggregate();
    const matches = new Map<string, number>();
    for (const [name, count] of await this.withRegistryTags(tags)) {
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

  /** Names registered ahead of use, ignoring a missing or malformed file. */
  private async readRegistry(): Promise<string[]> {
    try {
      const raw = await fs.readFile(this.registryPath(), 'utf-8');
      const parsed = JSON.parse(raw) as { tags?: unknown };
      return Array.isArray(parsed?.tags)
        ? parsed.tags.filter((tag): tag is string => typeof tag === 'string')
        : [];
    } catch {
      return [];
    }
  }

  /** Atomic-ish registry write: a torn file must not take the tag list down. */
  private async writeRegistry(names: string[]): Promise<void> {
    const target = this.registryPath();
    const tmpPath = `${target}.tmp.${randomUUID()}`;
    try {
      await fs.writeFile(tmpPath, `${JSON.stringify({ tags: names }, null, 2)}\n`, 'utf-8');
      await fs.rename(tmpPath, target);
    } catch (error) {
      await fs.unlink(tmpPath).catch(() => undefined);
      throw error;
    }
  }

  /** Registry names joined with the used ones; used casing wins. */
  private async withRegistryTags(used: Map<string, number>): Promise<Map<string, number>> {
    const merged = new Map<string, number>(used);
    const usedKeys = new Set(Array.from(merged.keys(), (key) => key.toLowerCase()));
    for (const name of await this.readRegistry()) {
      if (!usedKeys.has(name.toLowerCase())) {
        merged.set(name, 0);
      }
    }
    return merged;
  }

  private async renameInRegistry(from: string, to: string): Promise<void> {
    const registry = await this.readRegistry();
    if (!registry.some((name) => isSameTag(name, from))) {
      return;
    }
    const renamed = dedupeTags(registry.map((name) => (isSameTag(name, from) ? to : name)));
    await this.writeRegistry(renamed);
  }

  private registryPath(): string {
    return path.join(PATHS.POSTS_DIR, TagsService.REGISTRY_FILE);
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
