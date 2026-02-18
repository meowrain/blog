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
import { CategoriesService } from './categories.service';
import { CategoryDto, CategoryTreeDto, RenameCategoryDto, DeleteCategoryDto } from './dto/category.dto';

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
   * GET /api/categories/:name/articles
   */
  @Get(':name/articles')
  async getArticles(@Param('name') name: string): Promise<string[]> {
    return this.categoriesService.getArticles(name);
  }

  /**
   * Rename a category
   * PATCH /api/categories/rename
   */
  @Patch('rename')
  async rename(@Body() renameDto: { oldName: string; newName: string }): Promise<{ count: number }> {
    return this.categoriesService.rename(renameDto.oldName, renameDto.newName);
  }

  /**
   * Delete a category
   * DELETE /api/categories/:name
   */
  @Delete(':name')
  async delete(
    @Param('name') name: string,
    @Query('moveTo') moveTo?: string,
    @Query('deleteArticles') deleteArticles?: string,
  ): Promise<{ count: number }> {
    const shouldDelete = deleteArticles === 'true';
    return this.categoriesService.delete(name, moveTo, shouldDelete);
  }
}
