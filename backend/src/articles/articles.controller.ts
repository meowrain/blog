import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { ArticlesService } from './articles.service';
import { CreateArticleDto } from './dto/create-article.dto';
import { UpdateArticleDto } from './dto/update-article.dto';
import { ListArticlesDto } from './dto/list-articles.dto';
import { BulkOperationDto, BulkOperationResultDto } from './dto/bulk-operation.dto';
import { ArticleDto, PaginatedArticlesDto } from './dto/article.dto';
import { wildcardParam } from '../common/path.util';

/**
 * `*path` arrives as an array of segments on Express 5, so every route below passes
 * it through `wildcardParam` before handing it to the service.
 */
@Controller('articles')
export class ArticlesController {
  constructor(private readonly articlesService: ArticlesService) {}

  /**
   * Get all articles with pagination and filtering
   * GET /api/articles?page=1&limit=20&category=Java&tag=Spring&search=Gin&draft=false
   */
  @Get()
  async findAll(@Query() query: ListArticlesDto): Promise<PaginatedArticlesDto> {
    return this.articlesService.findAll(query);
  }

  /**
   * Get a single article by path
   * GET /api/articles/Java/Spring/Article.md
   */
  @Get('*path')
  async findOne(@Param('path') path: string | string[]): Promise<ArticleDto> {
    return this.articlesService.findOne(wildcardParam(path));
  }

  /**
   * Create a new article
   * POST /api/articles
   */
  @Post()
  async create(@Body() createArticleDto: CreateArticleDto): Promise<ArticleDto> {
    return this.articlesService.create(createArticleDto);
  }

  /**
   * Toggle draft status
   * PATCH /api/articles/Java/Spring/Article.md/toggle-draft
   *
   * Declared before the wildcard update route: `*path` also matches slashes, so
   * the generic route would otherwise capture this request and leave
   * `toggle-draft` inside the article path.
   */
  @Patch('*path/toggle-draft')
  async toggleDraft(@Param('path') path: string | string[]): Promise<ArticleDto> {
    return this.articlesService.toggleDraft(wildcardParam(path));
  }

  /**
   * Update an article
   * PATCH /api/articles/Java/Spring/Article.md
   */
  @Patch('*path')
  async update(
    @Param('path') path: string | string[],
    @Body() updateArticleDto: UpdateArticleDto,
  ): Promise<ArticleDto> {
    return this.articlesService.update(wildcardParam(path), updateArticleDto);
  }

  /**
   * Delete an article
   * DELETE /api/articles/Java/Spring/Article.md
   */
  @Delete('*path')
  async remove(
    @Param('path') path: string | string[],
  ): Promise<{ backupPath: string | null }> {
    return this.articlesService.remove(wildcardParam(path));
  }

  /**
   * Bulk operations on articles
   * POST /api/articles/bulk
   */
  @Post('bulk')
  async bulkOperation(@Body() bulkDto: BulkOperationDto): Promise<BulkOperationResultDto> {
    return this.articlesService.bulkOperation(bulkDto);
  }
}
