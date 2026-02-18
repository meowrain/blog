import { Module } from '@nestjs/common';
import { ArticlesController } from './articles.controller';
import { ArticlesService } from './articles.service';
import { FileService } from '../common/file.service';
import { FrontmatterService } from '../common/frontmatter.service';

@Module({
  controllers: [ArticlesController],
  providers: [ArticlesService, FileService, FrontmatterService],
  exports: [ArticlesService, FileService, FrontmatterService],
})
export class ArticlesModule {}
