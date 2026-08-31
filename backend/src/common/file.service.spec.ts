import { promises as fs } from 'fs';
import * as path from 'path';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { FileService } from './file.service';
import { PATHS } from './constants';

describe('FileService', () => {
  let service: FileService;

  const absolute = (relativePath: string): string =>
    path.join(PATHS.POSTS_DIR, ...relativePath.split('/'));

  const exists = async (relativePath: string): Promise<boolean> => {
    try {
      await fs.access(absolute(relativePath));
      return true;
    } catch {
      return false;
    }
  };

  beforeEach(async () => {
    // Every test starts from an empty content directory and an empty backup
    // store, so backup counts and directory walks only see its own writes.
    await fs.rm(PATHS.POSTS_DIR, { recursive: true, force: true });
    await fs.rm(PATHS.BACKUPS_DIR, { recursive: true, force: true });
    await fs.mkdir(PATHS.POSTS_DIR, { recursive: true });
    await fs.mkdir(PATHS.BACKUPS_DIR, { recursive: true });
    service = new FileService();
  });

  describe('path validation', () => {
    it.each(['../outside.md', '../../outside.md', 'a/../../b.md'])(
      'rejects traversal through %s',
      async (candidate) => {
        await expect(service.readFile(candidate)).rejects.toThrow(BadRequestException);
      },
    );

    it('rejects a sibling whose name merely starts with the posts directory name', async () => {
      // .../posts-evil shares a textual prefix with .../posts but is not inside it.
      await expect(service.readFile('../posts-evil/x.md')).rejects.toThrow(BadRequestException);
    });

    it('reports a missing file as not found', async () => {
      await expect(service.readFile('nowhere.md')).rejects.toThrow(NotFoundException);
    });
  });

  describe('writeFile / readFile', () => {
    it('creates the directories a nested path needs', async () => {
      await service.writeFile('Java/Spring/Hello.md', 'body');

      expect(await service.readFile('Java/Spring/Hello.md')).toBe('body');
    });
  });

  describe('writeFileIfAbsent', () => {
    it('writes once and refuses to clobber an existing file', async () => {
      expect(await service.writeFileIfAbsent('Only.md', 'first')).toBe(true);
      expect(await service.writeFileIfAbsent('Only.md', 'second')).toBe(false);
      expect(await service.readFile('Only.md')).toBe('first');
    });

    it('lets exactly one of two concurrent creates win', async () => {
      const results = await Promise.all([
        service.writeFileIfAbsent('Race.md', 'a'),
        service.writeFileIfAbsent('Race.md', 'b'),
      ]);

      expect(results.filter(Boolean)).toHaveLength(1);
    });
  });

  describe('updateFile', () => {
    it('serialises concurrent read-modify-write cycles on the same file', async () => {
      await service.writeFile('Counter.md', '0');

      // The mutator yields to the event loop, so an implementation without a
      // per-file lock would have every reader see the same stale "0".
      await Promise.all(
        Array.from({ length: 10 }, () =>
          service.updateFile('Counter.md', async (current) => {
            await new Promise((resolve) => setImmediate(resolve));
            return String(Number(current) + 1);
          }),
        ),
      );

      expect(await service.readFile('Counter.md')).toBe('10');
    });

    it('skips the backup when the mutator returns the content unchanged', async () => {
      await service.writeFile('Unchanged.md', 'same');
      await service.updateFile('Unchanged.md', (current) => current);
      expect((await service.listBackups(1, 100)).total).toBe(0);

      await service.updateFile('Unchanged.md', () => 'changed');
      expect((await service.listBackups(1, 100)).total).toBe(1);
    });

    it('notifies subscribers after a mutation, and not after unsubscribing', async () => {
      await service.writeFile('Notify.md', 'one');

      const seen: string[] = [];
      const stop = service.onFileMutation((relativePath) => seen.push(relativePath));

      await service.updateFile('Notify.md', () => 'two');
      await service.updateFile('Notify.md', (current) => current);
      stop();
      await service.writeFile('Notify.md', 'three');

      expect(seen).toEqual(['Notify.md']);
    });
  });

  describe('moveAndUpdate', () => {
    it('leaves one backup holding the pre-change content', async () => {
      await service.writeFile('From/A.md', 'original');

      await service.moveAndUpdate('From/A.md', 'To/A.md', (current) => `${current} edited`);

      expect(await service.readFile('To/A.md')).toBe('original edited');
      expect(await exists('From/A.md')).toBe(false);

      const { data } = await service.listBackups(1, 100);
      expect(data).toHaveLength(1);
      expect(data[0].action).toBe('move');
      expect(data[0].sourcePath).toBe('From/A.md');
    });

    it('refuses to overwrite an existing target', async () => {
      await service.writeFile('Source.md', 'source');
      await service.writeFile('Target.md', 'target');

      await expect(
        service.moveAndUpdate('Source.md', 'Target.md', () => 'rewritten'),
      ).rejects.toThrow(ConflictException);

      expect(await service.readFile('Target.md')).toBe('target');
      expect(await service.readFile('Source.md')).toBe('source');
    });
  });

  describe('deleteFile and restoreBackup', () => {
    it('backs the file up before unlinking it and restores it again', async () => {
      await service.writeFile('Doomed/Deep.md', 'precious');

      const backupPath = await service.deleteFile('Doomed/Deep.md');
      expect(backupPath).toContain('delete');
      expect(await exists('Doomed/Deep.md')).toBe(false);

      await expect(service.restoreBackup(backupPath as string)).resolves.toEqual({
        restoredPath: 'Doomed/Deep.md',
      });
      expect(await service.readFile('Doomed/Deep.md')).toBe('precious');
    });

    it('rejects a backup path that escapes the backups directory', async () => {
      await expect(service.restoreBackup('../posts/Whatever.md')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('listFilesWithStats', () => {
    it('walks recursively, keeps markdown only and returns posix relative paths', async () => {
      await service.writeFile('Nested/Deep/Post.md', 'a');
      await service.writeFile('Nested/Notes.txt', 'ignored');

      const entries = await service.listFilesWithStats();

      expect(entries.map((entry) => entry.relativePath)).toEqual(['Nested/Deep/Post.md']);
      expect(entries[0].size).toBe(1);
      expect(Number.isFinite(entries[0].mtimeMs)).toBe(true);
    });
  });

  describe('readHead', () => {
    it('returns the leading bytes only', async () => {
      await service.writeFile('Long.md', 'x'.repeat(500));

      expect(await service.readHead('Long.md', 40)).toBe('x'.repeat(40));
    });

    it('returns the whole file when it is shorter than the window', async () => {
      await service.writeFile('Short.md', 'tiny');

      expect(await service.readHead('Short.md', 4096)).toBe('tiny');
    });
  });

  describe('isPostsDirReadable', () => {
    it('is true while the content directory can be listed', async () => {
      await expect(service.isPostsDirReadable()).resolves.toBe(true);
    });
  });
});

// Only meaningful on a case-insensitive filesystem: there, a rename that only
// changes letter case addresses the same file and must not delete it.
(process.platform === 'win32' ? describe : describe.skip)('case-only rename on NTFS', () => {
  it('rewrites in place instead of moving and unlinking', async () => {
    const service = new FileService();
    await service.writeFile('Case/lower.md', 'content');

    await service.moveAndUpdate('Case/lower.md', 'Case/Lower.md', (current) => current);

    await expect(service.readFile('Case/Lower.md')).resolves.toBe('content');
  });
});
