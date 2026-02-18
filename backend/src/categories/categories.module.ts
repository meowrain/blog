import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { FileService } from '../common/file.service';
import { FrontmatterService } from '../common/frontmatter.service';

@Module({
  controllers: [CategoriesController],
  providers: [CategoriesService, FileService, FrontmatterService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
