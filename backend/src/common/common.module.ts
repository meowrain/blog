import { Global, Module } from '@nestjs/common';
import { FileService } from './file.service';
import { FrontmatterService } from './frontmatter.service';
import { ContentIndexService } from './content-index.service';

/**
 * Global infrastructure module: these three are registered once here so every
 * feature module shares the same instance - they hold process-wide state
 * (per-file write locks, the article metadata index).
 */
@Global()
@Module({
  providers: [FileService, FrontmatterService, ContentIndexService],
  exports: [FileService, FrontmatterService, ContentIndexService],
})
export class CommonModule {}
