import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { FileService } from './common/file.service';
import { AppService } from './app.service';
import { PATHS } from './common/constants';

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
    const postsReadable = await this.fileService.listFiles(PATHS.POSTS_DIR).then(
      () => true,
      () => false,
    );
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      postsReadable,
      backupsDir: PATHS.BACKUPS_DIR,
    };
  }

  @Get('meta')
  getMeta() {
    return {
      version: this.appService.getVersion(),
      categoryDisplaySeparator: ' > ',
      categoryPathSeparator: '/',
      backupRetentionDays: PATHS.BACKUP_RETENTION_DAYS,
    };
  }

  @Get('backups')
  async listBackups(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.fileService.listBackups(
      page ? Number(page) : 1,
      limit ? Number(limit) : 50,
    );
  }

  @Post('backups/restore')
  async restoreBackup(@Body() body: { backupPath: string }) {
    return this.fileService.restoreBackup(body.backupPath);
  }

  @Post('backups/prune')
  async pruneBackups(@Body() body?: { retentionDays?: number }) {
    return this.fileService.pruneBackups(body?.retentionDays);
  }
}
