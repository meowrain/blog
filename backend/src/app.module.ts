import {
  Logger,
  Module,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ArticlesModule } from './articles/articles.module';
import { CategoriesModule } from './categories/categories.module';
import { TagsModule } from './tags/tags.module';
import { CommonModule } from './common/common.module';
import { FileService } from './common/file.service';
import { LoggingInterceptor } from './common/logging.interceptor';
import { LIMITS, PATHS } from './common/constants';

@Module({
  imports: [
    CommonModule,
    ArticlesModule,
    CategoriesModule,
    TagsModule,
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'src', 'admin', 'public'),
      serveRoot: '/admin',
    }),
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor }],
})
export class AppModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Backups');
  private pruneTimer?: NodeJS.Timeout;

  constructor(private readonly fileService: FileService) {}

  async onModuleInit(): Promise<void> {
    if (!(await this.fileService.isPostsDirReadable())) {
      // A wrong POSTS_DIR used to look exactly like an empty blog: no articles,
      // no categories, and no error anywhere.
      this.logger.error(
        `Posts directory is missing or unreadable: ${PATHS.POSTS_DIR} (set POSTS_DIR)`,
      );
    }

    if ((process.env.BACKUP_PRUNE_ENABLED ?? 'true').toLowerCase() === 'false') {
      return;
    }

    // Before, only a restart ran the retention sweep, so a long-lived process kept
    // every backup made since its last boot.
    this.prune();
    this.pruneTimer = setInterval(() => this.prune(), LIMITS.BACKUP_PRUNE_INTERVAL_MS);
    // Do not keep the process alive just for the cleanup job
    this.pruneTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
    }
  }

  private prune(): void {
    this.fileService
      .pruneBackups()
      .then(({ deleted }) => {
        if (deleted > 0) {
          this.logger.log(
            `removed ${deleted} backup(s) older than ${LIMITS.BACKUP_RETENTION_DAYS} days`,
          );
        }
      })
      .catch((error: unknown) => {
        this.logger.warn(`backup prune failed: ${String(error)}`);
      });
  }
}
