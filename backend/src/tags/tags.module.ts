import { Module } from '@nestjs/common';
import { TagsController } from './tags.controller';
import { TagsService } from './tags.service';
import { FileService } from '../common/file.service';
import { FrontmatterService } from '../common/frontmatter.service';

@Module({
  controllers: [TagsController],
  providers: [TagsService, FileService, FrontmatterService],
  exports: [TagsService],
})
export class TagsModule {}
