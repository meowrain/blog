import { promises as fs } from 'fs';
import * as path from 'path';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ArticlesService } from './articles.service';
import { FileService } from '../common/file.service';
import { FrontmatterService, ParsedArticle } from '../common/frontmatter.service';
import { ContentIndexService } from '../common/content-index.service';
import { BulkOperationType } from './dto/bulk-operation.dto';
import { PATHS } from '../common/constants';

interface Seed {
  title: string;
  published: string;
  tags?: string[];
  category?: string;
  draft?: boolean;
}

describe('ArticlesService', () => {
  let fileService: FileService;
  let frontmatterService: FrontmatterService;
  let index: ContentIndexService;
  let service: ArticlesService;

  /** Writes through FileService so the shared index is invalidated like on any real edit. */
  const seed = async (relativePath: string, meta: Seed): Promise<void> => {
    const parsed: ParsedArticle = {
      frontmatter: {
        title: meta.title,
        published: meta.published,
        description: '',
        image: '',
        tags: meta.tags ?? [],
        category: meta.category ?? '',
        draft: meta.draft ?? false,
        lang: 'zh',
      },
      content: `# ${meta.title}\n`,
    };
    await fileService.writeFile(relativePath, frontmatterService.writeFrontmatter(parsed));
  };

  const readRaw = (relativePath: string): Promise<string> =>
    fs.readFile(path.join(PATHS.POSTS_DIR, ...relativePath.split('/')), 'utf-8');

  beforeEach(async () => {
    await fs.rm(PATHS.POSTS_DIR, { recursive: true, force: true });
    await fs.rm(PATHS.BACKUPS_DIR, { recursive: true, force: true });
    await fs.mkdir(PATHS.POSTS_DIR, { recursive: true });
    await fs.mkdir(PATHS.BACKUPS_DIR, { recursive: true });

    fileService = new FileService();
    frontmatterService = new FrontmatterService();
    index = new ContentIndexService(fileService, frontmatterService);
    service = new ArticlesService(fileService, frontmatterService, index);
  });

  afterEach(() => index.onModuleDestroy());

  describe('create', () => {
    it('derives the file name from the title and stores the display category', async () => {
      const article = await service.create({
        title: 'Hello World',
        category: 'java/spring',
        content: '# hello',
      });

      expect(article.path).toBe('java/spring/Hello-World.md');
      expect(article.frontmatter.category).toBe('java > spring');
      expect(await readRaw(article.path)).toContain('# hello');
    });

    it('places a category-less article at the root', async () => {
      const article = await service.create({ title: 'Loose', content: 'body' });

      expect(article.path).toBe('Loose.md');
    });

    it('refuses to overwrite an existing article unless asked to', async () => {
      await service.create({ title: 'Same', category: 'Java', content: 'first' });

      await expect(
        service.create({ title: 'Same', category: 'Java', content: 'second' }),
      ).rejects.toThrow(ConflictException);
      expect(await readRaw('Java/Same.md')).toContain('first');

      await service.create({ title: 'Same', category: 'Java', content: 'second', overwrite: true });
      expect(await readRaw('Java/Same.md')).toContain('second');
    });

    it('rejects a title that validates to nothing', async () => {
      await expect(service.create({ title: '   ', content: 'body' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('update', () => {
    beforeEach(async () => {
      await seed('Java/Spring/Hello.md', {
        title: 'Hello',
        published: '2024-05-01T00:00:00.000Z',
        category: 'Java > Spring',
        tags: ['java'],
      });
      await seed('Java/Spring/Gone.md', {
        title: 'Gone',
        published: '2024-05-02T00:00:00.000Z',
        category: 'Java > Spring',
      });
    });

    it('moves the file and keeps the frontmatter title in sync', async () => {
      const article = await service.update('Java/Spring/Hello.md', { newTitle: 'Renamed' });

      expect(article.path).toBe('Java/Spring/Renamed.md');
      expect(article.frontmatter.title).toBe('Renamed');
      // The other fields of the document survive the rewrite.
      expect(article.frontmatter.tags).toEqual(['java']);
      await expect(fs.access(path.join(PATHS.POSTS_DIR, 'Java', 'Spring', 'Hello.md'))).rejects.toThrow();
    });

    it('moves the article and rewrites the category when newCategory is given', async () => {
      const article = await service.update('Java/Spring/Hello.md', {
        newCategory: 'Kotlin/Ktor',
      });

      expect(article.path).toBe('Kotlin/Ktor/Hello.md');
      expect(article.frontmatter.category).toBe('Kotlin > Ktor');
      expect(article.frontmatter.title).toBe('Hello');
    });

    it('leaves the path alone when only the body changes', async () => {
      const article = await service.update('Java/Spring/Hello.md', { content: 'edited body' });

      expect(article.path).toBe('Java/Spring/Hello.md');
      expect(article.content).toContain('edited body');
    });

    it('refuses a rename that would land on another article', async () => {
      await expect(
        service.update('Java/Spring/Hello.md', { newTitle: 'Gone' }),
      ).rejects.toThrow(ConflictException);

      expect((await service.findOne('Java/Spring/Hello.md')).frontmatter.title).toBe('Hello');
    });

    it('reports a missing article as not found', async () => {
      await expect(service.update('Java/Spring/Nope.md', { content: 'x' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('toggleDraft', () => {
    it('flips the flag in both the file and the response', async () => {
      await seed('Draft.md', { title: 'Draft', published: '2024-01-01T00:00:00.000Z' });

      expect((await service.toggleDraft('Draft.md')).frontmatter.draft).toBe(true);
      expect((await service.toggleDraft('Draft.md')).frontmatter.draft).toBe(false);
    });
  });

  describe('findAll', () => {
    beforeEach(async () => {
      await seed('Java/Spring/A.md', {
        title: 'Spring Data',
        published: '2024-01-03T00:00:00.000Z',
        tags: ['Java'],
      });
      await seed('Java/Spring/B.md', {
        title: 'Spring Boot',
        published: '2024-01-01T00:00:00.000Z',
        tags: ['java', 'boot'],
        draft: true,
      });
      await seed('Go/Gin.md', {
        title: 'Gin notes',
        published: '2024-01-02T00:00:00.000Z',
        tags: ['go'],
      });
    });

    it('returns newest first with paging metadata', async () => {
      const result = await service.findAll({ page: 1, limit: 2 });

      expect(result.total).toBe(3);
      expect(result.totalPages).toBe(2);
      expect(result.data.map((item) => item.title)).toEqual([
        'Spring Data',
        'Gin notes',
      ]);
    });

    it('matches a category subtree, not just the exact directory', async () => {
      const result = await service.findAll({ category: 'Java', page: 1, limit: 10 });

      expect(result.total).toBe(2);
    });

    it('matches tags case-insensitively', async () => {
      const result = await service.findAll({ tag: 'JAVA', page: 1, limit: 10 });

      expect(result.total).toBe(2);
    });

    it('keeps drafts out unless they are asked for', async () => {
      expect((await service.findAll({ draft: false, page: 1, limit: 10 })).total).toBe(2);
      expect((await service.findAll({ draft: true, page: 1, limit: 10 })).total).toBe(1);
    });

    it('searches the title only', async () => {
      const result = await service.findAll({ search: 'gin', page: 1, limit: 10 });

      expect(result.data.map((item) => item.path)).toEqual(['Go/Gin.md']);
    });
  });

  describe('bulkOperation', () => {
    beforeEach(async () => {
      await seed('Java/Tagged.md', {
        title: 'Tagged',
        published: '2024-01-01T00:00:00.000Z',
        tags: ['keep'],
      });
      await seed('Java/Plain.md', { title: 'Plain', published: '2024-01-02T00:00:00.000Z' });
    });

    it('counts already-tagged articles as skipped rather than as changes', async () => {
      const result = await service.bulkOperation({
        operation: BulkOperationType.ADD_TAG,
        tag: 'keep',
        paths: ['Java/Tagged.md', 'Java/Plain.md'],
      });

      expect(result).toMatchObject({ total: 2, success: 1, skipped: 1, failed: 0 });
      expect((await service.findOne('Java/Plain.md')).frontmatter.tags).toEqual(['keep']);
    });

    it('reports per-path failures without aborting the batch', async () => {
      const result = await service.bulkOperation({
        operation: BulkOperationType.SET_DRAFT,
        draft: true,
        paths: ['Java/Plain.md', 'Java/Missing.md'],
      });

      expect(result.total).toBe(2);
      expect(result.success).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.failures[0].path).toBe('Java/Missing.md');
    });

    it('requires the operand each operation needs', async () => {
      await expect(
        service.bulkOperation({ operation: BulkOperationType.ADD_TAG, paths: ['Java/Plain.md'] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('moves articles for update_category and skips ones already there', async () => {
      const result = await service.bulkOperation({
        operation: BulkOperationType.UPDATE_CATEGORY,
        category: 'Kotlin',
        paths: ['Java/Plain.md', 'Java/Tagged.md'],
      });

      expect(result).toMatchObject({ total: 2, success: 2, failed: 0 });
      expect((await service.findOne('Kotlin/Plain.md')).frontmatter.category).toBe('Kotlin');
    });
  });
});
