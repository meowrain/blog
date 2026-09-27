import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import path from 'path';
import { FileService } from '../common/file.service';
import { FrontmatterService } from '../common/frontmatter.service';
import { ContentIndexService, IndexedArticle } from '../common/content-index.service';
import { LIMITS } from '../common/constants';
import { BatchOutcome, MutationResultDto, runBatch } from '../common/batch.util';
import { PageQueryDto } from '../common/page-query.dto';
import {
  paginate,
  PagedResult,
  resolvePage,
  sortByPublishedDesc,
} from '../common/pagination.util';
import {
  categoryOf,
  isInCategory,
  isValidCategoryPath,
  normalizeCategoryPath,
  replacePathPrefix,
  toDisplayCategory,
} from '../common/path.util';
import { ArticleListItemDto, toArticleListItem } from '../articles/dto/article.dto';
import { CategoryDto, CategoryTreeDto } from './dto/category.dto';

interface CategoryNode {
  name: string;
  path: string;
  articleCount: number;
  children: Map<string, CategoryNode>;
}

/**
 * Categories are directories: a category exists when at least one article sits
 * in it (or below it), and counts come from ContentIndexService rather than a
 * cache of this service's own, which stayed warm for the life of the process.
 */
@Injectable()
export class CategoriesService {
  private readonly logger = new Logger(CategoriesService.name);

  constructor(
    private readonly fileService: FileService,
    private readonly frontmatterService: FrontmatterService,
    private readonly contentIndexService: ContentIndexService,
  ) {}

  /**
   * Get all categories (flat list)
   *
   * Directories with no articles yet count as categories too, so a freshly
   * created one stays visible (count 0) instead of disappearing.
   */
  async findAll(): Promise<CategoryDto[]> {
    const { categories, directories } = await this.contentIndexService.aggregate();
    const merged = new Map<string, number>(categories);
    for (const directory of directories) {
      if (!merged.has(directory)) {
        merged.set(directory, 0);
      }
    }
    return Array.from(merged.entries())
      .map(([categoryPath, count]) => this.toDto(categoryPath, count))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  /**
   * Get category tree structure
   */
  async findTree(): Promise<CategoryTreeDto[]> {
    const categories = await this.findAll();
    const rootMap = new Map<string, CategoryNode>();

    for (const category of categories) {
      const parts = category.path.split('/');
      let currentLevel = rootMap;
      let currentPath = '';

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        currentPath = i === 0 ? part : `${currentPath}/${part}`;

        if (!currentLevel.has(part)) {
          currentLevel.set(part, {
            name: part,
            path: currentPath,
            articleCount: 0,
            children: new Map(),
          });
        }

        const node = currentLevel.get(part)!;
        if (i === parts.length - 1) {
          node.articleCount = category.articleCount;
        }
        currentLevel = node.children;
      }
    }

    return this.buildTree(Array.from(rootMap.values()));
  }

  /**
   * Get one category by path, or by its last segment when that is unambiguous.
   */
  async findOne(pathOrName: string): Promise<CategoryDto> {
    const target = normalizeCategoryPath(pathOrName);
    if (!target) {
      throw new NotFoundException(`Category not found: ${pathOrName}`);
    }

    const categories = await this.findAll();
    const exact = categories.find((category) => category.path === target);
    if (exact) {
      return exact;
    }

    const matches = categories.filter((category) =>
      category.path.endsWith(`/${target}`),
    );
    if (matches.length === 1) {
      return matches[0];
    }
    if (matches.length > 1) {
      throw new BadRequestException(
        `Category name "${pathOrName}" is ambiguous: ${matches
          .map((category) => category.path)
          .join(', ')}`,
      );
    }

    throw new NotFoundException(`Category not found: ${pathOrName}`);
  }

  /**
   * Create an empty category directory. Categories normally materialize from
   * the article folders, but a pre-created one keeps the taxonomy listed
   * (count 0) and ready for the next article.
   */
  async create(categoryPath: string): Promise<CategoryDto> {
    const target = normalizeCategoryPath(categoryPath);
    if (!target) {
      throw new BadRequestException('Category path must not be empty');
    }
    if (!isValidCategoryPath(target)) {
      throw new BadRequestException(`Category path contains invalid characters: ${target}`);
    }

    // A file anywhere along the path would block mkdir with an opaque error.
    let prefix = '';
    for (const segment of target.split('/')) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      const kind = await this.fileService.pathKind(prefix);
      if (kind === 'file') {
        throw new ConflictException(`A file already exists at "${prefix}"`);
      }
    }
    if ((await this.fileService.pathKind(target)) === 'directory') {
      throw new ConflictException(`Category already exists: ${target}`);
    }

    await this.fileService.createDirectory(target);
    return this.toDto(target, 0);
  }

  /**
   * Get articles by category, newest first, with the metadata the callers need
   * to render a row (bare paths forced a follow-up request per article).
   */
  async getArticles(
    categoryPath: string,
    query: PageQueryDto = {},
  ): Promise<PagedResult<ArticleListItemDto>> {
    const category = await this.findOne(categoryPath);
    const items = await this.contentIndexService.getItems();

    const sorted = sortByPublishedDesc(
      items.filter((item) => isInCategory(item.relativePath, category.path)),
    ).map(toArticleListItem);

    const { page, limit } = resolvePage(query);
    return paginate(sorted, page, limit);
  }

  /**
   * Rename a category: move every article below it and resync their frontmatter.
   * Directories the articles left behind are pruned, so the old path does not
   * linger as an empty category.
   */
  async rename(oldPath: string, newPath: string): Promise<MutationResultDto> {
    const from = (await this.findOne(oldPath)).path;
    const to = normalizeCategoryPath(newPath);

    if (!to) {
      throw new BadRequestException('New category path must not be empty');
    }
    if (to === from) {
      throw new BadRequestException(`Category is already named "${to}"`);
    }

    const items = await this.itemsIn(from);

    const result = await this.run(items, async (item) => {
      const targetPath = replacePathPrefix(item.relativePath, from, to);
      // Each article's own destination directory, so a moved subtree keeps its
      // frontmatter in sync instead of collapsing onto the renamed parent.
      const display = toDisplayCategory(categoryOf(targetPath));
      await this.fileService.moveAndUpdate(item.relativePath, targetPath, (markdown) =>
        this.withCategory(markdown, display),
      );
    });

    await this.pruneEmptyDirs(from);
    return result;
  }

  /**
   * Delete a category by moving or removing every article it contains.
   *
   * Doing nothing was previously reported as a successful `{count: 0}` delete;
   * an explicit choice is now required so the caller cannot lose articles by
   * forgetting a query parameter. `moveTo` has to name a real category — an
   * empty one is indistinguishable from "no decision yet". Moving a single
   * article out of its category is an article edit instead. A category with no
   * articles is just a directory: it is removed outright.
   */
  async delete(
    categoryPath: string,
    moveArticlesTo?: string,
    deleteArticles = false,
  ): Promise<MutationResultDto> {
    const category = await this.findOne(categoryPath);
    const items = await this.itemsIn(category.path);

    if (items.length === 0) {
      await this.fileService.removeEmptyDirectoryTree(category.path);
      return { total: 0, count: 0, skipped: 0, failed: 0, failures: [] };
    }

    if (deleteArticles) {
      const result = await this.run(items, async (item) => {
        await this.fileService.deleteFile(item.relativePath);
      });
      await this.pruneEmptyDirs(category.path);
      return result;
    }

    const to = normalizeCategoryPath(moveArticlesTo);
    if (!to) {
      throw new BadRequestException(
        'Choose how to handle the articles: pass deleteArticles=true or moveTo=<category>',
      );
    }
    if (to === category.path) {
      throw new BadRequestException(`Target category is the category being deleted: "${to}"`);
    }

    const display = toDisplayCategory(to);
    const result = await this.run(items, async (item) => {
      const targetPath = `${to}/${path.posix.basename(item.relativePath)}`;
      await this.fileService.moveAndUpdate(item.relativePath, targetPath, (markdown) =>
        this.withCategory(markdown, display),
      );
    });
    await this.pruneEmptyDirs(category.path);
    return result;
  }

  /**
   * Best-effort cleanup of directories emptied by a delete or rename: empty
   * subtrees below the old path go first, then upwards for as long as the
   * parents have emptied out too. A directory holding any file survives.
   */
  private async pruneEmptyDirs(relativeDir: string): Promise<void> {
    const normalized = normalizeCategoryPath(relativeDir);
    if (normalized) {
      await this.fileService.pruneEmptyDirectories(normalized);
    }
  }

  private toDto(categoryPath: string, articleCount: number): CategoryDto {
    const parts = categoryPath.split('/');
    return {
      name: parts[parts.length - 1],
      path: categoryPath,
      articleCount,
      parent: parts.length > 1 ? parts.slice(0, -1).join('/') : undefined,
    };
  }

  private async itemsIn(categoryPath: string): Promise<IndexedArticle[]> {
    const items = await this.contentIndexService.getItems();
    return items.filter((item) => isInCategory(item.relativePath, categoryPath));
  }

  /** Rewrite `category` only, so an unrelated edit cannot be dropped by a stale body. */
  private withCategory(markdown: string, display: string): string {
    const parsed = this.frontmatterService.parseFrontmatter(markdown);
    if (parsed.frontmatter.category === display) {
      return markdown;
    }
    parsed.frontmatter.category = display;
    return this.frontmatterService.writeFrontmatter(parsed);
  }

  private run(
    items: IndexedArticle[],
    mutate: (item: IndexedArticle) => Promise<BatchOutcome | void>,
  ): Promise<MutationResultDto> {
    return runBatch(
      items,
      LIMITS.BULK_CONCURRENCY,
      (item) => item.relativePath,
      mutate,
      (failedPath, reason) => this.logger.warn(`Failed on ${failedPath}: ${reason}`),
    );
  }

  /**
   * Build tree structure from nodes
   */
  private buildTree(nodes: CategoryNode[]): CategoryTreeDto[] {
    return nodes.map((node) => ({
      name: node.name,
      path: node.path,
      articleCount: node.articleCount,
      children: this.buildTree(Array.from(node.children.values())),
    }));
  }
}
