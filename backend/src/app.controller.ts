import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { FileService } from './common/file.service';
import { AppService } from './app.service';
import { PATHS, LIMITS } from './common/constants';
import { CATEGORY_DISPLAY_SEPARATOR } from './common/path.util';
import { resolvePage } from './common/pagination.util';
import { ListBackupsDto, PruneBackupsDto, RestoreBackupDto } from './app.dto';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly fileService: FileService,
  ) {}

  @Get()
  getInfo() {
    return this.appService.getInfo();
  }

  @Get('health')
  async health() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      postsReadable: await this.fileService.isPostsDirReadable(),
      backupsDir: PATHS.BACKUPS_DIR,
    };
  }

  @Get('meta')
  getMeta() {
    return {
      version: this.appService.getVersion(),
      categoryDisplaySeparator: CATEGORY_DISPLAY_SEPARATOR,
      categoryPathSeparator: '/',
      backupRetentionDays: LIMITS.BACKUP_RETENTION_DAYS,
    };
  }

  @Get('backups')
  async listBackups(@Query() query: ListBackupsDto) {
    const { page, limit } = resolvePage(query);
    return this.fileService.listBackups(page, limit);
  }

  @Post('backups/restore')
  async restoreBackup(@Body() body: RestoreBackupDto) {
    return this.fileService.restoreBackup(body.backupPath);
  }

  @Post('backups/prune')
  async pruneBackups(@Body() body: PruneBackupsDto) {
    return this.fileService.pruneBackups(body?.retentionDays);
  }
}
