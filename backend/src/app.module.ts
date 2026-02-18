import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ArticlesModule } from './articles/articles.module';
import { CategoriesModule } from './categories/categories.module';
import { TagsModule } from './tags/tags.module';
import { FileService } from './common/file.service';

@Module({
  imports: [
    ArticlesModule,
    CategoriesModule,
    TagsModule,
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'src', 'admin', 'public'),
      serveRoot: '/admin',
    }),
  ],
  controllers: [AppController],
  providers: [AppService, FileService],
})
export class AppModule {}
