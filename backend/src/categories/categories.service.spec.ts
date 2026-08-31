import { promises as fs } from 'fs';
import * as path from 'path';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { FileService } from '../common/file.service';
import { FrontmatterService, ParsedArticle } from '../common/frontmatter.service';
import { ContentIndexService } from '../common/content-index.service';
import { PATHS } from '../common/constants';

/** Category directories are the source of truth, so seeding a file creates a category. */
async function exists(relativePath: string): Promise<boolean> {
  try {
    await fs.access(path.join(PATHS.POSTS_DIR, ...relativePath.split('/')));
    return true;
  } catch {
    return false;
  }
}

describe('CategoriesService', () => {
  let fileService: FileService;
  let frontmatterService: FrontmatterService;
  let index: ContentIndexService;
  let service: CategoriesService;

  /** Writes through FileService so the shared index is invalidated like on any real edit. */
  const seed = async (
    relativePath: string,
    category: string,
    published = '2024-01-01T00:00:00.000Z',
  ): Promise<void> => {
    const parsed: ParsedArticle = {
      frontmatter: {
        title: path.posix.basename(relativePath, '.md'),
        published,
        description: '',
        image: '',
        tags: [],
        category,
        draft: false,
        lang: 'zh',
      },
      content: '# body\n',
    };
    await fileService.writeFile(relativePath, frontmatterService.writeFrontmatter(parsed));
  };

  const categoryOf = async (relativePath: string): Promise<string> => {
    const raw = await fs.readFile(
      path.join(PATHS.POSTS_DIR, ...relativePath.split('/')),
      'utf-8',
    );
    return frontmatterService.parseFrontmatter(raw).frontmatter.category;
  };

  beforeEach(async () => {
    await fs.rm(PATHS.POSTS_DIR, { recursive: true, force: true });
    await fs.rm(PATHS.BACKUPS_DIR, { recursive: true, force: true });
    await fs.mkdir(PATHS.POSTS_DIR, { recursive: true });
    await fs.mkdir(PATHS.BACKUPS_DIR, { recursive: true });

    fileService = new FileService();
    frontmatterService = new FrontmatterService();
    index = new ContentIndexService(fileService, frontmatterService);
    service = new CategoriesService(fileService, frontmatterService, index);
  });

  afterEach(() => index.onModuleDestroy());

  describe('reads', () => {
    beforeEach(async () => {
      await seed('Java/Spring/One.md', 'Java > Spring', '2024-03-01T00:00:00.000Z');
      await seed('Java/Spring/Two.md', 'Java > Spring', '2024-01-01T00:00:00.000Z');
      await seed('Java/Gin.md', 'Java');
      await seed('Loose.md', '');
    });

    it('counts a category and each of its ancestors', async () => {
      const categories = await service.findAll();

      expect(categories).toEqual([
        { name: 'Java', path: 'Java', articleCount: 3, parent: undefined },
        { name: 'Spring', path: 'Java/Spring', articleCount: 2, parent: 'Java' },
      ]);
    });

    it('builds the tree with one node per directory level', async () => {
      const tree = await service.findTree();

      expect(tree).toEqual([
        {
          name: 'Java',
          path: 'Java',
          articleCount: 3,
          children: [
            { name: 'Spring', path: 'Java/Spring', articleCount: 2, children: [] },
          ],
        },
      ]);
    });

    it('resolves a category by its last segment when that is unambiguous', async () => {
      expect((await service.findOne('Spring')).path).toBe('Java/Spring');
      expect((await service.findOne(' Java/Spring ')).path).toBe('Java/Spring');
      // Category paths are case-sensitive, unlike tags, which are not.
      await expect(service.findOne('spring')).rejects.toThrow(NotFoundException);
    });

    it('refuses to guess between two categories sharing a name', async () => {
      await seed('frontend/Bar/Article.md', 'frontend > Bar');
      await seed('nested/Bar/Article.md', 'nested > Bar');

      expect((await service.findOne('frontend/Bar')).path).toBe('frontend/Bar');
      await expect(service.findOne('Nope')).rejects.toThrow(NotFoundException);
      await expect(service.findOne('Bar')).rejects.toThrow(BadRequestException);
    });

    it('pages articles below a category and returns row metadata', async () => {
      const first = await service.getArticles('Java', { page: 1, limit: 2 });

      expect(first.total).toBe(3);
      expect(first.totalPages).toBe(2);
      expect(first.data.map((item) => item.path)).toEqual([
        'Java/Spring/One.md',
        'Java/Gin.md',
      ]);
    });
  });

  describe('rename', () => {
    beforeEach(async () => {
      await seed('Bar/One.md', 'Bar');
      await seed('Bar/Web/Two.md', 'Bar > Web');
      await seed('frontend/Bar/Three.md', 'frontend > Bar');
    });

    it('matches the category prefix at the start of the path only', async () => {
      const result = await service.rename('Bar', 'Kotlin');

      expect(result).toMatchObject({ total: 2, count: 2, skipped: 0, failed: 0 });
      expect(await exists('Kotlin/One.md')).toBe(true);
      expect(await exists('Kotlin/Web/Two.md')).toBe(true);
      expect(await exists('Bar/One.md')).toBe(false);
      // The regression this pins: the old unanchored String.replace rewrote the
      // `Bar` inside `frontend/Bar` and corrupted an unrelated article.
      expect(await exists('frontend/Bar/Three.md')).toBe(true);
      expect(await categoryOf('frontend/Bar/Three.md')).toBe('frontend > Bar');
    });

    it('keeps a moved subtree frontmatter in sync with its new directory', async () => {
      await service.rename('Bar', 'Kotlin');

      expect(await categoryOf('Kotlin/One.md')).toBe('Kotlin');
      expect(await categoryOf('Kotlin/Web/Two.md')).toBe('Kotlin > Web');
    });

    it('rejects a rename onto itself', async () => {
      await expect(service.rename('Bar', 'Bar')).rejects.toThrow(BadRequestException);
    });
  });

  describe('delete', () => {
    beforeEach(async () => {
      await seed('Bar/One.md', 'Bar');
      await seed('Bar/Web/Two.md', 'Bar > Web');
    });

    it('demands a decision instead of quietly deleting nothing', async () => {
      await expect(service.delete('Bar')).rejects.toThrow(BadRequestException);
      expect(await exists('Bar/One.md')).toBe(true);
    });

    it('gathers every article into the target category', async () => {
      const result = await service.delete('Bar', 'Kotlin');

      expect(result).toMatchObject({ total: 2, count: 2, skipped: 0, failed: 0 });
      expect(await exists('Kotlin/One.md')).toBe(true);
      expect(await categoryOf('Kotlin/One.md')).toBe('Kotlin');
      expect(await exists('Bar/One.md')).toBe(false);
    });

    it('treats a blank target as no decision given', async () => {
      await expect(service.delete('Bar', '')).rejects.toThrow(BadRequestException);
      await expect(service.delete('Bar', ' / ')).rejects.toThrow(BadRequestException);
      expect(await exists('Bar/One.md')).toBe(true);
      expect(await exists('Bar/Web/Two.md')).toBe(true);
    });

    it('removes the articles when that is what was asked for', async () => {
      const result = await service.delete('Bar', undefined, true);

      expect(result).toMatchObject({ total: 2, count: 2, failed: 0 });
      expect(await exists('Bar/One.md')).toBe(false);
      expect(await exists('Bar/Web/Two.md')).toBe(false);
      expect(await service.findAll()).toEqual([]);
    });

    it('refuses to move a category into itself', async () => {
      await expect(service.delete('Bar', 'Bar')).rejects.toThrow(BadRequestException);
    });
  });
});
