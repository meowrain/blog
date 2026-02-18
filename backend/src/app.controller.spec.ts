import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { FileService } from './common/file.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: FileService,
          useValue: {
            listFiles: jest.fn().mockResolvedValue([]),
            listBackups: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 50 }),
            restoreBackup: jest.fn(),
            pruneBackups: jest.fn(),
          },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return app info payload', () => {
      expect(appController.getInfo()).toMatchObject({
        name: 'blog-admin-backend',
        status: 'running',
      });
    });
  });
});
