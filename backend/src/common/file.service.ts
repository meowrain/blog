import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import path from 'path';
import { PATHS, LIMITS } from './constants';
import { toPosix } from './path.util';

export interface BackupItem {
  backupPath: string;
  sourcePath: string;
  action: 'write' | 'delete' | 'move';
  size: number;
  createdAt: string;
}

export interface FileEntry {
  /** Path relative to POSTS_DIR, always with forward slashes. */
  relativePath: string;
  mtimeMs: number;
  size: number;
}

/** Called with the POSTS_DIR-relative path after any successful mutation. */
export type FileMutationListener = (relativePath: string) => void;

/** Reads, mutates and returns the new content of a file. */
export type FileMutator = (current: string) => Promise<string> | string;

@Injectable()
export class FileService {
  private readonly logger = new Logger(FileService.name);
  private readonly writeLocks = new Map<string, Promise<void>>();
  private readonly mutationListeners = new Set<FileMutationListener>();

  /**
   * Subscribe to successful mutations of any managed file.
   * Returns an unsubscribe function.
   */
  onFileMutation(listener: FileMutationListener): () => void {
    this.mutationListeners.add(listener);
    return () => {
      this.mutationListeners.delete(listener);
    };
  }

  /**
   * Read a file's content
   */
  async readFile(filePath: string): Promise<string> {
    const validatedPath = this.validatePath(filePath);
    try {
      return await fs.readFile(validatedPath, 'utf-8');
    } catch {
      throw new NotFoundException(`File not found: ${filePath}`);
    }
  }

  /**
   * Read only the first bytes of a file.
   *
   * Enough for documents whose frontmatter sits at the top, and lets callers
   * avoid decoding (and keeping in memory) bodies they never look at. A short
   * read may cut a multi-byte character in half, so the result is only safe to
   * parse when the caller can confirm the block is closed inside it.
   */
  async readHead(
    filePath: string,
    maxBytes: number = LIMITS.FRONTMATTER_HEAD_BYTES,
  ): Promise<string> {
    const validatedPath = this.validatePath(filePath);
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      handle = await fs.open(validatedPath, 'r');
      const buffer = Buffer.allocUnsafe(maxBytes);
      const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
      return buffer.toString('utf-8', 0, bytesRead);
    } catch {
      throw new NotFoundException(`File not found: ${filePath}`);
    } finally {
      await handle?.close();
    }
  }

  /**
   * Write content to a file (creates directories if needed)
   */
  async writeFile(filePath: string, content: string): Promise<void> {
    const validatedPath = this.validatePath(filePath);
    await this.withFileLock(validatedPath, async () => {
      await this.backupAndWrite(validatedPath, filePath, content);
    });
    this.notifyMutation(filePath);
  }

  /**
   * Create a file only when it does not exist yet.
   *
   * The check runs inside the same lock as the write, so two concurrent
   * requests cannot both observe an absent file and clobber each other.
   * Returns false when the file already exists (nothing is written or backed up).
   */
  async writeFileIfAbsent(filePath: string, content: string): Promise<boolean> {
    const validatedPath = this.validatePath(filePath);
    let created = false;

    await this.withFileLock(validatedPath, async () => {
      if (await this.exists(validatedPath)) {
        return;
      }
      await this.backupAndWrite(validatedPath, filePath, content);
      created = true;
    });

    if (created) {
      this.notifyMutation(filePath);
    }
    return created;
  }

  /**
   * Read a file, mutate its content and write it back.
   * The whole read -> mutate -> write cycle runs under the same file lock,
   * so concurrent updates can no longer interleave and overwrite each other.
   */
  async updateFile(filePath: string, mutator: FileMutator): Promise<void> {
    const validatedPath = this.validatePath(filePath);
    let changed = false;

    await this.withFileLock(validatedPath, async () => {
      const current = await this.readOrThrow(validatedPath, filePath);
      const next = await mutator(current);

      // An unchanged document needs neither a backup nor a rewrite.
      if (next === current) {
        return;
      }
      await this.backupAndWrite(validatedPath, filePath, next);
      changed = true;
    });

    if (changed) {
      this.notifyMutation(filePath);
    }
  }

  /**
   * Move a file and rewrite its content as one logical operation.
   *
   * `moveFile` followed by `writeFile` produced two backups and two writes for
   * a single rename-and-edit, and left a window where the file existed at its
   * new path with stale content. Here the source is backed up once, the target
   * is written atomically, and the source is removed while both locks are held.
   * Moving onto an existing file is rejected: callers that mean to replace
   * something should delete it first.
   */
  async moveAndUpdate(
    sourcePath: string,
    targetPath: string,
    mutator: FileMutator,
  ): Promise<void> {
    const validatedSource = this.validatePath(sourcePath);
    const validatedTarget = this.validatePath(targetPath);
    // A name that only changes case addresses the same file on Windows, so it
    // must be rewritten in place; unlinking it after the write would delete it.
    const isMove = !this.isSameLocation(validatedSource, validatedTarget);

    await this.ensureDir(path.dirname(validatedTarget));

    await this.withFileLocks(isMove ? [validatedSource, validatedTarget] : [validatedTarget], async () => {
      const current = await this.readOrThrow(validatedSource, sourcePath);

      if (isMove && (await this.exists(validatedTarget))) {
        throw new ConflictException(`Target file already exists: ${targetPath}`);
      }

      const next = await mutator(current);

      // One backup holding the pre-change content, so the move stays reversible.
      await this.createBackup(validatedSource, sourcePath, isMove ? 'move' : 'write');
      await this.atomicWrite(validatedTarget, next);

      if (isMove) {
        try {
          await fs.unlink(validatedSource);
        } catch {
          // Already removed by a concurrent cleanup
        }
      }
    });

    this.notifyMutation(targetPath);
    if (isMove) {
      this.notifyMutation(sourcePath);
    }
  }

  /**
   * Delete a file
   */
  async deleteFile(filePath: string): Promise<string | null> {
    const validatedPath = this.validatePath(filePath);
    let backupPath: string | null = null;
    await this.withFileLock(validatedPath, async () => {
      try {
        backupPath = await this.createBackup(validatedPath, filePath, 'delete');
        await fs.unlink(validatedPath);
      } catch {
        throw new NotFoundException(`File not found: ${filePath}`);
      }
    });
    this.notifyMutation(filePath);
    return backupPath;
  }

  /**
   * Move a file from source to destination
   */
  async moveFile(sourcePath: string, targetPath: string): Promise<void> {
    const validatedSource = this.validatePath(sourcePath);
    const validatedTarget = this.validatePath(targetPath);

    // Ensure target directory exists
    const targetDir = path.dirname(validatedTarget);
    await this.ensureDir(targetDir);

    await this.withFileLocks([validatedSource, validatedTarget], async () => {
      try {
        await this.createBackup(validatedSource, sourcePath, 'move');
        await fs.rename(validatedSource, validatedTarget);
      } catch (error) {
        throw new BadRequestException(`Failed to move file: ${error.message}`);
      }
    });

    this.notifyMutation(targetPath);
    this.notifyMutation(sourcePath);
  }

  /**
   * List all markdown files in a directory (recursively), as POSTS_DIR-relative paths
   */
  async listFiles(dirPath: string = PATHS.POSTS_DIR): Promise<string[]> {
    const entries = await this.listFilesWithStats(dirPath);
    return entries.map((entry) => entry.relativePath);
  }

  /**
   * Same walk as `listFiles`, but each file is also stat'ed.
   * Lets callers cache parsed results per (path, mtime) without a second scan.
   */
  async listFilesWithStats(
    dirPath: string = PATHS.POSTS_DIR,
  ): Promise<FileEntry[]> {
    const validatedPath = this.validatePath(dirPath);
    const markdownFiles: FileEntry[] = [];

    const scanDirectory = async (currentPath: string): Promise<void> => {
      const entries = await fs
        .readdir(currentPath, { withFileTypes: true })
        .catch(() => undefined);
      // Skip directories we can't read
      if (!entries) {
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);

        if (entry.isDirectory()) {
          await scanDirectory(fullPath);
          continue;
        }
        if (!entry.isFile()) {
          continue;
        }

        const ext = path.extname(entry.name);
        if (!PATHS.MARKDOWN_EXTENSIONS.includes(ext)) {
          continue;
        }

        try {
          const stats = await fs.stat(fullPath);
          // Relative path is always taken from POSTS_DIR, never from dirPath
          markdownFiles.push({
            relativePath: toPosix(path.relative(PATHS.POSTS_DIR, fullPath)),
            mtimeMs: stats.mtimeMs,
            size: stats.size,
          });
        } catch {
          // File vanished between readdir and stat
        }
      }
    };

    await scanDirectory(validatedPath);
    return markdownFiles;
  }

  /**
   * Ensure a directory exists (create if needed)
   */
  async ensureDir(dirPath: string): Promise<void> {
    const validatedPath = this.validatePath(dirPath);
    await fs.mkdir(validatedPath, { recursive: true });
  }

  /**
   * Check if a file exists
   */
  async fileExists(filePath: string): Promise<boolean> {
    const validatedPath = this.validatePath(filePath);
    return this.exists(validatedPath);
  }

  /**
   * Cheap liveness probe: confirms the content directory is present and
   * readable without walking it. Used by /health.
   */
  async isPostsDirReadable(): Promise<boolean> {
    try {
      await fs.access(PATHS.POSTS_DIR);
      await fs.readdir(PATHS.POSTS_DIR);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate and sanitize a file path to prevent path traversal attacks
   */
  private validatePath(inputPath: string): string {
    // Convert to absolute path if relative
    let resolvedPath: string;

    if (path.isAbsolute(inputPath)) {
      resolvedPath = inputPath;
    } else {
      // If path starts with POSTS_DIR or is relative, resolve against POSTS_DIR
      resolvedPath = path.resolve(PATHS.POSTS_DIR, inputPath);
    }

    // Normalize path to remove any '..' or '.'
    resolvedPath = path.normalize(resolvedPath);

    // Ensure the resolved path is within POSTS_DIR (boundary match, not prefix
    // match: /a/posts-evil would otherwise pass a startsWith('/a/posts') check)
    const postsDirResolved = path.resolve(PATHS.POSTS_DIR);
    const relativeToPosts = path.relative(postsDirResolved, resolvedPath);

    if (relativeToPosts.startsWith('..') || path.isAbsolute(relativeToPosts)) {
      throw new BadRequestException('Invalid path: access denied');
    }

    return resolvedPath;
  }

  /**
   * Build a BackupItem, or null when the file vanished between scan and stat
   */
  private async toBackupItem(absolutePath: string): Promise<BackupItem | null> {
    let stats;
    try {
      stats = await fs.stat(absolutePath);
    } catch {
      return null;
    }

    const rel = path.relative(PATHS.BACKUPS_DIR, absolutePath).replace(/\\/g, '/');
    const parts = rel.split('/');
    const action = (parts[1] as BackupItem['action']) ?? 'write';
    const sourcePath = parts.slice(2).join('/').replace(/\.\d{8}T\d{6}Z\.bak$/, '');

    return {
      backupPath: rel,
      sourcePath,
      action,
      size: stats.size,
      createdAt: stats.mtime.toISOString(),
    };
  }

  /**
   * Extract the creation timestamp encoded in a backup file name
   */
  private backupTimestamp(absolutePath: string): string {
    return path.basename(absolutePath).match(/\.(\d{8}T\d{6}Z)\.bak$/)?.[1] ?? '';
  }

  /**
   * List backups with simple pagination.
   * Backups are stored as YYYYMMDD/<action>/<source>.<timestamp>.bak, so date
   * directories are walked newest first and the walk stops once the requested
   * page is filled (only the page window is stat'ed).
   */
  async listBackups(
    page = 1,
    limit = LIMITS.DEFAULT_PAGE_LIMIT,
  ): Promise<{ data: BackupItem[]; total: number; page: number; limit: number }> {
    await this.ensureBackupsDir();
    const backupsRoot = path.resolve(PATHS.BACKUPS_DIR);

    const dateDirs = (await fs.readdir(backupsRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a));

    const start = (page - 1) * limit;
    const end = start + limit;
    const data: BackupItem[] = [];
    let total = 0;

    for (const dateDir of dateDirs) {
      let files: string[];
      try {
        files = (await this.scanFiles(path.join(backupsRoot, dateDir))).filter((f) =>
          f.endsWith('.bak'),
        );
      } catch {
        // Directory disappeared while scanning
        continue;
      }

      const offset = total;
      total += files.length;

      // Newest first inside a day, based on the timestamp encoded in the name
      files.sort(
        (a, b) =>
          this.backupTimestamp(b).localeCompare(this.backupTimestamp(a)) ||
          b.localeCompare(a),
      );

      const dayStart = Math.max(0, start - offset);
      const dayEnd = Math.max(0, end - offset);

      for (const file of files.slice(dayStart, dayEnd)) {
        const item = await this.toBackupItem(file);
        if (item) {
          data.push(item);
        }
      }

      if (total >= end) {
        break;
      }
    }

    return { data, total, page, limit };
  }

  /**
   * Restore one backup file back to posts directory
   */
  async restoreBackup(backupPath: string): Promise<{ restoredPath: string }> {
    const safeBackupPath = backupPath.replace(/\\/g, '/').replace(/^\/+/, '');
    const absoluteBackupPath = path.resolve(PATHS.BACKUPS_DIR, safeBackupPath);
    const backupsRoot = path.resolve(PATHS.BACKUPS_DIR);

    // Boundary match, not a prefix match: backups-evil/x.bak would otherwise
    // pass a startsWith(backupsRoot) check.
    const relativeToBackups = path.relative(backupsRoot, absoluteBackupPath);
    if (relativeToBackups.startsWith('..') || path.isAbsolute(relativeToBackups)) {
      throw new BadRequestException('Invalid backup path');
    }

    if (!(await this.exists(absoluteBackupPath))) {
      throw new NotFoundException(`Backup not found: ${backupPath}`);
    }

    const rel = path.relative(backupsRoot, absoluteBackupPath).replace(/\\/g, '/');
    const parts = rel.split('/');
    if (parts.length < 3) {
      throw new BadRequestException('Invalid backup file layout');
    }

    const sourcePath = parts.slice(2).join('/').replace(/\.\d{8}T\d{6}Z\.bak$/, '');
    const content = await fs.readFile(absoluteBackupPath, 'utf-8');
    // Go through writeFile so the current version is backed up first,
    // which makes a restore itself reversible
    await this.writeFile(sourcePath, content);
    return { restoredPath: sourcePath };
  }

  /**
   * Delete old backups by retention policy
   */
  async pruneBackups(
    retentionDays = LIMITS.BACKUP_RETENTION_DAYS,
  ): Promise<{ deleted: number }> {
    await this.ensureBackupsDir();
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const files = await this.scanFiles(PATHS.BACKUPS_DIR);
    let deleted = 0;
    for (const file of files) {
      if (!file.endsWith('.bak')) continue;
      try {
        const stats = await fs.stat(file);
        if (stats.mtime.getTime() < cutoff) {
          await fs.unlink(file);
          deleted++;
        }
      } catch {
        // File disappeared while pruning
      }
    }
    return { deleted };
  }

  private async readOrThrow(absolutePath: string, displayPath: string): Promise<string> {
    try {
      return await fs.readFile(absolutePath, 'utf-8');
    } catch {
      throw new NotFoundException(`File not found: ${displayPath}`);
    }
  }

  private notifyMutation(relativePath: string): void {
    for (const listener of this.mutationListeners) {
      try {
        listener(relativePath);
      } catch (error) {
        // A broken subscriber must never fail a completed write
        this.logger.warn(`File mutation listener threw: ${error.message}`);
      }
    }
  }

  private async withFileLock(key: string, task: () => Promise<void>): Promise<void> {
    const previous = this.writeLocks.get(key) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(task)
      .finally(() => {
        if (this.writeLocks.get(key) === next) {
          this.writeLocks.delete(key);
        }
      });
    this.writeLocks.set(key, next);
    await next;
  }

  /**
   * Acquire the locks for several files at once. Keys are sorted first so two
   * concurrent multi-file operations always lock in the same order (no deadlock).
   * A locked region may use read-only helpers, but must never call back into a
   * write method: that would queue behind this very lock and never run.
   */
  private async withFileLocks(keys: string[], task: () => Promise<void>): Promise<void> {
    const ordered = Array.from(new Set(keys)).sort();
    const runFrom = async (index: number): Promise<void> => {
      if (index >= ordered.length) {
        await task();
        return;
      }
      await this.withFileLock(ordered[index], () => runFrom(index + 1));
    };
    await runFrom(0);
  }

  /**
   * Shared "create backup + atomic write" step used by writeFile and updateFile.
   * Must run while the caller holds the lock for absolutePath.
   */
  private async backupAndWrite(
    absolutePath: string,
    sourcePathForBackup: string,
    content: string,
  ): Promise<void> {
    const dir = path.dirname(absolutePath);
    await this.ensureDir(dir);

    if (await this.exists(absolutePath)) {
      await this.createBackup(absolutePath, sourcePathForBackup, 'write');
    }

    await this.atomicWrite(absolutePath, content);
  }

  private async atomicWrite(absolutePath: string, content: string): Promise<void> {
    const dir = path.dirname(absolutePath);
    await this.ensureDir(dir);
    const tmpPath = `${absolutePath}.tmp.${randomUUID()}`;
    try {
      await fs.writeFile(tmpPath, content, 'utf-8');
      await fs.rename(tmpPath, absolutePath);
    } catch (error) {
      try {
        await fs.unlink(tmpPath);
      } catch {
        // Temporary file is already gone
      }
      throw error;
    }
  }

  private async createBackup(
    absoluteSourcePath: string,
    relativeSourcePath: string,
    action: BackupItem['action'],
  ): Promise<string | null> {
    if (!(await this.exists(absoluteSourcePath))) {
      return null;
    }

    await this.ensureBackupsDir();
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const datePart = timestamp.slice(0, 8);
    const normalizedSource = relativeSourcePath.replace(/\\/g, '/');
    const targetRelative = path.join(
      datePart,
      action,
      `${normalizedSource}.${timestamp}.bak`,
    );
    const targetAbsolute = path.resolve(PATHS.BACKUPS_DIR, targetRelative);
    await fs.mkdir(path.dirname(targetAbsolute), { recursive: true });
    await fs.copyFile(absoluteSourcePath, targetAbsolute);
    return path.relative(path.resolve(PATHS.BACKUPS_DIR), targetAbsolute).replace(/\\/g, '/');
  }

  private async ensureBackupsDir(): Promise<void> {
    await fs.mkdir(PATHS.BACKUPS_DIR, { recursive: true });
  }

  private async scanFiles(dir: string): Promise<string[]> {
    const out: string[] = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...(await this.scanFiles(full)));
      } else if (entry.isFile()) {
        out.push(full);
      }
    }
    return out;
  }

  private async exists(absolutePath: string): Promise<boolean> {
    try {
      await fs.access(absolutePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Whether two absolute paths address the same file. NTFS is case-insensitive,
   * so a rename that only changes letter case must not be treated as a move.
   */
  private isSameLocation(absolutePathA: string, absolutePathB: string): boolean {
    return process.platform === 'win32'
      ? absolutePathA.toLowerCase() === absolutePathB.toLowerCase()
      : absolutePathA === absolutePathB;
  }
}
