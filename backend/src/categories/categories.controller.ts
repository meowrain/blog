import {
  Controller,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { ArticleListItemDto } from '../articles/dto/article.dto';
import { MutationResultDto } from '../common/batch.util';
import { PageQueryDto } from '../common/page-query.dto';
import { PagedResult } from '../common/pagination.util';
import {
  CategoryDto,
  CategoryTreeDto,
  DeleteCategoryQueryDto,
  RenameCategoryDto,
} from './dto/category.dto';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  /**
   * Get all categories (flat list)
   * GET /api/categories
   */
  @Get()
  async findAll(): Promise<CategoryDto[]> {
    return this.categoriesService.findAll();
  }

  /**
   * Get category tree
   * GET /api/categories/tree
   */
  @Get('tree')
  async findTree(): Promise<CategoryTreeDto[]> {
    return this.categoriesService.findTree();
  }

  /**
   * Get one category
   * GET /api/categories/:name
   */
  @Get(':name')
  async findOne(@Param('name') name: string): Promise<CategoryDto> {
    return this.categoriesService.findOne(name);
  }

  /**
   * Get articles by category
   * GET /api/categories/:name/articles?page=1&limit=20
   */
  @Get(':name/articles')
  async getArticles(
    @Param('name') name: string,
    @Query() query: PageQueryDto,
  ): Promise<PagedResult<ArticleListItemDto>> {
    return this.categoriesService.getArticles(name, query);
  }

  /**
   * Rename a category
   * PATCH /api/categories/rename
   */
  @Patch('rename')
  async rename(
    @Body() renameDto: RenameCategoryDto,
  ): Promise<MutationResultDto> {
    return this.categoriesService.rename(renameDto.oldName, renameDto.newName);
  }

  /**
   * Delete a category
   * DELETE /api/categories/:name?moveTo=<category> | ?deleteArticles=true
   */
  @Delete(':name')
  async delete(
    @Param('name') name: string,
    @Query() query: DeleteCategoryQueryDto,
  ): Promise<MutationResultDto> {
    return this.categoriesService.delete(
      name,
      query.moveTo,
      query.deleteArticles === 'true',
    );
  }
}
