import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import path from 'path';
import { FileService } from '../common/file.service';
import { FrontmatterService, ArticleFrontmatter } from '../common/frontmatter.service';
import { ContentIndexService } from '../common/content-index.service';
import { ArticleDto, PaginatedArticlesDto, toArticleListItem } from './dto/article.dto';
import { CreateArticleDto } from './dto/create-article.dto';
import { UpdateArticleDto } from './dto/update-article.dto';
import { ListArticlesDto } from './dto/list-articles.dto';
import {
  BulkFailureItem,
  BulkOperationDto,
  BulkOperationResultDto,
  BulkOperationType,
} from './dto/bulk-operation.dto';
import { LIMITS } from '../common/constants';
import { mapWithConcurrency } from '../common/async.util';
import { paginate, resolvePage, sortByPublishedDesc } from '../common/pagination.util';
import {
  categoryOf,
  isInCategory,
  normalizeCategoryPath,
  toDisplayCategory,
  toPosix,
} from '../common/path.util';

@Injectable()
export class ArticlesService {
  private readonly logger = new Logger(ArticlesService.name);

  constructor(
    private readonly fileService: FileService,
    private readonly frontmatterService: FrontmatterService,
    private readonly contentIndexService: ContentIndexService,
  ) {}

  /**
   * Create a new article
   */
  async create(createArticleDto: CreateArticleDto): Promise<ArticleDto> {
    const { title, category, content } = createArticleDto;

    const relativePath = this.articlePath(
      normalizeCategoryPath(category),
      `${this.frontmatterService.generateSlug(title)}.md`,
    );

    const frontmatter: ArticleFrontmatter = {
      title,
      published: new Date().toISOString(),
      description: createArticleDto.description ?? '',
      image: createArticleDto.image ?? '',
      tags: createArticleDto.tags ?? [],
      category: toDisplayCategory(category),
      draft: createArticleDto.draft ?? false,
      lang: createArticleDto.lang ?? '',
    };

    const markdown = this.frontmatterService.writeFrontmatter({ frontmatter, content });

    // The existence check runs inside the file lock, so two concurrent creates
    // of the same title cannot both decide the slot is free.
    const created = createArticleDto.overwrite
      ? ((await this.fileService.writeFile(relativePath, markdown)), true)
      : await this.fileService.writeFileIfAbsent(relativePath, markdown);

    if (!created) {
      throw new ConflictException(
        `Article already exists: ${relativePath}. Retry with overwrite=true to replace it.`,
      );
    }

    return this.getArticle(relativePath);
  }

  /**
   * Find all articles with pagination and filtering.
   *
   * One pass over the shared metadata index: filters, sort and pagination all
   * work on the in-memory snapshot instead of re-reading files per criterion.
   */
  async findAll(query: ListArticlesDto): Promise<PaginatedArticlesDto> {
    const items = await this.contentIndexService.getItems();

    const category = normalizeCategoryPath(query.category);
    const tag = query.tag?.toLowerCase();
    const search = query.search?.toLowerCase();

    const filtered = items.filter((item) => {
      if (query.draft !== undefined && item.frontmatter.draft !== query.draft) {
        return false;
      }
      if (category && !isInCategory(item.relativePath, category)) {
        return false;
      }
      if (tag && !item.frontmatter.tags.some((t) => t.toLowerCase() === tag)) {
        return false;
      }
      if (search && !item.frontmatter.title.toLowerCase().includes(search)) {
        return false;
      }
      return true;
    });

    const sorted = sortByPublishedDesc(filtered);
    const { page, limit } = resolvePage(query);
    const result = paginate(sorted, page, limit);

    return { ...result, data: result.data.map(toArticleListItem) };
  }

  /**
   * Find one article by path
   */
  async findOne(relativePath: string): Promise<ArticleDto> {
    return this.getArticle(relativePath);
  }

  /**
   * Update an article, moving the file when the title or category changes.
   */
  async update(relativePath: string, updateArticleDto: UpdateArticleDto): Promise<ArticleDto> {
    const sourcePath = toPosix(relativePath);
    const targetPath = this.resolveTargetPath(sourcePath, updateArticleDto);
    const categoryDisplay =
      updateArticleDto.newCategory !== undefined
        ? toDisplayCategory(updateArticleDto.newCategory)
        : updateArticleDto.category !== undefined
          ? toDisplayCategory(updateArticleDto.category)
          : undefined;

    const mutate = (markdown: string): string =>
      this.applyUpdates(markdown, updateArticleDto, categoryDisplay);

    if (targetPath === sourcePath) {
      await this.fileService.updateFile(sourcePath, mutate);
    } else {
      // moveAndUpdate also refuses to land on an existing article.
      await this.fileService.moveAndUpdate(sourcePath, targetPath, mutate);
    }

    return this.getArticle(targetPath);
  }

  /**
   * Delete an article
   */
  async remove(relativePath: string): Promise<{ backupPath: string | null }> {
    const sourcePath = toPosix(relativePath);
    if (!(await this.fileService.fileExists(sourcePath))) {
      throw new NotFoundException(`Article not found: ${sourcePath}`);
    }
    const backupPath = await this.fileService.deleteFile(sourcePath);
    return { backupPath };
  }

  /**
   * Toggle draft status
   */
  async toggleDraft(relativePath: string): Promise<ArticleDto> {
    const sourcePath = toPosix(relativePath);

    await this.fileService.updateFile(sourcePath, (markdown) => {
      const parsed = this.frontmatterService.parseFrontmatter(markdown);
      return this.frontmatterService.writeFrontmatter({
        frontmatter: { ...parsed.frontmatter, draft: !parsed.frontmatter.draft },
        content: parsed.content,
      });
    });

    return this.getArticle(sourcePath);
  }

  /**
   * Bulk operations on articles
   */
  async bulkOperation(bulkDto: BulkOperationDto): Promise<BulkOperationResultDto> {
    this.validateBulkRequest(bulkDto);

    let success = 0;
    let skipped = 0;
    const failures: BulkFailureItem[] = [];

    await mapWithConcurrency(bulkDto.paths, LIMITS.BULK_CONCURRENCY, async (rawPath) => {
      const relativePath = toPosix(rawPath);
      try {
        const outcome = await this.applyBulkOperation(relativePath, bulkDto);
        if (outcome === 'skipped') {
          skipped++;
        } else {
          success++;
        }
      } catch (error) {
        // A single bad file must not abort the rest of the batch.
        this.logger.warn(`Bulk ${bulkDto.operation} failed for ${relativePath}`);
        failures.push({
          path: relativePath,
          reason: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    // Every item lands in exactly one bucket, so total === success + skipped + failed.
    return {
      total: bulkDto.paths.length,
      success,
      skipped,
      failed: failures.length,
      failures,
    };
  }

  /** Returns 'applied' or 'skipped' when the item needed no change. */
  private async applyBulkOperation(
    relativePath: string,
    bulkDto: BulkOperationDto,
  ): Promise<'applied' | 'skipped'> {
    switch (bulkDto.operation) {
      case BulkOperationType.DELETE:
        await this.remove(relativePath);
        return 'applied';

      case BulkOperationType.UPDATE_CATEGORY: {
        const nextCategory = normalizeCategoryPath(bulkDto.category);
        if (categoryOf(relativePath) === nextCategory) {
          return 'skipped';
        }
        await this.update(relativePath, { newCategory: nextCategory });
        return 'applied';
      }

      case BulkOperationType.ADD_TAG: {
        const tag = bulkDto.tag!;
        const article = await this.getArticle(relativePath);
        const hasTag = article.frontmatter.tags.some(
          (t) => t.toLowerCase() === tag.toLowerCase(),
        );
        if (hasTag) {
          return 'skipped';
        }
        await this.update(relativePath, {
          tags: [...article.frontmatter.tags, tag],
        });
        return 'applied';
      }

      case BulkOperationType.REMOVE_TAG: {
        const tag = bulkDto.tag!;
        const article = await this.getArticle(relativePath);
        const tags = article.frontmatter.tags.filter(
          (t) => t.toLowerCase() !== tag.toLowerCase(),
        );
        if (tags.length === article.frontmatter.tags.length) {
          return 'skipped';
        }
        await this.update(relativePath, { tags });
        return 'applied';
      }

      case BulkOperationType.SET_DRAFT: {
        const article = await this.getArticle(relativePath);
        if (article.frontmatter.draft === bulkDto.draft) {
          return 'skipped';
        }
        await this.update(relativePath, { draft: bulkDto.draft });
        return 'applied';
      }
    }
  }

  private validateBulkRequest(bulkDto: BulkOperationDto): void {
    const requires = (condition: boolean, field: string) => {
      if (!condition) {
        throw new BadRequestException(`${field} is required for operation "${bulkDto.operation}"`);
      }
    };

    switch (bulkDto.operation) {
      case BulkOperationType.UPDATE_CATEGORY:
        requires(bulkDto.category !== undefined, 'category');
        break;
      case BulkOperationType.ADD_TAG:
      case BulkOperationType.REMOVE_TAG:
        requires(!!bulkDto.tag, 'tag');
        break;
      case BulkOperationType.SET_DRAFT:
        requires(bulkDto.draft !== undefined, 'draft');
        break;
    }
  }

  /**
   * Where this article lives after the update. Computed from the request alone
   * (the current directory and extension), so no file read is needed to know it.
   */
  private resolveTargetPath(sourcePath: string, dto: UpdateArticleDto): string {
    const ext = path.extname(sourcePath);
    const directory =
      dto.newCategory !== undefined ? normalizeCategoryPath(dto.newCategory) : categoryOf(sourcePath);
    const baseName = dto.newTitle
      ? this.frontmatterService.generateSlug(dto.newTitle)
      : path.basename(sourcePath, ext);

    return this.articlePath(directory, `${baseName}${ext || '.md'}`);
  }

  private applyUpdates(
    markdown: string,
    dto: UpdateArticleDto,
    categoryDisplay?: string,
  ): string {
    const parsed = this.frontmatterService.parseFrontmatter(markdown);

    const updates: Partial<ArticleFrontmatter> = {};
    if (dto.title !== undefined) updates.title = dto.title;
    if (dto.newTitle !== undefined) updates.title = dto.newTitle;
    if (dto.description !== undefined) updates.description = dto.description;
    if (dto.image !== undefined) updates.image = dto.image;
    if (dto.tags !== undefined) updates.tags = dto.tags;
    if (dto.draft !== undefined) updates.draft = dto.draft;
    if (dto.lang !== undefined) updates.lang = dto.lang;
    // Kept in sync with the directory, otherwise the category and tag pages keep
    // listing the article under the name it was moved away from.
    if (categoryDisplay !== undefined) updates.category = categoryDisplay;

    return this.frontmatterService.writeFrontmatter({
      frontmatter: this.frontmatterService.mergeFrontmatter(parsed.frontmatter, updates),
      content: dto.content ?? parsed.content,
    });
  }

  private articlePath(directory: string, fileName: string): string {
    return directory ? `${directory}/${fileName}` : fileName;
  }

  private async getArticle(relativePath: string): Promise<ArticleDto> {
    const posixPath = toPosix(relativePath);
    const markdown = await this.fileService.readFile(posixPath);
    const parsed = this.frontmatterService.parseFrontmatter(markdown);

    return {
      path: posixPath,
      frontmatter: parsed.frontmatter,
      content: parsed.content,
    };
  }
}
