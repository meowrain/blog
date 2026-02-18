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
import { TagDto } from './dto/tag.dto';

@Controller('tags')
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  /**
   * Get all tags
   * GET /api/tags?sortBy=name|count
   */
  @Get()
  async findAll(@Query('sortBy') sortBy?: string): Promise<TagDto[]> {
    return this.tagsService.findAll(sortBy);
  }

  /**
   * Get popular tags
   * GET /api/tags/popular?limit=20
   */
  @Get('popular')
  async findPopular(@Query('limit') limit?: string): Promise<TagDto[]> {
    return this.tagsService.findPopular(limit ? parseInt(limit) : 20);
  }

  /**
   * Get tag suggestions
   * GET /api/tags/suggest?q=Spr&limit=10
   */
  @Get('suggest')
  async suggest(
    @Query('q') query: string,
    @Query('limit') limit?: string,
  ): Promise<TagDto[]> {
    if (!query) {
      return [];
    }
    return this.tagsService.suggest(query, limit ? parseInt(limit) : 10);
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
   * GET /api/tags/:name/articles
   */
  @Get(':name/articles')
  async getArticles(@Param('name') name: string): Promise<string[]> {
    return this.tagsService.getArticles(name);
  }

  /**
   * Get related tags
   * GET /api/tags/:name/related?limit=10
   */
  @Get(':name/related')
  async getRelated(
    @Param('name') name: string,
    @Query('limit') limit?: string,
  ): Promise<TagDto[]> {
    return this.tagsService.getRelated(name, limit ? parseInt(limit) : 10);
  }

  /**
   * Rename a tag
   * PATCH /api/tags/:name
   */
  @Patch(':name')
  async rename(
    @Param('name') oldName: string,
    @Body() body: { newName: string },
  ): Promise<{ count: number }> {
    return this.tagsService.rename(oldName, body.newName);
  }

  /**
   * Delete a tag
   * DELETE /api/tags/:name
   */
  @Delete(':name')
  async delete(@Param('name') name: string): Promise<{ count: number }> {
    return this.tagsService.delete(name);
  }

  /**
   * Bulk add tag to articles
   * POST /api/tags/bulk/add
   */
  @Post('bulk/add')
  async bulkAdd(
    @Body() body: { tag: string; articlePaths: string[] },
  ): Promise<{ count: number }> {
    return this.tagsService.bulkAdd(body.tag, body.articlePaths);
  }

  /**
   * Bulk remove tag from articles
   * POST /api/tags/bulk/remove
   */
  @Post('bulk/remove')
  async bulkRemove(
    @Body() body: { tag: string; articlePaths: string[] },
  ): Promise<{ count: number }> {
    return this.tagsService.bulkRemove(body.tag, body.articlePaths);
  }
}
