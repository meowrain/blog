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
import { TagsService } from './tags.service';
import { MutationResultDto } from '../common/batch.util';
import { PageQueryDto } from '../common/page-query.dto';
import { PagedResult } from '../common/pagination.util';
import { ArticleListItemDto } from '../articles/dto/article.dto';
import {
  BulkTagBodyDto,
  LimitQueryDto,
  ListTagsQueryDto,
  RenameTagBodyDto,
  SuggestTagsQueryDto,
  TagDto,
} from './dto/tag.dto';

@Controller('tags')
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  /**
   * Get all tags
   * GET /api/tags?sortBy=name|count
   */
  @Get()
  async findAll(@Query() query: ListTagsQueryDto): Promise<TagDto[]> {
    return this.tagsService.findAll(query.sortBy);
  }

  /**
   * Get popular tags
   * GET /api/tags/popular?limit=20
   */
  @Get('popular')
  async findPopular(@Query() query: LimitQueryDto): Promise<TagDto[]> {
    return this.tagsService.findPopular(query.limit);
  }

  /**
   * Get tag suggestions
   * GET /api/tags/suggest?q=Spr&limit=10
   */
  @Get('suggest')
  async suggest(@Query() query: SuggestTagsQueryDto): Promise<TagDto[]> {
    return this.tagsService.suggest(query.q, query.limit);
  }

  /**
   * Get one tag
   * GET /api/tags/:name
   */
  @Get(':name')
  async findOne(@Param('name') name: string): Promise<TagDto> {
    return this.tagsService.findOne(name);
  }

  /**
   * Get articles by tag
   * GET /api/tags/:name/articles?page=1&limit=20
   */
  @Get(':name/articles')
  async getArticles(
    @Param('name') name: string,
    @Query() query: PageQueryDto,
  ): Promise<PagedResult<ArticleListItemDto>> {
    return this.tagsService.getArticles(name, query);
  }

  /**
   * Get related tags
   * GET /api/tags/:name/related?limit=10
   */
  @Get(':name/related')
  async getRelated(
    @Param('name') name: string,
    @Query() query: LimitQueryDto,
  ): Promise<TagDto[]> {
    return this.tagsService.getRelated(name, query.limit);
  }

  /**
   * Rename a tag
   * PATCH /api/tags/:name
   */
  @Patch(':name')
  async rename(
    @Param('name') oldName: string,
    @Body() body: RenameTagBodyDto,
  ): Promise<MutationResultDto> {
    return this.tagsService.rename(oldName, body.newName);
  }

  /**
   * Delete a tag
   * DELETE /api/tags/:name
   */
  @Delete(':name')
  async delete(@Param('name') name: string): Promise<MutationResultDto> {
    return this.tagsService.delete(name);
  }

  /**
   * Bulk add tag to articles
   * POST /api/tags/bulk/add
   */
  @Post('bulk/add')
  async bulkAdd(@Body() body: BulkTagBodyDto): Promise<MutationResultDto> {
    return this.tagsService.bulkAdd(body.tag, body.articlePaths);
  }

  /**
   * Bulk remove tag from articles
   * POST /api/tags/bulk/remove
   */
  @Post('bulk/remove')
  async bulkRemove(@Body() body: BulkTagBodyDto): Promise<MutationResultDto> {
    return this.tagsService.bulkRemove(body.tag, body.articlePaths);
  }
}
