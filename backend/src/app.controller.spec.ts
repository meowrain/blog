import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { FileService } from './common/file.service';
import { ListBackupsDto } from './app.dto';

describe('AppController', () => {
  let appController: AppController;
  const fileService = {
    isPostsDirReadable: jest.fn().mockResolvedValue(true),
    listBackups: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 50 }),
    restoreBackup: jest.fn(),
    pruneBackups: jest.fn(),
  };

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService, { provide: FileService, useValue: fileService }],
    }).compile();

    appController = moduleRef.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return app info payload', () => {
      expect(appController.getInfo()).toMatchObject({
        name: 'blog-admin-backend',
        status: 'running',
      });
    });
  });

  describe('health', () => {
    it('reports whether the content directory is readable', async () => {
      fileService.isPostsDirReadable.mockResolvedValueOnce(false);

      const health = await appController.health();

      expect(health.postsReadable).toBe(false);
      expect(typeof health.timestamp).toBe('string');
    });
  });

  describe('backups', () => {
    it('clamps an oversized page size before listing', async () => {
      const query = Object.assign(new ListBackupsDto(), { page: 1, limit: 100_000 });

      await appController.listBackups(query);

      expect(fileService.listBackups).toHaveBeenCalledWith(1, 100);
    });
  });
});
