import { promises as fs } from 'fs';
import * as path from 'path';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TagsService } from './tags.service';
import { FileService } from '../common/file.service';
import { FrontmatterService, ParsedArticle } from '../common/frontmatter.service';
import { ContentIndexService } from '../common/content-index.service';
import { PATHS } from '../common/constants';

describe('TagsService', () => {
  let fileService: FileService;
  let frontmatterService: FrontmatterService;
  let index: ContentIndexService;
  let service: TagsService;

  /** Writes through FileService so the shared index is invalidated like on any real edit. */
  const seed = async (
    relativePath: string,
    tags: string[],
    published = '2024-01-01T00:00:00.000Z',
  ): Promise<void> => {
    const parsed: ParsedArticle = {
      frontmatter: {
        title: path.posix.basename(relativePath, '.md'),
        published,
        description: '',
        image: '',
        tags,
        category: '',
        draft: false,
        lang: 'zh',
      },
      content: '# body\n',
    };
    await fileService.writeFile(relativePath, frontmatterService.writeFrontmatter(parsed));
  };

  const tagsOf = async (relativePath: string): Promise<string[]> => {
    const raw = await fs.readFile(
      path.join(PATHS.POSTS_DIR, ...relativePath.split('/')),
      'utf-8',
    );
    return frontmatterService.parseFrontmatter(raw).frontmatter.tags;
  };

  beforeEach(async () => {
    await fs.rm(PATHS.POSTS_DIR, { recursive: true, force: true });
    await fs.rm(PATHS.BACKUPS_DIR, { recursive: true, force: true });
    await fs.mkdir(PATHS.POSTS_DIR, { recursive: true });
    await fs.mkdir(PATHS.BACKUPS_DIR, { recursive: true });

    fileService = new FileService();
    frontmatterService = new FrontmatterService();
    index = new ContentIndexService(fileService, frontmatterService);
    service = new TagsService(fileService, frontmatterService, index);
  });

  afterEach(() => index.onModuleDestroy());

  describe('reads', () => {
    beforeEach(async () => {
      await seed('A.md', ['java', 'spring']);
      await seed('B.md', ['spring', 'boot']);
      await seed('C.md', []);
    });

    it('sorts by name or by count on request', async () => {
      expect(await service.findAll('name')).toEqual([
        { name: 'boot', count: 1 },
        { name: 'java', count: 1 },
        { name: 'spring', count: 2 },
      ]);
      expect(await service.findPopular(2)).toEqual([
        { name: 'spring', count: 2 },
        { name: 'boot', count: 1 },
      ]);
    });

    it('finds a tag regardless of the casing the caller used', async () => {
      expect(await service.findOne('SPRING')).toEqual({ name: 'spring', count: 2 });
    });

    it('reports an unknown tag as not found', async () => {
      await expect(service.findOne('rust')).rejects.toThrow(NotFoundException);
    });

    it('pages articles and returns row metadata, not bare paths', async () => {
      await seed('D.md', ['java'], '2024-03-01T00:00:00.000Z');
      await seed('E.md', ['java'], '2024-02-01T00:00:00.000Z');

      const first = await service.getArticles('java', { page: 1, limit: 2 });

      expect(first.total).toBe(3);
      expect(first.totalPages).toBe(2);
      expect(first.data.map((item) => item.path)).toEqual(['D.md', 'E.md']);
      expect(first.data[0].title).toBe('D');

      const second = await service.getArticles('java', { page: 2, limit: 2 });
      expect(second.data.map((item) => item.path)).toEqual(['A.md']);
    });

    it('suggests by substring, most used first, and honours the limit', async () => {
      await seed('D.md', ['spring']);
      await seed('E.md', ['spring']);
      await seed('F.md', ['springframework']);

      const matches = await service.suggest('SPRING', 2);

      expect(matches).toEqual([
        { name: 'spring', count: 4 },
        { name: 'springframework', count: 1 },
      ]);
      expect(await service.suggest('   ')).toEqual([]);
    });

    it('ranks related tags by co-occurrence and never includes the tag itself', async () => {
      await seed('H.md', ['java', 'boot']);

      // Only A.md and H.md carry `java`, so `boot` co-occurs once and `spring` once.
      const related = await service.getRelated('java', 1);

      expect(related).toEqual([{ name: 'boot', count: 1 }]);
    });
  });

  describe('rename', () => {
    it('collapses the duplicate the rename creates instead of storing it twice', async () => {
      await seed('A.md', ['Java', 'spring']);
      await seed('B.md', ['Spring', 'boot']);

      const result = await service.rename('spring', 'Spring');

      expect(result).toMatchObject({ total: 2, count: 1, skipped: 1, failed: 0 });
      expect(await tagsOf('A.md')).toEqual(['Java', 'Spring']);
      expect(await tagsOf('B.md')).toEqual(['Spring', 'boot']);
    });

    it('rejects an empty target name', async () => {
      await seed('A.md', ['keep']);

      await expect(service.rename('keep', '  ')).rejects.toThrow(BadRequestException);
      expect(await tagsOf('A.md')).toEqual(['keep']);
    });
  });

  describe('delete', () => {
    it('removes the tag from every article, whatever casing it was stored with', async () => {
      await seed('A.md', ['x', 'keep']);
      await seed('B.md', ['X']);

      const result = await service.delete('x');

      expect(result).toMatchObject({ total: 2, count: 2, skipped: 0, failed: 0 });
      expect(await tagsOf('A.md')).toEqual(['keep']);
      expect(await tagsOf('B.md')).toEqual([]);
      // Tags live in frontmatter only, so the last article removes the tag itself.
      await expect(service.findOne('x')).rejects.toThrow(NotFoundException);
    });
  });

  describe('bulk add and remove', () => {
    beforeEach(async () => {
      await seed('A.md', ['keep']);
      await seed('B.md', []);
    });

    it('separates applied, already-done, and failed paths so the numbers add up', async () => {
      const result = await service.bulkAdd('keep', ['A.md', 'B.md', 'Missing.md']);

      expect(result).toMatchObject({ total: 3, count: 1, skipped: 1, failed: 1 });
      expect(result.failures).toEqual([{ path: 'Missing.md', reason: expect.any(String) }]);
      expect(await tagsOf('B.md')).toEqual(['keep']);
    });

    it('removes only the requested tag', async () => {
      await seed('A.md', ['keep', 'drop']);

      const result = await service.bulkRemove('drop', ['A.md', 'B.md']);

      expect(result).toMatchObject({ total: 2, count: 1, skipped: 1, failed: 0 });
      expect(await tagsOf('A.md')).toEqual(['keep']);
    });

    it('requires a tag name', async () => {
      await expect(service.bulkAdd('  ', ['A.md'])).rejects.toThrow(BadRequestException);
    });
  });
});
