import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { promises as fs } from 'fs';
import path from 'path';
import { PATHS, INVALID_PATH_CHARS } from './constants';

export interface BackupItem {
  backupPath: string;
  sourcePath: string;
  action: 'write' | 'delete' | 'move';
  size: number;
  createdAt: string;
}

@Injectable()
export class FileService {
  private readonly writeLocks = new Map<string, Promise<void>>();

  /**
   * Read a file's content
   */
  async readFile(filePath: string): Promise<string> {
    const validatedPath = this.validatePath(filePath);
    try {
      return await fs.readFile(validatedPath, 'utf-8');
    } catch (error) {
      throw new NotFoundException(`File not found: ${filePath}`);
    }
  }

  /**
   * Write content to a file (creates directories if needed)
   */
  async writeFile(filePath: string, content: string): Promise<void> {
    const validatedPath = this.validatePath(filePath);
    await this.withFileLock(validatedPath, async () => {
      const dir = path.dirname(validatedPath);
      await this.ensureDir(dir);

      if (await this.exists(validatedPath)) {
        await this.createBackup(validatedPath, filePath, 'write');
      }

      await this.atomicWrite(validatedPath, content);
    });
  }

  /**
   * Delete a file
   */
  async deleteFile(filePath: string): Promise<void> {
    const validatedPath = this.validatePath(filePath);
    await this.withFileLock(validatedPath, async () => {
      try {
        await this.createBackup(validatedPath, filePath, 'delete');
        await fs.unlink(validatedPath);
      } catch (error) {
        throw new NotFoundException(`File not found: ${filePath}`);
      }
    });
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

    await this.withFileLock(validatedSource, async () => {
      try {
        await this.createBackup(validatedSource, sourcePath, 'move');
        await fs.rename(validatedSource, validatedTarget);
      } catch (error) {
        throw new BadRequestException(`Failed to move file: ${error.message}`);
      }
    });
  }

  /**
   * List all markdown files in a directory (recursively)
   */
  async listFiles(dirPath: string = PATHS.POSTS_DIR): Promise<string[]> {
    const validatedPath = this.validatePath(dirPath);
    const markdownFiles: string[] = [];

    async function scanDirectory(currentPath: string): Promise<void> {
      try {
        const entries = await fs.readdir(currentPath, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(currentPath, entry.name);

          if (entry.isDirectory()) {
            await scanDirectory(fullPath);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name);
            if (PATHS.MARKDOWN_EXTENSIONS.includes(ext)) {
              // Get relative path from POSTS_DIR
              const relativePath = path.relative(PATHS.POSTS_DIR, fullPath);
              markdownFiles.push(relativePath);
            }
          }
        }
      } catch (error) {
        // Skip directories we can't read
      }
    }

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

    // Ensure the resolved path is within POSTS_DIR
    const postsDirResolved = path.resolve(PATHS.POSTS_DIR);

    if (!resolvedPath.startsWith(postsDirResolved)) {
      throw new BadRequestException('Invalid path: access denied');
    }

    return resolvedPath;
  }

  /**
   * Validate a category or tag name (prevent invalid characters)
   */
  validateName(name: string): boolean {
    if (!name || name.trim().length === 0) {
      return false;
    }

    // Check for invalid characters
    if (INVALID_PATH_CHARS.test(name)) {
      return false;
    }

    return true;
  }

  /**
   * Sanitize a name for use in file paths
   */
  sanitizeName(name: string): string {
    return name.trim().replace(/[\\/]+/g, '/').replace(/\/+/g, '/');
  }

  /**
   * Get stats about a file
   */
  async getFileStats(filePath: string) {
    const validatedPath = this.validatePath(filePath);
    try {
      const stats = await fs.stat(validatedPath);
      return {
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
      };
    } catch (error) {
      throw new NotFoundException(`File not found: ${filePath}`);
    }
  }

  /**
   * List backups with simple pagination
   */
  async listBackups(page = 1, limit = 50): Promise<{ data: BackupItem[]; total: number; page: number; limit: number }> {
    await this.ensureBackupsDir();
    const files = await this.scanFiles(PATHS.BACKUPS_DIR);
    const backupFiles = files.filter((f) => f.endsWith('.bak'));

    const mapped = await Promise.all(
      backupFiles.map(async (absolutePath) => {
        const stats = await fs.stat(absolutePath);
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
        } as BackupItem;
      }),
    );

    mapped.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const total = mapped.length;
    const start = (page - 1) * limit;
    const data = mapped.slice(start, start + limit);
    return { data, total, page, limit };
  }

  /**
   * Restore one backup file back to posts directory
   */
  async restoreBackup(backupPath: string): Promise<{ restoredPath: string }> {
    const safeBackupPath = backupPath.replace(/\\/g, '/').replace(/^\/+/, '');
    const absoluteBackupPath = path.resolve(PATHS.BACKUPS_DIR, safeBackupPath);
    const backupsRoot = path.resolve(PATHS.BACKUPS_DIR);

    if (!absoluteBackupPath.startsWith(backupsRoot)) {
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
    const targetPath = this.validatePath(sourcePath);
    const content = await fs.readFile(absoluteBackupPath, 'utf-8');
    await this.atomicWrite(targetPath, content);
    return { restoredPath: sourcePath };
  }

  /**
   * Delete old backups by retention policy
   */
  async pruneBackups(retentionDays = PATHS.BACKUP_RETENTION_DAYS): Promise<{ deleted: number }> {
    await this.ensureBackupsDir();
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const files = await this.scanFiles(PATHS.BACKUPS_DIR);
    let deleted = 0;
    for (const file of files) {
      if (!file.endsWith('.bak')) continue;
      const stats = await fs.stat(file);
      if (stats.mtime.getTime() < cutoff) {
        await fs.unlink(file);
        deleted++;
      }
    }
    return { deleted };
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

  private async atomicWrite(absolutePath: string, content: string): Promise<void> {
    const dir = path.dirname(absolutePath);
    await this.ensureDir(dir);
    const tmpPath = `${absolutePath}.tmp.${Date.now()}`;
    await fs.writeFile(tmpPath, content, 'utf-8');
    await fs.rename(tmpPath, absolutePath);
  }

  private async createBackup(absoluteSourcePath: string, relativeSourcePath: string, action: BackupItem['action']): Promise<void> {
    if (!(await this.exists(absoluteSourcePath))) {
      return;
    }

    await this.ensureBackupsDir();
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const datePart = timestamp.slice(0, 8);
    const normalizedSource = relativeSourcePath.replace(/\\/g, '/');
    const targetRelative = path.join(datePart, action, `${normalizedSource}.${timestamp}.bak`);
    const targetAbsolute = path.resolve(PATHS.BACKUPS_DIR, targetRelative);
    await fs.mkdir(path.dirname(targetAbsolute), { recursive: true });
    await fs.copyFile(absoluteSourcePath, targetAbsolute);
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
}
