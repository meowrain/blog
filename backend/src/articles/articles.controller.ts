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
  async findOne(@Param('path') path: string): Promise<ArticleDto> {
    return this.articlesService.findOne(path);
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
   * Update an article
   * PATCH /api/articles/Java/Spring/Article.md
   */
  @Patch('*path')
  async update(
    @Param('path') path: string,
    @Body() updateArticleDto: UpdateArticleDto,
  ): Promise<ArticleDto> {
    return this.articlesService.update(path, updateArticleDto);
  }

  /**
   * Delete an article
   * DELETE /api/articles/Java/Spring/Article.md
   */
  @Delete('*path')
  async remove(@Param('path') path: string): Promise<void> {
    return this.articlesService.remove(path);
  }

  /**
   * Toggle draft status
   * PATCH /api/articles/Java/Spring/Article.md/toggle-draft
   */
  @Patch('*path/toggle-draft')
  async toggleDraft(@Param('path') path: string): Promise<ArticleDto> {
    return this.articlesService.toggleDraft(path);
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
