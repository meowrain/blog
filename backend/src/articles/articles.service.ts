import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import path from 'path';
import { FileService } from '../common/file.service';
import { FrontmatterService, ArticleFrontmatter, ParsedArticle } from '../common/frontmatter.service';
import {
  ArticleDto,
  ArticleListItemDto,
  PaginatedArticlesDto,
} from './dto/article.dto';
import { CreateArticleDto } from './dto/create-article.dto';
import { UpdateArticleDto } from './dto/update-article.dto';
import { ListArticlesDto } from './dto/list-articles.dto';
import { BulkOperationDto, BulkOperationType } from './dto/bulk-operation.dto';
import { PATHS } from '../common/constants';

@Injectable()
export class ArticlesService {
  constructor(
    private readonly fileService: FileService,
    private readonly frontmatterService: FrontmatterService,
  ) {}

  /**
   * Create a new article
   */
  async create(createArticleDto: CreateArticleDto): Promise<ArticleDto> {
    const { title, category, content } = createArticleDto;

    // Generate file path from title and category
    const filename = this.frontmatterService.generateSlug(title);
    const categoryPath = this.normalizeCategoryPath(category).replace(/\//g, path.sep);
    const relativePath = path.join(categoryPath, `${filename}.md`);

    // Build frontmatter with defaults
    const frontmatter: ArticleFrontmatter = {
      title,
      published: new Date().toISOString(),
      description: createArticleDto.description ?? '',
      image: createArticleDto.image ?? '',
      tags: createArticleDto.tags ?? [],
      category: this.normalizeCategoryDisplay(category),
      draft: createArticleDto.draft ?? false,
      lang: createArticleDto.lang ?? '',
    };

    // Write the article
    const parsedArticle: ParsedArticle = {
      frontmatter,
      content,
    };

    const markdown = this.frontmatterService.writeFrontmatter(parsedArticle);
    await this.fileService.writeFile(relativePath, markdown);

    return this.getArticle(relativePath);
  }

  /**
   * Find all articles with pagination and filtering
   */
  async findAll(query: ListArticlesDto): Promise<PaginatedArticlesDto> {
    let files = await this.fileService.listFiles();

    // Filter by draft status
    if (query.draft === 'true') {
      // Only drafts
      const articles = await Promise.all(
        files.map(async (f) => this.getArticleListItem(f))
      );
      files = articles.filter((a) => a.draft).map((a) => a.path);
    } else if (query.draft === 'false') {
      // Only published
      const articles = await Promise.all(
        files.map(async (f) => this.getArticleListItem(f))
      );
      files = articles.filter((a) => !a.draft).map((a) => a.path);
    }

    // Filter by category
    if (query.category) {
      const categoryPattern = this.normalizeCategoryPath(query.category).replace(/\//g, path.sep);
      files = files.filter((f) => {
        const dir = path.dirname(f);
        return dir === categoryPattern || dir.startsWith(categoryPattern + path.sep);
      });
    }

    // Filter by tag
    if (query.tag) {
      const articles = await Promise.all(
        files.map(async (f) => this.getArticleListItem(f))
      );
      const tagLower = query.tag.toLowerCase();
      files = articles
        .filter((a) => a.tags.some((t) => t.toLowerCase() === tagLower))
        .map((a) => a.path);
    }

    // Search by title
    if (query.search) {
      const searchLower = query.search.toLowerCase();
      const articles = await Promise.all(
        files.map(async (f) => this.getArticleListItem(f))
      );
      files = articles
        .filter((a) => a.title.toLowerCase().includes(searchLower))
        .map((a) => a.path);
    }

    // Sort by published date (newest first)
    const articles = await Promise.all(
      files.map(async (f) => this.getArticleListItem(f))
    );
    articles.sort((a, b) => {
      const dateA = new Date(a.published).getTime();
      const dateB = new Date(b.published).getTime();
      return dateB - dateA;
    });

    // Pagination
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const total = articles.length;
    const totalPages = Math.ceil(total / limit);
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedArticles = articles.slice(startIndex, endIndex);

    return {
      data: paginatedArticles,
      total,
      page,
      limit,
      totalPages,
    };
  }

  /**
   * Find one article by path
   */
  async findOne(relativePath: string): Promise<ArticleDto> {
    return this.getArticle(relativePath);
  }

  /**
   * Update an article
   */
  async update(relativePath: string, updateArticleDto: UpdateArticleDto): Promise<ArticleDto> {
    // Read existing article
    const existing = await this.getArticle(relativePath);

    // Handle title change (file rename)
    let titleToUse = updateArticleDto.title;
    if (updateArticleDto.newTitle) {
      titleToUse = updateArticleDto.newTitle;
    }

    // Handle category change (file move)
    let newPath = relativePath;
    if (updateArticleDto.newCategory !== undefined) {
      const filename = path.basename(relativePath);
      const newCategoryPath = this.normalizeCategoryPath(updateArticleDto.newCategory).replace(/\//g, path.sep);
      newPath = path.join(newCategoryPath, filename);
    }

    // Build frontmatter updates (only include fields that are present in DTO)
    const frontmatterUpdates: Partial<ArticleFrontmatter> = {};
    if (updateArticleDto.title !== undefined) frontmatterUpdates.title = updateArticleDto.title;
    if (updateArticleDto.description !== undefined) frontmatterUpdates.description = updateArticleDto.description;
    if (updateArticleDto.image !== undefined) frontmatterUpdates.image = updateArticleDto.image;
    if (updateArticleDto.tags !== undefined) frontmatterUpdates.tags = updateArticleDto.tags;
    if (updateArticleDto.category !== undefined) {
      frontmatterUpdates.category = this.normalizeCategoryDisplay(updateArticleDto.category);
    }
    if (updateArticleDto.draft !== undefined) frontmatterUpdates.draft = updateArticleDto.draft;
    if (updateArticleDto.lang !== undefined) frontmatterUpdates.lang = updateArticleDto.lang;

    // Merge frontmatter
    const updatedFrontmatter = this.frontmatterService.mergeFrontmatter(
      existing.frontmatter,
      frontmatterUpdates,
    );

    // Update title if changed via newTitle
    if (titleToUse && titleToUse !== existing.frontmatter.title) {
      updatedFrontmatter.title = titleToUse;
    }

    // Build updated article
    const parsedArticle: ParsedArticle = {
      frontmatter: updatedFrontmatter,
      content: updateArticleDto.content ?? existing.content,
    };

    // Write the article (may be to new path)
    const markdown = this.frontmatterService.writeFrontmatter(parsedArticle);

    if (newPath !== relativePath) {
      // File is being moved
      await this.fileService.moveFile(relativePath, newPath);
      // Need to write content after move
      await this.fileService.writeFile(newPath, markdown);
    } else {
      await this.fileService.writeFile(relativePath, markdown);
    }

    return this.getArticle(newPath);
  }

  /**
   * Delete an article
   */
  async remove(relativePath: string): Promise<void> {
    const exists = await this.fileService.fileExists(relativePath);
    if (!exists) {
      throw new NotFoundException(`Article not found: ${relativePath}`);
    }
    await this.fileService.deleteFile(relativePath);
  }

  /**
   * Toggle draft status
   */
  async toggleDraft(relativePath: string): Promise<ArticleDto> {
    const article = await this.getArticle(relativePath);
    const updatedFrontmatter = {
      ...article.frontmatter,
      draft: !article.frontmatter.draft,
    };

    const parsedArticle: ParsedArticle = {
      frontmatter: updatedFrontmatter,
      content: article.content,
    };

    const markdown = this.frontmatterService.writeFrontmatter(parsedArticle);
    await this.fileService.writeFile(relativePath, markdown);

    return this.getArticle(relativePath);
  }

  /**
   * Bulk operations on articles
   */
  async bulkOperation(bulkDto: BulkOperationDto): Promise<{ count: number }> {
    const { paths, operation } = bulkDto;
    let count = 0;

    for (const relativePath of paths) {
      try {
        switch (operation) {
          case BulkOperationType.DELETE:
            await this.remove(relativePath);
            count++;
            break;

          case BulkOperationType.UPDATE_CATEGORY:
            if (bulkDto.category) {
              const article = await this.getArticle(relativePath);
              const updated = await this.update(relativePath, {
                newCategory: bulkDto.category,
              });
              count++;
            }
            break;

          case BulkOperationType.ADD_TAG:
            if (bulkDto.tag) {
              const article = await this.getArticle(relativePath);
              if (!article.frontmatter.tags.includes(bulkDto.tag)) {
                const updated = await this.update(relativePath, {
                  tags: [...article.frontmatter.tags, bulkDto.tag],
                });
                count++;
              }
            }
            break;

          case BulkOperationType.REMOVE_TAG:
            if (bulkDto.tag) {
              const article = await this.getArticle(relativePath);
              const filteredTags = article.frontmatter.tags.filter((t) => t !== bulkDto.tag);
              if (filteredTags.length !== article.frontmatter.tags.length) {
                const updated = await this.update(relativePath, {
                  tags: filteredTags,
                });
                count++;
              }
            }
            break;
        }
      } catch (error) {
        // Continue with next file on error
        console.error(`Error processing ${relativePath}:`, error);
      }
    }

    return { count };
  }

  /**
   * Get article as DTO
   */
  private async getArticle(relativePath: string): Promise<ArticleDto> {
    const exists = await this.fileService.fileExists(relativePath);
    if (!exists) {
      throw new NotFoundException(`Article not found: ${relativePath}`);
    }

    const markdown = await this.fileService.readFile(relativePath);
    const parsed = this.frontmatterService.parseFrontmatter(markdown);

    return {
      path: relativePath,
      frontmatter: parsed.frontmatter,
      content: parsed.content,
    };
  }

  /**
   * Get article list item (without content)
   */
  private async getArticleListItem(relativePath: string): Promise<ArticleListItemDto> {
    const article = await this.getArticle(relativePath);
    return {
      path: article.path,
      title: article.frontmatter.title,
      category: article.frontmatter.category,
      tags: article.frontmatter.tags,
      draft: article.frontmatter.draft,
      published: article.frontmatter.published as string,
      description: article.frontmatter.description,
      image: article.frontmatter.image,
    };
  }

  private normalizeCategoryPath(input?: string): string {
    if (!input) return '';
    return input
      .replace(/>/g, '/')
      .replace(/[\\\/]+/g, '/')
      .split('/')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .join('/');
  }

  private normalizeCategoryDisplay(input?: string): string {
    const normalized = this.normalizeCategoryPath(input);
    return normalized ? normalized.split('/').join(' > ') : '';
  }
}
